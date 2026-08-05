// TimezoneSelect — the searchable IANA zone picker. Ported from web-mojo
// src/core/forms/inputs/TimezoneSelect.js (196 lines, read in full).
//
// A thin layer over the house <ComboBox>: zones from
// Intl.supportedValuesOf('timeZone') (curated fallback when the engine has
// no such API), each labelled with its CURRENT UTC offset —
// "America/New_York (UTC−05:00)", Unicode minus, zero-padded. Embedded by
// the time pickers (#1269 / DateTimePicker) and usable as its own field.
//
// Fixed here BY CONSTRUCTION (web-mojo bugs, do not reintroduce):
// - Commit-only change. web-mojo's ComboBox emitted `change` per keystroke,
//   so this picker leaked typed filter fragments ("Amer") into its value and
//   FormView's 300ms autosave saved them. Our ComboBox commits on selection
//   or settle only, and `allowCustom` is false here — a value can ONLY ever
//   come out of the list.
// - Offsets recompute on every open gesture. web-mojo built the labels once
//   in onAfterRender, so a long-lived picker kept showing pre-DST offsets.
// - The committed zone is always an option. V8's supportedValuesOf returns
//   ICU-canonical ids ('Asia/Calcutta', 'Europe/Kiev', 'America/Godthab'),
//   while Python/django-mojo stores the modern IANA primaries
//   ('Asia/Kolkata', 'Europe/Kyiv', 'America/Nuuk'). Without this, a stored
//   zone was unlabelled, unfindable and un-re-selectable — the user had to
//   change it to save anything. Engines ACCEPT the aliases as input, so the
//   offset label works for them.
import { useMemo, useRef, useState } from 'react';
import { ComboBox, type ComboOption } from '../ComboBox';
import { ianaOffset } from './fns';

/**
 * The curated fallback list, verbatim from web-mojo (order included). Only
 * ever used when the engine has no `Intl.supportedValuesOf`.
 *
 * Carried as-is on purpose, warts included: `America/Honolulu` is not a real
 * IANA zone (the real one, `Pacific/Honolulu`, is also in the list). It
 * labels as a bare name — `ianaOffset` returns null for zones the engine
 * rejects — rather than throwing.
 */
export const FALLBACK_TIMEZONES: readonly string[] = [
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

/** U+2212 — the typographic minus the offset labels use for negatives. */
const MINUS = '−';

/** One open is several DOM events (pointerdown → focus, or keydown → focus);
    relabelling once per second of gestures covers them all and is orders of
    magnitude finer than any DST transition. */
const OPEN_COALESCE_MS = 1000;

let warnedNoIntl = false;
let cachedEngineZones: string[] | null = null;

/**
 * The engine's zone list, resolved once per session. Falls back to
 * FALLBACK_TIMEZONES with ONE module-level warn (never per instance, never
 * per render) when `Intl.supportedValuesOf` is missing or refuses 'timeZone'.
 */
function engineZones(): string[] {
    if (cachedEngineZones) return cachedEngineZones;
    let zones: string[] | null = null;
    try {
        if (typeof Intl.supportedValuesOf === 'function') {
            const supported = Intl.supportedValuesOf('timeZone');
            if (Array.isArray(supported) && supported.length) zones = supported.slice();
        }
    } catch {
        // Engine has the function but not the key — fall through to curated.
    }
    if (!zones) {
        if (!warnedNoIntl) {
            warnedNoIntl = true;
            console.warn('TimezoneSelect: Intl.supportedValuesOf("timeZone") unavailable — falling back to the curated zone list.');
        }
        zones = FALLBACK_TIMEZONES.slice();
    } else if (!zones.includes('UTC')) {
        // Deliberate one-line deviation from source: V8 omits UTC from
        // supportedValuesOf, and a django-mojo portal whose picker cannot
        // choose UTC is broken. The curated list leads with it too.
        zones = ['UTC', ...zones];
    }
    cachedEngineZones = zones;
    return zones;
}

/** The browser's own zone, 'UTC' when the engine can't say. */
export function localTimezone(): string {
    try {
        return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

/** Caller's fixed list (order preserved) or the engine list. An EMPTY array
    is treated as "no override", as in source. */
function zoneList(timezones?: readonly string[] | null): string[] {
    return timezones && timezones.length ? timezones.slice() : engineZones();
}

/**
 * The zone an empty value displays.
 *
 * A caller-supplied list constrains the choice, so a local zone outside it
 * falls back to its first entry. The engine/curated list does not: the
 * user's own zone is the right default even when the list can't browse it
 * (ComboBox then shows it verbatim and warns once — house rule 4).
 */
function defaultZone(zones: string[], isOverride: boolean): string {
    const local = localTimezone();
    if (isOverride && !zones.includes(local)) return zones.length ? zones[0] : local;
    return local;
}

function resolveWithin(
    value: string | null | undefined,
    zones: string[],
    isOverride: boolean,
    defaultToLocal: boolean,
): string | null {
    if (value != null && value !== '') return value;
    return defaultToLocal ? defaultZone(zones, isOverride) : null;
}

export interface ResolveTimezoneOptions {
    timezones?: readonly string[] | null;
    defaultToLocal?: boolean;
}

/**
 * The EFFECTIVE zone a `<TimezoneSelect>` displays for a given value — and
 * therefore the value a form should post for it (plain IANA string, or null
 * when `defaultToLocal` is off and nothing is picked). The field registry's
 * getFormValue is exactly this call.
 */
export function resolveTimezone(
    value: string | null | undefined,
    options: ResolveTimezoneOptions = {},
): string | null {
    // A committed value wins verbatim — no list needs building for it.
    if (value != null && value !== '') return value;
    const isOverride = !!(options.timezones && options.timezones.length);
    return resolveWithin(value, zoneList(options.timezones), isOverride, options.defaultToLocal !== false);
}

/**
 * "America/New_York (UTC−05:00)" — `ianaOffset` does the shortOffset
 * formatToParts work (GMT/UTC → +00:00, zero-padded hours); the sign becomes
 * a Unicode minus here. Zones the engine rejects label as the bare name.
 */
function zoneLabel(zone: string, at: Date): string {
    const offset = ianaOffset(zone, at);
    return offset ? `${zone} (UTC${offset.replace('-', MINUS)})` : zone;
}

export interface TimezoneChangeEvent {
    value: string;
    /** What the picker displayed before — the EFFECTIVE zone, so a default
        that was never committed still reports honestly. */
    oldValue: string | null;
}

export interface TimezoneSelectProps {
    /** Committed IANA zone. Empty (null / '') displays the default. */
    value?: string | null;
    /** COMMIT only, and only when the zone actually changes. */
    onChange?: (e: TimezoneChangeEvent) => void;
    /** Fixed list overriding the engine's, in the order given. */
    timezones?: readonly string[] | null;
    /** Empty value displays the local zone. Default true. */
    defaultToLocal?: boolean;
    /** Renders a hidden input under this name, for native form posts. */
    name?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    /** Cap on rendered suggestions. Default: the whole list (source parity —
        web-mojo's ComboBox scrolled every zone; it never capped). */
    maxSuggestions?: number;
    id?: string;
    className?: string;
}

export function TimezoneSelect({
    value = null,
    onChange,
    timezones = null,
    defaultToLocal = true,
    name,
    placeholder = 'Search timezone...',
    disabled = false,
    required = false,
    maxSuggestions,
    id,
    className,
}: TimezoneSelectProps) {
    // Bumped by every gesture that can open the list; the memo key that
    // relabels the zones (see OPEN_COALESCE_MS). Holding the instant in state
    // keeps the label memo pure — no hidden Date.now() inside it.
    const [stamp, setStamp] = useState(() => Date.now());
    const markOpenGesture = () => setStamp((prev) => (Date.now() - prev > OPEN_COALESCE_MS ? Date.now() : prev));

    const isOverride = !!(timezones && timezones.length);
    const zones = useMemo(() => zoneList(timezones), [timezones]);
    const current = resolveWithin(value, zones, isOverride, defaultToLocal);

    // The committed zone is ALWAYS an option (see the alias note above): it
    // leads the list so it is visible, labelled and re-selectable.
    const options = useMemo<ComboOption[]>(() => {
        const at = new Date(stamp);
        const list = current !== null && !zones.includes(current) ? [current, ...zones] : zones;
        return list.map((zone) => ({ value: zone, label: zoneLabel(zone, at) }));
    }, [zones, stamp, current]);

    // A zone the ENGINE cannot resolve (no offset at all) is a data bug, not
    // a render event: warn once per (instance, value) and still display it.
    const probedRef = useRef<Set<string>>(new Set());
    if (current !== null && !probedRef.current.has(current)) {
        probedRef.current.add(current);
        if (ianaOffset(current) === null) {
            console.warn(`TimezoneSelect: ${JSON.stringify(current)} is not a timezone this engine recognizes — displaying it verbatim`);
        }
    }

    return (
        <div
            className={`tz-select${className ? ` ${className}` : ''}`}
            onFocus={markOpenGesture}
            onPointerDown={markOpenGesture}
            onKeyDown={(e) => { if (e.key === 'ArrowDown') markOpenGesture(); }}
        >
            <ComboBox
                value={current}
                options={options}
                // allowCustom:false is the whole commit-only guarantee: typed
                // text that matches nothing reverts, it never becomes a value.
                allowCustom={false}
                maxSuggestions={maxSuggestions ?? options.length}
                placeholder={placeholder}
                disabled={disabled}
                required={required}
                id={id}
                onChange={(next) => {
                    const zone = String(next);
                    // ComboBox already skips no-op commits; this keeps the
                    // {value, oldValue} contract true independently of it.
                    if (zone === current) return;
                    onChange?.({ value: zone, oldValue: current });
                }}
            />
            {/* Native form posts get the plain IANA string (source parity). */}
            {name && <input type="hidden" name={name} value={current ?? ''} />}
        </div>
    );
}
