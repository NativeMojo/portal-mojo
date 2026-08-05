# MIGRATION.md — parallel port protocol (worktree agents)

You are one of several agents porting web-mojo components into portal-mojo in
parallel, each in an isolated git worktree. Your branch merges back into main
by the orchestrator. This file is the protocol; your task prompt names your
component, sources, and exact file grants.

## Mission shape

Translate the legacy component (vanilla-JS view framework) into a React 19 +
TS-strict portal-mojo component at FULL feature fidelity. This is a
migration, not a reinvention: read the named web-mojo source files IN FULL
before writing code (the #1 failure mode is under-building from a summary),
then express the same behavior in this codebase's idiom.

## Read before coding (in this order)

1. Your task prompt (workspec: features, acceptance criteria, known bugs NOT
   to carry).
2. The named web-mojo sources — every line. web-mojo is READ-ONLY reference
   at `/Users/ians/Projects/mojo/nativemojo/web-mojo` — never edit it.
3. `PLAN.md` → "Architecture rules" + "Do-not-recreate list" (short).
4. `packages/portal-mojo/docs/README.md` (the 7 non-negotiables) and ONE
   existing component for idiom — `packages/portal-mojo/src/ui/FilterBar.tsx`
   or `ModelTable.tsx` (naming, tokens, comment density).
5. `apps/portal/src/theme.css` — the design tokens and class patterns your
   CSS must use.

## Hard rules (the ones agents break most)

- **Controlled inputs, ONE value pipeline.** `change` fires on COMMIT
  (select/Enter/blur), never per keystroke. Unknown option/type values fall
  back to a default WITH `console.warn` — never render nothing.
- **ReactNode slots, never HTML strings.** No `dangerouslySetInnerHTML`
  (the one sanctioned exception: sanitized markdown at its one boundary).
- **Both themes.** Style with theme.css tokens only; everything must read
  correctly under `data-theme="light"` AND `"dark"`. No hardcoded colors.
- **Wire contract:** epoch SECONDS for datetimes; `dr_field/dr_start/dr_end`
  daterange triple; failed saves REJECT.
- **TypeScript strict, no `any` leaks in public APIs.** Match surrounding
  code style; comments only for constraints code can't show.
- Dependency policy: none. (Single sanctioned exception: the B3 agent adds
  `zod`.)

## File ownership — the merge contract

You may CREATE the new files your prompt lists and EDIT only the files your
prompt explicitly grants. Everything else is READ-ONLY — especially these
shared files, which the orchestrator wires at merge time:

- `packages/portal-mojo/src/ui/index.ts` (exports)
- `apps/portal/src/theme.css` (your CSS goes in your OWN new file instead)
- `apps/portal/src/pages/components/ComponentsPage.tsx` (rail registry)
- `packages/portal-mojo/docs/README.md` (docs index)
- `PLAN.md`, `CLAUDE.md`, `.claude/*`

Standard file set for a component `<slug>`:

| File | Rule |
|---|---|
| `packages/portal-mojo/src/ui/.../<Component>.tsx` | the component (path per prompt) |
| `apps/portal/src/theme/<slug>.css` | its styles — tokens only, both themes; NOT imported anywhere yet (orchestrator adds the `@import` to theme.css at merge) |
| `apps/portal/src/pages/components/demos-<slug>.tsx` | a self-contained demo: export a named `<X>Demo` component (+ more if the prompt says). Import your component by RELATIVE path into `packages/portal-mojo/src/...` and leave a `// MERGE-WIRE: portal-mojo/ui` comment on that import |
| `packages/portal-mojo/docs/<slug>.md` | reference page in the established style (import path, API, wire contract, invariants, pitfalls) — written for an AI reader |

## Worktree setup + verification

Your worktree has no `node_modules`. First:

```bash
git checkout -b port/<slug>
ln -s /Users/ians/Projects/mojo/nativemojo/portal-mojo/node_modules node_modules
ln -s /Users/ians/Projects/mojo/nativemojo/portal-mojo/apps/portal/node_modules apps/portal/node_modules
```

Before committing: `npm run typecheck` must be GREEN (package + app). Do not
run dev servers or browsers — browser verification (both themes, clicked
interactions, console clean) happens centrally post-merge; your job is
correct, complete, typechecked code plus a demo that exercises every
feature so that verification can actually see them.

## Commit + report

- Commit ONLY your granted files, by explicit pathspec (never `git add -A`).
- Message: `<Component> port (board #<id>) — from <web-mojo source>` with the
  co-author trailer your prompt specifies.
- Do NOT push, merge, touch main, or edit the maestro board.

End your run by reporting: branch name, commit SHA, files created/modified,
confirmation you read each source file in full, feature checklist vs the
workspec (done / deviated+why / deferred+why), the export names + value
shapes the registry needs, and anything the merge pass must know.
