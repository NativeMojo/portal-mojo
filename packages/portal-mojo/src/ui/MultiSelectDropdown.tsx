// MultiSelectDropdown — the static-options checkbox dropdown: a trigger that
// summarizes the picks, a menu that STAYS OPEN while you tick rows, and a
// Done button that closes it. Ported from web-mojo
// src/core/forms/inputs/MultiSelectDropdown.js (413 lines: MultiSelectDropdown
// + its MultiSelectItemsView child). Sibling of CollectionMultiSelect — same
// selection contract, but over a static `options` array instead of live model
// data, and folded into a dropdown instead of an always-visible panel.
//
// The entire open/close/positioning stack of the source (Bootstrap's
// `data-bs-toggle="dropdown"` + `data-bs-auto-close="outside"` +
// `bootstrap.Dropdown.getInstance(...).hide()`) is replaced by the shared
// <Popover> primitive: no Bootstrap, no jQuery-era instance lookups, and the
// menu stacks above native-<dialog> modals for free.
//
// Fixed here BY CONSTRUCTION (web-mojo bugs — do not reintroduce):
// - THE BUG: selection had TWO owners. The source tracked picks in a private
//   `item.selected` flag driven only by row-click delegation, then wrote
//   `checkbox.checked` by hand — while the row also contained a real focusable
//   <input type="checkbox"> and a <label for> spanning the row. Any toggle the
//   delegation didn't originate (keyboard Space on the focused checkbox, the
//   label's synthesized click) moved the DOM without moving `item.selected`,
//   or moved it twice. Here there is ONE pipeline: the ROW is the checkbox
//   widget (role="checkbox"), the <input> is display-only
//   (pointer-events:none, readOnly, aria-hidden, tabIndex -1), and its checked
//   state is rendered from the controlled `value`. Space on the focused row
//   and a click anywhere on the row run the identical `toggle()`.
// - Identity never round-trips through DOM attributes. The source read
//   `element.getAttribute('data-value')` — ALWAYS a string — and pushed that
//   into a value array it compared with `includes()` against raw option
//   values, so numeric option values emitted as strings and never matched
//   again. Toggles close over the item; all comparisons pass one keyOf().
// - Scalar coercion is consistent and falsy-safe. The source's constructor
//   dropped a non-array `value` outright and `setValue` coerced with a truthy
//   test, so `0` and `''` were silently discarded. Only null/undefined mean
//   "nothing selected" here.
// - A selected value matching no option falls back to String(value) in the
//   trigger summary WITH a console.warn (unknown-value rule) — the source fell
//   back silently.
import {
    useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
    type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Popover, type PopoverPlacement } from './Popover';

export type MultiSelectValue = string | number;

export interface MultiSelectOption {
    value: MultiSelectValue;
    label?: string;
    /** Legacy label alias the source accepted (`option.text`); `label` wins. */
    text?: string;
    /** Row refuses to toggle — by click AND by keyboard. */
    disabled?: boolean;
}

export interface MultiSelectDropdownProps {
    /** Bare strings normalize to `{ value: s, label: s }`. */
    options: ReadonlyArray<MultiSelectOption | string>;
    /**
     * Selected values — CONTROLLED. A bare scalar coerces to a one-element
     * array; null/undefined mean none. String and number values compare
     * normalized, so mixes work by construction.
     */
    value: ReadonlyArray<MultiSelectValue> | MultiSelectValue | null | undefined;
    /** Every toggle IS a commit — fires with the full next array. */
    onChange: (values: MultiSelectValue[]) => void;
    label?: string;
    required?: boolean;
    help?: string;
    /** Replaces `help` when set. */
    error?: string;
    /** Trigger text while nothing is selected. Default 'Select...'. */
    placeholder?: string;
    /** px before the option list scrolls. Default 300. */
    maxHeight?: number;
    /** Summarize with option labels (else always "N selected"). Default true. */
    showSelectedLabels?: boolean;
    /** Above this many picks the trigger shows "N selected". Default 3. */
    maxLabelsToShow?: number;
    /** Locks the trigger and every row. */
    disabled?: boolean;
    /** Menu placement against the trigger. Default 'bottom-start'. */
    placement?: PopoverPlacement;
    /** id for the trigger button (the label points at it). */
    id?: string;
    className?: string;
}

/** Every value comparison in this component goes through here — string and
 *  number values (and mixes of the two) work by construction. */
const keyOf = (v: MultiSelectValue): string => String(v);

interface Item {
    /** Normalized identity — the one string every comparison uses. */
    key: string;
    /** The option's raw value, emitted through onChange when picked. */
    value: MultiSelectValue;
    label: string;
    disabled: boolean;
}

/** null/undefined → none; a bare scalar → one pick (0 and '' included). */
function toArray(
    value: ReadonlyArray<MultiSelectValue> | MultiSelectValue | null | undefined,
): MultiSelectValue[] {
    if (value == null) return [];
    return Array.isArray(value) ? [...value] : [value as MultiSelectValue];
}

export function MultiSelectDropdown({
    options,
    value,
    onChange,
    label,
    required = false,
    help,
    error,
    placeholder = 'Select...',
    maxHeight = 300,
    showSelectedLabels = true,
    maxLabelsToShow = 3,
    disabled = false,
    placement = 'bottom-start',
    id,
    className,
}: MultiSelectDropdownProps) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    // Menu width is measured from the trigger (the source's `w-100` dropdown
    // menu) — set at open time so the popover's FIRST render is already the
    // right width, then kept in sync while it stays open.
    const [menuWidth, setMenuWidth] = useState<number>();

    const autoId = useId();
    const menuId = `${autoId}-menu`;
    const labelId = `${autoId}-label`;
    const triggerId = id ?? `${autoId}-trigger`;

    const items = useMemo<Item[]>(() => {
        const out: Item[] = [];
        for (const raw of options) {
            if (typeof raw === 'string') {
                out.push({ key: raw, value: raw, label: raw, disabled: false });
                continue;
            }
            if (raw?.value == null) {
                console.warn('MultiSelectDropdown: option without a `value` — dropped', raw);
                continue;
            }
            out.push({
                key: keyOf(raw.value),
                value: raw.value,
                // `label` wins, `text` is the source's alias, else the value.
                label: raw.label || raw.text || String(raw.value),
                disabled: raw.disabled === true,
            });
        }
        return out;
    }, [options]);

    const selected = useMemo(() => toArray(value), [value]);
    const selectedKeys = useMemo(() => new Set(selected.map(keyOf)), [selected]);

    // Trigger summary: placeholder → up to N comma-joined labels → "N selected"
    // (source parity, including the selection-ORDER label list).
    const labelByKey = useMemo(() => {
        const map = new Map<string, string>();
        for (const it of items) map.set(it.key, it.label);
        return map;
    }, [items]);
    const unmatched = useMemo(
        () => selected.filter((v) => !labelByKey.has(keyOf(v))),
        [selected, labelByKey],
    );
    const triggerText = selected.length === 0
        ? placeholder
        : showSelectedLabels && selected.length <= maxLabelsToShow
            // Unknown values fall back to their own String() form (warned below)
            // — never a blank row in the summary.
            ? selected.map((v) => labelByKey.get(keyOf(v)) ?? String(v)).join(', ')
            : `${selected.length} selected`;

    // Warn once per unknown value, out of render (a value with no option is a
    // config/data mismatch, not a paint event).
    const warned = useRef(new Set<string>());
    useEffect(() => {
        for (const v of unmatched) {
            const k = keyOf(v);
            if (warned.current.has(k)) continue;
            warned.current.add(k);
            console.warn(`MultiSelectDropdown: selected value "${k}" matches no option — showing it raw`);
        }
    }, [unmatched]);

    const close = useCallback((restoreFocus: boolean) => {
        setOpen(false);
        if (restoreFocus) triggerRef.current?.focus();
    }, []);

    const openMenu = () => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (rect) setMenuWidth(rect.width);
        setOpen(true);
    };

    // Keep the menu glued to the trigger's width while it is open (a resized
    // window or a reflowing form column must not leave a stale width).
    useLayoutEffect(() => {
        if (!open) return;
        const el = triggerRef.current;
        if (!el) return;
        const sync = () => setMenuWidth(el.getBoundingClientRect().width);
        sync();
        const ro = new ResizeObserver(sync);
        ro.observe(el);
        return () => ro.disconnect();
    }, [open]);

    const rows = () => Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[data-ms-row]:not([aria-disabled="true"])') ?? [],
    );

    // Opening moves focus to the first enabled row: the menu is portaled to
    // the end of <body>, so Tab from the trigger would NOT reach it. Focus
    // returns to the trigger on Escape/Done (see close()). Programmatic focus
    // after a mouse click doesn't paint a ring — the row styles :focus-visible.
    useEffect(() => {
        if (!open) return;
        rows()[0]?.focus();
    }, [open]);

    const toggle = (item: Item) => {
        if (disabled || item.disabled) return;
        if (selectedKeys.has(item.key)) onChange(selected.filter((v) => keyOf(v) !== item.key));
        else onChange([...selected, item.value]);
    };

    const moveFocus = (from: HTMLElement, delta: 1 | -1) => {
        const list = rows();
        if (list.length === 0) return;
        const at = list.indexOf(from);
        list[(at + delta + list.length) % list.length]?.focus();
    };

    const onRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, item: Item) => {
        switch (event.key) {
            case ' ':
            case 'Enter':
                // The SAME toggle() a click runs — the desync fix is that there
                // is nothing else to run.
                event.preventDefault();
                toggle(item);
                return;
            case 'ArrowDown':
            case 'ArrowUp':
                event.preventDefault();
                moveFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
                return;
            case 'Home':
            case 'End': {
                event.preventDefault();
                const list = rows();
                (event.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
                return;
            }
            default:
        }
    };

    return (
        <div className={`multiselect-dropdown${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}>
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
                // the name reads "Status, New, Open" — aria-labelledby with the
                // label alone would drop the summary from the accessible name.
                aria-labelledby={label ? `${labelId} ${triggerId}` : undefined}
                onClick={() => (open ? close(true) : openMenu())}
                onKeyDown={(event) => {
                    if (!open && event.key === 'ArrowDown') {
                        event.preventDefault();
                        openMenu();
                    }
                }}
            >
                <span className={`multiselect-trigger-text${selected.length === 0 ? ' is-placeholder' : ''}`}>
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
                    reason === 'escape' || menuRef.current?.contains(document.activeElement) === true,
                )}
                id={menuId}
                aria-label={label ?? 'Options'}
                style={menuWidth === undefined ? undefined : { width: menuWidth }}
            >
                <div className="multiselect-menu" ref={menuRef}>
                    {items.length === 0 ? (
                        // Source parity: the empty menu has no Done footer.
                        <div className="multiselect-empty">No options available</div>
                    ) : (
                        <>
                            <div
                                className="multiselect-list"
                                style={{ maxHeight }}
                                role="group"
                                aria-label={label}
                            >
                                {items.map((item) => {
                                    const checked = selectedKeys.has(item.key);
                                    const rowDisabled = disabled || item.disabled;
                                    return (
                                        <div
                                            key={item.key}
                                            data-ms-row=""
                                            role="checkbox"
                                            aria-checked={checked}
                                            aria-disabled={rowDisabled || undefined}
                                            tabIndex={rowDisabled ? -1 : 0}
                                            className={[
                                                'multiselect-item',
                                                checked ? 'is-selected' : '',
                                                rowDisabled ? 'is-disabled' : '',
                                            ].filter(Boolean).join(' ')}
                                            onClick={() => toggle(item)}
                                            onKeyDown={(event) => onRowKeyDown(event, item)}
                                        >
                                            {/* Display-only (pointer-events:none in CSS): every
                                                interaction lands on the row, so the box can never
                                                show a state `value` doesn't hold. */}
                                            <input
                                                type="checkbox"
                                                className="tbl-check"
                                                checked={checked}
                                                disabled={rowDisabled}
                                                tabIndex={-1}
                                                aria-hidden="true"
                                                readOnly
                                            />
                                            <span className="multiselect-item-label">{item.label}</span>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="multiselect-footer">
                                <button
                                    type="button"
                                    className="btn btn-primary btn-compact multiselect-done"
                                    onClick={() => close(true)}
                                >
                                    Done
                                </button>
                            </div>
                        </>
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
