// ModelTable — schema-driven server table. No table library: sort, filter,
// search and paging are all wire params django-mojo processes, so there is no
// client-side row work for an engine to do. Table state IS the params store;
// rendering is a map.
import type { ReactNode } from 'react';
import { PAGE_SIZES, useTableParams } from '../client/params';
import { useModelList } from '../client/hooks';
import type { ModelDef } from '../client/model';
import { FilterBar, FilterPills, type FilterDef } from './FilterBar';

export interface Column<T> {
    key: string;                       // server field; drives the sort param
    label: string;
    sortable?: boolean;
    align?: 'start' | 'center' | 'end';
    render?: (row: T) => ReactNode;    // one cell prop — no formatter/format/template aliases
}

export interface Preset {
    key: string;
    label: string;
    params: Record<string, string>;    // empty {} = the "All" chip
}

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

export function ModelTable<T extends { id: number }>({
    model, endpoint, columns, filters = [], presets = [], eyebrow, title,
    searchPlaceholder = 'Search…', onRowClick, addLabel, onAdd,
}: {
    /** A defineModel definition — supplies the endpoint (and, come B2, schema). */
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
}) {
    const resolvedEndpoint = model?.endpoint ?? endpoint;
    if (!resolvedEndpoint) throw new Error('ModelTable: pass `model` or `endpoint`');
    const p = useTableParams();
    const query = useModelList<T>(resolvedEndpoint, p.wire);
    const rows = query.data?.rows ?? [];
    const count = query.data?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(count / p.size));
    const firstRow = count === 0 ? 0 : (p.page - 1) * p.size + 1;
    const lastRow = Math.min(count, (p.page - 1) * p.size + rows.length);
    const isFiltered = p.activeFilters.length > 0 || p.search !== '';

    const sortIcon = (col: Column<T>) => {
        if (p.sort === col.key) return <i className="bi bi-arrow-up sort-icon" />;
        if (p.sort === `-${col.key}`) return <i className="bi bi-arrow-down sort-icon" />;
        return <i className="bi bi-arrow-down-up sort-icon sort-idle" />;
    };

    return (
        <div className="panel">
            <div className="toolbar">
                <div className="toolbar-heading">
                    {eyebrow && <div className="eyebrow">{eyebrow}</div>}
                    <h1 className="panel-title">{title}</h1>
                </div>
                <div className="toolbar-controls">
                    <div className="search-box">
                        <i className="bi bi-search" />
                        <input
                            value={p.search}
                            placeholder={searchPlaceholder}
                            onChange={(e) => p.setSearch(e.target.value)}
                            aria-label="Search"
                        />
                    </div>
                    {filters.length > 0 && <FilterBar defs={filters} params={p} />}
                    <button className="btn-icon" title="Refresh" onClick={() => query.refetch()}>
                        <i className={`bi bi-arrow-repeat${query.isFetching ? ' spin' : ''}`} />
                    </button>
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

            <div className="tbl-scroll">
                <table className="tbl">
                    <thead>
                        <tr>
                            {columns.map((col) => (
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
                        {query.isPending ? (
                            Array.from({ length: Math.min(p.size, 8) }).map((_, i) => (
                                <tr key={i} className="skel-row">
                                    {columns.map((col) => <td key={col.key}><span className="skel" /></td>)}
                                </tr>
                            ))
                        ) : query.isError ? (
                            <tr><td colSpan={columns.length}>
                                <div className="empty-state">
                                    <i className="bi bi-exclamation-triangle" />
                                    <h3>Could not load {title.toLowerCase()}</h3>
                                    <p>{query.error instanceof Error ? query.error.message : 'Request failed'}</p>
                                    <button className="btn" onClick={() => query.refetch()}>Retry</button>
                                </div>
                            </td></tr>
                        ) : rows.length === 0 ? (
                            <tr><td colSpan={columns.length}>
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
                        ) : (
                            rows.map((row) => (
                                <tr
                                    key={row.id}
                                    className={onRowClick ? 'row-click' : undefined}
                                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                                >
                                    {columns.map((col) => (
                                        <td key={col.key} className={col.align ? `text-${col.align}` : undefined}>
                                            {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '—')}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
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
