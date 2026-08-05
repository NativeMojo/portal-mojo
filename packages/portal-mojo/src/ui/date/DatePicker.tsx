// DatePicker — the single-value picker SHELL over the Calendar engine.
// Ported from web-mojo src/core/forms/inputs/DatePicker.js (310 lines, read
// in full). Trigger button + popover, or `inline` (calendar rendered
// directly); one component covers day / month / year precision.
//
// React shape: the VALUE IS CONTROLLED. `value` is the canonical string at
// precision (YYYY-MM-DD / YYYY-MM / YYYY) or null; commits arrive through
// `onChange` and paint only once the owner writes them back — the source's
// in-place DOM patching (`_setValue` poking textContent + a hidden input) has
// no equivalent here and needs none.
//
// One value pipeline: the incoming prop is parsed + re-formatted ONCE into
// `canonical`, and the trigger text, the calendar, and every emitted event
// read that single derivation. A value that does not parse is treated as
// empty WITH one console.warn — never "render nothing".
//
// Structural deviation from source: source nested the clear <button> INSIDE
// the trigger <button>. That is invalid DOM (React logs a validateDOMNesting
// error), so the clear is a SIBLING absolutely positioned over the trigger.
// Same look, and clicking it still cannot open the popover — it is not
// inside the trigger at all, so there is nothing to stopPropagation from.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Calendar, type CalendarSelectEvent } from './Calendar';
import { formatByPrecision, formatForDisplay, parseByPrecision, type Precision } from './fns';
import { Popover } from '../Popover';

export interface DatePickerChangeEvent {
    /** Canonical string at precision, or null when cleared. */
    value: string | null;
    /** The trigger's display text for `value` ('' when null). */
    formatted: string;
    /** Canonical value being replaced. */
    oldValue: string | null;
}

export interface DatePickerProps {
    /** Controlled canonical value: YYYY-MM-DD / YYYY-MM / YYYY, or null. */
    value?: string | null;
    /** Grid the picker commits at. Default 'day'. Unknown values warn + fall back. */
    precision?: Precision;
    /** Fires on COMMIT only (a calendar pick or the clear button), and only
     *  when the canonical value actually changes. */
    onChange?: (event: DatePickerChangeEvent) => void;
    /** Trigger text format (formatForDisplay tokens). Default per precision:
     *  'MMM DD, YYYY' / 'MMM YYYY' / 'YYYY'. Tokens the precision cannot fill
     *  are stripped. */
    displayFormat?: string;
    /** Empty-state trigger text. Default 'Select date/month/year...'. */
    placeholder?: string;
    /** Bounds, passed through to the calendar (compared at pane precision). */
    min?: string | null;
    max?: string | null;
    /** Individually blocked days, "YYYY-MM-DD" — day grids only. */
    disabledDates?: string[];
    /** First weekday: 0=Sun, 1=Mon, … Default 1. */
    firstDay?: number;
    /** BCP-47 locale for month/weekday names. Default 'en-US'. */
    locale?: string;
    /** Close the popover as soon as a value is committed. Default true. */
    autoApply?: boolean;
    /** Render the calendar in place instead of behind a trigger. */
    inline?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    /** Hides the clear button (a required field cannot go back to empty). */
    required?: boolean;
    /** Paints the error border (`is-invalid`). */
    invalid?: boolean;
    /** Renders a hidden input carrying the canonical value — native-form
     *  posts only; the package's own forms are controlled. */
    name?: string;
    /** Trigger id, for a label's htmlFor. */
    id?: string;
    className?: string;
}

const DEFAULT_DISPLAY_FORMAT: Record<Precision, string> = {
    day: 'MMM DD, YYYY',
    month: 'MMM YYYY',
    year: 'YYYY',
};

const DEFAULT_PLACEHOLDER: Record<Precision, string> = {
    day: 'Select date...',
    month: 'Select month...',
    year: 'Select year...',
};

const CANONICAL_SHAPE: Record<Precision, string> = {
    day: 'YYYY-MM-DD',
    month: 'YYYY-MM',
    year: 'YYYY',
};

/** Unknown enum-ish prop values fall back WITH a warn — never render nothing. */
function normPrecision(p: Precision | undefined): Precision {
    if (p == null || p === 'day' || p === 'month' || p === 'year') return p ?? 'day';
    console.warn(`DatePicker: unknown precision "${String(p)}" — falling back to "day"`);
    return 'day';
}

/**
 * Drop tokens the precision cannot fill (e.g. DD when precision='month'),
 * then trim trailing separators. Ported verbatim from source, including its
 * one wart: only TRAILING separators are cleaned, so a mid-string comma
 * survives ('MMM DD, YYYY' at month precision → 'MMM , YYYY'). Pass a format
 * that suits the precision, or lean on the per-precision default.
 */
function stripIncompatibleTokens(format: string, precision: Precision): string {
    if (precision === 'day') return format;
    if (precision === 'month') {
        return format.replace(/\bDD\b|\bD\b/g, '').replace(/[\s\-/]+$/, '').trim();
    }
    if (precision === 'year') {
        return format.replace(/MMMM|MMM|MM|M|DD|D/g, '').replace(/[\s\-/]+$/, '').trim() || 'YYYY';
    }
    return format;
}

export function DatePicker(props: DatePickerProps) {
    const precision = normPrecision(props.precision);
    const {
        value = null,
        onChange,
        displayFormat,
        placeholder,
        min = null,
        max = null,
        disabledDates,
        firstDay = 1,
        locale = 'en-US',
        autoApply = true,
        inline = false,
        disabled = false,
        readOnly = false,
        required = false,
        invalid = false,
        name,
        id,
        className,
    } = props;

    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const reactId = useId();
    const popId = `${reactId}-cal`;

    /** Disabled and readonly both make the picker inert (source parity —
     *  `_togglePopover` returned early for either). */
    const inert = disabled || readOnly;

    // Source's setEnabled/setReadonly closed an open popover on the way in;
    // going inert while open is the prop equivalent.
    useEffect(() => {
        if (inert && open) setOpen(false);
    }, [inert, open]);

    // ── The one value derivation ──────────────────────────────────
    // Parse + re-format so a loose-but-valid prop ("2026-3-4") canonicalizes
    // before it reaches the calendar, the trigger, or an emitted event.
    const canonical = useMemo(() => {
        const parsed = parseByPrecision(value, precision);
        return parsed ? formatByPrecision(parsed, precision) : null;
    }, [value, precision]);

    // Rule 4: an unparseable value renders as empty, but never silently —
    // once per distinct bad value, and never during render.
    const warnedRef = useRef<string | null>(null);
    useEffect(() => {
        if (value == null || value === '' || canonical !== null) return;
        const key = `${precision}:${value}`;
        if (warnedRef.current === key) return;
        warnedRef.current = key;
        console.warn(
            `DatePicker: value "${value}" is not a valid ${precision} value ` +
            `(expected ${CANONICAL_SHAPE[precision]}) — showing empty`,
        );
    }, [value, canonical, precision]);

    const format = displayFormat ?? DEFAULT_DISPLAY_FORMAT[precision];
    const displayFor = (canon: string | null): string => {
        const parsed = parseByPrecision(canon, precision);
        return parsed ? formatForDisplay(parsed, stripIncompatibleTokens(format, precision)) : '';
    };
    const displayText = displayFor(canonical);

    // ── Commit ────────────────────────────────────────────────────
    const commit = (raw: string | null) => {
        const parsed = parseByPrecision(raw, precision);
        const next = parsed ? formatByPrecision(parsed, precision) : null;
        if (next === canonical) return; // source: emit only on a real change
        onChange?.({ value: next, formatted: displayFor(next), oldValue: canonical });
    };

    const handleSelect = (event: CalendarSelectEvent) => {
        commit(event.value);
        // Source closed on autoApply whether or not the value changed.
        if (autoApply) setOpen(false);
    };

    const calendar = (
        <Calendar
            precision={precision}
            mode="single"
            months={1}
            value={canonical}
            min={min}
            max={max}
            disabledDates={disabledDates}
            firstDay={firstDay}
            locale={locale}
            onSelect={inert ? undefined : handleSelect}
        />
    );

    const rootClass = `mojo-date-picker mojo-date-picker-${precision}${className ? ` ${className}` : ''}`;
    const hidden = name ? <input type="hidden" name={name} value={canonical ?? ''} /> : null;

    // ── Inline: no trigger, no popover ────────────────────────────
    if (inline) {
        // Source left an inline picker fully live even when disabled; here the
        // props mean what they say (pointer-inert, and no commits are wired).
        const inlineClass = `mojo-date-picker-inline${invalid ? ' is-invalid' : ''}`
            + (inert ? ' is-inert' : '') + (disabled ? ' is-disabled' : '');
        return (
            <div className={rootClass}>
                {hidden}
                <div className={inlineClass} aria-disabled={inert || undefined}>{calendar}</div>
            </div>
        );
    }

    // ── Trigger + popover ─────────────────────────────────────────
    const showClear = !required && !disabled && !readOnly;
    const triggerClass = 'mojo-date-trigger'
        + (invalid ? ' is-invalid' : '')
        + (showClear ? ' has-clear' : '')
        + (readOnly ? ' is-readonly' : '');

    return (
        <div className={rootClass}>
            <button
                type="button"
                ref={triggerRef}
                id={id}
                className={triggerClass}
                disabled={disabled}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? popId : undefined}
                // readOnly keeps the button focusable but actionless — that is
                // aria-disabled, not aria-readonly (invalid for role=button).
                aria-disabled={readOnly || undefined}
                onClick={() => { if (!inert) setOpen((v) => !v); }}
            >
                <i className="bi bi-calendar3" aria-hidden="true" />
                <span className={`mojo-date-trigger-text${canonical ? '' : ' is-empty'}`}>
                    {displayText || (placeholder ?? DEFAULT_PLACEHOLDER[precision])}
                </span>
            </button>
            {showClear && (
                // Source parity: the ✕ shows whenever clearing is allowed, even
                // with nothing selected — clicking it then is a no-op commit.
                <button
                    type="button"
                    className="mojo-date-trigger-clear"
                    aria-label="Clear"
                    tabIndex={-1}
                    onClick={() => commit(null)}
                >
                    {'✕'}
                </button>
            )}
            {hidden}
            <Popover
                anchorRef={triggerRef}
                open={open}
                onClose={() => setOpen(false)}
                placement="bottom-start"
                id={popId}
                aria-label="Calendar"
            >
                {/* The shared popover shell is unpadded/unsized on purpose —
                    the picker content carries the source's padding + floor. */}
                <div className="mojo-date-pop">{calendar}</div>
            </Popover>
        </div>
    );
}
