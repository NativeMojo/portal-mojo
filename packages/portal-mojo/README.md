# portal-mojo (the package)

The React portal toolkit for django-mojo. Ships as **TypeScript source** via
subpath exports — consumers compile it with their own Vite + TS
(`moduleResolution: "bundler"`); there is no package build step here.

```bash
npm install portal-mojo react react-dom react-router-dom @tanstack/react-query
```

**Per-component reference docs (written for AI context): [`docs/`](docs/README.md).**
Live demos for everything: run `npm run dev:showcase` → **Develop → Components**.

## Subpath surfaces

The `client/runtime`, `ui/shell`, `admin/registry`, and Assistant launcher
subpaths are stable, narrow package boundaries for first-party portal shells
and advanced hosts. They intentionally expose only the runtime pieces needed
at application startup; use the broader compatibility surfaces when those
additional exports are required.

| Subpath | Surface |
|---|---|
| `portal-mojo/client` | Typed django-mojo protocol layer: envelope unwrap at exactly one boundary (a failed save **rejects**), `start`/`size` paging, `'-field'` sort, Django lookups, the URL-synced `useTableParams` store (single source of truth for table state), TanStack Query hooks. Auth client: password / magic-link / passkey login, forgot/reset, cross-origin handoff (`?auth_code=` scrub-before-network), single-flight refresh + pre-request gate (synthetic-401 reject, `/api/token/refresh` recursion guard), `X-Mojo-UID` device header, `getAuthSnapshot`/`subscribeAuth` for React. Auth-challenged realtime transport: `RealtimeProvider`/`RealtimeClient`, refcounted topics, typed event projection, and a deterministic mock. Boot auth with `initAuth()`. The in-memory HTTP mock transport lives here too — it is the wire contract's executable spec and evolves in lockstep with the client (any seeded active user logs in with email + `"mojo"`). |
| `portal-mojo/client/runtime` | Stable, narrow client boundary for first-party application runtime code. It omits eager mock-test controls; the mock transport itself loads on the first mock request. |
| `portal-mojo/ui` | Mission-control UI: `ModelTable`, `FilterBar`/`FilterPills`, `SchemaForm`/`formModal`, `DetailView`, `RecordFeed`, `AttachmentQueue`/`UploadQueue`, `ImageEditor`/`imageEditorModal`, awaitable native-`<dialog>` `modal`, `toast`, `ThemeProvider`, `Guarded` (permission slot), `GroupSwitcher` (searchable tree selector), `RequiresGroup`, the sidebar engine (`registerMenus`/`setDefaultMenu` registry + `SidebarNav` — static or searchable accordion with a compact icon rail; global and group scopes are explicit), `Badge`/`MetricCard`/`Spark`, `fmt` formatter namespace. |
| `portal-mojo/ui/shell` | Stable, narrow boundary for application-shell primitives: theme, guards, menus/sidebar, right panel, modal/toast hosts, password helpers, and formatters. |
| `portal-mojo/charts` | Dependency-free SVG charts: `SeriesChart` (line/bar/area, stacked bars, legend toggle, crosshair tooltip) and `MetricsChart` (granularity/range/type control bar for `/api/metrics/fetch`). |
| `portal-mojo/admin/core` | Side-effect-light Admin contracts and host: `AdminSection`, the discriminated `AdminRoute` XOR, `adminSectionRoutes`, `adminSectionsMenu`, and `AdminLazyPage`. |
| `portal-mojo/admin/registry` | Stable, narrow built-in `ADMIN_SECTIONS` roster for first-party hosts, without broad page barrels. It installs the optional Email→DNS adapter synchronously so communications routes work before DNS navigation. |
| `portal-mojo/admin/assistant/launcher` | Stable, narrow shell launcher boundary without the Assistant page/data barrel. |
| `portal-mojo/admin/{identity,security,observability,operations,infrastructure,communications,assistant}` | Narrow domain APIs and registry contributions. Built-in routes use leaf-module `loadComponent` loaders; importing `infrastructure` synchronously installs the optional Email→DNS adapter. |
| `portal-mojo/admin` | Compatibility aggregate containing every historical named export and the stable `ADMIN_SECTIONS` roster. It intentionally installs the DNS adapter and Rule field registration synchronously. New code should prefer `admin/core` plus the domains it consumes. |

### Admin route contract

Routes are an explicit XOR. A host-owned page stays synchronous; a packaged
page supplies a separately named loader. The host never guesses from whether a
value is callable.

```tsx
const extension: AdminSection = {
  id: 'billing', title: 'Billing', icon: 'bi-receipt',
  permissions: ['sys.billing'],
  routes: [{ path: '', component: BillingHome }],
};

const packaged: AdminSection = {
  id: 'audit', title: 'Audit', icon: 'bi-journal-text',
  permissions: ['sys.view_logs'],
  routes: [{
    path: '',
    loadComponent: () => import('./AuditPage').then(({ AuditPage }) => ({ default: AuditPage })),
  }],
};
```

Lazy loading, chunk-error recovery, and retry render inside section and route
permission guards, so a denied route never invokes its loader. Routes stay
mount-relative: pass no mount for `#/…`, or `{mount: '/system'}` for the same
sections under `#/system/…`. Root denial and first-visible fallback semantics
are identical in both forms.

## What the consuming app must provide

- **Theme tokens + component CSS.** Components render semantic classes
  (`panel`, `chip`, `tbl`, …) styled by the app's `theme.css` under
  `data-theme="light"` **and** `"dark"` (reference set:
  `apps/portal/src/theme.css`).
- **Tailwind scan of this package.** In an installed app's CSS:
  `@source "../node_modules/portal-mojo/src";` (adjust the relative path from
  that CSS file). Utility classes used in package components are generated by
  the app's Tailwind pass. Monorepo development may scan
  `../../../packages/portal-mojo/src` instead.
- **bootstrap-icons.** Components emit `bi bi-*` classes; the app imports the
  icon font once.
- **Providers.** Every shell supplies `QueryClientProvider` (spread
  `mojoQueryDefaults()` into its defaults), a hash router (`useTableParams` is
  built on react-router's `useSearchParams`), `ThemeProvider`, `ModalHost`, and
  `ToastHost`. Mount one auth-owned `RealtimeProvider` before any realtime hook
  or Assistant surface; individual permission-gated consumers own topic/event
  lifetimes, not the shared connection. Product portals additionally install
  `GroupProvider` so their group-scoped pages and menus can fold active-member
  permissions into `useCan`/`Guarded`. The standalone Admin shell deliberately
  does not install group context; it does install one
  `RightPanelProvider`/`RightPanelSlot` for the globally gated Assistant panel.
- **`VITE_MOJO_API`.** Unset → the in-package mock transport (dev default);
  set to a django-mojo origin → the real backend, same code path.

## Rules

The non-negotiables live in the repo root `PLAN.md` ("Architecture rules") and
`CLAUDE.md`. Short list: params store owns table state; one envelope-unwrap
boundary; failure is unmissable; controlled inputs only; models are
definitions + hooks (TanStack Query owns cache); `ReactNode` slots, never
trusted-HTML strings; both themes from day one.
