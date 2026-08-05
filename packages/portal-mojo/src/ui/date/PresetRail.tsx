// PresetRail — the "Quick range" rail beside DateRangePicker's calendar.
// Ported from web-mojo src/core/forms/inputs/calendar/PresetSidebar.js (152
// lines, read in full). The per-precision default lists are carried
// verbatim; a custom list is `{ label, range() }` entries with
// `{ divider: true }` separators. Dividers CONSUME an index (source's flat
// forEach indexing), so `activeIndex` keys line up whichever entries are
// buttons.
//
// React shape: the active index is CONTROLLED (`activeIndex` prop) — the
// owning picker highlights a preset when picked and clears it when a manual
// calendar anchor starts (source called `sidebar.setActive(-1)` from
// `range:start`). `onSelect` resolves the preset's `range()` and emits the
// canonical strings at precision plus the raw range (source's `parsed`).
import { addMonths, daysInMonth, formatByPrecision, today } from './fns';
import type { ParsedDate, ParsedYmd, Precision } from './fns';

/** What a preset's `range()` resolves to — parsed shapes or canonical
 *  strings; both format identically at the rail's precision. */
export interface PresetRange { start: ParsedDate | string; end: ParsedDate | string }

/** `divider?: undefined` / `label?: undefined` markers make presence the
 *  discriminant (same trick as fns.ts's ParsedDate shapes). */
export interface CustomPreset { label: string; range: () => PresetRange; divider?: undefined }
export interface PresetDivider { divider: true; label?: undefined; range?: undefined }
export type PresetEntry = CustomPreset | PresetDivider;

/** `'default' | true` → the precision's built-in list; an array is used
 *  as-is, dividers included. */
export type PresetsOption = 'default' | true | PresetEntry[];

export interface PresetSelectEvent {
    index: number;
    label: string;
    /** Canonical strings at the rail's precision (YYYY-MM-DD / YYYY-MM / YYYY). */
    start: string;
    end: string;
    /** The range exactly as the preset returned it (source's `parsed`). */
    range: PresetRange;
}

export interface PresetRailProps {
    /** Picks the default list and the output format. Default 'day'. */
    precision?: Precision;
    presets?: PresetsOption;
    /** Rail heading. Default 'Quick range'; '' hides it. */
    eyebrow?: string;
    /** Highlighted entry index; -1 (default) = none. Controlled. */
    activeIndex?: number;
    onSelect?: (event: PresetSelectEvent) => void;
    className?: string;
}

// ── Default lists (verbatim from source) ───────────────────────────

/** Local day math — source parity: PresetSidebar carried its own addDays. */
function addDays(p: ParsedYmd, n: number): ParsedYmd {
    const d = new Date(p.y, p.m - 1, p.d + n);
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

export function dayPresets(): PresetEntry[] {
    return [
        { label: 'Today', range: () => { const t = today(); return { start: t, end: t }; } },
        { label: 'Yesterday', range: () => { const y = addDays(today(), -1); return { start: y, end: y }; } },
        { label: 'Last 7 days', range: () => { const t = today(); return { start: addDays(t, -6), end: t }; } },
        { label: 'Last 30 days', range: () => { const t = today(); return { start: addDays(t, -29), end: t }; } },
        { label: 'Last 90 days', range: () => { const t = today(); return { start: addDays(t, -89), end: t }; } },
        { divider: true },
        { label: 'This month', range: () => { const t = today(); return { start: { y: t.y, m: t.m, d: 1 }, end: t }; } },
        {
            label: 'Last month',
            range: () => {
                const t = today();
                const prev = addMonths({ y: t.y, m: t.m }, -1);
                return {
                    start: { y: prev.y, m: prev.m, d: 1 },
                    end: { y: prev.y, m: prev.m, d: daysInMonth(prev.y, prev.m) },
                };
            },
        },
        { label: 'This year', range: () => { const t = today(); return { start: { y: t.y, m: 1, d: 1 }, end: t }; } },
    ];
}

export function monthPresets(): PresetEntry[] {
    return [
        { label: 'This month', range: () => { const t = today(); return { start: { y: t.y, m: t.m }, end: { y: t.y, m: t.m } }; } },
        { label: 'Last month', range: () => { const t = today(); const prev = addMonths({ y: t.y, m: t.m }, -1); return { start: prev, end: prev }; } },
        { label: 'Last 3 months', range: () => { const t = today(); return { start: addMonths({ y: t.y, m: t.m }, -2), end: { y: t.y, m: t.m } }; } },
        { label: 'Last 6 months', range: () => { const t = today(); return { start: addMonths({ y: t.y, m: t.m }, -5), end: { y: t.y, m: t.m } }; } },
        { label: 'YTD', range: () => { const t = today(); return { start: { y: t.y, m: 1 }, end: { y: t.y, m: t.m } }; } },
        { label: 'Last 12 months', range: () => { const t = today(); return { start: addMonths({ y: t.y, m: t.m }, -11), end: { y: t.y, m: t.m } }; } },
    ];
}

export function yearPresets(): PresetEntry[] {
    return [
        { label: 'This year', range: () => { const t = today(); return { start: { y: t.y }, end: { y: t.y } }; } },
        { label: 'Last year', range: () => { const t = today(); return { start: { y: t.y - 1 }, end: { y: t.y - 1 } }; } },
        { label: 'Last 3 years', range: () => { const t = today(); return { start: { y: t.y - 2 }, end: { y: t.y } }; } },
        { label: 'Last 5 years', range: () => { const t = today(); return { start: { y: t.y - 4 }, end: { y: t.y } }; } },
        { label: 'Last 10 years', range: () => { const t = today(); return { start: { y: t.y - 9 }, end: { y: t.y } }; } },
    ];
}

export function defaultPresets(precision: Precision): PresetEntry[] {
    if (precision === 'year') return yearPresets();
    if (precision === 'month') return monthPresets();
    return dayPresets();
}

/** Unknown enum-ish prop values fall back WITH a warn — never render nothing. */
function normPrecision(p: Precision | undefined): Precision {
    if (p == null || p === 'day' || p === 'month' || p === 'year') return p ?? 'day';
    console.warn(`PresetRail: unknown precision "${String(p)}" — falling back to "day"`);
    return 'day';
}

function resolvePresets(presets: PresetsOption | undefined, precision: Precision): PresetEntry[] {
    if (presets == null || presets === true || presets === 'default') return defaultPresets(precision);
    if (Array.isArray(presets)) return presets;
    console.warn(`PresetRail: unknown presets value "${String(presets)}" — falling back to the defaults`);
    return defaultPresets(precision);
}

export function PresetRail(props: PresetRailProps) {
    const precision = normPrecision(props.precision);
    const {
        presets = 'default',
        eyebrow = 'Quick range',
        activeIndex = -1,
        onSelect,
        className = '',
    } = props;
    const entries = resolvePresets(presets, precision);

    const pick = (entry: CustomPreset, index: number) => {
        const range = entry.range();
        onSelect?.({
            index,
            label: entry.label,
            start: formatByPrecision(range.start, precision),
            end: formatByPrecision(range.end, precision),
            range,
        });
    };

    return (
        <div className={`mojo-calendar-presets${className ? ` ${className}` : ''}`}>
            {eyebrow && <div className="mojo-calendar-presets-eyebrow">{eyebrow}</div>}
            {entries.map((entry, i) => entry.divider ? (
                <div key={`d${i}`} className="mojo-calendar-presets-divider" />
            ) : (
                <button
                    key={`${i}:${entry.label}`}
                    type="button"
                    className={`mojo-calendar-preset${i === activeIndex ? ' is-active' : ''}`}
                    onClick={() => pick(entry, i)}
                >
                    {entry.label}
                </button>
            ))}
        </div>
    );
}
