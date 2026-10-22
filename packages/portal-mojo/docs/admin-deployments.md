# Deployments

`DeploymentsPage` contributes one global Operations workspace. The Admin section
singleton belongs to `admin/domains/operations.ts`; its route lazily imports the
page. `WebAppDetail({id,onClose})` is a focused `modal.open` task dialog.
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
Full summary's latest attempt has no release identity; the detail resolves its
exact app/attempt-filtered generic history record before naming the version.
Generic attempt graphs omit the parent, so the request binds both `webapp` and
`id`, asks for one row, and validates the returned attempt and release IDs.
Ordinary viewers are never sent to the stronger rollout-status endpoint: it
requires WebApp SAVE authority. Admitted operators can inspect node evidence
through that endpoint. Selected active attempts use bounded, owner-fenced
observation; terminal outcomes invalidate the owning summary and history.
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

Release and deployment history have separate paged views. Eligible release rows
open a preselected rollback; the focused chooser also pages beyond the first 25.
Rollback selects a concrete noncurrent release in `uploaded|live|superseded`,
requires typed `app/version`, refreshes ownership/current pointer and the exact app/target-filtered release, then
sends `{webapp,release,group}`. It watches the exact returned deployment through
`/api/edge/release/deployment/ID`, validating deployment/app/release identities.
Only `live` is success. `rolled_back` means the attempted version was unsuccessful;
a failed rollout can leave mixed nodes. An uncertain rollback is not replayed on
remount. Its safe receipt blocks conflicting app mutations while it is unsettled.

Before creation, App and Build options share one retained draft. After creation,
only the current server task appears beside noninteractive App → Address →
Repository → HTTPS progress; operation/revision/activity live in Setup details.
Closing preserves setup; cancelling server setup requires explicit confirmation.
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

Deploy opens its GitHub, Upload and Other CI methods directly. Workflow and
Other CI instructions use focused dialogs. Linked-key controls follow observed
state: create when unlinked; rotate when linked; revoke only an active key. Both
CI methods expose these controls. Deploy setup lazy-loads key/upload surfaces.
Generated YAML stays outside
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

The supported profile editor writes only `display_name`, `environment`,
`github_repository`, `deployment_ref` and `build_output` through the existing
WebApp model save. It requires exact SAVE authority independently of
`manage_webapp`; owner, bucket, release pointer, slug and credential fields are
not editable here. The API wire field is `github_repository`, while the display
DTO calls it `repository`. Save re-reads ownership and all baseline values,
refuses observed drift, then reads back the saved profile. This is a client
stale-value check, not an atomic server revision condition. Profile changes do
not deploy content or update a workflow already installed in GitHub.

A lost profile-save response retains its submitted receipt and blocks another
save. Reload shows current values but does not prove the earlier writer finished.
Only after that read may an operator explicitly acknowledge the unknown prior
writer with the app-specific phrase. Acknowledgment sends no POST; a new change
and fresh preflight are still required. A late observed commit refuses the next
save. Known profile 440 refusal settles its unsent receipt and never replays the
POST. No profile patch or secret is retained in the receipt.

Run `node scripts/verify-admin-deployments.mjs` and
`node scripts/verify-admin-deployments-mounted.mjs`, then repository typecheck.
The first covers positive projection, authority/status/receipt/wire contracts and
actual client idempotency headers in both transports. Mounted StrictMode tests
hold responses to exercise single-flight, unsettled rollback remounts, owner
replacement, fresh auth without replay, one-time key replay, denied no-request
lanes, safe operation resume, terminal/parked/error/timeout and observer disposal.
The additional `verify:admin-deployments-setup-mounted` and
`verify:admin-webapp-inspection-mounted` commands cover state-aware setup,
later-page target preflight, ordinary CI viewers/observation, scoped refresh and
profile stale/unknown/fresh-auth journeys. The integration owner runs the
reviewed modal inventories and actual
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

API and WebApps are distinct tasks; hosts admitting only one lane show no tab
strip. Creation appears only in WebApps. The API lane shows last convergence and
attempts, keeps unavailable/stale evidence visible, and puts secondary collector
facts behind an info icon. API inspection separates Overview, Nodes and Activity
and offers recovery only on the latest applicable attempt. WebApp inspection
separates Overview, Deployments, Releases, Deploy and Settings; wholly read-only
viewers omit Deploy. Useful node evidence adds tabs to an attempt dialog only
when there is more than one content area. No single-item side rail or long
collapsible section is introduced. Admin Dashboard stays unchanged. See
[visual QA](admin-presentation.md).
