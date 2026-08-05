// MetricsChart — the django-mojo metrics surface: fetches /api/metrics/fetch
// and owns the control bar. Ported from web-mojo's MetricsChart:
//   · inline granularity toggle  MIN HR DAY WK MO   (collapses to a <select>)
//   · quick ranges               1H 24H 7D 30D
//   · chart type switch          line / bar / area  (bars stack by default)
//   · refresh + loading/error overlays with retry
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mojoMetrics } from '../client/client';
import { SeriesChart, type ChartType } from './SeriesChart';

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

export function MetricsChart({ title, slugs, seriesLabels = {}, defaultRange = '24h', defaultGranularity = 'hours', defaultType = 'line', height = 280 }: {
    title: string;
    slugs: string[];
    /** Display names per slug — the wire only carries raw slugs. */
    seriesLabels?: Record<string, string>;
    defaultRange?: string;
    defaultGranularity?: string;
    defaultType?: ChartType;
    height?: number;
}) {
    const [range, setRange] = useState(defaultRange);
    const [granularity, setGranularity] = useState(defaultGranularity);
    const [chartType, setChartType] = useState<ChartType>(defaultType);

    const allowed = RANGE_GRANULARITY[range] ?? ['days'];
    const effective = allowed.includes(granularity) ? granularity : allowed[allowed.length - 1]!;

    const query = useQuery({
        queryKey: ['metrics', slugs, range, effective],
        queryFn: () => mojoMetrics({ slugs: slugs.join(','), range, granularity: effective }),
        select: (res) => ({
            ...res,
            datasets: res.datasets.map((d) => ({ ...d, label: seriesLabels[d.label] ?? humanizeSlug(d.label) })),
        }),
    });

    // Switching range re-points granularity at the nearest sensible bucket
    // rather than firing a request the backend would bucket differently.
    const pickRange = (next: string) => {
        setRange(next);
        const ok = RANGE_GRANULARITY[next] ?? ['days'];
        if (!ok.includes(granularity)) setGranularity(ok[ok.length - 1]!);
    };

    return (
        <div className="panel panel-pad chart-panel">
            <div className="chart-head">
                <div>
                    <div className="eyebrow">Metrics</div>
                    <h3 className="panel-subtitle">{title}</h3>
                </div>
                <div className="chart-controls">
                    <div className="seg seg-xs gran-toggle" role="group" aria-label="Granularity">
                        {GRANULARITIES.map((g) => {
                            const enabled = allowed.includes(g.value);
                            return (
                                <button
                                    key={g.value}
                                    className={`seg-btn${effective === g.value ? ' seg-active' : ''}`}
                                    disabled={!enabled}
                                    title={enabled ? g.label : `${g.label} — not available for ${range.toUpperCase()}`}
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

                    <div className="seg seg-xs" role="group" aria-label="Date range">
                        {QUICK_RANGES.map((r) => (
                            <button
                                key={r.value}
                                className={`seg-btn${range === r.value ? ' seg-active' : ''}`}
                                onClick={() => pickRange(r.value)}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>

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

                    <button className="btn-icon" title="Refresh" onClick={() => query.refetch()}>
                        <i className={`bi bi-arrow-repeat${query.isFetching ? ' spin' : ''}`} />
                    </button>
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
                            <button className="btn btn-compact" onClick={() => query.refetch()}>Retry</button>
                        </div>
                    </div>
                ) : (
                    <SeriesChart
                        labels={query.data!.labels}
                        datasets={query.data!.datasets}
                        chartType={chartType}
                        height={height}
                    />
                )}
            </div>
        </div>
    );
}
