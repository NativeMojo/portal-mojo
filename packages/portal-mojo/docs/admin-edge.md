# Edge Admin · Serving

```ts
import {
    EDGE_ADMIN_SECTION, VhostsPage, VhostDetail, VhostWizard, openVhostWizard,
    UpstreamsPage, BlocklistPage, EdgeVhostModel, EdgeRouteModel,
    EdgeUpstreamModel, EdgeBlocklistModel, buildVhostPayload,
} from 'portal-mojo/admin'; // also portal-mojo/admin/infrastructure
```

`EDGE_ADMIN_SECTION` contributes Infrastructure routes `edge/vhosts` and
`edge/upstreams`, relative to the standalone or embedded `/system` mount.
Network Security owns `security/network/edge-blocklist`. Records open in
native modals, not record routes. Consumer source: django-mojo `mojo/apps/edge/`;
`client/mock.ts` mirrors its graphs and refusals, with wording limits below.

## Permissions and ownership

All clauses are global; section and route gates both apply.

| Resource/action | Authority |
|---|---|
| Vhost, route, upstream view | `sys.view_dns OR sys.manage_dns OR sys.security` |
| Vhost/route change or delete; upstream enabled switch | `sys.manage_dns OR sys.security` |
| Upstream declare/retire | Literal `me.is_superuser`; server `require_platform_admin` also refuses API keys |
| Blocklist view | `sys.view_security OR sys.manage_security OR sys.security` |
| Blocklist change/delete | `sys.manage_security OR sys.security` |

`EDGE_BLOCKLIST_VIEW_PERMS` deliberately includes `manage_security`: manage does
not imply view in the client. Security-only operators cannot enter DNS-gated
Edge, hence the separate blocklist route. Member grants and `?group=` do not
open the fleet-wide blocklist.

A vhost on a group-less domain is a **house row**: non-superusers cannot list,
inspect or create it or its routes, even with global DNS grants. Vhost graphs'
`domain: basic` omits group, so never infer ownership there. Non-superuser domain
choices use `group__isnull: false`. Resolve the domain's own graph before offering
enabled upstreams: `group=<owner>` includes owned and shared rows; platform domains
use `group__isnull: true`. Unresolved ownership disables selection.

## Endpoints

| `/api/edge/…` | Contract |
|---|---|
| `vhost`, `vhost/<id>` | list/read/create/update/delete; table graph `list`, record graph `default` |
| `route`, `route/<id>` | list/read/create/update/delete; `site_api` only; filter `vhost` |
| `upstream`, `upstream/<id>` | list/read/update `is_enabled`; no collection create/delete |
| `upstream/declare` | POST `{name, kind, host+port OR socket_path, group?}` |
| `upstream/retire` | POST `{upstream}`; disables and retains row |
| `blocklist`, `blocklist/<id>` | list/read/create/update/delete; fleet-wide |

Refused saves reject at the one client boundary. Public save/delete helpers
accept an optional `beforeWrite` guard, invoked before **every** fresh-auth attempt.

## Serving tasks

The lean table shows hostname/domain, type and enabled intent. Pool and timestamps
belong in inspection. The Domain picker writes URL filter state; search supports
label/type/pool, not derived full hostnames. Persisted key remains
`admin:edge:vhosts`; public `Vhost*` exports and `/edge/vhosts` remain compatible.

- **Add hostname:** Address → Routing → Certificate → Review. Compact type choice,
  only relevant destination controls, visible action footer. Other settings holds
  pool/body/static/quiet paths without an accordion. Success opens the saved row.
- **Edit:** Address / Routing / Certificate / Settings share one controlled draft.
  Validation selects the relevant tab and focuses the invalid input. Saving retains
  the active panel. Domain is immutable. Info-icon popovers carry secondary help.
- **Inspect:** Overview / Routes / Certificate / Settings; Routes only for Site + API.
  Overview shows actual redirect/API destination first. Certificate shows stored
  status/expiry and Change certificate. Settings holds other knobs, timestamps and
  read-only platform policy. Header owns enable/disable, Edit and Delete.
- **Routes:** paginated local table, focused Add/Edit dialogs and explicit removal
  confirmation. Before rename/removal, inspect current quiet paths and complete
  bounded routes. Block orphaning a quiet path and identify what to repair in
  Settings first; no atomic multi-row operation is implied.

Styles are scoped to these surfaces; shared Tabs/DetailView and Dashboard behavior
are unchanged. See [presentation QA](admin-presentation.md).

## Kinds, payloads and validation

| Kind | Required | Supported options | Refused |
|---|---|---|---|
| `api` | `upstream` | quiet paths, static files | SPA, redirect |
| `site` | — | SPA | upstream, quiet paths, static, redirect |
| `site_api` | explicit routes on create | SPA, quiet paths, static | whole-host upstream, redirect |
| `redirect` | `redirect_to` | — | other kind-specific knobs |

`buildVhostPayload(draft, {create})` allowlists the chosen kind and sends empty
values for its unsupported knobs, clearing values from a former kind. It never
sends `mojosec_policy`. The server can refuse kind/SPA changes that conflict with
that policy's response class; show its refusal.

Client mirrors in `edge/models.ts`; server remains authoritative:

- Label: empty apex, `*` wildcard or one lowercase DNS label. Derive `server_name`.
- Body: integer 1–4096 MB, default 50; absent for redirect.
- Pool: deployment-declared `EDGE_POOLS`, default `["default"]`; no client catalog.
- Redirect: hostname only; no scheme/path/port/wildcard.
- Route/quiet path: leading `/`, letters/digits/`._-/`, at most 128 characters,
  no `//` or `..` segment. A route cannot be `/`.

Only enabled rows require a certificate belonging to the domain and covering the
address, and a unique enabled domain/label. Stage a replacement disabled, disable
the old row, then enable the replacement. `certificateCovers` knows a wildcard
covers one label and never the apex. Coverage stays Unknown until the full
certificate graph (including SANs) is read; disabled staging remains available.

## Staging and uncertain writes

`site_api` quiet paths require stored route prefixes, so create in this order:

1. Vhost disabled, without quiet paths.
2. Routes sequentially.
3. Final vhost save with quiet paths and chosen enabled intent; always perform this
   step so enable-time validation runs last.

The wizard requires at least one valid create route, though the server accepts
route-less enabled rows. Edits and Site → Site + API conversion may remain
route-less; author routes in detail. Existing routes block conversion away from
Site + API. Unread routes defer quiet-path validation to the server.

Retain acknowledged steps on explicit refusals. Transport loss, malformed receipts
and 5xx may follow committed writes and stay **unconfirmed**, never “refused” or
“still disabled”. An unacknowledged create cannot replay: close and inspect Serving.
An acknowledged partial create offers **Inspect saved hostname**.

**Observe outcome** reads only. Route continuation requires the matching stored
prefix/upstream; absence stays blocked. Edit/final-save observation compares the
exact normalized submitted payload, including FK IDs and arrays; unchanged or
conflicting fields retain the guard and show differences. Only an exact match
clears it. Continuing requires explicit **Add hostname** or **Save changes**;
observation never automatically replays a mutation.

Detail edits, route writes, enablement and deletion serialize through one pending
state. Lock Escape/backdrop/X during preflight and writes. Before each write and
fresh-auth attempt, check original session/current permission; owner disposal
closes nested dialogs and prevents later staged writes. Closing cannot cancel an
already submitted server operation or prove its outcome.

Route safety reads paginate to at most 2,000 rows and reject changed counts,
duplicate IDs, incomplete pages and excess inventory. Same-count concurrent edits
cannot all be detected; there is no atomic snapshot guarantee.

Delete confirms the address, stopped serving and route cascade, warns linked sites
can stop serving, retains domain/certificate and offers Disable as reversible.

## Serving evidence

Read-only `ServingReadiness.tsx`/`serving-data.ts` keep positive projections outside
Query. `GET /api/account/admin/bootstrap` requires an authenticated matching global
identity with `view_admin OR manage_users OR manage_settings OR admin` (literal
superuser bypass); DNS grants alone never request it. Retain only matching user
ID/superuser, setup capability and edge available/HTTP/issuance fields.

`GET /api/account/admin/setup/readiness?section=hosting_vhosts` additionally requires
successful same-identity bootstrap with setup capability and literal superuser in
both Me and bootstrap. Server still refuses key-backed/noninteractive sessions;
client invents no provenance flag. Schema 1 validates status/time/count/coverage,
keeps the selected section only, caps checks at 64 and scalar details at 16 keys.

The compact summary keeps timestamp and partial-report warning visible; Check
details holds technical evidence. HTTP is a file-rendering setting; DNS-01 is an
issuance method. Checks cover enabled rows' domain/certificate status, **not** live
serving, expiry/coverage/material installation, fleet convergence/nodes/generation.
An omitted hostname has no individual verdict. Enabled/saved is configuration intent.

Errors, denied reads, old-backend 404s and malformed responses show Unavailable or
Unknown. Failed refresh clears old evidence. UID/session revision fence reads;
same-session loss of admission/bootstrap/superuser/setup authority disposes report
modals. Reads occur only while mounted/admitted, without polling; configuration
changes refresh the panel.

## Upstreams and blocklist

An upstream's name/destination are fixed at declaration; only enabled is editable.
Lists include owned and shared rows. Retiring disables and retains it: reaching
vhosts/routes stop serving and are not repointed. Confirm that consequence.

Blocklist modes: `log` (default, still served), `enforce` (refused), `allow`
(exemption), `off` (retained inactive). Start in log, inspect the watch log, then
enforce. Propagation takes about ten minutes. Save IPs as canonical networks:
`10.1.2.3/8` becomes `10.0.0.0/8`; show the returned value. Declare and blocklist
editors guard native dismissal; blocklist save/delete share pending state.

## Boundaries and pitfalls

- No claim-reserved action: django-mojo removed it in `bc2c57b1` (v1.7.1 onward).
  Platform-owned `mojosec_policy` is read-only; never send it.
- No owning-WebApp/alias graph, pool catalog, route-disable flag, atomic multi-route
  write or per-host live readiness. Aliases look like other rows; show refusals.
- Mock uniqueness wording (enabled hostname, route prefix, blocklist value,
  upstream name) and missing-relation wording were not measured on the server.
- Blocklist parsing follows Python `ipaddress`/`re`, not JS RegExp: reject
  `010.1.2.3` and `\q`; accept `10.0.0.0/255.0.0.0`, `(?i)bot`, `a*+`.
  Compilation reason text is mock-specific; local validation is only a first pass.
- Client certificate checks are advisory; only the server validates a save.

## Themes and showcase

Canonical token-only `src/styles/components/admin-edge.css` ships through
`portal-mojo/styles.css`, imported by Admin and Showcase. Demo: Components → Admin
→ Edge, under platform administrator, DNS manager/viewer and security manager/viewer.
Verify both themes, desktop/390px, opened dialogs, keyboard/help, busy and error states.

Contracts: `npm run verify:admin-edge` (API plus held dialog writes),
`node scripts/verify-admin-serving-mounted.mjs` (all shapes, staging, draft/focus,
conversion, partial inspection, uncertainty, route guards/session races),
`node scripts/verify-admin-serving-mounted-evidence.mjs` (DTO bounds, exact gates,
unknown evidence, failed refresh, auth/permission replacement). Mounted tests do
not establish native layout; actual browser QA remains required.
