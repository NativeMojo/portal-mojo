# Deployments

`DeploymentsPage` contributes one global Operations workspace. The Admin section
singleton belongs to `admin/domains/operations.ts`; its route lazily imports the
page. `WebAppDetail({id,onClose})` is the standard `modal.detail` record body.
Import these through `portal-mojo/admin/operations` after central registration.
The domain's owned stylesheet is `styles/components/admin-deployments.css`.

API and WebApp lanes are independently admitted. API sections require exact global
`view_platform|manage_platform|admin`; `view_platform_security` alone never fetches
deployments. WebApps require exact global `view_dns|manage_dns|security` in this
Admin workspace. The finite Fleet `backendGlobalCan` helper reproduces backend
category expansion; the frontend's broader admin wildcard does not admit reads.
Inactive lanes and denied identities mount no domain query. No active group is
inherited. Explicit owning-group action scope is separate from page scope.

API uses `GET /api/account/admin/platform?sections=deployments,api`. The last
converged serving SHA and its observation date remain separate from the latest
attempt. Server node summary distinguishes restart proof, reported success,
dispatched and failed nodes. Durable diagnosis is separate from replaceable node
observations. Unknown and stale states remain visible. Recovery supports retry
same SHA, verify and converge according to the exact attempt status matrix; each
confirmation refreshes the attempt first. Retry sends a stable bounded
`Idempotency-Key`, then watches its returned attempt ID. There is no arbitrary SHA
input, API rollback, framework update or pin editor.

WebApp summary lists are bounded to 50 with honest truncation disclosure. Full
summary, default graph ownership, registered release history and deployment
attempt history are separate reads. The default graph is positively projected:
no bucket, prefix, key, unrelated group data or raw metadata reaches Query.
Full summary's latest attempt has no release identity; the detail joins actual
attempt history and exact deployment status before naming its attempted version.
The current release pointer is desired content, never proof of fleet convergence.
HTTPS health and active certificates are independent observations.

Rollback requires `manage_webapp` plus the owning object's SAVE authority (`manage_dns|security`).
Current-user membership may be resolved only for that known app's owning group;
global grants bypass unnecessary membership reads. Bootstrap eligible groups do
not grant or narrow existing-app custom actions. Manual release registration has
its own exact object SAVE predicate (`manage_dns|security`); read-only `view_dns` does not grant release registration; workflow generation requires security or
both WebApp and DNS management. A 403 removes app mutation controls for that
session. The backend remains authoritative for all object, actor, origin,
interactive and freshness rules.

Rollback selects a concrete noncurrent release in `uploaded|live|superseded`,
requires typed `app/version`, refreshes ownership/current pointer/target, then
sends `{webapp,release,group}`. It watches the exact returned deployment through
`/api/edge/release/deployment/ID`, validating deployment/app/release identities.
Only `live` is success. `rolled_back` means the attempted version was unsuccessful;
a failed rollout can leave mixed nodes. An uncertain rollback is not replayed on
remount. Its safe receipt blocks conflicting app mutations while it is unsettled.

New WebApp uses separately admitted bootstrap eligibility and server onboarding
options/precheck. Missing destination or allowed bucket blocks creation with a concrete prerequisite. Existing workspaces precheck their concrete address before create. New-workspace intent deliberately has no domain before create and does not require an invented ready verdict. Defaults are production, main,
dist and the first allowed bucket. The durable server operation owns cursor,
revision, status, activity and resources. Choose/cancel use its latest observation;
a revision/lease refusal requires another detail read, never repeated POST.
Unknown cursors and parked waiting states stop automatic reads. Optional GitHub
verification preserves `unavailable` versus explicit attestation. Closing does not
cancel server work. A matching actor/origin safe receipt resumes by operation UUID;
an app without such a receipt shows unfinished diagnostics without creating a
replacement resource. An uncertain create can be deliberately retried only with
its immutable profile and UUID after an exact 404 observation.

Deploy setup lazy-loads workflow/key/upload surfaces. Generated YAML stays outside
Query and references one repository secret named `MOJO_DEPLOY_KEY`. Copy/download
instructions leave installation to the operator. Keys are revealed in one focused
transient dialog, cleared on close, authority/session replacement or unmount.
Receipt replay with `token:null` says the secret is unavailable and requires an
explicit new rotation. Rotate/revoke explain CI impact; existing content remains
independent. Revoke's backend freshness window is 300 seconds; other sensitive
custom actions use 600. A 440 prompts through `requestFreshAuth` but never replays
the POST; refresh and renewed explicit consent are required.

Built artifact upload is register → anonymous checksum-bound PUT → complete →
exact deployment observation. Files are normalized relative paths, reject
traversal/collisions, and are hashed with SHA-256 before registration. Defaults
are 5000 files and 1 GiB; backend limits may be lower. Signed destinations and File
objects stay transient. Each PUT uses only the returned exact checksum header,
raw bytes, `credentials:omit`, `redirect:error` and no API bearer. A failed/CORS
PUT stops completion. Resume requires reselecting and hashing an identical
manifest before registration remints URLs; a verified release with no uploads is
handled. Saved receipts contain only actor/origin, finite IDs, immutable safe
profile/address or normalized manifest, never key material or signed URLs.

`useDeploymentObservation` reads only known identities, stops on terminal,
parked/unknown cursor, failure, owner disposal or a bounded deadline, and skips
hidden or blurred documents. Refresh/Resume resets the read budget without
creating a new server operation. Native Escape/backdrop dismissal and repeated
submission are locked during HTTP writes. Observations can stop after close;
submitted server work persists and is reconciled from safe receipts.

Mock integration uses `deploymentsMock(path,opts,{user,keyBacked,authTime,group?,
interactive?})`, returning `undefined` for unrelated paths. The central bootstrap
composer consumes `readDeploymentBootstrapFacts(caller)` and merges only its
explicit WebApp fields. `deploymentMockStorageFetch` is an explicit mock-only
secondary PUT simulator; real deployments use browser fetch. Scenario controls
and `AdminDeploymentsDemo` exercise authority splits, current-A/failed-B,
reported/partial/unknown/stale evidence, same-SHA retry, rolled-back/mixed WebApps,
setup prerequisites, cursor/lease refusal, uncertain create, key replay, upload
failure and bounded observation. Fixtures establish UI contracts, not live rollout.

Run `node scripts/verify-admin-deployments.mjs` and
`node scripts/verify-admin-deployments-mounted.mjs`, then repository typecheck.
The first covers positive projection, authority/status/receipt/wire contracts and
actual client idempotency headers in both transports. Mounted StrictMode tests
hold responses to exercise single-flight, unsettled rollback remounts, owner
replacement, fresh auth without replay, one-time key replay, denied no-request
lanes, safe operation resume, terminal/parked/error/timeout and observer disposal.
The central integration owner runs the full release/modal inventories and actual
light/dark, narrow and native-dialog browser verification.


New workspace continuation uses the exact `operation.group.id` returned by durable
create. That group identity is saved separately from the immutable create profile;
resuming never rewrites `group_intent:new` into another create body. The address
cursor reads options for that concrete group and explicitly links to the host's
registered Domains destination when configured and independently admitted. A new
workspace starts without an own/ancestor domain; configure or connect one for the
named group, refresh options, then precheck the address and submit the returned
`domain`/normalized `label` with the latest operation revision. Continue stays
unavailable with a concrete prerequisite until an actual address choice exists.
The frontend never borrows an installation-wide or unrelated workspace domain.

A WebApp deployment marked `superseded` with `terminal:true` stops observation and
settles its receipt, with `success:false`. It is not a successful rollout.

Upload receipts durably record `completion_submitted`, the completion timestamp,
and bounded prior deployment IDs before sending completion. Completion is a new
promotion request: after an earlier failed, rolled-back or superseded attempt,
repeating it can create another deployment. A lost response therefore blocks
implicit registration/completion even after remount or same-manifest reselection.
Reconcile reads the owning app summary/history and validates exact app, release,
version and newly observed deployment identity before observing terminal outcome.
Ambiguity remains unknown. Only a separately typed, freshly rechecked new deployment
consent permits resetting the local upload phase; that consent sends no POST and
requires a subsequent deliberate reselect/upload/deploy action. It neither erases
an earlier attempt nor silently replays it. The mock follows the backend's narrow
reuse rule: current release plus an active/live attempt, not permanent reuse for
every release ID.


Owner lifetimes survive React development StrictMode's setup/cleanup/setup replay.
Query closures keep a stable identity/scope handle whose live signal is renewed
before read effects resume; they do not retain an aborted first-render controller.
Actual unmount, actor/session replacement and authority or active-state changes
abort the old lifetime and discard late results. The mounted harness places
StrictMode above the providers/router so React 19 actually replays initial effects,
and verifies cold authorized bootstrap/platform reads through an asynchronous
transport gate as well as real owner cancellation.

### KISS presentation

The default API lane shows last convergence and attempts. Collector/framework/coordination facts are under Deployment details. Record inspection and setup preserve status/blocking messages while moving operation identity, revision and history into requested details. See [visual QA](admin-presentation.md).
