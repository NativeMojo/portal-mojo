// KPIStrip — a responsive row of KPITiles fed by ONE batched metrics fetch.
// Ported from web-mojo src/extensions/charts/KPIStrip.js (273 lines, read in
// full), re-shaped for the one-cache world:
//
//   · ONE /api/metrics/fetch (via mojoMetrics — the single normalize
//     boundary) covers values, deltas AND sparklines: value = the latest
//     bucket, delta = latest − previous, deltaPct omitted when the previous
//     bucket was 0 (the tile then shows the absolute delta — the same
//     convention /api/metrics/series?with_delta=true uses on the wire, so a
//     later server-delta variant is a drop-in).
//   · The source's parallel REST count tiles are the `value` override on a
//     spec: pages already have count queries (size:0) — pass the number in
//     rather than teaching the strip a second fetch path. `sparklineSlug`
//     still lets a count tile borrow a metric trail + delta (source
//     feature).
//
// A slug the response does not carry renders '—' and warns once — a missing
// metric is a config bug, not a silent blank.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mojoMetrics } from '../client/client';
import type { Params } from '../client/types';
import { KPITile, type KpiSeverity, type KpiTone } from './KPITile';
import { quickRangeWindow } from './stats';

export interface KpiTileSpec {
    /** Metric slug — drives value/delta/sparkline from the batched fetch. */
    slug?: string;
    /** Identity for onTileClick when there is no slug. */
    key?: string;
    label: string;
    tone?: KpiTone | null;
    severity?: KpiSeverity | null;
    formatter?: (v: number) => string;
    /**
     * Caller-supplied value (count tiles — the source's REST tiles). Wins
     * over the metric value; undefined means "metric tile".
     */
    value?: number | string | null;
    /** Borrow a metric's trail (and its delta) for a caller-value tile. */
    sparklineSlug?: string;
}

export interface KPIStripProps {
    tiles: KpiTileSpec[];
    account?: string;
    /** Bucket size for the window — 'days' gives day-over-day deltas. */
    granularity?: string;
    /** Quick range fetched for the sparklines ('7d' default, source parity). */
    range?: string;
    sparklineHeight?: number;
    /** Extra wire params merged under the built-ins. */
    apiParams?: Params;
    onTileClick?: (e: { slug: string | null; key: string }) => void;
    className?: string;
}

export function KPIStrip({
    tiles,
    account = 'global',
    granularity = 'days',
    range = '7d',
    sparklineHeight = 36,
    apiParams,
    onTileClick,
    className = '',
}: KPIStripProps) {
    const slugs = Array.from(new Set([
        ...tiles.map((t) => t.slug).filter((s): s is string => !!s),
        ...tiles.map((t) => t.sparklineSlug).filter((s): s is string => !!s),
    ]));

    // Window anchored once per mount — a stable key; web-mojo stamped its
    // window at construction the same way.
    const [anchor] = useState(() => Date.now());
    const { startMs, endMs } = quickRangeWindow(range, anchor);
    const wire: Params = {
        ...apiParams,
        slugs: slugs.join(','),
        granularity,
        account,
        // `range` is the mock's window param; dt_start/dt_end (epoch seconds)
        // are the real backend's. Send both — each side ignores the other's.
        range,
        dt_start: Math.floor(startMs / 1000),
        dt_end: Math.floor(endMs / 1000),
    };

    const query = useQuery({
        queryKey: ['metrics', wire],
        queryFn: () => mojoMetrics(wire),
        enabled: slugs.length > 0,
    });

    const warnedRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!query.data) return;
        const have = new Set(query.data.datasets.map((d) => d.label));
        for (const slug of slugs) {
            if (!have.has(slug) && !warnedRef.current.has(slug)) {
                warnedRef.current.add(slug);
                console.warn(`KPIStrip: metrics response carries no series for slug "${slug}" — tile shows '—'`);
            }
        }
        // slugs is derived from tiles; the join is its identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query.data, slugs.join(',')]);

    const seriesFor = (slug: string | undefined): number[] | null => {
        if (!slug || !query.data) return null;
        const ds = query.data.datasets.find((d) => d.label === slug);
        return ds ? ds.data : null;
    };

    return (
        <div className={`kpi-strip${className ? ` ${className}` : ''}`}>
            {query.isError && (
                <div className="kpi-strip-error" role="alert">
                    <i className="bi bi-exclamation-triangle" />
                    <span>{query.error instanceof Error ? query.error.message : 'Failed to load metrics'}</span>
                    <button className="btn btn-compact" onClick={() => void query.refetch()}>Retry</button>
                </div>
            )}
            <div className="kpi-strip-grid">
                {tiles.map((spec, i) => {
                    const trail = seriesFor(spec.slug ?? spec.sparklineSlug);
                    const latest = trail && trail.length > 0 ? trail[trail.length - 1]! : null;
                    const prev = trail && trail.length > 1 ? trail[trail.length - 2]! : null;

                    let delta: number | null = null;
                    let deltaPct: number | null = null;
                    if (latest != null && prev != null) {
                        delta = latest - prev;
                        // prev 0 → pct omitted; the tile falls back to the
                        // absolute delta (never Infinity%).
                        deltaPct = prev === 0 ? null : ((latest - prev) / Math.abs(prev)) * 100;
                    }

                    const isMetricTile = spec.value === undefined;
                    const value = isMetricTile ? latest : spec.value;
                    const key = spec.key ?? spec.slug ?? `tile-${i}`;
                    return (
                        <KPITile
                            key={key}
                            label={spec.label}
                            value={value}
                            formatter={spec.formatter}
                            delta={delta}
                            deltaPct={deltaPct}
                            tone={spec.tone ?? null}
                            severity={spec.severity ?? null}
                            sparkline={trail}
                            sparklineHeight={sparklineHeight}
                            loading={isMetricTile && !!spec.slug && query.isPending}
                            onClick={onTileClick ? () => onTileClick({ slug: spec.slug ?? null, key }) : undefined}
                        />
                    );
                })}
            </div>
        </div>
    );
}
