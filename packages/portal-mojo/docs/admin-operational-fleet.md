# Operational Fleet

`FleetOverview` is the reusable health matrix at the top of the global Dashboard.
`FleetPage` presents a separate standalone workspace at the mount-relative `/fleet` destination. Its task dialogs and styles are isolated from `FleetOverview`; the Admin Dashboard keeps its existing overview, disclosure, editor and behavior.
Import both, `backendGlobalCan`, contracts and pure staging helpers from
`portal-mojo/admin` (or `portal-mojo/admin/infrastructure`). The scale editor loads
only when opened. Existing Dashboard directory, activity and login panels remain
below this component.

```tsx
<FleetOverview mount="/product/control" />
<FleetPage mount="/product/control" />
```

Both accept optional `mount`, `links` and `showConfigurationLink` props. The mount
is inferred from the current dashboard pathname, removing a final `/fleet` on
that page; pass it explicitly in a custom host. `links` maps source names to
`{ to: 'relative/registered/route', grants: ['exact_backend_key'], superuser?: true }`
or `null` to suppress a destination. Hosts with a partial registry must suppress
or replace unavailable destinations. Built-in links target existing Admin pages
only; Fleet Configuration remains its separate advanced superuser destination.
Use `showConfigurationLink={false}` when that destination is not mounted.
`FleetOverview` also accepts `headingLevel` (`1 | 2`, default `2`); use `1` when
rendering it as a standalone page. `FleetPage` supplies its own level-one Fleet heading.
`capacityDetails="modal"` replaces the capacity disclosure with a button and a
read-only modal. This option applies to `FleetOverview`. The reusable overview defaults to `"inline"` to preserve the current Admin Dashboard. `FleetPage` always uses the standalone tabbed capacity inspector.

## Authority and evidence

`backendGlobalCan(user, grant | grants)` checks global permissions only. It mirrors
Python truthiness of JSON values and the finite `helpers/perms.py` categories:
`users`, `groups`, `security`, `comms`, `jobs`, `metrics`, `files` imply only their
own `view_`/`manage_` checks. It has no group membership or implicit `admin`
wildcard. In particular `comms` and `admin` do not imply `manage_aws`.

The dashboard request needs `view_admin | manage_users | manage_settings | admin`
or literal superuser. Capacity reads separately require `manage_aws` or literal
superuser. Every request and query key is bound to actor plus session revision;
ordinary token renewal preserves that revision. Each denied read is suppressed.
Source statuses and server timestamps survive independently. The availability
headline is the server verdict; attention counts never recompute it. Missing
jobs/check observations stay unknown. Wholly restricted sections collapse to
one Restricted row. Unconfigured SMS/email and zero-ticket rows are absent.
Dashboard data is positively projected before Query storage; arbitrary nested
provider output and deployment stderr never enter this cache.

Load-balancer target health, fixed ingress addresses, and stable node outbound
addresses are distinct observations. Unknown egress reads say unavailable, never
an empty allowlist. Serving-process database/Redis reader routing is explicitly
per process. Database and cache members retain their own lifecycle/status. An Aurora reader absent from filtered instance facts may carry null class/status with unknown lifecycle. That database remains transition-blocked while node/cache evidence and independently supported changes remain available.

## Standalone Fleet workspace

`FleetPage` lazy-loads `FleetWorkspace`, and each inspection, editing and progress
body loads only when opened. Its scoped `.fleet-page` and
`.fleet-standalone-dialog` styles do not change the Dashboard. Infrastructure and Operations task tabs keep
the backend availability verdict and each source status. Overall observation age
is visible; each source timestamp stays in its info popover, while stale sources
also show their age inline. Stale thresholds remain in info popovers; refreshing never relabels
old evidence as current. Missing sources stay unknown, denied sections stay
restricted, and unauthorized related-page links are omitted.

The primary action is **Change capacity**. **Inspect capacity** opens App nodes,
Database, Redis and Addresses tabs. Fleet outbound allowlist, fallback attachments,
reserved addresses and fixed load-balancer ingress appear separately. **Copy
allowlist** requires every availability proof, an enabled observed policy and no
pending nodes. Missing evidence never becomes an empty allowlist. Database and
Redis reader routing explicitly describe the serving process.

The standalone editor uses one `CapacityDraft` from `standalone-data.ts` across
App nodes, Database and Redis tabs. App nodes has Add nodes and Remove nodes tasks.
Additions require an explicit healthy, registered, running, settled source; its
size and target groups are shown, and Placement is a focused subnet dialog.
Removal retains the existing self-node and healthy-floor checks; the server also
re-proves each target group's floor and ownership.

Every database member shows its exact ID, role and **current** class. Resize and
remove checkboxes target that ID; there is no automatic reader selection or
shared existing-reader sizing fan-out. Newly added readers inherit the current
source class, even when the writer also resizes. Observe their concrete IDs after
creation and resize separately. For a Redis group, stage size **or** replica
count in one plan. The other control is locked until the first returns to current
values; apply, refresh and separately review the second change. The pure compiler
rejects mixed-dimension intents independently of those controls because the
current backend cannot quote them cumulatively.

The explicit **Review changes (N)** button is the only plan request. It replaces
the editor with the authoritative server plan, including step order, warnings,
unknown prices, expiry and exact-plan consent. **Back to changes** preserves the
draft and invalidates consent. No background/debounced quote is requested by the
standalone editor. **Refresh and clear changes** explicitly discards the draft
before reading fresh inventory; there is no silent reset. Initial open also
requires a fresh observation before staging. Apply uses only `fleetOperations`.

**View capacity progress** is independently available with capacity-read authority,
including external infrastructure, unavailable inventories and non-superuser
readers. It uses the same in-session operation record as Dashboard. It never
hydrates an operation from storage or creates another coordinator. When an apply
reply is lost, the exact batch ID can be entered for read-only reconciliation of
the retained plan. Matching terminal evidence is required before another change.
Actor/session changes and permission loss fence requests and close owned dialogs;
Escape/backdrop and explicit close are locked while requests are pending.

The Showcase demo uses `FleetPage` and a focused Demo controls dialog. Scenario
switching is disabled during unresolved operations. Read-only mock batch IDs are
available through Refresh mock evidence so lost replies can be reconciled without
clearing the browser's guard.

## Dashboard reviewed scaling

Scaling requires a literal superuser with capacity authority and a browser user
session. External infrastructure remains read-only. The backend enforces its
credential provenance and 600-second freshness requirement. A 440 opens the
existing fresh-auth handler, spends consent, and requires explicit refreshed
review. Neither planning nor applying is automatically replayed.

The existing Dashboard focused native dialog refreshes inventory before staging. Local intent is
compiled into at most 20 steps, then debounced about 400ms into
`POST /api/aws/capacity/plan {steps}`. Displayed order, descriptions, warnings,
prices and expiry come from that stored plan. Null prices are unknown. Editing,
refreshing, expiry, permission loss or session replacement invalidates consent.
A synchronous guard protects submission, including duplicate activation.
`POST /api/aws/capacity/plan/apply` sends only `{plan_id}`.

Node removal stages drain then terminate, excludes this serving node, requires
identified self and complete inventory, and retains one currently healthy target.
Unproven additions never satisfy the healthy floor. A freshly observed owned,
unregistered, settled node gets a separate Terminate drained node recovery path;
AWS ownership and drain completion are re-proved by the server. App size remains
informational. Add-node placement omits empty fields and locally validates subnet
shape; AWS proves the source, VPC, availability zone and address suitability.

Database writer and existing-reader sizes are independent curated keys. Reader
resizing fans out over surviving concrete reader IDs with different current
classes; staged removals are excluded. New readers inherit the **current** source
class, even when the writer also resizes in the plan. Refresh their concrete IDs
after creation and separately review resizing them. Writer resizing causes
minutes offline. Redis sizing applies to the whole group; replica counts retain
the server minimum and the editor explains rolling or downtime impact before
review. All count/cache/database resize steps explicitly send
`apply_immediately: true`.

## Observation and uncertain outcomes

`fleetOperations` lives outside component/dialog state. Its records contain safe
IDs and observed batch facts, keyed by installation and actor. Unresolved state
survives dialog closure, Dashboard/Fleet navigation, and same-actor reauthentication;
new sends and read replies are still fenced to the exact session revision. A
different actor sees no previous actor record. No credentials or mutation drafts
are stored locally. The coordinator never replays a mutation. Expiry or session refusal at the final transport boundary is provably unsent: refresh inventory and review again. A transport failure after that boundary remains unknown and retains the reconciliation guard.

Running batches are observed about every ten seconds, with a backstop covering
90 minutes per step. Completed steps remain visible on failure; nothing rolls
back. `stalled` directs the operator to the jobs runner/cleanup channel. Poll
failures and exhausted budgets say progress unknown and offer explicit observation
refresh. A duplicate apply receipt follows its existing batch. Stale/expired plans
require another review.

A lost apply reply retains the submitted plan ID and blocks new mutations, even
when no batch ID was acknowledged. Closing, refreshing inventory, signing in
again as the same actor, and selecting a mock scenario do not clear this block.
Inspect capacity server logs and AWS state, obtain the exact plan's batch ID, and
enter it for read-only observation. Only matching terminal evidence resolves the
block; an unrelated batch is refused. Ambiguous provider outcomes remain unknown.

## Mock and executable verification

`client/operational-fleet-mock.ts` is mock-only and exports:

- `handleOperationalFleetMock(path, method, body, params, actor, authTime)` → an
  envelope, `undefined` for unowned routes, or an intentional lost-response error.
  The central mock supplies its validated actor/global grants and bearer auth time;
  optional `actor.credential_kind` identifies a confirmed confined credential.
- `mockOperationalFleetScenarios`, `setMockOperationalFleetScenario`,
  `getMockOperationalFleetScenario`, and read-only `getMockOperationalFleetBatchIds`.

The default fixture includes asymmetric reader classes. Scenarios cover external,
restricted, partial, transitioning/drained nodes, missing evidence, unknown prices,
stale/expired/duplicate plans, partial failures, stalled progress and lost replies.
Changing scenario resets the simulated server, not the browser operation record.

Run `npm run verify:admin-fleet-workspace` for standalone compiler and mounted coverage, plus `node scripts/verify-admin-operational-fleet.mjs` and
`node scripts/verify-admin-operational-fleet-mounted.mjs`. The mounted verifier uses
an isolated injected transport and rejects every real host. It exercises actual
React components in StrictMode, custom embedded mounts, denied request suppression,
cancellation, stale responses, single-flight, fresh-auth without replay, cross-page
progress and unknown-outcome reconciliation. Browser light/dark, narrow layout,
native focus and console proof belong to the integrated closing run.

### KISS presentation

The Dashboard overview uses its existing compact service/status rows and modal Details. The separate Fleet workspace uses compact evidence cards and info popovers. Both editors retain a single draft across App nodes, Database and Redis tabs; the standalone editor enters review only through Review changes and discards consent on Back. All staged changes appear in one exact server-plan review. See [visual QA](admin-presentation.md).
