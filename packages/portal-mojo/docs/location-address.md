# LocationClient + AddressField

```ts
import { LocationClient } from 'portal-mojo/client';
import { AddressField } from 'portal-mojo/ui';
```

`LocationClient` is the typed adapter for django-mojo's six public location
endpoints. It calls `mojoCall` directly—there is no Query cache—and parses the
backend's intentionally mixed response shapes without performing a second
envelope unwrap.

| Method | Wire contract |
|---|---|
| `validateAddress(address)` | `POST /api/location/address/validate`; reads nested `data` |
| `autocomplete(input, options?)` | `GET /api/location/address/suggestions`; reads top-level `success/data/size/count` |
| `placeDetails(placeId)` | `GET /api/location/address/place-details`; reads top-level `address` |
| `geocode(address)` | `POST /api/location/address/geocode`; reads top-level coordinates/components |
| `reverseGeocode({lat,lng})` | `GET /api/location/address/reverse-geocode` |
| `timezone({lat,lng,timestamp?})` | `GET /api/location/timezone` |

## Provider session and races

The first suggestions request deliberately omits `session_token`; django-mojo
creates it. The client accepts that response token into a JavaScript private
field, reuses it on later suggestions and place-details GETs, then destroys it
when selection ends the session. There is no token getter or input prop.

Every request captures a monotonically increasing generation. A later request,
`cancelPending()`, `reset()`, `replaceTransport()`, `dispose()`, unmount, or
upstream-client change makes older completions reject with
`StaleLocationRequestError`. Use `isStaleLocationRequest(error)` when a UI
should silently discard that expected outcome.

Never put the session token in TanStack Query, router/search params, form
values, storage, application logs, or mock history. The mock exposes only
derived booleans/counts such as `has_session_token` and `input_length`.

## AddressField

`AddressField` is controlled and commit-only. Keystrokes stay in a private
draft. Raw text commits on Enter/Tab/blur/outside; Escape restores the
controlled value. Selecting a suggestion privately fetches place details and
only then commits. A details failure drops the provider description and
restores the prior value.

```tsx
<AddressField
  fieldName="address1"
  value={values.address1}
  fields={{ city: 'city', state_code: 'state', postal_code: 'postal_code' }}
  onCommit={(address1) => setValues(v => ({ ...v, address1 }))}
  onPatch={(patch) => setValues(v => ({ ...v, ...patch }))}
/>
```

For schema-driven forms, use `type: 'address'`:

```ts
const fields: Field[] = [{
  name: 'address1', type: 'address', label: 'Street address',
  addressFields: {
    city: 'city', state_code: 'state', postal_code: 'postal_code',
    latitude: 'latitude', longitude: 'longitude',
  },
} /* plus every destination as a declared Field */];
```

`address1` defaults to the address field's own name. Other destinations are
opt-in. SchemaForm and FormView discard undeclared destinations. FormView
queues the accepted patch as one autosave batch; a server failure rolls every
field in that batch back to its shared server snapshot.

The suggestion list uses the shared `Popover`, which is the sole owner of
outside-mousedown and Escape dismissal. Styles live in
`theme/location-address.css` and use design tokens in both themes.
