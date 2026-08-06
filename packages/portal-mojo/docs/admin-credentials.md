# Admin credentials

`portal-mojo/admin` ships the group API-key and webhook-subscription domain as
one reusable credential implementation. The same components back GroupDetail,
the standalone admin portal, and an embedded `/system` admin mount.

## Routes and access

The built-in `ADMIN_SECTIONS` contribution mounts these standalone routes:

- `/api-keys` — cross-group API keys
- `/webhook-subscriptions` — cross-group webhook subscriptions

Both the sidebar entries and generated React Router elements require
`sys.manage_groups` or `sys.groups`. `adminSectionRoutes()` applies the section
gate and the route gate independently, so a direct URL fails closed just like
the menu. Embedded portals pass a mount to both helpers:

```tsx
const routes = adminSectionRoutes(ADMIN_SECTIONS, { mount: '/system' });
const menu = adminSectionsMenu(ADMIN_SECTIONS, { mount: '/system' });
```

`AdminSection.basePath` defaults to the section id. A root-level section may
use `basePath: ''`; its labeled routes become visible child links rather than
claiming `/`. Prefixed sections receive an index redirect to the first route
the current operator can see.

## Group API keys

```tsx
import {
  GroupApiKeysSection,
  GroupApiKeysPage,
  registerGroupApiKeyPermissions,
} from 'portal-mojo/admin';

<GroupApiKeysSection group={{ id: 42, name: 'Acme' }} />
```

Creation uses `useCreateGroupApiKey()`, not the generic model save hook. The
backend create echo contains `{token, ...row}`; the hook splits it immediately,
writes only the safe row to TanStack Query, and passes the token through a
one-shot callback while the mutation is still pending. MutationCache resolves
with only the scrubbed row; the callback lifetime ends when the dialog closes.
A later operator reveal is a deliberate
`graph=token` request through `fetchApiKeyToken()`. django-mojo audits that graph
as `api_key:token_read`, and the response never enters Query cache.

All ordinary API-key lists force `graph=default`, discard URL/persisted
`graph` and unsupported search params before creating a query key, and scrub
token fields from every list/detail/save result before any cache write.

Create sends only permission controls whose value is `true`. Edit compares only
controls that were actually rendered and sends a partial permission dictionary;
unknown or protected grants are therefore preserved, while a visible changed
grant may send `false` to revoke it.

The permission catalog is live and injectable:

```ts
registerGroupApiKeyPermissions([
  { name: 'view_orders', label: 'View Orders' },
  {
    name: 'settle_orders',
    label: 'Settle Orders',
    grantPermissions: ['sys.manage_orders'],
  },
]);
```

Registration replaces the same permission name and appends new names. Mounted
editors subscribe to changes. `grantPermissions` gates the control itself; the
backend remains authoritative on every save.

## Webhooks

```tsx
import { WebhookSubscriptionsSection } from 'portal-mojo/admin';

<WebhookSubscriptionsSection group={{ id: 42, name: 'Acme' }} />
```

Webhook forms edit only `url`, `events`, and `is_active`. TagInput CSV values
pass through `normalizeWebhookEvents()` before save. Metadata is intentionally
absent: the default graph does not return it, so a generic edit form cannot seed
or safely preserve the object.

The signing secret belongs to the group, not one subscription. It is never
fetched on render because the reveal endpoint auto-mints on first use. Reveal
and confirmed rotation are explicit button actions.

## Styling contract

Credential components render the existing semantic `ga-*` classes and never
import an application stylesheet. A consuming portal or showcase must include
the `group-admin.css` semantic rules in its theme entry, as the repository's
`apps/portal/src/theme.css` and `apps/showcase/src/theme.css` do today.

## Personal keys are separate

The personal `/api/account/api_keys` page and `/api/auth/generate_api_key` flow
are intentionally unchanged. This package domain owns only group-scoped
`/api/group/apikey` credentials and `/api/group/webhook_subscriptions`.
