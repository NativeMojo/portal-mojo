# portal-mojo

React portal toolkit for [django-mojo](../django-mojo) backends, plus the base
admin portal every django-mojo deployment ships with. Successor to
[web-mojo](../web-mojo) (maintenance mode).

```bash
npm install          # workspace root
npm run dev          # http://localhost:5199 — mock django-mojo API built in
```

Point at a real backend with one env var in `apps/portal/.env.local`:

```
VITE_MOJO_API=https://api.example.com
```

- `apps/portal` — the base admin portal (React 19 · TypeScript · Vite ·
  Tailwind 4 · TanStack Query; no table/chart/UI libraries — the components
  are ours).
- `packages/portal-mojo` — the toolkit: subpath exports `portal-mojo/client` ·
  `/ui` · `/charts` · `/admin`, shipped as TypeScript source and consumed by
  the app via npm workspaces (details in its README).

Read `PLAN.md` for the build plan and `CLAUDE.md` for working rules.
