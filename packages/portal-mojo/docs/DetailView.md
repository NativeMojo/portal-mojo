# DetailView — the UserView house style

```ts
import {
    DetailView, Eyebrow, FlatRow, SecurityItem,
    type Section, type RailEntry, type DetailMenuEntry, type DetailViewProps,
} from 'portal-mojo/ui';
```

The record-detail surface: identity header (avatar, title, subtitle,
chips, optional active switch, kebab menu, close) over a left rail of
sections with side-label dividers. Open it inside `modal.detail(...)` for
the standard row-click experience. Ported from web-mojo `SideNavView.js`
(sections, gating, badges) + `ContextMenu.js` (the kebab).

Because sections and menu entries can carry permissions, DetailView
resolves the live session (`useMe` + active-group member) — like the rest
of the toolkit it must render inside the app's `QueryClientProvider`
(mount `GroupProvider` too if member permissions should fold in).

```tsx
<DetailView
    avatarName={u.display_name || u.username}
    title={...} subtitle={u.email}
    chips={[{ icon: 'bi-patch-check-fill', text: 'Email', tone: 'success' }]}
    active={{ value: u.is_active, onChange: (next) => ... }}
    onClose={onClose}
    badges={{ sessions: openSessions }}
    menuContext={u}
    contextMenu={[
        { label: 'Resend invite', icon: 'bi-envelope-paper', when: (u) => u?.last_login == null, onSelect: ... },
        { divider: true },
        { label: 'Delete', icon: 'bi-trash', danger: true, permissions: ['manage_users', 'users'], onSelect: ... },
    ]}
    sections={[
        { key: 'profile', label: 'Profile', icon: 'bi-person', render: () => <>…</> },
        { divider: 'Security' },
        { key: 'security', label: 'Security', icon: 'bi-shield-check', permissions: 'view_security', render: () => <>…</> },
    ]}
/>
```

- `active` is a CONTROLLED switch — cancelling a confirmation simply not
  changing state snaps it back (the disable-flow pattern: off → collect
  reason via `formModal`, cancelled → no state change).
- `sections` mixes `{key, label, icon, render, permissions?}` entries with
  `{divider: 'Label'}` side-labels.
- `initialSection` picks the starting rail entry.

## Permission-gated sections (fail-closed)

`Section.permissions` is a permission name or an ANY-of array, resolved
exactly like `useCan` (signed-in user + active-group member; `admin` and
superuser pass everything; `sys.` pins to system level). **Fail-closed**:
while `me` loads, while anonymous, and on a failed check the section is
absent from the rail AND cannot be activated — there is no route to a
gated section's content, and its content is never mounted (not even
hidden).

- **Orphan dividers drop.** After gating, a `{divider}` label survives
  only if the next visible entry is a section — trailing and doubled
  dividers disappear with their group (a leading divider with visible
  content below it stays). Source rule: `SideNavView._visibleSectionConfigs`.
- **Active self-heal.** If the ACTIVE section becomes invisible
  (permission or schema change), selection falls back to the first visible
  section — and the heal is STICKY (`_reconcileActiveSection` parity): the
  old section regaining visibility does not steal selection back.

## Rail badges (controlled)

`badges?: Record<sectionKey, ReactNode>` — numbers, text, dots
(`<span className="rail-dot" />`), or any node, rendered at the right edge
of the rail entry. Primitive values (string/number — including `0`) get
the source's default muted pill; elements render as given, so
`<Badge tone>` owns its look. Nullish / `false` / `true` / `''` render
nothing.

**Deviation from web-mojo, by design:** the source's imperative
`setBadge(key, value)` patched the DOM in place. Here badges are a
CONTROLLED prop — React owns the state; update the prop and the rail
follows. There is no imperative handle.

## Header kebab menu

`contextMenu?: Array<{ label, icon?, permissions?, when?, onSelect, danger? } | { divider: true }>`
renders a three-dot button in the header gutter (before the close X) that
opens a `Popover` menu (`placement: bottom-end`, top-layer — works inside
`modal.detail`). Filtering is `ContextMenu.visibleItems` parity:

- `permissions` — same any-of, fail-closed gate as sections.
- `when(menuContext)` — visibility predicate over the `menuContext` prop
  (by convention the record on display; `undefined` when not provided).
  Re-evaluated every render, so entries track model state live.
- Hidden entries drop; separators that end up leading, trailing, or
  doubled collapse — the menu never shows an orphaned rule.
- No surviving entries ⇒ no kebab button at all.
- Select runs `onSelect()` then closes the menu (source order). Outside
  mousedown and Escape close it too (Popover semantics).
- `danger: true` styles the entry with `--bad` (destructive actions).

`DetailView` is generic over the context: `DetailView<TCtx>` — `TCtx` is
inferred from `menuContext`, and `when` receives `TCtx | undefined`.

## Lazy mount + keep-alive

A section's content mounts on FIRST activation and stays
mounted-but-hidden afterwards (CSS `hidden`, not unmount), so section
state — form drafts, scroll-free local state, in-flight queries —
survives switching away and back. This is the source's
unmount-not-destroy semantic translated to React.

- Never-activated sections don't mount at all (lazy).
- Permission revocation UNMOUNTS the revoked section entirely
  (fail-closed beats keep-alive — revoked content must not linger in the
  DOM); regaining the permission remounts it fresh, state gone.
- A section removed from the `sections` array unmounts and loses state;
  re-adding it starts fresh (source `removeSection` destroyed the view).
- Components used inside `render` must be module-level (or otherwise
  identity-stable) — an inline component literal re-created each parent
  render remounts every time, defeating keep-alive.

## Misconfiguration warns — never silence

Invalid config falls back WITH a `console.warn` (once per problem per
instance, not per render):

| Problem | Fallback |
|---|---|
| `permissions` not a string/string[] (or non-string array entries) | treated as DENIED (fail-closed; superuser/`admin` still pass) |
| `badges` key naming no section | ignored |
| duplicate section `key` | warned (activation + keep-alive key on it) |
| `initialSection` naming no section at all | falls back to first visible |
| contextMenu entry without `label`/`onSelect` | dropped |
| contextMenu `when` not a function | predicate ignored |

A merely GATED `initialSection` heals silently — that is normal
permission behavior, not misconfig.

## Row/section primitives

| Component | Use |
|---|---|
| `Eyebrow` | small uppercase section heading inside a panel |
| `FlatRow` | label + value row; `action` adds the edit pencil (`actionIcon` to override, e.g. `bi-plus-lg` for empty values) |
| `SecurityItem` | icon + title + description row with a trailing slot (badge/button) |

Conventions from the Users proof: pencil actions open `formModal` with
current values as `initial`; a danger action lives in a `.danger-zone`
block at the bottom of a section; fields the wire doesn't carry for other
users (me-graph only: `has_passkey`, `requires_mfa`) don't get rows.

## Pitfalls

- **Gated `initialSection` lands on the first visible section** and stays
  there even after grants finish loading (fail-closed + sticky heal, per
  source). Don't point `initialSection` at a gated section expecting it
  to activate late.
- **Hidden sections keep rendering** (they're mounted): their `render()`
  closures re-run on every parent render and their queries stay live.
  Keep section bodies pure-render; put expensive work behind hooks that
  cache.
- **Badges are state, not commands** — to "setBadge", change the value
  your `badges` prop is built from.
- The styles for the C1 chrome live in `apps/portal/src/theme/detailview.css`
  (`.rail-badge`, `.rail-dot`, `.dv-menu*`, `.dv-keep`) — tokens only,
  both themes.
