# Operational Fleet

`FleetOverview` is the reusable health matrix at the top of the global Dashboard.
`FleetPage` presents the same component at the mount-relative `/fleet` destination.
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

## Reviewed scaling

Scaling requires a literal superuser with capacity authority and a browser user
session. External infrastructure remains read-only. The backend enforces its
credential provenance and 600-second freshness requirement. A 440 opens the
existing fresh-auth handler, spends consent, and requires explicit refreshed
review. Neither planning nor applying is automatically replayed.

The focused native dialog refreshes inventory before staging. Local intent is
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

Run `node scripts/verify-admin-operational-fleet.mjs` and
`node scripts/verify-admin-operational-fleet-mounted.mjs`. The mounted verifier uses
an isolated injected transport and rejects every real host. It exercises actual
React components in StrictMode, custom embedded mounts, denied request suppression,
cancellation, stale responses, single-flight, fresh-auth without replay, cross-page
progress and unknown-outcome reconciliation. Browser light/dark, narrow layout,
native focus and console proof belong to the integrated closing run.
