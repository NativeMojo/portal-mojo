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
status, errorCode, data)`** carrying the server's real message, numeric HTTP
status, semantic `error_code`, and structured safe failure evidence. Nothing outside `client.ts`
parses envelopes; `mojoCall(path, {method, params, body})` is the typed
escape hatch for protocol modules and returns the unwrapped `Envelope`.

Live non-2xx responses and mock `status:false` envelopes preserve the same
shape. Modern envelopes use numeric top-level `code` plus a string semantic
`error_code`; numeric legacy `error_code` remains a status fallback. Failed
envelopes always reject. Structured `data` can contain deliberately safe
recovery evidence, but callers must still avoid logging it indiscriminately.

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
exercise create, update, uniqueness validation, and enable/disable; DELETE
matches the live endpoint's denial. The security
viewer is read-only; the security manager can mutate supported resources.
Signal detail deliberately omits `token_nonce`: it is neither needed by the
admin portal nor safe to type, store, or cache as operator-facing data. Block
and monitor decisions are also seeded into the incident-event feed. The
read-only `/api/incident/incident` mock follows the real reporter contract:
Bouncer device investigations filter the security category and search the
incident details for the device MUID, without invented model linkage.

The mock-only component showcase signs in as
`showcase.operator@nativemojo.com`, an explicit broad demo identity. The
narrow `security.viewer`, `security.manager`, `groups.manager`, and Ian
fixtures remain unchanged for permission-boundary verification.

Communications mock parity includes `/api/aws/email/{domain,mailbox,sent,template,send}`
and `/api/account/public_message`. Credential plaintext is reduced to masks
and discarded, managed onboarding writes through the registered DNS adapter,
audit persists domain status, send may return a 2xx `failed` row, and mailbox
and domain deletes reproduce local audit cascades. Stable email/support
operator identities are listed in [admin-messaging.md](admin-messaging.md).

DNSMan's mock contract is central-state-backed and capability-first. Stable
identities `dns.viewer@nativemojo.com`, `dns.manager@nativemojo.com`, the
group-1-only member `dns.tenant@nativemojo.com`, and the house-only superuser
`dns.platform@nativemojo.com` (password `mojo`) exercise the exact global
view/manage, tenant, and platform split. Credential
assignment searches only `/api/dnsman/credential/group-choice`; an exact
selection hydrates with `?id=…`, and inactive or over-depth groups never
appear. First-link verification failure creates no row. Failed rotation marks
the existing row unverified while retaining its old masks. Successful raw
keys are used only by the imperative call and are never stored in mock state
or returned. Registrar confirmation tokens, legal-contact PII, WHOIS PII, and
certificate material likewise stay outside model/query state.

## Imperative file uploads

`startFileUpload(file, options?)` implements django-mojo's three stages:
initiate the File, transfer bytes to the returned capability, then reconcile
and mark the File completed. It returns a `FileUploadTask` immediately; its
`result` always resolves to a fixed `completed`, `failed`, or `uncertain`
outcome.

```ts
const task = startFileUpload(file, { fileManagerId: 12, groupId: 4, use: 'attachments' });
const unsubscribe = task.subscribe(({ phase, loadedBytes, totalBytes }) => {
    console.log(phase, loadedBytes, totalBytes);
});
const outcome = await task.result;
unsubscribe();
```

Progress is the count reported by the actual byte transport. Multipart POST
progress therefore includes wire overhead. Provider fields are appended
before `file`, and the browser owns the multipart boundary. The #1485 response
keeps `upload_url`, `method`, `fields`, and `headers` flat beside the safe File
lifecycle fields. PUT and POST are supported only. The server-echoed MIME type
governs the byte request.
Root-relative direct-upload paths missing the deployment's `/api` prefix are
repaired before transfer. API Bearer and DUID headers are never forwarded;
an unsafe backend-provided Bearer transfer header produces only a fixed safe
outcome.

Snapshots and outcomes never contain capability URLs, provider fields or
headers, API bearer/DUID values, raw response bodies, or File URLs. A completed
outcome exposes only an `UploadedFileRef`: authoritative id, name, MIME, size,
category, manager id, and group id.

Every task generates one private strict `idempotency_key`. `cancel()` aborts
current work. Even an initiation abort is `uncertain` with a
nullable File id: the server may have committed before the response became
observable. `recover()` cannot act without an id and returns the same outcome;
calling `retry()` replays the same key so a committed-but-lost initiation
returns the same File. Cancellation after a known initiation, dropped provider responses,
and ambiguous completion responses are likewise `uncertain`, since remote
bytes or a completed File may already exist. `recover()` reconciles and
attempts completion without replaying bytes. `retry()` reconciles first and
replays the retained private capability only while the File is still
uploading. If reconciliation proves failed/expired, that same Retry rotates to
a fresh key and attempt; completed replays need no target. Both are single-flight and generation guarded. A successful
completion POST is never authoritative by itself; a following File GET must
confirm `completed` before the task returns success. Completed scalar
`file_manager_id` and `group_id` must match an explicitly selected destination.

## `mojoQueryDefaults()`

Spread into the app's `QueryClient` defaults. Provides: no retry on 4xx
`MojoError`s (deterministic failures), `networkMode: 'always'` under the
mock ('online' live), and `refetchOnWindowFocus: false` (freshness comes
from explicit refresh + opt-in autoRefresh — focus storms read as phantom
fetches).

## Errors

- `MojoError{message, status, errorCode, data}` — server-reported failure;
  `message` is the server's text, `status` is numeric, `errorCode` preserves
  the semantic wire code, and `data` preserves safe structured evidence.
- `AuthRequiredError` — thrown by the pre-request gate when a request needs
  a session that doesn't exist (synthetic 401; no network was touched).
