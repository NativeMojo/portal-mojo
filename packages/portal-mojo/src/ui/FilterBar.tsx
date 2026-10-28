import { ComboBox } from './ComboBox';
// FilterBar — web-mojo's filter UX: an "Add filter" menu listing every
// available filter with a per-type icon and a check on the active ones, each
// opening a type-appropriate dialog; applied filters become editable pills.
// Adding a filter to a page is one entry in a `filters` array. Keys owned by
// the selected preset (`owned`) are the segment's to show: no pill, no count,
// and Clear all keeps them (see preset-owned.ts).
import { useEffect, useRef, useState } from 'react';
import { modal } from './modal';
import { DateRangePicker } from './date/DateRangePicker';
import { formatFilterDisplay } from '../client/lookups';
import type { ActiveFilter, TableParamsApi } from '../client/params';
import { isPresetOwned } from './preset-owned';

export type FilterType = 'text' | 'select' | 'multiselect' | 'number' | 'boolean' | 'date' | 'daterange';

export interface FilterDef {
    key: string;                 // model field
    label: string;
    type: FilterType;
    options?: { value: string; label: string }[];
    /** Django lookup override; defaults per type (text→icontains, number→gte). */
    lookup?: string;
    trueLabel?: string;
    falseLabel?: string;
    placeholder?: string;
}

const ICONS: Record<FilterType, string> = {
    text: 'bi-search',
    select: 'bi-funnel',
    multiselect: 'bi-funnel',
    number: 'bi-123',
    boolean: 'bi-toggle-on',
    date: 'bi-calendar',
    daterange: 'bi-calendar-range',
};

/** The wire key a filter writes — daterange uses the dr_* triple instead. */
export function paramKeyFor(def: FilterDef): string {
    switch (def.type) {
        case 'text': return `${def.key}__${def.lookup ?? 'icontains'}`;
        case 'multiselect': return `${def.key}__in`;
        case 'number': return `${def.key}__${def.lookup ?? 'gte'}`;
        case 'date': return `${def.key}__${def.lookup ?? 'gte'}`;
        default: return def.key;
    }
}

function defForActive(defs: FilterDef[], f: ActiveFilter): FilterDef | undefined {
    if (f.kind === 'daterange') return defs.find((d) => d.type === 'daterange' && d.key === f.id);
    return defs.find((d) => {
        if (d.type === 'daterange') return false;
        return paramKeyFor(d) === f.id || d.key === f.id || `${d.key}__in` === f.id;
    });
}

function isActive(defs: FilterDef[], active: ActiveFilter[], def: FilterDef): boolean {
    return active.some((f) => defForActive(defs, f) === def);
}

function pillText(def: FilterDef | undefined, f: ActiveFilter): string {
    if (f.kind === 'daterange') {
        const label = def?.label ?? f.id;
        if (f.start && f.end) return `${label}: ${f.start} → ${f.end}`;
        if (f.start) return `${label}: from ${f.start}`;
        return `${label}: until ${f.end}`;
    }
    const raw = f.value ?? '';
    // Map stored values back to their option labels where we have them.
    const pretty = def?.options
        ? raw.split(',').map((v) => def.options!.find((o) => o.value === v.trim())?.label ?? v).join(', ')
        : def?.type === 'boolean'
            ? (raw === 'true' ? (def.trueLabel ?? 'True') : (def.falseLabel ?? 'False'))
            : raw;
    return formatFilterDisplay(f.id, pretty, def?.label);
}

// ── per-type dialogs ──────────────────────────────────────────────────
type DialogResult = { clear: true } | { value: string | string[] } | { start: string; end: string } | null;

function FilterForm({ def, current, onDone }: {
    def: FilterDef;
    current: ActiveFilter | undefined;
    onDone: (r: DialogResult) => void;
}) {
    const [text, setText] = useState(current?.value ?? '');
    const [multi, setMulti] = useState<string[]>(
        current?.value ? current.value.split(',').map((s) => s.trim()) : [],
    );
    const [start, setStart] = useState(current?.start ?? '');
    const [end, setEnd] = useState(current?.end ?? '');

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        if (def.type === 'daterange') onDone({ start, end });
        else if (def.type === 'multiselect') onDone({ value: multi });
        else onDone({ value: text });
    };

    return (
        <form className="modal-pad" onSubmit={submit}>
            <h2 className="modal-title">{def.label}</h2>
            {def.type === 'daterange' ? (
                /* Inline DateRangePicker (preset rail on) replaced the two
                   bare native date inputs. Same staged start/end state, same
                   Apply/Remove/Cancel semantics and dr_* wire values — one
                   calendar pane so the body fits the md dialog. */
                <DateRangePicker
                    inline
                    months={1}
                    presets="default"
                    start={start}
                    end={end}
                    onChange={(e) => { setStart(e.start); setEnd(e.end); }}
                />
            ) : def.type === 'multiselect' ? (
                <div className="check-list">
                    {(def.options ?? []).map((o) => (
                        <label key={o.value} className="check-row">
                            <input
                                type="checkbox"
                                checked={multi.includes(o.value)}
                                onChange={(e) => setMulti((prev) => e.target.checked
                                    ? [...prev, o.value]
                                    : prev.filter((v) => v !== o.value))}
                            />
                            {o.label}
                        </label>
                    ))}
                </div>
            ) : def.type === 'select' || def.type === 'boolean' ? (
                <ComboBox allowCustom={false} maxSuggestions={Number.MAX_SAFE_INTEGER} value={String(text)} onChange={(selectedValue) => setText(String(selectedValue))} autoFocus options={[({ value: "", label: "Select…" }), ...((def.type === 'boolean'
                        ? [{ value: 'true', label: def.trueLabel ?? 'True' }, { value: 'false', label: def.falseLabel ?? 'False' }]
                        : def.options ?? []
                    ).map((o) => ({ value: String(o.value), label: String(o.label) })) ?? [])]} />
            ) : (
                <input
                    className="input"
                    type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'}
                    value={text}
                    placeholder={def.placeholder}
                    onChange={(e) => setText(e.target.value)}
                    autoFocus
                />
            )}
            {def.type === 'number' && (
                <span className="field-help">Matches records where {def.label.toLowerCase()} is ≥ this value.</span>
            )}
            <div className="modal-actions">
                {current && <button type="button" className="btn" onClick={() => onDone({ clear: true })}>Remove</button>}
                <button type="button" className="btn" onClick={() => onDone(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Apply</button>
            </div>
        </form>
    );
}

async function openFilterDialog(def: FilterDef, current: ActiveFilter | undefined, p: TableParamsApi) {
    const result = await modal.open<DialogResult>((close) => (
        <FilterForm def={def} current={current} onDone={(r) => close(r)} />
    ), { size: def.type === 'daterange' ? 'md' : 'sm' });
    if (!result) return;
    if (def.type === 'daterange') {
        if ('clear' in result) p.setDateRange(def.key, '', '');
        else if ('start' in result) p.setDateRange(def.key, result.start, result.end);
        return;
    }
    if ('clear' in result) p.setFilter(paramKeyFor(def), null);
    else if ('value' in result) p.setFilter(paramKeyFor(def), result.value);
}

// ── the bar ───────────────────────────────────────────────────────────
export function FilterBar({ defs, params, owned = {} }: { defs: FilterDef[]; params: TableParamsApi; owned?: Readonly<Record<string, string>> }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const active = params.activeFilters;
    // The menu's checks still show owned keys (they ARE filtering, and the
    // dialog edits them); the count and Clear all are the pills' business.
    const clearable = active.filter((f) => !isPresetOwned(f, owned));

    return (
        <div className="filter-menu-wrap" ref={wrapRef}>
            <button
                className={`btn btn-compact${clearable.length ? ' btn-has-filters' : ''}`}
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                title="Filter"
            >
                {/* Label collapses on normal widths (tool-group icon mode);
                    the active-count badge stays visible either way. */}
                <i className="bi bi-funnel" /> <span className="btn-label">Filter</span>
                {clearable.length > 0 && <span className="filter-count">{clearable.length}</span>}
            </button>
            {open && (
                <div className="filter-menu" role="menu">
                    {defs.map((def) => {
                        const on = isActive(defs, active, def);
                        return (
                            <button
                                key={`${paramKeyFor(def)}:${def.label}`}
                                className={`filter-menu-item${on ? ' filter-on' : ''}`}
                                onClick={() => {
                                    setOpen(false);
                                    const current = active.find((f) => defForActive(defs, f) === def);
                                    void openFilterDialog(def, current, params);
                                }}
                            >
                                <i className={`bi ${ICONS[def.type]}`} />
                                <span>{def.label}</span>
                                {on && <i className="bi bi-check2 filter-check" />}
                            </button>
                        );
                    })}
                    {clearable.length > 0 && (
                        <>
                            <div className="filter-menu-sep" />
                            <button
                                className="filter-menu-item filter-menu-clear"
                                onClick={() => { setOpen(false); params.clearFilters(owned); }}
                            >
                                <i className="bi bi-x-circle" /> Clear all filters
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

/** Active-filter pills — click to edit, × to remove. Preset-owned keys never pill. */
export function FilterPills({ defs, params, owned = {} }: { defs: FilterDef[]; params: TableParamsApi; owned?: Readonly<Record<string, string>> }) {
    const active = params.activeFilters.filter((f) => !isPresetOwned(f, owned));
    if (active.length === 0) return null;
    return (
        <div className="pill-row">
            {active.map((f) => {
                const def = defForActive(defs, f);
                return (
                    <span key={`${f.kind}:${f.id}`} className="pill">
                        <button
                            className="pill-edit"
                            title="Edit filter"
                            onClick={() => def && void openFilterDialog(def, f, params)}
                        >
                            {pillText(def, f)}
                        </button>
                        <button className="pill-x" title="Remove filter" onClick={() => params.removeFilter(f)}>
                            <i className="bi bi-x" />
                        </button>
                    </span>
                );
            })}
            <button className="pill-clear" onClick={() => params.clearFilters(owned)}>Clear all</button>
        </div>
    );
}
