# portal-mojo — Build Plan

**What:** the React-era portal toolkit for django-mojo, plus the base admin portal
shipped with every django-mojo deployment. Succeeds `web-mojo`, which goes to
maintenance mode and keeps serving its three existing portals untouched.

**Status:** scaffolded 2026-08-04. `apps/portal` contains the verified baseline
(see "Already built"). Next up: **Chunk A**.

**Deep reference:** the full port manifest (tiers, contracts, trap list) is the
artifact at https://claude.ai/code/artifact/99958e23-ce3d-4607-8848-14d6c26d7081.
The web-mojo source of record is `/Users/ians/Projects/mojo/nativemojo/web-mojo`
(read-only reference — it stays parked on `main`; never edit it from here).

---

## Repo shape: one repo, two artifacts, hard boundary

```
portal-mojo/
  packages/portal-mojo   ← the toolkit (npm: `portal-mojo`, subpath exports like web-mojo:
                            portal-mojo/client, /ui, /charts, /admin …)  [created in Chunk A]
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
   read it; nothing else owns table state. (`apps/portal/src/lib/params.ts`)
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
| A0 | Extract `packages/portal-mojo` from `apps/portal/src/lib` + `components`; npm workspaces | — | Package skeleton with subpath exports |
| A1 | Auth client: password / magic / passkey flows, forgot/reset, single-flight refresh, DUID header, logout | `src/core/services/TokenManager.js` (629), `src/core/Rest.js:16-48,379-446`, `src/extensions/mojo-auth/mojo-auth.js:53-64` | Synthetic-401 short-circuit; refresh-path recursion guard |
| A2 | `Me` + permissions: `useMe()`, `can()`, `<Guarded>` | `src/core/models/User.js:13-61` (hasPermission: `admin` wildcard, `is_superuser` literal, `sys.*`, `CATEGORY_GRANULAR_MAP` rollup), `Member.js:15-28` | Client errs permissive; server authoritative |
| A3 | Group context: `GroupProvider`, active group storage + `?group=` param, searchable switcher, `requiresGroup` guard | `src/core/PortalApp.js:230-348`, `GroupSearchView.js` | Heavily group-driven is the product's spine |
| A4 | Sidebar engine: menu registry keyed by context — global vs group vs `group.kind`; route auto-switch; active-state walk | `src/core/views/navigation/Sidebar.js` (registry + `autoSwitchToMenuForRoute` + `menuContainsRoute`) | Declarative menus-as-data |

### Chunk B — data + the crown jewels
| # | Item | web-mojo source | Notes |
|---|---|---|---|
| B1 | `defineModel` definition layer + `fetchOne` + POST actions (`POST_SAVE_ACTION` pattern) | `src/core/Model.js`, `Collection.js`, `models/*.js` | Definitions + hooks, no stateful instances |
| B2 | TableView to full fidelity: column chooser (`hideable`), persistState (v2 blob, URL > saved > defaults, saved `size` wins), selection + batch bar (`Promise.allSettled` + partial-result toasts), autoRefresh collection mode (`refetchInterval` + skip predicate), row expand (single-open default), groupBy header interleaving, export | `src/core/views/list/ListView.js`, `table/TableView.js`, `pages/TablePage.js`, `grouping.js` | Ian: "solid solid piece of UI/UX" — port at fidelity incl. skeleton loader |
| B3 | FormView with **inline autosave** ("no save buttons"): 300ms batch window → one save → per-field saved/error indicators → revert-on-fail; `showWhen`; permission tabsets as a registry (not live-mutated arrays); zod validation (Validation.md documents a phantom API — build, don't port) | `src/core/forms/FormView.js:904-1050` (autosave), `FormBuilder.js:863-888` (showWhen), `models/Member.js:80-170` + `User.js:160-347` (tabsets) | Fix buttongroup/checklistdropdown class by construction |
| B4 | Remaining field components in FieldTypes order (~45 types; collection/tag/pickers per the `data-field-config` contracts) | `src/core/forms/inputs/*`, manifest §07 | |

### Chunk C — finish the shell
| # | Item | web-mojo source | Notes |
|---|---|---|---|
| C1 | DetailView: permission-gated sections (fail-closed, orphan-divider drop, active self-heal), rail badges + `setBadge`, kebab `contextMenu` with `permissions`/`when` | `src/core/views/navigation/SideNavView.js:115-160,328-438`, `ContextMenu.js:102-116` | Lazy mount / unmount-not-destroy |
| C2 | Charts: stats summary + data-table modal, custom date-range dialog, searchable-server-data mini widget, KPI tiles / CircularProgress as needed | `src/extensions/charts/MetricsChart.js`, `MetricsMiniChartWidget.js` | |
| C3 | Auth pages on A1 flows; login/forgot/reset/magic/passkey | `src/extensions/auth/` (UI reference only — half-built there) | |
| C4 | First real screens vs a live backend: Users, Groups, ApiKeys, Logs + workspaces-portal idioms into ui: `armedButton`, `undoToast`, progress toast | UserView/GroupView (schemas), `maestro/api/aws/www/workspaces/js/dom.js:84-260` | |

**Phase 1 done =** `VITE_MOJO_API=<real django-mojo>` → log in, switch groups,
sidebar adapts (incl. by `group.kind`), full-UX Users/Groups tables, inline-
autosave editing, permission-gated UI, live metrics dashboard.

## Phase 2+ (by demand, not upfront)

- Admin domain parity: harvest IA/columns/forms from web-mojo's 44 admin
  TablePages; port pages as deployments need them; stabilized pages move into
  `portal-mojo/admin`.
- user-profile sections as the DetailView/forms proving ground.
- Lightbox: extract canvas math (crop/transform/filters) to framework-free TS
  first — the one place a naive rewrite loses institutional knowledge.
- Distribution: `create-portal-mojo` scaffolder (thin shell: config + page
  registry + npm dep). **django-mojo dependency:** a capabilities endpoint
  (generalize dnsman `capabilities()`) so one admin build lights up only the
  domains a deployment runs; boot-time version handshake, degrade gracefully.
- WebSocket client (`wss://…/ws/realtime/`, bearer handshake, ping) + 3-stage
  uploads (`fileman/upload/initiate` → multipart/S3 (file field last) → mark_as_completed).
- Publish plan: npm `portal-mojo` with subpath exports; web-mojo stays published
  for legacy consumers.

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
- **Verify in the browser** — light AND dark, interactions clicked, console
  clean, `npm run typecheck` green — before calling an item done.
- **Model split:** Fable drives contract-dense foundation work (Chunks A/B) and
  review; Opus 5 (with /fast) for volume fan-out (Chunk C, pages, field
  components, CSS porting).
- **Git:** work on `main`, commit finished work by explicit pathspec, never
  push without being asked, co-author trailer names the model that built it.
- Maestro board integration for portal-mojo: TBD (needs its own project id on
  workspace 17; ask Ian before registering).
