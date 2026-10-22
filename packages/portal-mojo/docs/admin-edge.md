# Edge Admin · Serving

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
`security/network/edge-blocklist`. There are no record routes: a hostname opens in a focused native `modal.open` with horizontal task tabs.

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

Serving keeps the `/edge/vhosts` route, public `Vhost*` exports and persisted table key `admin:edge:vhosts`. The page has a compact configuration-check summary and a Domain picker backed by URL filter state. Search remains label/type/pool; it does not pretend the backend searches derived full hostnames.

Add hostname has four steps: **Address → Routing → Certificate → Review**. Address chooses a managed domain and label; Routing uses a compact four-kind selector and only that kind's destination controls; Certificate selects TLS and enabled intent; Review previews the saved configuration. Other settings opens the pool, body, static and quiet-path fields without an accordion. Cancel and the current primary action remain in the footer.

Edit is one retained controlled draft across **Address / Routing / Certificate / Settings** tabs. Validation selects the relevant task and focuses its first editable control. The active task remains rendered while saving. No shared Tabs or DetailView behavior is changed. Short explanations use accessible info-icon popovers.

Upstream choices resolve the domain's owner, then request that owner's enabled rows plus shared rows (`group`); platform domains request shared rows only (`group__isnull`). Failure to resolve the owner keeps the picker disabled. Certificate coverage stays Unknown until the certificate's own graph is read.

| Kind | Type | Needs | May carry | Refuses |
|---|---|---|---|---|
| `api` | API | `upstream` | `quiet_paths`, `serve_static` | `spa`, `redirect_to` |
| `site` | Site | — | `spa` | `upstream`, `quiet_paths`, `serve_static`, `redirect_to` |
| `site_api` | Site + API | explicit routes on create | `spa`, `serve_static`, `quiet_paths` | whole-host `upstream`, `redirect_to` |
| `redirect` | Redirect | `redirect_to` | — | everything else |

`buildVhostPayload(draft, { create })` is the one place a draft becomes a
request. It sends each knob the chosen kind does not carry as its empty value,
so a draft that visited another shape cannot leak that shape's settings, and
an edit that changes kind clears what the old kind held. It never sends
`mojosec_policy`. A vhost that carries an edge evidence policy therefore cannot
change kind, or its single-page-app switch on a `site`, from here: the server
requires the policy's response class to match and refuses, and its message is
shown.

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
routes. An explicit server refusal stays visible and retains acknowledged progress. A transport error, malformed response or 5xx response can follow a committed write: the outcome is unconfirmed. An unacknowledged create is blocked from replay; close and inspect Serving before starting another create. For an uncertain route or final save, the next Finish performs observation only. An observed matching route is acknowledged before continuing; a missing route in the bounded observation remains blocked. A final-save observation states the observed enabled intent and requires another explicit Finish. No unknown enable outcome is called refused or still disabled.

The server will store an enabled `site_api` hostname with no routes. The create wizard requires at least one explicit valid route. This is a create-only requirement: route-less edits and supported Site → Site + API conversion remain available, then routes can be authored in detail.

In edit mode routes are read-only, with a pointer to the detail view, which
owns adding, changing and deleting them. Changing a `site_api` vhost to
another kind while it has routes is blocked with the count; the server refuses
it too. Until the stored routes have been read, or if that read fails, the
wizard does not judge quiet paths against them and leaves that to the server.

## Vhost detail

The native detail modal has **Overview / Routes / Certificate / Settings**. Routes appears only for Site + API. Overview puts the redirect target or API upstream first; it does not repeat the hostname and type already in the header. Certificate shows the stored status and expiry, with Change certificate for managers. Settings holds pool/body/static/quiet paths, timestamps and read-only evidence-policy information. Header actions own enable/disable, Edit and the focused Delete confirmation.

A successful create opens the saved hostname. An acknowledged partial Site + API create offers **Inspect saved hostname**, preserving its real disabled/saved state. An unacknowledged create is never replayed. Explicit backend refusals remain actionable; lost/malformed/5xx outcomes require **Observe outcome** before another mutation. Observation never writes or automatically retries.

Routes uses a paginated local table with focused Add/Edit dialogs. Rename and removal inspect the complete bounded route inventory and current quiet paths first. A change that would strand a quiet path is blocked with the exact path and points to Settings; remove or repair the quiet path before changing the route. There is no pretend atomic multi-row transaction. Safety inspection paginates up to 2,000 routes and refuses changing/incomplete inventories rather than treating a partial page as complete.

Detail edits, route writes, enablement and deletion share the detail's pending state. Native Escape/backdrop/X are locked during submitted writes and preflight. Owned dialogs close on scope loss; before each write and every fresh-auth attempt, a guard verifies the original session and current permission. A closed or replaced editor cannot continue the staged create's later writes. Unknown outcomes stay visibly unconfirmed; closing a dialog does not cancel a server operation or establish its outcome.

## Serving evidence

`ServingReadiness.tsx` and `serving-data.ts` are internal, read-only helpers. Bootstrap is requested independently through `GET /api/account/admin/bootstrap` only for an authenticated global identity admitted by `view_admin | manage_users | manage_settings | admin` (literal superuser bypass). DNS access alone never starts that read. A positive projection retains only matching user id/superuser boolean, setup boolean and the edge available/HTTP/issuance fields; unrelated bootstrap data never enters Query or local state.

Hosting readiness calls `GET /api/account/admin/setup/readiness?section=hosting_vhosts` only after that same identity successfully bootstraps with `capabilities.setup === true`, and both current Me and bootstrap report literal superuser. The server still rejects key-backed/noninteractive sessions. The client invents no key provenance flag. The schema-1 parser finds the selected section by code, validates status/time/count/coverage bounds, caps checks at 64 and scalar details at 16 keys, and drops unrelated response fields.

Certificate serving posture shows HTTP enabled/disabled as informational file rendering configuration. DNS-01 identifies issuance method. Hosting readiness checks enabled rows' domain and certificate status only: pass does not prove certificate expiry/coverage/material installation, fleet convergence, expected nodes or running generation. Absence from bounded failing-row details is no per-host verdict. Enabled badges and saved notices express configuration intent.

Errors, denied reads, old-backend 404s and malformed data are visible as Unavailable/Unknown with manual refresh; a failed refresh clears prior evidence instead of leaving a current-looking pass. Auth uid plus session revision fences requests and clears projections on replacement/logout. Reads happen only while mounted and admitted; there is no polling. Completed configuration actions refresh the panel, and list/detail CRUD retains its existing freshness helpers.

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
- The server parses a blocklist address with Python's `ipaddress` and compiles
  a user-agent pattern with Python's `re`, and the mock follows Python, not
  JavaScript: `010.1.2.3` and `\q` are refused, `10.0.0.0/255.0.0.0`,
  `(?i)bot` and `a*+` are accepted. The reason after "does not compile" is the
  mock's own wording. The editor's own check is only a first pass and never
  compiles the pattern; the server's answer on save is the verdict.
- A vhost update that names an upstream or certificate that does not exist is
  refused by the mock with the same words as a missing one. The server's
  wording for an unknown id was not measured.
- The declare-upstream dialog and the blocklist editor refuse Escape and the
  backdrop while their write is in flight, and the editor's save and delete
  share one pending state. `npm run verify:admin-edge` holds each write open
  and checks this.

## Themes and showcase

Styles live in `src/styles/components/admin-edge.css` and ship in
`portal-mojo/styles.css`; the app declares the tokens. They are built from
tokens only, so both themes render from one sheet. The showcase still carries
its own identical copy until it adopts the package stylesheet. The showcase
demo (Develop → Components → Admin → Edge) runs the shipped pages against the
mock under five identities: platform administrator, DNS manager, DNS viewer,
security manager and security viewer.

`npm run verify:admin-edge` retains the existing endpoint contract. `node scripts/verify-admin-serving-mounted.mjs` mounts the native wizard and modal to check all four create shapes, disabled staging, retained edit drafts, invalid-tab selection, supported route-less conversion, busy dismissal, partial inspection and committed-response-loss recovery. `node scripts/verify-admin-serving-mounted-evidence.mjs` mounts evidence for DTO bounds, exact gates, unknown posture, refresh failures and auth replacement.

### KISS presentation

The Serving table defaults to hostname/domain, serving shape and enabled intent. Pool and created time remain in record inspection. HTTP/readiness summaries keep the observed timestamp and partial-report warning visible, with technical evidence in Check details; configuration checks never claim fleet application. See [visual QA](admin-presentation.md).
