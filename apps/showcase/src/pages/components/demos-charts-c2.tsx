// MERGE-WIRE: rail — ComponentsPage.tsx, 'Display' group, after the existing
// 'charts' entry (plus the import line):
//   import { ChartsMetricsC2Demo, ChartsMiniWidgetDemo, ChartsKpiDemo, ChartsPieDemo } from './demos-charts-c2';
//   { key: 'charts-metrics', title: 'MetricsChart+', icon: 'bi-graph-up-arrow',
//     blurb: 'C2 completion: stats summary + view-data dialogs (CSV), the custom date-range dialog feeding dt_start/dt_end epochs, and exportChartPng.',
//     render: () => <ChartsMetricsC2Demo /> },
//   { key: 'charts-mini', title: 'Metrics mini widget', icon: 'bi-activity',
//     blurb: 'Compact metrics card: windowed trending, stats/data/refresh/settings actions, persisted settings — and the entity search scoping the metric via account=.',
//     render: () => <ChartsMiniWidgetDemo /> },
//   { key: 'charts-kpi', title: 'KPI & progress', icon: 'bi-speedometer2',
//     blurb: 'KPITile/KPIStrip (one batched fetch, delta badges that never render Infinity%) and CircularProgress (sizes, gauges, segments, gradients).',
//     render: () => <ChartsKpiDemo /> },
//   { key: 'charts-pie', title: 'PieChart', icon: 'bi-pie-chart',
//     blurb: 'Native SVG pie/doughnut: all three input shapes, golden-angle colors, center labels, label-keyed arc tween, slice click, PNG export.',
//     render: () => <ChartsPieDemo /> },
// MERGE-WIRE: theme.css — @import "./theme/charts-c2.css"; (file ships un-imported)
//
// Chart demos for the C2 completion (board #1258). Deterministic where
// possible; the metrics-driven pieces run against /api/metrics/fetch on
// whichever transport the app is using (mock or live).
import { useRef, useState } from 'react';
import {
    CircularProgress,
    KPIStrip,
    KPITile,
    MetricsChart,
    MetricsMiniWidget,
    MiniChart,
    PieChart,
    exportChartPng,
    type PieInput,
} from 'portal-mojo/charts';
import { toast } from 'portal-mojo/ui';
import { GroupModel } from '../../models';

// ── MetricsChart completion: stats / view data / custom range / export ─
export function ChartsMetricsC2Demo() {
    const chartRef = useRef<HTMLDivElement>(null);
    return (
        <>
            <div ref={chartRef}>
                <MetricsChart
                    title="Platform activity"
                    slugs={['api_calls', 'logins', 'errors']}
                    seriesLabels={{ api_calls: 'API Calls', logins: 'Logins', errors: 'Errors' }}
                    defaultRange="24h"
                    defaultGranularity="hours"
                    height={260}
                />
            </div>
            <div className="panel panel-pad">
                <div className="eyebrow">Try it</div>
                <p className="dim cmp-blurb" style={{ maxWidth: 'none' }}>
                    The header now carries the C2 completion: <b>ⓘ Stats</b> opens the per-series
                    Latest/Min/Max/Avg/Median/Sum summary; the <b>table</b> button opens the raw
                    series as a table with a CSV download; the <b>calendar</b> button in the range
                    segment opens the custom-range dialog (DateRangePicker + presets rail) — an
                    applied range shows as a chip beside the title and re-points granularity to a
                    bucket that fits the span. Quick ranges and custom ranges both feed
                    <code> dt_start/dt_end</code> epoch seconds to <code>/api/metrics/fetch</code>.
                </p>
                <div className="demo-row">
                    <button
                        className="btn"
                        onClick={() => exportChartPng(chartRef, { filename: 'platform-activity.png' })}
                    >
                        <i className="bi bi-image" /> Export PNG
                    </button>
                    <span className="dim">exportChartPng — serializes the live SVG (theme styles inlined, backdrop matched to the theme).</span>
                </div>
            </div>
        </>
    );
}

// ── Mini widget: searchable scope, trending, settings persistence ─────
export function ChartsMiniWidgetDemo() {
    const [scope, setScope] = useState<string | null>(null);
    return (
        <>
            <div className="grid gap-4 lg:grid-cols-3">
                <MetricsMiniWidget
                    title="Logins"
                    icon="bi bi-box-arrow-in-right"
                    slugs={['logins']}
                    granularity="hours"
                    defaultRange="24h"
                    subtitle={(ctx) => <><b>{ctx.total.toLocaleString()}</b> in 24h · {ctx.nowLabel}: {ctx.nowValue.toLocaleString()}</>}
                    search={{
                        model: GroupModel,
                        placeholder: 'All groups (global)',
                        toAccount: (id) => `group-${id}`,
                    }}
                    onScopeChange={(account) => setScope(account)}
                />
                <MetricsMiniWidget
                    title="Errors"
                    icon="bi bi-bug"
                    slugs={['errors']}
                    granularity="hours"
                    defaultRange="24h"
                    chartType="bar"
                    tone="bad"
                    showTrending
                    subtitle={(ctx) => <><b>{ctx.total.toLocaleString()}</b> errors · 24h</>}
                />
                <MetricsMiniWidget
                    title="API Calls"
                    icon="bi bi-cloud-arrow-up"
                    slugs={['api_calls']}
                    granularity="hours"
                    defaultRange="24h"
                    tone="accent"
                    showTrending
                    showSettings
                    showDateRange
                    settingsKey="demo-api-calls"
                    subtitle={(ctx) => <>{ctx.totalLabel}: <b>{ctx.total.toLocaleString()}</b></>}
                />
            </div>
            <div className="panel panel-pad">
                <div className="eyebrow">What to poke</div>
                <p className="dim cmp-blurb" style={{ maxWidth: 'none' }}>
                    <b>Left:</b> the entity search — a CollectionSelect over the group model
                    (shared cache keys, never a parallel fetch path). Picking a group re-fetches
                    with <code>account={scope ?? 'global'}</code>; clearing returns to global.
                    <b> Middle:</b> bar variant with the windowed trending chip.
                    <b> Right:</b> the gear opens the settings dialog (granularity, chart type,
                    date range) — applied settings persist in localStorage under
                    <code> metrics-chart-demo-api-calls</code> and survive a reload. Every card
                    carries stats / view-data / refresh actions (hover the top-right corner).
                </p>
            </div>
        </>
    );
}

// ── KPI tiles + strip + CircularProgress ──────────────────────────────
export function ChartsKpiDemo() {
    const [progress, setProgress] = useState(64);
    return (
        <>
            <div className="panel panel-pad">
                <div className="eyebrow">KPIStrip · one batched /api/metrics/fetch</div>
                <KPIStrip
                    tiles={[
                        { slug: 'api_calls', label: 'API Calls', tone: 'good' },
                        { slug: 'logins', label: 'Logins', tone: 'good' },
                        { slug: 'errors', label: 'Errors', tone: 'bad', severity: 'warn' },
                        { key: 'static', label: 'Open Tickets', value: 42, sparklineSlug: 'api_calls' },
                    ]}
                    granularity="days"
                    range="7d"
                    onTileClick={({ slug, key }) => toast.info(`tile:click → ${slug ?? key}`)}
                />
                <p className="dim" style={{ marginTop: 10 }}>
                    Value = the latest bucket, delta vs the previous one; a 0-previous bucket falls
                    back to the absolute delta — never Infinity%. The fourth tile is a caller-value
                    tile (the source's REST-count tile) borrowing the API Calls trail.
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">KPITile · presentational states</div>
                <div className="kpi-strip-grid">
                    <KPITile label="Rising · good" value={1284} deltaPct={12.4} delta={142} tone="good" sparkline={[4, 6, 5, 8, 9, 12, 14]} />
                    <KPITile label="Rising · bad tone" value={87} deltaPct={23.5} delta={17} tone="bad" severity="critical" sparkline={[2, 3, 2, 5, 6, 8, 9]} />
                    <KPITile label="Prev was 0 · absolute" value={4} delta={4} tone="bad" severity="info" sparkline={[0, 0, 0, 0, 0, 1, 4]} />
                    <KPITile label="Flat · no trail" value="99.98%" deltaPct={0} delta={0} hint="uptime, 30 days" />
                </div>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">CircularProgress</div>
                <div className="demo-row" style={{ gap: 22, alignItems: 'center' }}>
                    <CircularProgress value={progress} size="xs" />
                    <CircularProgress value={progress} size="sm" variant="info" />
                    <CircularProgress value={progress} size="md" label="cpu" />
                    <CircularProgress value={progress} size="lg" variant="warning" gap={90} rotation={135} label="gauge" />
                    <CircularProgress value={progress} size="lg" gradientColors={['var(--accent)', 'var(--info)', 'var(--ok)']} label="gradient" />
                    <CircularProgress value={7} max={10} size="md" valueFormat="fraction" variant="success" label="steps" />
                    <CircularProgress value={100} size="md" variant="success" icon="bi bi-check-lg" title="Complete" />
                    <CircularProgress
                        size="lg"
                        max={100}
                        segments={[
                            { value: 38, color: 'var(--accent)', label: 'app 38 GB' },
                            { value: 22, color: 'var(--info)', label: 'cache 22 GB' },
                            { value: 14, color: 'var(--warn)', label: 'logs 14 GB' },
                        ]}
                        valueFormatter={() => '74 GB'}
                        label="of 100 GB"
                    />
                </div>
                <div className="demo-row" style={{ marginTop: 14 }}>
                    <input
                        type="range" min={0} max={100} value={progress}
                        onChange={(e) => setProgress(Number(e.target.value))}
                        aria-label="Progress value"
                    />
                    <span className="dim">value = {progress} — changes glide via the dash-offset transition</span>
                </div>
            </div>
        </>
    );
}

// ── PieChart: all three input shapes + tween + click + export ─────────
const SHAPE_ARRAY: PieInput = [
    { label: 'Chrome', value: 61 },
    { label: 'Safari', value: 24, color: 'var(--info)' },
    { label: 'Firefox', value: 9 },
    { label: 'Other', value: 6 },
];

const SHAPE_CHARTJS: PieInput = {
    labels: ['API', 'Portal', 'Webhooks'],
    datasets: [{ data: [412, 186, 74] }],
};

const SHAPE_MAP_A: Record<string, number> = { US: 42, DE: 21, BR: 14, JP: 11, AU: 7, IN: 5 };
const SHAPE_MAP_B: Record<string, number> = { US: 22, DE: 34, BR: 6, JP: 18, AU: 12, IN: 9 };

export function ChartsPieDemo() {
    const [mapData, setMapData] = useState<Record<string, number>>(SHAPE_MAP_A);
    const pieRef = useRef<HTMLDivElement>(null);
    return (
        <>
            <div className="grid gap-4 lg:grid-cols-3">
                <div className="panel panel-pad">
                    <div className="eyebrow">Shape 1 · [{'{'}label, value, color?{'}'}]</div>
                    <PieChart
                        data={SHAPE_ARRAY}
                        onSliceClick={({ label, value, pct }) => toast.info(`${label}: ${value} (${pct.toFixed(1)}%)`)}
                    />
                    <p className="dim" style={{ marginTop: 8 }}>Per-item color override on Safari; click a slice.</p>
                </div>
                <div className="panel panel-pad">
                    <div className="eyebrow">Shape 2 · Chart.js {'{'}labels, datasets{'}'}</div>
                    <PieChart
                        data={SHAPE_CHARTJS}
                        cutout={0.62}
                        centerLabel={(ctx) => ctx.total.toLocaleString()}
                        centerSubLabel="requests"
                    />
                    <p className="dim" style={{ marginTop: 8 }}>Doughnut: center label computed from the total.</p>
                </div>
                <div className="panel panel-pad" ref={pieRef}>
                    <div className="eyebrow">Shape 3 · object map + tween</div>
                    <PieChart data={mapData} legendPosition="bottom" showLabels={false} />
                    <div className="demo-row" style={{ marginTop: 8 }}>
                        <button
                            className="btn btn-compact"
                            onClick={() => setMapData((d) => (d === SHAPE_MAP_A ? SHAPE_MAP_B : SHAPE_MAP_A))}
                        >
                            <i className="bi bi-shuffle" /> Shuffle values
                        </button>
                        <button
                            className="btn btn-compact"
                            onClick={() => exportChartPng(pieRef, { filename: 'pie-demo.png' })}
                        >
                            <i className="bi bi-image" /> Export PNG
                        </button>
                    </div>
                </div>
            </div>
            <div className="panel panel-pad">
                <div className="eyebrow">Golden-angle generator</div>
                <PieChart
                    data={Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`series_${i + 1}`, 20 - i]))}
                    colors={[]}
                    width={180}
                    height={180}
                />
                <p className="dim" style={{ marginTop: 8 }}>
                    14 series, empty palette: every color comes from the golden-angle generator
                    (i × 137.508° around the hue wheel) — distinct hues forever, no library.
                </p>
            </div>
            <div className="panel panel-pad">
                <div className="eyebrow">MiniChart · the sparkline primitive</div>
                <div className="grid gap-4 lg:grid-cols-3">
                    <div>
                        <div className="dim" style={{ marginBottom: 4 }}>line + fill + tooltip</div>
                        <MiniChart data={[4, 9, 6, 12, 10, 16, 13, 18]} labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Today']} height={56} />
                    </div>
                    <div>
                        <div className="dim" style={{ marginBottom: 4 }}>bars, negative values, zero axis</div>
                        <MiniChart data={[5, -3, 8, -2, 6, 4, -5, 9]} chartType="bar" showXAxis height={56} color="var(--info)" />
                    </div>
                    <div>
                        <div className="dim" style={{ marginBottom: 4 }}>all-zero → "alive, just zero" baseline</div>
                        <MiniChart data={[0, 0, 0, 0, 0, 0, 0, 0]} chartType="bar" height={56} color="var(--warn)" />
                    </div>
                </div>
            </div>
        </>
    );
}
