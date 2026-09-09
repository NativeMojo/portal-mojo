# portal — the base admin portal app

The runnable base portal for django-mojo — the reference answer to "grab the
portal, point it at a django-mojo instance, off to the races." It is the first
consumer of the `portal-mojo` package and the built-in Django Admin frontend.
`npm ci && npm run build:admin` at the root creates the separate `dist/admin`
distribution using Node 24.21.0/npm 11.19.0. Use `-- --canonical` to require
clean source. Django serves those bytes behind its protected `/admin/v2/` mount
(or the configured Admin prefix), with same-origin API calls and hosted auth.
No API environment variable or frontend build is required on the deployment.

```bash
npm install        # at the repo root (npm workspaces)
npm run dev        # http://localhost:5199 — runs on the built-in mock API
```

Point it at a real backend by setting one env var (`.env.local`):

```
VITE_MOJO_API=https://api.example.com
```

With it unset in ordinary development, the toolkit's mock (`packages/portal-mojo/src/client/mock.ts`)
serves an in-memory dataset through the **exact django-mojo wire contract** —
envelope `{status, data, count, size, start}`, `start`/`size` paging,
`'-field'` sort, `search`, and Django lookups (`role__in`, `is_active`,
`created__gte`, `__icontains`, `__isnull`) — so the client code above it is
the real thing, not a demo shim.

## Where things live

The toolkit — client, params store, UI components, charts — is the
`portal-mojo` package (`packages/portal-mojo`, subpath exports
`portal-mojo/client` · `/ui` · `/charts` · `/admin/core` and narrow
`/admin/<domain>` entries; the `/admin` aggregate remains compatibility-only.
See the package README for the domain map.
This app owns what is deployment-specific:

- `src/main.tsx` — providers + hash router wiring.
- `src/App.tsx`, `src/components/` — the shell: sidebar, topnav (theme switch).
- `src/pages/` — the screens, written against the package.
- `src/theme.css` — the design tokens (web-mojo's 8-value mission-control dark
  palette verbatim, light twin) and component CSS, plus the Tailwind `@source`
  scan of the package source. Per-deployment theming happens here.

## Stack (and why)

| Piece | Why |
|---|---|
| React 19 + TypeScript strict + Vite | Largest AI training prior; typed contracts; instant feedback loop |
| TanStack Query | Server-state: caching, dedup, background refetch, invalidation — replaces Collection fetch lifecycle + stale guards |
| Tailwind 4 | Tokens declared once (`@theme inline` in `src/theme.css`), utilities for layout; the design system is CSS variables ported from web-mojo |
| **No table library** | Tables are server-driven (sort/filter/page are all params) — table "state" is the params store; rendering is a map. Revisit TanStack Table only for client-heavy needs (column resize/pinning, virtualized client rows) |
| Native `<dialog>` | The awaitable ModalManager needs no z-index/backdrop stack manager |
| Hash router | Built `dist/` works from any static mount (incl. served by django-mojo) with zero rewrite config |

## Per-screen authoring cost

`portal-mojo/admin`'s `UsersPage` is the proof: a complete admin screen — columns,
badges, filters, presets, deep-linkable state, add-user form, row-click detail
modal — in ~80 declarative lines against the toolkit.

## Protected packaged runtime

The packaged app establishes its source-session cookie before constructing the
hash router and gates every lazy loader. Grants renew from their server deadline
and on resumed tabs; denied/expired/unavailable grants show eager recovery with
the route preserved. Sign-out waits for cross-tab coordinated revocation.
Storage keys remain compatible with MojoAuth; remember-me and session-only
sessions retain their storage choice. The sidebar shows Live API and the
artifact version. Embedded consumers and showcase do not install this lifecycle.

See [artifact identity, source timing/coordination and CSP matrix](../../docs/admin-artifact.md).
Scaffolding and capabilities discovery are future independent work.
