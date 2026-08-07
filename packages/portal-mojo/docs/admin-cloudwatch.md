# Admin CloudWatch

```tsx
import {
    CloudWatchDashboardPage, CloudWatchChart,
    CLOUDWATCH_ADMIN_SECTION, loadCloudWatchSeries,
} from 'portal-mojo/admin';
```

The package owns one global, no-group CloudWatch page at `/cloudwatch` standalone and `/system/cloudwatch` embedded. Its exact gate is `sys.manage_aws`. It contributes one Observability → CloudWatch navigation item and registers no resource-record routes; resource inspection stays in KISS detail modals.

## Dashboard contract

The page renders exactly twelve charts: four EC2 (`cpu`, `net_out`, `memory`, `disk`), four RDS (`cpu`, `conns`, `read_latency`, `write_latency`), and four ElastiCache Redis (`cpu`, `conns`, `cache_misses`, `cache_hits`). ELB and Lambda are explicitly absent because django-mojo's `ACCOUNT_NAMESPACE` exposes neither account type.

The first four charts mount immediately and the other eight mount near the viewport. One page control owns manual and five-minute refreshes; child `MetricsChart`s hide their own refresh control and react to a shared `refreshSignal`. Resource detail metrics use the same pattern inside the modal.

CloudWatch supports only `minutes`, `hours`, and `days` on this surface. `MetricsChart.allowedGranularities` omits the unsupported week/month controls while retaining the normal range, type, stats, and data-table controls.

## Wire contracts

`GET /api/aws/cloudwatch/resources` returns resource arrays at the envelope's top level, not under `data`:

```json
{"status":true,"ec2":[],"rds":[],"redis":[]}
```

Every object is allowlist-projected and validated inside the TanStack query function before it can enter cache. Redis `num_nodes` must be a positive integer. Provider errors are redacted and bounded before being thrown into query state.

`GET /api/aws/cloudwatch/fetch` requires `account` and `category` and answers with the metrics-style nested map:

```json
{"status":true,"data":{"data":{"friendly-name":[1,2]},"labels":["10:00","11:00"]}}
```

The loader forwards only `account`, `category`, optional non-empty `slugs`, `granularity`, `stat`, and `dt_start`/`dt_end`. An empty slug selection omits `slugs` entirely so the backend discovers all resources; sending `slugs=` would mean an explicitly empty selection.

EC2 requests may use the Name tag or raw instance ID. Responses always key the series by the friendly slug. A detail modal therefore requests the immutable raw ID but deliberately displays the friendly response name. Duplicate EC2 Name tags are a backend limitation: its reverse map chooses the last resource for a friendly-name request, and its response map collapses same-name series. The UI shows both friendly slug and raw ID in inventory/detail so operators can disambiguate and targets details by raw ID, but cannot recover two same-name response keys from one fetch.
