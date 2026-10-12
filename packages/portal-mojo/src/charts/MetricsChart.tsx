// Query-owning django-mojo adapter over the shared MetricsChartView.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mojoMetrics, type MetricsResponse } from '../client/client';
import type { Params } from '../client/types';
import type { ChartType } from './SeriesChart';
import { MetricsChartView } from './MetricsChartView';
import { metricsGranularities, metricsQuickWindow, type MetricsChartWindow } from './metrics-window';
export { GRANULARITIES, QUICK_RANGES, type Granularity } from './metrics-window';

export interface MetricsFetchParams extends Params {
    slugs: string;
    account: string;
    granularity: string;
    dt_start: number;
    dt_end: number;
    child_kind?: string;
    breakdown?: boolean;
}

export type MetricsSeriesLoader = (params: MetricsFetchParams) => Promise<MetricsResponse>;

/** 'api_calls' → 'Api Calls' — the default legend name for an unmapped slug. */
function humanizeSlug(slug: string): string {
    return slug.split(/[_-]/).map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');
}

function metricTail(slug: string): string {
    return slug.split(':').at(-1) ?? slug;
}

/**
 * Live `/fetch` labels datasets with only the final colon segment. Repair
 * that identity for default chart callers when the configured slug set makes
 * the mapping unique. A duplicate tail remains an error: only an exact loader
 * can safely split and reassemble those requests.
 */
export function remapMetricSeriesIdentity(response: MetricsResponse, requestedSlugs: readonly string[]): MetricsResponse {
    const requested = [...new Set(requestedSlugs)];
    const requestedSet = new Set(requested);
    const byTail = new Map<string, string[]>();
    for (const slug of requested) {
        const tail = metricTail(slug);
        byTail.set(tail, [...(byTail.get(tail) ?? []), slug]);
    }
    return {
        ...response,
        datasets: response.datasets.map((dataset) => {
            if (requestedSet.has(dataset.label)) return dataset;
            const candidates = byTail.get(dataset.label) ?? [];
            if (candidates.length > 1) {
                throw new Error(`MetricsChart: response key "${dataset.label}" is ambiguous for ${candidates.join(', ')}; use an exact series loader.`);
            }
            return candidates.length === 1 ? { ...dataset, label: candidates[0]! } : dataset;
        }),
    };
}

export interface MetricsChartProps {
    title: string;
    slugs: string[];
    /** Display names per slug — the wire only carries raw slugs. */
    seriesLabels?: Record<string, string>;
    /** Keep loader-provided identities verbatim (full slugs or fan-out child labels). */
    preserveSeriesLabels?: boolean;
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
     * component doesn't promote (for example category). Fan-out uses the
     * typed childKind/breakdown props below.
     * Spread FIRST — the built-ins overwrite any overlap. Developer-
     * controlled values only; they land on the URL.
     */
    apiParams?: Params;
    /** Typed history boundary. Existing callers retain the lossy shared loader. */
    loadSeries?: MetricsSeriesLoader;
    /** Stable cache namespace; custom loaders must not share default results. */
    seriesCacheKey?: string;
    /** Group fan-out child kind. Built in here so it overwrites apiParams. */
    childKind?: string;
    /** Fan-out breakdown. Built in here so it overwrites apiParams. */
    breakdown?: boolean;
    showGranularity?: boolean;
    /** Gates the quick ranges AND the custom-range dialog. */
    showDateRange?: boolean;
    showTypeSwitch?: boolean;
    showRefresh?: boolean;
    showStats?: boolean;
    showDataTable?: boolean;
    /** Optional backend capability subset; unsupported controls are omitted. */
    allowedGranularities?: string[];
    /** Changing this value requests one refresh from an owning parent. */
    refreshSignal?: unknown;
}

export function MetricsChart({
    title, slugs, seriesLabels = {}, preserveSeriesLabels = false, account = 'global',
    defaultRange = '24h', defaultGranularity = 'hours', defaultType = 'line',
    height = 280, valueFormatter, apiParams, loadSeries = mojoMetrics,
    seriesCacheKey = 'metrics/fetch', childKind, breakdown, allowedGranularities,
    refreshSignal, ...controls
}: MetricsChartProps) {
    const [window, setWindow] = useState<MetricsChartWindow>(() => metricsQuickWindow(defaultRange, defaultGranularity));
    const available = metricsGranularities(window, allowedGranularities);
    const effective = available.includes(window.granularity) ? window.granularity : available.at(-1) ?? window.granularity;
    const wire: MetricsFetchParams = {
        ...apiParams,
        ...(childKind ? { child_kind: childKind } : {}),
        ...(breakdown !== undefined ? { breakdown } : {}),
        slugs: slugs.join(','), granularity: effective, account,
        ...(window.range ? { range: window.range } : {}),
        dt_start: window.dt_start, dt_end: window.dt_end,
    };
    const query = useQuery({
        queryKey: ['metrics', seriesCacheKey, wire],
        queryFn: () => loadSeries(wire),
        select: (res) => {
            const identitySafe = loadSeries === mojoMetrics ? remapMetricSeriesIdentity(res, slugs) : res;
            return {
                ...identitySafe,
                datasets: identitySafe.datasets.map((d) => ({
                    ...d,
                    label: seriesLabels[d.label] ?? (preserveSeriesLabels ? d.label : humanizeSlug(d.label)),
                })),
            };
        },
    });
    const refresh = () => {
        const next = window.range ? metricsQuickWindow(window.range, effective) : window;
        // A pick and refresh in the same second have the same query key: refetch
        // once. Otherwise the re-anchored key itself owns the one request.
        if (next.dt_start !== window.dt_start || next.dt_end !== window.dt_end) setWindow(next);
        else void query.refetch();
    };
    const priorRefreshSignal = useRef(refreshSignal);
    useEffect(() => {
        if (Object.is(priorRefreshSignal.current, refreshSignal)) return;
        priorRefreshSignal.current = refreshSignal;
        refresh();
    }, [refreshSignal]);

    return <MetricsChartView {...controls}
        title={title} window={{ ...window, granularity: effective }} onWindowChange={setWindow}
        labels={query.data?.labels ?? []} datasets={query.data?.datasets ?? []}
        defaultType={defaultType} height={height} valueFormatter={valueFormatter}
        allowedGranularities={allowedGranularities} onRefresh={refresh}
        onRetry={() => { void query.refetch(); }} loading={query.isPending}
        isFetching={query.isFetching} error={query.isError ? query.error : undefined}
    />;
}
