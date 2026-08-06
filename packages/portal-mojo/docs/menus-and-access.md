# menus & access — global Admin, product menus, permissions, group context

```ts
import { registerMenus, setDefaultMenu, SidebarNav, Guarded, RequiresGroup, GroupSwitcher } from 'portal-mojo/ui';
import { useMe, useCan, useAuthSnapshot, useActiveGroup, GroupProvider, hasPermission, registerPermissionCategories } from 'portal-mojo/client';
```

## Menu registry + SidebarNav (A4)

Menus are DATA registered once (`registerMenus([...])`); the active menu is
**derived** from (route, active group, me) — no mutable menu state.

```ts
registerMenus([
    { name: 'admin', scope: 'global', presentation: 'accordion', items: [
        { divider: 'Main' },
        { id: 'identity', label: 'Identity & Access', icon: 'bi-people', children: [
            { label: 'Users', route: '/users', permissions: 'view_users' },
        ]},
    ]},
    { name: 'project', scope: 'group', groupKind: 'any', items: [ /* product menu */ ] },
]);
setDefaultMenu('admin');
```

Resolution: route containment in registration order (group menus eligible
only under a kind-matched active group) → defaultMenu → first non-group
visible. Items support `permissions` (any-of) ∧ `requiresGroupKind`;
dividers with no visible children drop; a parent lights when a child route
is active. `scope: 'admin' | 'group' | 'account' | 'global'` makes ownership
explicit; legacy `groupKind` menus still infer group scope. Static rendering
remains the default for compatibility. `presentation: 'accordion'` enables
searchable, single-open-section navigation. Give accordion parents stable
`id` values; `keywords` add non-rendered search terms, and
`permissionClauses` express AND-across / any-within checks when both a section
and its route have gates.

The standalone Admin app registers one global accordion menu and does not
mount `GroupProvider` or `GroupSwitcher`. Admin is system-wide: selecting a
group must never change which Admin pages or grants are visible. A product
portal owns its group-scoped menus and switcher. When it embeds Admin sections,
those routes still run inside a global-scope boundary so active-member grants
cannot satisfy `sys.*` or Admin section permission checks.

`<SidebarNav collapsed onRequestExpand>` provides the compact icon rail.
Collapsed category buttons expose CSS tooltips and expand on click, Enter, or
Space. Accordion search matches labels plus `keywords` and reports its result
count through a live status region.

Admin section bundles contribute through `adminSectionsMenu`. Use
`{grouped: true, presentation: 'accordion'}` for the domain-grouped Admin
experience. Routes remain mount-relative; multiple embedded root sections
share one `/system` landing instead of emitting duplicate index routes.

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

Product portals place `<GroupProvider>` at the app root. `useActiveGroup() → {group, member,
loading, setActiveGroup, clearActiveGroup}`. The active group id rides the
REAL `?group=` search param (hash-safe, deep-linkable) with localStorage
fallback; activating a group fetches the caller's member record
(`/api/group/<id>/member`) whose permissions feed `useCan`.
`GroupSwitcher` is the searchable tree picker (300ms server search,
embedded-parent rows, kind chips); `RequiresGroup` wraps pages that need a
group and shows the pick-a-group state otherwise. Do not install these in the
standalone Admin shell; they belong to group-scoped product navigation.
