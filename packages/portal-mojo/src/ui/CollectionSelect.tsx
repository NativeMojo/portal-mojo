// CollectionSelect — the single-record server picker: search-as-you-type
// against any model/endpoint, pick one row, and hydrate a bare stored id
// into its display label. Ported from web-mojo
// src/core/forms/inputs/CollectionSelect.js (669 lines: CollectionSelectView
// + CollectionDropdownView) into the one-cache world: list data flows through
// useModelList's query keys ([endpoint, params]) and id→label hydration
// through the generic one-record key ([endpoint, 'one', id]), so this picker,
// ModelTable, DetailView and every model hook share one cache and one
// invalidation root — never a parallel fetch path (the #1275 epic contract).
// Sibling of CollectionMultiSelect (shared prop contract: model/endpoint,
// labelField/valueField, defaultParams, requiresActiveGroup).
//
// Deliberate departures from the source, all bug-class kills:
//   · The value is CONTROLLED (`value` + `onChange`) — no hidden input, no
//     setValue/setFormValue imperative surface. The input can never display
//     text the committed value + draft state don't hold (rule 4): closing
//     by outside click or Escape DROPS the in-progress search text and the
//     display reverts to the committed label (the source left typed text in
//     the DOM input while its hidden value said "no selection").
//   · web-mojo's '0' no-selection sentinel stops at this boundary: 0/'0'
//     coming IN normalize to "no selection", and the empty value going OUT
//     is null — '0' never reaches the API or the parent.
//   · Typing that diverges from the committed label clears the selection
//     exactly once (onChange(null)) — the source re-emitted the clear on
//     every subsequent keystroke (searchValue !== '' ≠ selectedLabel='').
//   · Ids compare NORMALIZED (String()) everywhere; numeric-string ids
//     hydrate under the NUMERIC one-record key so DetailView/useOne share
//     the cached record (django-mojo pks are ints; uuid/slug ids pass
//     through untouched).
//   · Re-selecting the already-committed row does not re-fire onChange
//     (commit fires only when the value actually changes — ComboBox idiom).
//   · The dropdown mounts in the shared <Popover> (top layer) instead of an
//     absolutely-positioned div, so the picker works inside native-<dialog>
//     modals and never clips in overflow containers.
//   · "Start typing to search…" is actually reachable — in the source it
//     was dead code (its showNoResults guard required hasSearched).
import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useModel, useModelList } from '../client/hooks';
import type { ModelDef } from '../client/model';
import type { Params } from '../client/types';
import { GroupContext } from '../client/group-context';
import { Popover } from './Popover';

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
    console.warn(`CollectionSelect: ${kind} "${field}" ${note} (endpoint ${endpoint})`);
}

/** django-mojo pks are ints — a numeric-string id fetches under the NUMBER
 *  one-record key ([endpoint,'one',42]) so DetailView/useOne share the cache.
 *  Non-numeric ids (uuid, slug) pass through unchanged. */
const coerceFetchId = (id: string | number): string | number =>
    typeof id === 'string' && /^[1-9]\d*$/.test(id) ? Number(id) : id;

/** "Label known already?" — scan every cached LIST under this endpoint's
 *  root for the row (ModelTable pages, other pickers, this picker's own
 *  fetches all share the [endpoint, params] keys). Non-reactive by design:
 *  a miss falls through to the reactive one-record fetch. */
function findRowInListCaches(qc: QueryClient, endpoint: string, key: string, valueField: string): unknown {
    for (const [, data] of qc.getQueriesData<unknown>({ queryKey: [endpoint] })) {
        if (data == null || typeof data !== 'object') continue;
        const rows = (data as { rows?: unknown }).rows;
        if (!Array.isArray(rows)) continue; // skips [endpoint,'one',id] entries
        for (const row of rows) {
            const raw = getPath(row, valueField);
            if (raw != null && String(raw) === key) return row;
        }
    }
    return undefined;
}

interface Item<T> {
    /** Normalized identity — the one string every comparison uses. */
    key: string;
    /** The row's raw id, emitted through onChange when the row is picked. */
    id: string | number;
    label: string;
    row: T;
}

/**
 * The controlled value: an id, null for "no selection", or a full row-like
 * OBJECT (web-mojo setFormValue heritage — a saved record with the relation
 * expanded) from which id + label extract via the valueField/labelField dot
 * paths. 0 and '0' (web-mojo's no-selection sentinel) normalize to null.
 */
export type CollectionSelectValue = string | number | Record<string, unknown> | null;

export interface CollectionSelectProps<T extends { id: number | string }> {
    /** A defineModel definition — supplies the endpoint (and the row type). */
    model?: ModelDef<T>;
    /** Bare endpoint, for lists without a model definition. */
    endpoint?: string;
    /** Selected id — CONTROLLED. Accepts id | null | row-object (see CollectionSelectValue). */
    value: CollectionSelectValue;
    /**
     * Fires on COMMIT only: picking a row → (id, row); clearing (✕, or typing
     * away from the committed label) → (null). Never per keystroke; never '0'.
     */
    onChange: (id: string | number | null, row?: T) => void;
    /** Row field shown as the label; dot notation reaches nested fields. Default 'name'. */
    labelField?: string;
    /** Row field used as the id; dot notation reaches nested fields. Default 'id'. */
    valueField?: string;
    /** Rows fetched per search — the `size` wire param. Default 10. */
    maxItems?: number;
    placeholder?: string;
    /** Debounce from keystroke to the `search` wire param. Default 400ms. */
    debounceMs?: number;
    /**
     * Fetch the initial (unsearched) page when the dropdown opens, so options
     * exist before typing. Default true; false = "Start typing to search…".
     */
    emptyFetch?: boolean;
    /**
     * Extra wire params merged into every fetch — a dict, or a callback
     * re-evaluated per render (each fetch uses its freshest result; a changed
     * result is a new query key and refetches). Overrides the built-in
     * `size`; `group` (requiresActiveGroup) and `search` win over it.
     */
    defaultParams?: Params | (() => Params | null | undefined);
    /**
     * Fold the active group in as the `group` wire param. Without an active
     * group the fetch is HELD (never an unscoped list where a scoped one was
     * demanded — the sibling's decision) and the dropdown says so.
     */
    requiresActiveGroup?: boolean;
    label?: string;
    required?: boolean;
    help?: string;
    /** Error text below the field (replaces help); the input gets invalid styling. */
    error?: string;
    disabled?: boolean;
    /** Display-only: the committed label shows, but no opening/typing/clearing. */
    readOnly?: boolean;
}

export function CollectionSelect<T extends { id: number | string }>({
    model, endpoint, value, onChange,
    labelField = 'name', valueField = 'id',
    maxItems = 10, placeholder = 'Search…', debounceMs = 400,
    emptyFetch = true, defaultParams, requiresActiveGroup = false,
    label, required = false, help, error,
    disabled = false, readOnly = false,
}: CollectionSelectProps<T>) {
    const resolvedEndpoint = model?.endpoint ?? endpoint;
    if (!resolvedEndpoint) throw new Error('CollectionSelect: pass `model` or `endpoint`');

    const qc = useQueryClient();
    const uid = useId();
    const inputDomId = `colsel-input-${uid}`;
    const listboxId = `colsel-list-${uid}`;
    const optionId = (i: number) => `colsel-opt-${uid}-${i}`;

    const wrapRef = useRef<HTMLDivElement>(null); // the Popover anchor: input + clear
    const inputRef = useRef<HTMLInputElement>(null);
    const popRef = useRef<HTMLDivElement>(null); // dropdown content (blur containment)
    /** Label learned at selection time — keeps the display stable even after
     *  the list cache that held the row is garbage-collected. */
    const lastPickedRef = useRef<{ key: string; label: string } | null>(null);
    const warnedIdsRef = useRef<Set<string>>(new Set());

    // ── The controlled value, normalized ────────────────────────────────
    // 0/'0'/'' → no selection (the web-mojo sentinel ends here); an object
    // value carries its own id + label via the dot paths.
    let selId: string | number | null = null;
    let seedLabel: string | null = null;
    if (value != null && value !== 0 && value !== '0' && value !== '') {
        if (typeof value === 'object') {
            const rawId = getPath(value, valueField);
            if (rawId == null || rawId === 0 || rawId === '0') {
                warnFieldOnce(resolvedEndpoint, 'valueField', valueField, 'is missing on the object value — treating it as no selection');
            } else {
                selId = typeof rawId === 'number' || typeof rawId === 'string' ? rawId : String(rawId);
                const rawLabel = getPath(value, labelField);
                seedLabel = rawLabel == null ? null : String(rawLabel);
            }
        } else {
            selId = value;
        }
    }
    const selKey = selId == null ? null : keyOf(selId);

    // ── Draft: the ONE value pipeline ───────────────────────────────────
    // null = not searching → the input displays the committed label; a string
    // = the in-progress search text. Committing/reverting nulls the draft.
    const [draft, setDraft] = useState<string | null>(null);
    const [term, setTerm] = useState('');
    const [open, setOpen] = useState(false);
    const [focusIdx, setFocusIdx] = useState(-1);
    useEffect(() => {
        const next = (draft ?? '').trim();
        const t = setTimeout(() => setTerm(next), debounceMs);
        return () => clearTimeout(t);
    }, [draft, debounceMs]);

    // ── Active group (requiresActiveGroup) ──────────────────────────────
    // Read the context nullable-safely: consumers without a GroupProvider
    // only misconfigure when they ASK for group scoping.
    const groupCtx = useContext(GroupContext);
    const activeGroupId = groupCtx?.group?.id ?? null;
    const waitingForGroup = requiresActiveGroup && activeGroupId == null;
    useEffect(() => {
        if (requiresActiveGroup && groupCtx === null) {
            console.warn('CollectionSelect: requiresActiveGroup is set but there is no <GroupProvider> above — the fetch stays held');
        }
    }, [requiresActiveGroup, groupCtx]);

    // ── The list fetch — SHARED cache keys ([endpoint, params]) ─────────
    // defaultParams may be a callback: evaluated every render, so each fetch
    // carries its freshest result (the source evaluated it once at setup).
    const extra = typeof defaultParams === 'function' ? (defaultParams() ?? {}) : (defaultParams ?? {});
    const wire: Params = {
        size: maxItems,
        ...extra,
        ...(requiresActiveGroup && activeGroupId != null ? { group: activeGroupId } : {}),
        ...(term ? { search: term } : {}), // trimmed; dropped when empty
    };
    // Fetch only while the dropdown is open (the source fetched on focus);
    // with emptyFetch off, additionally only once there is a search term.
    const listEnabled = open && !waitingForGroup && (emptyFetch || term !== '');
    const query = useModelList<T>(resolvedEndpoint, wire, { enabled: listEnabled });
    // A held query (emptyFetch=false with no term, or no active group) must
    // show its empty state — keepPreviousData would otherwise keep serving
    // the previous key's rows through the placeholder.
    const rows = listEnabled ? query.data?.rows : undefined;

    const items = useMemo<Item<T>[]>(() => {
        const out: Item<T>[] = [];
        for (const row of rows ?? []) {
            const rawId = getPath(row, valueField);
            if (rawId == null) {
                warnFieldOnce(resolvedEndpoint, 'valueField', valueField, 'is missing on a row — row dropped');
                continue;
            }
            const id: string | number = typeof rawId === 'number' || typeof rawId === 'string' ? rawId : String(rawId);
            const rawLabel = getPath(row, labelField);
            if (rawLabel == null) {
                warnFieldOnce(resolvedEndpoint, 'labelField', labelField, 'is missing on a row — showing the id');
            }
            out.push({ key: keyOf(id), id, label: rawLabel == null ? String(id) : String(rawLabel), row });
        }
        return out;
    }, [rows, valueField, labelField, resolvedEndpoint]);

    // A new row set invalidates the walk position (source parity: reset on
    // input; stronger here — stale indices into replaced data are meaningless).
    useEffect(() => { setFocusIdx(-1); }, [rows]);

    // ── id → label hydration ────────────────────────────────────────────
    // Resolution order: object-value label → label learned at pick time →
    // any cached LIST row → fetch the one record through the generic
    // [endpoint,'one',id] key (shared with DetailView/useOne — one cache).
    const picked = lastPickedRef.current;
    const pickedLabel = selKey != null && picked?.key === selKey ? picked.label : null;
    let scanLabel: string | null = null;
    if (selKey != null && seedLabel == null && pickedLabel == null) {
        const row = findRowInListCaches(qc, resolvedEndpoint, selKey, valueField);
        if (row != null) {
            const raw = getPath(row, labelField);
            // A row without the label field stays unresolved — the one-record
            // graph can carry fields the list graph omits.
            if (raw != null) scanLabel = String(raw);
        }
    }
    const needFetch = selKey != null && seedLabel == null && pickedLabel == null && scanLabel == null;
    const oneQuery = useModel<T>(resolvedEndpoint, needFetch && selId != null ? coerceFetchId(selId) : null);
    let oneLabel: string | null = null;
    if (needFetch && oneQuery.data != null) {
        const raw = getPath(oneQuery.data, labelField);
        if (raw == null) {
            warnFieldOnce(resolvedEndpoint, 'labelField', labelField, 'is missing on the fetched record — showing the id');
        } else {
            oneLabel = String(raw);
        }
    }
    useEffect(() => {
        if (!oneQuery.isError || selKey == null) return;
        if (warnedIdsRef.current.has(selKey)) return;
        warnedIdsRef.current.add(selKey);
        console.warn(`CollectionSelect: could not hydrate ${resolvedEndpoint} id ${selKey} — displaying "#${selKey}"`, oneQuery.error);
    }, [oneQuery.isError, oneQuery.error, selKey, resolvedEndpoint]);

    const selLabel = seedLabel ?? pickedLabel ?? scanLabel ?? oneLabel;
    // Interim "#<id>" while the label resolves (or when it never can).
    const committedText = selKey != null ? (selLabel ?? `#${selKey}`) : '';
    const displayText = draft ?? committedText;

    // ── Commit / revert (the only paths that touch the pipeline) ────────
    const canOpen = !disabled && !readOnly;
    const openList = () => { if (canOpen) setOpen(true); };
    /** Close + drop the draft — the display reverts to the committed label. */
    const closeAndRevert = () => {
        setOpen(false);
        setDraft(null);
        setTerm('');
        setFocusIdx(-1);
    };
    const selectItem = (item: Item<T>) => {
        lastPickedRef.current = { key: item.key, label: item.label };
        closeAndRevert();
        if (item.key !== selKey) onChange(item.id, item.row);
    };
    const clearSelection = () => {
        lastPickedRef.current = null;
        setDraft(null);
        setTerm('');
        setFocusIdx(-1);
        // Clear refocuses AND reopens on the base page — the source's
        // clear-then-refocus behavior, made deterministic (the ✕ renders
        // only while canOpen, so opening here is always legal).
        setOpen(true);
        if (selKey != null) onChange(null);
        inputRef.current?.focus();
    };

    const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const text = e.target.value;
        setDraft(text);
        setFocusIdx(-1);
        if (canOpen) setOpen(true);
        // Typing that diverges from the committed label IS the clear commit
        // (source semantics) — fired once; the parent's null comes back as
        // selKey null, so further keystrokes are draft-only.
        if (selKey != null && text !== committedText) onChange(null);
    };

    const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
        const next = e.relatedTarget as Node | null;
        if (next && (wrapRef.current?.contains(next) || popRef.current?.contains(next))) return;
        closeAndRevert(); // Tab-away settles like outside click
    };

    // While open, Escape is owned by the Popover (capture phase; first Escape
    // closes only the dropdown even inside a modal) → onClose('escape') →
    // closeAndRevert. Keyboard here covers the walk + commit.
    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        switch (e.key) {
            case 'ArrowDown':
                if (!canOpen) break;
                e.preventDefault();
                if (!open) setOpen(true);
                else setFocusIdx((i) => Math.min(i + 1, items.length - 1)); // clamp, no wrap (source)
                break;
            case 'ArrowUp':
                if (!open) break;
                e.preventDefault();
                setFocusIdx((i) => Math.max(i - 1, 0));
                break;
            case 'Enter': {
                if (!open) break;
                e.preventDefault(); // never submit an enclosing form while picking
                const it = focusIdx >= 0 ? items[focusIdx] : undefined;
                if (it) selectItem(it);
                break;
            }
        }
    };

    // Keep the keyboard-focused option in view.
    useEffect(() => {
        if (focusIdx < 0) return;
        document.getElementById(`colsel-opt-${uid}-${focusIdx}`)?.scrollIntoView({ block: 'nearest' });
    }, [focusIdx, uid]);

    // The dropdown matches the field's width (source: w-100) — measured, since
    // the Popover shell is width:max-content in the top layer.
    const [menuWidth, setMenuWidth] = useState<number | undefined>(undefined);
    useLayoutEffect(() => {
        if (!open) return;
        const el = wrapRef.current;
        if (!el) return;
        const sync = () => setMenuWidth(el.offsetWidth);
        sync();
        const ro = new ResizeObserver(sync);
        ro.observe(el);
        return () => ro.disconnect();
    }, [open]);

    // Spinner whenever the CURRENT key's rows aren't on screen yet (cold load
    // or a search/params change still holding the previous key's data).
    const pendingView = listEnabled && (query.isPending || query.isPlaceholderData);
    const showClear = selKey != null && !disabled && !readOnly;

    return (
        <div className={`collection-select${disabled ? ' collection-select-disabled' : ''}`}>
            {label && (
                <label className="field-label" htmlFor={inputDomId}>
                    {label}
                    {required && <em> *</em>}
                </label>
            )}

            <div ref={wrapRef} className={`collection-select-field${showClear ? ' has-clear' : ''}`}>
                <input
                    ref={inputRef}
                    id={inputDomId}
                    type="text"
                    className={`input collection-select-input${error ? ' input-invalid' : ''}`}
                    role="combobox"
                    aria-expanded={open}
                    aria-autocomplete="list"
                    aria-controls={listboxId}
                    aria-activedescendant={open && focusIdx >= 0 ? optionId(focusIdx) : undefined}
                    aria-invalid={error ? true : undefined}
                    autoComplete="off"
                    placeholder={placeholder}
                    value={displayText}
                    disabled={disabled}
                    readOnly={readOnly}
                    required={required}
                    onFocus={openList}
                    onClick={openList}
                    onBlur={onBlur}
                    onChange={onInput}
                    onKeyDown={onKeyDown}
                />
                {showClear && (
                    <button
                        type="button"
                        className="collection-select-clear"
                        aria-label="Clear selection"
                        title="Clear selection"
                        onMouseDown={(e) => e.preventDefault() /* keep input focus */}
                        onClick={clearSelection}
                    >
                        <i className="bi bi-x-circle" aria-hidden="true" />
                    </button>
                )}
            </div>

            <Popover anchorRef={wrapRef} open={open} onClose={closeAndRevert} role="presentation">
                <div
                    ref={popRef}
                    id={listboxId}
                    role="listbox"
                    aria-label={label ?? 'Options'}
                    className="collection-select-pop"
                    style={{ width: menuWidth }}
                >
                    {waitingForGroup ? (
                        <div className="collection-select-state">
                            <i className="bi bi-people" aria-hidden="true" />
                            Select an active group first
                        </div>
                    ) : query.isError ? (
                        // Error beats spinner: a failed fetch must be unmissable,
                        // never masked by placeholder-data edge states.
                        <div className="collection-select-state collection-select-state-error" role="alert">
                            <i className="bi bi-exclamation-triangle" aria-hidden="true" />
                            <span>{query.error instanceof Error ? query.error.message : 'Request failed'}</span>
                            <button type="button" className="btn btn-compact" onMouseDown={(e) => e.preventDefault()} onClick={() => void query.refetch()}>
                                Retry
                            </button>
                        </div>
                    ) : pendingView ? (
                        <div className="collection-select-state" aria-live="polite">
                            <i className="bi bi-arrow-repeat spin" aria-hidden="true" />
                            Loading…
                        </div>
                    ) : items.length === 0 ? (
                        <div className="collection-select-state">
                            <i className={`bi ${term ? 'bi-inbox' : 'bi-search'}`} aria-hidden="true" />
                            {term ? 'No results found' : 'Start typing to search…'}
                        </div>
                    ) : (
                        items.map((item, i) => {
                            const isSelected = item.key === selKey;
                            return (
                                <button
                                    type="button"
                                    key={item.key}
                                    id={optionId(i)}
                                    role="option"
                                    aria-selected={isSelected}
                                    tabIndex={-1}
                                    className={`collection-select-option${i === focusIdx ? ' is-focused' : ''}${isSelected ? ' is-selected' : ''}`}
                                    onMouseDown={(e) => e.preventDefault() /* option click must not blur the input */}
                                    onClick={() => selectItem(item)}
                                >
                                    <span className="collection-select-option-label">{item.label}</span>
                                    {isSelected && <i className="bi bi-check collection-select-check" aria-hidden="true" />}
                                </button>
                            );
                        })
                    )}
                </div>
            </Popover>

            {error ? (
                <div className="field-error">{error}</div>
            ) : help ? (
                <div className="field-help">{help}</div>
            ) : null}
        </div>
    );
}
