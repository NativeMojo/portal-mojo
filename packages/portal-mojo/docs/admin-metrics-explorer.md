# Admin Metrics Explorer

`MetricsExplorerPage` is the read-only, global Admin workspace for django-mojo's recorded time-series metrics. Import it, its route contribution, or its exact adapters from `portal-mojo/admin`; import the reusable chart seam from `portal-mojo/charts`.

```tsx
import { MONITORING_ADMIN_SECTION, MetricsExplorerPage } from 'portal-mojo/admin';

<MetricsExplorerPage />
```

The registered route is `/metrics/explorer` standalone and `/system/metrics/explorer` when `adminSectionRoutes()` is mounted below `/system`. Its exact any-of gate is `sys.view_metrics | sys.metrics`. That clause stays separate from the existing metrics-permission editor gate; `sys.manage_metrics` alone does not imply read access.

## Discovery wire

The page consumes only django-mojo #1438:

```text
GET /api/metrics/discover?resource=accounts|categories|slugs
```

`discoverMetrics()` uses `mojoCall`, because the stable response fields `resource`, `filters`, `count`, `page_count`, and `next_start` are top-level envelope metadata that `mojoList` would discard. It validates the exact resource/filter echo and internally consistent paging before returning a `MetricsDiscoveryPage`. Permission failures reject; they never become an empty authorized catalog.

Account entry accepts exact `public`, `global`, `group-<positive-id>`, `user-<positive-id>`, or a bounded opaque custom account. Invalid reserved forms do not fall back to custom interpretation. Registry selection is URL-backed, with one repeated `slug` parameter per full slug. Comma-bearing slugs are reported as unaddressable because history endpoints use a comma-delimited request grammar.

Group and User `CollectionSelect` conveniences are separate capabilities. They mount only under `sys.view_groups|sys.manage_groups|sys.groups` and `sys.view_users|sys.manage_users|sys.users`, respectively. Without those clauses the exact account input remains available and no directory picker request can start.

## Full-slug identity

Full colon-bearing strings are the client identity. The backend responses are deliberately asymmetric:

- `/api/metrics/fetch` and fan-out sum key each dataset by the last colon segment;
- `/api/metrics/series?with_delta=true` preserves full keys;
- `/api/metrics/value/get` again truncates to the last segment.

`loadExactMetricSeries()` repairs history at the boundary. It batches globally unique tails, splits every member of a duplicate-tail group into its own request, validates exact response keys and compatible labels, and reassembles datasets in original request order. It rejects missing, extra, or ambiguous results. Fan-out breakdown requires one slug and preserves the returned child labels plus required `groups` map. `fetchMetricPoints()` validates full-key current/previous/delta maps, including the valid previous-zero case where `delta_pct` is absent. `readMetricValue()` reads one exact full slug per request.

History uses `dt_start` and `dt_end` epoch seconds. `dr_*` belongs to model-list aggregation and is never emitted here. The explorer has no record, value-set, permission mutation, or arbitrary `_mode` surface.

## Chart seam and cache

`MetricsChart` adds these optional props without changing existing callers:

```ts
loadSeries?: MetricsSeriesLoader;
seriesCacheKey?: string;
childKind?: string;
breakdown?: boolean;
preserveSeriesLabels?: boolean;
```

The default loader remains `mojoMetrics`. A custom loader must supply a stable namespace through `seriesCacheKey`; the namespace is part of the TanStack key so exact explorer data cannot reuse a cached lossy default response. The explorer namespace includes caller identity. Its discovery, KPI, and scalar keys also include caller, account, filters, pagination, and ordered full slugs as applicable.

## Fan-out, KPI, scalar, and export

Fan-out appears only for a parsed group account. Sum supports multiple selected slugs through the collision-safe adapter. Breakdown limits selection to one slug and requires an explicit child kind. KPI tiles issue one `/series?with_delta=true` request at an explicit `when` and granularity.

The scalar card reads a known exact slug and opens the standard KISS native-dialog detail. Its optional scale changes presentation only; raw values remain visible. There is no gauge catalog or fabricated health classification.

Chart CSV export flows through shared `csvEscape()`. String cells beginning with `=`, `+`, `-`, `@`, tab, or carriage return gain a leading apostrophe before normal RFC quoting. Numeric negatives remain numeric.

## Styling

The explorer extends the semantic `admin-monitoring.css` token stylesheet used by the Portal and showcase. It adds no UI or chart dependency. Consumers already including the Monitoring section stylesheet need no additional CSS entry.
