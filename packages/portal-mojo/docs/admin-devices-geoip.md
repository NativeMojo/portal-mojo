# Admin: devices, login locations & GeoIP

```ts
import {
    // sections (registered in ADMIN_SECTIONS — no app wiring needed)
    DEVICE_INTEL_ADMIN_SECTION, GEOIP_ADMIN_SECTION,
    // pages
    UserDevicesPage, LoginLocationsPage, GeoIpCachePage,
    // the map binding
    LoginLocationMap,
    // KISS detail modals (#1425)
    showUserDeviceDetail, showUserDeviceDetailByDuid,
    showUserDeviceLocationDetail, showLoginEventDetail,
    showGeoIpDossier, showGeoIpDossierForAddress,
    // models — ONE defineModel per endpoint, package-wide
    UserDeviceModel, UserDeviceLocationModel, LoginEventModel, GeoLocatedIPModel,
    // permission clauses
    USER_DEVICE_VIEW_PERMS, DEVICE_LOCATION_VIEW_PERMS,
    LOGIN_EVENT_VIEW_PERMS, LOGIN_SUMMARY_PERMS,
    GEOIP_VIEW_PERMS, GEOIP_MANAGE_PERMS,
    // enforcement + presentation helpers
    blockActive, whitelistActive, blockExpired, whitelistExpired,
    threatTone, riskScoreOf, countryFlag, THREAT_LEVEL_ORDER,
    loginRiskTone, LOGIN_RISK_LEGEND,
    deviceIcon, browserLabel, osLabel, deviceLabel, daysActive, presenceOf,
    // data hooks
    useLoginLocationSummary, useLoginLocationList,
    useUserDeviceSessions, useDeviceSiblings,
    useGeoIpByAddress, useGeoIpRawRecord, lookupGeoIp,
    geoIpSafeExporter, sanitizeGeoIpRow,
} from 'portal-mojo/admin';
```

Account-security triage: who logged in from a new country, what is this IP,
and is this device shared across accounts. Demo: showcase → Admin →
**Devices, logins & GeoIP**. Styles:
`apps/{portal,showcase}/src/theme/admin-devices.css` (byte-identical).

## Sections

Two siblings under the **Security** navigation group, beside Bouncer — so the
PRE-auth (`BouncerDevice.muid`) and POST-auth (`UserDevice.muid`) views of the
same physical browser sit next to each other.

| Section | id / basePath | Routes |
|---|---|---|
| Devices & Logins | `device-intel` / `security/devices` | `user-devices` · `login-locations` |
| IP Intelligence | `geoip` / `security/geoip` | `cache` |

All three surfaces are fleet-wide and **groupless** — `GeoLocatedIP` has no
group FK at all, and the device/login lists are only global with a `sys.`
grant. The *user-scoped* views stay inside `UserDetail`'s Devices and Logins
sections, which this module extends rather than forks.

`#1287`'s network-security pages (Blocked IPs, firewall log, IP sets,
geofencing) live in their OWN section at `security/network`; this module
reserves no space for them and exposes no extension seam. It does export
everything they import.

## Permissions

Every clause is `sys.`-pinned, so an active-member grant can never satisfy it.
A permission-disabled query passes `enabled: false` — a denied surface issues
**no** request.

| Constant | Value | Backend source |
|---|---|---|
| `USER_DEVICE_VIEW_PERMS` | `sys.manage_users`, `sys.users` | `UserDevice.VIEW_PERMS` minus `owner` |
| `DEVICE_LOCATION_VIEW_PERMS` | `sys.manage_users`, `sys.users` | URL decorator ∩ `UserDeviceLocation.VIEW_PERMS` |
| `LOGIN_EVENT_VIEW_PERMS` | `sys.manage_users`, `sys.security`, `sys.users` | `UserLoginEvent.VIEW_PERMS` minus `owner` |
| `LOGIN_SUMMARY_PERMS` | `sys.manage_users`, `sys.security`, `sys.users` | `@requires_global_perms` on `/summary` + `/user` |
| `GEOIP_VIEW_PERMS` | `sys.manage_users`, `sys.view_security`, `sys.manage_security`, `sys.security`, `sys.users` | `GeoLocatedIP.VIEW_PERMS` |
| `GEOIP_MANAGE_PERMS` | `sys.manage_users`, `sys.manage_security`, `sys.security` | `GeoLocatedIP.SAVE_PERMS` |

**`sys.manage_devices` is deliberately absent everywhere.** It passes the
`@requires_global_perms` decorator on `/user/device/location` and
`/user/device/lookup`, then fails the *model's* `VIEW_PERMS`
(`manage_users | users`). Alone it opens nothing, so offering it as an
affordance would promise access the server refuses.

`UserDevice` and `UserLoginEvent` both carry `owner` in `VIEW_PERMS`: without
a global grant those endpoints return only the caller's own rows. The admin
pages are gated so that is never what an operator sees; the mock reproduces it
so the verifier can assert it.

## Endpoints

| Endpoint | Gate | Notes |
|---|---|---|
| `GET /api/user/device` `(+/<pk>)` | model `VIEW_PERMS` incl. `owner` | graphs `default` · `basic` · `locations` · `sessions` |
| `GET /api/user/device/lookup?duid=` | `@requires_global_perms(manage_users, manage_devices, users)` | cross-tenant; `on_rest_get` does not re-gate |
| `GET /api/user/device/location` `(+/<pk>)` | URL decorator **and** model `VIEW_PERMS` | |
| `GET /api/account/logins` `(+/<pk>)` | model `VIEW_PERMS` incl. `owner` | `CAN_CREATE/UPDATE/DELETE` all False |
| `GET /api/account/logins/summary` | `@requires_global_perms(manage_users, security, users)` | country aggregation |
| `GET /api/account/logins/user?user_id=` | same, `@requires_params('user_id')` | per-user aggregation |
| `GET /api/system/geoip` `(+/<pk>)` | `GeoLocatedIP.VIEW_PERMS` / `SAVE_PERMS` | graphs `default` · `basic` · `detailed` · `federation` |
| `GET /api/system/geoip/lookup?ip=` | `@requires_auth()` only, rate-limited 30/ip | see the graph downgrade below |

**No model here declares `CAN_DELETE`,** and `rest.py` defaults it to False.
There is no delete path for a device, a device location, a login event or a
GeoIP record — the source's "Forget device", "Delete record" and "Delete
Location Record" items could never have worked.

## Model field shapes

`UserDeviceRow` is the `default` graph. It has **no** `is_trusted` and **no**
`is_blocked` — web-mojo's active toggle, "Mark trusted/untrusted" kebab item,
Trusted/Blocked chips and trust timeline row all wrote a field the model never
had.

`UserDeviceSessionsRow` is the `sessions` graph, keyed separately in the query
cache (`[endpoint, 'one', id, {graph:'sessions'}]`) so a sparse `default` row
cannot satisfy it. Its three `extra` properties are real:

- `bouncer_device` — the pre-auth `BouncerDevice` for this `muid`.
- `active_sessions[]` — 24h of `BouncerSignal` grouped by `msid`, each with a
  per-`mtab` breakdown.
- `recent_locations[]` — the last ten `UserDeviceLocation` rows, flattened.

`LoginEventRow` has **no** `event_type`. `GeoLocatedIPRow` has **no**
`reverse_dns`, **no** `ip_version` and **no** `metadata`, and its `provider`
and `data` fields are excluded from the `default` graph.

## `LoginLocationMap`

```tsx
<LoginLocationMap
    userId={user.id}          // scoped → /account/logins/user; omit → /summary
    height={360}
    drStart="2026-07-07" drEnd="2026-08-06"   // YYYY-MM-DD, see the two wires
    defaultMode="summary"     // 'summary' | 'list'
    showModeToggle
    enabled={can}             // false ⇒ no request at all
    onCountrySelect={(cc) => …}
    onOpenLogin={(id) => …}
    onOpenUser={(id) => …}    // list mode, global scope only
/>
```

Rendering belongs entirely to [`WorldMap`](worldmap.md) (#1426). One import
line — `from 'portal-mojo/charts'` — is the whole coupling surface, so
reconciling with the map component touches exactly one file. No projection,
SVG, marker geometry or colour ramp lives here.

- **Summary mode** — one sized marker per country, or per region after a
  drill-down. Position comes from `COUNTRY_CENTROIDS` first and the server's
  `Avg(latitude)`/`Avg(longitude)` only as a fallback: for a country spanning
  the antimeridian that average lands in the wrong ocean. Region rows have no
  centroid and always use the average.
- **List mode** — one dot per login, bounded at 500, coloured by
  `loginRiskTone(row)`.
- **Drill-down** is *double-click*, on country markers, in summary mode only.
  A single click fires `onCountrySelect` after WorldMap's 250 ms
  double-click-cancellation window — that quarter-second delay is by design.
- **No coastline geometry is passed.** `land` is deliberately omitted, so the
  map draws WorldMap's ocean + graticule fallback; the markers, legend,
  tooltips, drill bar and status line carry the whole story either way. If the
  repo owner later adopts geometry, it rides `WorldMap`'s `land` prop at the
  app level, not a per-surface one.

### `loginRiskTone` vs `loginEventTone`

`portal-mojo/charts` exports `loginEventTone(eventType)`, which maps the login
event-type vocabulary (`success_login`, `failed_login`, `suspicious`, …).
**`UserLoginEvent` has never had an `event_type` field**, so feeding it a real
row returns `'mute'` for every marker — exactly the web-mojo bug where every
dot rendered grey.

`loginRiskTone(row)` is this module's replacement and reads fields the wire
actually sends: `is_new_country` → `bad`, `is_new_region` → `warn`, otherwise
`ok`. Both are kept: the charts helper remains correct for any future series
that really does carry an event type.

## The two different date wires

They are not interchangeable, and mixing them silently returns everything.

| Endpoint | Wire | Format |
|---|---|---|
| `/api/account/logins` (list) | `dr_field` + `dr_start` + `dr_end` | always name `dr_field` explicitly |
| `/summary` and `/user` | `dr_start` + `dr_end` only | `YYYY-MM-DD`, parsed by `dates.parse` |

## Backend traps encoded here

- **`region=false` is truthy.** `login_event.py` reads
  `request.DATA.get('region')` with no string coercion, so the *string*
  `"false"` drills. `region=1` is sent only while drilling, never `region=false`.
- **`user_id` must parse as an int** on `/logins/user`, or the endpoint
  answers `{status: false, code: 400}`.
- **`country_code` must match `^[A-Z]{2,3}$`** uppercase or it is silently
  ignored — an invalid code falls back to the country branch rather than erroring.
- **The region drill caps at 500 rows** (`MAX_REGION_RESULTS`).
- **`/summary` excludes null and empty `country_code`,** and private-range
  logins carry no coordinates — so those logins are invisible on the map *by
  construction*. The status line says so; the Logins tab is where they appear.
- **The embedded `user_device` graph is `basic` and carries no `id`.**
  Cross-links from a location or login row resolve the device by `duid`
  (`showUserDeviceDetailByDuid`).
- **`_param_is_true`**: query params arrive verbatim, so `auto_refresh=false`
  would be truthy read naively. `lookupGeoIp` sends `1`/`0`.

## Enforcement expiry is STATE

`GeoLocatedIP` exposes `block_active` and `whitelist_active` as Python
properties, but they are serialized only on the `basic` graph — the `default`
graph carries the raw booleans. `blockActive(row)` / `whitelistActive(row)`
mirror the model exactly:

- a whitelist **wins** over a block;
- a `blocked_until` in the past means **not blocked**;
- a `whitelisted_until` in the past means **not whitelisted**.

`blockExpired` / `whitelistExpired` surface the lapsed-but-still-flagged state
as its own badge. web-mojo rendered raw `is_blocked`, so an expired block
still read "Blocked" and a whitelisted-but-flagged IP read blocked when it was
not.

`block()` on the backend always escalates `threat_level` to at least `high`
and increments `block_count`; whitelisting clears an active block. The UI
re-reads the row from the action response rather than optimistically toggling,
because the backend block is idempotent and race-safe.

## Scrubbing rules

1. **The raw provider blob never enters the Query cache.** `sanitizeGeoIpRow`
   deletes `data` before any list/detail/save write and runs the shared
   `sanitizeSecurityValue` over the rest.
2. **The only reader of `graph=detailed`** is `useGeoIpRawRecord` — an
   explicit, `GEOIP_MANAGE_PERMS`-gated, `gcTime: 0` / `staleTime: 0` fetch
   whose payload is sanitized and length-bounded before it is returned. It is
   behind a "Show raw provider record" reveal that is collapsed by default.
3. **Exports go through `geoIpSafeExporter`** (`createSafeExporter`) with a
   declared field projection, so a crafted `graph` param cannot smuggle
   `data` or `provider` into a CSV.
4. **Inspecting an IP costs no provider call.** `showGeoIpDossierForAddress`
   resolves through `?ip_address=` on the cache list — read-only, unmetered.
   `/system/geoip/lookup` CREATES and REFRESHES records and is rate-limited
   30/ip, so it runs only on the explicit "Look up IP" action; a 429 surfaces
   as a toast, never a silent no-op.
5. **`/geoip/lookup` downgrades the graph, not the access.** The endpoint is
   open to any authenticated identity (that is how a downstream instance uses
   this one as its GeoIP provider), but a caller without `VIEW_PERMS` is
   served the `federation` graph whatever it asked for — no enforcement state,
   no raw blob.

## Absent by design

Do not add these back; each was verified against the backend.

- The **trust toggle** and "Mark trusted/untrusted" — `is_trusted` does not exist.
- **"Forget device"**, "Delete GeoIP record", "Delete location record" — no
  `CAN_DELETE` anywhere.
- Any **write** to a login event — `CAN_CREATE/UPDATE/DELETE` are all False.
- The six phantom KPI fields (`event_count`, `incident_count`,
  `login_attempts`, `login_count`, `session_count`, `location_count`), which
  existed on no model and rendered "—" forever. They are replaced with
  `size: 0` count queries against endpoints that do exist.
- The `reverse_dns` / `ip_version` Network rows and the `provider` row on the
  default graph — all three were permanently blank.
- A `user` **select** filter on either table: neither endpoint can enumerate
  the directory, so the filter is the FK id.
- A search placeholder promising user or IP search on `/api/user/device` —
  that model declares no `SEARCH_FIELDS` at all.

## Verification

```bash
node scripts/verify-admin-devices.mjs   # or: npm run verify:admin-devices
```

Headless assertions over the six permission clauses (`sys.`-pinning,
member-grant rejection, `manage_devices` absence), route generation for both
mounts, expiry semantics, the risk tone, the scrubber and the export
projection, one-`defineModel`-per-endpoint package-wide, the absent-by-design
list, theme byte-identity and tokens-only CSS, and the full mock wire:
owner scoping, anonymous denial, all four GeoIP graphs, the `/lookup` graph
downgrade, every POST_SAVE_ACTION, the verb refusals, the aggregation shape,
the region drill, the 500 cap, the `user_id` 400 and the `region=false` trap.
