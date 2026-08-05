// TimePicker — HH:MM time input with the stepper panel and optional IANA
// timezone. Ported from web-mojo src/core/forms/inputs/TimePicker.js (648
// lines, read in full) + the `.mojo-time-*` block of calendar.css.
//
// The panel is the source's locked "variant B": per unit a column of
// ▲ / value input / ▼ / label, with direct numeric typing on the value.
// (Wheels were deferred to a future mobile mode in the source; not carried.)
//
// Storage is ALWAYS canonical 24h `HH:MM` internally — `format` only decides
// what the panel and the trigger show. What leaves the component depends on
// `outputFormat`:
//   'iso'    (default) → '14:30-07:00' (zone set) | '14:30'
//   'iana'   (legacy)  → '14:30 America/Los_Angeles' | '14:30'
//   'object'           → { time: '14:30', timezone: 'America/Los_Angeles' }
// and all three shapes PARSE back in, plus 12h "h:mm AM/PM" and ISO
// `Z`/`±HHMM`/`±HH:MM` offsets.
//
// React shape: the TIME is controlled — `value` in, `onChange` out, change
// fires on COMMIT only (stepper click, AM/PM, Enter/blur, Now, clear, zone
// pick), never per keystroke; a typed-but-uncommitted value lives in `draft`
// and can never be read as the value. The ZONE is internal state seeded from
// `value` (an 'iso' round-trip only carries the OFFSET, so re-deriving the
// zone from our own echoed output would silently degrade
// "America/Los_Angeles" to "-07:00" — the echo guard is what stops that).
//
// Timezone-picker SEAM: this component owns every bit of the zone's value and
// serialization logic but renders the picker through `renderTimezoneSelect`.
// Without that prop it falls back to a plain token-styled <select> built from
// Intl.supportedValuesOf('timeZone'), so the feature is complete standalone.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { Popover } from '../Popover';
import { compareTime, formatTime, ianaOffset, parseTime } from './fns';
import type { ParsedTime } from './fns';

export type TimeFormat = '24h' | '12h';
/** 'iso' → `HH:MM±HH:MM`; 'iana' → `HH:MM Zone`; 'object' → `{time, timezone}`. */
export type TimeOutputFormat = 'iso' | 'iana' | 'object';

export interface TimeObjectValue { time: string; timezone: string | null }
/** Everything the picker accepts in and (per `outputFormat`) hands back. */
export type TimeValue = string | TimeObjectValue | null;

export interface TimeChangeEvent {
    /** The `outputFormat` shape — write this straight back into `value`. */
    value: TimeValue;
    /** Display text (`format`, zone appended when one is set). */
    formatted: string;
    /** The PREVIOUS canonical serialized string (source parity: always a
     *  string, `''` when there was no time — it is the diffing key). */
    oldValue: string;
}

/** Props handed to `renderTimezoneSelect`. The real TimezoneSelect (built
 *  separately) plugs in here; nothing about the value pipeline moves with it. */
export interface TimezoneSelectSlotProps {
    value: string | null;
    onChange: (tz: string | null) => void;
    timezones?: string[];
    disabled?: boolean;
}

export interface TimePickerProps {
    /** Renders a hidden input carrying the serialized string (native-form use). */
    name?: string;
    /** Controlled value — string / `{time,timezone}` / null. */
    value?: TimeValue;
    /** Display clock: '24h' (default) | '12h'. Unknown values warn + fall back. */
    format?: TimeFormat;
    /** Minute stepping increment, ≥1 (default 1). Hours always step by 1. */
    step?: number;
    /** Bounds as time strings ("09:00", "5:30 pm") — clamped on every commit. */
    min?: string | null;
    max?: string | null;
    /** Trigger text when empty. Defaults to 'HH:MM' / 'h:mm AM/PM'. */
    placeholder?: string | null;
    disabled?: boolean;
    /** Displays but never opens/edits (the trigger stays focusable). */
    readOnly?: boolean;
    /** Suppresses the clear ✕. */
    required?: boolean;
    /** Paints the trigger with the error border. */
    invalid?: boolean;
    className?: string;
    /** Render the panel in place — no trigger, no popover. */
    inline?: boolean;
    /** false → the embeddable footerless panel (DateTimePicker's time column). */
    showFooter?: boolean;
    /** true enables the zone picker; an array enables it AND is the zone list. */
    timezone?: boolean | string[];
    /** Zone list when `timezone` is `true`. Default: Intl's full list. */
    timezones?: string[] | null;
    /** Default 'iso'. Unknown values warn + fall back. */
    outputFormat?: TimeOutputFormat;
    /** Zone-picker slot. Absent → the built-in fallback <select>. */
    renderTimezoneSelect?: (props: TimezoneSelectSlotProps) => ReactNode;
    /** Fires on COMMIT only, and only when the serialized value changed. */
    onChange?: (event: TimeChangeEvent) => void;
}

type StepField = 'hour' | 'minute';

interface TimeState { time: ParsedTime | null; timezone: string | null }

/** A zone that is already a fixed offset (what an 'iso' value parses back to). */
const OFFSET_ZONE = /^[+-]\d{2}:\d{2}$/;

/** Used only when Intl.supportedValuesOf is unavailable (source's curated set). */
const FALLBACK_ZONES = [
    'UTC', 'GMT',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Anchorage', 'America/Honolulu', 'America/Phoenix',
    'America/Toronto', 'America/Vancouver', 'America/Mexico_City',
    'America/Sao_Paulo', 'America/Buenos_Aires', 'America/Bogota',
    'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin',
    'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Stockholm',
    'Europe/Athens', 'Europe/Moscow', 'Europe/Istanbul',
    'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi',
    'Asia/Dubai', 'Asia/Tehran', 'Asia/Karachi', 'Asia/Kolkata',
    'Asia/Bangkok', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai',
    'Asia/Tokyo', 'Asia/Seoul', 'Asia/Jakarta', 'Asia/Manila',
    'Australia/Perth', 'Australia/Sydney', 'Australia/Melbourne',
    'Pacific/Auckland', 'Pacific/Fiji', 'Pacific/Honolulu',
];

// ── Pure helpers ───────────────────────────────────────────────────

function pad2(n: number): string { return n < 10 ? '0' + n : String(n); }

function detectLocalZone(): string {
    try { return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch { return 'UTC'; }
}

/** Unknown enum-ish prop values fall back WITH a warn — never render nothing. */
function normFormat(f: TimeFormat | undefined): TimeFormat {
    if (f == null || f === '24h' || f === '12h') return f ?? '24h';
    console.warn(`TimePicker: unknown format "${String(f)}" — falling back to "24h"`);
    return '24h';
}

function normOutputFormat(f: TimeOutputFormat | undefined): TimeOutputFormat {
    if (f == null || f === 'iso' || f === 'iana' || f === 'object') return f ?? 'iso';
    console.warn(`TimePicker: unknown outputFormat "${String(f)}" — falling back to "iso"`);
    return 'iso';
}

/**
 * Parse any accepted input shape into `{time, timezone}` (source `_parseInitial`).
 * Handles: `{time,timezone}` objects, ISO `HH:MM±HH:MM` / `HH:MMZ` / `HH:MM±HHMM`,
 * `HH:MM Zone` (IANA tail), 12h `h:mm AM/PM`, and bare `HH:MM`.
 */
function parseInitial(raw: TimeValue | undefined): TimeState {
    if (raw == null || raw === '') return { time: null, timezone: null };
    if (typeof raw === 'object') {
        return {
            time: raw.time ? parseTime(raw.time) : null,
            timezone: raw.timezone || null,
        };
    }
    const str = String(raw).trim();
    const isoOffset = str.match(/^(\d{1,2}:\d{2})(Z|[+-]\d{2}:?\d{2})$/);
    if (isoOffset) {
        const off = isoOffset[2]!;
        let timezone: string;
        if (off === 'Z') timezone = '+00:00';
        else if (/^[+-]\d{4}$/.test(off)) timezone = `${off.slice(0, 3)}:${off.slice(3)}`;
        else timezone = off;
        return { time: parseTime(isoOffset[1]!), timezone };
    }
    const sp = str.indexOf(' ');
    if (sp > -1) {
        const tail = str.slice(sp + 1).trim();
        // An AM/PM tail belongs to the time — parseTime owns the whole string.
        if (/^(am|pm)$/i.test(tail)) return { time: parseTime(str), timezone: null };
        return { time: parseTime(str.slice(0, sp)), timezone: tail || null };
    }
    return { time: parseTime(str), timezone: null };
}

/** Canonical serialization — always a STRING (the hidden input + the diff key). */
function serialize(s: TimeState, tzEnabled: boolean, outputFormat: TimeOutputFormat): string {
    if (!s.time) return '';
    const t = formatTime(s.time, '24h');
    if (!tzEnabled || !s.timezone) return t;
    if (outputFormat === 'iana') return `${t} ${s.timezone}`;
    // Deviation from source: a zone that is ALREADY an offset (what an 'iso'
    // value parses back to) passes straight through. `ianaOffset('-07:00')`
    // returns null, so the source silently dropped the offset on re-save.
    if (OFFSET_ZONE.test(s.timezone)) return `${t}${s.timezone}`;
    const offset = ianaOffset(s.timezone, new Date());
    return offset ? `${t}${offset}` : t;
}

function displayText(s: TimeState, tzEnabled: boolean, format: TimeFormat): string {
    if (!s.time) return '';
    const t = formatTime(s.time, format);
    return tzEnabled && s.timezone ? `${t} ${s.timezone}` : t;
}

/** The `outputFormat` shape handed to `onChange` (source `getValue`). */
function readOut(s: TimeState, tzEnabled: boolean, outputFormat: TimeOutputFormat): TimeValue {
    if (!s.time) return outputFormat === 'object' ? null : '';
    if (tzEnabled && outputFormat === 'object') {
        return { time: formatTime(s.time, '24h'), timezone: s.timezone || null };
    }
    return serialize(s, tzEnabled, outputFormat);
}

/** Identity key for a `value` prop — how an echo of our own emit is spotted. */
function valueKey(v: TimeValue | undefined): string {
    if (v == null || v === '') return '';
    if (typeof v === 'object') return `${v.time ?? ''}|${v.timezone ?? ''}`;
    return v;
}

function hourDisplay(hours: number, format: TimeFormat): string {
    if (format !== '12h') return pad2(hours);
    const h12 = hours % 12;
    return String(h12 === 0 ? 12 : h12);
}

let warnedNoIntlZones = false;

function buildZoneList(list: string[] | undefined): string[] {
    if (Array.isArray(list) && list.length) return list.slice();
    try {
        if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
            const zones = Intl.supportedValuesOf('timeZone');
            if (Array.isArray(zones) && zones.length) return zones.slice();
        }
    } catch { /* fall through to the curated list */ }
    if (!warnedNoIntlZones) {
        warnedNoIntlZones = true;
        console.warn('TimePicker: Intl.supportedValuesOf("timeZone") unavailable — falling back to the curated zone list.');
    }
    return FALLBACK_ZONES.slice();
}

// ── Fallback zone picker (used until a TimezoneSelect is injected) ──

function FallbackTimezoneSelect({ value, onChange, timezones, disabled }: TimezoneSelectSlotProps) {
    // `timezones` is normally undefined (referentially stable); when supplied
    // the rebuild is a slice, so recomputing on identity change is free.
    const zones = useMemo(() => buildZoneList(timezones), [timezones]);
    const known = !value || zones.includes(value);

    useEffect(() => {
        if (!known) {
            console.warn(`TimePicker: timezone "${String(value)}" is not in the zone list — rendering it as a custom option.`);
        }
    }, [known, value]);

    return (
        <select
            className="input mojo-time-tz-select"
            aria-label="Timezone"
            value={value ?? ''}
            disabled={disabled}
            onChange={(e) => onChange(e.currentTarget.value || null)}
        >
            <option value="">(no timezone)</option>
            {/* A value the list doesn't carry still shows — never render nothing. */}
            {!known && value ? <option value={value}>{value}</option> : null}
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
    );
}

// ── Component ──────────────────────────────────────────────────────

export function TimePicker(props: TimePickerProps) {
    const format = normFormat(props.format);
    const outputFormat = normOutputFormat(props.outputFormat);
    const {
        name, value = '', min = null, max = null,
        disabled = false, readOnly = false, required = false, invalid = false,
        className = '', inline = false,
        renderTimezoneSelect, onChange,
    } = props;
    const showFooter = props.showFooter !== false;
    const stepRaw = Number.parseInt(String(props.step ?? 1), 10);
    const step = Math.max(1, Number.isFinite(stepRaw) ? stepRaw : 1);
    const tzEnabled = props.timezone === true || Array.isArray(props.timezone);
    const tzList = Array.isArray(props.timezone) ? props.timezone : (props.timezones ?? undefined);
    const placeholder = props.placeholder ?? (format === '12h' ? 'h:mm AM/PM' : 'HH:MM');
    const locked = disabled || readOnly;

    const [state, setState] = useState<TimeState>(() => {
        const init = parseInitial(value);
        return { time: init.time, timezone: init.timezone ?? (tzEnabled ? detectLocalZone() : null) };
    });
    /** Typed-but-uncommitted column text. Never readable as the value. */
    const [draft, setDraft] = useState<{ field: StepField; text: string } | null>(null);
    const [open, setOpen] = useState(false);

    const triggerRef = useRef<HTMLButtonElement>(null);
    const hourRef = useRef<HTMLInputElement>(null);
    const minuteRef = useRef<HTMLInputElement>(null);

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
        setState((s) => ({ time: init.time, timezone: init.timezone ?? s.timezone }));
        setDraft(null);
    }, [value]);

    // Turning the zone picker on seeds the local zone (source constructor).
    // Like the source this does NOT emit — the owner learns on the next commit.
    useEffect(() => {
        if (!tzEnabled) return;
        setState((s) => (s.timezone ? s : { ...s, timezone: detectLocalZone() }));
    }, [tzEnabled]);

    useEffect(() => { if (locked) setOpen(false); }, [locked]);
    // Closing discards a typed draft — React unmounts the panel before the
    // input's blur can fire, so the draft would otherwise survive to next open.
    useEffect(() => { if (!open) setDraft(null); }, [open]);

    // Arrow-key stepping re-selects the column text AFTER React writes the new
    // value into the DOM (setting .value collapses the selection).
    const [selectNonce, setSelectNonce] = useState(0);
    const reselectField = useRef<StepField | null>(null);
    useEffect(() => {
        if (selectNonce === 0) return;
        const el = reselectField.current === 'hour' ? hourRef.current : minuteRef.current;
        el?.focus();
        el?.select();
    }, [selectNonce]);
    const reselect = (field: StepField) => {
        reselectField.current = field;
        setSelectNonce((n) => n + 1);
    };

    // ── Bounds ────────────────────────────────────────────────────
    const minT = useMemo(() => (min ? parseTime(min) : null), [min]);
    const maxT = useMemo(() => (max ? parseTime(max) : null), [max]);
    const clamp = (t: ParsedTime): ParsedTime => {
        if (minT && compareTime(t, minT) < 0) return { ...minT };
        if (maxT && compareTime(t, maxT) > 0) return { ...maxT };
        return t;
    };

    // ── Commit ────────────────────────────────────────────────────
    // The ONE value-mutation boundary — every interaction funnels here, so the
    // disabled/readOnly guard lives here too (an ArrowUp inside a readOnly
    // column would otherwise commit: the source's panel had no such guard
    // because it could never be opened, but `inline` can be locked).
    const commit = (next: TimeState) => {
        if (locked) return;
        const oldStored = serialize(state, tzEnabled, outputFormat);
        const newStored = serialize(next, tzEnabled, outputFormat);
        setState(next);
        if (oldStored === newStored) return;     // no-op edits stay silent
        const emitted = readOut(next, tzEnabled, outputFormat);
        echoKey.current = valueKey(emitted);
        onChange?.({
            value: emitted,
            formatted: displayText(next, tzEnabled, format),
            oldValue: oldStored,
        });
    };
    const commitTime = (time: ParsedTime | null) => commit({ time, timezone: state.timezone });

    // ── Panel interaction ─────────────────────────────────────────
    const stepValue = (field: StepField, dir: 1 | -1) => {
        const cur = state.time ?? { hours: 0, minutes: 0 };
        let { hours, minutes } = cur;
        if (field === 'hour') {
            hours = ((hours + dir) % 24 + 24) % 24;
        } else {
            // Minute stepping honors `step` via total-minutes math, wrapping
            // across midnight in BOTH directions.
            const total = hours * 60 + minutes;
            const next = ((total + dir * step) % 1440 + 1440) % 1440;
            hours = Math.floor(next / 60);
            minutes = next % 60;
        }
        setDraft(null);
        commitTime(clamp({ hours, minutes }));
    };

    const setAmPm = (which: 'am' | 'pm') => {
        setDraft(null);
        if (!state.time) {
            commitTime(clamp({ hours: which === 'pm' ? 12 : 0, minutes: 0 }));
            return;
        }
        const { hours, minutes } = state.time;
        let h = hours;
        if (which === 'am' && h >= 12) h -= 12;
        else if (which === 'pm' && h < 12) h += 12;
        commitTime(clamp({ hours: h, minutes }));
    };

    const commitDraft = (field: StepField, text: string) => {
        setDraft(null);
        const raw = text.replace(/\D/g, '');
        if (raw === '') return;                  // empty reverts to the display
        let n = Number.parseInt(raw, 10);
        const cur = state.time ?? { hours: 0, minutes: 0 };
        let { hours, minutes } = cur;
        if (field === 'hour') {
            if (format === '12h') {
                // 1–12 mapped through the CURRENT AM/PM state (12 AM = 0, 12 PM = 12).
                if (n < 1) n = 1;
                if (n > 12) n = 12;
                const isPm = cur.hours >= 12;
                if (n === 12) hours = isPm ? 12 : 0;
                else hours = isPm ? n + 12 : n;
            } else {
                if (n < 0) n = 0;
                if (n > 23) n = 23;
                hours = n;
            }
        } else {
            if (n < 0) n = 0;
            if (n > 59) n = 59;
            minutes = n;
        }
        commitTime(clamp({ hours, minutes }));
    };

    const onValueKey = (field: StepField, event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            stepValue(field, 1);
            reselect(field);
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            stepValue(field, -1);
            reselect(field);
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();          // blur is the commit path
            return;
        }
        if (event.key === 'Tab') return;         // let blur fire naturally
        // Fix over source: shortcuts (⌘A / ⌘V / ^C …) are not "input".
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (!/^[0-9]$/.test(event.key)
            && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();              // digits only
        }
    };

    const commitNow = () => {
        const now = new Date();
        setDraft(null);
        // Fix over source: Now is clamped like every other commit path.
        commitTime(clamp({ hours: now.getHours(), minutes: now.getMinutes() }));
    };

    const applyAndClose = () => {
        setDraft(null);
        if (!state.time) commitTime(clamp({ hours: 0, minutes: 0 }));
        setOpen(false);
    };

    const clearValue = () => {
        if (!state.time) return;                 // nothing to clear
        setDraft(null);
        commitTime(null);
    };

    const setTimezone = (tz: string | null) => {
        const next = tz || null;
        if (next === state.timezone) return;
        // Deviation from source, deliberate: web-mojo updated its hidden input
        // but never emitted on a zone change (`_syncOutputs()` with no
        // oldStored). onChange is the ONLY channel here — staying silent would
        // strand the owner's value.
        commit({ time: state.time, timezone: next });
    };

    // ── Render ────────────────────────────────────────────────────
    const shown = state.time ?? { hours: 0, minutes: 0 };
    const hourText = draft?.field === 'hour' ? draft.text : hourDisplay(shown.hours, format);
    const minuteText = draft?.field === 'minute' ? draft.text : pad2(shown.minutes);
    const stored = serialize(state, tzEnabled, outputFormat);
    const text = displayText(state, tzEnabled, format);
    const clearable = !required && !disabled && !readOnly;

    const renderStepper = (field: StepField, valueText: string, label: string, ref: RefObject<HTMLInputElement | null>) => (
        <div className={`mojo-time-stepper mojo-time-stepper-${field}`}>
            <button
                type="button" className="mojo-time-stepper-btn" disabled={locked}
                aria-label={`Increase ${label.toLowerCase()}`}
                onClick={() => stepValue(field, 1)}
            >
                <i className="bi bi-chevron-up" aria-hidden="true" />
            </button>
            <input
                ref={ref}
                type="text"
                className="mojo-time-stepper-value"
                inputMode="numeric"
                maxLength={2}
                aria-label={label}
                value={valueText}
                disabled={disabled}
                readOnly={readOnly}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setDraft({ field, text: e.currentTarget.value.replace(/\D/g, '').slice(0, 2) })}
                onKeyDown={(e) => onValueKey(field, e)}
                onBlur={(e) => commitDraft(field, e.currentTarget.value)}
            />
            <button
                type="button" className="mojo-time-stepper-btn" disabled={locked}
                aria-label={`Decrease ${label.toLowerCase()}`}
                onClick={() => stepValue(field, -1)}
            >
                <i className="bi bi-chevron-down" aria-hidden="true" />
            </button>
            <div className="mojo-time-stepper-label">{label}</div>
        </div>
    );

    const isPm = shown.hours >= 12;
    const zoneOffset = tzEnabled && state.timezone
        ? (OFFSET_ZONE.test(state.timezone) ? state.timezone : ianaOffset(state.timezone, new Date()))
        : null;

    const panel = (
        <div className="mojo-time-popover-inner">
            <div className="mojo-time-stepper-row">
                {renderStepper('hour', hourText, 'Hour', hourRef)}
                <div className="mojo-time-stepper-sep">:</div>
                {renderStepper('minute', minuteText, 'Minute', minuteRef)}
                {format === '12h' && (
                    <div className="mojo-time-ampm">
                        <button
                            type="button" disabled={locked} aria-pressed={!isPm}
                            className={`mojo-time-ampm-btn${!isPm ? ' is-active' : ''}`}
                            onClick={() => setAmPm('am')}
                        >AM</button>
                        <button
                            type="button" disabled={locked} aria-pressed={isPm}
                            className={`mojo-time-ampm-btn${isPm ? ' is-active' : ''}`}
                            onClick={() => setAmPm('pm')}
                        >PM</button>
                    </div>
                )}
            </div>

            {tzEnabled && (
                <div className="mojo-time-tz-host">
                    {renderTimezoneSelect
                        ? renderTimezoneSelect({ value: state.timezone, onChange: setTimezone, timezones: tzList, disabled: locked })
                        : <FallbackTimezoneSelect value={state.timezone} onChange={setTimezone} timezones={tzList} disabled={locked} />}
                    {zoneOffset ? <div className="mojo-time-tz-offset">UTC{zoneOffset}</div> : null}
                </div>
            )}

            {showFooter && (
                <div className="mojo-time-foot">
                    <button type="button" className="btn btn-compact mojo-time-now" disabled={locked} onClick={commitNow}>Now</button>
                    <button type="button" className="btn btn-primary btn-compact mojo-time-apply" disabled={locked} onClick={applyAndClose}>Set</button>
                </div>
            )}
        </div>
    );

    if (inline) {
        return (
            <div className={`mojo-time-picker${className ? ` ${className}` : ''}`}>
                {name ? <input type="hidden" name={name} value={stored} readOnly /> : null}
                <div className={`mojo-time-picker-inline${invalid ? ' is-invalid' : ''}`}>{panel}</div>
            </div>
        );
    }

    return (
        <div className={`mojo-time-picker${className ? ` ${className}` : ''}`}>
            <button
                type="button"
                ref={triggerRef}
                className={`mojo-time-trigger${invalid ? ' is-invalid' : ''}${clearable ? ' has-clear' : ''}`}
                disabled={disabled}
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => { if (!locked) setOpen((o) => !o); }}
            >
                <i className="bi bi-clock" aria-hidden="true" />
                <span className={`mojo-time-trigger-text${!state.time ? ' is-empty' : ''}`}>
                    {text || placeholder}
                </span>
            </button>
            {/* Sibling, not nested: the source put a <button> inside the trigger
                <button> (invalid HTML). The wrapper carries the hover state. */}
            {clearable ? (
                <button
                    type="button" className="mojo-time-trigger-clear" aria-label="Clear"
                    tabIndex={-1} onClick={clearValue}
                >✕</button>
            ) : null}
            {name ? <input type="hidden" name={name} value={stored} readOnly /> : null}
            <Popover
                anchorRef={triggerRef}
                open={open}
                onClose={() => setOpen(false)}
                className={`mojo-time-popover${tzEnabled ? ' has-tz' : ''}`}
                aria-label="Choose time"
            >
                {panel}
            </Popover>
        </div>
    );
}
