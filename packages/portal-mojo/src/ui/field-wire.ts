// field-wire — the ONE place date/datetime form values cross between the
// control shape (what a picker holds) and the WIRE shape (what rides the
// django-mojo save body). Board #1278.
//
// The measured contract (mojo/serializers/core/serializer.py:380-389 +
// mojo/models/rest.py:1888-1892 · dates.parse_datetime):
//   · DateTimeField serializes OUT as epoch SECONDS (int) and the save path
//     parses epoch numbers straight back in — epoch is the datetime wire
//     shape, both directions.
//   · DateField serializes OUT as 'YYYY-MM-DD' (isoformat); the save path
//     accepts epochs AND canonical strings (both run through
//     dates.parse_datetime; naive values are treated as UTC).
// So the boundary emits EPOCH SECONDS by default (UTC midnight for date-only
// precisions — a UTC-parsed epoch midnight lands on the same DateField day),
// and `Field.outputFormat: 'date'` opts a field into canonical-string output
// for DateField columns that should round-trip exactly as the server emits.
// Reads (`wireToField`) accept BOTH shapes regardless, plus this package's
// canonical picker strings — a row can carry `last_login` epochs and `dob`
// strings through the same code path.
//
// NOT this module's problem: the `dr_field/dr_start/dr_end` daterange FILTER
// triple stays 'YYYY-MM-DD' strings — that path is FilterBar's/params',
// untouched (rest.py parses dr_* dates itself).
//
// State principle (how the two form surfaces stay out of the conversion
// business): form STATE HOLDS THE WIRE SHAPE. The registry renderer converts
// at its own boundary — render through `wireToField`, commit through
// `fieldToWire` — so SchemaForm's submit payload and FormView's autosave
// batches carry wire-ready values without either surface knowing dates exist.
import {
    formatByPrecision,
    formatDateTime,
    ianaOffset,
    parseByPrecision,
    parseDateTime,
    type ParsedDate,
    type Precision,
} from './date/fns';
import type { Field, FieldValue } from '../client/types';

// ── Type families ─────────────────────────────────────────────────────

const DATE_TYPES = new Set(['datepicker', 'monthpicker', 'yearpicker']);
const RANGE_TYPES = new Set(['daterange', 'monthrange', 'yearrange']);
const LIST_TYPES = new Set(['multiselect', 'collectionmultiselect', 'collection-multiselect']);

/** The monthpicker/yearpicker/monthrange/yearrange alias → precision map
 *  (web-mojo inputs/index.js PRECISION_ALIASES + FormBuilder cases). */
const PRECISION_ALIASES: Record<string, Precision> = {
    monthpicker: 'month',
    yearpicker: 'year',
    monthrange: 'month',
    yearrange: 'year',
};

/** Effective precision: an EXPLICIT Field.precision wins over the alias
 *  (createInput parity: `options.precision || precision`). */
export function fieldPrecision(field: Field): Precision {
    if (field.precision === 'day' || field.precision === 'month' || field.precision === 'year') {
        return field.precision;
    }
    return PRECISION_ALIASES[field.type] ?? 'day';
}

/**
 * The empty value each type holds in form state (and posts when cleared):
 * '' for text-ish/CSV/time types, false for switch, [] for the list types,
 * null for the null-clearing types (dates, datetime, daterange, collection —
 * django-mojo nulls a nullable column for null/'').
 */
export function emptyFieldValue(field: Field): FieldValue {
    if (field.type === 'switch') return false;
    if (LIST_TYPES.has(field.type)) return [];
    if (DATE_TYPES.has(field.type) || RANGE_TYPES.has(field.type)) return null;
    if (field.type === 'datetimepicker' || field.type === 'collection') return null;
    return '';
}

// ── Epoch math (UTC for date-only precisions) ─────────────────────────

// One warn per (field, value shape) — unparseable stored values are data/config
// bugs, not render events (house rule: fall back WITH a warn, never silently).
const warnedValues = new Set<string>();
function warnOnce(field: Field, value: unknown, note: string): void {
    const key = `${field.name}:${String(value)}`;
    if (warnedValues.has(key)) return;
    warnedValues.add(key);
    console.warn(`field-wire: ${note} (field "${field.name}", value ${JSON.stringify(value)})`);
}

/** Epoch detection for incoming raws: numbers, or all-digit strings of 5+
 *  chars (4 digits is a canonical YYYY year, never an epoch). */
function asEpoch(raw: unknown): number | null {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && /^-?\d{5,}(\.\d+)?$/.test(raw.trim())) return Number(raw.trim());
    return null;
}

/** Canonical date string at precision → epoch seconds at UTC midnight
 *  (first-of-month / Jan 1 for coarser precisions). */
function canonicalToEpoch(canonical: string, precision: Precision): number | null {
    const p = parseByPrecision(canonical, precision);
    if (!p) return null;
    return Math.floor(Date.UTC(p.y, (p.m ?? 1) - 1, p.d ?? 1) / 1000);
}

/** Epoch seconds → canonical string at precision, read in UTC (the inverse
 *  of canonicalToEpoch — a UTC-midnight epoch round-trips to the same day). */
function epochToCanonical(epoch: number, precision: Precision): string {
    const d = new Date(epoch * 1000);
    const parsed: ParsedDate = { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
    return formatByPrecision(parsed, precision);
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** '±HH:MM' → signed minutes, or null when malformed. */
function offsetMinutes(offset: string): number | null {
    const m = offset.match(/^([+-])(\d{2}):(\d{2})$/);
    if (!m) return null;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Datetime string → epoch seconds. Accepts every shape fns.parseDateTime
 * does ('YYYY-MM-DD HH:MM', ISO 'T' forms, '±HH:MM' offsets, IANA tails,
 * date-only). Zone semantics:
 *   · explicit offset → exact instant;
 *   · IANA zone → resolved via ianaOffset at that instant (two-pass so a
 *     DST boundary lands on the right side);
 *   · no zone → the BROWSER'S local wall time (what the user meant when
 *     they picked 14:30 in a zoneless picker).
 */
export function datetimeStringToEpoch(s: string): number | null {
    const parsed = parseDateTime(s);
    if (!parsed) return null;
    const { date, time, timezone } = parsed;
    const utcGuess = Math.floor(Date.UTC(date.y, date.m - 1, date.d, time.hours, time.minutes) / 1000);
    if (!timezone) {
        return Math.floor(new Date(date.y, date.m - 1, date.d, time.hours, time.minutes).getTime() / 1000);
    }
    const direct = offsetMinutes(timezone);
    if (direct != null) return utcGuess - direct * 60;
    // IANA zone: offset depends on the instant; resolve, adjust, re-check.
    const off1 = ianaOffset(timezone, new Date(utcGuess * 1000));
    const min1 = off1 != null ? offsetMinutes(off1) : null;
    if (min1 == null) return utcGuess; // unknown zone — treat wall time as UTC
    const attempt = utcGuess - min1 * 60;
    const off2 = ianaOffset(timezone, new Date(attempt * 1000));
    const min2 = off2 != null ? offsetMinutes(off2) : min1;
    return min2 === min1 ? attempt : utcGuess - (min2 ?? min1) * 60;
}

/** Epoch seconds → 'YYYY-MM-DD HH:MM' in the BROWSER'S local time (the
 *  inverse of the zoneless parse above — round-trips to the same epoch). */
export function epochToDatetimeString(epoch: number): string {
    const d = new Date(epoch * 1000);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ── The boundary ──────────────────────────────────────────────────────

/** Read a single date-ish raw into the canonical control string (or null). */
function rawToCanonical(field: Field, raw: unknown, precision: Precision): string | null {
    if (raw == null || raw === '') return null;
    const epoch = asEpoch(raw);
    if (epoch != null) return epochToCanonical(epoch, precision);
    if (typeof raw === 'string') {
        const parsed = parseByPrecision(raw, precision);
        if (parsed) return formatByPrecision(parsed, precision);
    }
    warnOnce(field, raw, 'value is neither an epoch nor a canonical date string — treating as empty');
    return null;
}

/**
 * CONTROL → WIRE. Date/range types take the picker's canonical string(s);
 * datetimepicker takes the datetime string. Default output is epoch seconds;
 * `outputFormat: 'date'` keeps canonical strings. Every other type passes
 * through unchanged (its control shape IS its wire shape — see the value
 * table in docs/forms.md).
 */
export function fieldToWire(field: Field, value: FieldValue): FieldValue {
    const keepString = field.outputFormat === 'date';

    if (DATE_TYPES.has(field.type)) {
        if (value == null || value === '') return null;
        const canonical = String(value);
        if (keepString) return canonical;
        const epoch = canonicalToEpoch(canonical, fieldPrecision(field));
        if (epoch == null) {
            warnOnce(field, value, 'commit is not a canonical date string — posting null');
            return null;
        }
        return epoch;
    }

    if (RANGE_TYPES.has(field.type)) {
        if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
        const pair = Array.isArray(value) ? value : [value];
        const [s, e] = [String(pair[0] ?? ''), String(pair[1] ?? '')];
        if (!s || !e) return null; // the picker only ever commits complete-or-cleared
        if (keepString) return [s, e];
        const precision = fieldPrecision(field);
        const es = canonicalToEpoch(s, precision);
        const ee = canonicalToEpoch(e, precision);
        if (es == null || ee == null) {
            warnOnce(field, value, 'range commit is not a canonical pair — posting null');
            return null;
        }
        return [es, ee];
    }

    if (field.type === 'datetimepicker') {
        if (value == null || value === '') return null;
        const str = String(value);
        if (keepString) return str;
        const epoch = datetimeStringToEpoch(str);
        if (epoch == null) {
            warnOnce(field, value, 'commit is not a parseable datetime — posting null');
            return null;
        }
        return epoch;
    }

    return value;
}

/**
 * WIRE → CONTROL. Row/state raws (epoch numbers, epoch-strings, canonical
 * strings — whatever the server or a previous commit left) become what the
 * picker renders: canonical strings for date/range types, a local
 * 'YYYY-MM-DD HH:MM' for datetimepicker. Other types pass through.
 */
export function wireToField(field: Field, raw: FieldValue): FieldValue {
    if (DATE_TYPES.has(field.type)) {
        return rawToCanonical(field, raw, fieldPrecision(field));
    }

    if (RANGE_TYPES.has(field.type)) {
        if (raw == null || raw === '') return null;
        const precision = fieldPrecision(field);
        // An autosave snapshot round-trip flattens arrays to 'a,b' (toDisplay
        // String()s scalars) — accept the flattened form back.
        const parts = Array.isArray(raw) ? raw : String(raw).split(',');
        if (parts.length !== 2) {
            warnOnce(field, raw, 'range value is not a two-element pair — treating as empty');
            return null;
        }
        const s = rawToCanonical(field, parts[0], precision);
        const e = rawToCanonical(field, parts[1], precision);
        return s && e ? [s, e] : null;
    }

    if (field.type === 'datetimepicker') {
        if (raw == null || raw === '') return null;
        const epoch = asEpoch(raw);
        if (epoch != null) return epochToDatetimeString(epoch);
        const parsed = parseDateTime(String(raw));
        if (parsed) return formatDateTime(parsed);
        warnOnce(field, raw, 'value is neither an epoch nor a parseable datetime — treating as empty');
        return null;
    }

    return raw;
}
