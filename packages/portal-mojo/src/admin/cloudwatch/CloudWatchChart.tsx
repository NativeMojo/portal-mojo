import { useEffect, useRef, useState } from 'react';
import { MetricsChart } from '../../charts';
import { useAuthSnapshot } from '../../client/runtime';
import { fmt } from '../../ui';
import {
    CLOUDWATCH_GRANULARITIES, loadCloudWatchSeries,
    type CloudWatchChartDefinition, type CloudWatchUnit,
} from './data';

function valueFormatter(unit: CloudWatchUnit): (value: number) => string {
    if (unit === 'percent') return (value) => `${value.toLocaleString()}%`;
    if (unit === 'bytes') return (value) => fmt.filesize(value);
    if (unit === 'seconds') return (value) => `${value.toLocaleString()} s`;
    return (value) => value.toLocaleString();
}

export function CloudWatchChart({ definition, slugs = [], refreshSignal }: {
    definition: CloudWatchChartDefinition;
    slugs?: string[];
    refreshSignal?: unknown;
}) {
    const auth = useAuthSnapshot();
    return <MetricsChart
        title={definition.title}
        account={definition.account}
        slugs={slugs}
        apiParams={{ category: definition.category, stat: 'avg' }}
        loadSeries={loadCloudWatchSeries}
        seriesCacheKey={`admin-cloudwatch:${auth.uid ?? 'anonymous'}:${definition.account}:${definition.category}`}
        preserveSeriesLabels
        allowedGranularities={[...CLOUDWATCH_GRANULARITIES]}
        refreshSignal={refreshSignal}
        defaultRange="24h"
        defaultGranularity="hours"
        height={200}
        valueFormatter={valueFormatter(definition.unit)}
        showRefresh={false}
    />;
}

export function LazyCloudWatchChart({ definition, slugs, refreshSignal, eager = false }: {
    definition: CloudWatchChartDefinition;
    slugs?: string[];
    refreshSignal?: unknown;
    eager?: boolean;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [mounted, setMounted] = useState(eager);
    useEffect(() => {
        if (mounted || !ref.current) return;
        if (typeof IntersectionObserver === 'undefined') { setMounted(true); return; }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) { setMounted(true); observer.disconnect(); }
        }, { rootMargin: '240px' });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [mounted]);
    return <div ref={ref} className="cloudwatch-chart-slot">
        {mounted ? <CloudWatchChart definition={definition} slugs={slugs} refreshSignal={refreshSignal} /> : <div className="panel panel-pad cloudwatch-chart-placeholder"><span className="skel skel-block" /></div>}
    </div>;
}
