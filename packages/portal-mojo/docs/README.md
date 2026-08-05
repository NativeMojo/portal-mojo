# portal-mojo — component & client reference

Reference docs for every export, written to be loaded into an AI coding
context. Each page states the import path, the API surface, the wire
contract it speaks, and the invariants that must hold. Live demos for
everything: run the portal (`npm run dev`) → **Develop → Components**.

| Page | Covers |
|---|---|
| [client.md](client.md) | Transport, envelope boundary, `mojoList/Get/Save/Delete/Download/Metrics`, `mojoCall`, `mojoQueryDefaults`, mock vs live |
| [defineModel.md](defineModel.md) | Model definitions + hooks, POST_SAVE_ACTIONS, `fetchOne`, cache keys |
| [params.md](params.md) | `useTableParams` — the single source of truth for table state; persistence blob |
| [auth.md](auth.md) | Login flows, token upkeep, hosted-auth (bouncer page) bridge, auth events |
| [ModelTable.md](ModelTable.md) | The server-driven table: columns, filters, selection/batch, chooser, persist, autoRefresh, expand, groupBy, export, skeleton |
| [forms.md](forms.md) | The `Field` language, `SchemaForm`, `formModal` |
| [DetailView.md](DetailView.md) | The UserView-style detail surface + row/section primitives |
| [feedback.md](feedback.md) | Awaitable `modal.*`, `toast.*` |
| [popover.md](popover.md) | Anchored top-layer popover shell — placement, reposition, outside/Escape close, the dialog stacking story |
| [taginput.md](taginput.md) | Chip/tag entry — CSV wire shape, keyboard matrix, validation + inline errors |
| [charts.md](charts.md) | `SeriesChart`, `MetricsChart`, the metrics wire shape |
| [menus-and-access.md](menus-and-access.md) | Menu registry + SidebarNav; `useMe`/`useCan`/`Guarded`; group context |
| [grouping-and-fmt.md](grouping-and-fmt.md) | `groupBy*` helpers, `fmt.*` formatters |

## Non-negotiables (apply to every page below)

1. **Tables are SERVER-driven.** Sort, search, filters and paging are wire
   params django-mojo answers. Nothing filters/sorts rows client-side; if
   you are about to `Array.filter` table rows, stop — write a param.
2. **One envelope-unwrap boundary** (`client.ts`). A failed save REJECTS —
   never resolve failure as success, never sniff `resp.data.data`.
3. **Models are definitions, not instances** (`defineModel`). TanStack Query
   owns cache/reactivity; there is no second ownership system.
4. **Controlled inputs, one value pipeline.** A control can never display a
   value its state doesn't hold. Unknown option values fall back to a
   default WITH a `console.warn` — never to rendering nothing.
5. **Both themes, day one.** Style with tokens from `apps/portal/src/theme.css`
   (`--surface`, `--ink`, `--mute`, `--accent`, …) and verify under
   `data-theme="light"` AND `"dark"`.
6. **django-mojo datetimes are epoch SECONDS** on the wire. `fmt.*` accepts
   them directly; do not `new Date(epochSeconds)` without ×1000.
7. **The mock speaks the exact wire contract** (`src/client/mock.ts`). When a
   contract detail changes, the mock changes in the same commit — it is the
   contract's executable spec.

## Working agreement

Every new component ships with: a page here, a demo section in the
playground (`apps/portal/src/pages/components/`), and a browser
verification in both themes.
