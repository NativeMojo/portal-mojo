// ComboBox — the house autocomplete: a text input + suggestion dropdown.
// Port of web-mojo's ComboInput.js (the feature spec: descriptions, meta,
// match highlighting, relevance ranking, ARIA) merged with the one behavior
// ComboBox.js contributed (open on focus). This is the ONE combobox —
// web-mojo shipped two and the form pipeline only ever instantiated the
// poor one, silently dropping the description/meta configs fields passed.
//
// Fixed here BY CONSTRUCTION (web-mojo bugs, do not reintroduce):
// - onChange fires on COMMIT only (selection, Enter-custom, blur-settle) —
//   never per keystroke. The in-progress text is a private draft.
// - allowCustom:false actually reverts: the committed value lives in the
//   `value` prop, the draft is separate state — closing with unmatched text
//   drops the draft and the display falls back to the committed label.
//   (web-mojo overwrote its committed value per keystroke, so its "revert"
//   restored the text just typed.)
// - Option identity never round-trips through DOM attributes — selection
//   passes the option object in a closure, so numeric values survive
//   (web-mojo strict-equalled `data-value` strings against numbers).
// - Popover is the sole outside-click/Escape owner. ComboBox owns only the
//   meaning of each dismissal (settle outside, revert on Escape).
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Popover } from './Popover';

export type ComboValue = string | number;

export interface ComboOption {
    value: ComboValue;
    label: string;
    /** Muted second line in the dropdown (rendered while `showDescription`). */
    description?: string;
    /** Opaque payload handed back through onSelect — rule-builder hook. */
    meta?: Record<string, unknown>;
}

export interface ComboBoxProps {
    /** Committed value. The input DISPLAYS the matching option's label. */
    value?: ComboValue | null;
    /** Bare strings normalize to { value: s, label: s }. */
    options: ReadonlyArray<ComboOption | string>;
    /** Fires on COMMIT only, and only when the value actually changes. */
    onChange?: (value: ComboValue, option?: ComboOption) => void;
    /** Fires whenever a commit resolves to an option — carries meta. */
    onSelect?: (option: ComboOption) => void;
    placeholder?: string;
    /** Typed text not matching an option commits as-is. Default true. */
    allowCustom?: boolean;
    showDescription?: boolean;
    /** Typing auto-opens the list only at this many chars. Default 0. */
    minChars?: number;
    /** Cap on rendered suggestions — and on keyboard wraparound. Default 10. */
    maxSuggestions?: number;
    disabled?: boolean;
    readOnly?: boolean;
    required?: boolean;
    id?: string;
    className?: string;
}

function normalizeOptions(input: ReadonlyArray<ComboOption | string>): ComboOption[] {
    const out: ComboOption[] = [];
    for (const raw of input) {
        if (typeof raw === 'string') {
            out.push({ value: raw, label: raw });
            continue;
        }
        const opt: ComboOption = { value: raw.value, label: raw.label || String(raw.value) };
        if (raw.description) opt.description = raw.description;
        if (raw.meta) opt.meta = raw.meta;
        out.push(opt);
    }
    return out;
}

/** Case-insensitive substring across label + value + description, ranked
    exact-label, then label-startsWith, then input order (stable sort). */
function filterAndRank(options: ComboOption[], query: string): ComboOption[] {
    if (!query) return options.slice();
    const matches = options.filter((o) =>
        o.label.toLowerCase().includes(query) ||
        String(o.value).toLowerCase().includes(query) ||
        (o.description !== undefined && o.description.toLowerCase().includes(query)));
    const rank = (o: ComboOption): number => {
        const label = o.label.toLowerCase();
        if (label === query) return 0;
        if (label.startsWith(query)) return 1;
        return 2;
    };
    return matches.sort((a, b) => rank(a) - rank(b));
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Query-match highlighting as split React nodes — never HTML strings. */
function highlightLabel(label: string, query: string): ReactNode {
    if (!query) return label;
    const parts = label.split(new RegExp(`(${escapeRegex(query)})`, 'ig'));
    if (parts.length === 1) return label;
    return parts.map((part, i) => (i % 2 === 1 ? <mark key={i} className="combo-mark">{part}</mark> : part));
}

export function ComboBox({
    value = null,
    options,
    onChange,
    onSelect,
    placeholder = 'Select or type...',
    allowCustom = true,
    showDescription = true,
    minChars = 0,
    maxSuggestions = 10,
    disabled = false,
    readOnly = false,
    required = false,
    id,
    className,
}: ComboBoxProps) {
    // `draft` is the uncommitted typed text; null = not editing, display the
    // committed value's label. This split IS the one-pipeline fix.
    const [draft, setDraft] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(-1);
    const wrapRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    // Mirror of `draft`, nulled synchronously on commit/revert so the
    // mousedown-outside + blur pair can both call settle() without
    // double-committing (blur fires before React re-renders).
    const draftRef = useRef<string | null>(null);
    const warnedRef = useRef<Set<string>>(new Set());
    const uid = useId();
    const listId = `combo-list-${uid}`;
    const optionId = (i: number) => `combo-opt-${uid}-${i}`;

    const opts = useMemo(() => normalizeOptions(options), [options]);
    const selected = useMemo(() => opts.find((o) => o.value === value), [opts, value]);
    const query = (draft ?? '').trim().toLowerCase();
    const visible = useMemo(
        () => filterAndRank(opts, query).slice(0, maxSuggestions),
        [opts, query, maxSuggestions],
    );

    // Unknown committed value under allowCustom:false is a config bug: warn
    // once per (instance, value) but still display it verbatim — never
    // "render nothing" (house rule 4).
    if (!allowCustom && value != null && value !== '' && !selected) {
        const key = String(value);
        if (!warnedRef.current.has(key)) {
            warnedRef.current.add(key);
            console.warn(`ComboBox: value ${JSON.stringify(value)} is not among the options while allowCustom is false — displaying it verbatim`);
        }
    }

    const canOpen = !disabled && !readOnly;
    const displayValue = draft ?? (selected ? selected.label : value == null ? '' : String(value));

    const setDraftBoth = (d: string | null) => { draftRef.current = d; setDraft(d); };
    const close = () => { setOpen(false); setHighlight(-1); };

    // ── the ONE committed pipeline ───────────────────────────────────────
    const commitOption = (opt: ComboOption) => {
        setDraftBoth(null);
        close();
        if (opt.value !== value) onChange?.(opt.value, opt);
        onSelect?.(opt);
    };
    const commitCustom = (text: string) => {
        setDraftBoth(null);
        close();
        if (text !== (value == null ? '' : String(value))) onChange?.(text);
    };
    /** Drop the draft — the display reverts to the committed value. */
    const revert = () => { setDraftBoth(null); close(); };
    /** Typed text equal to an option's label (or stringified value) IS that
        option — the display shows labels, so labels must never commit as
        raw values. */
    const resolveText = (text: string): ComboOption | undefined =>
        opts.find((o) => o.label === text) ?? opts.find((o) => String(o.value) === text);
    /** Close-with-settlement: resolve → commit option; else custom when
        allowed (including '' = cleared); else revert the display. Used by
        outside click, blur, Tab and toggle-close. */
    const settle = () => {
        const text = draftRef.current;
        if (text === null) { close(); return; }
        const match = resolveText(text);
        if (match) { commitOption(match); return; }
        if (allowCustom) { commitCustom(text); return; }
        revert();
    };
    // Keep the keyboard-highlighted option in view.
    useEffect(() => {
        if (highlight < 0) return;
        document.getElementById(`combo-opt-${uid}-${highlight}`)?.scrollIntoView({ block: 'nearest' });
    }, [highlight, uid]);

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        switch (e.key) {
            case 'ArrowDown':
                if (!canOpen) break;
                e.preventDefault();
                if (!open) setOpen(true);
                else if (visible.length > 0) setHighlight((h) => (h + 1) % visible.length);
                break;
            case 'ArrowUp':
                if (!open) break;
                e.preventDefault();
                if (visible.length > 0) setHighlight((h) => (h <= 0 ? visible.length - 1 : h - 1));
                break;
            case 'Enter':
                if (open && highlight >= 0 && highlight < visible.length) {
                    e.preventDefault();
                    commitOption(visible[highlight]);
                } else if (allowCustom && draftRef.current) {
                    e.preventDefault();
                    const match = resolveText(draftRef.current);
                    if (match) commitOption(match);
                    else commitCustom(draftRef.current);
                } else if (open) {
                    // Nothing highlighted, nothing committable — just close;
                    // the draft stays for further editing, blur settles it.
                    e.preventDefault();
                    close();
                }
                break;
            case 'Tab':
                // Close and pass through — no preventDefault, focus moves on.
                if (open || draftRef.current !== null) settle();
                break;
        }
    };

    const onToggle = () => {
        if (open) { settle(); return; }
        // Open-with-cleared-filter: show ALL options. The committed label
        // stays visible but text-selected, so the next keystroke starts a
        // fresh query (web-mojo blanked the input instead, which left an
        // empty-looking display over a committed value).
        setDraftBoth(null);
        setHighlight(-1);
        setOpen(true);
        inputRef.current?.focus();
        inputRef.current?.select();
    };

    const emptyText = allowCustom && (draft ?? '').length >= minChars
        ? (draft ? 'No matches found. Press Enter to use custom value.' : 'Start typing to see suggestions...')
        : 'No matching options found.';
    const emptyIcon = allowCustom && (draft ?? '').length >= minChars ? 'bi-info-circle' : 'bi-search';

    return (
        <div className={`combo${className ? ` ${className}` : ''}`} ref={wrapRef}>
            <div className="combo-input-wrap">
                <input
                    ref={inputRef}
                    id={id}
                    type="text"
                    className="input combo-input"
                    role="combobox"
                    aria-expanded={open}
                    aria-autocomplete="list"
                    aria-controls={listId}
                    aria-activedescendant={open && highlight >= 0 ? optionId(highlight) : undefined}
                    autoComplete="off"
                    placeholder={placeholder}
                    value={displayValue}
                    disabled={disabled}
                    readOnly={readOnly}
                    required={required}
                    onFocus={() => { if (canOpen) setOpen(true); }}
                    onBlur={(e) => {
                        if (wrapRef.current && e.relatedTarget && wrapRef.current.contains(e.relatedTarget as Node)) return;
                        settle();
                    }}
                    onChange={(e) => {
                        // Draft only — the committed pipeline never runs here.
                        const v = e.target.value;
                        setDraftBoth(v);
                        setHighlight(-1);
                        if (!canOpen) return;
                        if (v.length >= minChars) setOpen(true);
                        else close();
                    }}
                    onKeyDown={onKeyDown}
                />
                {canOpen && (
                    <button
                        type="button"
                        className="combo-toggle"
                        tabIndex={-1}
                        aria-label="Toggle dropdown"
                        onMouseDown={(e) => e.preventDefault() /* keep input focus */}
                        onClick={onToggle}
                    >
                        <i className="bi bi-chevron-down" aria-hidden="true" />
                    </button>
                )}
            </div>
            <Popover
                anchorRef={wrapRef}
                open={open}
                onClose={(reason) => reason === 'escape' ? revert() : settle()}
                id={listId}
                className="combo-pop"
                role="listbox"
            >
                    {visible.length === 0 ? (
                        <div className="combo-empty">
                            <i className={`bi ${emptyIcon}`} aria-hidden="true" />
                            <span>{emptyText}</span>
                        </div>
                    ) : visible.map((opt, i) => {
                        const isSelected = opt.value === value;
                        return (
                            <div
                                key={`${typeof opt.value}:${String(opt.value)}`}
                                id={optionId(i)}
                                role="option"
                                aria-selected={isSelected}
                                className={`combo-option${i === highlight ? ' combo-hot' : ''}${isSelected ? ' combo-selected' : ''}`}
                                onMouseDown={(e) => e.preventDefault() /* option click must not blur-settle first */}
                                onClick={() => commitOption(opt)}
                            >
                                <div className="combo-option-main">
                                    <div className="combo-option-label">{highlightLabel(opt.label, (draft ?? '').trim())}</div>
                                    {showDescription && opt.description !== undefined && (
                                        <div className="combo-option-desc">{opt.description}</div>
                                    )}
                                </div>
                                {isSelected && <i className="bi bi-check combo-check" aria-hidden="true" />}
                            </div>
                        );
                    })}
            </Popover>
        </div>
    );
}
