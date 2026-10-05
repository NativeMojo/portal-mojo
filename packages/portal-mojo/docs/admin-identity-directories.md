# Admin Groups and Personal API Keys

The global Admin registry contributes Groups and Personal API Keys to the
Identity & Access navigation group. `adminSectionRoutes()` and
`adminSectionsMenu()` therefore mount the same pages in the standalone
reference portal and in an embedded System Admin boundary:

```tsx
import {
  GROUPS_ADMIN_SECTION,
  GROUP_VIEW_PERMS,
  GroupDetail,
  GroupModel,
  GroupsPage,
  PERSONAL_API_KEYS_ADMIN_SECTION,
  PersonalApiKeysPage,
} from 'portal-mojo/admin/identity';
```

The registered routes are `/groups` and `/apikeys`; an embedded mount prefixes
both routes. Group directory and detail access use the system-pinned
`sys.groups | sys.view_groups` clause. Group mutations use
`sys.groups | sys.manage_groups`. Active-group membership cannot satisfy
these gates. The personal key section uses the system identity-view clause,
while its API requests remain scoped to the signed-in user's own keys.

## Groups

`GroupsPage` retains the native server-owned `ModelTable` search, filters,
presets, paging, sorting, column chooser, persistence and exports against
`GET /api/group`. Opening a row presents `GroupDetail` in `modal.detail`.
`GroupDetail` preserves the Overview, Identity, Members, Sub-Groups, API Keys,
Webhooks, Geofencing, Events, Audit and Metadata surfaces, with each section's
existing system permission gate and conditional queries. Parent, child, member
and user navigation opens native detail modals while keeping the directory
underneath.

The group model and section code are adapted from the reference portal at
`v0.2.5` commit `93c7fdfeb3096d33010e72bd4483cf9ca6e3d6f5`. The source hashes
and corresponding package hashes are recorded in
[`admin-identity-directories-sources.json`](admin-identity-directories-sources.json).
The moved implementation retains the package Apache-2.0 license. Two raw JSON
surfaces render their values directly in their explicit Metadata/Auth details;
they do not use collapsible content.

## Personal API Keys

`PersonalApiKeysPage` uses the existing `ApiKeyModel` at
`/api/account/api_keys` and the caller-only generation mutation at
`/api/auth/generate_api_key`. The generated token is shown once and scrubbed
before it can reach the query or mutation cache. Key facts and actions open in
a native detail modal. Disable/enable remains reversible with an undo toast;
revoke remains armed because it rotates the secret and cannot be undone. There
is no delete action. This page does not use the separate group credential
endpoint.

The Personal API Keys route was added to the package identity section registry
alongside Users, Members, Groups, Credentials and Sign-in. Compatibility page
paths in the reference app re-export the package-owned pages, and its menu and
route composition do not inject duplicate directory entries.
