# Admin Bouncer

`portal-mojo/admin` packages the global Bouncer operator surfaces: the signal
decision feed, device reputation histories, and bot-signature CRUD. They mount
through the same `AdminSection` contract in the standalone admin portal or an
embedded `/system` admin area.

## Routes and gates

`BOUNCER_ADMIN_SECTION` has `basePath: 'security/bouncer'` and contributes:

- `security/bouncer/signals` — decision feed and graph-qualified detail
- `security/bouncer/devices` — fingerprints, risk tiers, related history
- `security/bouncer/signatures` — signature create/edit/batch management

All Bouncer gates are explicitly system-pinned. The view union mirrors the
django-mojo models exactly:

```ts
[
  'sys.manage_users',
  'sys.view_security',
  'sys.manage_security',
  'sys.security',
  'sys.users',
]
```

Signature mutations use the narrower backend save union of
`sys.manage_users | sys.manage_security | sys.security | sys.users`. A device's
Incidents section is independently gated by `sys.view_security | sys.security`;
an operator who can inspect Bouncer records through a user-management grant
does not thereby receive incident access.

The package admin barrel must register the section before the shell builds
routes or menus:

```ts
import { BOUNCER_ADMIN_SECTION } from './bouncer';

const sections = [BOUNCER_ADMIN_SECTION];
adminSectionRoutes(sections, { mount: '/system' });
adminSectionsMenu(sections, { mount: '/system' });
```

The generated route element and sidebar item apply the same gates, so direct
URLs fail closed as well as hidden menu links.

## Signal cache contract

Lists force `graph=list` and every row passes through
`sanitizeBouncerSignalRow()`. Details deliberately do not use the generic
`useOne()` key: `useBouncerSignalDetail(id)` requests `graph=detail` and caches
under:

```ts
['/api/account/bouncer/signal', 'one', id, { graph: 'detail' }]
```

This prevents a sparse default/list row from satisfying a detail viewer. The
sanitizer deletes the backend-only top-level `token_nonce` before either list
or detail data can enter TanStack Query. Portal types and renderers do not
declare or display that field. django-mojo cleanup is tracked separately; it is
not a portal dependency.

`ModelTable` also passes the model-normalized list parameters to exports, not
the raw URL parameters. Consequently a persisted or hand-edited
`graph=detail` is removed and replaced by `graph=list` before a signal JSON or
CSV export reaches the server; the detail-only field cannot bypass the Query
sanitizer through the download path.

Signal decisions include all live enum values: `allow`, `monitor`, `block`, and
`log`. Detail shows identity layers, triggered rules, the nested default device
and GeoIP graphs, and client/server JSON through the escaped `JsonBlock`
boundary.

## Device history

Device details use the endpoint's default graph. Related signal and incident
tables are intentionally small local components: their pagination lives in
component state, not the URL parameter store, and they do not nest
`ModelTable`. This keeps switching a detail rail section from rewriting or
colliding with the parent page's table URL.

Related signals query the signal endpoint by MUID. Related incidents query
`/api/incident/incident` with `category__startswith=security:bouncer` and
`search=<device muid>`, matching web-mojo and the model's `details` search
contract. The reporter does not populate Incident `model_name`/`model_id`, so
those fields must not be used as a relationship filter. Incident rows remain
typed independently from incident events.

## Signature writes

The exact `sig_type` values are:

```text
ip | subnet_24 | subnet_16 | user_agent | fingerprint | signal_set
```

Create always sends `source: 'manual'`; edit never rewrites the source. The
confidence parser accepts the full inclusive `0..100` range and preserves
numeric zero. Enable and disable batches call ordinary per-record saves. Delete
is intentionally absent: django-mojo's `BotSignature.RestMeta` does not declare
`CAN_DELETE`, and the live endpoint rejects DELETE even though the mock once
accepted it. No batch or action endpoints are invented, so partial failures use
`ModelTable`'s normal `Promise.allSettled` reporting.

## Styling and showcase

The package emits semantic `bouncer-*` classes and imports no application CSS.
Consumers must include `theme/admin-bouncer.css` after the shared token
definitions. The repository keeps matching leaf files in `apps/portal` and
`apps/showcase`, consistent with the current intentional theme duplication.

The showcase's `AdminBouncerDemo` switches among the three real package pages
so only one URL-backed top-level table is mounted at a time. Open signal/device
rows to exercise details; use the signatures page to exercise ordinary mock
mutations.
