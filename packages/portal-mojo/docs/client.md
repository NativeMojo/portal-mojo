# client — the typed django-mojo protocol layer

```ts
import {
    mojoList, mojoGet, mojoSave, mojoDelete, mojoDownload, mojoMetrics,
    mojoCall, mojoQueryDefaults, usingMockTransport, apiOrigin,
    MojoError, AuthRequiredError,
} from 'portal-mojo/client';
```

## Transport

- `VITE_MOJO_API` unset → the in-memory mock answers every call
  (`npm run dev`). Set to a django-mojo origin → real backend
  (`npm run dev:live`, configured in `apps/portal/.env.live`).
- Every request carries `X-Mojo-UID` (device id) and, once `initAuth()` ran
  and a session exists, `Authorization: Bearer <jwt>`.
- CORS note (dev, cross-origin): every request shows an `OPTIONS` preflight
  twin in devtools. Not a duplicate fetch.

## Envelope — the ONE unwrap boundary

django-mojo wraps everything: `{status, data, …}`. `status: false` (or a
non-2xx with an envelope body) becomes a **thrown `MojoError(message,
status)`** carrying the server's real message. Nothing outside `client.ts`
parses envelopes; `mojoCall(path, {method, params, body})` is the typed
escape hatch for protocol modules and returns the unwrapped `Envelope`.

## Functions

| Fn | Wire | Returns |
|---|---|---|
| `mojoList<T>(endpoint, params)` | `GET endpoint?start&size&sort&search&<lookups>` | `{rows: T[], count, start, size}` |
| `mojoGet<T>(endpoint, id)` | `GET endpoint/<id>` | `T` |
| `mojoSave<T>(endpoint, id\|null, changes)` | `POST endpoint[/<id>]` | `T` (server-authoritative row). REJECTS on failure |
| `mojoDelete(endpoint, id)` | `DELETE endpoint/<id>` | `void` — server answers `{status:"deleted"}` (string; deliberate) |
| `mojoDownload(endpoint, params, 'csv'\|'json')` | `GET endpoint?download_format&filename&<filters>` (start/size stripped) | triggers a browser download of the WHOLE filtered set |
| `mojoMetrics(params)` | `GET /api/metrics/fetch?slugs&range&granularity` | `{labels, datasets:[{label: slug, data}]}` — normalized from the wire's `{data:{slug: number[]}, labels}` |

Wire facts (measured against live django-mojo): list sort is `'-field'`
desc; filters are Django lookups (`field`, `field__in=a,b`,
`field__icontains`, `field__gte`, `field__isnull=true`); the daterange
triple is `dr_field/dr_start/dr_end`; datetimes serialize as epoch seconds;
unknown params are silently ignored by the server.

The executable mock coerces comparisons narrowly: both operands must be
fully numeric for numeric comparison; temporal comparison only recognizes
canonical `YYYY[-MM[-DD]]` or full ISO datetime shapes; everything else is
text. This keeps numeric IDs (`10 > 2`) and `User.dob` DateFields correct
without turning arbitrary date-looking labels into timestamps. The showcase
Filters demo exercises both `dob__gte=YYYY-MM-DD` and epoch-backed `dr_*`.

Mock-only contract controls are exported in development: call
`armMockReauth(method, path)` to make one authenticated method+path match
answer 440. Ordinary requests and real transports are unaffected.

## Mock admin contracts

The mock carries measured GroupView/admin transports, not UI-shaped
shortcuts:

- group API keys use `/api/group/apikey`; ordinary/default rows omit the raw
  token, create returns it, and only explicit `graph=token` reads it later;
- webhook subscriptions validate HTTPS URLs, reject URL credentials, and
  keep metadata detail-only; `/api/group/webhook_secret` is the deliberate
  read/rotate secret endpoint;
- member invites stamp the requested group and member edits preserve the
  backend permission-dict behavior; group incident rows filter through
  `/api/incident/event?group_id=`;
- `/api/auth/config` resolves defaults → deployment → root → child, replaces
  lists, preserves nested dict keys, ignores unknown/inactive UUIDs, and
  returns only the public whitelist;
- settings keep plaintext for secret rows in a private mock slot, while every
  wire response carries `value:''` + `display_value:'******'`. Payload order
  deliberately mirrors live `set_value`: serialize `is_secret` before
  `value`. Non-null group scopes enforce `(key, group)` uniqueness; repeated
  global `(key, null)` rows remain possible because PostgreSQL NULL uniqueness
  does. REST delete is denied;
- metrics permissions are top-level `/api/metrics/permissions` responses, not
  model envelopes. Single permission reads may be strings, multiple are
  lists, and cleared values read as null. Clearing/deleting retains the
  account row in the list, matching the separate Redis account index.

Stable mock permission identities (password `mojo`) make gates reproducible:
`ian@mojoverify.com` is only an odd-group admin;
`security.viewer@nativemojo.com` has global security/geofence view;
`security.manager@nativemojo.com` has security/geofence/settings/metrics
management; `groups.manager@nativemojo.com` has global groups/users
management. `/api/geo/check?__mock_country=CN` is the deterministic public
deny case; the default US case allows.

The record-feed mock follows the shared Django feed shape rather than a
component-specific adapter. `/api/incident/ticket/note` and
`/api/incident/incident/history` return the newest 100 rows, support parent
and group filtering, and explicitly use `graph=default`. Posts reject unknown
parents, inherit the parent's group, stamp the authenticated user, embed that
user in the response, and keep `media` null.

Bouncer operator data is available to the stable global security identities:
signals and devices provide seeded list/detail graphs, while bot signatures
exercise create, update, uniqueness validation, and delete. The security
viewer is read-only; the security manager can mutate supported resources.
Signal detail deliberately omits `token_nonce`: it is neither needed by the
admin portal nor safe to type, store, or cache as operator-facing data. Block
and monitor decisions are also seeded into the incident-event feed.

## `mojoQueryDefaults()`

Spread into the app's `QueryClient` defaults. Provides: no retry on 4xx
`MojoError`s (deterministic failures), `networkMode: 'always'` under the
mock ('online' live), and `refetchOnWindowFocus: false` (freshness comes
from explicit refresh + opt-in autoRefresh — focus storms read as phantom
fetches).

## Errors

- `MojoError{message, status}` — server-reported failure; `message` is the
  server's text (show it verbatim in toasts).
- `AuthRequiredError` — thrown by the pre-request gate when a request needs
  a session that doesn't exist (synthetic 401; no network was touched).
