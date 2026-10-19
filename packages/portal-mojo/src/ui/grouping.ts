// Built-in `groupBy*` helpers for ModelTable — the web-mojo grouping.js port
// (src/core/views/list/grouping.js), operating on plain rows instead of Model
// instances. Each helper returns `{ groupBy, groupHeaderLabel }` ready to
// spread into ModelTable props. Group keys are STABLE bucket ids (sort-
// ordered where that matters) and labels are formatted separately.
//
// A falsy key means "ungrouped tail": the row renders without a new header,
// visually continuing the prior section.
import { calendarParts, toDateSmart } from './date/fns';

// Interfaces without index signatures (User, …) aren't assignable to
// Record<string, unknown> under strict TS, so the row constraint is plain
// `object` and field access goes through one localized cast.
type Row = object;
type Accessor<T> = (row: T) => unknown;

function resolveAccessor<T extends Row>(fieldOrAccessor: string | Accessor<T>): Accessor<T> {
    if (typeof fieldOrAccessor === 'function') return fieldOrAccessor;
    return (row: T) => (row as Record<string, unknown>)[fieldOrAccessor];
}

/** Epoch seconds / ms / numeric string / ISO / Date → local Date, or null.
 *  One shared sniffer (date/fns detectTemporal) so a grouped bucket and the
 *  cell rendered inside it can never disagree about what day a row is on. */
const toDate = toDateSmart;

/** YYYY-MM-DD from calendar fields; the 4-digit year keeps keys sortable. */
function partsKey(y: number, m: number, d: number): string {
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Stable local-time YYYY-MM-DD bucket key. */
function isoDayKey(date: Date): string {
    return partsKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** The day a value is ON, as a key. A date-only value ('YYYY-MM-DD') keys by
 *  its own fields and never passes through a local Date (local midnight can
 *  be skipped by a zone, and `new Date(99, …)` means 1999), so it buckets
 *  under that day in every zone; an instant is read in local time as before. */
interface DayOf { key: string; y: number; m: number; instant: Date | null }
function dayOf(raw: unknown): DayOf | null {
    const p = calendarParts(raw);
    if (!p) return null;
    if (p.precision !== 'instant') return { key: partsKey(p.y, p.m, p.d), y: p.y, m: p.m, instant: null };
    const date = toDate(raw);
    return date ? { key: isoDayKey(date), y: date.getFullYear(), m: date.getMonth() + 1, instant: date } : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDayLabel(key: string): string {
    const parts = key.split('-');
    if (parts.length !== 3) return key;
    const [year, month, day] = parts.map(Number) as [number, number, number];
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return key;
    const now = new Date();
    if (key === isoDayKey(now)) return 'Today';
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (key === isoDayKey(yesterday)) return 'Yesterday';
    const label = `${MONTHS[month - 1] ?? ''} ${day}`;
    return year === now.getFullYear() ? label : `${label}, ${String(year).padStart(4, '0')}`;
}

export interface GroupSpec<T> {
    groupBy: (row: T) => string | null;
    groupHeaderLabel: (key: string) => string;
}

/** Day buckets for chronological feeds: Today / Yesterday / Apr 25 / Dec 19, 2025. */
export function groupByDay<T extends Row>(fieldOrAccessor: string | Accessor<T>): GroupSpec<T> {
    const access = resolveAccessor(fieldOrAccessor);
    return {
        groupBy: (row) => {
            return dayOf(access(row))?.key ?? null;
        },
        groupHeaderLabel: formatDayLabel,
    };
}

/**
 * Categorical bucketing on a field's string value. `labels` wins over
 * `format`; `fallback` names the bucket for null/undefined/'' (default:
 * ungrouped tail). `0`/`false` stringify and DO bucket.
 */
export function groupByField<T extends Row>(
    fieldOrAccessor: string | Accessor<T>,
    opts: { labels?: Record<string, string>; format?: (key: string) => string; fallback?: string } = {},
): GroupSpec<T> {
    const access = resolveAccessor(fieldOrAccessor);
    return {
        groupBy: (row) => {
            const raw = access(row);
            if (raw == null || raw === '') return opts.fallback != null ? String(opts.fallback) : null;
            return String(raw);
        },
        groupHeaderLabel: (key) => {
            if (opts.labels && Object.prototype.hasOwnProperty.call(opts.labels, key)) return opts.labels[key]!;
            if (opts.format) return opts.format(key);
            return key;
        },
    };
}

// Sort-ordered keys so a descending-by-date sort renders buckets in natural
// reading order (Today on top, Older on bottom).
const RECENCY_LABELS: Record<string, string> = {
    'recency-0-today': 'Today',
    'recency-1-yesterday': 'Yesterday',
    'recency-2-this-week': 'This week',
    'recency-3-this-month': 'This month',
    'recency-4-this-year': 'Earlier this year',
    'recency-5-older': 'Older',
};

function recencyBucketKey(day: DayOf | null): string | null {
    if (!day) return null;
    const now = new Date();
    if (day.key === isoDayKey(now)) return 'recency-0-today';
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (day.key === isoDayKey(yesterday)) return 'recency-1-yesterday';
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    // An instant compares as an instant; a date-only day compares by key.
    if (day.instant ? day.instant >= sevenDaysAgo : day.key >= isoDayKey(sevenDaysAgo)) return 'recency-2-this-week';
    if (day.y === now.getFullYear() && day.m === now.getMonth() + 1) return 'recency-3-this-month';
    if (day.y === now.getFullYear()) return 'recency-4-this-year';
    return 'recency-5-older';
}

/** Six fixed buckets relative to now: Today … Older. */
export function groupByRecency<T extends Row>(fieldOrAccessor: string | Accessor<T>): GroupSpec<T> {
    const access = resolveAccessor(fieldOrAccessor);
    return {
        groupBy: (row) => recencyBucketKey(dayOf(access(row))),
        groupHeaderLabel: (key) => RECENCY_LABELS[key] ?? key,
    };
}

const STRING_FALSE = new Set(['false', '0', 'no', 'off']);

/** Binary split. Missing/empty values fall to the ungrouped tail, not "false". */
export function groupByBoolean<T extends Row>(
    fieldOrAccessor: string | Accessor<T>,
    opts: { trueLabel?: string; falseLabel?: string } = {},
): GroupSpec<T> {
    const access = resolveAccessor(fieldOrAccessor);
    const trueLabel = opts.trueLabel ?? 'Yes';
    const falseLabel = opts.falseLabel ?? 'No';
    return {
        groupBy: (row) => {
            const raw = access(row);
            if (raw == null || raw === '') return null;
            let b: boolean;
            if (typeof raw === 'boolean') b = raw;
            else if (typeof raw === 'number') b = raw !== 0;
            else if (typeof raw === 'string') {
                const lower = raw.trim().toLowerCase();
                if (lower === '') return null;
                b = !STRING_FALSE.has(lower);
            } else b = Boolean(raw);
            return b ? 'true' : 'false';
        },
        groupHeaderLabel: (key) => (key === 'true' ? trueLabel : key === 'false' ? falseLabel : key),
    };
}
