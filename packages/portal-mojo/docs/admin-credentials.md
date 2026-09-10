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
  ApiKeyLimitsSummary,
  ApiKeyRateLimitsEditor,
  GroupApiKeysSection,
  GroupApiKeysPage,
  buildApiKeyLimitPatch,
  readApiKeyRateLimits,
  registerGroupApiKeyPermissions,
} from 'portal-mojo/admin';

<GroupApiKeysSection group={{ id: 42, name: 'Acme' }} />
```

Both fixed-group credential sections accept an optional permission override:

```tsx
<GroupApiKeysSection group={group} permission={GLOBAL_CREDENTIAL_PERMS} />
<WebhookSubscriptionsSection group={group} permission={GLOBAL_CREDENTIAL_PERMS} />
```

Omitting `permission` preserves group-portal behavior through
`GROUP_CREDENTIAL_PERMS`. The app-local global Group Admin passes the
system-pinned `GLOBAL_CREDENTIAL_PERMS`; the wrapper checks that clause before
mounting its list, so denied operators issue no credential background query.

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

The guided forms include `send_sms` and the broader `comms` permission. Create
and edit also expose **Additional permission names** as freeform tags, so a
new backend permission does not require a portal release before a key can use
it. Create sends only true guided controls and named tags. Edit diffs only
controls that were actually rendered, adds newly named tags, and sends `false`
for removed custom tags. Hidden protected grants are preserved unless an
operator deliberately enters their name; django-mojo remains authoritative
for every grant and revocation.

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

`normalizeApiKeyPermissionNames()` trims and deduplicates TagInput CSV (or an
array) and rejects the reserved `__replace` JSON update signal.
`buildApiKeyPermissionChanges()` constructs the narrow merge patch used by the
edit form without resending unchanged custom grants.

### Rate-limit overrides

Group API keys expose the raw django-mojo JSONField shape without normalizing
endpoint identity:

```ts
const limits = {
  orders: { limit: 500, window: 5, extension_owned: { burst: 20 } },
};

const state = readApiKeyRateLimits(limits);
const patch = buildApiKeyLimitPatch(
  'orders',
  { limit: 750, window: 10 },
  limits.orders, // preserves extension_owned and every other nested sibling
);
```

`limit` and `window` are positive integers with no fixed maximum. `window` is
always measured in **minutes** in `ApiKey.limits`; django-mojo converts it to
seconds at enforcement time. `ApiKeyLimitsSummary` is the bounded card/table
presentation. `ApiKeyRateLimitsEditor` is the controlled detail editor and
keeps saves on the rejecting `GroupApiKeyModel.useSave()` path.

This UI depends on django-mojo 1.20.0 / item 3105. A genuinely empty object is
shown as **Unlimited (default)** because ordinary API-key throughput has no
built-in hard ceiling. Strict endpoint limits, a positive decorator fallback,
or an enabled deployment ceiling may still apply. When safe overrides exist,
unlisted ordinary endpoint buckets remain unlimited. Any malformed top-level
or nested value shows **Review required** instead of either safe claim.

Add trims the new endpoint name and rejects blank, duplicate, and reserved
`__replace` names. Edit keeps the stored endpoint identity immutable. Clear
sends one narrow null tombstone, for example `{limits: {orders: null}}`; the
authoritative complete row returned by django-mojo replaces Query state while
every unrelated endpoint remains intact.

Legacy data is lossless:

- empty and whitespace-only keys are quoted distinctly and clear only by their
  exact raw key;
- scalar entries may be cleared but not edited as structured limits;
- partial object entries may be repaired, preserving extra nested siblings. A
  positive limit with no `window` currently uses the endpoint decorator's
  default window; other malformed/non-positive entries fail open;
- valid entries with extra siblings retain them on edit;
- a stored `__replace` root key is read-only. django-mojo consumes that name as
  a JSON replacement signal, so generic edit/clear controls would be dishonest;
  repair the full stored value outside this editor.

Mutation controls are fail-closed behind the supplied `PermSpec`. The global
detail uses `GLOBAL_CREDENTIAL_PERMS`; embedded group surfaces default to
`GROUP_CREDENTIAL_PERMS`. Denied viewers receive no mutation controls or extra
credential queries. Limit mutations never request the token graph and retain
the existing pre-cache token scrubber.

Pitfalls: do not clone the raw object into a typed-only map, trim an existing
key, send `__replace`, label malformed data unlimited, measure windows in
seconds, or replace the full JSONField to clear one endpoint.

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

## Modal lifecycle convention

See [Admin modal policy](admin-modals.md) for header actions, content-only
sections, supported lifecycle fields and retained irreversible exceptions.
Group API keys and webhook subscriptions deactivate/reactivate; their built-in
Delete controls are removed. Reveal, secret rotation and cache boundaries remain.
