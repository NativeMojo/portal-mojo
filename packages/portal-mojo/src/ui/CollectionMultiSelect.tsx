// CollectionMultiSelect — the server-backed multi-pick: live model data as a
// checkbox list with search on top, SELECT/DESELECT-all with counts, and
// shift-click range selection. Ported from web-mojo
// src/core/forms/inputs/CollectionMultiSelect.js (588 lines: SearchView +
// ListItemsView + CollectionMultiSelectView) into the one-cache world: data
// flows through useModelList's query keys ([endpoint, params]), so pickers,
// tables and model hooks share one cache and one invalidation root — never a
// parallel fetch path (the #1275 epic contract).
//
// PRESENTATION: the DEFAULT is a dropdown — a summary trigger + <Popover>
// menu sharing MultiSelectDropdown's shell (one trigger voice for both
// multi-picks; the menu stays open while ticking, Done closes). The source
// (and its FormBuilder mount) rendered an always-visible panel, which eats
// half a form column; `variant="panel"` keeps that box for settings-page /
// always-on contexts. Search defaults ON in the dropdown (a server-backed
// dropdown without search is a page-one-only picker) and OFF in the panel
// (source parity).
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
import {
    useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
    type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react';
import { useModelList } from '../client/hooks';
import type { ModelDef } from '../client/model';
import type { Params } from '../client/types';
import { GroupContext } from '../client/group-context';
import { Popover, type PopoverPlacement } from './Popover';

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
    /**
     * 'dropdown' (default): summary trigger + Popover menu — the form-embedded
     * presentation. 'panel': the always-visible box (the source's shape) for
     * settings-page / always-on contexts.
     */
    variant?: 'dropdown' | 'panel';
    /** Trigger text while nothing is selected (dropdown). Default 'Select...'. */
    placeholder?: string;
    /** Summarize the trigger with row labels when all picks have been seen
     *  (else always "N selected"). Default true. */
    showSelectedLabels?: boolean;
    /** Above this many picks the trigger shows "N selected". Default 3. */
    maxLabelsToShow?: number;
    /** Menu placement against the trigger (dropdown). Default 'bottom-start'. */
    placement?: PopoverPlacement;
    /** Row field shown as the label; dot notation reaches nested fields. Default 'name'. */
    labelField?: string;
    /** Row field used as the id; dot notation reaches nested fields. Default 'id'. */
    valueField?: string;
    /** VISIBLE rows before the list scrolls (not the fetch size). Default 8. */
    size?: number;
    /** Explicit list max-height in px; defaults to size × 42 (the row height). */
    maxHeight?: number;
    /** Search input above the list — 400ms debounce into the `search` wire
     *  param. Defaults ON in the dropdown variant, OFF in the panel. */
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
    /** Disable the whole control: trigger, search, buttons and every row. */
    disabled?: boolean;
    /** id for the trigger button (the label points at it). */
    id?: string;
}

export function CollectionMultiSelect<T extends { id: number | string }>({
    model, endpoint, value, onChange,
    variant = 'dropdown',
    placeholder = 'Select...',
    showSelectedLabels = true, maxLabelsToShow = 3,
    placement = 'bottom-start',
    labelField = 'name', valueField = 'id',
    size = 8, maxHeight,
    enableSearch, searchPlaceholder = 'Search…',
    defaultParams, requiresActiveGroup = false, ignoreIds,
    renderItem, isRowDisabled, showSelectAll = true,
    label, required = false, help, error, disabled = false,
    id,
}: CollectionMultiSelectProps<T>) {
    const resolvedEndpoint = model?.endpoint ?? endpoint;
    if (!resolvedEndpoint) throw new Error('CollectionMultiSelect: pass `model` or `endpoint`');

    const searchOn = enableSearch ?? (variant === 'dropdown');

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
        ...(searchOn && term ? { search: term } : {}),
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

    // ── Trigger summary labels ──────────────────────────────────────────
    // Labels accumulate from every row this control has SEEN (across searches
    // and refetches) — a pick made under an old term keeps its label. An id
    // never seen (hydrated initial value) is NOT an error — the summary just
    // says "N selected"; no per-id fetches, no wrong labels, no warn.
    const [labelCache, setLabelCache] = useState<ReadonlyMap<string, string>>(new Map());
    useEffect(() => {
        setLabelCache((prev) => {
            let changed = false;
            const next = new Map(prev);
            for (const it of items) {
                if (next.get(it.key) !== it.label) {
                    next.set(it.key, it.label);
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [items]);

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

    // ── Dropdown shell state (open / width / focus) ─────────────────────
    const triggerRef = useRef<HTMLButtonElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    // Menu width is glued to the trigger (never narrower than 260px — the
    // search + action row needs the room) — set at open time so the popover's
    // FIRST render is already right, then kept in sync while open.
    const [menuWidth, setMenuWidth] = useState<number>();

    const autoId = useId();
    const menuId = `${autoId}-menu`;
    const labelId = `${autoId}-label`;
    const triggerId = id ?? `${autoId}-trigger`;

    const close = useCallback((restoreFocus: boolean) => {
        setOpen(false);
        if (restoreFocus) triggerRef.current?.focus();
    }, []);

    const openMenu = () => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (rect) setMenuWidth(Math.max(rect.width, 260));
        setOpen(true);
    };

    useLayoutEffect(() => {
        if (variant !== 'dropdown' || !open) return;
        const el = triggerRef.current;
        if (!el) return;
        const sync = () => setMenuWidth(Math.max(el.getBoundingClientRect().width, 260));
        sync();
        const ro = new ResizeObserver(sync);
        ro.observe(el);
        return () => ro.disconnect();
    }, [variant, open]);

    const rowEls = () => Array.from(
        bodyRef.current?.querySelectorAll<HTMLElement>('[data-cms-row]:not([aria-disabled="true"])') ?? [],
    );

    // Opening moves focus INTO the menu (it is portaled to the end of <body>,
    // so Tab from the trigger would not reach it): the search input when
    // search is on, else the first enabled row. Focus returns to the trigger
    // on Escape/Done (see close()).
    useEffect(() => {
        if (variant !== 'dropdown' || !open) return;
        if (searchOn) searchRef.current?.focus();
        else rowEls()[0]?.focus();
    }, [variant, open, searchOn]);

    const onRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, index: number) => {
        switch (event.key) {
            case ' ':
            case 'Enter':
                // The SAME toggleRow() a click runs — shiftKey included, so
                // Shift+Space range-selects from the keyboard too.
                event.preventDefault();
                toggleRow(index, event.shiftKey);
                return;
            case 'ArrowDown':
            case 'ArrowUp': {
                event.preventDefault();
                const list = rowEls();
                if (list.length === 0) return;
                const at = list.indexOf(event.currentTarget);
                list[(at + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
                return;
            }
            case 'Home':
            case 'End': {
                event.preventDefault();
                const list = rowEls();
                (event.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
                return;
            }
            default:
        }
    };

    // Skeleton whenever THIS key's rows aren't on screen yet (cold load or a
    // search/params change still serving the previous key via placeholder) —
    // the ModelTable pattern. Background refetches of the same key keep the
    // live rows.
    const pendingView = !waitingForGroup && (query.isPending || query.isPlaceholderData);
    const listMaxHeight = maxHeight ?? size * 42;

    const showActions = showSelectAll && !pendingView && items.length > 0;

    // ── The shared body: search + actions + list/skeleton/empty/error ───
    // Rendered identically inside the panel box and the dropdown menu.
    const body = (
        <div className="collection-multiselect-body" ref={bodyRef}>
            {(searchOn || showActions) && (
                <div className="collection-multiselect-head">
                    {searchOn && (
                        <div className="search-box collection-multiselect-search">
                            <i className="bi bi-search" />
                            <input
                                ref={searchRef}
                                type="search"
                                value={input}
                                placeholder={searchPlaceholder}
                                disabled={disabled}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        rowEls()[0]?.focus();
                                    }
                                }}
                                aria-label={label ? `Search ${label}` : 'Search'}
                            />
                        </div>
                    )}
                    {showActions && (
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
                                data-cms-row=""
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
                                onKeyDown={(e) => onRowKeyDown(e, index)}
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
        </div>
    );

    const foot = error ? (
        <div className="field-error">{error}</div>
    ) : help ? (
        <div className="field-help">{help}</div>
    ) : null;

    if (variant === 'panel') {
        return (
            <div className={`collection-multiselect${disabled ? ' collection-multiselect-disabled' : ''}`}>
                {label && (
                    <div className="field-label">
                        {label}
                        {required && <em> *</em>}
                    </div>
                )}
                {body}
                {foot}
            </div>
        );
    }

    // Trigger summary: placeholder → up to N comma-joined labels (only when
    // EVERY pick's label is known) → "N selected".
    const allLabeled = value.every((v) => labelCache.has(keyOf(v)));
    const triggerText = selectedCount === 0
        ? placeholder
        : showSelectedLabels && selectedCount <= maxLabelsToShow && allLabeled
            ? value.map((v) => labelCache.get(keyOf(v))!).join(', ')
            : `${selectedCount} selected`;

    return (
        <div className={`collection-multiselect collection-multiselect-dropdown${disabled ? ' collection-multiselect-disabled' : ''}`}>
            {label && (
                <div className="field-label" id={labelId}>
                    {label}
                    {required && <em> *</em>}
                </div>
            )}

            <button
                ref={triggerRef}
                type="button"
                id={triggerId}
                className={`multiselect-trigger${open ? ' is-open' : ''}`}
                disabled={disabled}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                // BOTH ids: the field label AND the trigger's own summary, so
                // the accessible name reads "Groups, Ops, Design".
                aria-labelledby={label ? `${labelId} ${triggerId}` : undefined}
                onClick={() => (open ? close(true) : openMenu())}
                onKeyDown={(event) => {
                    if (!open && event.key === 'ArrowDown') {
                        event.preventDefault();
                        openMenu();
                    }
                }}
            >
                <span className={`multiselect-trigger-text${selectedCount === 0 ? ' is-placeholder' : ''}`}>
                    {triggerText}
                </span>
                <i className="bi bi-chevron-down" aria-hidden="true" />
            </button>

            <Popover
                anchorRef={triggerRef}
                open={open}
                placement={placement}
                // Escape always hands focus back; an outside click only does
                // when focus is still parked inside the menu (never fight the
                // element the user just clicked).
                onClose={(reason) => close(
                    reason === 'escape' || bodyRef.current?.contains(document.activeElement) === true,
                )}
                id={menuId}
                aria-label={label ?? 'Options'}
                style={menuWidth === undefined ? undefined : { width: menuWidth }}
            >
                <div className="collection-multiselect-menu">
                    {body}
                    <div className="multiselect-footer">
                        <button
                            type="button"
                            className="btn btn-primary btn-compact multiselect-done"
                            onClick={() => close(true)}
                        >
                            Done
                        </button>
                    </div>
                </div>
            </Popover>

            {foot}
        </div>
    );
}
