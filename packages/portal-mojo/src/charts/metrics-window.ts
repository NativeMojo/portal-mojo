import { granularitiesForSpanMs, QUICK_RANGE_MS } from './stats';

export interface Granularity { value: string; label: string; short: string }
/** All bounds are epoch seconds. Absence of range denotes a custom window. */
export interface MetricsChartWindow {
    dt_start: number;
    dt_end: number;
    granularity: string;
    range?: string;
}
export interface MetricsQuickRange { value: string; label: string; durationMs: number }

export const GRANULARITIES: Granularity[] = [
    { value: 'minutes', label: 'Minutes', short: 'MIN' },
    { value: 'hours', label: 'Hours', short: 'HR' },
    { value: 'days', label: 'Days', short: 'DAY' },
    { value: 'weeks', label: 'Weeks', short: 'WK' },
    { value: 'months', label: 'Months', short: 'MO' },
];

export const QUICK_RANGES: MetricsQuickRange[] = [
    { value: '1h', label: '1H', durationMs: QUICK_RANGE_MS['1h']! },
    { value: '24h', label: '24H', durationMs: QUICK_RANGE_MS['24h']! },
    { value: '7d', label: '7D', durationMs: QUICK_RANGE_MS['7d']! },
    { value: '30d', label: '30D', durationMs: QUICK_RANGE_MS['30d']! },
];

/** Granularities that make sense for a range — mirrors the backend's buckets. */
const RANGE_GRANULARITY: Record<string, string[]> = {
    '1h': ['minutes'],
    '24h': ['minutes', 'hours'],
    '7d': ['hours', 'days'],
    '30d': ['days', 'weeks', 'months'],
};

/** Range gating narrows the source capability list; an explicit empty list stays empty. */
export function metricsGranularities(window: MetricsChartWindow, configured?: readonly string[]): string[] {
    const supported = GRANULARITIES.map((g) => g.value).filter((g) => !configured || configured.includes(g));
    const fit = window.range && RANGE_GRANULARITY[window.range]
        || granularitiesForSpanMs((window.dt_end - window.dt_start) * 1000);
    const available = supported.filter((g) => fit.includes(g));
    return available.length ? available : supported;
}

export function metricsQuickWindow(range: string | MetricsQuickRange, granularity = 'hours', nowMs = Date.now()): MetricsChartWindow {
    let preset = typeof range === 'string' ? QUICK_RANGES.find((r) => r.value === range) : range;
    if (!preset || !Number.isFinite(preset.durationMs) || preset.durationMs <= 0) {
        console.warn('MetricsChart: invalid quick range — falling back to 24h');
        preset = QUICK_RANGES[1]!;
    }
    return { range: preset.value, granularity, dt_start: Math.floor((nowMs - preset.durationMs) / 1000), dt_end: Math.floor(nowMs / 1000) };
}

export function metricsDateLabel(seconds: number): string {
    const d = new Date(seconds * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
