// MetricsChart — the django-mojo metrics surface: fetches /api/metrics/fetch
// and owns the control bar. Ported from web-mojo's MetricsChart:
//   · inline granularity toggle  MIN HR DAY WK MO   (collapses to a <select>)
//   · quick ranges               1H 24H 7D 30D      + Custom range… dialog
//   · chart type switch          line / bar / area  (bars stack by default)
//   · stats summary + view-data dialogs (native <dialog>, CSV download)
//   · refresh + loading/error overlays with retry
//
// Wire note (C2): /api/metrics/fetch takes `dt_start`/`dt_end` (epoch
// SECONDS — objict.parse_date reads digit strings as epochs). web-mojo sent
// `dr_start`/`dr_end` here, which the metrics endpoint silently IGNORES
// (`dr_*` is the model-LIST daterange triple) — its custom ranges never
// reached the backend. This port sends dt_*. The `range` param rides along
// for quick ranges because the shipped mock windows off it; each side
// ignores the other's param.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mojoMetrics } from '../client/client';
import type { Params } from '../client/types';
import { DateRangePicker } from '../ui/date/DateRangePicker';
import { modal } from '../ui/modal';
import { showSeriesData, showSeriesStats } from './chart-dialogs';
import { SeriesChart, type ChartType } from './SeriesChart';
import { granularitiesForSpanMs, quickRangeWindow, ymdRangeToEpochSeconds } from './stats';

export interface Granularity { value: string; label: string; short: string }

export const GRANULARITIES: Granularity[] = [
    { value: 'minutes', label: 'Minutes', short: 'MIN' },
    { value: 'hours', label: 'Hours', short: 'HR' },
    { value: 'days', label: 'Days', short: 'DAY' },
    { value: 'weeks', label: 'Weeks', short: 'WK' },
    { value: 'months', label: 'Months', short: 'MO' },
];

export const QUICK_RANGES = [
    { value: '1h', label: '1H' },
    { value: '24h', label: '24H' },
    { value: '7d', label: '7D' },
    { value: '30d', label: '30D' },
];

/** Granularities that make sense for a range — mirrors the backend's buckets. */
const RANGE_GRANULARITY: Record<string, string[]> = {
    '1h': ['minutes'],
    '24h': ['minutes', 'hours'],
    '7d': ['hours', 'days'],
    '30d': ['days', 'weeks', 'months'],
};

const TYPES: { value: ChartType; icon: string; title: string }[] = [
    { value: 'line', icon: 'bi-graph-up', title: 'Line' },
    { value: 'bar', icon: 'bi-bar-chart-fill', title: 'Bar (stacked)' },
    { value: 'area', icon: 'bi-graph-up-arrow', title: 'Area' },
];

/** 'api_calls' → 'Api Calls' — the default legend name for an unmapped slug. */
function humanizeSlug(slug: string): string {
    return slug.split(/[_-]/).map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');
}

/** The active window: a quick range anchored at pick time, or custom days. */
type RangeState =
    | { kind: 'quick'; value: string; anchor: number }
    | { kind: 'custom'; start: string; end: string };

// ── Custom-range dialog (DateRangePicker inline + explicit Apply) ─────
function RangeDialog({ initial, onDone }: {
    initial: { start: string; end: string };
    onDone: (range: { start: string; end: string } | null) => void;
}) {
    const [range, setRange] = useState(initial);
    const complete = !!range.start && !!range.end;
    return (
        <div className="modal-pad chart-range-dialog">
            <h2 className="modal-title">Custom date range</h2>
            <DateRangePicker
                inline
                presets="default"
                start={range.start}
                end={range.end}
                onChange={(e) => setRange({ start: e.start, end: e.end })}
            />
            <div className="modal-actions">
                <button className="btn" onClick={() => onDone(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={!complete} onClick={() => onDone(range)}>
                    Apply
                </button>
            </div>
        </div>
    );
}

export interface MetricsChartProps {
    title: string;
    slugs: string[];
    /** Display names per slug — the wire only carries raw slugs. */
    seriesLabels?: Record<string, string>;
    /** 'public' | 'global' | 'group-<id>' | 'user-<id>'. */
    account?: string;
    defaultRange?: string;
    defaultGranularity?: string;
    defaultType?: ChartType;
    height?: number;
    /** Rendered in tooltips, Y ticks, and the stats/data dialogs. */
    valueFormatter?: (v: number) => string;
    /**
     * Forward-compatible passthrough for /api/metrics/fetch params the
     * component doesn't promote (category, child_kind, breakdown, …).
     * Spread FIRST — the built-ins overwrite any overlap. Developer-
     * controlled values only; they land on the URL.
     */
    apiParams?: Params;
    showGranularity?: boolean;
    /** Gates the quick ranges AND the custom-range dialog. */
    showDateRange?: boolean;
    showTypeSwitch?: boolean;
    showRefresh?: boolean;
    showStats?: boolean;
    showDataTable?: boolean;
}

export function MetricsChart({
    title,
    slugs,
    seriesLabels = {},
    account = 'global',
    defaultRange = '24h',
    defaultGranularity = 'hours',
    defaultType = 'line',
    height = 280,
    valueFormatter,
    apiParams,
    showGranularity = true,
    showDateRange = true,
    showTypeSwitch = true,
    showRefresh = true,
    showStats = true,
    showDataTable = true,
}: MetricsChartProps) {
    const [range, setRange] = useState<RangeState>(() => ({ kind: 'quick', value: defaultRange, anchor: Date.now() }));
    const [granularity, setGranularity] = useState(defaultGranularity);
    const [chartType, setChartType] = useState<ChartType>(defaultType);

    // ── Window → wire params + granularity gating ─────────────────────
    let allowed: string[];
    let dtStart: number;
    let dtEnd: number;
    if (range.kind === 'quick') {
        allowed = RANGE_GRANULARITY[range.value] ?? ['days'];
        const w = quickRangeWindow(range.value, range.anchor);
        dtStart = Math.floor(w.startMs / 1000);
        dtEnd = Math.floor(w.endMs / 1000);
    } else {
        const epochs = ymdRangeToEpochSeconds(range.start, range.end);
        // The dialog can only apply a complete pair; a bad pair degrades to
        // the default quick window rather than crashing the fetch.
        if (!epochs) {
            console.warn('MetricsChart: invalid custom range — falling back to 24h', range);
            const w = quickRangeWindow('24h');
            dtStart = Math.floor(w.startMs / 1000);
            dtEnd = Math.floor(w.endMs / 1000);
            allowed = RANGE_GRANULARITY['24h']!;
        } else {
            dtStart = epochs.dtStart;
            dtEnd = epochs.dtEnd;
            allowed = granularitiesForSpanMs((dtEnd - dtStart) * 1000);
        }
    }
    const effective = allowed.includes(granularity) ? granularity : allowed[allowed.length - 1]!;

    const wire: Params = {
        ...apiParams,
        slugs: slugs.join(','),
        granularity: effective,
        account,
        // `range` windows the shipped mock; dt_start/dt_end (epoch seconds)
        // window the real backend. Each ignores the other's param.
        ...(range.kind === 'quick' ? { range: range.value } : {}),
        dt_start: dtStart,
        dt_end: dtEnd,
    };

    const query = useQuery({
        queryKey: ['metrics', wire],
        queryFn: () => mojoMetrics(wire),
        select: (res) => ({
            ...res,
            datasets: res.datasets.map((d) => ({ ...d, label: seriesLabels[d.label] ?? humanizeSlug(d.label) })),
        }),
    });

    // Switching range re-points granularity at the nearest sensible bucket
    // rather than firing a request the backend would bucket differently.
    const pickRange = (next: string) => {
        setRange({ kind: 'quick', value: next, anchor: Date.now() });
        const ok = RANGE_GRANULARITY[next] ?? ['days'];
        if (!ok.includes(granularity)) setGranularity(ok[ok.length - 1]!);
    };

    const openCustomRange = async () => {
        const initial = range.kind === 'custom' ? { start: range.start, end: range.end } : { start: '', end: '' };
        const picked = await modal.open<{ start: string; end: string } | null>((close) => (
            <RangeDialog initial={initial} onDone={close} />
        ), { size: 'md' });
        if (!picked) return;
        setRange({ kind: 'custom', start: picked.start, end: picked.end });
        const epochs = ymdRangeToEpochSeconds(picked.start, picked.end);
        if (epochs) {
            const ok = granularitiesForSpanMs((epochs.dtEnd - epochs.dtStart) * 1000);
            if (!ok.includes(granularity)) setGranularity(ok[ok.length - 1]!);
        }
    };

    // Refresh re-anchors a quick window at NOW (web-mojo kept the stale
    // window — deliberate fix, documented in charts.md).
    const refresh = () => {
        if (range.kind === 'quick') setRange({ ...range, anchor: Date.now() });
        void query.refetch();
    };

    const openStats = () => {
        void showSeriesStats({
            title: `${title} — Stats`,
            labels: query.data?.labels ?? [],
            datasets: query.data?.datasets ?? [],
            granularity: effective,
            formatter: valueFormatter,
        });
    };
    const openData = () => {
        void showSeriesData({
            title,
            labels: query.data?.labels ?? [],
            datasets: query.data?.datasets ?? [],
            granularity: effective,
            formatter: valueFormatter,
        });
    };

    const customActive = range.kind === 'custom';
    const customTitle = customActive ? `Custom range: ${range.start} – ${range.end}` : 'Custom range…';

    return (
        <div className="panel panel-pad chart-panel">
            <div className="chart-head">
                <div>
                    <div className="eyebrow">Metrics</div>
                    <h3 className="panel-subtitle">
                        {title}
                        {customActive && <span className="chart-range-chip">{range.start} – {range.end}</span>}
                    </h3>
                </div>
                <div className="chart-controls">
                    {showGranularity && (
                        <>
                            <div className="seg seg-xs gran-toggle" role="group" aria-label="Granularity">
                                {GRANULARITIES.map((g) => {
                                    const enabled = allowed.includes(g.value);
                                    return (
                                        <button
                                            key={g.value}
                                            className={`seg-btn${effective === g.value ? ' seg-active' : ''}`}
                                            disabled={!enabled}
                                            title={enabled ? g.label : `${g.label} — not available for this range`}
                                            onClick={() => setGranularity(g.value)}
                                        >
                                            {g.short}
                                        </button>
                                    );
                                })}
                            </div>
                            <select
                                className="input input-compact gran-select"
                                value={effective}
                                onChange={(e) => setGranularity(e.target.value)}
                                aria-label="Granularity"
                            >
                                {GRANULARITIES.filter((g) => allowed.includes(g.value)).map((g) => (
                                    <option key={g.value} value={g.value}>{g.label}</option>
                                ))}
                            </select>
                        </>
                    )}

                    {showDateRange && (
                        <div className="seg seg-xs" role="group" aria-label="Date range">
                            {QUICK_RANGES.map((r) => (
                                <button
                                    key={r.value}
                                    className={`seg-btn${range.kind === 'quick' && range.value === r.value ? ' seg-active' : ''}`}
                                    onClick={() => pickRange(r.value)}
                                >
                                    {r.label}
                                </button>
                            ))}
                            <button
                                className={`seg-btn${customActive ? ' seg-active' : ''}`}
                                title={customTitle}
                                aria-label="Custom date range"
                                onClick={() => void openCustomRange()}
                            >
                                <i className="bi bi-calendar-range" />
                            </button>
                        </div>
                    )}

                    {showTypeSwitch && (
                        <div className="seg seg-xs" role="group" aria-label="Chart type">
                            {TYPES.map((t) => (
                                <button
                                    key={t.value}
                                    className={`seg-btn${chartType === t.value ? ' seg-active' : ''}`}
                                    title={t.title}
                                    onClick={() => setChartType(t.value)}
                                >
                                    <i className={`bi ${t.icon}`} />
                                </button>
                            ))}
                        </div>
                    )}

                    {showStats && (
                        <button className="btn-icon" title="Stats" aria-label="Stats" onClick={openStats}>
                            <i className="bi bi-info-circle" />
                        </button>
                    )}
                    {showDataTable && (
                        <button className="btn-icon" title="View data" aria-label="View data" onClick={openData}>
                            <i className="bi bi-table" />
                        </button>
                    )}
                    {showRefresh && (
                        <button className="btn-icon" title="Refresh" aria-label="Refresh" onClick={refresh}>
                            <i className={`bi bi-arrow-repeat${query.isFetching ? ' spin' : ''}`} />
                        </button>
                    )}
                </div>
            </div>

            <div className="chart-body" style={{ minHeight: height }}>
                {query.isPending ? (
                    <div className="chart-overlay"><span className="skel skel-block" /></div>
                ) : query.isError ? (
                    <div className="chart-overlay">
                        <div className="chart-error">
                            <i className="bi bi-exclamation-triangle" />
                            <span>{query.error instanceof Error ? query.error.message : 'Failed to load metrics'}</span>
                            <button className="btn btn-compact" onClick={() => void query.refetch()}>Retry</button>
                        </div>
                    </div>
                ) : (
                    <SeriesChart
                        labels={query.data!.labels}
                        datasets={query.data!.datasets}
                        chartType={chartType}
                        height={height}
                        valueFormatter={valueFormatter}
                    />
                )}
            </div>
        </div>
    );
}
