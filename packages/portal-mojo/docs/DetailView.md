# DetailView — the UserView house style

```ts
import { DetailView, Eyebrow, FlatRow, SecurityItem } from 'portal-mojo/ui';
```

The record-detail surface: identity header (avatar, title, subtitle,
chips, optional active switch, close) over a left rail of sections with
side-label dividers. Open it inside `modal.detail(...)` for the standard
row-click experience.

```tsx
<DetailView
    avatarName={u.display_name || u.username}
    title={...} subtitle={u.email}
    chips={[{ icon: 'bi-patch-check-fill', text: 'Email', tone: 'success' }]}
    active={{ value: u.is_active, onChange: (next) => ... }}
    onClose={onClose}
    sections={[
        { key: 'profile', label: 'Profile', icon: 'bi-person', render: () => <>…</> },
        { divider: 'Security' },
        { key: 'security', label: 'Security', icon: 'bi-shield-check', render: () => <>…</> },
    ]}
/>
```

- `active` is a CONTROLLED switch — cancelling a confirmation simply not
  changing state snaps it back (the disable-flow pattern: off → collect
  reason via `formModal`, cancelled → no state change).
- `sections` mixes `{key, label, icon, render}` entries with
  `{divider: 'Label'}` side-labels. Only the active section renders.
- `initialSection` picks the starting rail entry.

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

Coming in C1 (don't hand-roll now): permission-gated sections
(fail-closed + orphan-divider drop), rail badges/`setBadge`, kebab
`contextMenu` with `permissions`/`when`.
