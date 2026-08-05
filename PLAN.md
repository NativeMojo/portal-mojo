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
are **epoch seconds**; list rows have **no `role`/`created`/passkey fields**
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
scheduled-task run-now REST, SES send-quota, realtime presence REST). Next
build item: **B3 = board #1256**.

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
```

Rules: the app imports the package, never the reverse. Every component is proven
in `apps/portal` before it counts as done. When pages stabilize they migrate INTO
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
   portal anyway — one deployment, shared group context; the frontend mirror of
   the one-CRUD-API/permissions-gate backend philosophy. (web-mojo's proven
   model across all three existing portals.)

Design constraints this puts on Chunk A (build them in from the start):
- Admin section routes are **mount-point relative** (root in standalone,
  `#/system/…` when embedded).
- Sections **contribute** sidebar groups; they never own the sidebar. The A4
  sidebar engine's registry serves global / group / `group.kind` menus AND
  contributed admin sections through the same mechanism.
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
| B3 | FormView with **inline autosave** ("no save buttons"): 300ms batch window → one save → per-field saved/error indicators → revert-on-fail; `showWhen`; permission tabsets as a registry (not live-mutated arrays); zod validation (Validation.md documents a phantom API — build, don't port) | `src/core/forms/FormView.js:904-1050` (autosave), `FormBuilder.js:863-888` (showWhen), `models/Member.js:80-170` + `User.js:160-347` (tabsets) | Fix buttongroup/checklistdropdown class by construction. **Board #1256** |
| B4 | Field component library — surveyed in full 2026-08-05 and split into board-backed epics/tasks; see **B4 breakdown** below | `src/core/forms/inputs/*` (5,557 lines) + `calendar/` engine (1,790), manifest §07 | Epics #1266 + #1275; tasks #1270 #1276 #1277 #1278 |

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
| C1 | DetailView: permission-gated sections (fail-closed, orphan-divider drop, active self-heal), rail badges + `setBadge`, kebab `contextMenu` with `permissions`/`when` | `src/core/views/navigation/SideNavView.js:115-160,328-438`, `ContextMenu.js:102-116` | Lazy mount / unmount-not-destroy. **Board #1257** |
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
- WebSocket client (`wss://…/ws/realtime/`, bearer handshake, ping) + 3-stage
  uploads (`fileman/upload/initiate` → multipart/S3 (file field last) → mark_as_completed).
  Board #1264 (parked).
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

## Working agreements

- **Port from source.** Before building any listed item, read its web-mojo file
  (paths above). The first baseline pass under-built charts/filters/pagination
  by working from summaries — that class of miss is the thing to prevent.
- **Every component ships three-legged** (added 2026-08-05, per Ian): the
  component, a demo section in the playground (`apps/portal` → Develop →
  Components), and a reference page in `packages/portal-mojo/docs/` written
  for AI context (import path, API, wire contract, invariants, pitfalls).
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
