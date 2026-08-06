# portal — the base admin portal app

The runnable base portal for django-mojo — the reference answer to "grab the
portal, point it at a django-mojo instance, off to the races." It is the first
consumer and test bed of the `portal-mojo` package, and the shell that
`create-portal-mojo` will clone per deployment.

```bash
npm install        # at the repo root (npm workspaces)
npm run dev        # http://localhost:5199 — runs on the built-in mock API
```

Point it at a real backend by setting one env var (`.env.local`):

```
VITE_MOJO_API=https://api.example.com
```

With it unset, the toolkit's mock (`packages/portal-mojo/src/client/mock.ts`)
serves an in-memory dataset through the **exact django-mojo wire contract** —
envelope `{status, data, count, size, start}`, `start`/`size` paging,
`'-field'` sort, `search`, and Django lookups (`role__in`, `is_active`,
`created__gte`, `__icontains`, `__isnull`) — so the client code above it is
the real thing, not a demo shim.

## Where things live

The toolkit — client, params store, UI components, charts — is the
`portal-mojo` package (`packages/portal-mojo`, subpath exports
`portal-mojo/client` · `/ui` · `/charts` · `/admin`; see its README).
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

## Not here yet (deliberate)

Auth flows, permissions gating, group context, WebSocket, capability
detection, sidebar collapse/mobile, column chooser, stat strip, inline cell
edit, autosave forms — those are toolkit phases (see `PLAN.md`), not baseline
concerns. The seams for all of them exist.
