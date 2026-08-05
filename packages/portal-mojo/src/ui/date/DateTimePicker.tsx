// DateTimePicker — the combined date + time field. Ported from web-mojo
// src/core/forms/inputs/DateTimePicker.js (523 lines, read in full) + the
// `.mojo-datetime-*` block of calendar.css.
//
// The source's locked "variant A" layout, unchanged: ONE popover holding the
// day Calendar on the left, the embedded TimePicker steppers on the right
// under a "Time" heading, a full-width timezone row below the pair (so the
// IANA combobox gets the whole width), and a Now/Done footer. One field, one
// value — the timezone is part of THIS picker, never a second field.
//
// Composition: `Calendar precision="day" mode="single"` + `TimePicker inline
// showFooter={false} timezone={false}` + a timezone slot. Every child is
// controlled from the one state below, so a value can never be displayed that
// this component's state does not hold.
//
// What leaves depends on `outputFormat`:
//   'iso'    (default) → '2026-05-04T14:30:00-07:00' | '2026-05-04T14:30:00'
//   'iana'   (legacy)  → '2026-05-04 14:30 America/Los_Angeles'
//   'object'           → { date: '2026-05-04', time: '14:30', timezone? }
// and all three parse back in, plus date-only, 12h text, and `Z`/`±HHMM`
// offsets in every spelling.
//
// The ISO offset is computed with `ianaOffset(zone, <the selected instant>)`,
// so it is DST-correct AT THE VALUE'S OWN DATE — a July value serializes
// -07:00 and a January one -08:00. (TimePicker cannot do this: a wall-clock
// time has no date, so it must resolve against `new Date()`.)
//
// React shape: the value is CONTROLLED but the picker also holds its own
// committed state, seeded from `value` and re-seeded whenever `value` changes
// to something that is not an echo of its own last emit — 'iso' output
// carries only the OFFSET, so re-parsing our own echo would silently degrade
// 'America/Los_Angeles' to '-07:00'. Same shape (and same reason) as
// Calendar/TimePicker.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Popover } from '../Popover';
import { Calendar } from './Calendar';
import { TimePicker } from './TimePicker';
import type { TimeChangeEvent, TimeFormat, TimezoneSelectSlotProps } from './TimePicker';
import { TimezoneSelect, localTimezone } from './TimezoneSelect';
import {
    compareTime, compareYmd, formatForDisplay, formatTime, formatYmd,
    ianaOffset, parseDateTime, parseTime, parseYmd, today,
} from './fns';
import type { ParsedTime, ParsedYmd } from './fns';

/** 'iso' → `YYYY-MM-DDTHH:MM:00±HH:MM`; 'iana' → `YYYY-MM-DD HH:MM Zone`;
 *  'object' → `{date, time, timezone?}`. */
export type DateTimeOutputFormat = 'iso' | 'iana' | 'object';

/** The object shape that comes OUT (`outputFormat: 'object'`): both parts are
 *  always present; `timezone` only when the zone picker is enabled. */
export interface DateTimeObjectValue {
    date: string;
    time: string;
    timezone?: string | null;
}

/** The object shape accepted IN — every part optional, so a caller can seed a
 *  zone with no date, or a date with no time (which reads as 00:00). */
export interface DateTimeObjectInput {
    date?: string | null;
    time?: string | null;
    timezone?: string | null;
}

/** What `onChange` hands back, in the `outputFormat` shape. */
export type DateTimeValue = string | DateTimeObjectValue | null;
/** What `value` accepts. Every `DateTimeValue` is a valid `DateTimeInput`, so
 *  writing `event.value` straight back is type-safe. */
export type DateTimeInput = string | DateTimeObjectInput | null;

export interface DateTimeChangeEvent {
    /** The `outputFormat` shape — write this straight back into `value`. */
    value: DateTimeValue;
    /** Display text (`displayFormat` + `timeFormat`, zone appended when set). */
    formatted: string;
    /** The PREVIOUS canonical serialized STRING (`''` when empty) — the
     *  diffing key, never a mirror of `value`. */
    oldValue: string;
}

export interface DateTimePickerProps {
    /** Renders a hidden input carrying the serialized string (native-form use). */
    name?: string;
    /** Controlled value — string / `{date,time,timezone}` / null. */
    value?: DateTimeInput;
    /** Fires on COMMIT only, and only when the serialized value changed. */
    onChange?: (event: DateTimeChangeEvent) => void;
    /** Date half of the trigger text (formatForDisplay tokens). Default
     *  'MMM DD, YYYY'. */
    displayFormat?: string;
    /** Display clock: '24h' (default) | '12h'. Unknown values warn + fall back. */
    timeFormat?: TimeFormat;
    /** Minute stepping increment for the time column, ≥1 (default 1). */
    timeStep?: number;
    /** Bounds. A date ('2026-05-04') or a datetime ('2026-05-04 09:00'): the
     *  DATE part bounds the calendar; a TIME part additionally clamps the time
     *  on the boundary day itself. */
    min?: string | null;
    max?: string | null;
    /** Trigger text when empty. Default 'Pick date & time...'. */
    placeholder?: string | null;
    disabled?: boolean;
    /** Displays but never opens/edits (the trigger stays focusable). */
    readOnly?: boolean;
    /** Suppresses the clear ✕. */
    required?: boolean;
    /** Paints the trigger with the error border. */
    invalid?: boolean;
    className?: string;
    /** Trigger id, for a label's htmlFor. */
    id?: string;
    /** Render the panel in place — no trigger, no popover (and no Done: there
     *  is nothing to dismiss). */
    inline?: boolean;
    /** Individually blocked days, "YYYY-MM-DD". */
    disabledDates?: string[];
    /** First weekday: 0=Sun, 1=Mon, … Default 1. */
    firstDay?: number;
    /** BCP-47 locale for month/weekday names. Default 'en-US'. */
    locale?: string;
    /** true enables the timezone row; an array enables it AND is the zone list. */
    timezone?: boolean | string[];
    /** Zone list when `timezone` is `true`. Default: the engine's own list. */
    timezones?: string[] | null;
    /** Default 'iso'. Unknown values warn + fall back. */
    outputFormat?: DateTimeOutputFormat;
    /** Zone-picker slot. Absent → the house <TimezoneSelect>. */
    renderTimezoneSelect?: (props: TimezoneSelectSlotProps) => ReactNode;
}

const DEFAULT_DISPLAY_FORMAT = 'MMM DD, YYYY';
const DEFAULT_PLACEHOLDER = 'Pick date & time...';

/** A zone that is already a fixed offset (what an 'iso' value parses back to). */
const OFFSET_ZONE = /^[+-]\d{2}:\d{2}$/;
/** An offset separated from the time by a SPACE — see `parseInitial`. */
const TRAILING_OFFSET = /\s+([+-]\d{2}:?\d{2}|Z)$/;
/** Does a bound string carry a time part at all, or is it date-only? */
const HAS_TIME_PART = /[T ]\s*\d{1,2}:\d{2}/;

interface DTState {
    date: ParsedYmd | null;
    time: ParsedTime | null;
    timezone: string | null;
}

/** min/max parsed: the date always, the time only when the string spelled one. */
interface Bound { date: ParsedYmd; time: ParsedTime | null }

// ── Pure helpers ───────────────────────────────────────────────────

function emptyState(): DTState { return { date: null, time: null, timezone: null }; }

/** Unknown enum-ish prop values fall back WITH a warn — never render nothing. */
function normTimeFormat(f: TimeFormat | undefined): TimeFormat {
    if (f == null || f === '24h' || f === '12h') return f ?? '24h';
    console.warn(`DateTimePicker: unknown timeFormat "${String(f)}" — falling back to "24h"`);
    return '24h';
}

function normOutputFormat(f: DateTimeOutputFormat | undefined): DateTimeOutputFormat {
    if (f == null || f === 'iso' || f === 'iana' || f === 'object') return f ?? 'iso';
    console.warn(`DateTimePicker: unknown outputFormat "${String(f)}" — falling back to "iso"`);
    return 'iso';
}

/** 'Z' / '±HHMM' / '±HH:MM' → the canonical '±HH:MM'. */
function normOffset(raw: string): string {
    if (raw === 'Z') return '+00:00';
    return /^[+-]\d{4}$/.test(raw) ? `${raw.slice(0, 3)}:${raw.slice(3)}` : raw;
}

/**
 * Parse any accepted input shape into `{date, time, timezone}` (source
 * `_parseInitial` + `dateFns.parseDateTime`). Two extensions over
 * `parseDateTime`, both because it would otherwise drop data the caller gave:
 *
 * 1. An object with no date still keeps its `timezone` (parseDateTime returns
 *    null for the whole thing, losing the zone).
 * 2. An offset separated from the time by a SPACE — '2026-05-04 14:30 -07:00'.
 *    parseDateTime only reads an offset glued to the time (ISO spelling) and
 *    an IANA *name* after a space, so this spelling lost its zone silently.
 */
function parseInitial(raw: DateTimeInput | undefined): DTState {
    if (raw == null || raw === '') return emptyState();
    if (typeof raw === 'object') {
        const date = raw.date ? parseYmd(raw.date) : null;
        const time = raw.time ? parseTime(raw.time) : null;
        return {
            date,
            // A date with no time reads as midnight, as everywhere else.
            time: date && !time ? { hours: 0, minutes: 0 } : time,
            timezone: raw.timezone || null,
        };
    }
    const str = String(raw).trim();
    const spaced = str.match(TRAILING_OFFSET);
    if (spaced) {
        const head = parseDateTime(str.slice(0, spaced.index).trim());
        if (head) return { date: head.date, time: head.time, timezone: normOffset(spaced[1]!) };
    }
    const parsed = parseDateTime(str);
    return parsed ? { date: parsed.date, time: parsed.time, timezone: parsed.timezone } : emptyState();
}

/** Canonical serialization — always a STRING (the hidden input + the diff key).
 *  'object' output diffs on this too, exactly as the source did. */
function serialize(s: DTState, tzEnabled: boolean, outputFormat: DateTimeOutputFormat): string {
    if (!s.date) return '';
    const d = formatYmd(s.date);
    const t = s.time ? formatTime(s.time, '24h') : '00:00';
    const zone = tzEnabled ? s.timezone : null;
    if (outputFormat === 'iana') return zone ? `${d} ${t} ${zone}` : `${d} ${t}`;
    // ISO 8601 — the default.
    let iso = `${d}T${t}:00`;
    if (zone) {
        // The reference instant is THE VALUE ITSELF, so the offset is the one
        // in force on the selected date (DST-correct), not today's.
        const offset = OFFSET_ZONE.test(zone)
            // A zone that is already an offset passes through: `ianaOffset`
            // returns null for it, which is how the source dropped it on
            // re-save (same fix as TimePicker).
            ? zone
            : ianaOffset(zone, new Date(s.date.y, s.date.m - 1, s.date.d, s.time?.hours ?? 0, s.time?.minutes ?? 0));
        if (offset) iso += offset;
    }
    return iso;
}

/** The `outputFormat` shape handed to `onChange` (source `getValue`). */
function readOut(s: DTState, tzEnabled: boolean, outputFormat: DateTimeOutputFormat): DateTimeValue {
    if (!s.date) return outputFormat === 'object' ? null : '';
    if (outputFormat === 'object') {
        const out: DateTimeObjectValue = {
            date: formatYmd(s.date),
            time: s.time ? formatTime(s.time, '24h') : '00:00',
        };
        // Source parity: the key exists (possibly null) whenever the zone
        // picker is on, and is absent entirely when it is off.
        if (tzEnabled) out.timezone = s.timezone ?? null;
        return out;
    }
    return serialize(s, tzEnabled, outputFormat);
}

function displayText(s: DTState, tzEnabled: boolean, displayFormat: string, timeFormat: TimeFormat): string {
    if (!s.date) return '';
    const datePart = formatForDisplay(s.date, displayFormat);
    const timePart = s.time
        ? formatTime(s.time, timeFormat)
        : (timeFormat === '12h' ? '12:00 AM' : '00:00');
    const out = `${datePart} ${timePart}`;
    return tzEnabled && s.timezone ? `${out} ${s.timezone}` : out;
}

/** Identity key for a `value` prop — how an echo of our own emit is spotted. */
function valueKey(v: DateTimeInput | undefined): string {
    if (v == null || v === '') return '';
    if (typeof v === 'object') return `${v.date ?? ''}|${v.time ?? ''}|${v.timezone ?? ''}`;
    return v;
}

/** Calendar bound: source `_dateBound` — accept a date OR a datetime and keep
 *  the date part. */
function dateBound(v: string | null | undefined): string | null {
    if (v == null || v === '') return null;
    return String(v).trim().split(/[ T]/)[0] ?? null;
}

function parseBound(v: string | null | undefined): Bound | null {
    if (v == null || v === '') return null;
    const str = String(v).trim();
    const date = parseYmd(dateBound(str));
    if (!date) return null;
    const parsed = HAS_TIME_PART.test(str) ? parseDateTime(str) : null;
    return { date, time: parsed ? parsed.time : null };
}

/**
 * Snap a datetime into [min, max]. The date is snapped to the boundary DAY;
 * the time is only clamped when the bound actually spelled one AND we are on
 * that boundary day (a bare '2026-05-04' max must not force 00:00).
 *
 * Nice-to-have over source, which only date-bounded the calendar and left the
 * time free — a 09:00–17:30 window on the first/last day was unenforceable.
 */
function clampDateTime(date: ParsedYmd, time: ParsedTime, minB: Bound | null, maxB: Bound | null): { date: ParsedYmd; time: ParsedTime } {
    let d = date;
    let t = time;
    if (minB && compareYmd(d, minB.date) < 0) { d = { ...minB.date }; if (minB.time) t = { ...minB.time }; }
    if (maxB && compareYmd(d, maxB.date) > 0) { d = { ...maxB.date }; if (maxB.time) t = { ...maxB.time }; }
    if (minB?.time && compareYmd(d, minB.date) === 0 && compareTime(t, minB.time) < 0) t = { ...minB.time };
    if (maxB?.time && compareYmd(d, maxB.date) === 0 && compareTime(t, maxB.time) > 0) t = { ...maxB.time };
    return { date: d, time: t };
}

/** The zone slot's default tenant: the house picker, adapted to the slot's
 *  `(tz: string | null) => void` contract. */
function houseTimezoneSelect({ value, onChange, timezones, disabled }: TimezoneSelectSlotProps): ReactNode {
    return (
        <TimezoneSelect
            value={value}
            timezones={timezones ?? null}
            disabled={disabled}
            onChange={(event) => onChange(event.value)}
        />
    );
}

// ── Component ──────────────────────────────────────────────────────

export function DateTimePicker(props: DateTimePickerProps) {
    const timeFormat = normTimeFormat(props.timeFormat);
    const outputFormat = normOutputFormat(props.outputFormat);
    const {
        name, value = '', onChange,
        displayFormat = DEFAULT_DISPLAY_FORMAT,
        min = null, max = null,
        disabled = false, readOnly = false, required = false, invalid = false,
        className, id, inline = false,
        disabledDates, firstDay = 1, locale = 'en-US',
        renderTimezoneSelect = houseTimezoneSelect,
    } = props;
    const placeholder = props.placeholder ?? DEFAULT_PLACEHOLDER;
    const stepRaw = Number.parseInt(String(props.timeStep ?? 1), 10);
    const timeStep = Math.max(1, Number.isFinite(stepRaw) ? stepRaw : 1);
    const tzEnabled = props.timezone === true || Array.isArray(props.timezone);
    const tzList = Array.isArray(props.timezone) ? props.timezone : (props.timezones ?? undefined);
    const locked = disabled || readOnly;

    const [state, setState] = useState<DTState>(() => {
        const init = parseInitial(value);
        return { ...init, timezone: init.timezone ?? (tzEnabled ? localTimezone() : null) };
    });
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const reactId = useId();
    const popId = `${reactId}-dt`;

    // ── Controlled sync (source `setValue` semantics) ─────────────
    // Our own commits echo back as a `value` prop change; re-parsing that echo
    // is exactly what would degrade an IANA zone to its offset, so skip it.
    const prevKey = useRef(valueKey(value));
    const echoKey = useRef<string | null>(null);
    useEffect(() => {
        const key = valueKey(value);
        if (key === prevKey.current) return;
        prevKey.current = key;
        const echo = echoKey.current !== null && echoKey.current === key;
        echoKey.current = null;
        if (echo) return;
        const init = parseInitial(value);
        // Source: a value without a zone LEAVES the current zone in place.
        setState((s) => ({ date: init.date, time: init.time, timezone: init.timezone ?? s.timezone }));
    }, [value]);

    // Rule 4: an unparseable value renders as empty, but never silently —
    // once per distinct bad value, and never during render.
    const warnedRef = useRef<string | null>(null);
    useEffect(() => {
        if (value == null || value === '' || typeof value === 'object') return;
        if (parseInitial(value).date) return;
        if (warnedRef.current === value) return;
        warnedRef.current = value;
        console.warn(`DateTimePicker: value ${JSON.stringify(value)} is not a datetime this picker can parse — showing empty`);
    }, [value]);

    // Turning the zone row on seeds the local zone (source constructor). Like
    // the source this does NOT emit — the owner learns on the next commit.
    useEffect(() => {
        if (!tzEnabled) return;
        setState((s) => (s.timezone ? s : { ...s, timezone: localTimezone() }));
    }, [tzEnabled]);

    useEffect(() => { if (locked) setOpen(false); }, [locked]);

    // ── Bounds ────────────────────────────────────────────────────
    const minB = useMemo(() => parseBound(min), [min]);
    const maxB = useMemo(() => parseBound(max), [max]);

    // ── Commit ────────────────────────────────────────────────────
    // The ONE value-mutation boundary — every interaction funnels here, so the
    // disabled/readOnly guard lives here too (an `inline` panel has no popover
    // to keep shut).
    const commit = (next: DTState) => {
        if (locked) return;
        const oldStored = serialize(state, tzEnabled, outputFormat);
        const newStored = serialize(next, tzEnabled, outputFormat);
        setState(next);
        if (oldStored === newStored) return;     // no-op edits stay silent
        const emitted = readOut(next, tzEnabled, outputFormat);
        echoKey.current = valueKey(emitted);
        onChange?.({
            value: emitted,
            formatted: displayText(next, tzEnabled, displayFormat, timeFormat),
            oldValue: oldStored,
        });
    };

    /** Source `_refreshTimezoneDefault`: a commit never leaves the zone row
     *  showing a zone the value doesn't carry. */
    const zoneNow = () => (tzEnabled ? state.timezone ?? localTimezone() : state.timezone);

    const commitDate = (date: ParsedYmd | null) => {
        if (!date) return;
        // Source: picking a date with no time yet defaults the time to 00:00.
        const clamped = clampDateTime(date, state.time ?? { hours: 0, minutes: 0 }, minB, maxB);
        commit({ date: clamped.date, time: clamped.time, timezone: zoneNow() });
    };

    const commitTime = (time: ParsedTime | null) => {
        if (!time) { commit({ date: state.date, time: null, timezone: zoneNow() }); return; }
        // Source: a time set without a date defaults the date to today (and
        // the calendar follows — it reads the same state).
        const clamped = clampDateTime(state.date ?? today(), time, minB, maxB);
        commit({ date: clamped.date, time: clamped.time, timezone: zoneNow() });
    };

    const commitNow = () => {
        const now = new Date();
        const clamped = clampDateTime(today(), { hours: now.getHours(), minutes: now.getMinutes() }, minB, maxB);
        commit({ date: clamped.date, time: clamped.time, timezone: zoneNow() });
    };

    const setTimezone = (tz: string | null) => {
        const next = tz || null;
        if (next === state.timezone) return;
        commit({ date: state.date, time: state.time, timezone: next });
    };

    const clearValue = () => {
        if (!state.date && !state.time) return;  // nothing to clear
        // Source `clear()` keeps the zone — it is a picker setting, not data.
        commit({ date: null, time: null, timezone: state.timezone });
    };

    const handleTimeChange = (event: TimeChangeEvent) => {
        // The embedded picker runs zone-less on the default 'iso' output, so
        // its value is always the plain 'HH:MM' string (or '' when cleared).
        const raw = typeof event.value === 'string' ? event.value : event.value ? event.value.time : '';
        commitTime(raw ? parseTime(raw) : null);
    };

    // ── Render ────────────────────────────────────────────────────
    const stored = serialize(state, tzEnabled, outputFormat);
    const text = displayText(state, tzEnabled, displayFormat, timeFormat);
    const clearable = !required && !disabled && !readOnly;
    const hidden = name ? <input type="hidden" name={name} value={stored} readOnly /> : null;

    // Day-scoped time bounds: the embedded picker clamps ITSELF on the
    // boundary day, so its state can never disagree with ours (a parent-only
    // clamp would leave its steppers showing the pre-clamp value).
    const innerMin = state.date && minB?.time && compareYmd(state.date, minB.date) === 0
        ? formatTime(minB.time, '24h') : null;
    const innerMax = state.date && maxB?.time && compareYmd(state.date, maxB.date) === 0
        ? formatTime(maxB.time, '24h') : null;

    const panel = (
        <div className="mojo-datetime-popover-inner">
            <div className="mojo-datetime-row">
                <div className="mojo-datetime-cal-col">
                    <Calendar
                        precision="day"
                        mode="single"
                        months={1}
                        value={state.date ? formatYmd(state.date) : null}
                        min={dateBound(min)}
                        max={dateBound(max)}
                        disabledDates={disabledDates}
                        firstDay={firstDay}
                        locale={locale}
                        onSelect={locked ? undefined : (event) => commitDate(parseYmd(event.value))}
                    />
                </div>
                <div className="mojo-datetime-time-col">
                    <div className="mojo-datetime-time-head">Time</div>
                    <TimePicker
                        inline
                        showFooter={false}
                        timezone={false}
                        format={timeFormat}
                        step={timeStep}
                        value={state.time ? formatTime(state.time, '24h') : ''}
                        min={innerMin}
                        max={innerMax}
                        disabled={disabled}
                        readOnly={readOnly}
                        onChange={handleTimeChange}
                    />
                </div>
            </div>

            {tzEnabled && (
                <div className="mojo-datetime-tz-row">
                    <div className="mojo-datetime-tz-label">Timezone</div>
                    <div className="mojo-datetime-tz-host">
                        {renderTimezoneSelect({
                            value: state.timezone,
                            onChange: setTimezone,
                            timezones: tzList,
                            disabled: locked,
                        })}
                    </div>
                </div>
            )}

            <div className="mojo-datetime-foot">
                <button
                    type="button" className="btn btn-compact mojo-datetime-now"
                    disabled={locked} onClick={commitNow}
                >Now</button>
                {/* Done exists to dismiss the popover — inline has none, so it
                    is omitted rather than rendered dead (source rendered it). */}
                {!inline && (
                    <button
                        type="button" className="btn btn-primary btn-compact mojo-datetime-done"
                        onClick={() => setOpen(false)}
                    >Done</button>
                )}
            </div>
        </div>
    );

    const rootClass = `mojo-datetime-picker${className ? ` ${className}` : ''}`;

    // ── Inline: no trigger, no popover ────────────────────────────
    if (inline) {
        return (
            <div className={rootClass}>
                {hidden}
                <div
                    className={`mojo-datetime-picker-inline${invalid ? ' is-invalid' : ''}${disabled ? ' is-disabled' : ''}`}
                    aria-disabled={locked || undefined}
                >
                    {panel}
                </div>
            </div>
        );
    }

    // ── Trigger + popover ─────────────────────────────────────────
    return (
        <div className={rootClass}>
            <button
                type="button"
                ref={triggerRef}
                id={id}
                className={`mojo-datetime-trigger${invalid ? ' is-invalid' : ''}${clearable ? ' has-clear' : ''}${readOnly ? ' is-readonly' : ''}`}
                disabled={disabled}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? popId : undefined}
                // readOnly keeps the button focusable but actionless — that is
                // aria-disabled, not aria-readonly (invalid for role=button).
                aria-disabled={readOnly || undefined}
                onClick={() => { if (!locked) setOpen((o) => !o); }}
            >
                <i className="bi bi-calendar3" aria-hidden="true" />
                <span className={`mojo-datetime-trigger-text${state.date ? '' : ' is-empty'}`}>
                    {text || placeholder}
                </span>
            </button>
            {/* Sibling, not nested: the source put a <button> inside the
                trigger <button> (invalid HTML). The wrapper carries hover. */}
            {clearable && (
                <button
                    type="button" className="mojo-datetime-trigger-clear" aria-label="Clear"
                    tabIndex={-1} onClick={clearValue}
                >✕</button>
            )}
            {hidden}
            <Popover
                anchorRef={triggerRef}
                open={open}
                onClose={() => setOpen(false)}
                placement="bottom-start"
                id={popId}
                className="mojo-datetime-popover"
                aria-label="Choose date and time"
            >
                {panel}
            </Popover>
        </div>
    );
}
