# charts — dependency-free SVG

```ts
import { SeriesChart, MetricsChart } from 'portal-mojo/charts';
```

No chart library — web-mojo's SVG charts ported whole; they match the
design tokens in both themes.

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
smearing). Malformed `labels`/`datasets` (non-arrays) degrade to the empty
state WITH a console.warn — a bad feed must never take down the route.

## MetricsChart (the django-mojo metrics widget)

```tsx
<MetricsChart
    title="Platform activity"
    slugs={['api_calls', 'logins', 'errors']}
    seriesLabels={{ api_calls: 'API Calls' }}   // wire carries raw slugs
    defaultRange="24h"                          // 1H / 24H / 7D / 30D
    defaultGranularity="hours"                  // gated per range (MIN HR DAY WK MO)
    defaultType="line"
    height={280}
/>
```

Fetches `GET /api/metrics/fetch?slugs&range&granularity` (slug/s REQUIRED
— the server 400s without one). Wire shape is a slug-keyed map
`{data: {slug: number[]}, labels: string[]}` — normalized by `mojoMetrics`
into `{labels, datasets}`; display names come from `seriesLabels`
(fallback: humanized slug). Range switches re-point granularity at the
nearest sensible bucket instead of firing a mismatched request.

C2 adds: stats summary + data-table modal, custom date-range dialog, the
searchable mini widget, KPI tiles.
