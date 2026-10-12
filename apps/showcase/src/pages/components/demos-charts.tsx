// Chart demos: SeriesChart with static data (deterministic — renders the
// same on mock and live) and MetricsChart driving the real metrics endpoint.
import { useEffect, useRef, useState } from 'react';
import { MetricsChart, MetricsChartView, SeriesChart, QUICK_RANGES, metricsQuickWindow } from 'portal-mojo/charts';

const LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DATASETS = [
    { label: 'API Calls', data: [420, 380, 510, 640, 590, 220, 180] },
    { label: 'Logins', data: [120, 140, 160, 210, 190, 60, 40] },
    { label: 'Errors', data: [12, 8, 22, 14, 9, 4, 3] },
];

export function ChartsDemo() {
    return (
        <>
            <ScopedMetricsDemo />
            <div className="panel panel-pad">
                <div className="eyebrow">SeriesChart · static data</div>
                <h3 className="panel-subtitle">Line (crosshair tooltip, legend toggles)</h3>
                <SeriesChart labels={LABELS} datasets={DATASETS} chartType="line" height={220} />
                <h3 className="panel-subtitle" style={{ marginTop: 18 }}>Stacked bars</h3>
                <SeriesChart labels={LABELS} datasets={DATASETS} chartType="bar" height={220} />
            </div>
            <div className="panel panel-pad">
                <div className="eyebrow">SeriesChart · sparse history</div>
                <h3 className="panel-subtitle">Resource samples with missing readings and an offline gap</h3>
                <p>Hover, tap, or focus the chart and use the arrow keys to inspect. Missing CPU readings stay unavailable.</p>
                <SeriesChart
                    labels={['10:01', '10:02', '10:03', '10:04', '10:12', '10:13', '10:14']}
                    xValues={[60, 120, 180, 240, 720, 780, 840]}
                    xDomain={[0, 900]}
                    maxGap={180}
                    datasets={[
                        { label: 'CPU', data: [12, 24, null, 30, 40, 32, 36] },
                        { label: 'Memory', data: [42, 44, 46, 45, 53, 52, 55] },
                    ]}
                    minValue={0} maxValue={100} chartType="area" height={240}
                    ariaLabel="Resource history with missing and offline samples"
                    valueFormatter={(value) => `${value}%`}
                    smoothing={0}
                />
            </div>
            <MetricsChart
                title="MetricsChart · live /api/metrics/fetch"
                slugs={['api_calls', 'user_activity_day', 'api_errors']}
                seriesLabels={{ api_calls: 'API Calls', user_activity_day: 'User activity', api_errors: 'API errors' }}
                defaultRange="24h"
                defaultGranularity="hours"
                height={240}
            />
        </>
    );
}

function ScopedMetricsDemo() {
    const [window, setWindow] = useState(() => metricsQuickWindow('1h', 'minutes'));
    const [owner, setOwner] = useState(() => new AbortController());
    const expiryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(expiryTimer.current), [owner]);
    const [revision, setRevision] = useState(0);
    const [mode, setMode] = useState<'ready' | 'loading' | 'error'>('ready');
    const [narrow, setNarrow] = useState(false);
    const refresh = () => { setRevision((n) => n + 1); setMode('ready'); if (window.range) setWindow(metricsQuickWindow(window.range, window.granularity)); };
    const times = [60, 120, 180, 240, 720, 780, 840].map((n) => window.dt_end - 900 + n);
    return <div>
        <div className="panel panel-pad">
            <div className="eyebrow">MetricsChartView · caller-owned snapshot</div>
            <p>Try the shared controls, missing readings, statistics and CSV. Schedule expiry, then open a dialog to see its private data clear.</p>
            <div className="demo-row">
                <button className="btn" onClick={() => { clearTimeout(expiryTimer.current); expiryTimer.current = setTimeout(() => owner.abort(), 3000); }}>Expire in 3 seconds</button>
                <button className="btn" onClick={() => { owner.abort(); setOwner(new AbortController()); }}>New snapshot</button>
                <button className="btn" onClick={() => setMode('loading')}>Show loading</button>
                <button className="btn" onClick={() => setMode('error')}>Show error</button>
                <button className="btn" onClick={() => setNarrow(!narrow)}>{narrow ? 'Wide chart' : 'Narrow chart'}</button>
                <span>Refreshes: {revision}</span>
            </div>
        </div>
        <div style={{ maxWidth: narrow ? 360 : undefined }}>
            <MetricsChartView title="Resource history" window={window} onWindowChange={setWindow}
                onRefresh={refresh} loading={mode === 'loading'} error={mode === 'error' ? 'Snapshot request failed' : undefined}
                labels={times.map((t) => new Date(t * 1000).toLocaleTimeString())}
                datasets={[{ label: 'CPU', data: [12, 24, null, 30, 40, 32, null] }, { label: 'Memory', data: [42, 44, 46, 45, 53, 52, 55] }]}
                xValues={times} xDomain={[window.dt_start, window.dt_end]} maxGap={180}
                minValue={0} maxValue={100} smoothing={0} height={240} showXLabels={false}
                valueFormatter={(n) => `${Number(n.toFixed(1))}%`} ariaLabel="Scoped resource history"
                allowedRanges={QUICK_RANGES.filter((r) => r.value !== '30d')} allowedGranularities={['minutes', 'hours', 'days']}
                minDate={Math.floor(Date.now() / 1000) - 7 * 86400} maxDate={Math.floor(Date.now() / 1000)}
                signal={owner.signal} />
        </div>
    </div>;
}
