// Chart demos: SeriesChart with static data (deterministic — renders the
// same on mock and live) and MetricsChart driving the real metrics endpoint.
import { MetricsChart, SeriesChart } from 'portal-mojo/charts';

const LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DATASETS = [
    { label: 'API Calls', data: [420, 380, 510, 640, 590, 220, 180] },
    { label: 'Logins', data: [120, 140, 160, 210, 190, 60, 40] },
    { label: 'Errors', data: [12, 8, 22, 14, 9, 4, 3] },
];

export function ChartsDemo() {
    return (
        <>
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
