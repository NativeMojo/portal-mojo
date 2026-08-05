// Built-in `groupBy*` helpers for ModelTable — the web-mojo grouping.js port
// (src/core/views/list/grouping.js), operating on plain rows instead of Model
// instances. Each helper returns `{ groupBy, groupHeaderLabel }` ready to
// spread into ModelTable props. Group keys are STABLE bucket ids (sort-
// ordered where that matters) and labels are formatted separately.
//
// A falsy key means "ungrouped tail": the row renders without a new header,
// visually continuing the prior section.
import { toDateSmart } from './date/fns';

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

/** Stable local-time YYYY-MM-DD bucket key. */
function isoDayKey(date: Date): string {
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${m}-${d}`;
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
    return year === now.getFullYear() ? label : `${label}, ${year}`;
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
            const date = toDate(access(row));
            return date ? isoDayKey(date) : null;
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

function recencyBucketKey(date: Date | null): string | null {
    if (!date) return null;
    const now = new Date();
    const dateKey = isoDayKey(date);
    if (dateKey === isoDayKey(now)) return 'recency-0-today';
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (dateKey === isoDayKey(yesterday)) return 'recency-1-yesterday';
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    if (date >= sevenDaysAgo) return 'recency-2-this-week';
    if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) return 'recency-3-this-month';
    if (date.getFullYear() === now.getFullYear()) return 'recency-4-this-year';
    return 'recency-5-older';
}

/** Six fixed buckets relative to now: Today … Older. */
export function groupByRecency<T extends Row>(fieldOrAccessor: string | Accessor<T>): GroupSpec<T> {
    const access = resolveAccessor(fieldOrAccessor);
    return {
        groupBy: (row) => recencyBucketKey(toDate(access(row))),
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
