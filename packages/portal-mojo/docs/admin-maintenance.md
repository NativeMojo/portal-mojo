# Maintenance

```tsx
import { MaintenancePage } from 'portal-mojo/admin/operations';
```

`MaintenancePage` supplies one global Operations destination at `maintenance`.
It renders Database, Cache and Framework as independent evidence sections.
Page admission is AWS read (`manage_aws`) **or** framework read
(`view_platform`, `manage_platform`, `admin`), with literal superuser bypass.
Each read uses the Fleet exact backend permission helper; group membership,
the frontend admin wildcard and `comms` do not grant AWS authority.

A scan reports offered major upgrades, region, scan time, scheduled-scanning
state and each warning's exact IAM action. It supplies no complete inventory
counts. Empty findings mean **No offered major upgrades found in this scan**.
Partial or unavailable scans never establish support coverage. Standard and
extended deadlines are separate; an unpublished deadline remains unknown.
Targets and resource identifiers retain their server spelling. Release notes
accept credential-free HTTPS links only.

Writes additionally require platform management authority and current managed
infrastructure proof. Bootstrap has its own independent dashboard permission:
without that grant the page retains authorized inventory but cannot establish
mode or offer writes. External infrastructure remains readable and explains
that IaC owns changes. Missing, denied or malformed mode proof blocks writes.
The backend remains authoritative for interactive, non-key-backed access and
600-second fresh authentication.

The native confirmation names current and target versions, outage/restart
impact, and snapshot-based recovery. Type the exact case-sensitive resource
identifier and explicitly choose Immediately or Next maintenance window.
`apply_immediately` is a real boolean, including `false`. Changing evidence or
session closes the old confirmation. Confirmation is single-flight; transport
uses `mojoCall`, AbortSignals and a final session/authority fence without retry,
`withFreshAuth`, Query mutations or raw fetch.

After acceptance the exact resource and target are observed every ten seconds,
at most 180 times. Completion requires both `settled === true` and
`upgraded === true`. A target version before settlement, old available version,
missing resource, denied/malformed read, or mixed cache member versions remains
unconfirmed. Timeout retains the receipt and offers explicit status refresh.

Attempts are scoped by installation and actor in a module registry, surviving
dialog closure, navigation/remount, timeout, ordinary token renewal and a new
session for the same actor. Unmount/session changes abort local observations;
provider work can continue. An attempted/unknown provider outcome never unlocks
another apply merely because a refreshed report still offers the old version.
Reconcile the provider operation and maintenance window. A definitive refusal
before provider work can be cleared only by a deliberate successful Refresh
Maintenance and a new confirmation. A 440 requests authentication once and
never replays the write.

Framework shows installed/latest versions, check time/source, pin policy,
update availability and the backend blocker. Held/pinned current versions use
“Resume automatic updates and redeploy”. The operation clears the pin and
redeploys the last converged application SHA. Policy clearing and deployment
acceptance are separate facts: a 503 or lost response can leave automatic policy
active with unknown deployment acceptance. That attempt remains guarded across
remount and reauthentication. Refresh Framework and inspect Deployments even
when no deployment ID was returned. Acceptance points to Deployments and never
claims fleet completion. There is no version picker or pin/hold writer here.

`maintenanceDeploymentsHref(pathname)` preserves an embedded Admin prefix.
`MaintenancePage` also accepts an explicit `deploymentsHref`, `pollInterval`
and `pollLimit`; production defaults are ten seconds and 180 observations.

Mock integration: call `maintenanceMock(path, method, body, params, context)`
only for its owned paths. It returns `undefined` for every sibling path.
`context` contains authenticated user, claim-derived `keyBacked` and `fresh`.
Use `readMaintenanceBootstrapFacts()` in the **single central bootstrap
composer**; Maintenance does not claim that endpoint. Preserve its explicit
`bootstrap` denied/malformed scenario and derive mode and managed capability
from the same facts. `MAINTENANCE_SCENARIOS` and `setMockMaintenanceScenario`
exercise partial scans, waiting/settlement, provider uncertainty and Framework
policy/deployment uncertainty through the actual page.

Integration manifest: lazy-load `admin/maintenance/MaintenancePage.tsx`; global
section id/path `maintenance`, label Maintenance, navigationGroup operations,
nav union `sys.manage_aws | sys.view_platform | sys.manage_platform | sys.admin`.
Import `styles/components/admin-maintenance.css`; register `AdminMaintenanceDemo`
from `apps/showcase/src/pages/components/demos-admin-maintenance.tsx` lazily.
Register `verify-admin-maintenance.mjs` and `verify-admin-maintenance-mounted.mjs`
once each; the harness is an imported test adapter, not a command. Public index
exports are MaintenancePage, maintenanceDeploymentsHref, maintenanceAccess,
frameworkActionLabel, MAINTENANCE_ENDPOINTS and maintenanceCompleted.

Resource rows keep the offered version, provider state and upgrade action visible. Support deadlines, member evidence and recovery notes remain under each row’s disclosure. Dates use compact local presentation and preserve the original wire value in their title. Framework policy uses readable labels; missing or refused evidence remains explicit.
