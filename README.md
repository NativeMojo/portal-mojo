# portal-mojo

React portal toolkit for [django-mojo](../django-mojo) backends, plus the base
admin portal every django-mojo deployment ships with. Successor to
[web-mojo](../web-mojo) (maintenance mode).

```bash
npm --prefix apps/portal install
npm run dev          # http://localhost:5199 — mock django-mojo API built in
```

Point at a real backend with one env var in `apps/portal/.env.local`:

```
VITE_MOJO_API=https://api.example.com
```

- `apps/portal` — the base admin portal (React 19 · TypeScript · Vite ·
  Tailwind 4 · TanStack Query; no table/chart/UI libraries — the components
  are ours).
- `packages/portal-mojo` — the published toolkit (in progress; see `PLAN.md`).

Read `PLAN.md` for the build plan and `CLAUDE.md` for working rules.
