// portal-mojo/charts — dependency-free SVG charts in the mission-control
// design language. SeriesChart (line/bar/area, stacked bars, legend toggle,
// crosshair tooltip) + MetricsChart (the /api/metrics/fetch control-bar
// wrapper: granularity/range/type switching, custom-range dialog, stats +
// view-data dialogs); MiniChart sparklines, the searchable MetricsMiniWidget
// card, KPITile/KPIStrip, CircularProgress, PieChart, the chart stats math,
// and the exportChartPng SVG→PNG serializer.
export * from './SeriesChart';
export * from './MetricsChart';
export * from './MiniChart';
export * from './MetricsMiniWidget';
export * from './KPITile';
export * from './KPIStrip';
export * from './CircularProgress';
export * from './PieChart';
export * from './pie-math';
export * from './chart-dialogs';
export * from './exportChart';
export * from './stats';
export * from './worldmap/WorldMap';
export * from './worldmap/countryCentroids';
export * from './worldmap/geo';
export * from './worldmap/worldmap-data';
// Basemap geometry is reached through `useWorldLand()` ONLY. `world-land.ts` is
// deliberately not re-exported here: a static re-export would pull ~143KB of
// coordinates into every bundle that touches this barrel, which is exactly what
// the lazy hook exists to avoid.
export * from './worldmap/use-world-land';
