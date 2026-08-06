# Admin settings

`portal-mojo/admin` provides a real django-mojo runtime-settings administrator
for standalone and embedded portals. It replaces static settings-demo data with
the `/api/settings` model while keeping write-only values out of client caches.

## Routes and access

Register `SettingsPage` at the section index and `SettingDetailPage` at `:id`.
Both routes and the sidebar contribution require either `sys.manage_settings`
or `sys.groups`, mirroring `Setting.RestMeta` while ensuring active-group member
permissions cannot open a fleet-wide settings surface.

```tsx
{
  id: 'settings',
  title: 'Settings',
  icon: 'bi-gear',
  permissions: SETTINGS_PERMISSIONS,
  routes: [
    { path: '', component: SettingsPage, permissions: SETTINGS_PERMISSIONS },
    { path: ':id', component: SettingDetailPage, permissions: SETTINGS_PERMISSIONS },
  ],
}
```

`SettingsPage` searches only the key (the backend's sole `SEARCH_FIELDS`
entry), and offers server filters for `is_secret` and `group__isnull`. Keys are
immutable after creation. Operators with `sys.groups` may change scope, sending
a group id or explicit `null` for Global. A `sys.manage_settings`-only operator
sees the current scope read-only; the editor never mounts the group picker or
queries `/api/group`, and preserves that scope on save. New settings default to
Global. Delete is intentionally absent because live `Setting.RestMeta` does not
declare deletion.

## Atomic write contract

Use `saveSettingAtomic()` / `buildSettingPayload()` rather than a generic
autosave. django-mojo processes fields against the model's current secrecy
state in request insertion order. Create-secret remains `is_secret → value`.
An existing Plain→Secret transition must be `value → is_secret`, so the current
plain row still holds the replacement when the flag flips and the pre-save hook
encrypts it. Secret→Plain is the reverse: `is_secret → value`, so the explicit
replacement lands as plain text. Same-secret replacement sends only `value`.

Both transitions require an explicit replacement; a new secret or a
Plain→Secret transition requires a non-empty secret, while Secret→Plain may
explicitly replace it with an empty plain value. An unchanged secret with a
blank replacement omits `value`; an unchanged plain setting may intentionally
save an empty string. A no-op makes no request.

The custom save bypasses TanStack MutationCache because mutation variables
retain submitted bodies. Its response passes through `SettingModel` sanitation
before it may enter Query cache. For secret rows, the cache contains only the
masked `display_value`; the `value` property is removed. Success toasts are
generic and backend failures stay in the form; neither interpolates a submitted
value.

## Editor behavior

The replacement textarea is deliberately uncontrolled. Existing secret rows
seed it with an empty string—never `******`—and switching secret status clears
the control and marks it as needing an explicit replacement. Backend collision
and registered-key validation messages stay visible in the modal.

## Exports

```ts
import {
  SettingModel,
  SettingsPage,
  SettingDetail,
  SettingDetailPage,
  SETTINGS_PERMISSIONS,
  SETTINGS_ADMIN_SECTION,
  buildSettingPayload,
  saveSettingAtomic,
} from 'portal-mojo/admin';
```
