# personas — hats/roles a signed-in user operates under (presentation only)

```ts
import {
    definePersonas, getPersonas, getPersona, availablePersonas, personaHome,
    PersonaProvider, usePersona, usePersonaFollowsRoute,
    personaSectionRoutes, personaSectionsMenu, personasOwningPath,
    personaPresets, registerPersonaMemberPermissions,
    auditPersonas,
    type PersonaDef, type PersonaSection, type PersonaSectionChild,
    type PersonaSectionOwnership, type PersonaPreset, type PersonaContextValue,
} from 'portal-mojo/personas';
import { readPersisted, writePersisted, clearPersisted } from 'portal-mojo/client';
```

A **persona** is a working identity the user operates the portal AS — a
support agent, a brand owner, a compliance officer. Switching persona
reshapes the sidebar, the shell density, and "home". It changes NOTHING about
what the user may do.

## The one invariant that matters

**A persona is presentation ONLY. `<Guarded>` / `hasPermission` are the
security boundary.** `hasPermission` has no persona input by design (the
verify script greps for this); `sys.*` stays system-pinned and untouched.
The worst an over-optimistic persona can produce is an empty shell — every
menu item still permission-filters fail-closed, every route is still Guarded.

## Hats vs roles

- **Hat** — `gate` absent: available to every authenticated user. A pure
  view preference ("show me the ops layout").
- **Role** — `gate` (any-of `PermSpec`): the persona appears only for users
  holding one of its gate keys. Gate on **signature keys** — keys held by
  exactly ONE preset. Gating on shared capability keys leaks portals
  (`players.view` means "may read player records", not "is a support agent" —
  the wmx 2026-08-09 audit found exactly this class). `auditPersonas`
  mechanizes the check; strictness is opt-in.

## Declaring personas

```ts
// boot.ts — categories FIRST, then personas that reference them by name
registerPermissionCategories({ support: ['support.queue', 'support.moderation'] });
definePersonas([
    { slug: 'support', label: 'Support', icon: 'bi-headset', home: '/support',
      density: 'simple', gate: ['support.queue'],
      grants: { categories: ['support'], keys: ['players.view'] } },
    { slug: 'explorer', label: 'Explorer', home: '/' }, // a hat: no gate, no grants
]);
```

`definePersonas` REPLACES the registry (declare once at boot; HMR re-runs are
safe). Duplicate slugs are ignored WITH a console.warn — first wins.
`availablePersonas(me)`: `null` me → `[]`; hats always included for an
authenticated user; roles via `hasPermission(me, gate)` (user-level — member
context is not consulted).

## PersonaProvider — the single owner

```tsx
<PersonaProvider fallback="support">
    <AppShell />
</PersonaProvider>
```

Owns the active persona and fans it out to:

1. **React context** — `usePersona()` → `{ persona, def, personas, available,
   setPersona }` (throws outside the provider).
2. **The menu-resolution signal** (`ui/active-persona.ts`) — how
   `resolveActiveMenu`/`SidebarNav` receive the persona without importing this
   module.
3. **Root attributes** — `<html data-persona="support" data-density="simple">`
   for persona-scoped styling. Unmount clears both signal and attributes.

Lifecycle: initial = valid persisted slug (`mojo:persona` via
`readPersisted`, validated against defined slugs — garbage is cleared, never
cast) → else a valid `fallback` prop → else the first defined persona. Once
`me` resolves and at least one persona is available, a persona the user
doesn't hold **snaps** to `available[0]` (state-only; the stored choice
survives for when grants return). Zero-available keeps the current defined
persona — safe because menus/routes stay fail-closed.

### Root styling law

Persona-scoped CSS variables MUST carry `:root` defaults:

```css
:root { --queue-accent: var(--accent); }        /* the default is mandatory */
:root[data-persona='support'] { --queue-accent: var(--good); }
```

Cautionary example (wmx): a variable defined ONLY under
`[data-wmx-view='support']` rendered as the literal fallback off-lens — every
surface styled per-persona was broken for every other persona. Pre-auth the
attribute may also briefly be absent entirely. Default at `:root`, override
under `data-persona`. Same for `data-density` (`'simple' | 'dense'`; the
provider stamps `dense` when a persona doesn't say).

## Menus: persona is a resolution INPUT

`MenuConfig.personas?: string[]` scopes a menu to persona slugs. Menus are
**declared ONCE** at import/boot via `registerMenus` — never re-registered to
switch personas (that was wmx's `applyViewMenu` mutation; the primitive
replaces it). Resolution (`ui/menu-registry.ts`):

1. First registered **eligible** menu whose visible items contain the route —
   persona-scoped menus are eligible only while their persona is active, so
   two personas may both carry `/players` and the active persona's menu wins.
2. **2a.** The active persona's own first menu (preferring one with visible
   items) — beats `defaultMenu`.
3. 2b. `defaultMenu`, then the agnostic fallback chain.

Apps that never touch personas are unaffected: the signal stays `null`,
persona-scoped menus are simply never eligible, agnostic menus resolve
exactly as before.

## PersonaSection — routes + sidebar from one declaration

```tsx
const SECTIONS: PersonaSection[] = [{
    id: 'wmx:support', label: 'Support Console', icon: 'bi-headset',
    basePath: 'support', permissions: ['players.view', 'support.queue'],
    groupScoped: true,
    personas: { support: {}, owner: { label: 'Support (read)', navGroup: 'Oversight' } },
    element: <ConsoleHome />,
    children: [
        { path: 'redemptions', label: 'Redemptions', icon: 'bi-cash-coin',
          navGroup: 'Work queues', permissions: ['redemptions.view', 'sys.admin'],
          element: <RedemptionsQueuePage /> },
        { path: 'player/:id', label: 'Player', hidden: true,
          permissions: ['players.view'], element: <PlayerView /> }, // route, no nav row
    ],
}];

const router = createHashRouter([{ element: <AppShell />, children: [
    ...personaSectionRoutes(SECTIONS), /* … */
]}]);
registerMenus(personaSectionsMenu(SECTIONS)); // ONCE, at boot
```

- `personaSectionRoutes` — every element wrapped in fail-closed
  `<Guarded permission={…} fallback={null}>`; `groupScoped` adds
  `<RequiresGroup>` INSIDE the guard. Deliberately **not** admin/core's
  `guardedElement`: that wraps `AdminGlobalScope`, which blanks group/member —
  right for the framework admin, wrong for product surfaces where member
  grants count. Hidden children still route.
- `personaSectionsMenu` — ONE `MenuConfig` per persona slug
  (`name: 'persona:<slug>'`, `personas: [slug]`); items are that persona's
  sections with per-persona `label`/`navGroup`/`order` overrides applied;
  `navGroup` renders as side-label divider rows; every item carries the
  section/child permissions so `itemVisible` filters fail-closed.
- `usePersonaFollowsRoute()` — call once in the shell: when navigation lands
  on a route owned by other personas' sections and the user HOLDS an owner,
  the persona converges to it. Never navigates. (Owners derive from the
  sections passed to the two builders above — wire routes/menus first.)
- `personaHome(slug)` — the persona's landing route (unknown slug → warn + `/`).

## Phase B — presets as data

`grants` on a persona is its preset: `keys` (granulars) plus `categories`
(**names** of categories the app already registered via
`registerPermissionCategories` — register categories first; an unknown name
expands to nothing with a warn).

- `personaPresets()` → `{slug, label, keys}[]` — deduped union per persona;
  hats without `grants` are omitted.
- `registerPersonaMemberPermissions({ tooltipBySlug? })` — feeds the union of
  preset keys into the admin members catalog (`registerMemberPermissions`) so
  team UIs render switches. `sys.*`/non-editable keys are dropped up front —
  system-pinned keys can never be member grants.
- The **"apply preset"** button (check a preset's boxes on a member form) is
  app-side UI over this data; the server stays authoritative on every write.

## auditPersonas

```ts
auditPersonas(getPersonas(), personaPresets())                          // leak report
auditPersonas(getPersonas(), personaPresets(), { strict: 'signature-diagonal' })
```

Default findings: a persona's gate key held by ANOTHER persona's preset (that
preset's holders see a portal that isn't theirs). Strict adds: every gate key
held by exactly one preset, and each persona's same-slug preset satisfies its
own gate. Hats are skipped. Run it in a boot-time dev assert or a verify
script; `findings: []` is the pass state.

## Persistence helper (`portal-mojo/client`)

`readPersisted(key, validate)` / `writePersisted(key, value)` /
`clearPersisted(key)` — the params.ts localStorage discipline for single
values: feature-detected storage, validate-don't-cast, invalid/unparseable
entries **cleared and null**, silent no-op writes. JSON canonical; a legacy
bare-string value is offered to the validator raw and self-heals to JSON on
the next write.

## Pitfalls

- **Menus are declared once.** Re-registering per persona reintroduces
  mutable menu state; the persona input + `MenuConfig.personas` replaces it.
- **Pre-auth optimism.** Before `me` resolves the stored persona is applied;
  its menu may render with zero visible items until grants load. That is the
  fail-closed contract working, not a bug — don't "fix" it by widening
  `itemVisible`.
- **localStorage is hostile.** Never `getItem(...) as Persona` — always the
  validate-then-clear read (`readPersisted`); the provider already does this
  for `mojo:persona`.
- **Don't gate on shared capability keys** (role personas) — signature keys
  only; `auditPersonas` strict mode enforces it.
- **Don't reach for AdminSection** for persona surfaces — its guard blanks
  the active group, so member grants stop counting.
