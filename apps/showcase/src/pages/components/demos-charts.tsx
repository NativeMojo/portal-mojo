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
            <MetricsChart
                title="MetricsChart · live /api/metrics/fetch"
                slugs={['api_calls', 'logins', 'errors']}
                seriesLabels={{ api_calls: 'API Calls', logins: 'Logins', errors: 'Errors' }}
                defaultRange="24h"
                defaultGranularity="hours"
                height={240}
            />
        </>
    );
}
