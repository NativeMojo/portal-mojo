# GeoLocation provider setup

`GeoLocationPage` is the global Operations → GeoLocation setup surface. It is
separate from GeoIP Cache (IP inspection) and Fleet Configuration (application
and node health). A literal `is_superuser === true` and current authenticated
session are required before mounting any setup reader. Global `admin`, settings
grants, group membership and API keys do not substitute. The backend additionally
rejects key-backed sessions and requires active interactive superuser authority,
same-origin POSTs, and authentication within 600 seconds.

```tsx
import { GeoLocationPage } from 'portal-mojo/admin/operations';
// mount-relative section; an embedded host may prefix /custom/system
const section = {
  id: 'geolocation', title: 'GeoLocation', icon: 'bi-geo-alt',
  navigationGroup: 'operations', permissions: [],
  routes: [{ path: '', requireSuperuser: true,
    loadComponent: () => import('./geolocation/GeoLocationPage')
      .then(({ GeoLocationPage }) => ({ default: GeoLocationPage })) }],
};
```

Main setup shows primary provider, Mojo HTTPS origin and write-only Mojo key.
Advanced holds fallback, ordered additional providers (add/remove/up/down), and
threat-signal sharing. Labels, descriptions and constraints come from the
server's explicit five-key descriptor layout. Unknown configured provider IDs
remain selectable; an empty registry never invents or drops values. All five
static settings are submitted even when Advanced is collapsed.

`readGeoLocation()` reads `/api/account/admin/settings`, requires catalog
`schema_version:1`, and positively projects only `provider_setup` GeoIP fields.
Catalog settings, SMS, unknown keys and raw credentials are discarded. Local
imperative state holds this small private form; the page adds no Query or
Mutation cache entries. Session changes remount and abort the form using the
existing `usePrivateOperator` fence. Final authority is rechecked after auth
gating and before sending. Late responses cannot restore a former session.

`buildGeoPayload(action, configuration_revision, draft, keyEdit)` sends exactly
`{action,topic:'geoip',providers:{expected_revision,geoip}}`. The revision is
included even when null. The GeoIP section includes the five static values and
only one optional credential action: untouched omits credential fields; nonempty
replacement adds `GEOIP_API_KEY_MOJO`; confirmed removal adds
`clear_api_key:true`. Blank replacement preserves the existing key. Removal has a
native confirmation and a separate Save; it never presents as a successful
connection test. Additional providers are unique, ordered, and bounded to 16;
provider identifiers follow `^[a-z][a-z0-9_-]{0,31}$`. Origins must be HTTPS,
at most 512 characters, no credentials/path/query/fragment and port absent or
443; trailing slash is normalized. Replacement keys are at most 4096 characters.

Secrets stay in an uncontrolled mounted password input and a short-lived
imperative request object. They never enter Query/Mutation variables, URLs,
browser storage, mock observations or logs. Request objects remove the raw key
in `finally`. Successful Save, cancellation, fresh-auth refusal, session change
and unmount clear the input. Writes are single-flight. A 440 invokes existing
fresh authentication but never replays the request; Refresh and a deliberate
retry are required. The actual stale-token backend refusal is a 400 containing
“changed; reload before publishing”; 409 is also recognized. Network-uncertain
saves disable further writes until a successful explicit Refresh.

`testGeoLocation()` opts into `refusal:'return'` because the flat
`success:false` diagnostic is an inline verdict, then requires `tested:true`,
`topic:'geoip'` and a typed `results.geoip`. Test verifies **Mojo credentials
only**, regardless of primary provider. Sharing requires the remote key's
`geoip_sync` permission. Changing origin requires a replacement; the backend
will never send the stored key to an origin different from its node-loaded
origin. A published desired origin can differ from that loaded origin, even
when the user has not edited the displayed origin. Failed verification retains
the draft and directs the operator to apply/refetch Fleet Configuration or use
a replacement.

Draft verdict and stored `verify_state.geoip` are separate. Any edit invalidates
the local verdict. A draft-key failure does not rewrite stored verification.
The backend's stored-test predicate is **no typed replacement + node-loaded
Mojo origin + loaded sync value**; provider-chain changes do not affect it.
After a test the page rereads stored verification without rebasing the draft or
its original edit token. A concurrently changed token or unavailable authority
requires Refresh/review.

Save clears secrets and rereads authoritative configuration. `published:true`
means published with restart pending. `unchanged:true` means provider static
values were unchanged; the database credential can still have changed. A false
`pending_restart` describes this request node's loaded/published relationship
only, never fleet health. The mount-derived Fleet Configuration link provides
the existing apply workflow; this page has no Apply action. Reads that fail,
unsupported/incompatible responses, unavailable publishing, remote read errors,
and incomplete delegation or five-field metadata disable writes visibly.

The isolated mock exports `geoProviderSetupMock()`,
`geoProviderMock(path,method,body,superuser)`, `mockGeoProviderScenarios`,
`setMockGeoProviderScenario()`, `getMockGeoProviderScenario()` and safe observation
controls. The central mock owns session/key/fresh/same-origin gates. The handler
returns undefined outside its route/topic. GET returns a schema-v1 catalog root;
when a larger catalog exists, merge `geoProviderSetupMock()` into its
superuser-only `provider_setup`. POST replies use the backend's flat diagnostic
and publication shapes. Observations contain only action, key action, whether
the stored-test predicate matched, and expected revision; submitted keys are
never retained. Fixtures cover unknown providers, empty registry, failed reads,
unavailable delegation, rejected keys, stale revision, published-vs-loaded
origins, pending restart, fresh auth and uncertain saves.

`AdminGeoLocationDemo` mounts the actual page with those scenarios and existing
interactive-superuser/ordinary-manager fixture identities. Run
`node scripts/verify-admin-geolocation.mjs` and
`node scripts/verify-admin-geolocation-mounted.mjs` for protocol and mounted
StrictMode evidence; central integration also runs settings/fleet/devices/nav,
typecheck, release/build and both-theme 390px browser verification. JSDOM checks
behavior only and does not replace browser layout, focus or native-dialog proof.
