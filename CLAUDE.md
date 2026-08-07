# PORTAL-MOJO

React portal toolkit for django-mojo + the base admin portal. Successor to
web-mojo (now maintenance-mode). Keep this file under 80 lines.

## Start every session

1. Read `PLAN.md` in full — it carries the phase plan, per-item web-mojo source
   paths, architecture rules, and the do-not-recreate list. Work the next
   unchecked item unless told otherwise.
2. The reference implementation is `/Users/ians/Projects/mojo/nativemojo/web-mojo`
   (parked on `main`). **Read-only** — never edit it from here.
3. Run baseline before first edit: `npm run typecheck` must be green.

## Layout

- npm workspaces — install at root (`npm install`); root `npm run typecheck`
  checks the package, then the app.
- `apps/portal` — the base admin portal app (Vite/React 19/TS strict). Dev:
  `npm run dev` (preview config "portal"; port 5199, autoPort picks another
  via PORT when taken). Mock django-mojo API by default; `npm run dev:live`
  (preview config "portal-live", `apps/portal/.env.live`) targets a real
  backend. Pre-C3 sign-in: `__mojo.login(user, pass)` in the console.
- `packages/portal-mojo` — the toolkit: TS-source subpath exports
  `portal-mojo/client`, `/ui`, `/charts`, `/admin`; no build step. The app
  imports the package, never the reverse. Its README lists what consuming
  apps must provide (tokens, `@source` scan, icons, providers).
  **Component reference docs: `packages/portal-mojo/docs/` — read the page
  before using/altering a component; new components ship with a docs page
  AND a playground demo (app → Develop → Components).**

## Non-negotiable rules

- **Port from source, not memory.** Every PLAN item names its web-mojo source
  file — read it before building. Summaries under-build (charts/filters were
  rebuilt once for exactly this reason).
- **Verify in the browser before done:** light AND dark theme, interactions
  actually clicked, console clean, typecheck green.
- `params` store is the single source of truth for table state (URL-synced;
  `field__in` collapse; `dr_field/dr_start/dr_end` daterange triple).
- One envelope-unwrap boundary in the client; a failed save REJECTS — never
  resolve failure as success.
- Models are typed definitions + hooks (`defineModel`), never stateful
  instances; TanStack Query owns cache/reactivity.
- Controlled inputs, one value pipeline. Unknown option values fall back to a
  default WITH a console.warn — never to "render nothing".
- No table library, no chart library, no UI kit. TanStack Query + Tailwind 4
  tokens only. Native `<dialog>` for modals. Hash router.
- Everything renders correctly under `data-theme="light"` AND `"dark"` from
  day one — tokens live in `apps/portal/src/theme.css`.
- django-mojo wire contract: `{status, data, …}` envelope, `start`/`size`
  paging, `'-field'` sort, Django lookups. The mock
  (`packages/portal-mojo/src/client/mock.ts`) must keep speaking it exactly —
  it is the contract's executable spec, shipped with the client.

## Product context

- django-mojo portals are **group-driven**: active-group context, easy
  switching, group-centric permissions with user system-level overrides,
  sidebar varies by context (global vs group vs `group.kind`).
- The look is web-mojo's mission-control design language (its 8 dark tokens are
  carried verbatim). UserView/GroupView DetailView style is the house style.
- Beloved features to preserve at fidelity: TableView UX (incl. skeleton
  loader), FormView inline autosave (no save buttons), the metrics charts
  (granularity/range/type switching, stacked bars).

## Git

- Every code build runs on its own `codex/<item>` branch in a dedicated Git
  worktree. Never share a checkout between concurrent builds; keep `main` as
  the integration checkout only.
- After scoped verification is green, merge the completed branch into local
  `main`. A build is not done until it verifies that merge, removes its exact
  worktree, deletes its exact merged local branch, runs `git worktree prune`,
  and confirms neither remains. Never bulk-delete worktrees or branches owned
  by other sessions. Pushing remains opt-in and requires Ian's explicit
  permission.
- Package releases are a separate reviewed action: follow `RELEASING.md`.
  `npm run release` verifies, commits, tags, and atomically pushes; the tag
  publishes through GitHub OIDC without developer npm credentials.
- Commit finished work by explicit pathspec (never `git add -A`), message
  trailer names the building model, e.g.
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## Model guidance

Fable for contract-dense foundation work (Chunks A/B) and review; Opus 5
(`/fast`) for volume fan-out (pages, field components, CSS porting).

## Responses

- Short and plain. No preamble, no recap of what I just did.
- Lead with the answer. Detail only if asked.
- Don't explain reasoning unless it changes what the user does next.
- No unnecessary tool calls to prove a point — state it and move on.
- Ask before acting on anything beyond the literal request.
