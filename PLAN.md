# portal-mojo — Build Plan

**What:** the React-era portal toolkit for django-mojo, plus the base admin portal
shipped with every django-mojo deployment. Succeeds `web-mojo`, which goes to
maintenance mode and keeps serving its three existing portals untouched.

**Status:** Chunk A COMPLETE (A0–A4, 2026-08-04). Chunk B started: B1
(`defineModel`) shipped 2026-08-04 — see row. **Live-backend validated
2026-08-04** against a real django-mojo (mverify dev @ :9009, `npm run
dev:live` / preview config "portal-live"): login → me → groups → member →
list (search/sort/lookups/`dr_*` triple/`__isnull`/paging) → save →
all four user POST_SAVE_ACTIONS, plus reject-on-failure surfacing real
server errors (bad phone format). Contract corrections from measurement:
account app mounts at **`/api/user`** (not `/api/account/user`); datetimes
are **epoch seconds** on DateTimeField columns but the shape is
**per-column, not global** — DateField emits `'YYYY-MM-DD'`, JSONFields
carry whatever a producer wrote (ISO strings, occasionally epoch millis),
so every date surface reads through `date/fns detectTemporal` and the form
wire boundary **answers in the shape it read** (`Field.outputFormat`
overrides; unread fields default to epoch seconds) — cb1fb23; list rows
have **no `role`/`created`/passkey fields**
(`display_name` nullable; `permissions` dict rides the row; me-graph adds
`has_passkey`/`requires_mfa`); metrics wire is a **slug-keyed map**
`{data:{slug:[…]}, labels}` normalized at the one boundary; backend
`has_permission` has **no `admin` wildcard** (only `is_superuser` +
category rollup — client stays deliberately more permissive; server
authoritative). Mock realigned to all of it. B2 (TableView full fidelity)
shipped 2026-08-04 — see row.

**2026-08-05:** portal-mojo is now maestro-managed — project **45** + board
**47** ("portal-mojo") on workspace **17** (NativeMojo); `.claude/maestro.json`
+ the dev skill pack (`.claude/skills/`) checked in. **The remaining plan is
board-backed** (one work record: these tables keep history + architecture, the
board carries the queue — item ids in the rows below). The full
`forms/inputs` survey (5.5k lines + the calendar engine, every file read)
expanded B4 into two small epics + plain tasks under Ian's **component value
bar** (see Working agreements), and the **admin program was elevated** from
Phase 2 to an accepted epic (#1260): ALL admin domains port, use-case driven.
Three analyses ran and landed the same day: the web-mojo admin inventory
(18 domains, port-vs-redesign verdicts) and the django-mojo admin-surface +
recorded-metrics map filed the epic's children **#1282–#1300**; the
component value-sweep filed **#1301–#1308** (chat feed, detail primitives,
DataView, fmt completion, FormWizard/Tabs, AddressField, MarkdownView,
drawer — see "Component sweep verdicts" under the B4 breakdown) and three
backend gaps went to NativeMojo Inbox as django-mojo items (**#1309–#1311**:
scheduled-task run-now REST, SES send-quota, realtime presence REST).

**2026-08-05, the parallel migration run:** B3, B4 (complete), C1, and the
sweep components were built in ONE session by ~20 worktree agents under
`MIGRATION.md` (file-ownership contract → zero merge conflicts across 20
merges), each merged/wired/typechecked individually, then browser-verified
centrally (both themes, clicked, console clean). **DONE on the board:** B3
autosave #1256 · C1 DetailView #1257 · the date/time epic #1266 (all 7:
calendar core, popover, DatePicker, DateRangePicker+presets+FilterBar
upgrade, TimePicker, TimezoneSelect, DateTimePicker) · the server-selects
epic #1275 (CollectionSelect, CollectionMultiSelect) · ComboBox #1270 ·
TagInput #1276 · MultiSelectDropdown #1277 · field registry + epoch wire
boundary #1278 · detail primitives #1302 · DataView #1303 · fmt #1304 ·
MarkdownView #1307 · drawer #1308. Notable cross-stack finds recorded on
the items: ComboInput orphaned in web-mojo (rich spec restored); V8
ICU-canonical vs Python zoneinfo timezone ids (alias tolerance built);
DST-correct offsets at the selected date; django-mojo JSONField dict-merge
semantics in autosave. Post-run design revision: CollectionMultiSelect now
DEFAULTS to a dropdown (trigger + Popover; `variant="panel"` keeps the box)
and the playground rail folded into 8 collapsible groups (c869ea7).

**2026-08-05, wave 3 (C2/C3/C4):** three parallel worktree agents, merged
individually (23 conflict-free merges total across the migration), wired,
typechecked, browser-verified dark+light on the mock AND `dev:live` @9009.
**DONE:** C2 charts #1258 (stats/data dialogs, custom-range dialog on
DateRangePicker feeding REAL `dt_start`/`dt_end` epochs — web-mojo sent
`dr_*`, which `/api/metrics/fetch` silently ignores, so legacy custom
ranges never worked; MetricsMiniWidget, KPITile/Strip, CircularProgress,
PieChart, exportChartPng; Dashboard showcase) · C4 first live screens
#1281 (Users/Groups/ApiKeys/Logs + ArmedButton/undoToast/progressToast;
mock parity rebuilt — dr_* epoch compare, FK id lookups, `graph` echo;
live-verified: 970 users/574 groups/97,514 logs as portal_test via the new
in-app login; ApiKeys ride `/api/account/api_keys` — the `/api/group/apikey`
500s were NOT an endpoint bug (#1313, since rewritten as an ops note): the
Jul 27–Aug 2 ApiKey hardening added a `user` FK and @9009 had migrations
0048/0049 unapplied, so `account_apikey.user_id` did not exist; applied, the
endpoint answers 200 with 111 group keys). **REVIEW:** C3
in-app auth pages #1259 (login/forgot/reset/magic/passkey on A1 flows,
fresh-auth 440 step-up modal, MFA panel, password strength+generator,
`VITE_MOJO_AUTH` switch — awaiting Ian's real-authenticator passkey touch;
OAuth redirect re-deferred with the wire documented in-seam). Mock parity
follow-ups filed as #1314. **Remaining Phase 1:** land #1259 after the
passkey touch. The admin program epic #1260 is underway; the first six-item
package wave is complete below.

**2026-08-05, wave 4 (detail-view parity):** C4's first-screens pass
under-built the two flagship detail views — it read the sources but judged
several sections endpoint-less during the exact window the @9009 migration
drift made the backend look broken. Both re-ported from source at full
inventory, two worktree agents, merged individually (25 conflict-free merges
total). **GroupView 11 sections** (Overview · Identity · Members · Sub-Groups ·
API Keys · Webhooks · Geofencing · Events · Audit · Metadata + Configure Auth),
found in passing: web-mojo rendered the webhook secret's ISO timestamps as
garbage epochs, and its centroid table had a duplicated country key; key
rotate is apikey-auth-only while managers read tokens via `?graph=token`.
**UserView 14 sections** (Overview · Profile · Personal · Security · OAuth ·
Groups · Sys/App Perms · API Keys · Devices · Logins · Audit · Notifications ·
Metadata) plus the header lifecycle (avatar, org chip, login-throttle badge,
presence, disable reasons + history accordion, full kebab). Two documented
seams: the Logins **Map** tab (web-mojo used MapLibre — list shipped at
parity first; the map SHIPPED with #1291 over #1426's dependency-free
`WorldMap`, so no dependency sanction was ever needed) and avatar upload
(multipart POST). Mock-verified dark+light, console clean, perm-gating exercised from
both a plain and a superuser session (sys-perm autosave re-badges the header
live). `dev:live` @9009 pass is BLOCKED: the browser hits the mverify bouncer's
"Are you human?" interstitial, which an agent must not click through.

**2026-08-05, showcase split:** the component playground (`Develop → Components`,
31 demo files / ~6.7k lines) came OUT of `apps/portal` — Ian: "DO NOT INCLUDE
Components as part of Admin app. We want a simple demo app we can publish to
maestro sites eventually." New workspace app `apps/showcase`: no sidebar/auth/
admin chrome, mock-only (throws if `VITE_MOJO_API` is set), auto-signs in as
the explicit mock-only `showcase.operator@nativemojo.com` identity at boot
(mock's `/api/login` looks callers up by EMAIL despite the `username` field
name — a real trap, noted in-file) so a cold-localStorage visitor gets working
permission-gated, data-backed demos with no login page. Also fixed in passing:
`.app`'s CSS grid had no
`grid-template-rows`, so the implicit row auto-sized to content and the
sidebar grew past 100vh with the page instead of scrolling internally
(`apps/portal/src/theme.css`) — same fix (`grid-template-rows: minmax(0, 1fr)`
+ `overflow: hidden`) kept `.showcase-shell` correct from the start. Publishing
`apps/showcase` to maestro sites itself is NOT done — tracked as future work,
not scaffolded this session.

**2026-08-05, wave 5 (admin packages + RecordFeed):** six approved board items
were scoped in parallel worktrees, merged as commit stacks, coherence-reviewed,
then wired and verified centrally. **DONE:** mock contract foundation #1314 ·
credentials/AdminSection foundation #1284 · RecordFeed + ticket/incident
adapters #1301 · monitoring (logs + metrics permissions) #1285 · runtime
settings #1286 · Bouncer signals/devices/signatures #1294. The review pass
closed important contract gaps: all token material is scrubbed before Query
cache storage; log request/response content is labeled from `log`, not auxiliary
`payload`; secret-setting updates preserve django-mojo's direction-sensitive
field order; Bouncer incidents correlate through `category__startswith` + MUID
search; unsupported signature deletion is absent; list export reuses normalized
params so crafted graphs cannot recover `token_nonce`. Browser verification
covered the standalone showcase and the real portal shell in both themes with
clean consoles; `typecheck` and both production builds pass. The unused backend
`BouncerSignal.token_nonce` cleanup is deliberately deferred to django-mojo
board item #1407 rather than made a portal dependency.

**2026-08-05, wave 6 (global Admin navigation):** Ian corrected the shell
model after reviewing the first package wave: Admin is one system-wide,
no-group workspace, while active-group navigation belongs only to a product's
custom portal. Board item **#1408** replaced the standalone portal's mixed
global/group menus and `GroupSwitcher` with one searchable accordion sidebar
(Overview · Identity & Access · Security · Observability · Operations), plus a
persisted 64px icon rail with keyboard expansion and tooltips. Admin section
metadata now supplies navigation domains and composes section + route
permission clauses; section-title keywords make domain searches such as
"Bouncer" discover their child pages. Standalone boot strips stale `?group=`,
does not mount `GroupProvider`, and the embedded Admin boundary masks product
group membership too. Existing product menus stay static by default and may
opt into accordion presentation, so A3/A4's group routing remains available
without leaking into Admin. Dual-mount root sections now emit exactly one
shared `/system` landing. Plan snapshot `f75418c`; implementation `9f59136`.

**2026-08-05, wave 7a (Admin identity + security operations):** six approved
board items landed sequentially from isolated worktrees and are **DONE**:
Tickets + shared right panel #1413 · Incidents/Events #1414 · Rule Engine
#1415 · Members #1411 · Groups #1410 · Users #1412. Security operations now
has permission-pinned tables and detail panels, sanitized bounded forensic
projections, safe whole-result export, ticket activity/actions, and an
always-inactive RuleSet workflow with a lossless handler-chain editor. Identity
now has reusable Member and User packages, a no-oracle admission chooser,
system-pinned global gates, lifecycle batches, and the existing full-fidelity
Group/User detail surfaces composed into the one no-group Admin sidenav.
Arbitrary raw incident JSON, unsafe Group move/delete, arbitrary-user key
creation, and targeted notification mutations remain deliberately absent.
The consolidated close passed all seven admin verifiers, all three TypeScript
workspaces, portal/showcase production builds, `git diff --check`, and browser
smoke in both themes with clean console and no horizontal overflow. Build-only
warnings remain for large bundles and Incident/Event static/dynamic import
overlap; code splitting is a later optimization, not a Wave 7A correctness
blocker.

**2026-08-06, Admin detail presentation correction:** after browser review,
Ian established the product rule that Admin record inspection uses the standard
KISS detail modal unless another presentation is explicitly requested. Board
item **#1425** converted Tickets, Incidents, Events, RuleSets, and the remaining
Settings child route to `modal.detail`, removed production RightPanel shell
wiring and record-detail routes, and retained RightPanel only as an explicit
opt-in primitive. Top-level Admin resources remain global no-group pages in the
single Admin sidenav; focused editors and confirmations stack as native dialogs.

**2026-08-06, wave 8 (GeoIP · Jobs · Network security, map-first):** four items
built in isolated worktrees and merged individually. Ian's sequencing call — build
the shared map dependency FIRST, then the domains on top of it — drove the order:
**#1426 WorldMap** → **#1288 Jobs** (independent, parallel) → **#1291 devices/GeoIP**
→ **#1287 Network security**. All DONE.

The map turned out to be a **rebuild, not a port**. web-mojo's `MetricsCountryMapView`
and `LoginLocationMapView` both render through `MapLibreView`, which injects
`unpkg.com/maplibre-gl@4.7.1` as a runtime `<script>` and draws on
`demotiles.maplibre.org` — MapLibre's explicitly-*demo* tile server; maplibre is not
in web-mojo's `package.json` at all, and `map/countries.geojson` is centroid **points**,
not outlines, imported by nothing. A verbatim port would make every admin deployment
fetch two third-party hosts at page load, which the IP-restricted admin deployment
model forbids independent of the no-library rule. `WorldMap` ships dependency-free in
`portal-mojo/charts`: equirectangular projection + inverse, antimeridian splitting,
value-scaled tone markers, intensity-ramped routes, legend toggle, pan/zoom, and an
ocean/graticule fallback with an injectable `land` prop. **Coastline geometry is an
open decision reserved for Ian** (embed public-domain Natural Earth 110m as a static
asset, vs sanction a maplibre peer-dep like zod's) — either drops in through `land`
with no API change.

The wave's recurring find: **web-mojo UI reading fields the backend never writes.**
`countryCentroids.js` has 249 rows but 244 unique ISO2 keys, so last-write-wins made
`ES` resolve to *Canarias* rather than Spain (deduped to primary territory; duplicate
keys are also TS1117). `UserLoginEvent` has no `event_type`, so every login marker on
the old map fell through to grey — recoloured on `is_new_country`/`is_new_region` via
`loginRiskTone`. Six GeoIPView/DeviceView KPI fields, plus `reverse_dns`/`ip_version`
and both `metadata` reads, exist on no model and rendered "—" forever. The geofence
simulator's "enforcement is off" notice read `decision.posture.enabled`, a key the
decision never carries, so it never once fired; the blocks log read `metadata.scope`
(reporter writes `geofence_scope`) and the posture header read `metadata.username`
(reporter writes `changed_by`/`user_name`), so both rendered blank. `GET /api/jobs/health`
is dead server-side (`get_channel_health` reads `state['stream_length']` that Plan-B
`get_queue_state` stopped returning → 400), so the dashboard is built on `/stats`;
`/api/jobs/logs?job_id=` returns **HTTP 500** (Django sets the FK attname descriptor,
so the key is accepted then dies in `normalize_rest_value`) while `?runner_id=` is
silently dropped and returns the whole log table. `IPSet.set_data` does
`"\n".join(value)`, so posting the raw textarea **string** (as web-mojo did) interleaves
a newline between every *character* and sets `cidr_count` to the character count — the
port posts a list.

Structural work: `ModelTable` widened to `T extends { id: number | string }` (Jobs and
ScheduledTasks are the toolkit's first string-primary-key tables); `geofenceData.js`
promoted ONCE into the package (wave 4 had already half-lifted it into an app file)
and the rule editor now shared between the global page and GroupView's section;
`GeoLocatedIPModel` defined once in #1291 and imported by #1287; `.text-bad`/`.text-warn`
defined for the first time (only `.text-ok` existed, so ~30 call sites across bouncer,
incidents, rules and monitoring had been rendering error text in the body colour).
**ScheduledTask ported** — the backend is complete and the page never shipped only for
a missing `registerPage`; gating it on `SCHEDULED_TASK_VIEW_PERMS` closes a real hole,
since `VIEW_PERMS` carries `owner` but neither manage grant, so an ungated admin page
silently degrades into the operator's *personal* task list. Deliberately absent: Run Now
(no REST route — django-mojo #1309), batch IP-set delete, creating a block from the
table, geofence posture editing, bypass grant/revoke, device trust toggles, and every
DELETE the four device/GeoIP models refuse.

Verification: `npm run typecheck` (three workspaces), both production builds, `git diff
--check`, and **eleven** verifier contracts — the seven prior plus new
`verify:worldmap`, `verify:admin-devices`, `verify:admin-jobs`, `verify:admin-network`.
Browser-verified on the mock in BOTH themes with clean consoles and no horizontal
overflow, across showcase and the real portal shell; fail-closed gating confirmed live
(Firewall Log correctly hidden from a `view_security` persona, since the category perm
expands one-way). `dev:live` @9009 remains blocked for agents by the mverify bouncer
interstitial.

**2026-08-06, wave 8 Storage Admin (#1298):** the global/no-group Infrastructure
workspace now contributes Buckets, Backends, and Files against completed
django-mojo #1439 (honest, finite S3 operations) and #1440 (masked FileManager
graphs). Buckets use the complete account inventory and KISS detail modals;
empty requires an ArmedButton, exact-name confirmation, and fresh auth, while
partial/unknown provider evidence survives the shared client boundary and every
POST actively refreshes in `finally`. Backends keep credential writes outside
MutationCache, never prefill secrets, require explicit authorized owner scope,
and refetch/compare FKs. Files add safe selection batches, modal FileView,
capability-URL validation, modal-local sharing, playback-stable native media,
and 5-second/12-attempt rendition convergence. Admin Files uploads now add an
explicit safe-policy manager/group chooser, Add File and whole-page drag paths,
a bounded queue with real progress/cancel/retry/recovery, private idempotent
attempts, destination verification, and coalesced authoritative refresh. Bucket
deletion and FileManager deletion remain absent. The executable contract
is `npm run verify:admin-storage`; the showcase exposes all three pages plus
playable/unsafe/rendition and cancellable destructive modal evidence for the
central light/dark browser close.

**2026-08-06, File Upload Platform foundation (#1468, #1470):** one shared
imperative transport now implements django-mojo's initiate → direct PUT or
provider/local multipart → completion → authoritative File refetch lifecycle.
Provider fields precede the multipart file, signed third-party requests never
receive API credentials, abort reaches the real transfer, uncertain completion
is reconciled before retry, and upload-only capability values never enter Query
or Mutation caches. The reusable `FileDrop`/`UploadQueue` layer adds an
accessible picker/drop target, a bounded multi-file queue, transferred-byte
progress through the existing toast API, cancellation/recovery, retry,
duplicate suppression, and truthful partial-batch outcomes; reference docs and
Showcase scenarios ship with it. Focused contracts are `verify:file-upload` and
`verify:upload-ux`.

Admin Files #1469 now consumes completed django-mojo #1485. Forms/profile
#1471 now consumes completed django-mojo #1488: reusable controlled FileField
and ImageField bindings keep positive numeric id/null wire values, preserve the
stored relation through upload + authoritative owner attachment, retain
completed candidates for retry/orphan reporting without deleting File, and
sanitize avatar capabilities independently before UserModel and Me caches.
Record and conversation attachments #1472 now consume completed django-mojo
#1487 and #1486. TicketNote/IncidentHistory use one completed, exact-parent-
group `media` reference rebuilt to the four-field safe graph before every
sanitizer/cache boundary; Assistant REST sends at most five completed
groupless reference ids and renders user `type:attachment` separately from
generated `type:file`. Both compose the shared truthful queue, preserve
candidates across save failure, and tear down on auth/permission/scope change.
Because parent records do not yet expose an exact manager readiness capability,
grouped queues use immutable group+purpose selectors and validate the returned
manager/group, while groupless queues send no selector. The focused executable
contract is `verify:record-attachments`.

**2026-08-06, wave 8 Communications Admin (#1290):** the global/no-group
Communications workspace now contributes Email Domains, Mailboxes, Sent
Messages, Email Templates, and Contact Messages. Email administration uses the
existing django-mojo SES contracts, with write-only credentials, explicit
armed/confirmed side effects, exact DNSMan-domain resolution through #1430's
optional adapter, complete manual DNS results, and authoritative refetches
after provider actions. Message and template detail stay in KISS modals; HTML
previews use a parsed, stripped, bare-sandbox iframe with a deny-all CSP.
Contact Messages preserve independent support view/manage/delete gates and
bounded PII projections. Mock coverage includes success, provider drift,
2xx persisted send failures, default-mailbox uniqueness, cascades, and
permission personas. SES quota remains a documented non-blocking backend gap
(#1310); no quota surface is fabricated. The executable contract is
`npm run verify:admin-messaging`.

**2026-08-05, wave 7a residual (Groups Admin #1410):** the app-local Groups
surface now carries system-pinned route, menu, section, and action gates;
restores the useful legacy column inventory; and offers real, reason-aware
deactivate/reactivate batches only. Delete remains absent because Group has no
`CAN_DELETE`; move and parent assignment/reparenting remain absent until the
backend authoritatively rejects hierarchy cycles (an existing parent can be
cleared to root). The #1411 `GroupMembersPanel`/admission flows and shared
identity registries are reused. Credential and audit peeks no longer issue
denied background requests. Auth configuration includes GitHub, reconstructs
inactive-group inheritance from authorized root-to-leaf detail reads, fails
closed on a partial chain, and supports null-reset to inherited policy. Mock
Group reads preserve product membership behavior on shared `/api/group` while
matching lifecycle, parent-graph, auth-reset, and DELETE contracts. Focused
verification command: `npm run verify:admin-groups`.

**2026-08-05, wave 7a residual (Users Admin #1412):** the shipped Wave 4
Users table and 14-section detail now live in the reusable
`portal-mojo/admin` identity bundle with dual-mount, system-pinned route and
mutation gates. Permission-enabled shared queries issue no denied background
reads; Member and canonical Incident/Event models come from their sibling
packages. Username changes use `change_username`, direct combined MFA writes
retry fresh auth, and lifecycle batches exclude rows already in the target
state. The mock no longer invents arbitrary-user key generation or targeted
notification preferences. Caller-only key creation uses the transient,
pre-cache secret split. Avatar upload remains deferred to multipart/fileman;
the login map and the device/GeoIP dossiers SHIPPED with #1291. Focused
verification: `npm run verify:admin-users`.

**Deep reference:** the full port manifest (tiers, contracts, trap list) is the
artifact at https://claude.ai/code/artifact/99958e23-ce3d-4607-8848-14d6c26d7081.
The web-mojo source of record is `/Users/ians/Projects/mojo/nativemojo/web-mojo`
(read-only reference — it stays parked on `main`; never edit it from here).

---

## Repo shape: one repo, two artifacts, hard boundary

```
portal-mojo/
  packages/portal-mojo   ← the toolkit (npm: `portal-mojo`, subpath exports like web-mojo:
                            portal-mojo/client, /ui, /charts, /admin …)  [shipped in A0]
  apps/portal            ← the base admin portal app: shell, auth, prebuilt pages,
                            page registry. First consumer + test bed of the package,
                            and the template `create-portal-mojo` clones per deployment.
  apps/showcase           ← standalone component playground (mock-only, no admin/auth
                            chrome) — every portal-mojo component, live, in one place.
                            Not part of the admin app; meant to be published on its
                            own (maestro sites) as a living reference. Split out of
                            apps/portal 2026-08-05 (Ian: "DO NOT INCLUDE Components as
                            part of Admin app"). theme.css + theme/ + models.ts are
                            currently COPIED, not shared, between portal and showcase —
                            a known duplication cost, acceptable while both are small;
                            revisit (extract to the package) if they drift.
```

Rules: the app imports the package, never the reverse. Every component is proven
in `apps/showcase` before it counts as done. When pages stabilize they migrate INTO
the package (`portal-mojo/admin`) so deployed portals get admin updates via
`npm update` — clone the shell, never the admin (see manifest §01).

### Admin distribution: dual-mount (decided 2026-08-04)

Admin ships as **self-registering section bundles** in `portal-mojo/admin`
(each: pages + routes + sidebar contribution + `permissions` + capability key),
mountable two ways from the same code:

1. **Standalone admin portal** — `apps/portal` mounts ALL admin sections and
   nothing else. Deployed as-is against any django-mojo instance, it IS the
   dedicated back office (the `contrib.admin` equivalent) — for products whose
   user-facing surface isn't a portal (consumer React/mobile apps), or where
   admin belongs on a separate origin (IP-restricted host, separate cookie
   surface). The capabilities endpoint makes one build fit every deployment.
2. **Embedded admin** — a product's custom portal (its own app on portal-mojo)
   imports the same sections and registers them under a "System" area gated by
   `view_admin`, beside its product pages. **Default** for products that have a
   portal anyway — one deployment and one auth session, but the Admin area is
   still global: its navigation and grants do not inherit the product's active
   group. (web-mojo's proven model across all three existing portals.)

Design constraints this puts on Chunk A (build them in from the start):
- Admin section routes are **mount-point relative** (root in standalone,
  `#/system/…` when embedded).
- Sections **contribute** sidebar groups; they never own the sidebar. The A4
  sidebar engine's registry serves global / group / `group.kind` menus AND
  contributed admin sections through the same mechanism. The standalone shell
  assembles all contributions into one global accordion; custom portals retain
  ownership of their separate, active-group product menus.
- Section visibility = permissions (now) ∧ backend capabilities (later).

## Stack (decided, with reasons)

| Choice | Why |
|---|---|
| React 19 + TypeScript strict + Vite | Largest AI prior; typed contracts; instant loop |
| TanStack Query | Server state: caching, dedup, refetch, invalidation — replaces Collection fetch lifecycle |
| Tailwind 4 (`@theme inline` over CSS-var tokens) | web-mojo's 8-line mission-control palette carried verbatim; both themes via `data-theme` |
| **No table library** | Tables are 100% server-driven (sort/filter/page are wire params) — table state IS the params store; TanStack Table would wrap ~20 lines of state in an engine we don't need. Revisit only for column resize/pinning or virtualized client rows |
| **No chart library** | web-mojo's dependency-free SVG charts port nearly whole and match the design system |
| Native `<dialog>` | Awaitable ModalManager with zero z-index/backdrop machinery |
| Hash router | Built `dist/` mounts anywhere (incl. served by django-mojo) with no rewrite config |

## Architecture rules (non-negotiable)

1. **`params` is the single source of truth** for search/sort/filters/paging —
   URL-synced, drives the server query, pills, presets, persistence. Components
   read it; nothing else owns table state.
   (`packages/portal-mojo/src/client/params.ts`)
2. **One envelope-unwrap boundary** in the client. Documented exceptions only
   (the flat `_mode=count` stats body).
3. **Failure is unmissable:** a failed save REJECTS or returns a typed error.
   web-mojo's `Model.save()` resolve-on-failure trap is not carried forward.
4. **Controlled inputs, one value pipeline** — the buttongroup/checklistdropdown
   bug class must be impossible by construction.
5. **Models are definitions, not live objects:** `defineModel({endpoint, forms,
   permissions, actions})` + hooks. TanStack Query owns cache/reactivity —
   never two ownership systems over the same data.
6. **Trusted-HTML slots become `ReactNode` props** — the "caller must escape"
   contract class (incl. web-mojo's TableRow XSS) ends here.
7. **Both themes from day one.** Tokens only; verify light AND dark in the
   browser before calling anything done.

## Already built and browser-verified (`apps/portal`)

- Mini client: envelope unwrap, `start`/`size`, `'-field'` sort, Django lookups,
  reject-on-failure saves; **mock django-mojo adapter speaking the exact wire
  contract** (`VITE_MOJO_API` unset → mock; set → real backend).
- URL-synced params store incl. `field__in` collapse + `dr_field/dr_start/dr_end`
  daterange triple; presets with derived active state.
- **ModelTable**: schema columns, 3-way sort, search, preset segment, numbered
  pagination window with `…` + page-size select, skeleton/empty/error states.
- **Filter system**: Add-Filter menu (per-type icons, active checks), per-type
  dialogs (text/select/multiselect/number/boolean/date/daterange), click-to-edit
  pills, clear-all, count badge. Deep-linkable.
- **SeriesChart** (line/bar/area, stacked bars by default, legend toggle, nice
  ticks, crosshair index tooltip) + **MetricsChart** wrapper (MIN HR DAY WK MO
  granularity toggle with per-range gating, 1H/24H/7D/30D, type switch,
  refresh, overlays) against a mock `/api/metrics/fetch`.
- **DetailView + SideNav** (headerConfig/sections schema — the UserView look),
  **ModalManager** (awaitable, native `<dialog>`, stacking for free),
  **SchemaForm** field language, toasts, theme provider (light/dark/system),
  mission-control tokens both themes.

## Phase 1 — the core (three chunks, in order)

Port from source, not memory: each item lists its web-mojo source. Read it first.

### Chunk A — context spine
| # | Item | web-mojo source | Notes |
|---|---|---|---|
| A0 ✓ | Extract `packages/portal-mojo` from `apps/portal/src/lib` + `components`; npm workspaces | — | Done 2026-08-04: TS-source subpath exports; mock ships with the client; `AdminSection` contract stub; Tailwind `@source` scan |
| A1 ✓ | Auth client: password / magic / passkey flows, forgot/reset, single-flight refresh, DUID header, logout | `src/core/services/TokenManager.js` (629), `src/core/Rest.js:16-48,379-446`, `src/extensions/mojo-auth/mojo-auth.js:53-64` | Done 2026-08-04 (`client/auth.ts` + mock auth endpoints; endpoints verified against django-mojo `account/rest/user.py`). Synthetic-401 short-circuit + refresh-path recursion guard browser-verified (3 concurrent → 1 POST). Fixed vs web-mojo: cross-storage token shadowing; refresh promoting session→local. Passkeys: full ceremony ported, mock is shape-level — needs a real-authenticator pass when C3 login pages land. MFA completion + OAuth redirect flows deferred (C3). Logout is client-side only (no server endpoint exists). |
| A2 ✓ | `Me` + permissions: `useMe()`, `can()`, `<Guarded>` | `src/core/models/User.js:13-61` (hasPermission: `admin` wildcard, `is_superuser` literal, `sys.*`, `CATEGORY_GRANULAR_MAP` rollup), `Member.js:15-28` | Done 2026-08-04: `client/me.ts` (`hasPermission`/`memberHasPermission` pure fns + `useMe`/`useAuthSnapshot`/`useCan`; `registerPermissionCategories` registry replaces web-mojo's mutate+rebuild) + `ui/Guarded.tsx` (fail-closed) + mock role→permissions `/api/user/me`. Semantics matrix browser-verified incl. loose `1` grants, one-way rollup, `sys.` pinning, member `admin` never granting sys.*. Shell demo: live TopNav identity chip; sidebar System section gated by `view_admin`. Member context joins via A3 GroupProvider. Client errs permissive; server authoritative. |
| A3 ✓ | Group context: `GroupProvider`, active group storage + `?group=` param, searchable switcher, `requiresGroup` guard | `src/core/PortalApp.js:230-348`, `GroupSearchView.js` | Done 2026-08-04: `client/group.tsx` (URL param beats stored id; param rides the REAL search string so it survives hash navigation; `active_group_id` key; member fetch per group; bad-group fallback chain WITH console.warn) + `ui/GroupSwitcher.tsx` (300ms server search, GroupSearchView tree port incl. embedded-parent rows + │├└ segments + kind chips) + `ui/RequiresGroup.tsx` (first consumer: C4 screens). `useCan` now folds in the active member (verified: member `admin` in odd mock groups lights the System section for a plain user; even groups don't). Also shipped `mojoQueryDefaults()` — 4xx MojoErrors never retry; `networkMode` 'always' under the mock ('online' real) — a paused-retry wedge found the hard way. Browser-verified both themes. |
| A4 ✓ | Sidebar engine: menu registry keyed by context — global vs group vs `group.kind`; route auto-switch; active-state walk | `src/core/views/navigation/Sidebar.js` (registry + `autoSwitchToMenuForRoute` + `menuContainsRoute`) | Done 2026-08-04: `ui/menu-registry.ts` (subscribable registry; pure resolution — route containment in registration order with group menus eligible only under a KIND-MATCHED group [deliberate tightening: web-mojo only checked group presence], then defaultMenu → first non-group visible → first non-group; per-item permissions ∧ requiresGroupKind; groupKind arrays + 'any') + `ui/SidebarNav.tsx` (side-label dividers with orphan-divider drop, child rows, parent-lights-with-child active walk, badges). Deviation from source, documented in-file: active menu is DERIVED from (route, group, me) — no mutable menu state; group menus are entered by navigation (`GroupSwitcher onSelected/onCleared` → app routes). `admin/adminSectionsMenu()` bridges AdminSection[] → a registry menu with mount-relative routes (dual-mount constraint honored). App: menus.ts registry, engine-driven Sidebar, GroupOverviewPage (`RequiresGroup`'s first consumer). Browser-verified: route/group menu switching, member-admin permission ripple, fallback chain, both themes. |

### Chunk B — data + the crown jewels
| # | Item | web-mojo source | Notes |
|---|---|---|---|
| B1 ✓ | `defineModel` definition layer + `fetchOne` + POST actions (`POST_SAVE_ACTION` pattern) | `src/core/Model.js`, `Collection.js`, `models/*.js` | Done 2026-08-04: `client/model.ts` — `defineModel({name, endpoint, permissions, forms, actions})` → stateless def + hooks; `useList`/`useOne` reuse the generic hooks' cache keys so ModelTable shares one cache; `useSave` write-through (server row → one-cache) + invalidate; `useDelete` (`{status:"deleted"}` string-status parity; first UI consumer C4); `useAction`; `fetchOne(qc,id)` via fetchQuery (prefetch+hook dedupe browser-proven: 1 GET); `invalidate`. Action wire verified in django-mojo `mojo/models/rest.py` `on_rest_save`: `POST <endpoint>/<id>` `{key: payload}`, fields save before handlers; row-vs-payload response is DECLARED per action (`response:'row'|'payload'` — `revoke_sessions` payload message toasts verbatim), never sniffed. Mock: user save pipeline + disable (reason REQUIRED ∈ abuse\|admin per `services/disable.py` — web-mojo's optional-reason UI was stale)/reactivate/send_invite/revoke_sessions + DELETE. App: `models.ts` UserModel (forms.create/disable); ModelTable `model` prop; UserDetail action flows (`when`-gated invite). Fixed in passing (rule-4 class): SchemaForm controlled select showed first option while state held `''` — placeholder option + unknown-value console.warn (`SchemaSelect`); `Field`/`FormData` types moved to client/types (ui re-exports) so defs carry forms. Browser-verified both themes, console clean. |
| B2 ✓ | TableView to full fidelity: column chooser (`hideable`), persistState (v2 blob, URL > saved > defaults, saved `size` wins), selection + batch bar (`Promise.allSettled` + partial-result toasts), autoRefresh collection mode (`refetchInterval` + skip predicate), row expand (single-open default), groupBy header interleaving, export | `src/core/views/list/ListView.js`, `table/TableView.js`, `pages/TablePage.js`, `grouping.js` | Done 2026-08-04, all four sources read in full (6.8k lines). ModelTable grows the opt-in set — absent props render byte-identically. Chooser: `hideable:false` locks (lock icon, restore-proof), reset clears the whole saved view. persistState: `{v:2, sort?, size, search?, filters?, hidden?}` at `mojo:tableview:<persistKey ?? #route::endpoint>`; restore gates the FIRST fetch (`enabled`), URL>saved per key, saved `size` wins, corrupt/versioned-out blobs cleared; sort-off (`''`) deliberately not persisted. Selection decoupled from batchActions (do-not-recreate item); select-all w/ indeterminate; selection clears on wire-signature change. Batch = TablePage.batchAction port: confirm → optional once-per-batch `prepare` (null cancels; batch disable collects ONE reason) → per-row `run` via allSettled → success/partial/all-failed toasts (copy verbatim) → clear + invalidate. autoRefresh: setInterval (5s floor) + skip predicate (hidden ∥ blurred ∥ open `<dialog>` ∥ selection — verified BOTH ways: ticks 10→12 focused, flat while hidden/selected) + focus-resume tick + indicator pulse. rowExpand: chevron col, single-open default, page-change collapse, colSpan detail row. groupBy: interleaved `<th colSpan>` headers, falsy=ungrouped tail, 4 styles (warn+banner fallback), STICKY labels (fix over source: centered banner labels vanish off horizontally-scrolled tables); `ui/grouping.ts` ports groupByDay/Field/Recency/Boolean (epoch-aware). Export: real `download_format`+`filename` contract (rest.py on_rest_list_response); mock ships it (and grew rest.py's reserved-keys — export params must not become lookups, found when a filtered CSV came back empty). UsersPage runs everything (recency groups over `-last_activity`, batch disable/reactivate = real POST_SAVE_ACTIONS). Verified mock AND live (970-row mverify: groups/batch on victim/persist). Not in scope, per plan: stat strip (WM-037), footer totals, fullscreen, models-mode refresh, cell edit (B3), context menu (C1). |
| B3 | FormView with **inline autosave** ("no save buttons"): 300ms batch window → one save → per-field saved/error indicators → revert-on-fail; `showWhen`; permission tabsets as a registry (not live-mutated arrays); zod validation (Validation.md documents a phantom API — build, don't port) | `src/core/forms/FormView.js:904-1050` (autosave), `FormBuilder.js:863-888` (showWhen), `models/Member.js:80-170` + `User.js:160-347` (tabsets) | Fix buttongroup/checklistdropdown class by construction. **Board #1256 — DONE 2026-08-05** |
| B4 | Field component library — surveyed in full 2026-08-05 and split into board-backed epics/tasks; see **B4 breakdown** below | `src/core/forms/inputs/*` (5,557 lines) + `calendar/` engine (1,790), manifest §07 | Epics #1266 + #1275; tasks #1270 #1276 #1277 #1278 — **ALL DONE 2026-08-05**; simple-types parity audit lives in docs/forms.md |

#### B4 breakdown (survey 2026-08-05 — every source file read in full)

All work is board-backed; workspecs on the items carry per-component feature
inventories. The split, and why each passes the value bar:

| Board | Scope | Passes on | web-mojo sources |
|---|---|---|---|
| **#1266 epic** — date/time pickers | children: #1267 dateFns+Calendar core → #1271 **popover primitive (shared by every dropdown control)** → #1272 DatePicker → #1268 DateRangePicker+presets+**FilterBar upgrade** → #1269 TimePicker → #1274 TimezoneSelect → #1273 DateTimePicker | (a) beats-React: one dependency-free engine, day/month/year precisions with drill-down zoom, cross-page range anchor, hover preview, presets rail | `calendar/Calendar.js` (623), `CalendarPopover.js` (143), `PresetSidebar.js` (152), `calendar.css` (872), `utils/dateFns.js`, `DatePicker.js` (310), `DateRangePicker.js` (402), `TimePicker.js` (648), `DateTimePicker.js` (523), `TimezoneSelect.js` (196) |
| **#1275 epic** — server-data selects | children: #1279 CollectionSelect, #1280 CollectionMultiSelect | (b) django-mojo binding: any `defineModel` becomes a searchable select — 400ms server search, `defaultParams` dict\|callback, `requiresActiveGroup`, id→label hydration via `fetchOne`; TanStack shared cache, never Collection instances | `CollectionSelect.js` (669), `CollectionMultiSelect.js` (588) |
| #1270 | Unified ComboBox (descriptions/meta/highlight/ARIA, allowCustom) | house autocomplete under the no-library rule; base for #1274 + future rule builders | `ComboInput.js` (761 — the spec), `ComboBox.js` (344 — registration + bug list) |
| #1276 (should) | TagInput chips | (b) CSV wire shape is load-bearing — models split it | `TagInput.js` (604) |
| #1277 (should) | MultiSelectDropdown (static options) | consistency; must reconcile to ONE implementation with FilterBar's multiselect dialog | `MultiSelectDropdown.js` (413) |
| #1278 | Field-type registry + simple-types parity sweep | glue: all aliases incl. `monthpicker`/`yearrange` precision mapping; unknown type → warn + text fallback; value shapes + the epoch-seconds save boundary documented once | `inputs/index.js` (INPUT_TYPES/createInput), FormBuilder field cases, manifest §07 |

Survey finds that shape the port (details in the workspecs):

- **ComboInput is orphaned in web-mojo**: the pipeline registers `combo`/
  `combobox`/`autocomplete` → the feature-poor `ComboBox`; the rich
  `ComboInput` is never instantiated, so real fields' `showDescription`/
  `description`/`meta` configs are silently ignored. ComboInput = the port's
  spec; ComboBox contributes registration names + open-on-focus only.
- **Commit-only change events, by construction**: ComboBox emits `change` per
  keystroke → FormView's 300ms autosave saved partial text; TimezoneSelect
  inherited it, leaking typed fragments ("Amer") into picker values. Every
  ported control fires `change` on commit.
- Known web-mojo bugs NOT to carry: broken `allowCustom:false` revert,
  string-vs-number option matching (strict-equals on DOM attributes),
  document-click listener leak, checkbox Space-toggle desync, loose `==` id
  comparisons in multiselects.
- The **popover primitive** (#1271) must prove itself against native
  `<dialog>` top-layer stacking (pickers open inside modals).

#### Component sweep verdicts (2026-08-05, all of `src/core` + `src/extensions` rated)

Everything not already ported/planned was rated against the value bar.
**PORT** (board-filed): chat/comments feed + adapters #1301 · detail
primitives pack (StatusPanel/FlowStrip/Timeline/KnownFieldsCard/
AdminMetadataSection/StackTraceView) #1302 · DataView + JSON viewer #1303 ·
fmt completion (typed functions from `DataFormatter.js` — never the
pipe-string engine) #1304 · FormWizard/Tabs (`SectionedFormView.js`) #1305 ·
LocationClient + AddressField #1306 · MarkdownView (`/api/docit/render`)
#1307 · Modal drawer #1308 · PieChart+exportPng (→ C2 #1258) ·
MetricsCountryMapView + centroids (→ #1291) · FileView (→ #1298) ·
ProgressView/`useFileDrop` (→ #1264) · password strength/generator (→ C3
#1259). **SKIP** (fails the bar — recorded per the value-bar agreement):
Leaflet/MapLibre wrappers, TabView engine (its variant CSS vocabulary
survives as pattern), SimpleSearchView, TopNav/PageHeader/SegmentControl,
BusyIndicator (global-overlay anti-pattern), CodeViewer, timeline
extension, EventBus/EventDelegate/EventEmitter, mustache/TemplateResolver,
MOJOUtils bulk, ConsoleSilencer, mojo-auth shim. **PATTERN** (rebuild
small, don't port): HtmlPreview iframe, FormPlugins (→ #1278 registry),
Error/Denied/NotFound pages (copy the recovery-action UX), loader splash
(use file as-is), dashboard panel-grid CSS.

### Chunk C — finish the shell
| # | Item | web-mojo source | Notes |
|---|---|---|---|
| C1 | DetailView: permission-gated sections (fail-closed, orphan-divider drop, active self-heal), rail badges + `setBadge`, kebab `contextMenu` with `permissions`/`when` | `src/core/views/navigation/SideNavView.js:115-160,328-438`, `views/feedback/ContextMenu.js:102-116` | Lazy mount / unmount-not-destroy. **Board #1257 — DONE 2026-08-05** |
| C2 | Charts: stats summary + data-table modal, custom date-range dialog, searchable-server-data mini widget, KPI tiles / CircularProgress as needed | `src/extensions/charts/MetricsChart.js`, `MetricsMiniChartWidget.js` | **Board #1258** (custom-range dialog depends on #1268). Sweep additions to scope: **PieChart** (`charts/PieChart.js`, 546 — the only chart primitive the plan had missed) + `exportChartPng` (`charts/exportChart.js`) |
| C3 | Auth pages on A1 flows; login/forgot/reset/magic/passkey | `src/extensions/auth/` (UI reference only — half-built there) | PARTIAL 2026-08-05: the django-mojo HOSTED auth pages ("bouncer" pages at `<origin>/auth`) are bridged — TopNav Sign in → `/auth?redirect=<hash-free url>` (hash-free because the page string-appends `?auth_code=`; the in-app route rides sessionStorage and is restored post-exchange); `handleAuthCodeFromURL` on boot handles BOTH landing shapes (real search + hash-embedded) and scrubs the code; `onAuth login/logout → invalidateQueries` makes sign-in light the tables without a manual Retry. Sign out button on the identity chip. Also fixed while Ian poked: duplicate refresh/indicator icon (merged — the refresh button spins on any fetch) and multi-fetch-per-page (autoRefresh's focus-resume tick stacked on TanStack focus refetch; both gone — `refetchOnWindowFocus: false` in mojoQueryDefaults, interval+skip only). Note: cross-origin dev shows an OPTIONS preflight per GET in devtools — not a duplicate fetch. In-app login/forgot/reset/magic/passkey PAGES (for deployments serving the portal same-origin) remain C3's build. **Board #1259** |
| C4 | First real screens vs a live backend: Users, Groups, ApiKeys, Logs + workspaces-portal idioms into ui: `armedButton`, `undoToast`, progress toast | UserView/GroupView (schemas), `maestro/api/aws/www/workspaces/js/dom.js:84-260` | **Board #1281**; seeds the admin program #1260 |

**Phase 1 done =** `VITE_MOJO_API=<real django-mojo>` → log in, switch groups,
sidebar adapts (incl. by `group.kind`), full-UX Users/Groups tables, inline-
autosave editing, permission-gated UI, live metrics dashboard.

## Phase 2+ (board-backed; parked = by demand)

- **Admin program — ELEVATED 2026-08-05** (board epic **#1260**, accepted, no
  longer parked): ALL admin domains port, per-domain verdict = direct port vs
  redesign, oriented around operator use cases (incident triage, tickets,
  the metrics the backend actually records, users/permissions, keys, files,
  email, DNS — "administer django-mojo + AWS" for real). The two analyses
  landed 2026-08-05 and filed the epic's 19 children (#1282–#1300, incl. the
  new Metrics Explorer); three backend gaps filed to NativeMojo Inbox as
  django-mojo items (#1309–#1311). Stabilized pages still migrate into
  `portal-mojo/admin`.
- user-profile sections as the DetailView/forms proving ground. Board #1261
  (parked).
- Lightbox: extract canvas math (crop/transform/filters) to framework-free TS
  first — the one place a naive rewrite loses institutional knowledge. Board
  #1262 (parked).
- Distribution: `create-portal-mojo` scaffolder (thin shell: config + page
  registry + npm dep). **django-mojo dependency:** a capabilities endpoint
  (generalize dnsman `capabilities()`) so one admin build lights up only the
  domains a deployment runs; boot-time version handshake, degrade gracefully.
  Board #1263 (parked; the endpoint files to NativeMojo Inbox as a django-mojo
  item at activation).
- Reusable WebSocket transport (`wss://…/ws/realtime/`, challenged bearer
  handshake, heartbeat, refcounted topics) + Assistant streaming consumer.
  Board #1264. Upload transport/UX completed independently in #1468/#1470.
- Publish plan: npm `portal-mojo` with subpath exports; web-mojo stays published
  for legacy consumers. Board #1265 (parked).

## Do-not-recreate list (from the web-mojo extraction)

- `Model.save()` resolve-on-failure; `resp.data.data` heuristics (58 sites) —
  one typed boundary instead.
- `isSelectable()` requiring batchActions before checkboxes render — decouple.
- Inert options that select "render nothing" (`format` as function, `template`
  as function, `column.permissions`, `--grep`) — unknown values fall back to a
  default WITH a console.warn, never to nothing.
- Live-mutated permission arrays (`arr.length=0; arr.push(…)`) — registry + store.
- Silent failure as policy (render errors → console.warn; unknown formatter →
  pass-through) — error boundaries, typed formatters, dev-mode throws.
- Split change pipelines (buttongroup wrote `this.data` but no input → value
  absent from every submit) — controlled inputs only.

### #1305 — Tabs and FormWizard foundation (2026-08-06)

- Added an accessible controlled/uncontrolled `Tabs` primitive with eight token-only variants, aliases, keyboard navigation, deterministic selection healing, and persistent ARIA panel shells.
- Extracted SchemaForm's controlled submit state/rendering into an internal shared core and built `FormWizard` over one cross-section store, including hidden-field payload rules, richer validation, roster/reset reconciliation, async single-flight finish, and the guarded `formWizardModal` helper.
- Composed FormView permission tab presentation onto Tabs while retaining one autosave reducer over `allTabs`; legacy `.fv-*` styling remains for other callers.
- Added both-theme CSS, the showcase variants/wizard/modal proof, AI reference docs, and `verify:form-wizard`. Consolidated typecheck/build/browser evidence is owned by the wave orchestrator and is intentionally not claimed here.

### #1306 — LocationClient + AddressField (2026-08-06)

- Added a plain six-endpoint LocationClient over the existing envelope boundary, preserving django-mojo's mixed response shapes. Autocomplete tokens are backend-created, JavaScript-private, reused only for suggestions/details, and protected by latest-generation guards across reset, disposal, and upstream replacement.
- Added the controlled, commit-only AddressField and `address` registry binding. Selection fetches details privately, then applies one allowlisted declared-field patch through SchemaForm or FormView; FormView validates/queues/saves/reverts the patch as one transaction.
- Moved ComboBox outside/Escape dismissal to the shared top-layer Popover, added exact public location mocks with derived-only history observability, both-theme styles, showcase proof, AI reference docs, and `verify:location-address` alongside the retained `verify:form-wizard` rider.

### #1300 — Admin Metrics Explorer (2026-08-06)

- Added one global, no-group `/metrics/explorer` workspace under Observability with its exact `sys.view_metrics | sys.metrics` route clause, separate from the existing manage-only permission editor audience.
- Consumes django-mojo #1438's exact `/api/metrics/discover` envelope through `mojoCall`; account/category/slug catalogs stay backend-authoritative and caller-scoped. Group/User directory conveniences mount only with their independent global view clauses.
- Preserves full colon-slug identity across the backend's intentionally lossy `/fetch` and `/value/get` responses by splitting duplicate tails, validating exact echoes, and reassembling request order. `/series?with_delta=true`, group fan-out, explicit scalar reads, and `dt_*` history are covered without adding any write or arbitrary model-aggregation surface.
- Added the injectable `MetricsChart.loadSeries` + cache namespace seam, shared CSV formula neutralization, live-lossy central mock fixtures, both-theme token styles, showcase, AI reference docs, and `verify:admin-metrics-explorer`. Consolidated validation remains owned by the wave orchestrator and is intentionally not claimed here.

### #1295 — Phone Hub admin (2026-08-06)

- Added one global/no-group Phone Hub with permission-filtered Phone Numbers, SMS, and Provider Config tabs and KISS detail modals.
- Lookup normalizes publicly to E.164, then uses authenticated global Twilio lookup with confirmation for paid fresh-row refreshes and timestamp/count advancement evidence. Phone and SMS rows are positively sanitized before Query; exports are bounded client projections.
- Provider credentials use an imperative cache-free tri-state flow (untouched, non-empty replacement, confirmed null clear). Group choices have an independent global permission and 100-row bound. The UI states the current Mojo-only per-group send branch, stored/testable Twilio/AWS limitation, test-mode limitation, fallback order, and cascade behavior; it adds neither SMS sending nor API-key provisioning.
- Added exact mock contracts and personas, both-theme styles, showcase proof, AI reference docs, and `verify:admin-phonehub`.

### #1296 — Push Notifications admin (2026-08-06)

- Added one global/no-group Push page whose caller stats, global metrics, devices, deliveries, templates, and config tabs are independently gated; only the active authorized tab mounts. `push_surface` is a registered host param and tab switches clear incompatible flat table params.
- Promoted PushDevice to the canonical messaging/push package with the identity file retaining a compatibility re-export of the same model. Exact clauses omit the phantom `sys.users` grant.
- Added positive pre-Query projectors that exclude device tokens, platform responses, arbitrary delivery payloads, and expanded user PII. All four models expose no delete action, matching live `CAN_DELETE=false`, and the mock fabricates no delete cascade.
- FCM service accounts use an imperative cache-free tri-state flow: untouched, validated object replacement, or confirmed null clear. Config testing uses only the custom connection endpoint with its server-side dummy token; no send, caller test, retry, device-token, or record-route surface was added.
- Added exact mock personas/contracts, both-theme styles, showcase proof, AI reference docs, and `verify:admin-push`.

## Working agreements

- **Port from source.** Before building any listed item, read its web-mojo file
  (paths above). The first baseline pass under-built charts/filters/pagination
  by working from summaries — that class of miss is the thing to prevent.
- **Every component ships three-legged** (added 2026-08-05, per Ian): the
  component, a demo section in the playground (`apps/showcase` — split out of
  `apps/portal` 2026-08-05, see Repo shape), and a reference page in
  `packages/portal-mojo/docs/` written for AI context (import path, API, wire
  contract, invariants, pitfalls).
- **Verify in the browser** — light AND dark, interactions clicked, console
  clean, `npm run typecheck` green — before calling an item done.
- **Model split:** Fable drives contract-dense foundation work (Chunks A/B) and
  review; Opus 5 (with /fast) for volume fan-out (Chunk C, pages, field
  components, CSS porting).
- **Git:** work on `main`, commit finished work by explicit pathspec, never
  push without being asked, co-author trailer names the model that built it.
- **Component value bar** (added 2026-08-05, per Ian): a component earns its
  port only if it (a) offers something the React ecosystem doesn't, or
  (b) binds django-mojo strongly and usefully — and either way (c) is easy for
  AI to reuse (the three-legged rule is the mechanism). Components that fail
  the bar are skipped or replaced with a documented pattern, and the skip is
  recorded.
- **Maestro integration** (live 2026-08-05): workspace **17** (NativeMojo) ·
  board **47** "portal-mojo" · project **45**; `.claude/maestro.json` checked
  in; dev skill pack synced at `.claude/skills/` (maestro-task/-scope/-build/
  -vibe/-auto + sites-verify — slash commands from the next session). Remaining
  work is **board-backed** (one work record: PLAN keeps architecture + history;
  the board carries the queue). New work files via `/maestro-task`; builds
  claim items (stage → building, WIP 1) via `/maestro-build`.
