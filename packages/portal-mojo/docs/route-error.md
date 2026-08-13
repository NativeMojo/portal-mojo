# RouteError — the route-level last-resort error card

```ts
import { RouteError, RouteErrorCard, describeRouteError, isChunkLoadError, isNotFoundError } from 'portal-mojo/ui';
// also exported from 'portal-mojo/ui/shell'
```

Any error that reaches the router without this renders React Router's raw
default — "Unexpected Application Error!" on a white page. `RouteError` is
the styled replacement: real message + stack for `Error` throws, a
status/body/JSON dump for object throws (rejected mojo envelopes — never
`[object Object]`), a "Page not found" branch for 404s, and Reload +
Back-to-home actions. Token classes only; renders correctly in both themes,
inside the shell or standalone.

## The error-handling ladder

1. **`safeNode` / `RenderGuard`** (#1602) — per-site: table cells, detail
   sections. Degrade to a marker; the page survives.
2. **`LazyPageBoundary`** (#1557, narrowed by #1604) — **chunk-load failures
   only** (stale deploy): the "Retry" card. Any other error is rethrown —
   a real page crash must not be mislabeled "bundle unavailable".
3. **Child-level `errorElement`** — a pathless wrapper around the app's
   routes: a page crash renders the card **inside the app shell**
   (Sidebar/TopNav stay alive).
4. **Root-level `errorElement`** — 404s and shell crashes. By router
   semantics it *replaces* the root element, so the card renders bare and
   is styled to stand alone.

## Wiring (the portal scaffold ships this)

```tsx
const router = createHashRouter([
    {
        path: '/',
        element: <RequireAuth><App /></RequireAuth>,
        errorElement: <RouteError />,                       // 404s + shell crashes (bare)
        children: [
            { errorElement: <RouteError />, children: [...adminRoutes] },  // in-shell page crashes
        ],
    },
    { path: '/auth', element: <AuthLayout />, errorElement: <RouteError />, children: [/* lazy pages */] },
]);
```

## API

| Export | What |
|---|---|
| `RouteError({ homeTo? })` | Data-router wrapper: reads `useRouteError()`. Use as `errorElement`. |
| `RouteErrorCard({ error, homeTo?, onReload? })` | Presentational card. Use outside data routers (`useRouteError` THROWS there — the showcase's plain `<HashRouter>` is why this split exists). `onReload` replaces the hard `window.location.reload()` on both actions (demos/tests). |
| `describeRouteError(err)` | Total stringifier: Error → message+stack; object → status/statusText head + string body + JSON dump (circular-safe); else `String(err)`. |
| `isNotFoundError(err)` | Structural router-ErrorResponse check with `status === 404`. |
| `isChunkLoadError(err)` | Vite dynamic-import failure predicate. When in doubt it returns `false` — a rethrown real crash with the true message beats a wrong Retry card. |

## Caveats

- **Unauthenticated 404 deep links** see "Page not found" instead of the
  login redirect: the root `errorElement` replaces `RequireAuth`. Deliberate
  — Back-to-home re-enters through the auth guard.
- The 404 branch suppresses the JSON dump (noise); the crash branch shows
  everything a developer needs. The crash still logs to the console.
- The card never itself crashes: no queries, no app context,
  `describeRouteError` is total.
