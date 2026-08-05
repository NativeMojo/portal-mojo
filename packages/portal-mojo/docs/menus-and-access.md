# menus & access — sidebar engine, permissions, group context

```ts
import { registerMenus, setDefaultMenu, SidebarNav, Guarded, RequiresGroup, GroupSwitcher } from 'portal-mojo/ui';
import { useMe, useCan, useAuthSnapshot, useActiveGroup, GroupProvider, hasPermission, registerPermissionCategories } from 'portal-mojo/client';
```

## Menu registry + SidebarNav (A4)

Menus are DATA registered once (`registerMenus([...])`); the active menu is
**derived** from (route, active group, me) — no mutable menu state.

```ts
registerMenus([
    { name: 'main', items: [
        { divider: 'Main' },
        { label: 'Users', icon: 'bi-people', route: '/users', permissions: 'view_users' },
    ]},
    { name: 'group', groupKind: 'any', items: [ /* group-context menu */ ] },
]);
setDefaultMenu('main');
```

Resolution: route containment in registration order (group menus eligible
only under a kind-matched active group) → defaultMenu → first non-group
visible. Items support `permissions` (any-of) ∧ `requiresGroupKind`;
dividers with no visible children drop; a parent lights when a child route
is active. Admin section bundles contribute menus through the same
registry (`adminSectionsMenu`) with mount-relative routes.

## Permissions (A2) — client gates, server authority

`Me.permissions` is a dict; truthy `true` OR `1` grants. Semantics
(`hasPermission`):
- `is_superuser` → everything.
- system `admin` → full client-side grant (NOTE: the BACKEND does not
  honor `admin` as a wildcard — only `is_superuser` and category rollup.
  The client is deliberately more permissive; the server re-checks).
- category → granular rollup (`users` grants `view_users`… — one-way);
  apps extend via `registerPermissionCategories({cat: [perms]})`.
- `sys.`-prefixed checks never consult the group member.
- Otherwise the ACTIVE GROUP MEMBER's permissions fold in (member `admin`
  grants within the group only).

`useCan(permission | permissions[]) → {can, loading}`;
`<Guarded permission="view_admin" fallback?>…</Guarded>` renders nothing
(or fallback) without the grant — fail-closed.

## Group context (A3)

`<GroupProvider>` at the app root. `useActiveGroup() → {group, member,
loading, setActiveGroup, clearActiveGroup}`. The active group id rides the
REAL `?group=` search param (hash-safe, deep-linkable) with localStorage
fallback; activating a group fetches the caller's member record
(`/api/group/<id>/member`) whose permissions feed `useCan`.
`GroupSwitcher` is the searchable tree picker (300ms server search,
embedded-parent rows, kind chips); `RequiresGroup` wraps pages that need a
group and shows the pick-a-group state otherwise.
