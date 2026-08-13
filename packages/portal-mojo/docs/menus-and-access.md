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

Until the identity bundle is fully consolidated, the app-local `/users` and
`/groups` routes must carry their own system-pinned route and menu clauses in
addition to nested control gates. A Group opened from `/groups` is inspected
route data only: it must not call `setActiveGroup`, add `?group=`, or treat an
active product membership as Admin authority.

`<SidebarNav collapsed onRequestExpand>` provides the compact icon rail.
Collapsed category buttons expose CSS tooltips and expand on click, Enter, or
Space. Accordion search matches labels plus `keywords` and reports its result
count through a live status region.

Admin section bundles contribute through `adminSectionsMenu`. Use
`{grouped: true, presentation: 'accordion'}` for the domain-grouped Admin
experience. Routes remain mount-relative; multiple embedded root sections
share one `/system` landing instead of emitting duplicate index routes.

Import the route/menu machinery from `portal-mojo/admin/core`, then import only
the registry domains the shell installs. The stable domains are `identity`,
`security`, `observability`, `operations`, `infrastructure`, `communications`,
and `assistant`. `portal-mojo/admin` remains the compatibility aggregate and
retains every historical export, but deliberately performs the legacy DNS and
Rule-field setup at import time.

Built-in routes use `loadComponent`; external sections may use `component`.
These properties are mutually exclusive. Loading and retryable error states
live inside both permission guards, so access denial performs no page import.
The infrastructure entry installs the optional managed-DNS adapter
synchronously, which makes Email-first navigation safe even before any DNS page
chunk has loaded. `admin/core` performs neither DNS nor field registration.

### Flat sections (`presentation: 'flat'`)

A section whose children should render as FLAT top-level sidebar rows under
labeled group dividers — no accordion (the persona-lens shape: a Settings
lens whose sidebar reads Brand / Access / Activity as divider groups):

```ts
{
    id: 'settings', label: 'Settings', icon: 'bi-gear', route: '/settings',
    presentation: 'flat', group: 'Brand',       // labels the hoisted home row
    children: [
        { label: 'Brand profile', route: '/settings/brand', group: 'Brand' },
        { label: 'Members', route: '/settings/members', group: 'Access' },
        // a nested child stays an accordion among the flat rows
        { label: 'Reports', group: 'Access', children: [/* … */] },
    ],
}
```

`SidebarNav` applies the exported pure `flattenMenuItems(items, ctx)`
automatically; flag-less menus pass through by identity. Semantics:

- **Divider on group CHANGE** (run semantics) — a repeated non-consecutive
  label is two runs. A registry divider immediately followed by the first
  group divider collapses (later wins).
- **The section's `route` hoists first** as its home row, `exact`-matched so
  it never prefix-lights over deep routes. The label stays the section's own
  (no auto-"Overview" — name it what you mean).
- **Nested children hoist as accordions** and RESET the run, so the next
  flat row re-emits its divider.
- **Icons fall back to the section's**; a child's `group` label joins its
  search `keywords`.
- **Gates compose section ∧ child** — a child's own `permissions` never
  bypass the section gate (stricter than the wmx source, deliberately: it
  matches the admin nav's clause idiom). An invisible flat parent drops its
  whole section.
- **Flat is presentation only.** Route resolution (`resolveActiveMenu`)
  walks the original tree, so active-menu selection cannot disagree with
  what renders. Rail density is an authoring concern — nest a long group.

The personas layer's `sectionMenuEntries` still pre-flattens its own menus;
converging it onto flat sections is a named follow-up.

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
