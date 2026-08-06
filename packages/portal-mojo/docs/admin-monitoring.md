# Admin monitoring

`portal-mojo/admin` packages the immutable Logs feed, one-record log inspector,
and metrics-permission administration for standalone or embedded admin portals.

## Admin registration and gates

`MONITORING_ADMIN_SECTION` contributes two root-relative routes:

| Route | Component | Any-of gate |
|---|---|---|
| `/logs` | `LogsPage` | `sys.manage_logs`, `sys.view_logs`, `sys.security` |
| `/metrics/permissions` | `MetricsPermissionsPage` | `sys.manage_incidents`, `sys.metrics`, `sys.manage_metrics` |

The `sys.` prefix is intentional: these are global operator surfaces and must
not inherit a similarly named active-group permission. `adminSectionRoutes()`
wraps each component before it mounts, so a denied direct route cannot fetch.
The backend remains authoritative.

```tsx
import {
  MONITORING_ADMIN_SECTION,
  adminSectionRoutes,
  adminSectionsMenu,
} from 'portal-mojo/admin';

const sections = [MONITORING_ADMIN_SECTION];
const routes = adminSectionRoutes(sections, { mount: '/system' });
const menu = adminSectionsMenu(sections, { mount: '/system' });
```

## Logs and inspector

```tsx
import { LogsPage, LogInspector, LogModel, type LogRow } from 'portal-mojo/admin';

<LogInspector log={row} />
```

`LogsPage` is the canonical `/api/logs` table: server search/filter/sort,
day grouping, column persistence, export, quick-look chevron, and a full-size
row-click inspector. The table is read-only because log rows are immutable
records. The chevron cell stops propagation in `ModelTable`, so expanding a
quick look does not also open the inspector.

The inspector recognizes explicit request and response `kind` tokens. All
other kinds are messages. It renders `log`, `payload`, request context, user,
device, IP, related model, and user agent. Valid JSON goes through `JsonBlock`;
everything else is a React text child in a `<pre>`. HTML-looking stored data is
never an HTML rendering boundary. Clipboard absence and rejected writes surface
an error toast instead of reporting false success.

A response row is only a stored response row. `/api/logs` exposes no request
correlation key, so the inspector never searches for or claims a paired request.

## Metrics permission wire

The endpoint is Redis-backed and intentionally not modeled as a paged
`ModelTable`:

- `GET /api/metrics/permissions` returns a normal `{data, count}` envelope.
  The complete set is normalized and sorted by account in the client because
  Redis ordering is nondeterministic.
- A permission value may be a single string, an array, or `null`; all normalize
  to `string[]` for the controlled `TagInput` fields.
- `POST /api/metrics/permissions/<encoded-account>` sends
  `view_permissions` and `write_permissions` as CSV strings.
- The POST result is asymmetric: `account`, `view_permissions`, and
  `write_permissions` are top-level envelope fields, not nested under `data`.
- `DELETE /api/metrics/permissions/<encoded-account>` clears both permission
  keys. It does not delete the metrics account registry entry, so the table
  refetches authoritatively and retains the row with empty tags.

Accounts are immutable in this surface. There is no fake add, search, paging,
or client table framework. Every save and clear refetches the authoritative
list. Empty tags are submitted as empty CSV strings, matching the backend's
current contract.

## Styling and showcase

Monitoring components use semantic `monitoring-*` classes and application
tokens only. A consuming app must include `admin-monitoring.css`. This repo's
portal and showcase theme entries do so. The showcase's Admin Monitoring demo
contains static request, response, JSON, and HTML-looking plain-text cases for
both-theme verification without mutating a backend.
