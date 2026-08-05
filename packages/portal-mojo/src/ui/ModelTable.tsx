// ModelTable — schema-driven server table at web-mojo TableView fidelity
// (ListView.js / TableView.js / TablePage.js port). No table library: sort,
// filter, search and paging are all wire params django-mojo processes, so
// there is no client-side row work for an engine to do. Table state IS the
// params store; rendering is a map.
//
// B2 features, all opt-in (absent props → prior rendering, byte-for-byte):
//   · columnChooser — show/hide columns; `hideable: false` locks a column
//   · persistState — per-table saved view (sort/size/search/filters/hidden)
//     in localStorage; precedence URL > saved > defaults, saved size wins
//   · selectable + batchActions — checkbox selection, select-all with
//     indeterminate, batch bar; runs Promise.allSettled with partial-result
//     toasts (TablePage.batchAction port), then clears + refetches
//   · autoRefresh — interval refetch with the smart-skip predicate (hidden /
//     blurred tab, active selection, any open dialog) + focus resume
//   · rowExpand — chevron + full-width detail row; single-open by default
//   · groupBy — synthetic header rows interleaved on key change; falsy key
//     = ungrouped tail (see ui/grouping.ts helpers)
//   · exportFormats — server-side export via download_format (csv/json)
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PAGE_SIZES, useTableParams, readTableState, writeTableState, clearTableState, type PersistedTableState } from '../client/params';
import { useModelList } from '../client/hooks';
import { mojoDownload } from '../client/client';
import type { ModelDef } from '../client/model';
import { FilterBar, FilterPills, type FilterDef } from './FilterBar';
import { busyWhile } from './loading';
import { modal } from './modal';
import { toast } from './toast';

export interface Column<T> {
    key: string;                       // server field; drives the sort param
    label: string;
    sortable?: boolean;
    align?: 'start' | 'center' | 'end';
    /** false → locked in the column chooser (always shown). */
    hideable?: boolean;
    render?: (row: T) => ReactNode;    // one cell prop — no formatter/format/template aliases
}

export interface Preset {
    key: string;
    label: string;
    params: Record<string, string>;    // empty {} = the "All" chip
}

export interface BatchAction<T> {
    key: string;
    label: string;
    icon?: string;
    danger?: boolean;
    /** Confirm copy; false skips the prompt. Default: "<label> N item(s)?" */
    confirm?: string | false;
    /**
     * Optional once-per-batch step (collect a reason, pick a value…) run
     * AFTER the confirm. Resolve null to cancel the batch; the resolved
     * value is passed to every run() call.
     */
    prepare?: () => Promise<unknown | null>;
    /** Per-row operation. Rejections count as failures, not aborts. */
    run: (row: T, prepared: unknown) => Promise<unknown>;
}

const GROUP_HEADER_STYLES = ['banner', 'mark', 'band', 'rule'] as const;
export type GroupHeaderStyle = (typeof GROUP_HEADER_STYLES)[number];

// Cell widths echo the real columns (web-mojo _buildSkeletonHtml's cycled
// w-* classes) so the shimmer silhouette lines up with the eventual rows.
const SKEL_WIDTHS = ['skel-w-90', 'skel-w-75', 'skel-w-60', 'skel-w-40', 'skel-w-25'];

/** Page-number window: {1, total, current±1} with … for the gaps. */
function pageWindow(current: number, total: number): (number | '…')[] {
    const keep = new Set<number>([1, total]);
    for (let i = current - 1; i <= current + 1; i++) if (i >= 1 && i <= total) keep.add(i);
    const sorted = [...keep].sort((a, b) => a - b);
    const out: (number | '…')[] = [];
    let last = 0;
    for (const p of sorted) {
        if (last && p - last > 1) out.push('…');
        out.push(p);
        last = p;
    }
    return out;
}

/**
 * Expanding search (maestro's `.fsearch` port): a 30px icon at rest, a real
 * input on focus, and PINNED open while it carries text — search is the one
 * filter whose state has no pill, so the open input is its indicator. `/`
 * focuses it from anywhere (maestro keyboard.js), hinted on hover.
 *
 * Search is a SERVER query like every other table param — keystrokes buffer
 * locally for 300ms (web-mojo's debounce) and then hit the wire once. Enter
 * commits immediately.
 */
export function ExpandingSearch({ value, onChange, placeholder }: {
    value: string;
    onChange: (term: string) => void;
    placeholder?: string;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState(value);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // External resets (Clear all, preset swap, back/forward) win over a
    // stale draft — but never while the user is mid-typing a pending edit.
    useEffect(() => {
        if (timerRef.current == null) setDraft(value);
    }, [value]);
    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

    const commit = (term: string) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        onChange(term);
    };
    const edit = (term: string) => {
        setDraft(term);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => commit(term), 300);
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== '/') return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            if (document.querySelector('dialog[open]')) return;
            e.preventDefault();
            inputRef.current?.focus();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);
    return (
        <div className={`fsearch${draft ? ' holding' : ''}`}>
            <i className="bi bi-search icon" />
            <input
                ref={inputRef}
                className="text"
                type="search"
                value={draft}
                placeholder={placeholder}
                onChange={(e) => edit(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
                }}
                aria-label="Search"
            />
            <kbd>/</kbd>
        </div>
    );
}

/** Shared dropdown shell (FilterBar's outside-click + Escape pattern). */
function MenuDropdown({ button, children, align = 'end' }: {
    button: (open: boolean, toggle: () => void) => ReactNode;
    children: ReactNode;
    align?: 'start' | 'end';
}) {
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
    return (
        <div className="filter-menu-wrap" ref={wrapRef}>
            {button(open, () => setOpen((v) => !v))}
            {open && <div className={`filter-menu${align === 'start' ? ' filter-menu-start' : ''}`} role="menu">{children}</div>}
        </div>
    );
}

export function ModelTable<T extends { id: number }>({
    model, endpoint, columns, filters = [], presets = [], eyebrow, title,
    searchPlaceholder = 'Search…', onRowClick, addLabel, onAdd, defaultSort,
    selectable = false, batchActions = [],
    columnChooser = false, persistState = false, persistKey,
    autoRefresh = 0,
    rowExpand, rowExpandMultiple = false,
    groupBy, groupHeaderLabel, groupHeaderStyle = 'banner',
    exportFormats = [],
}: {
    /** A defineModel definition — supplies the endpoint (and, later, schema). */
    model?: ModelDef<T>;
    /** Bare endpoint, for tables without a model definition. */
    endpoint?: string;
    columns: Column<T>[];
    filters?: FilterDef[];
    presets?: Preset[];
    eyebrow?: string;
    title: string;
    searchPlaceholder?: string;
    onRowClick?: (row: T) => void;
    addLabel?: string;
    onAdd?: () => void;
    /** Initial sort when the URL doesn't carry one (default '-created'). */
    defaultSort?: string;
    /** Checkbox selection — independent of batchActions by construction. */
    selectable?: boolean;
    batchActions?: BatchAction<T>[];
    columnChooser?: boolean;
    persistState?: boolean;
    /** Storage identity; default derives from route + endpoint. */
    persistKey?: string;
    /** Interval refetch in SECONDS (5s floor). 0/absent = off. */
    autoRefresh?: number;
    /** Inline full-width detail row; chevron column appears when set. */
    rowExpand?: (row: T) => ReactNode;
    rowExpandMultiple?: boolean;
    /** Row → group key; falsy = ungrouped tail. See ui/grouping.ts helpers. */
    groupBy?: (row: T) => string | null;
    groupHeaderLabel?: (key: string) => ReactNode;
    groupHeaderStyle?: GroupHeaderStyle;
    /** Server-side export formats offered in the toolbar. */
    exportFormats?: ('csv' | 'json')[];
}) {
    const resolvedEndpoint = model?.endpoint ?? endpoint;
    if (!resolvedEndpoint) throw new Error('ModelTable: pass `model` or `endpoint`');
    if (!GROUP_HEADER_STYLES.includes(groupHeaderStyle)) {
        console.warn(`ModelTable: unknown groupHeaderStyle "${groupHeaderStyle}" — falling back to 'banner'`);
        groupHeaderStyle = 'banner';
    }

    const qc = useQueryClient();
    const p = useTableParams(defaultSort !== undefined ? { sort: defaultSort } : {});

    // ── View persistence (WM-035): restore once BEFORE the first fetch ──
    const storageKey = persistKey ?? `${(typeof location !== 'undefined' ? location.hash.split('?')[0] : '') || '#/'}::${resolvedEndpoint}`;
    const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => new Set());
    const [hydrated, setHydrated] = useState(!persistState);
    const restoreRan = useRef(false);
    useEffect(() => {
        if (!persistState || restoreRan.current) return;
        restoreRan.current = true;
        const saved = readTableState(storageKey);
        if (saved) {
            if (Array.isArray(saved.hidden) && saved.hidden.length > 0) {
                const lockedSafe = saved.hidden.filter((key) => columns.find((c) => c.key === key)?.hideable !== false);
                setHiddenCols(new Set(lockedSafe));
            }
            p.applySaved(saved);
        }
        setHydrated(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount restore
    }, []);

    const query = useModelList<T>(resolvedEndpoint, p.wire, { enabled: hydrated });
    const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
    const count = query.data?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(count / p.size));
    const firstRow = count === 0 ? 0 : (p.page - 1) * p.size + 1;
    const lastRow = Math.min(count, (p.page - 1) * p.size + rows.length);
    const isFiltered = p.activeFilters.length > 0 || p.search !== '';

    // Save the view on every params/visibility change (post-hydration only,
    // so the restore itself never writes back a half-applied state).
    useEffect(() => {
        if (!persistState || !hydrated) return;
        const state: PersistedTableState = { v: 2 };
        if (p.sort) state.sort = p.sort;
        state.size = p.size;
        if (p.search) state.search = p.search;
        const rawFilters: Record<string, string> = {};
        for (const [key, value] of Object.entries(p.wire)) {
            if (key === 'start' || key === 'size' || key === 'sort' || key === 'search') continue;
            if (value == null || value === '') continue;
            rawFilters[key] = String(value);
        }
        if (Object.keys(rawFilters).length > 0) state.filters = rawFilters;
        const hidden = [...hiddenCols];
        if (hidden.length > 0) state.hidden = hidden;
        writeTableState(storageKey, state);
    }, [persistState, hydrated, p.wire, p.sort, p.size, p.search, hiddenCols, storageKey]);

    // ── Column chooser ───────────────────────────────────────────────────
    const visibleColumns = useMemo(
        () => (columnChooser && hiddenCols.size > 0)
            ? columns.filter((c) => c.hideable === false || !hiddenCols.has(c.key))
            : columns,
        [columns, columnChooser, hiddenCols],
    );
    const toggleColumn = (key: string) => {
        const col = columns.find((c) => c.key === key);
        if (!col || col.hideable === false) return;
        setHiddenCols((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };
    const resetColumns = () => {
        setHiddenCols(new Set());
        clearTableState(storageKey);
    };

    // ── Selection + batch (decoupled: checkboxes need no batchActions) ──
    const [selected, setSelected] = useState<Set<number>>(() => new Set());
    const wireSignature = JSON.stringify(p.wire);
    const prevSignature = useRef(wireSignature);
    useEffect(() => {
        // Page / sort / filter / size changes rebuild the row set — selection
        // clears (web-mojo pages-mode behavior). Auto-refresh ticks don't
        // change the wire, and they skip while a selection is active anyway.
        if (prevSignature.current !== wireSignature) {
            prevSignature.current = wireSignature;
            setSelected((prev) => (prev.size > 0 ? new Set() : prev));
        }
    }, [wireSignature]);

    const toggleSelected = (id: number) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };
    const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
    const someSelected = rows.some((r) => selected.has(r.id));
    const toggleSelectAll = () => {
        setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
    };

    /** TablePage.batchAction port: allSettled + partial-result toasts. */
    const runBatch = async (action: BatchAction<T>) => {
        const targets = rows.filter((r) => selected.has(r.id));
        if (targets.length === 0) return;
        if (action.confirm !== false) {
            const ok = await modal.confirm({
                title: action.label,
                message: action.confirm ?? `${action.label} ${targets.length} item(s)?`,
                confirmText: action.label,
                danger: action.danger,
            });
            if (!ok) return;
        }
        let prepared: unknown = null;
        if (action.prepare) {
            prepared = await action.prepare();
            if (prepared === null) return;
        }
        const results = await Promise.allSettled(targets.map((row) => action.run(row, prepared)));
        const successes = results.filter((r) => r.status === 'fulfilled').length;
        const failures = results.length - successes;
        if (failures === 0) toast.success(`${action.label}: ${successes} item(s) updated`);
        else if (successes === 0) toast.error(`${action.label} failed for all ${failures} item(s)`);
        else toast.warning(`${action.label}: ${successes} succeeded, ${failures} failed`);
        // Always clear + refetch on a non-cancel path so the user sees the
        // partial state after failures.
        setSelected(new Set());
        void qc.invalidateQueries({ queryKey: [resolvedEndpoint] });
    };

    // ── Row expand ───────────────────────────────────────────────────────
    const expandEnabled = typeof rowExpand === 'function';
    const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
    useEffect(() => {
        // Page change / refetch collapses rows that are no longer present.
        if (!expandEnabled) return;
        setExpanded((prev) => {
            if (prev.size === 0) return prev;
            const ids = new Set(rows.map((r) => r.id));
            const next = new Set([...prev].filter((id) => ids.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [rows, expandEnabled]);
    const toggleExpand = (id: number) => {
        setExpanded((prev) => {
            const next = new Set(rowExpandMultiple ? prev : []);
            if (prev.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // ── Auto-refresh (WM-034): interval + smart-skip predicate ──────────
    // Interval ONLY — no focus/visibility listeners. Stacking a resume-tick
    // on top of TanStack's own focus handling double-fetched every time the
    // window regained focus (report: "multiple fetches per next page" with
    // devtools open). Ticks simply skip while the tab is hidden/blurred and
    // the next on-interval tick catches up.
    const refetchRef = useRef(query.refetch);
    refetchRef.current = query.refetch;
    const selectedRef = useRef(selected);
    selectedRef.current = selected;
    const autoRefreshMs = autoRefresh > 0 ? Math.max(5, autoRefresh) * 1000 : 0;
    useEffect(() => {
        if (!autoRefreshMs) return;
        const skip = () =>
            document.hidden
            || !document.hasFocus()
            // An open dialog is the portal's "user is mid-interaction" signal
            // (web-mojo paused for cell edits + open menus).
            || document.querySelector('dialog[open]') != null
            || selectedRef.current.size > 0;
        const interval = setInterval(() => {
            if (skip()) return;
            void refetchRef.current();
        }, autoRefreshMs);
        return () => clearInterval(interval);
    }, [autoRefreshMs]);

    // ── Export ───────────────────────────────────────────────────────────
    // The one table action with NO feedback: the menu closes and the browser
    // download appears whenever the server finishes building the whole
    // filtered result set (seconds on a six-figure Logs table). busyWhile
    // blocks for exactly that long — and the anti-flash delay means the
    // instant mock export still shows nothing at all. See docs/loading.md.
    const runExport = useCallback(async (format: 'csv' | 'json') => {
        try {
            await busyWhile(
                `Preparing ${format.toUpperCase()} export…`,
                () => mojoDownload(resolvedEndpoint, p.wire, format),
            );
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Export failed');
        }
    }, [resolvedEndpoint, p.wire]);

    const leadCols = (expandEnabled ? 1 : 0) + (selectable ? 1 : 0);
    const totalCols = leadCols + visibleColumns.length;

    const sortIcon = (col: Column<T>) => {
        if (p.sort === col.key) return <i className="bi bi-arrow-up sort-icon" />;
        if (p.sort === `-${col.key}`) return <i className="bi bi-arrow-down sort-icon" />;
        return <i className="bi bi-arrow-down-up sort-icon sort-idle" />;
    };

    /** Interleave group headers on key change (falsy = ungrouped tail). */
    const renderBody = () => {
        const out: ReactNode[] = [];
        let prevKey: string | null = null;
        let prevKeySet = false;
        for (const row of rows) {
            if (groupBy) {
                let key: string | null = null;
                try {
                    key = groupBy(row);
                } catch (err) {
                    console.warn('ModelTable: groupBy threw — treating as ungrouped tail', err);
                }
                if (key && (!prevKeySet || key !== prevKey)) {
                    out.push(
                        <tr key={`grp:${key}:${row.id}`} className={`group-header-row group-header--${groupHeaderStyle}`}>
                            {/* Sticky span: the label stays inside the visible
                                scroll viewport however wide the table is. */}
                            <th colSpan={totalCols}><span className="group-header-label">{groupHeaderLabel ? groupHeaderLabel(key) : key}</span></th>
                        </tr>,
                    );
                    prevKey = key;
                    prevKeySet = true;
                }
            }
            const isExpanded = expandEnabled && expanded.has(row.id);
            out.push(
                <tr
                    key={row.id}
                    className={[
                        onRowClick ? 'row-click' : '',
                        selected.has(row.id) ? 'row-selected' : '',
                        isExpanded ? 'row-expanded' : '',
                    ].filter(Boolean).join(' ') || undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                    {expandEnabled && (
                        <td className="col-expand" onClick={(e) => e.stopPropagation()}>
                            <button
                                className="expand-toggle"
                                aria-expanded={isExpanded}
                                title={isExpanded ? 'Collapse' : 'Expand'}
                                onClick={() => toggleExpand(row.id)}
                            >
                                <i className="bi bi-chevron-right" />
                            </button>
                        </td>
                    )}
                    {selectable && (
                        <td className="col-select" onClick={(e) => e.stopPropagation()}>
                            <input
                                type="checkbox"
                                className="tbl-check"
                                checked={selected.has(row.id)}
                                onChange={() => toggleSelected(row.id)}
                                aria-label={`Select row ${row.id}`}
                            />
                        </td>
                    )}
                    {visibleColumns.map((col) => (
                        <td key={col.key} className={col.align ? `text-${col.align}` : undefined}>
                            {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '—')}
                        </td>
                    ))}
                </tr>,
            );
            if (isExpanded) {
                out.push(
                    <tr key={`detail:${row.id}`} className="detail-row">
                        <td colSpan={totalCols}>
                            <div className="detail-panel">{rowExpand!(row)}</div>
                        </td>
                    </tr>,
                );
            }
        }
        return out;
    };

    return (
        <div className="panel">
            <div className="toolbar">
                <div className="toolbar-heading">
                    {eyebrow && <div className="eyebrow">{eyebrow}</div>}
                    <h1 className="panel-title">{title}</h1>
                </div>
                <div className="toolbar-controls">
                    <ExpandingSearch value={p.search} onChange={p.setSearch} placeholder={searchPlaceholder} />
                    {/* Tool cluster: one joined icon group (web-mojo's compact
                        toolbar). Icons + tooltips only; text labels appear
                        only on very wide screens via .btn-label. */}
                    <div className="tool-group">
                        {filters.length > 0 && <FilterBar defs={filters} params={p} />}
                        {columnChooser && (
                            <MenuDropdown button={(open, toggle) => (
                                <button className="btn btn-compact" onClick={toggle} aria-expanded={open} title="Choose columns">
                                    <i className="bi bi-layout-three-columns" /> <span className="btn-label">Columns</span>
                                </button>
                            )}>
                                <div className="filter-menu-header">Show columns</div>
                                {columns.map((col) => {
                                    const locked = col.hideable === false;
                                    return (
                                        <label key={col.key} className={`chooser-item${locked ? ' chooser-locked' : ''}`} title={locked ? 'Always shown' : undefined}>
                                            <input
                                                type="checkbox"
                                                className="tbl-check"
                                                checked={locked || !hiddenCols.has(col.key)}
                                                disabled={locked}
                                                onChange={() => toggleColumn(col.key)}
                                            />
                                            <span>{col.label}</span>
                                            {locked && <i className="bi bi-lock-fill chooser-lock" />}
                                        </label>
                                    );
                                })}
                                <div className="filter-menu-sep" />
                                <button className="filter-menu-item" onClick={resetColumns}>
                                    <i className="bi bi-arrow-counterclockwise" /> Reset to defaults
                                </button>
                                {persistState && (
                                    <div className="chooser-persist"><i className="bi bi-check2-circle" /> Saved for this table</div>
                                )}
                            </MenuDropdown>
                        )}
                        {exportFormats.length > 0 && (
                            <MenuDropdown button={(open, toggle) => (
                                <button className="btn btn-compact" onClick={toggle} aria-expanded={open} title="Export">
                                    <i className="bi bi-download" /> <span className="btn-label">Export</span>
                                </button>
                            )}>
                                {exportFormats.map((format) => (
                                    <button key={format} className="filter-menu-item" onClick={() => void runExport(format)}>
                                        <i className={`bi ${format === 'csv' ? 'bi-filetype-csv' : 'bi-filetype-json'}`} />
                                        Export as {format.toUpperCase()}
                                    </button>
                                ))}
                            </MenuDropdown>
                        )}
                        {/* One refresh affordance: it spins on ANY fetch
                            (manual, page change, auto-tick). */}
                        <button
                            className="btn-icon"
                            title={autoRefreshMs > 0 ? `Refresh · auto every ${Math.round(autoRefreshMs / 1000)}s` : 'Refresh'}
                            onClick={() => query.refetch()}
                        >
                            <i className={`bi bi-arrow-repeat${query.isFetching ? ' spin' : ''}`} />
                        </button>
                    </div>
                    {onAdd && (
                        <button className="btn btn-primary btn-compact" onClick={onAdd}>
                            <i className="bi bi-plus-lg" /> <span className="btn-label">{addLabel ?? 'Add'}</span>
                        </button>
                    )}
                </div>
            </div>

            {presets.length > 0 && (
                <div className="seg-row">
                    <div className="seg">
                        {presets.map((preset) => (
                            <button
                                key={preset.key}
                                className={`seg-btn${p.presetActive(preset.params) ? ' seg-active' : ''}`}
                                onClick={() => p.applyPreset(preset.params)}
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>
                    {count > 0 && (
                        <span className="result-count">
                            Showing {firstRow}–{lastRow} of {count}
                            {isFiltered && <span className="dim"> · filtered</span>}
                        </span>
                    )}
                </div>
            )}

            <FilterPills defs={filters} params={p} />

            {selectable && batchActions.length > 0 && selected.size > 0 && (
                <div className="batch-bar" role="region" aria-label="Batch actions">
                    <strong className="batch-count">{selected.size} selected</strong>
                    <div className="batch-actions">
                        {batchActions.map((action) => (
                            <button
                                key={action.key}
                                className={`btn btn-compact${action.danger ? ' btn-danger-ghost' : ''}`}
                                onClick={() => void runBatch(action)}
                            >
                                {action.icon && <i className={`bi ${action.icon}`} />} {action.label}
                            </button>
                        ))}
                        <button className="btn btn-compact" onClick={() => setSelected(new Set())}>
                            <i className="bi bi-x-circle" /> Clear
                        </button>
                    </div>
                </div>
            )}

            <div className="tbl-scroll">
                <table className="tbl">
                    <thead>
                        <tr>
                            {expandEnabled && <th className="col-expand" />}
                            {selectable && (
                                <th className="col-select">
                                    <input
                                        type="checkbox"
                                        className="tbl-check"
                                        checked={allSelected}
                                        ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected; }}
                                        onChange={toggleSelectAll}
                                        aria-label="Select all rows on this page"
                                    />
                                </th>
                            )}
                            {visibleColumns.map((col) => (
                                <th key={col.key} className={col.align ? `text-${col.align}` : undefined}>
                                    {col.sortable === false ? col.label : (
                                        <button className="th-sort" onClick={() => p.cycleSort(col.key)}>
                                            {col.label} {sortIcon(col)}
                                        </button>
                                    )}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {/* Skeleton whenever THIS query's rows aren't on screen
                            yet: cold load, restore gate, or a page/sort/filter
                            change still serving the previous key's rows
                            (isPlaceholderData). Background refetches of the
                            SAME key (autoRefresh) keep the live rows. */}
                        {query.isPending || query.isPlaceholderData || !hydrated ? (
                            Array.from({ length: Math.min(p.size, 8) }).map((_, i) => (
                                <tr key={i} className="skel-row" aria-hidden="true">
                                    {expandEnabled && <td className="col-expand" />}
                                    {selectable && <td className="col-select" />}
                                    {visibleColumns.map((col, ci) => (
                                        <td key={col.key} className={col.align ? `text-${col.align}` : undefined}>
                                            {ci === 0 ? (
                                                <span className="skel-user">
                                                    <span className="skel skel-avatar" />
                                                    <span className="skel-stack">
                                                        <span className="skel skel-w-60" />
                                                        <span className="skel skel-w-90" />
                                                    </span>
                                                </span>
                                            ) : (
                                                <span className={`skel ${col.align === 'center' ? 'skel-pill' : SKEL_WIDTHS[ci % SKEL_WIDTHS.length]}`} />
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        ) : query.isError ? (
                            <tr><td colSpan={totalCols}>
                                <div className="empty-state">
                                    <i className="bi bi-exclamation-triangle" />
                                    <h3>Could not load {title.toLowerCase()}</h3>
                                    <p>{query.error instanceof Error ? query.error.message : 'Request failed'}</p>
                                    <button className="btn" onClick={() => query.refetch()}>Retry</button>
                                </div>
                            </td></tr>
                        ) : rows.length === 0 ? (
                            <tr><td colSpan={totalCols}>
                                <div className="empty-state">
                                    <i className="bi bi-inbox" />
                                    {isFiltered ? (
                                        <>
                                            <h3>No results match your filters</h3>
                                            <button className="btn" onClick={() => p.clearFilters()}>Clear filters</button>
                                        </>
                                    ) : (
                                        <h3>No {title.toLowerCase()} yet</h3>
                                    )}
                                </div>
                            </td></tr>
                        ) : renderBody()}
                    </tbody>
                </table>
            </div>

            <div className="pager">
                <span className="result-count">
                    {count > 0 ? <>Showing {firstRow}–{lastRow} of {count}</> : 'No records'}
                </span>
                <div className="pager-right">
                    {totalPages > 1 && (
                        <div className="pager-controls">
                            <button
                                className="btn-icon" title="Previous page"
                                disabled={p.page <= 1}
                                onClick={() => p.setPage(p.page - 1)}
                            >
                                <i className="bi bi-chevron-left" />
                            </button>
                            {pageWindow(p.page, totalPages).map((entry, i) => entry === '…' ? (
                                <span key={`gap${i}`} className="pager-gap">…</span>
                            ) : (
                                <button
                                    key={entry}
                                    className={`pager-num${entry === p.page ? ' pager-current' : ''}`}
                                    onClick={() => p.setPage(entry)}
                                >
                                    {entry}
                                </button>
                            ))}
                            <button
                                className="btn-icon" title="Next page"
                                disabled={p.page >= totalPages}
                                onClick={() => p.setPage(p.page + 1)}
                            >
                                <i className="bi bi-chevron-right" />
                            </button>
                        </div>
                    )}
                    <label className="page-size">
                        <span className="dim">Rows</span>
                        <select
                            className="input input-compact"
                            value={p.size}
                            onChange={(e) => p.setSize(Number(e.target.value))}
                            aria-label="Rows per page"
                        >
                            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </label>
                </div>
            </div>
        </div>
    );
}
