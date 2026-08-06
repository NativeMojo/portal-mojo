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
