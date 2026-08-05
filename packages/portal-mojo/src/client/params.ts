// The table params store — THE architecture rule from the port extraction:
// one flat params object is the single source of truth for search, sort,
// filters, and paging. It drives the server query, the URL, the pills, and
// preset matching. Components read it; nothing else owns table state.
//
// Two wire shapes carried over from web-mojo:
//   · multi-value filters collapse to `field__in=a,b` (single value → `field`)
//   · a daterange is the TRIPLE `dr_field` / `dr_start` / `dr_end`, so only
//     one range can be active at a time — by construction, not by convention.
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Params } from './types';

export interface ActiveFilter {
    /** Pill identity: the param key for plain filters, the field for ranges. */
    id: string;
    kind: 'plain' | 'daterange';
    value?: string;
    start?: string;
    end?: string;
}

export interface TableParams {
    search: string;
    sort: string; // 'field' | '-field' | ''
    page: number; // 1-based
    size: number;
}

export interface TableParamsApi extends TableParams {
    wire: Params;
    activeFilters: ActiveFilter[];
    filterValue(key: string): string | undefined;
    dateRange(): { field: string; start: string; end: string } | null;
    setSearch(term: string): void;
    cycleSort(field: string): void;
    setFilter(key: string, value: string | string[] | null): void;
    setDateRange(field: string, start: string, end: string): void;
    removeFilter(f: ActiveFilter): void;
    applyPreset(params: Record<string, string>): void;
    presetActive(params: Record<string, string>): boolean;
    clearFilters(): void;
    setPage(page: number): void;
    setSize(size: number): void;
    /**
     * One-shot rehydrate from a persisted view blob. Precedence is URL >
     * saved (a shared link always wins) — except `size`, a per-user viewing
     * preference the URL merely echoes, where saved wins. `sort: ''` (sort
     * deliberately off) is not persisted, so it can't be restored — the
     * default reappears; documented trade for clean URLs.
     */
    applySaved(saved: { sort?: string; size?: number; search?: string; filters?: Record<string, string> }): void;
}

const RESERVED = new Set(['search', 'sort', 'page', 'size']);
const RANGE_KEYS = new Set(['dr_field', 'dr_start', 'dr_end']);
export const PAGE_SIZES = [5, 10, 25, 50, 100];
const DEFAULT_SIZE = 10;

// ── View persistence (WM-035 port) ────────────────────────────────────
// One localStorage blob per table remembers how each user likes it — sort,
// page size, search + filters (field__in / dr_* triples verbatim), hidden
// columns. Versioned; anything unparseable or from another schema version is
// discarded AND cleared. Storage access always degrades to a no-op (privacy
// mode / SSR). Precedence on restore is URL > saved > defaults — except
// `size`, a per-user viewing preference the URL merely echoes, where saved
// wins (web-mojo's documented rule).

export interface PersistedTableState {
    v: 2;
    sort?: string;
    size?: number;
    search?: string;
    filters?: Record<string, string>;
    hidden?: string[];
}

const PERSIST_PREFIX = 'mojo:tableview:';

function persistStorage(): Storage | null {
    try {
        const ls = globalThis.localStorage;
        if (ls && typeof ls.getItem === 'function') return ls;
    } catch { /* access denied */ }
    return null;
}

export function readTableState(key: string): PersistedTableState | null {
    const store = persistStorage();
    if (!store) return null;
    let raw: string | null;
    try { raw = store.getItem(PERSIST_PREFIX + key); } catch { return null; }
    if (!raw) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { clearTableState(key); return null; }
    if (!parsed || typeof parsed !== 'object' || (parsed as PersistedTableState).v !== 2) {
        clearTableState(key);
        return null;
    }
    return parsed as PersistedTableState;
}

export function writeTableState(key: string, state: PersistedTableState): void {
    const store = persistStorage();
    if (!store) return;
    try { store.setItem(PERSIST_PREFIX + key, JSON.stringify(state)); } catch { /* quota / denied */ }
}

export function clearTableState(key: string): void {
    const store = persistStorage();
    if (!store) return;
    try { store.removeItem(PERSIST_PREFIX + key); } catch { /* denied */ }
}

export function useTableParams(defaults: Partial<TableParams> = {}): TableParamsApi {
    const [sp, setSp] = useSearchParams();

    const filters = useMemo(() => {
        const out: Record<string, string> = {};
        for (const [key, value] of sp.entries()) {
            if (!RESERVED.has(key)) out[key] = value;
        }
        return out;
    }, [sp]);

    const state = useMemo<TableParams>(() => ({
        search: sp.get('search') ?? defaults.search ?? '',
        sort: sp.get('sort') ?? defaults.sort ?? '-created',
        page: Math.max(1, Number(sp.get('page') ?? 1)),
        size: Number(sp.get('size') ?? defaults.size ?? DEFAULT_SIZE),
    }), [sp, defaults.search, defaults.sort, defaults.size]);

    const write = useCallback((next: TableParams, nextFilters: Record<string, string>) => {
        const out = new URLSearchParams();
        if (next.search) out.set('search', next.search);
        if (next.sort) out.set('sort', next.sort);
        if (next.page > 1) out.set('page', String(next.page));
        if (next.size !== DEFAULT_SIZE) out.set('size', String(next.size));
        for (const [key, value] of Object.entries(nextFilters)) {
            if (value !== '') out.set(key, value);
        }
        setSp(out, { replace: true });
    }, [setSp]);

    const wire = useMemo<Params>(() => ({
        start: (state.page - 1) * state.size,
        size: state.size,
        sort: state.sort || undefined,
        search: state.search || undefined,
        ...filters,
    }), [state, filters]);

    /** Collapse the daterange triple back into one pill entry. */
    const activeFilters = useMemo<ActiveFilter[]>(() => {
        const out: ActiveFilter[] = [];
        if (filters.dr_field) {
            out.push({
                id: filters.dr_field,
                kind: 'daterange',
                start: filters.dr_start ?? '',
                end: filters.dr_end ?? '',
            });
        }
        for (const [key, value] of Object.entries(filters)) {
            if (RANGE_KEYS.has(key)) continue;
            out.push({ id: key, kind: 'plain', value });
        }
        return out;
    }, [filters]);

    const setFilter = useCallback((key: string, value: string | string[] | null) => {
        const next = { ...filters };
        // A field never carries both its plain and its __in form.
        const field = key.replace(/__in$/, '');
        delete next[field];
        delete next[`${field}__in`];
        delete next[key];
        if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
            write({ ...state, page: 1 }, next);
            return;
        }
        if (Array.isArray(value)) {
            if (value.length === 1) next[field] = value[0]!;
            else next[`${field}__in`] = value.join(',');
        } else {
            next[key] = value;
        }
        write({ ...state, page: 1 }, next);
    }, [filters, state, write]);

    return {
        ...state,
        wire,
        activeFilters,
        filterValue: (key) => filters[key],
        dateRange: () => filters.dr_field
            ? { field: filters.dr_field, start: filters.dr_start ?? '', end: filters.dr_end ?? '' }
            : null,
        setSearch: (term) => write({ ...state, search: term, page: 1 }, filters),
        // 3-way header sort: asc → desc → off (web-mojo's explicit cycle).
        cycleSort: (field) => {
            const next = state.sort === field ? `-${field}` : state.sort === `-${field}` ? '' : field;
            write({ ...state, sort: next, page: 1 }, filters);
        },
        setFilter,
        setDateRange: (field, start, end) => {
            const next = { ...filters };
            delete next.dr_field; delete next.dr_start; delete next.dr_end;
            if (field && (start || end)) {
                next.dr_field = field;
                if (start) next.dr_start = start;
                if (end) next.dr_end = end;
            }
            write({ ...state, page: 1 }, next);
        },
        removeFilter: (f) => {
            const next = { ...filters };
            if (f.kind === 'daterange') {
                delete next.dr_field; delete next.dr_start; delete next.dr_end;
            } else {
                delete next[f.id];
            }
            write({ ...state, page: 1 }, next);
        },
        // Presets are mutually-exclusive bundles; active state is DERIVED by
        // matching, never stored.
        applyPreset: (params) => {
            const active = Object.entries(params).every(([k, v]) => filters[k] === v);
            write({ ...state, page: 1 }, active ? {} : { ...params });
        },
        presetActive: (params) => {
            const keys = Object.keys(params);
            if (keys.length === 0) return Object.keys(filters).length === 0;
            return keys.every((k) => filters[k] === params[k]);
        },
        clearFilters: () => write({ ...state, search: '', page: 1 }, {}),
        setPage: (page) => write({ ...state, page }, filters),
        setSize: (size) => write({ ...state, size, page: 1 }, filters),
        applySaved: (saved) => {
            const urlKeys = new Set(Array.from(sp.keys()));
            const next = { ...state };
            const nextFilters = { ...filters };
            if (saved.sort !== undefined && saved.sort !== '' && !urlKeys.has('sort')) next.sort = saved.sort;
            if (saved.search !== undefined && !urlKeys.has('search')) next.search = saved.search;
            if (saved.size !== undefined && PAGE_SIZES.includes(saved.size)) next.size = saved.size;
            for (const [key, value] of Object.entries(saved.filters ?? {})) {
                if (!urlKeys.has(key)) nextFilters[key] = value;
            }
            write(next, nextFilters);
        },
    };
}
