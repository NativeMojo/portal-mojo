# Admin Users

Reusable global User administration for django-mojo. Consumers must include
the semantic `user-admin.css` stylesheet used by the portal and showcase.

```tsx
import {
  UsersPage, UserDetail, UserModel, ApiKeyModel,
  USERS_ADMIN_SECTION, USER_VIEW_PERMISSIONS, USER_MANAGE_PERMISSIONS,
} from 'portal-mojo/admin';
```

`USERS_ADMIN_SECTION` is root-relative: `/users` in standalone Admin and
`/system/users` when embedded. Both the section and route are system-pinned:
view requires `sys.users | sys.view_users | sys.manage_users`; mutations
require `sys.users | sys.manage_users`. Active-group membership never satisfies
either clause, and Admin remains a no-group workspace.

## Table and detail inventory

`UsersPage` keeps server-owned URL params, search, filters, presets, sorting,
paging, chooser, persistence, export, expansion, recency grouping, selection,
create, and state-aware batch disable/reactivate. Disable collects one required
reason per batch; rows already in the target state are ineligible.

The detail preserves all 14 sections: Overview, Profile, Personal, Security,
OAuth, Groups, Sys Perms, conditional App Perms, API Keys, Devices, Logins,
Audit, Notifications, and Metadata. Subsidiary count/list queries are enabled
only when their exact system permission is present. Logs use
`sys.view_logs | sys.manage_logs | sys.security`; incident events use
`sys.view_security | sys.security`. Permission revocation therefore removes
the section and prevents background requests.

Pass `onOpenGroup(groupId)` to `UsersPage` or `UserDetail` to connect an
app-owned Group detail. Without it, organization and membership identities are
plain text—never false links.

**Logins ships a Map tab (#1291, shipped).** The section is `Map | Logins`;
the Map renders `<LoginLocationMap userId={user.id} height={280} />` over
`/api/account/logins/user?user_id=`, and it is present only when
`useCan(LOGIN_SUMMARY_PERMS)` passes — absent, it issues no request at all.
Login rows are clickable and open `showLoginEventDetail`. The dead
`loginTone(event_type)` map is gone: `UserLoginEvent` has never had an
`event_type` field, so every dot rendered muted. Tone now comes from
`loginRiskTone(row)` (`is_new_country` / `is_new_region`). Device rows are
clickable too and open the full device dossier. See
[admin-devices-geoip.md](admin-devices-geoip.md).

The device / device-location / login-event models are DEFINED in
`admin/security/devices/models.ts` and re-exported here — one `defineModel`
per endpoint, so `UserDetail` and the fleet-wide tables share one cache.

## Action contracts

- Username changes use the `change_username` POST_SAVE_ACTION, not a direct
  field save. Model saves/actions retry one fresh-auth 440 automatically;
  combined `disable_totp` writes explicitly use `withFreshAuth`.
- Send invite, password reset, magic link, and verification email controls all
  require the User mutation tier even though public send responses
  anti-enumerate recipients.
- Disable rejects inactive users; reactivate rejects active users. There is no
  inactivity-warning reset action for an active account.
- API-key inventory/revoke uses `/api/account/api_keys`. Generation appears
  only for the signed-in caller and calls `/api/auth/generate_api_key`.
  `/api/auth/manage/generate_api_key` does not exist.
- Key generation splits the raw token inside the pending mutation, invokes a
  transient reveal callback, deletes `token`, `jti`, `auth_key`, and secret
  aliases, and resolves MutationCache with non-secret receipt metadata only.
- Notification preferences are interactive only for the signed-in caller;
  django-mojo ignores a target `user` parameter. Other-user details render an
  explicit unavailable state and make no request.

## Known seams

Avatar clear is supported; upload awaits multipart/fileman support. The login
map and the richer device/GeoIP dossiers SHIPPED with #1291 and are documented
in [admin-devices-geoip.md](admin-devices-geoip.md). Arbitrary-user key
creation, arbitrary-user notification administration, and active-user
inactivity-warning clear require new backend contracts and are intentionally
absent.
