# Edge Admin

```ts
import {
    EDGE_ADMIN_SECTION, VhostsPage, VhostDetail, VhostWizard, openVhostWizard,
    UpstreamsPage, BlocklistPage, EdgeVhostModel, EdgeRouteModel,
    EdgeUpstreamModel, EdgeBlocklistModel, buildVhostPayload,
} from 'portal-mojo/admin';
```

The same names are on `portal-mojo/admin/infrastructure`.

`EDGE_ADMIN_SECTION` contributes Infrastructure routes at `edge/vhosts` and
`edge/upstreams` (or the same paths under an embedded `/system` mount). The
fleet blocklist is a route of Network Security, at
`security/network/edge-blocklist`. There are no record routes: a vhost opens in
`modal.detail`.

Consumer contract: django-mojo `mojo/apps/edge/`. The mock in
`client/mock.ts` returns the same graphs and the same refusals, word for word
where the server has words.

## Permissions

- Vhosts, routes, upstreams — view: `sys.view_dns | sys.manage_dns | sys.security`.
- Vhosts, routes — change or delete: `sys.manage_dns | sys.security`.
- Upstreams — switch on or off: `sys.manage_dns | sys.security`.
- Upstreams — declare or retire: `me.is_superuser === true`. The server gate
  is `require_platform_admin`, which also refuses API keys.
- Blocklist — view: `sys.view_security | sys.manage_security | sys.security`
  (`EDGE_BLOCKLIST_VIEW_PERMS`). This is wider than `SECURITY_VIEW_PERMS`: the
  server lets `manage_security` view, and manage does not imply view on the
  client, so the clause is spelled out.
- Blocklist — change or delete: `sys.manage_security | sys.security`.

A section gate and a route gate both apply. A security-only operator is denied
every DNS-gated section, which is why the blocklist does not live under Edge.
The blocklist has no group: a member-scoped grant and `?group=` open nothing.

**House rows.** A vhost on a group-less domain is platform property. It never
appears in a non-superuser's list, even with a global grant, and its detail,
its routes and creating one are refused to everyone else. The vhost graphs
carry `domain: basic`, which has no `group`, so house-ness cannot be read off a
vhost row. The wizard's domain picker passes `group__isnull: false` for
non-superusers so a house domain is never offered to someone who would be
refused at Finish.

## Endpoints

| Address | Verbs | Notes |
|---|---|---|
| `/api/edge/vhost` (+`/<id>`) | list, read, create, update, delete | `list` graph for tables, `default` for one row |
| `/api/edge/route` (+`/<id>`) | list, read, create, update, delete | `site_api` vhosts only; filter `vhost` |
| `/api/edge/upstream` (+`/<id>`) | list, read, update | update writes `is_enabled` only; no create, no delete |
| `/api/edge/upstream/declare` | POST | `{name, kind, host+port \| socket_path, group?}`; platform administrators |
| `/api/edge/upstream/retire` | POST | `{upstream}`; disables, keeps the row; platform administrators |
| `/api/edge/blocklist` (+`/<id>`) | list, read, create, update, delete | fleet-wide |

## The four kinds

The wizard never shows a kind dropdown over one long form. Its first step is
four cards in plain words; the following steps show only that shape's settings.

| Kind | Card | Needs | May carry | Refuses |
|---|---|---|---|---|
| `api` | API host | `upstream` | `quiet_paths`, `serve_static` | `spa`, `redirect_to` |
| `site` | Static site or SPA | — | `spa` | `upstream`, `quiet_paths`, `serve_static`, `redirect_to` |
| `site_api` | Site + API paths | routes | `spa`, `serve_static`, `quiet_paths` | whole-host `upstream`, `redirect_to` |
| `redirect` | Redirect | `redirect_to` | — | everything else |

`buildVhostPayload(draft, { create })` is the one place a draft becomes a
request. It sends each knob the chosen kind does not carry as its empty value,
so a draft that visited another shape cannot leak that shape's settings, and
an edit that changes kind clears what the old kind held. It never sends
`mojosec_policy`.

Shared rules, each mirrored by a validator in `edge/models.ts`:

- `label`: empty serves the bare domain, `*` the wildcard, otherwise one DNS
  label. The address (`server_name`) is derived, never typed.
- `body_size_mb`: whole number, 1 to 4096, default 50. Not offered for a
  redirect.
- `pool`: must be one the deployment declares (`EDGE_POOLS`, default
  `["default"]`). The refusal names the declared set.
- `domain`: set once. An edit shows it read-only and never sends it.
- `redirect_to`: a host name. No scheme, path, port or wildcard.
- A route prefix or quiet path starts with `/`, uses letters, digits, `.`,
  `_`, `-` and `/`, and has no `//` or `..`. A route prefix cannot be `/`.

## What is checked when

The server checks most things on every save. Two things are checked **only
when the row is enabled**:

- the certificate belongs to the vhost's domain and covers its address;
- no other enabled row has the same domain and label.

So a disabled row may hold a certificate that does not cover it yet, and may
share a name with a live row. That is how a replacement is staged: create it
disabled, then disable the old one and enable the new one. The wizard warns
when the chosen certificate does not cover the address (`certificateCovers`,
which knows that a wildcard covers exactly one label and never the apex) and
still lets the row be saved disabled.

## The create order for `site_api`

A quiet path on a `site_api` vhost must sit under one of its route prefixes,
and the server reads those prefixes from the stored row. A create that carries
quiet paths is therefore always refused with "none declared". The only order
that works is:

1. create the vhost, **disabled** and without quiet paths;
2. create its routes, one at a time;
3. save the vhost once more with the quiet paths and the enablement the user
   chose.

The wizard does exactly this. Step 3 always runs, so the enable-time checks
happen at the end and a failure part-way never leaves a live vhost with no
routes. If a step is refused the wizard stays open and says which step and
what already exists. Finishing again continues from there: it never posts the
vhost a second time and never repeats a route that landed.

The server will store an enabled `site_api` vhost with no routes. The wizard
does not: at least one valid route is required at the settings step and again
at review.

In edit mode routes are read-only, with a pointer to the detail view, which
owns adding, changing and deleting them. Changing a `site_api` vhost to
another kind while it has routes is blocked with the count; the server refuses
it too.

## Vhost detail

The detail follows the admin modal contract (`admin-modals.md`). The header
switch enables and disables. Edit and Delete are in the header menu, shown
only with the manage grant. Delete asks for confirmation, names the address,
says its routes go with it, and points at Disable as the choice that can be
undone. A refused enable shows the server's message in the overview. Routes
are content: the Routes section lists them and owns add, change and delete.

## Upstreams

An upstream is a destination a vhost may proxy to. Only `is_enabled` can be
written on one; its name and destination are fixed when it is declared. The
list shows the active group's upstreams and the shared ones. Retiring disables
the row and keeps it: vhosts and routes that reach it stop being served and
are not repointed. The retire control names that consequence before it acts.
The wizard's upstream pickers list enabled upstreams only.

## Blocklist

An entry matches an IP network or a user-agent pattern, in one of four modes:
`log` (recorded, still served — the default), `enforce` (refused), `allow` (an
exemption) and `off`. Create an entry in `log`, watch the edge watch log for
it, then switch it to `enforce`. A change reaches the fleet in about ten
minutes.

An `ip` value is stored as its network: `10.1.2.3/8` is saved as `10.0.0.0/8`.
The editor shows the saved value from the response.

## Not built here

- **Claim-reserved.** The plan for this page asked for a superuser control to
  claim a reserved name. django-mojo removed the reserved-name mechanism, its
  field and its action (commit `bc2c57b1`, in every release since v1.7.1), so
  there is nothing for such a control to call.
- **`mojosec_policy`.** Shown read-only on the vhost detail. It is set by the
  platform and never sent from here.
- **Web apps, releases and alias addresses.** An alias address appears in the
  vhost list like any other row; `alias_of` is in no graph, so it cannot be
  told apart, and a refused edit shows the server's message.

## Pitfalls

- Do not send `quiet_paths` on a `site_api` create. See the create order.
- Do not treat a saved, enabled row as proof the certificate covers it from
  the client check alone; the server's answer on save is the proof.
- The mock's messages for database uniqueness (a second enabled vhost on one
  name, a repeated route prefix, a repeated blocklist value, a repeated
  upstream name) are the mock's own words. The server reports these from a
  database constraint, and its wording was not measured.

## Themes and showcase

Styles are `theme/admin-edge.css`, identical in the portal and showcase apps
and built from tokens only, so both themes render from one sheet. The showcase
demo (Develop → Components → Admin → Edge) runs the shipped pages against the
mock under five identities: platform administrator, DNS manager, DNS viewer,
security manager and security viewer.

`npm run verify:admin-edge` is the executable contract.
