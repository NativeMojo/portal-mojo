# Admin: network security — blocks, IP sets, geofencing

```ts
import {
    // the section (registered in ADMIN_SECTIONS — no app wiring needed)
    NETWORK_SECURITY_ADMIN_SECTION,
    // pages
    BlockedIPsPage, FirewallLogPage, IPSetsPage, GeofencingPage,
    // KISS detail modals (#1425)
    showBlockedIpDetail, showIPSetDetail,
    // the SHARED rule editor — platform page and group panel render this one
    GeofenceRuleEditor, makeRuleEditorValue, ruleFromEditorValue, toggleRuleEditorMode,
    // models
    IPSetModel, GeofenceEventModel,
    // permission clauses
    IPSET_VIEW_PERMS, IPSET_MANAGE_PERMS, IPSET_DELETE_PERMS,
    GEOFENCE_VIEW_PERMS, GEOFENCE_MANAGE_PERMS, SECURITY_EVENTS_PERMS,
    METRICS_GLOBAL_VIEW_PERMS, GROUP_GEOFENCE_EDIT_PERMS,
    // the geofence projection (one module, two scopes)
    isAdvancedRule, ruleToForm, formToRule, describeRule, diffRules,
    describeDecision, describeWouldBlock, buildSimulateBody, buildGroupRulePayload,
    coerceRuleInput, collectScopes, scopeLabel, regionName,
    ABUSE_FLAGS, US_STATES, COUNTRY_OPTIONS, countryName,
    // config-plane hooks (all `enabled`-gated — a denied surface issues NO request)
    useGeoConfig, useGeoAllowlist, useBypassHolders, useGeoSimulate,
    useSaveGeoRules, useRemoveGeoRulesOverride, useSaveGeoAllowlist,
    useGeofenceCountryTotals, useIPSetCidrData,
    isGeofenceApiMissing, GEOFENCE_API_MISSING_MESSAGE,
} from 'portal-mojo/admin';
```

Perimeter control: block an abusive IP right now, whitelist a customer's NAT,
maintain country and datacenter CIDR sets synced to the firewall fleet, set
geographic policy — and prove the policy does what you think with a built-in
simulator before it bites real traffic. Demo: showcase → Admin → **Network
security**. Styles: `apps/{portal,showcase}/src/theme/admin-network.css`
(byte-identical).

## Surfaces

One section, `network-security` at `security/network`, under the **Security**
navigation group beside Security Operations, Bouncer, Devices & Logins and IP
Intelligence.

| Route | Presentation | Gate |
|---|---|---|
| `blocked-ips` | page + `modal.detail` | `GEOIP_VIEW_PERMS` |
| `firewall-log` | page + the shipped `LogInspector` | `FIREWALL_LOG_PERMS` |
| `ip-sets` | page + a two-tab `modal.detail` | `IPSET_VIEW_PERMS` |
| `geofencing` | **page**: posture header over 4 tabs | `GEOFENCE_VIEW_PERMS` |

Geofencing is the one surface that stays a page. That is the explicitly
requested presentation: a config page that states what is in force and lets you
test it before it bites.

The section gate is the ANY-of **union** of the four route gates (the
`MONITORING_ADMIN_SECTION` pattern), and each route then carries its exact
backend gate. A geofence-only operator (`sys.view_geofence` alone) reaches
Geofencing and is denied everywhere else; the engine's landing redirect resolves
to the first route they can see, so nobody lands on a denial.

## Permissions — `sys.`-pinned global grants only, fail-closed

`@md.requires_global_perms` authorizes against global `User.permissions` or
superuser **only** — no group fallback, and a `GroupScopedToken` is refused
outright. Every clause here is therefore `sys.`-pinned: a member grant must
never open platform enforcement config.

| Constant | Value | Backend source |
|---|---|---|
| `GEOIP_VIEW_PERMS` | (imported from #1291) | `GeoLocatedIP.RestMeta.VIEW_PERMS` |
| `GEOIP_MANAGE_PERMS` | (imported from #1291) | `GeoLocatedIP.RestMeta.SAVE_PERMS` |
| `IPSET_VIEW_PERMS` | `sys.view_security`, `sys.security` | `IPSet.RestMeta.VIEW_PERMS` |
| `IPSET_MANAGE_PERMS` | `sys.manage_security`, `sys.security` | `IPSet.RestMeta.SAVE_PERMS` |
| `IPSET_DELETE_PERMS` | `sys.manage_security` **only** | `IPSet.RestMeta.DELETE_PERMS` |
| `FIREWALL_LOG_PERMS` | `LOGS_ADMIN_PERMISSIONS` (reused) | `logit.Log.RestMeta.VIEW_PERMS` |
| `GEOFENCE_VIEW_PERMS` | `sys.view_geofence`, `sys.manage_geofence`, `sys.security` | `@requires_global_perms` on `GET /api/geo/rules` |
| `GEOFENCE_MANAGE_PERMS` | `sys.manage_geofence`, `sys.security` | `POST`/`DELETE /api/geo/rules` |
| `SECURITY_EVENTS_PERMS` | `SECURITY_VIEW_PERMS` (reused) | `incident.Event.RestMeta.VIEW_PERMS` |
| `METRICS_GLOBAL_VIEW_PERMS` | `sys.view_metrics`, `sys.metrics` | `metrics/rest/helpers.check_view_permissions` for `account="global"` |

Note the two traps the table encodes:

- **`IPSET_DELETE_PERMS` is narrower than manage.** The broad `security` grant
  saves an IP set but cannot delete one.
- **`manage_metrics` does NOT imply `view_metrics`.** An operator holding only
  the manage grant is denied `account="global"` reads, so the blocks tab's
  metrics strip gates on the view clause rather than firing and catching a 403.

A permission-disabled query passes `enabled: false`. **No denied surface in this
module issues a request** — not the metrics strip, not the blocks table, not the
change history, not the posture header's Last-change chip.

## Endpoints

| Endpoint | Gate | Notes |
|---|---|---|
| `GET/POST /api/incident/ipset` `(+/<pk>)` | model `VIEW`/`SAVE`/`DELETE_PERMS` | graphs `default` · `detailed`; actions `sync`, `enable`, `disable`, `refresh_source` |
| `GET /api/system/geoip` `(+/<pk>)` | #1291's model | Blocked IPs is the `is_blocked=true` projection |
| `GET /api/logs` | `logit.Log` | filtered `kind__startswith=firewall:` |
| `GET/POST/DELETE /api/geo/rules` | global geofence grants | `POST` body is `{rule}`, a FULL REPLACE |
| `POST /api/geo/simulate` | global geofence view | body keys `ip`, `geo`, `scope`, `group_uuid` |
| `GET/POST /api/geo/allowlist` | view / manage | `POST` body is `{entries}`, a FULL REPLACE |
| `GET /api/geo/bypass_holders` | global geofence view | read-only, capped at 200 |
| `GET /api/incident/event` | `SECURITY_EVENTS_PERMS` | `category=geofence_block\|geofence_exempt\|geofence_config` |
| `GET /api/metrics/category_slugs` | `check_view_permissions` | **flat envelope — no `data` wrapper** |
| `GET /api/metrics/fetch` | same | `account="global"` |

### `GET /api/geo/rules` — the config payload, key for key

```jsonc
{
  "system": { "rule": {…}, "source": "setting|conf|none", "modified": "ISO|null" },
  "group":  { "id", "uuid", "is_active", "rule", "strict_posture", "strict_posture_effective" },
  "posture": {
    "enabled", "fail_closed", "fail_closed_scopes",
    "allow_private_ips", "strict_posture", "cache_ttl"
  },
  "allowlist_summary": { "setting_entries", "geoip_active" },
  "evaluation_order": ["system", "group"],
  "enforced_endpoints": [{ "endpoint", "scope", "after_auth?" }]
}
```

`group` is present **only** when the request carried `group_uuid`; an unknown
uuid is a 400, and an *inactive* group is deliberately returned and evaluated.
`after_auth` appears only when truthy.

### The decision shape

`_build_decision` writes `allowed`, `reason`, `detail`, `ip`, `country`,
`country_code`, `region`, `region_code`, `abuse`, `checked_at`, `rule_level`,
`strict_posture`. `country` and `country_code` carry the **same** value, as do
`region` and `region_code`.

**`enabled` sits at the TOP level of a simulate decision** (`engine.py:473`) and
is absent from `check()` decisions entirely. `would_block`, `would_block_reason`,
`allowlist_source`, `allowlist_reason` and `allowlist_until` appear **only** when
the IP matched the allowlist — and `would_block` is `null` (not `false`) when the
shadow decision was itself a `lookup_failed`, because the engine genuinely does
not know. `_allowlisted_decision` never copies `rule_level`, so an exempt
decision's rule level is always `null`.

### `/api/metrics/category_slugs` — the flat-envelope exception

This route returns a raw `JsonResponse`, so the payload is **not** nested under
`data`:

```jsonc
{ "slugs": [...], "category": "geofence", "account": "global", "status": true }
```

The `account` default is `"public"` while `metrics.record()` defaults to
`"global"` — so a geofence slug is invisible unless `account=global` is asked
for explicitly. `get_category_slugs` returns a **set**, so slug order is
nondeterministic and no consumer may depend on it.

## The rule DSL and the guided↔advanced projection

Top-level keys `{country, region, abuse}`; operators `{in, not_in, eq}`; abuse
flags `{tor, vpn, datacenter, proxy}`. Abuse semantics: `false` blocks when the
flag is detected, `true` REQUIRES the flag (rare), absent/`null` means don't
care.

`geofence-data.ts` is the ONE definition of the lossy projection between that
DSL and the friendly form. `apps/portal/src/pages/group-sections/geofence-data.ts`
is a re-export shim over it, so the platform page and the group panel cannot
drift. `GeofenceRuleEditor` is the ONE editor both render.

The projection's contract:

- `isAdvancedRule(rule)` — true for anything the guided form cannot represent:
  unknown top keys, non-dict bodies, `country.eq`, multiple operators, an
  allow+block mix, any `region` shape other than a single `not_in` of US state
  codes, and any abuse `true` or unknown flag.
- An advanced-forced rule **opens in JSON with no toggle** — flipping to guided
  would silently drop clauses.
- The toggle back to guided **refuses** invalid JSON and unrepresentable shapes;
  the guided→JSON direction carries unsaved edits across.
- `buildGroupRulePayload(old, new)` — GROUP layer only. django deep-merges
  JSONFields (`null` deletes a key; nested `__replace` is NOT supported), so the
  payload is the new value for every kept key plus explicit `null`s for anything
  removed. Sub-keys are **allowlisted**, so a `__replace` typed into the advanced
  editor is dropped rather than PATCHed into stored metadata.
- The platform layer never merges: `POST /api/geo/rules` is a full replace, and
  the two surfaces share no save path. **The group surface can only tighten and
  can never write platform rules; the global surface never writes group
  metadata.**

Every reason code in `engine._DETAIL_MAP` has plain-language copy, including
**`no_rules_strict`** — the strict-posture denial web-mojo had no text for.
An unknown code degrades to a readable fallback **and warns once**.

## Event metadata keys

`services/geofence/evidence.py` writes, for `geofence_block`: `reason`,
`rule_level`, **`geofence_scope`**, `country_code`, `region_code`, `abuse`,
`detail`, and `username` when the request was authenticated. For
`geofence_exempt`: `reason`, `geofence_scope`, `allowlist_source`,
`allowlist_reason`, `would_block_reason`, `country_code`, `region_code`. For
`geofence_config`: `target`, `old`, `new`, **`changed_by`**, `changed_by_id`.

Two keys this module reads that web-mojo got wrong:

- It is **`metadata.geofence_scope`**, never `metadata.scope`. The reporter
  never passes the reporter's `scope=` argument, so the top-level `Event.scope`
  column stays `"global"` for every geofence row.
- The config "who" is **`metadata.changed_by`** (a username), falling back to
  `metadata.user_name` (the display name, written by
  `reporter._create_event_dict`). `metadata.username` is written by neither.

`Event.country_code` is a real indexed column — `Event.sync_metadata` fills it
from the geolocated source IP — so country filtering uses the column, not the
metadata copy.

`_block_level`: **7** rule_invalid (a broken rule is denying traffic; the default
incident threshold auto-creates an Incident) · **6** lookup failure while failing
open (enforcement silently is not happening) · **5** abuse-flag block, a block on
a fail-closed scope, or any block under strict posture · **3** ordinary
jurisdiction block, exemption used, or config change.

## IP sets

`KIND_CHOICES` are `country · datacenter · abuse · custom`. `SOURCE_CHOICES` has
**five** members — `ipdeny`, `abuseipdb`, `tor`, `blocklist_de`, `manual`.
web-mojo listed three, so the two cache-only rows showed a raw slug and could not
be filtered.

### Records are created disabled, and `is_enabled` is never a plain field

`on_action_enable` is the **only** path that runs the cache-only rejection.
Writing `is_enabled` as a plain field produces a row that reads "Enabled" and
silently never syncs, because `sync()` no-ops for a cache-only set without
raising. So:

- the create form has no enable switch and the POST body carries no
  `is_enabled` — a set is created **staged**;
- the edit form has no `is_enabled` either;
- enabling and disabling are armed **actions**.

Direct #1097 lineage; the verifier asserts it against source.

### `tor_exits` and `blocklist_de` are cache-only

`IPSet.THREAT_CACHE_SETS`. They exist to feed GeoIP threat *detection*, not the
kernel firewall. `enable` answers a 400 that names the set:

> `'tor_exits' is a cache-only threat list for geoip detection — enabling it
> would kernel-block every listed IP fleet-wide and is not permitted`

The UI surfaces that message verbatim, chips the rows **CACHE-ONLY**, and
excludes them from the batch Enable and Sync eligibility so a mixed selection
still succeeds for the rest.

### `data` must be posted as a LIST

`IPSet` defines `set_data(cidr_list)` = `"\n".join(cidr_list)`, and
`on_rest_save_field` prefers a `set_<key>` method over a plain assignment. So a
posted `data` runs through the setter:

- a **JSON list** is correct, and `cidr_count` is recomputed from it;
- a **string** gets a newline interleaved between every *character* and
  `cidr_count` becomes the character count.

web-mojo posted the raw textarea string. `parseCidrLines()` is the boundary here;
the mock reproduces both behaviours so the trap stays executable.

This also corrects a claim recorded during scoping: `cidr_count` is **not**
frozen at 0 for manual sets forever. It is stale only until the list is next
*written* — by a source refresh, or by saving the list from the editor.
`refresh_from_source()` really does return `False` immediately for
`source == 'manual'`, so the *refresh* path alone can never update it. The CIDR
Data tab shows the parsed line count beside the stored one whenever they differ.

## Firewall log — column honesty

`GeoLocatedIP` writes these rows through `MojoModel.log`, which fills `path`,
`ip`, `username` and `uid` from the **ambient request** — the admin's endpoint
and the admin's address. The blocked address lives only in `payload.ip`.
web-mojo labelled `path` as "IP / Path", which was never either.

The four `kind` values are exact, and the payload shape is **not** uniform:

| kind | payload keys |
|---|---|
| `firewall:block` | `ip, reason, ttl, blocked_until, block_count, trigger` |
| `firewall:unblock` | `ip, reason, trigger` |
| `firewall:whitelist` | `ip, reason, until, was_blocked, trigger` |
| `firewall:unwhitelist` | `ip, trigger` |

## Blocked IPs

The `is_blocked=true` projection over #1291's `GeoLocatedIPModel`. This module
defines **no** model for `/api/system/geoip` — one endpoint, one `defineModel`,
one cache key.

- **Enforcement is computed.** `block_active` and `whitelist_active` are Python
  properties serialized only on the `basic` graph, so `blockActive(row)` /
  `whitelistActive(row)` (#1291's helpers) decide the State column: a whitelist
  beats a block, an expired block stops enforcing, and `is_blocked` stays set
  either way.
- **`blocked_until = null` means PERMANENT** and renders "Never", not blank.
- The threat filter is a multiselect over the four real values plus an explicit
  `threat_level__isnull` filter. web-mojo offered a literal `none` value that
  matched no row on any deployment.
- The search placeholder names the model's real `SEARCH_FIELDS`
  (ip / city / country name / ASN org / ISP). There is no rule text on this model.
- Batch **Unblock** and **Whitelist** collect one reason per batch through
  `prepare`; whitelist sends the DICT form `{reason, until}` so the audit trail
  and `whitelisted_until` are both real (the source sent a bare string).

## Exemptions and the full-replace race

`POST /api/geo/allowlist` replaces the whole `GEOFENCE_ALLOWLIST` setting, so a
stale local copy silently deletes a concurrent editor's entry. Every write here
**refetches and compares first** and aborts with an explanatory message when the
server list has moved (`AllowlistRaceError`). An empty list is a legitimate
CLEAR, not "no change" — removing the last entry asks explicitly.

Expired entries are listed with `active: false` and rendered inactive, never
hidden: an auditor needs to see that an exemption existed.

Removing an individual IP whitelist resolves the record through a **cached read**
(`?ip_address=`), not `/geoip/lookup` — the row exists by definition, so removal
costs no provider call and no rate-limit budget. Adding one does use `/lookup`,
because the address may never have been seen.

## Degrading on a backend without the config plane

`/api/geo/*` is simply **not registered** on an older django-mojo, so the wire
answer is a **404**, not an error envelope. `isGeofenceApiMissing(error)` is the
branch; the copy names the documented floor (v1.2.42) as prose and asserts no
version the client can verify — there is no version endpoint. Any other status
shows the server's own message.

## Armed confirmation

Anything that reaches the fleet is an `ArmedButton` whose armed label names the
blast radius: the rules replace (with a plain-language clause diff), override
removal, ipset enable / disable / sync / refresh / delete, allowlist removal and
whitelist removal. Operations that need input (a reason, an expiry) use
`formModal` instead — an armed button cannot collect input.

## Absent by design

Do not add these back.

1. **Batch delete of IP sets.** Multi-selecting kernel firewall sets and deleting
   them in one irreversible action is exactly the shape #1097 warned about.
   Delete is single-record and armed, from the detail modal.
2. **Creating a block from the Blocked IPs table.** The backend supports it and
   web-mojo did not expose it either. Unblock and whitelist — both *relaxing* —
   are exposed.
3. **Editing geofence posture.** `GEOFENCE_ENABLED`, `GEOFENCE_FAIL_CLOSED`,
   `GEOFENCE_FAIL_CLOSED_SCOPES`, `GEOFENCE_CACHE_TTL` and
   `GEOFENCE_STRICT_POSTURE` are plain `Setting` rows with no validated
   geofence-specific endpoint. The header is read-only and points at Runtime
   Settings.
4. **Granting or revoking `bypass_geofence`.** The backend's own comment says
   grants are managed on user records, and the endpoint returns id/username only
   to avoid leaking user PII through a geofence-only grant.
5. **A world map / choropleth.** Owned by #1426 and reserved. The ranked country
   list ships instead and is the same server-derived dataset.
6. **A general GeoLocatedIP administration table.** That is #1291's IP
   Intelligence section; the Blocked IP modal links to its dossier.
7. **`geoip_sync` / federation controls.** Fleet-peer plumbing, not perimeter
   operation.
8. **Event deletion or editing from the blocks log.** The evidence plane is
   append-only by design.
9. **A client-side "top blocked countries" computed from the visible page.** It
   would lie about totals whenever the page did not cover the window.

## Verification

```bash
node scripts/verify-admin-network.mjs   # or: npm run verify:admin-network
```

Headless assertions over the nine permission clauses, section registration and
route generation for both mounts, the full `geofence-data` mapping table
(`isAdvancedRule` truth table, form round trip, `buildGroupRulePayload` null-out
and sub-key allowlist, `coerceRuleInput`, `collectScopes`, `describeDecision`
over every `_DETAIL_MAP` code, `describeWouldBlock` including the nullable
shadow, `buildSimulateBody`, `diffRules`), the editor's two refusals, the app
shim proving ONE module by identity, the source-shape rules (no route/right-panel
inspection, `modal.detail` present, no `is_enabled` write, no batch delete, no
block creation, a read-only posture header), the persona 403 matrix across
`/api/geo/*`, `/api/incident/ipset` and `/api/system/geoip`, and the mock wire:
graph exclusions, the cache-only 400, the create-disabled default, the
list-vs-string `data` trap, name uniqueness, delete-perm narrowness, DSL and
allowlist validation, the empty-list clear, top-level `enabled`, the exempt
shadow fields, the firewall Log trail with its per-kind payload shape, and the
flat `category_slugs` envelope. Plus theme byte-identity and tokens-only CSS.
