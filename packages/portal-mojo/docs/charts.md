# charts — dependency-free SVG

```ts
import {
    SeriesChart, MetricsChart, MiniChart, MetricsMiniWidget,
    KPITile, KPIStrip, CircularProgress, PieChart,
    showSeriesStats, showSeriesData, exportChartPng,
    computeSeriesStats, computeTrend, deltaBadge,   // pure math
} from 'portal-mojo/charts';
```

No chart library — web-mojo's SVG charts ported whole; they match the
design tokens in both themes. Demos: Develop → Components → Display.

## The metrics wire (all metrics-driven components speak it)

`GET /api/metrics/fetch` params:

| param | meaning |
|---|---|
| `slugs` | comma list, **REQUIRED** (the server 400s without; singular `slug` exists but never send it — prod once rejected it) |
| `granularity` | `minutes/hours/days/weeks/months` (server default `hours`) |
| `account` | `'public'` (server default) / `'global'` / `'group-<id>'` / `'user-<id>'` — components default to `'global'` (web-mojo parity) |
| `dt_start` / `dt_end` | window bounds, **epoch SECONDS** (rule 6) |
| `category` | optional category passthrough via `apiParams` |
| `child_kind`, `breakdown` | typed `MetricsChart` fan-out props (`childKind`, `breakdown`) |

Response is a slug-keyed map `{data: {slug: number[]}, labels: string[]}` —
normalized ONLY by `mojoMetrics` in the client into `{labels, datasets}`.
Malformed feeds degrade to the empty state WITH a console.warn — never a
crash.

**Two windowing params ride together, deliberately:** the real backend uses
`dt_*` and ignores `range`; components send both for quick ranges and only
`dt_*` for custom ranges. The mock now gives `dt_start`/`dt_end` precedence,
accepts either bound alone, and mirrors the backend's inclusive buckets.
Reverse ranges return an empty series; malformed non-epoch bounds reject.
Month/year buckets advance by calendar boundaries, not 30/365-day arithmetic.
The mock caps a pathological request at 400 buckets to keep the showcase
responsive. It also salts values by `account` so entity-scope demos visibly
change; that salt is a mock-only presentation affordance, not a server promise.

**Trap (fixed here, do not regress):** `dr_start/dr_end` is the model-LIST
daterange triple — `/api/metrics/fetch` ignores it silently. web-mojo sent
`dr_*` to metrics for years; its custom ranges never reached the backend.

## SeriesChart (presentational)

```tsx
<SeriesChart
    labels={['Mon', 'Tue']}
    datasets={[{ label: 'API Calls', data: [420, 380] }]}
    chartType="line"        // 'line' | 'bar' | 'area'
    stacked="auto"          // bars stack by default
    height={240}
    showLegend showGrid showXLabels showYLabels
    valueFormatter={(n) => ...}
/>
```

Legend entries toggle series; hover shows the crosshair index tooltip;
ticks are "nice"-rounded; container width is measured (no viewBox
smearing).

## MetricsChart (the django-mojo metrics widget)

```tsx
<MetricsChart
    title="Platform activity"
    slugs={['api_calls', 'logins', 'errors']}
    seriesLabels={{ api_calls: 'API Calls' }}   // wire carries raw slugs
    account="global"
    defaultRange="24h"                          // 1H / 24H / 7D / 30D
    defaultGranularity="hours"                  // gated per range (MIN HR DAY WK MO)
    defaultType="line"
    height={280}
    valueFormatter={(n) => ...}                 // tooltips, ticks, dialogs
    childKind="store" breakdown={false}         // typed fan-out; overwrites apiParams
    loadSeries={exactLoader}                    // optional; default is mojoMetrics
    seriesCacheKey="caller-42:exact-history"   // required stable namespace for custom loaders
    preserveSeriesLabels                       // keep full-slug/child identity verbatim
    // toggles, all default true:
    showGranularity showDateRange showTypeSwitch showRefresh showStats showDataTable
/>
```

- **Stats (ⓘ)** — per-series Latest/Min/Max/Avg/Median/Sum dialog.
  **View data (table)** — the series as a table + Download CSV. Both are
  native `<dialog>`s via the modal manager; both render the DISPLAY names
  (`seriesLabels`-mapped).
- **Custom range** — the calendar button in the range segment opens a
  DateRangePicker (presets rail) dialog with an explicit Apply. An applied
  range shows as a chip beside the title, sends `dt_start/dt_end` (local
  day bounds 00:00:00–23:59:59 → epoch seconds), and re-points granularity
  at a bucket that fits the span (`granularitiesForSpanMs`).
- Quick ranges anchor their window at pick time; **Refresh re-anchors at
  now** (web-mojo kept the stale window — deliberate fix). Range switches
  re-point granularity at the nearest sensible bucket.
- `loadSeries(params)` receives typed `slugs`, `account`, `granularity`,
  `dt_start`, `dt_end`, and optional fan-out fields. The loader namespace is
  part of the TanStack key, preventing a custom exact-identity loader from
  reusing a cached default response with the same wire params.
- The default loader remaps live tail-only response keys back to configured
  full slugs when that mapping is unique. Duplicate tails remain an explicit
  error and require an exact loader that can split/reassemble requests.
- CSV data export neutralizes formula-looking **string** cells before RFC
  quoting. Negative numeric metrics remain numeric.
- Deliberately NOT carried: `compactHeader` (MetricsMiniWidget IS the
  compact card), `.export()` (removed in web-mojo too — use
  `exportChartPng`), `withDelta` endpoint switching (KPIStrip covers the
  KPI use-case).

## MiniChart (sparkline primitive)

```tsx
<MiniChart data={[4, 9, 6]} labels={['Mon','Tue','Wed']} chartType="line"
    height={48} color="var(--accent)" fill smoothing={0.3}
    showTooltip showCrosshair showXAxis={false}
    minValue={} maxValue={} softMin={} softMax={} />
```

Single series, line or bar. Hard crops (`minValue/maxValue`) win over bar
soft bounds (`softMin/softMax` — normalize-to targets that expand if data
exceeds). Bars always include zero; the x-axis sits at zero when data
crosses it. All-zero bar data renders the dashed "alive, just zero"
baseline instead of blank. Draw-in animation is pathLength-normalized CSS
(no measuring); `prefers-reduced-motion` kills it. Colors accept `var()`
tokens — the default fill is the stroke at 0.12 opacity, so one token
drives both.

## MetricsMiniWidget (compact card + entity search)

```tsx
<MetricsMiniWidget
    title="Logins" icon="bi bi-box-arrow-in-right"
    slugs={['logins']}                    // FIRST slug drives the card
    granularity="hours" defaultRange="24h" chartType="line"
    subtitle={(ctx) => <><b>{ctx.total}</b> in 24h · {ctx.nowLabel}: {ctx.nowValue}</>}
    showTrending trendRange={6}
    tone="accent"                          // token-tinted card variant
    showSettings showDateRange settingsKey="dash-logins"
    search={{                              // the C2 addition
        model: GroupModel,                 // or endpoint: '/api/group'
        toAccount: (id) => `group-${id}`,  // picked row → account param
        placeholder: 'All groups (global)',
    }}
    onScopeChange={(account, row) => ...}
/>
```

- **Entity search**: a CollectionSelect bound to any model list — shared
  cache keys, NEVER a parallel fetch path. Picking a record re-fetches
  with `account=toAccount(id, row)`; clearing returns to the base
  `account` prop.
- **subtitle** is a ReactNode or `(ctx) => ReactNode`; `ctx` is the typed
  twin of web-mojo's Mustache tokens: `{total, nowValue, lastValue,
  prevValue, trendingPercent, nowLabel, totalLabel, granularity}`
  (`nowValue` is ALWAYS the latest bucket; `lastValue` is the
  offset-shifted trend-window sum — source distinction preserved).
- **Trending** is the source's windowed math (`computeTrend`):
  `trendRange` (k = floor(range/2) buckets per window), `trendOffset`
  (skip trailing partial buckets), `prevTrendOffset` (compare N earlier).
  Up renders green / down red (source parity — no tone flip here; KPITile
  has `tone`).
- **Settings** (gear, off by default): granularity / chart type / date
  range dialog; persisted under localStorage `metrics-chart-<settingsKey>`
  (source key format). A granularity change with a custom window in play
  auto-adjusts the window (hours→24h … years→5y, source table); it never
  sets dates for the first time.
- `defaultRange={null}` omits window params entirely (backend default
  window — the source MiniChart's behavior when no range was given).
- Card is single-series by design (source parity); extra slugs still feed
  the stats/view-data dialogs. A response without the first slug warns
  once and shows the empty state.

## KPITile + KPIStrip

```tsx
<KPIStrip
    tiles={[
        { slug: 'api_calls', label: 'API Calls', tone: 'good' },
        { slug: 'errors', label: 'Errors', tone: 'bad', severity: 'warn' },
        { key: 'open', label: 'Open Tickets', value: openCount, sparklineSlug: 'api_calls' },
    ]}
    granularity="days" range="7d" account="global"
    onTileClick={({ slug, key }) => ...}
/>
```

ONE batched `/api/metrics/fetch` covers values, deltas and sparklines:
value = latest bucket, delta = latest − previous, `deltaPct` omitted when
the previous bucket was 0 — the same convention
`/api/metrics/series?with_delta=true` uses, so a server-delta variant is a
drop-in later. A spec with `value` set is a caller-value tile (the
source's REST-count tiles — pages already have `size:0` count queries);
`sparklineSlug` lets it borrow a metric trail + delta. Missing slugs warn
once and render '—'.

`KPITile` alone is pure presentation: `label`, `value`, `delta`,
`deltaPct`, `tone` ('bad' = rising is bad), `severity`
(critical/high/warn/info/good left stripe; high shares the warn token —
no orange in the palette), `sparkline`, `onClick`, `loading`. Badge rules
(source verbatim, via `deltaBadge`): finite pct → `+12%` (one decimal
under 10), else absolute delta → `+4`, else no badge; ±0 renders flat.
**Never Infinity%.**

## CircularProgress

```tsx
<CircularProgress value={64} size="md" />                       // xs sm md lg xl | px
<CircularProgress value={64} gap={90} rotation={135} />         // gauge
<CircularProgress value={7} max={10} valueFormat="fraction" />  // 7/10
<CircularProgress segments={[{ value: 38, color: 'var(--accent)' }, ...]} max={100} />
<CircularProgress gradientColors={['var(--accent)', 'var(--ok)']} />
```

Ring progress with size presets (stroke auto-scales), variants mapped to
tokens (`success/danger/warning/info` → ok/bad/warn/info), partial-arc
gauges, rounded caps, center value (`percentage | fraction | value` or a
`valueFormatter(value, min, max)`), `label`, `icon`, and multi-segment
mode with `segmentGap` degrees. Value changes glide via the CSS
dash-offset transition (the imperative `animateTo/pulse` API from the
source is just… setting the prop). Dropped from source: the Bootstrap
popover tooltip (pass `title` or wrap it) and the hardcoded 'dark'/'light'
theme presets (tokens make them meaningless).

## PieChart

```tsx
<PieChart data={[{ label: 'Chrome', value: 61, color: 'var(--info)' }]} />  // shape 1
<PieChart data={{ labels: ['a'], datasets: [{ data: [1] }] }} />            // shape 2 (Chart.js)
<PieChart data={{ US: 42, DE: 21 }} />                                      // shape 3 (map)
<PieChart endpoint="/api/some/summary" params={{ days: 7 }} />              // fetched
<PieChart data={d} cutout={0.62}
    centerLabel={(ctx) => ctx.total.toLocaleString()} centerSubLabel="users" />
```

Native SVG pie/doughnut. All three web-mojo input shapes; unknown shapes
warn + empty state. Colors: per-item `color` → `colors[i]` (default
CHART_PALETTE) → `colorGenerator(i)` (default golden angle — distinct hues
forever). `legendPosition` right/bottom/none; `showLabels` puts labels at
the slice edges; tooltip clamps inside the svg area; `onSliceClick` gets
`{label, value, pct, index}`. Data changes tween label-keyed (existing
slices slide, new ones grow from a 0-arc; rAF, cancelled on unmount).
Center labels are strings (SVG `<text>` — not a ReactNode slot). The
single-full-circle case renders a circle element (SVG arcs can't draw
360°). `endpoint` fetches through `mojoCall` (the one boundary) with the
source's `data.data ?? data` nesting heuristic; fetch errors warn + empty.
Pure helpers (`parsePieInput`, `buildPieGeometry`, `goldenAngleColor`,
`interpolateSegments`, `arcPath`) are exported from `pie-math`.

## Stats + view-data dialogs (shared)

```ts
showSeriesStats({ title, labels, datasets, granularity, formatter });
showSeriesData({ title, labels, datasets, granularity, formatter });  // + Download CSV
```

Awaitable native-`<dialog>`s (modal manager). Stats: per-series
Latest/Min/Max/Avg/Median/Sum with the "Hourly · N points" header. Data:
one row per label, one column per series; CSV downloads as
`<title-slug>-<date>.csv` (RFC-safe quoting via `buildCsv`). Empty data
renders "No data to display." — never a blank dialog.

## exportChartPng

```ts
exportChartPng(refOrElement, { filename: 'chart.png', background: null, scale: 2 });
```

Framework-free SVG→PNG: finds the `<svg>` in the target (element or ref),
clones it, **inlines computed styles** (token-driven fills/strokes/fonts
would otherwise vanish — theme classes don't serialize), rasterizes at
`scale` (default 2) over the nearest ancestor's real background (dark
exports stay dark; pass a color or `null` for transparent), and downloads.
⚠️ Tainted-canvas caveat (from the source, still true): an SVG referencing
cross-origin resources (external `<image href>`, remote fonts) taints the
canvas and `toDataURL` throws a SecurityError. These charts reference
none; inline such resources before exporting anything that does.

## Pure math (headless-tested)

`computeSeriesStats`, `defaultStatFormat`, `computeTrend`, `deltaBadge`,
`buildCsv`/`csvEscape`/`csvFilename`, `quickRangeWindow`,
`granularitiesForSpanMs`, `ymdRangeToEpochSeconds`, `toNumber` — all in
`charts/stats.ts`, no DOM/React, shared by every surface above (web-mojo
carried two diverging copies of the stats math; here there is one).

## WorldMap

`portal-mojo/charts` also exports `WorldMap` — the dependency-free geo map
(markers, routes, drill-down, the country centroid table) plus its projection
math. It has its own page: **[worldmap.md](worldmap.md)**. Note that
`charts/pie-math` exports `arcPath` and the map's arc helper is therefore
`geoArcPath`.
