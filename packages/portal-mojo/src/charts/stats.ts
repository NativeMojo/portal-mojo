// Pure chart math — no DOM, no React. Ported from the private helpers of
// web-mojo's MetricsChart (_computeStats/_formatStatNumber/_downloadCsv/
// setQuickRange) and MetricsMiniChartWidget (windowed trending), promoted to
// typed exports so stats dialogs, KPI tiles and the mini widget share ONE
// implementation (web-mojo carried two diverging copies of the stats math).

export interface SeriesLike {
    label: string;
    data: number[];
}

export interface SeriesStat {
    label: string;
    count: number;
    sum: number;
    avg: number;
    median: number;
    min: number;
    max: number;
    latest: number;
}

/** Coerce a wire value to a number the way the source did (parseFloat || 0). */
export function toNumber(v: unknown): number {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (v == null || v === '') return 0;
    const n = parseFloat(String(v));
    return Number.isNaN(n) ? 0 : n;
}

/**
 * Per-series summary stats. Empty datasets produce no entry (the caller
 * renders its "No data" state); an empty series inside a non-empty set
 * yields a zeroed row so the table stays aligned with the legend.
 */
export function computeSeriesStats(datasets: readonly SeriesLike[] | null | undefined): SeriesStat[] {
    // (Array.isArray would widen the readonly array to any[] — a TS quirk.)
    const list: readonly SeriesLike[] = datasets ?? [];
    return list.map((d) => {
        const values = (Array.isArray(d.data) ? d.data : []).map(toNumber);
        if (values.length === 0) {
            return { label: d.label ?? '', count: 0, sum: 0, avg: 0, median: 0, min: 0, max: 0, latest: 0 };
        }
        const sorted = [...values].sort((a, b) => a - b);
        const sum = values.reduce((a, b) => a + b, 0);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
        return {
            label: d.label ?? '',
            count: values.length,
            sum,
            avg: sum / values.length,
            median,
            min: sorted[0]!,
            max: sorted[sorted.length - 1]!,
            latest: values[values.length - 1]!,
        };
    });
}

/** '–' for nothing; integers plain; decimals to 2 places (source parity). */
export function defaultStatFormat(n: number | null | undefined): string {
    if (n == null || Number.isNaN(n)) return '–';
    if (Number.isInteger(n)) return n.toLocaleString();
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** "Hourly · 24 points" header noun per granularity (source map, verbatim). */
export const GRANULARITY_NOUN: Record<string, string> = {
    minutes: 'Per minute',
    hours: 'Hourly',
    days: 'Daily',
    weeks: 'Weekly',
    months: 'Monthly',
    years: 'Yearly',
};

// ── CSV (source _downloadCsv, split so the string builder is testable) ──

export function csvEscape(v: unknown): string {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
    const lines = [headers.map(csvEscape).join(',')];
    for (const row of rows) lines.push(row.map(csvEscape).join(','));
    return lines.join('\n');
}

/** 'API Calls — prod' + today → 'api-calls-prod-2026-08-05.csv' (source slugging). */
export function csvFilename(title: string | null | undefined, now: Date = new Date()): string {
    const slug = String(title ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'chart-data';
    return `${slug}-${now.toISOString().slice(0, 10)}.csv`;
}

// ── Trend windows (MetricsMiniChartWidget.updateFromChartData, verbatim) ──

export interface TrendOptions {
    /** Window size hint; k = max(1, floor(trendRange / 2)) buckets per window. */
    trendRange?: number | null;
    /** Skip the trailing N buckets before comparing (partial-bucket guard). */
    trendOffset?: number | null;
    /** Compare against the window N buckets earlier instead of the adjacent one. */
    prevTrendOffset?: number | null;
}

export interface Trend {
    /** Sum over the current window. */
    lastSum: number;
    /** Sum over the comparison window. */
    prevSum: number;
    /** Percent change; prev 0 → +100 when rising, 0 when flat (source rule). */
    percent: number;
    up: boolean;
}

/**
 * Windowed percent trend over a bucket series. Falls back to single-point
 * comparison when the series is too short for two full windows; returns null
 * when there is nothing to compare (0–1 usable points).
 */
export function computeTrend(values: readonly number[] | null | undefined, opts: TrendOptions = {}): Trend | null {
    const nums = (values ?? []).map(toNumber);
    if (nums.length === 0) return null;

    const offset = Math.max(0, Math.trunc(opts.trendOffset ?? 0) || 0);
    const endIndex = Math.max(0, nums.length - 1 - offset);
    const prevOffset = Math.max(0, Math.trunc(opts.prevTrendOffset ?? 0) || 0);
    const k = opts.trendRange != null && opts.trendRange >= 2 ? Math.max(1, Math.floor(opts.trendRange / 2)) : 1;

    const sumRange = (s: number, e: number): number => {
        let sum = 0;
        for (let i = s; i <= e; i++) sum += nums[i] ?? 0;
        return sum;
    };

    let lastSum = 0;
    let prevSum = 0;
    let hasTrend = false;

    const lastEnd = endIndex;
    const lastStart = lastEnd - (k - 1);
    let prevStart: number;
    let prevEnd: number;
    if (prevOffset > 0) {
        prevStart = lastStart - prevOffset;
        prevEnd = lastEnd - prevOffset;
    } else {
        prevEnd = lastStart - 1;
        prevStart = prevEnd - (k - 1);
    }
    if (lastStart >= 0 && prevStart >= 0) {
        lastSum = sumRange(lastStart, lastEnd);
        prevSum = sumRange(prevStart, prevEnd);
        hasTrend = true;
    }

    if (!hasTrend) {
        // Single-point fallback (source parity).
        const prevIndex = endIndex - (prevOffset > 0 ? prevOffset : 1);
        if (prevIndex < 0) return null;
        lastSum = nums[endIndex] ?? 0;
        prevSum = nums[prevIndex] ?? 0;
    }

    const percent = prevSum === 0 ? (lastSum > 0 ? 100 : 0) : ((lastSum - prevSum) / Math.abs(prevSum)) * 100;
    return { lastSum, prevSum, percent, up: percent >= 0 };
}

/**
 * Delta badge text + tone (KPITile._renderDelta, verbatim incl. the
 * never-Infinity% rule): a finite deltaPct renders as a percent; otherwise a
 * present absolute delta renders as a signed count; otherwise no badge.
 * `direction` maps through `tone` ('bad' = rising is bad) to a display tone.
 */
export interface DeltaBadge {
    text: string;
    /** 'good' | 'bad' | 'flat' | 'neutral' — the CSS class family. */
    tone: 'good' | 'bad' | 'flat' | 'neutral';
}

export function deltaBadge(
    delta: number | null | undefined,
    deltaPct: number | null | undefined,
    tone: 'good' | 'bad' | null | undefined,
): DeltaBadge | null {
    let sign: '+' | '−' | '±';
    let text: string;
    if (deltaPct != null && Number.isFinite(deltaPct)) {
        const rounded = Math.abs(deltaPct) >= 10 ? Math.round(deltaPct) : Math.round(deltaPct * 10) / 10;
        sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '±';
        text = `${sign}${Math.abs(rounded)}%`;
    } else if (delta != null && Number.isFinite(delta)) {
        sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
        text = `${sign}${Math.abs(delta)}`;
    } else {
        return null;
    }
    let badgeTone: DeltaBadge['tone'];
    if (sign === '±') badgeTone = 'flat';
    else if (tone === 'bad') badgeTone = sign === '+' ? 'bad' : 'good';
    else if (tone === 'good') badgeTone = sign === '+' ? 'good' : 'bad';
    else badgeTone = 'neutral';
    return { text, tone: badgeTone };
}

// ── Date windows (MetricsChart.setQuickRange + custom-range support) ──

/** Quick-range span in ms. Unknown values warn at the caller; '24h' shape. */
export const QUICK_RANGE_MS: Record<string, number> = {
    '1h': 3600e3,
    '24h': 24 * 3600e3,
    '7d': 7 * 864e5,
    '30d': 30 * 864e5,
};

/** [start, end] ms epochs for a quick range anchored at `now` (source setQuickRange). */
export function quickRangeWindow(range: string, now: number = Date.now()): { startMs: number; endMs: number } {
    const span = QUICK_RANGE_MS[range] ?? QUICK_RANGE_MS['24h']!;
    return { startMs: now - span, endMs: now };
}

/**
 * Which granularities make sense for an arbitrary span — the custom-range
 * twin of MetricsChart's per-quick-range gating (mirrors the backend's
 * bucket sizes; a 6-month range at 'minutes' would be a quarter-million
 * buckets).
 */
export function granularitiesForSpanMs(spanMs: number): string[] {
    const h = spanMs / 3600e3;
    if (h <= 2) return ['minutes'];
    if (h <= 48) return ['minutes', 'hours'];
    if (h <= 8 * 24) return ['hours', 'days'];
    if (h <= 92 * 24) return ['days', 'weeks', 'months'];
    return ['days', 'weeks', 'months'];
}

/**
 * Canonical YYYY-MM-DD pair (DateRangePicker output) → inclusive epoch-SECOND
 * bounds in the viewer's local time: start 00:00:00 through end 23:59:59.
 * These are the `dt_start`/`dt_end` values /api/metrics/fetch takes (epoch
 * seconds — the django-mojo datetime wire unit). Invalid input → null.
 */
export function ymdRangeToEpochSeconds(startYmd: string, endYmd: string): { dtStart: number; dtEnd: number } | null {
    const parse = (s: string): [number, number, number] | null => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (!m) return null;
        return [Number(m[1]), Number(m[2]), Number(m[3])];
    };
    const a = parse(startYmd);
    const b = parse(endYmd);
    if (!a || !b) return null;
    const start = new Date(a[0], a[1] - 1, a[2], 0, 0, 0, 0).getTime();
    const end = new Date(b[0], b[1] - 1, b[2] + 1, 0, 0, 0, 0).getTime() - 1000; // 23:59:59
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
    return { dtStart: Math.floor(start / 1000), dtEnd: Math.floor(end / 1000) };
}
