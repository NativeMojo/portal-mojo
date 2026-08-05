// DateRangePicker — range picker built on the Calendar engine and the
// shared Popover, with the "Quick range" preset rail. Ported from web-mojo
// src/core/forms/inputs/DateRangePicker.js (402 lines, read in full) +
// calendar/PresetSidebar.js (152). Three precisions ('day' | 'month' |
// 'year'); day precision defaults to two side-by-side panes.
//
// React shape: the VALUE is controlled — `start`/`end` are canonical
// strings at precision; every commit (completed calendar range, preset
// pick, clear) emits `onChange({start, end, formatted, oldStart, oldEnd})`
// and paints once the owner writes the props back. `autoApply` (default
// true) carries the source semantics exactly: values apply on EVERY commit
// — autoApply only decides whether completing a range / picking a preset
// also CLOSES the popover. There is no staged apply; mount the picker
// `inline` in a dialog (FilterBar does) when the owner wants an explicit
// Apply step around it.
//
// Deviations from source, deliberate:
// - No hidden <input>s / name/startName/endName / outputFormat /
//   getFormValue surface — controlled props replace the form-DOM bridge.
// - The trigger's clear ✕ is an absolutely-positioned SIBLING button, not
//   a nested <button> (source nested buttons — invalid HTML).
// - A half-picked anchor does NOT survive popover close/reopen: the anchor
//   is Calendar-internal state and the popover unmounts its content on
//   close (web-mojo kept one live calendar element across opens). The
//   load-bearing source behavior — the anchor surviving PAGING/zooming
//   mid-selection — lives in the engine and is fully preserved; reopening
//   shows the committed range, the predictable state. (Revisit only if the
//   engine ever grows a controlled `anchor` prop.)
// - Escape with the popover open closes the popover (Popover owns Escape
//   in the capture phase); the engine's Escape-cancels-anchor applies in
//   inline mode. Closing never reverts — commits were already applied.
import { useRef, useState } from 'react';
import { Calendar } from './Calendar';
import { formatForDisplay, parseByPrecision } from './fns';
import type { Precision } from './fns';
import { Popover } from '../Popover';
import { PresetRail } from './PresetRail';
import type { PresetsOption, PresetSelectEvent } from './PresetRail';

const DEFAULT_DISPLAY_FORMAT: Record<Precision, string> = {
    day: 'MMM DD, YYYY',
    month: 'MMM YYYY',
    year: 'YYYY',
};

const DEFAULT_PLACEHOLDER: Record<Precision, string> = {
    day: 'Select date range...',
    month: 'Select month range...',
    year: 'Select year range...',
};

export interface DateRangeChangeEvent {
    /** Canonical strings at precision ('' when cleared / half-empty). */
    start: string;
    end: string;
    /** Display text of the NEW range — what the trigger shows. */
    formatted: string;
    oldStart: string;
    oldEnd: string;
}

export interface DateRangePickerProps {
    /** Controlled canonical strings at precision (YYYY-MM-DD / YYYY-MM /
     *  YYYY). '' or null = empty. */
    start?: string | null;
    end?: string | null;
    /** Fires on COMMIT (range completed, preset picked, clear) and only
     *  when the pair actually changes. */
    onChange?: (event: DateRangeChangeEvent) => void;
    /** 'day' | 'month' | 'year'. Default 'day'. Unknown values warn and
     *  fall back to 'day'. */
    precision?: Precision;
    /** Day-view panes 1 | 2. Default 2 for day precision, 1 for month/year. */
    months?: 1 | 2;
    /** 'default' | true → the precision's built-in list; an array → custom
     *  `{label, range()}` entries (`{divider: true}` separators); absent /
     *  false / empty array → no rail. */
    presets?: PresetsOption | false | null;
    /** Display tokens (YYYY YY MMMM MMM MM M DD D). Default per precision;
     *  tokens the precision can't honor are stripped. */
    displayFormat?: string;
    /** Between the two formatted ends. Default ' – '. */
    separator?: string;
    placeholder?: string;
    /** Bounds (canonical strings) — passed through to the Calendar, which
     *  compares them at the pane precision being painted. */
    min?: string | null;
    max?: string | null;
    disabled?: boolean;
    readOnly?: boolean;
    /** Hides the clear ✕ so the field can't be emptied from the trigger. */
    required?: boolean;
    /** Render the rail + calendar in place — no trigger, no popover. */
    inline?: boolean;
    /** Close the popover when a range completes / a preset is picked.
     *  Default true. Values always apply immediately either way. */
    autoApply?: boolean;
    className?: string;
    /** id for the trigger button (external label targets). */
    id?: string;
}

/** Unknown enum-ish prop values fall back WITH a warn — never render nothing. */
function normPrecision(p: Precision | undefined): Precision {
    if (p == null || p === 'day' || p === 'month' || p === 'year') return p ?? 'day';
    console.warn(`DateRangePicker: unknown precision "${String(p)}" — falling back to "day"`);
    return 'day';
}

/** Drop display-format tokens the precision can't honor, then sweep the
 *  separator debris off the tail (ported verbatim from source). Private —
 *  DatePicker ports the same source helper; exporting twins would collide
 *  at the index.ts merge. */
function stripIncompatibleTokens(format: string, precision: Precision): string {
    if (precision === 'day') return format;
    if (precision === 'month') return format.replace(/\bDD\b|\bD\b/g, '').replace(/[\s\-\/]+$/, '').trim();
    return format.replace(/MMMM|MMM|MM|M|DD|D/g, '').replace(/[\s\-\/]+$/, '').trim() || 'YYYY';
}

export function DateRangePicker(props: DateRangePickerProps) {
    const precision = normPrecision(props.precision);
    const {
        onChange,
        presets = null,
        min = null,
        max = null,
        disabled = false,
        readOnly = false,
        required = false,
        inline = false,
        autoApply = true,
        className = '',
        id,
    } = props;
    const start = props.start ?? '';
    const end = props.end ?? '';
    // Same clamp as the engine so the pane-width class can't disagree with
    // what the Calendar actually renders.
    const months = Math.max(1, Math.min(2, (props.months ?? (precision === 'day' ? 2 : 1)) | 0)) as 1 | 2;
    const twoPane = precision === 'day' && months === 2;
    const displayFormat = props.displayFormat ?? DEFAULT_DISPLAY_FORMAT[precision];
    const separator = props.separator ?? ' – ';
    const placeholder = props.placeholder ?? DEFAULT_PLACEHOLDER[precision];

    const [open, setOpen] = useState(false);
    // Highlighted rail entry; -1 = none. Cleared when a manual calendar
    // anchor starts (source: sidebar.setActive(-1) on range:start).
    const [activePreset, setActivePreset] = useState(-1);
    const wrapRef = useRef<HTMLDivElement>(null);

    // Source's _hasPresets predicate: true / 'default' / non-empty array.
    const railPresets: PresetsOption | null =
        presets === true || presets === 'default' ? presets
            : Array.isArray(presets) && presets.length > 0 ? presets
                : null;

    // ── Display text (source _displayText + token stripping) ─────────
    const fmt = stripIncompatibleTokens(displayFormat, precision);
    const displayTextFor = (s: string, e: string): string => {
        const ps = s ? parseByPrecision(s, precision) : null;
        const pe = e ? parseByPrecision(e, precision) : null;
        if (!ps && !pe) return '';
        if (ps && pe) return `${formatForDisplay(ps, fmt)}${separator}${formatForDisplay(pe, fmt)}`;
        return formatForDisplay(ps ?? pe, fmt);
    };
    const text = displayTextFor(start, end);

    // ── One commit pipeline: calendar range / preset / clear ─────────
    const emitChange = (nextStart: string, nextEnd: string) => {
        if (nextStart === start && nextEnd === end) return;
        onChange?.({
            start: nextStart,
            end: nextEnd,
            formatted: displayTextFor(nextStart, nextEnd),
            oldStart: start,
            oldEnd: end,
        });
    };

    const closeIfAuto = () => { if (autoApply && !inline) setOpen(false); };

    const handleRangeSelect = (e: { start: string; end: string }) => {
        emitChange(e.start, e.end);
        closeIfAuto();
    };

    const handleRangeStart = () => {
        if (activePreset !== -1) setActivePreset(-1);
    };

    const handlePreset = (e: PresetSelectEvent) => {
        setActivePreset(e.index);
        emitChange(e.start, e.end);
        closeIfAuto();
    };

    const clear = () => emitChange('', '');

    const toggle = () => {
        if (disabled || readOnly) return;
        setOpen((v) => !v);
    };

    // ── Body — identical in the popover and inline ───────────────────
    const body = (extraClass = '') => (
        <div className={`mojo-daterange-body${railPresets ? ' mojo-daterange-with-presets' : ''}${extraClass}`}>
            {railPresets && (
                <PresetRail
                    precision={precision}
                    presets={railPresets}
                    activeIndex={activePreset}
                    onSelect={handlePreset}
                />
            )}
            <div className={`mojo-daterange-cal${twoPane ? ' is-two-pane' : ''}`}>
                <Calendar
                    precision={precision}
                    mode="range"
                    months={months}
                    startValue={start || null}
                    endValue={end || null}
                    min={min}
                    max={max}
                    onRangeSelect={handleRangeSelect}
                    onRangeStart={handleRangeStart}
                />
            </div>
        </div>
    );

    if (inline) {
        return (
            <div className={`mojo-daterange mojo-daterange-${precision} mojo-daterange-inline${className ? ` ${className}` : ''}`}>
                {body()}
            </div>
        );
    }

    const showClear = !required && !disabled && !readOnly;
    const rootClasses = [
        'mojo-daterange',
        `mojo-daterange-${precision}`,
        showClear ? 'mojo-daterange-clearable' : '',
        readOnly ? 'mojo-daterange-readonly' : '',
        className,
    ].filter(Boolean).join(' ');

    return (
        <div className={rootClasses} ref={wrapRef}>
            <button
                type="button"
                id={id}
                className="mojo-daterange-trigger"
                disabled={disabled}
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={toggle}
            >
                <i className="bi bi-calendar3-range" aria-hidden="true" />
                <span className={`mojo-daterange-trigger-text${text ? '' : ' is-empty'}`}>
                    {text || placeholder}
                </span>
            </button>
            {showClear && (
                <button
                    type="button"
                    className="mojo-daterange-trigger-clear"
                    aria-label="Clear"
                    tabIndex={-1}
                    onClick={clear}
                >
                    {'✕'}
                </button>
            )}
            <Popover anchorRef={wrapRef} open={open} onClose={() => setOpen(false)}>
                {body(' mojo-daterange-pop')}
            </Popover>
        </div>
    );
}
