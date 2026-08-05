// DataFormatter port — pure functions instead of template pipes.
// In JSX these are plain calls: {fmt.relative(user.last_login)}.
//
// The string-pipe parser ("filesize|muted") is deliberately NOT ported: pipe
// strings defeat the type checker and were the source's silent-failure vector
// (unknown formatter → pass-through). Typed functions only. HTML-emitting
// formatters (badge/avatar/linkify/clipboard) are components, not formatters.
//
// Two invariants bind every function here:
//   1. NEVER throws. Bad input degrades to `—` (a trailing `fallback` param
//      overrides it; `slug` documents `''` instead). A formatter is the last
//      thing allowed to take a row down.
//   2. Fixed 'en-US' locale — the portal's house style, not the browser's.

const DASH = '—';

/** Value shapes that arrive on the wire for a numeric field. */
type Numeric = number | string | null | undefined;
/** Value shapes that arrive on the wire for a text field. */
type Textual = string | number | null | undefined;

// Rule-4 warnings (unknown value → default + console.warn) fire from render
// paths, so a table would flood the console. One warning per distinct message.
const warned = new Set<string>();
function warnOnce(message: string): void {
    if (warned.has(message)) return;
    warned.add(message);
    console.warn(message);
}

/**
 * Strict numeric parse — unlike the source's parseFloat, "12 items" is NOT 12.
 * A half-parsed number silently renders wrong; `—` says "no value" honestly.
 */
function toNumber(value: Numeric): number | null {
    if (value == null || value === '') return null;
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    return Number.isFinite(n) ? n : null;
}

/** Text shapes; `0` is a value, `''` is not. */
function toText(value: Textual): string | null {
    if (value == null) return null;
    const s = String(value);
    return s === '' ? null : s;
}

// Intl.NumberFormat throws RangeError outside 0–20 fraction digits.
function clampDecimals(decimals: number): number {
    if (!Number.isFinite(decimals)) return 0;
    return Math.min(20, Math.max(0, Math.trunc(decimals)));
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Constructing an Intl formatter is expensive and tables call these per cell.
const NUMBER_FMTS = new Map<string, Intl.NumberFormat>();
function numberFormat(decimals: number): Intl.NumberFormat {
    const key = String(decimals);
    let f = NUMBER_FMTS.get(key);
    if (!f) {
        f = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
        NUMBER_FMTS.set(key, f);
    }
    return f;
}

const CURRENCY_FMTS = new Map<string, Intl.NumberFormat | null>();
/** null = the runtime rejected the code (Intl throws RangeError on bad codes). */
function currencyFormat(code: string, decimals: number | undefined): Intl.NumberFormat | null {
    const key = `${code}|${decimals ?? ''}`;
    if (CURRENCY_FMTS.has(key)) return CURRENCY_FMTS.get(key) ?? null;
    let f: Intl.NumberFormat | null = null;
    try {
        // Omitting the digit options lets each currency use its own convention
        // (USD 2 digits, JPY 0).
        f = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: code,
            ...(decimals == null ? {} : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
        });
    } catch {
        f = null;
    }
    CURRENCY_FMTS.set(key, f);
    return f;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
const DATETIME_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function toDate(value: string | number | Date | null | undefined): Date | null {
    if (value == null || value === '') return null;
    // django-mojo serializes datetimes as epoch SECONDS; JS Date takes ms.
    // <1e11 distinguishes them until the year 5138 (web-mojo's Job heuristic).
    const normalized = typeof value === 'number' && value < 1e11 ? value * 1000 : value;
    const d = normalized instanceof Date ? normalized : new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
}

export function date(value: string | number | null | undefined, fallback = '—'): string {
    const d = toDate(value);
    return d ? DATE_FMT.format(d) : fallback;
}

export function datetime(value: string | number | null | undefined, fallback = '—'): string {
    const d = toDate(value);
    return d ? DATETIME_FMT.format(d) : fallback;
}

/** '3 weeks ago' style. Ports web-mojo's `relative` pipe behavior. */
export function relative(value: string | number | null | undefined, fallback = 'Never'): string {
    const d = toDate(value);
    if (!d) return fallback;
    const secs = Math.round((Date.now() - d.getTime()) / 1000);
    if (secs < 60) return 'just now';
    const units: [number, string][] = [
        [60, 'minute'], [60, 'hour'], [24, 'day'], [7, 'week'], [4.348, 'month'], [12, 'year'],
    ];
    let n = secs / 60;
    let unit = 'minute';
    for (const [div, name] of units.slice(1)) {
        if (n < div) break;
        n /= div;
        unit = name;
    }
    const count = Math.floor(n);
    return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

export function initials(name: string | null | undefined): string {
    // Real rows can carry display_name: null — a formatter degrades, never throws.
    return (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
}

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'primary';

/** Ports DataFormatter's inferBadgeType: map common status text → tone. */
export function inferTone(value: string | boolean | null | undefined): Tone {
    if (typeof value === 'boolean') return value ? 'success' : 'muted';
    const v = String(value ?? '').toLowerCase();
    if (['active', 'verified', 'enabled', 'ok', 'online', 'completed'].includes(v)) return 'success';
    if (['pending', 'trial', 'staff', 'warning'].includes(v)) return 'warning';
    if (['inactive', 'disabled', 'failed', 'error', 'banned'].includes(v)) return 'danger';
    if (['admin'].includes(v)) return 'primary';
    return 'muted';
}

// ============================ numbers ============================

/**
 * Thousands separators. `1234567` → `1,234,567`.
 * Deviation: source defaulted to 2 decimals; portal columns are counts, so 0.
 */
export function number(value: Numeric, decimals = 0, fallback = DASH): string {
    const n = toNumber(value);
    if (n == null) return fallback;
    return numberFormat(clampDecimals(decimals)).format(n);
}

export interface CurrencyOptions {
    /**
     * `'cents'` (default) matches BOTH the source formatter and django-mojo's
     * integer-minor-unit storage (`cents_to_currency` in serializers) — money
     * crosses the wire as whole cents so it never touches a float. Assumes a
     * 100-minor-unit currency; pass `'major'` for JPY-style zero-decimal ones.
     */
    unit?: 'cents' | 'major';
    /** Force fraction digits; omit to use the currency's own convention. */
    decimals?: number;
    fallback?: string;
}

/**
 * `currency(129900)` → `$1,299.00`; `currency(129900, 'EUR')` → `€1,299.00`.
 * Deviation: the source's second arg was a literal SYMBOL, so its own callers
 * passing `currency("EUR")` rendered `EUR1,299.00`. This takes an ISO code and
 * lets Intl pick the symbol; an unknown code warns once and falls back to USD.
 */
export function currency(value: Numeric, code = 'USD', opts: CurrencyOptions = {}): string {
    const n = toNumber(value);
    const fallback = opts.fallback ?? DASH;
    if (n == null) return fallback;
    const major = (opts.unit ?? 'cents') === 'cents' ? n / 100 : n;
    const decimals = opts.decimals == null ? undefined : clampDecimals(opts.decimals);
    let f = currencyFormat(code, decimals);
    if (!f) {
        warnOnce(`fmt.currency: unknown currency code ${JSON.stringify(code)} — falling back to USD`);
        f = currencyFormat('USD', decimals);
    }
    // Belt and braces: if even USD is unavailable, still return a number.
    return f ? f.format(major) : number(major, decimals ?? 2, fallback);
}

/**
 * `percent(0.856)` → `86%`. `multiply` (source default, kept) scales a 0–1
 * ratio by 100; pass `false` when the value is already a percentage.
 */
export function percent(value: Numeric, decimals = 0, multiply = true, fallback = DASH): string {
    const n = toNumber(value);
    if (n == null) return fallback;
    return `${number(multiply ? n * 100 : n, decimals)}%`;
}

/** `1234` → `1.2K`, `3400000` → `3.4M`. Caps at B, so 1e12 reads `1000.0B`. */
export function compact(value: Numeric, decimals = 1, fallback = DASH): string {
    const n = toNumber(value);
    if (n == null) return fallback;
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    const d = clampDecimals(decimals);
    if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(d)}B`;
    if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(d)}M`;
    if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(d)}K`;
    return String(n);
}

/** Bytes → `1.5 KB` (decimal) or `1.4 KiB` (`binary`). Whole bytes stay integral. */
export function filesize(value: Numeric, binary = false, decimals = 1, fallback = DASH): string {
    const bytes = toNumber(value);
    if (bytes == null) return fallback;
    const units = binary ? ['B', 'KiB', 'MiB', 'GiB', 'TiB'] : ['B', 'KB', 'MB', 'GB', 'TB'];
    const divisor = binary ? 1024 : 1000;
    let size = bytes;
    let unitIndex = 0;
    while (Math.abs(size) >= divisor && unitIndex < units.length - 1) {
        size /= divisor;
        unitIndex++;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : clampDecimals(decimals))} ${units[unitIndex]}`;
}

/**
 * `3` → `3rd`, `11` → `11th`. `suffixOnly` returns just the suffix.
 * Deviation: the suffix is computed on the absolute value, so `-1` → `-1st`
 * (the source's signed modulo made every negative `th`).
 */
export function ordinal(value: Numeric, suffixOnly = false, fallback = DASH): string {
    const n = toNumber(value);
    if (n == null) return fallback;
    const int = Math.trunc(n);
    const abs = Math.abs(int);
    const j = abs % 10;
    const k = abs % 100;
    let suffix = 'th';
    if (j === 1 && k !== 11) suffix = 'st';
    else if (j === 2 && k !== 12) suffix = 'nd';
    else if (j === 3 && k !== 13) suffix = 'rd';
    return suffixOnly ? suffix : `${int}${suffix}`;
}

// ============================ strings ============================

/** Cut to `length` chars and append `suffix` (so the result runs longer). */
export function truncate(value: Textual, length = 50, suffix = '...', fallback = DASH): string {
    const s = toText(value);
    if (s == null) return fallback;
    if (s.length <= length) return s;
    return s.substring(0, Math.max(0, length)) + suffix;
}

/** Keeps both ends: `truncate_middle` port — ids stay recognizable. */
export function truncateMiddle(value: Textual, size = 8, replace = '***', fallback = DASH): string {
    const s = toText(value);
    if (s == null) return fallback;
    if (s.length <= size) return s;
    const half = Math.max(0, Math.floor(size / 2));
    return `${s.substring(0, half)}${replace}${s.substring(s.length - half)}`;
}

/** Keeps only the TAIL: `…c0ffee` — for hashes whose ending disambiguates. */
export function truncateFront(value: Textual, length = 8, prefix = '...', fallback = DASH): string {
    const s = toText(value);
    if (s == null) return fallback;
    if (s.length <= length) return s;
    // slice(-0) is slice(0) — the whole string — so keep=0 is handled apart.
    const keep = Math.max(0, Math.trunc(length));
    return keep === 0 ? prefix : `${prefix}${s.slice(-keep)}`;
}

/**
 * URL-safe slug; documented fallback is `''` (a slug of nothing is nothing).
 * Deviation: accents fold to ASCII (`Café` → `cafe`) instead of being dropped
 * (`caf`), matching django-mojo's own `strip_accents`. The separator is regex-
 * escaped — the source interpolated it raw, so `slug(v, '.')` misbehaved and
 * `slug(v, '')` threw on an empty quantifier.
 */
export function slug(value: Textual, separator = '-'): string {
    const s = toText(value);
    if (s == null) return '';
    let out = s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, separator);
    if (separator) {
        const esc = escapeRegExp(separator);
        out = out
            .replace(new RegExp(`${esc}+`, 'g'), separator)
            .replace(new RegExp(`^${esc}|${esc}$`, 'g'), '');
    }
    return out;
}

/**
 * All-but-last-4: `4111111111111111` → `************1111`.
 * Values no longer than `showLast` are returned intact (nothing to hide).
 * Fixes a source bug: `showLast: 0` masked the string and then re-appended it
 * whole, because `slice(-0)` is `slice(0)`.
 */
export function mask(value: Textual, char = '*', showLast = 4, fallback = DASH): string {
    const s = toText(value);
    if (s == null) return fallback;
    const keep = Math.max(0, Math.trunc(showLast));
    if (s.length <= keep) return s;
    return char.repeat(Math.max(0, s.length - keep)) + (keep === 0 ? '' : s.slice(-keep));
}

/**
 * DISPLAY ONLY — E.164 (`+15555550142`) stays the wire shape; django-mojo
 * REJECTS pretty formats on save, so never round-trip this back to a field.
 * US 10/11-digit numbers group as `(555) 555-0142`; anything else (a real
 * international number) is returned trimmed and unchanged rather than mangled
 * — the source stripped the leading `+`, turning valid E.164 into digit soup.
 */
export function phone(value: Textual, fallback = DASH): string {
    const s = toText(value);
    if (s == null) return fallback;
    const trimmed = s.trim();
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return fallback;
    if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (digits.length === 11 && digits.startsWith('1')) {
        return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return trimmed;
}

// ============================ time ============================

export type DurationUnit = 'ms' | 's' | 'm' | 'h' | 'd';

const UNIT_MS: Record<DurationUnit, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

const DURATION_PARTS: { name: string; short: string; ms: number }[] = [
    { name: 'day', short: 'd', ms: 86_400_000 },
    { name: 'hour', short: 'h', ms: 3_600_000 },
    { name: 'minute', short: 'm', ms: 60_000 },
    { name: 'second', short: 's', ms: 1000 },
];

export interface DurationOptions {
    /** `false` spells the units out: `2 hours 14 minutes`. */
    short?: boolean;
    /** How many units to show (default 2): `2h 14m`, not `2h 14m 3s`. */
    precision?: number;
    fallback?: string;
}

/**
 * `duration(8040000)` → `2h 14m`; `duration(8040, 's')` → the same.
 * Deviations: short form is the default (source: long) and its parts are
 * space-separated (source: `2h14m`). Sub-second values report as `500ms`.
 */
export function duration(value: Numeric, unit: DurationUnit = 'ms', opts: DurationOptions = {}): string {
    const n = toNumber(value);
    if (n == null) return opts.fallback ?? DASH;
    let scale = UNIT_MS[unit];
    if (scale == null) {
        warnOnce(`fmt.duration: unknown unit ${JSON.stringify(unit)} — falling back to 'ms'`);
        scale = 1;
    }
    const short = opts.short ?? true;
    const precision = Math.max(1, Math.trunc(opts.precision ?? 2));
    const ms = n * scale;
    if (ms === 0) return short ? '0s' : '0 seconds';

    const sign = ms < 0 ? '-' : '';
    let remaining = Math.abs(ms);
    const parts: string[] = [];
    for (const u of DURATION_PARTS) {
        if (remaining < u.ms) continue;
        const count = Math.floor(remaining / u.ms);
        remaining %= u.ms;
        parts.push(short ? `${count}${u.short}` : `${count} ${u.name}${count === 1 ? '' : 's'}`);
        if (parts.length >= precision) break;
    }
    if (parts.length === 0) {
        const rounded = Math.round(Math.abs(ms));
        return `${sign}${rounded}${short ? 'ms' : ` millisecond${rounded === 1 ? '' : 's'}`}`;
    }
    return sign + parts.join(' ');
}

/**
 * Compact age for chips and timelines: `3w`, `5h`, `now`. Magnitude only —
 * past and future read the same (use `relative` when direction matters).
 */
export function relativeShort(value: string | number | null | undefined, fallback = DASH): string {
    const d = toDate(value);
    if (!d) return fallback;
    const secs = Math.floor(Math.abs(Date.now() - d.getTime()) / 1000);
    const mins = Math.floor(secs / 60);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days > 365) return `${Math.floor(days / 365)}y`;
    if (days > 30) return `${Math.floor(days / 30)}mo`;
    if (days > 7) return `${Math.floor(days / 7)}w`;
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (mins > 0) return `${mins}m`;
    return 'now';
}

// ============================ booleans ============================

// Same coercion table as grouping.ts's groupByBoolean — one truth about what
// "false" looks like on the wire.
const STRING_FALSE = new Set(['false', '0', 'no', 'off']);

export interface YesNoOptions {
    yes?: string;
    no?: string;
    /** Shown for null/undefined/empty: unset is NOT the same answer as "No". */
    fallback?: string;
}

/** `yesNo(true)` → `Yes`. Empty arrays/objects read false, as in the source's `bool`. */
export function yesNo(value: unknown, opts: YesNoOptions = {}): string {
    const fallback = opts.fallback ?? DASH;
    if (value == null) return fallback;
    let b: boolean;
    if (typeof value === 'boolean') b = value;
    else if (typeof value === 'number') b = Number.isFinite(value) ? value !== 0 : false;
    else if (typeof value === 'string') {
        const lower = value.trim().toLowerCase();
        if (lower === '') return fallback;
        b = !STRING_FALSE.has(lower);
    } else if (Array.isArray(value)) b = value.length > 0;
    else if (typeof value === 'object') b = Object.keys(value).length > 0;
    else b = Boolean(value);
    return b ? (opts.yes ?? 'Yes') : (opts.no ?? 'No');
}
