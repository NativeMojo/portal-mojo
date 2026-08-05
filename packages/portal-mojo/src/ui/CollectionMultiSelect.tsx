// CollectionMultiSelect — the server-backed multi-pick panel: an always-
// visible checkbox list over live model data with search on top, SELECT/
// DESELECT-all with counts, and shift-click range selection. Ported from
// web-mojo src/core/forms/inputs/CollectionMultiSelect.js (588 lines:
// SearchView + ListItemsView + CollectionMultiSelectView) into the one-cache
// world: data flows through useModelList's query keys ([endpoint, params]),
// so pickers, tables and model hooks share one cache and one invalidation
// root — never a parallel fetch path (the #1275 epic contract).
//
// Deliberate departures from the source, all bug-class kills:
//   · Ids are compared NORMALIZED (String()) everywhere — the loose `==`
//     comparisons (and the strict-equals misses elsewhere) meant string vs
//     number ids worked only by luck. The value prop keeps its caller-side
//     types; comparisons all pass through one keyOf().
//   · SELECT adds the visible selectable rows to the value (union). The
//     source REPLACED the value with the visible rows, silently dropping
//     selections made under a previous search — selection is an id set that
//     must survive searches/refetches. DESELECT still clears the whole value
//     (source parity — it is the "empty the value" affordance).
//   · The shift-click anchor resets when the row set changes (new data /
//     ignoreIds change) — the source kept a stale index into a replaced
//     array and could range across rows that no longer existed.
//   · itemTemplate (mustache HTML string) → renderItem(row): ReactNode.
//     Trusted-HTML slots end here (architecture rule 6).
//   · excludeIds is NOT ported: despite its "server-side" comment it was a
//     second client-side filter identical to ignoreIds. One option remains.
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useModelList } from '../client/hooks';
import type { ModelDef } from '../client/model';
import type { Params } from '../client/types';
import { GroupContext } from '../client/group-context';

/** Every id comparison in this component goes through here — string and
 *  number ids (and mixes of the two) work by construction. */
const keyOf = (v: string | number): string => String(v);

/** MOJOUtils.getNestedValue heritage: dot-notation nested access. */
function getPath(obj: unknown, path: string): unknown {
    let cur: unknown = obj;
    for (const part of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
}

// One warn per (endpoint, field) — a bad field name is a config bug, not a
// render event (unknown-value rule: fall back WITH a warn, never to nothing).
const warnedFields = new Set<string>();
function warnFieldOnce(endpoint: string, kind: 'labelField' | 'valueField', field: string, note: string): void {
    const key = `${endpoint}:${kind}:${field}`;
    if (warnedFields.has(key)) return;
    warnedFields.add(key);
    console.warn(`CollectionMultiSelect: ${kind} "${field}" ${note} (endpoint ${endpoint})`);
}

interface Item<T> {
    /** Normalized identity — the one string every comparison uses. */
    key: string;
    /** The row's raw id, emitted through onChange when the row is picked. */
    id: string | number;
    label: string;
    disabled: boolean;
    row: T;
}

export interface CollectionMultiSelectProps<T extends { id: number | string }> {
    /** A defineModel definition — supplies the endpoint (and the row type). */
    model?: ModelDef<T>;
    /** Bare endpoint, for lists without a model definition. */
    endpoint?: string;
    /** Selected ids — CONTROLLED. String/number ids compare normalized. */
    value: Array<string | number>;
    /** Fires with the full next id array on every commit (each toggle IS a commit). */
    onChange: (ids: Array<string | number>) => void;
    /** Row field shown as the label; dot notation reaches nested fields. Default 'name'. */
    labelField?: string;
    /** Row field used as the id; dot notation reaches nested fields. Default 'id'. */
    valueField?: string;
    /** VISIBLE rows before the list scrolls (not the fetch size). Default 8. */
    size?: number;
    /** Explicit list max-height in px; defaults to size × 42 (the row height). */
    maxHeight?: number;
    /** Search input above the list — 400ms debounce into the `search` wire param. */
    enableSearch?: boolean;
    searchPlaceholder?: string;
    /**
     * Extra wire params merged into every fetch — a dict, or a callback
     * re-evaluated per render (each fetch uses its freshest result; a changed
     * result is a new query key and refetches). Overrides the built-in
     * `size: 50` page size; `group` (requiresActiveGroup) and `search` win
     * over it.
     */
    defaultParams?: Params | (() => Params | null | undefined);
    /**
     * Fold the active group in as the `group` wire param. Without an active
     * group the fetch is HELD (never an unscoped list where a scoped one was
     * demanded) and the empty state shows.
     */
    requiresActiveGroup?: boolean;
    /** Ids hidden from the list client-side (the "already added" pattern —
     *  the documented exception to the no-client-filtering rule). */
    ignoreIds?: Array<string | number>;
    /** Custom row content in place of the label span; the checkbox stays. */
    renderItem?: (row: T) => ReactNode;
    /** Per-row disabled: unclickable, skipped by SELECT and range selection. */
    isRowDisabled?: (row: T) => boolean;
    /** The SELECT (n) / DESELECT (n) header row. Default true. */
    showSelectAll?: boolean;
    label?: string;
    required?: boolean;
    help?: string;
    error?: string;
    /** Disable the whole control: search, buttons and every row. */
    disabled?: boolean;
}

export function CollectionMultiSelect<T extends { id: number | string }>({
    model, endpoint, value, onChange,
    labelField = 'name', valueField = 'id',
    size = 8, maxHeight,
    enableSearch = false, searchPlaceholder = 'Search…',
    defaultParams, requiresActiveGroup = false, ignoreIds,
    renderItem, isRowDisabled, showSelectAll = true,
    label, required = false, help, error, disabled = false,
}: CollectionMultiSelectProps<T>) {
    const resolvedEndpoint = model?.endpoint ?? endpoint;
    if (!resolvedEndpoint) throw new Error('CollectionMultiSelect: pass `model` or `endpoint`');

    // ── Search: live input → 400ms debounce → the `search` wire param ──
    // (the source's SearchView debounce, verbatim 400ms — deliberately NOT
    // ModelTable's 300; a picker races the user's next keystroke less.)
    const [input, setInput] = useState('');
    const [term, setTerm] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setTerm(input.trim()), 400);
        return () => clearTimeout(t);
    }, [input]);

    // ── Active group (requiresActiveGroup) ──────────────────────────────
    // Read the context nullable-safely: consumers without a GroupProvider
    // only misconfigure when they ASK for group scoping.
    const groupCtx = useContext(GroupContext);
    const activeGroupId = groupCtx?.group?.id ?? null;
    const waitingForGroup = requiresActiveGroup && activeGroupId == null;
    useEffect(() => {
        if (requiresActiveGroup && groupCtx === null) {
            console.warn('CollectionMultiSelect: requiresActiveGroup is set but there is no <GroupProvider> above — the fetch stays held');
        }
    }, [requiresActiveGroup, groupCtx]);

    // ── The fetch — SHARED cache keys ([endpoint, params], useModelList) ──
    // defaultParams may be a callback: evaluated every render, so each fetch
    // carries its freshest result (the source evaluated it once at setup).
    const extra = typeof defaultParams === 'function' ? (defaultParams() ?? {}) : (defaultParams ?? {});
    const wire: Params = {
        size: 50, // page size on the WIRE (overridable via defaultParams) — not the visible-rows prop
        ...extra,
        ...(requiresActiveGroup && activeGroupId != null ? { group: activeGroupId } : {}),
        ...(enableSearch && term ? { search: term } : {}),
    };
    const query = useModelList<T>(resolvedEndpoint, wire, { enabled: !waitingForGroup });
    const rows = query.data?.rows;

    // ignoreIds by content, not identity — an inline array literal must not
    // reset the shift anchor (or churn anything) on every render.
    const ignoreSig = JSON.stringify((ignoreIds ?? []).map(keyOf));
    const ignoreKeys = useMemo(
        () => new Set(JSON.parse(ignoreSig) as string[]),
        [ignoreSig],
    );

    const items = useMemo<Item<T>[]>(() => {
        const out: Item<T>[] = [];
        for (const row of rows ?? []) {
            const rawId = getPath(row, valueField);
            if (rawId == null) {
                warnFieldOnce(resolvedEndpoint, 'valueField', valueField, 'is missing on a row — row dropped');
                continue;
            }
            const id: string | number = typeof rawId === 'number' || typeof rawId === 'string' ? rawId : String(rawId);
            const key = keyOf(id);
            if (ignoreKeys.has(key)) continue; // client-side ignoreIds filter
            const rawLabel = getPath(row, labelField);
            if (rawLabel == null) {
                warnFieldOnce(resolvedEndpoint, 'labelField', labelField, 'is missing on a row — showing the id');
            }
            out.push({
                key,
                id,
                label: rawLabel == null ? String(id) : String(rawLabel),
                disabled: disabled || (isRowDisabled?.(row) ?? false),
                row,
            });
        }
        return out;
    }, [rows, ignoreKeys, valueField, labelField, disabled, isRowDisabled, resolvedEndpoint]);

    // Selection is an ID SET over the controlled value — never row references,
    // so it survives searches and refetches by construction.
    const selectedKeys = useMemo(() => new Set(value.map(keyOf)), [value]);

    // ── Shift-click anchor: the last clicked row index ──────────────────
    // Reset when the row set itself changes (new data, ignoreIds change) —
    // indices into the old array are meaningless in the new one. Selection
    // changes deliberately do NOT reset it (click, then shift-click works).
    const anchorRef = useRef(-1);
    useEffect(() => {
        anchorRef.current = -1;
    }, [rows, ignoreSig]);

    const toggleRow = (index: number, shiftKey: boolean) => {
        const item = items[index];
        if (!item || item.disabled) return;
        const anchor = anchorRef.current;
        if (shiftKey && anchor >= 0 && anchor < items.length && anchor !== index) {
            // Range toggle: the CLICKED row's new state applies across the
            // whole span; disabled rows are skipped.
            const nextSelect = !selectedKeys.has(item.key);
            const start = Math.min(anchor, index);
            const end = Math.max(anchor, index);
            if (nextSelect) {
                const have = new Set(selectedKeys);
                const additions: Array<string | number> = [];
                for (let i = start; i <= end; i++) {
                    const it = items[i]!;
                    if (it.disabled || have.has(it.key)) continue;
                    have.add(it.key);
                    additions.push(it.id);
                }
                if (additions.length > 0) onChange([...value, ...additions]);
            } else {
                const drop = new Set<string>();
                for (let i = start; i <= end; i++) {
                    const it = items[i]!;
                    if (!it.disabled) drop.add(it.key);
                }
                const next = value.filter((v) => !drop.has(keyOf(v)));
                if (next.length !== value.length) onChange(next);
            }
        } else if (selectedKeys.has(item.key)) {
            onChange(value.filter((v) => keyOf(v) !== item.key));
        } else {
            onChange([...value, item.id]);
        }
        anchorRef.current = index;
    };

    // ── SELECT / DESELECT counts (live, disabled at their limits) ───────
    // SELECT counts what it would add: visible rows that are enabled and not
    // yet selected. DESELECT counts (and clears) the WHOLE value — including
    // ids picked under an earlier search that aren't on screen right now.
    const selectableCount = items.reduce((n, it) => n + (!it.disabled && !selectedKeys.has(it.key) ? 1 : 0), 0);
    const selectedCount = value.length;

    const selectAllVisible = () => {
        const additions = items.filter((it) => !it.disabled && !selectedKeys.has(it.key)).map((it) => it.id);
        if (additions.length > 0) onChange([...value, ...additions]);
    };
    const deselectAll = () => {
        if (value.length > 0) onChange([]);
    };

    // Skeleton whenever THIS key's rows aren't on screen yet (cold load or a
    // search/params change still serving the previous key via placeholder) —
    // the ModelTable pattern. Background refetches of the same key keep the
    // live rows.
    const pendingView = !waitingForGroup && (query.isPending || query.isPlaceholderData);
    const listMaxHeight = maxHeight ?? size * 42;

    return (
        <div className={`collection-multiselect${disabled ? ' collection-multiselect-disabled' : ''}`}>
            {label && (
                <div className="field-label">
                    {label}
                    {required && <em> *</em>}
                </div>
            )}

            {enableSearch && (
                <div className="search-box collection-multiselect-search">
                    <i className="bi bi-search" />
                    <input
                        type="search"
                        value={input}
                        placeholder={searchPlaceholder}
                        disabled={disabled}
                        onChange={(e) => setInput(e.target.value)}
                        aria-label={label ? `Search ${label}` : 'Search'}
                    />
                </div>
            )}

            {showSelectAll && !pendingView && items.length > 0 && (
                <div className="collection-multiselect-actions">
                    <button
                        type="button"
                        className="collection-multiselect-action"
                        disabled={disabled || selectableCount === 0}
                        onClick={selectAllVisible}
                    >
                        <i className="bi bi-check-square" />
                        SELECT{selectableCount > 0 && ` (${selectableCount})`}
                    </button>
                    <button
                        type="button"
                        className="collection-multiselect-action"
                        disabled={disabled || selectedCount === 0}
                        onClick={deselectAll}
                    >
                        DESELECT{selectedCount > 0 && ` (${selectedCount})`}
                        <i className="bi bi-square" />
                    </button>
                </div>
            )}

            {pendingView ? (
                <div className="collection-multiselect-list" style={{ maxHeight: listMaxHeight }} aria-hidden="true">
                    {Array.from({ length: Math.min(size, 8) }).map((_, i) => (
                        <div key={i} className="collection-multiselect-skel">
                            <span className="skel collection-multiselect-skel-check" />
                            <span className={`skel ${i % 2 === 0 ? 'skel-w-60' : 'skel-w-40'}`} />
                        </div>
                    ))}
                </div>
            ) : query.isError ? (
                <div className="collection-multiselect-empty collection-multiselect-error" role="alert">
                    <i className="bi bi-exclamation-triangle" />
                    <div>{query.error instanceof Error ? query.error.message : 'Request failed'}</div>
                    <button type="button" className="btn btn-compact" onClick={() => void query.refetch()}>
                        Retry
                    </button>
                </div>
            ) : items.length === 0 ? (
                <div className="collection-multiselect-empty">
                    <i className="bi bi-inbox" />
                    <div>No items available</div>
                </div>
            ) : (
                <div
                    className="collection-multiselect-list"
                    style={{ maxHeight: listMaxHeight }}
                    role="group"
                    aria-label={label}
                >
                    {items.map((item, index) => {
                        const checked = selectedKeys.has(item.key);
                        return (
                            <div
                                key={item.key}
                                role="checkbox"
                                aria-checked={checked}
                                aria-disabled={item.disabled || undefined}
                                tabIndex={item.disabled ? -1 : 0}
                                className={[
                                    'collection-multiselect-item',
                                    checked ? 'is-selected' : '',
                                    item.disabled ? 'is-disabled' : '',
                                ].filter(Boolean).join(' ')}
                                onClick={(e) => toggleRow(index, e.shiftKey)}
                                onKeyDown={(e) => {
                                    if (e.key === ' ' || e.key === 'Enter') {
                                        e.preventDefault();
                                        toggleRow(index, e.shiftKey);
                                    }
                                }}
                            >
                                {/* Purely visual — pointer-events:none in CSS, so every
                                    interaction (incl. shiftKey) lands on the row; the
                                    display can never diverge from the controlled state. */}
                                <input type="checkbox" className="tbl-check" checked={checked} disabled={item.disabled} tabIndex={-1} aria-hidden="true" readOnly />
                                {renderItem
                                    ? <span className="collection-multiselect-item-body">{renderItem(item.row)}</span>
                                    : <span className="collection-multiselect-item-label">{item.label}</span>}
                            </div>
                        );
                    })}
                </div>
            )}

            {error ? (
                <div className="field-error">{error}</div>
            ) : help ? (
                <div className="field-help">{help}</div>
            ) : null}
        </div>
    );
}
