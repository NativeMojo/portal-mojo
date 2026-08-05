# mojo-portal-baseline

A runnable baseline for the React-era mojo portal — the reference answer to
"grab the portal, point it at a django-mojo instance, off to the races."

```bash
npm install
npm run dev        # http://localhost:5199 — runs on the built-in mock API
```

Point it at a real backend by setting one env var (`.env.local`):

```
VITE_MOJO_API=https://api.example.com
```

With it unset, `src/lib/mock.ts` serves an in-memory dataset through the
**exact django-mojo wire contract** — envelope `{status, data, count, size,
start}`, `start`/`size` paging, `'-field'` sort, `search`, and Django lookups
(`role__in`, `is_active`, `created__gte`, `__icontains`, `__isnull`) — so the
client code above it is the real thing, not a demo shim.

## Stack (and why)

| Piece | Why |
|---|---|
| React 19 + TypeScript strict + Vite | Largest AI training prior; typed contracts; instant feedback loop |
| TanStack Query | Server-state: caching, dedup, background refetch, invalidation — replaces Collection fetch lifecycle + stale guards |
| Tailwind 4 | Tokens declared once (`@theme inline` in `src/theme.css`), utilities for layout; the design system is CSS variables ported from web-mojo |
| **No table library** | Tables are server-driven (sort/filter/page are all params) — table "state" is the params store; rendering is a map. Revisit TanStack Table only for client-heavy needs (column resize/pinning, virtualized client rows) |
| Native `<dialog>` | The awaitable ModalManager needs no z-index/backdrop stack manager |
| Hash router | Built `dist/` works from any static mount (incl. served by django-mojo) with zero rewrite config |

## What each file demonstrates

- `src/lib/client.ts` — mini **@mojo/client**: one envelope-unwrap boundary; a
  failed save REJECTS (web-mojo's `Model.save()` never-rejects trap is not
  carried forward).
- `src/lib/params.ts` — the architecture rule: **one flat params object** is
  the single source of truth for search/sort/filters/paging; URL-synced, so
  table state is shareable. Presets are mutually-exclusive bundles whose
  active state is derived by matching, never stored.
- `src/lib/lookups.ts` — DjangoLookups ported whole (pill text, key parsing).
- `src/lib/format.ts` — mini DataFormatter: pipes become plain functions.
- `src/components/ModelTable.tsx` — schema-driven server table: columns as
  data, toolbar (search / filters / refresh / add), preset segment, filter
  pills, 3-way header sort, skeleton/empty/error states, pagination.
- `src/components/DetailView.tsx` — the record-viewer layout (flat header +
  chips + active switch + grouped left rail + flat rows) as schema + small
  components. `src/pages/UserDetail.tsx` recreates the web-mojo UserView.
- `src/components/modal.tsx` — imperative awaitable modals:
  `await modal.confirm(...)`, `modal.detail(...)`, `formModal(...)`.
- `src/components/FormFields.tsx` — the field-definition language: a form is
  an array of field objects (web-mojo's `CREATE_FORM` shape), controlled
  inputs, one value pipeline.
- `src/theme.css` — web-mojo's design tokens: the 8-line mission-control dark
  palette verbatim, light twin, all components on tokens, `data-theme`
  switching (light / dark / system in the topnav).

## Per-screen authoring cost

`src/pages/UsersPage.tsx` is the proof: a complete admin screen — columns,
badges, filters, presets, deep-linkable state, add-user form, row-click detail
modal — in ~80 declarative lines against the toolkit components.

## Not in the baseline (deliberate)

Auth flows, permissions gating, group context, WebSocket, capability
detection, sidebar collapse/mobile, column chooser, stat strip, inline cell
edit, autosave forms — those are toolkit phases (see the port manifest), not
baseline concerns. The seams for all of them exist here.
