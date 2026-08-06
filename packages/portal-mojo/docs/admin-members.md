# Admin Members

Reusable global membership administration for django-mojo. Import from
`portal-mojo/admin`:

```tsx
import {
  MembersPage,
  MemberDetail,
  GroupMembersPanel,
  MemberModel,
  MEMBERS_ADMIN_SECTION,
  openMemberAdmissionDialog,
  registerMemberPermissions,
} from 'portal-mojo/admin';
```

## Wire contract

`MemberModel` speaks `/api/group/member`. Its default row is:

```ts
{
  id, created, modified, is_active,
  permissions: Record<string, unknown>,
  metadata: { role?: string, ... },
  user: User | null,
  group: Group | null,
}
```

There is no top-level `role` or `status`: the presentation label is
`metadata.role`, and state is `is_active`. Relation columns are rendered but
not sortable. The model normalizes list state to verified parameters only:
search, paging, `id|created|modified|is_active` ordering, exact group/user and
active filters, `__icontains` lookups for user email/display name, group name
and role metadata, plus created/modified date ranges.

Supported mutations are collection create `{group,user}`, detail update, and
the `resend_invite` POST_SAVE_ACTION. Resend returns a payload (`{status:true}`),
not a refreshed member row. GroupMember declares neither delete nor generic
batch support, and has no move action. Remove and Move are intentionally absent:
a generic `{group:newId}` update is not a target-authorized move contract.

Audit rows filter `/api/logs` with `model_name=account.GroupMember` and the
membership `model_id`. `account.Member` is the obsolete web-mojo value.

## Admission and the no-oracle boundary

`openMemberAdmissionDialog` makes Invite and Add-existing separate choices.
Global Members selects a group first; `GroupMembersPanel` already has a fixed
group. Invite posts the supplied email directly to
`/api/group/member/invite`—it never probes `/api/user`. The confirmation is
the same whether the address is new, existing, or already associated.

Add-existing is deliberately directory-backed. It appears only when the
operator has both the Member create gate and the global user-directory gate;
only then does the `/api/user` picker run before collection POST.

## Permission tiers

Every global Admin clause is system-pinned:

- read: `sys.view_members | sys.view_groups | sys.manage_groups |
  sys.manage_group | sys.groups`
- save/create: `sys.manage_groups | sys.manage_group | sys.groups`
- invite: `sys.manage_users | sys.manage_members | sys.manage_group |
  sys.manage_groups`
- directory: `sys.view_users | sys.manage_users | sys.users`

Literal member `sys.*` keys always fail `memberHasPermission`, including a
malformed dictionary containing the exact requested key. User-level system
grants and superuser behavior in `hasPermission` are unchanged.

Three permission views must remain distinct:

1. Raw stored grants are the truthy keys in the JSON dictionary.
2. Effective member grants omit literal `sys.*`, stored `full_member`, and
   legacy `admin`; `member` is intrinsic and `full_member` is derived when
   `guest` is false.
3. User-level `sys.*` grants come only from the User permission dictionary.

The client retains the historical non-system member `admin` wildcard for
product portals, but django-mojo GroupMember does not honor it server-side.
Admin is labeled as client compatibility only and is never an editable grant.
`metadata.role` is also display-only and confers no authority.

## Extensible editable grants

The safe baseline includes ordinary group grants and the `guest` marker.
Products register additional controls:

```ts
registerMemberPermissions([
  { name: 'view_orders', label: 'View orders' },
  { name: 'manage_orders', label: 'Manage orders' },
]);
```

`sys.*`, `admin`, `member`, and `full_member` registrations are rejected.
Stored deployment-specific grants without a registered editor stay visible
and read-only rather than disappearing. Permission switches autosave through
`FormView`; a deployment's `MEMBER_PERMS_PROTECTION` remains authoritative,
and rejected changes revert with the server error shown.

## Composition

`MEMBERS_ADMIN_SECTION` is root-relative and dual-mounts as `/members` in the
standalone Admin and `/system/members` when embedded. It never consumes active
group context. `GroupMembersPanel` is the reusable Group-detail composition;
pass optional `onNavigateUser` and `onNavigateGroup` callbacks to connect
sibling identity details without coupling the package to an app.
