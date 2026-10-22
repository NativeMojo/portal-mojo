# Admin DNS certificates and ACME lifecycle

Import from `portal-mojo/admin`:

```tsx
import {
  CertificatesPage, CertificateDetail, CertificateRequestDialog,
  DomainCertificatesSection, CertificateLifecyclePoller,
  CertificateModel, deriveCertificateRenewalHealth,
  deriveCertificateReadiness,
} from 'portal-mojo/admin';
```

## Route, gates, and presentation

`DNS_ADMIN_SECTION` contributes `dns/certificates` between DNS Records and
Provider Credentials. Like the rest of Admin it is global and no-group:
`sys.view_dns | sys.manage_dns | sys.security` opens the route and
`sys.manage_dns | sys.security` offers request/revoke. Tables own search,
status/domain filters, paging, and sort in the URL.

Row inspection uses `modal.detail`; requesting and confirming revocation use
small native KISS modals. `DomainDetail` composes the bounded
`DomainCertificatesSection` rather than adding a child route.

Certificate detail and revoke have an extra backend rule: when the hydrated
owning Domain has `group=null`, only a literal interactive superuser may open
or revoke it. A global `manage_dns` grant is not enough. The client hydrates
the Domain before fetching certificate detail, checks `me.is_superuser ===
true`, and gives a generic unavailable answer on denial so it does not become
an additional house-inventory oracle. The server remains authoritative.

## Wire contract and cache boundary

```text
GET  /api/dnsman/certificate?graph=default
GET  /api/dnsman/certificate/<id>
POST /api/dnsman/certificate/request {domain, names?}
POST /api/dnsman/certificate/revoke  {certificate}
GET  /api/dnsman/delegation?domain=<id>
```

Only `graph=default` is accepted. Certificate export/download params are
rejected, not silently forwarded. The graph carries lifecycle metadata and a
basic Domain relation; it carries no `cert_pem`, `chain_pem`, private key,
ACME order URL, secret container, or arbitrary metadata. There is deliberately
no client helper or mock handler for `certificate/material/<id>`.

All list/detail rows pass through `sanitizeCertificateRow` in the Query
function, before TanStack Query stores them. It normalizes lifecycle status,
lowercase/trailing-dot-free SANs, finite timestamps/counts, a small Domain
projection, and a bounded/redacted `last_error`. Unknown/equivalent private
containers drop by construction. Delegation payloads retain only the backend's
public status shape; credential readiness uses the already-sanitized masked
credential model.

Request and revoke are imperative, single-flight, and non-retrying so an
ambiguous transport cannot duplicate an external CA operation. They do not use
MutationCache. A `finally` reconciliation invalidates/refetches active
certificate queries after success or failure. If authoritative refresh also
fails, repeat is blocked by an explicit “may have persisted; refresh first”
error.

## Names and readiness

The request dialog normalizes names to lowercase ASCII without trailing dots,
deduplicates them, permits a wildcard only as the leading `*.`, and requires
every SAN to be the selected zone or a descendant. Empty names intentionally
omit `names`, letting the backend request the apex plus wildcard.

Readiness is backend-authoritative:

- ACME must be configured and the Domain active.
- Route 53 uses direct DNS-01.
- GoDaddy direct DNS-01 also needs its active, verified masked credential.
- `provider="mojo"` needs a verified delegated-ACME row.
- Once a delegation has `verified_at`, it is sticky. A later `broken` row
  blocks issuance; the UI never claims direct-provider fallback.

`config.acme.staging` describes the deployment's current directory only. The
certificate model stores no historical staging provenance, so existing rows
are never labeled trusted or staging from that flag. New staging requests get
an explicit “not publicly trusted” warning.

## Renewal and polling

`renew_after` is the authoritative renewal trigger. `days_remaining` is only
display. `CertificateLifecyclePoller` owns one timer per mounted certificate
surface, at 10 seconds and at most 36 ticks:

- new issuance follows `pending | issuing` to active/failed/revoked;
- a due active renewal records attempts/validity/error baseline, waits through
  the initial active state and optional `issuing`, then stops on an observable
  success or failure;
- an already-active row with `last_error` is a terminal renewal error and does
  not start ordinary polling;
- timeout, unmount, and terminal state clear the timer.

This avoids one interval per row and avoids an endless poll on the backend's
valid “renewal failed but still-valid certificate remains active” behavior.

## Mock, themes, and verification

The central mock contains pending, issuing, healthy active, due renewal,
active renewal-error, failed, revoked, house, verified delegation, broken
sticky delegation, staging, unconfigured, and malformed-response evidence.
Its only custody fixture is a private `material_present` boolean; no PEM is
stored or serialized.

`src/styles/components/admin-dns-certificates.css` ships in
`portal-mojo/styles.css` and uses semantic tokens only. The executable demo is **Develop → Components → DNS
certificates & ACME** with manager, viewer, platform-house, and unconfigured
legs. Run:

```bash
npm run verify:admin-dns-certificates
npm run verify:admin-dns
npm run verify:admin-dns-records
```

Live verification is read-only. Do not request or revoke a real certificate
without separate operator authorization.

## Shared validation setup

Use **Domains → Advanced → Shared validation setup**, or **Set up shared validation** in a
group-managed Domain or Certificate header menu. Domain **Advanced validation** and
Certificate **Delegation** show the same read-only facts. No new route or sidebar
resource is added. The flow never reads certificate material.

1. Select an authorized existing local Domain, or an eligible group and exact
   apex name. Group selection uses `/api/dnsman/delegation/group-choice`, bounded
   `search/start/size` and explicit `?id=` hydration. Product active-group context
   and credential group choices do not authorize shared setup.
2. Enter the existing public allocation target supplied by its controller and
   **Inspect plan**. Inspection creates no connection or reference.
3. **Prepare connection** and confirm the displayed domain/profile/target.
   Preparation pauses direct local validation and renewal until authorization
   and checking finish. Existing valid certificate material remains available.
4. **Download request** saves `shared-validation-request.json`. Send it to the
   allocation controller using your normal coordination channel. **Share request**
   uses native file sharing when supported; **Copy request** is optional. Download
   stays available after copy/share denial or cancellation. The canonical file is
   at most 2048 UTF-8 bytes and has exactly `version:1`, `consumer_project_uuid`,
   `client_ref`, `domain`, `allocation_ref`, with no wrapper, key, token or scope.
5. The controller opens their deployment’s **Domains → Advanced → Shared validation setup →
   Controller review**, checks access and uses **Import request**. There is no JSON
   editor or controller URL. Empty, oversized, malformed, noncanonical or extra-field
   files are refused before installation. Import alone grants nothing. The named
   public fields fill the exact domain query; **Find allocations**, page if needed
   and select the exact existing target. Only a matching request and resolved active
   exact recipient enable **Review grant**, then **Allow issuance** after consent
   names both apex and wildcard authority. No allocation is created.
6. Back in the project, **Refresh**, **Connect approved validation**, then
   **Check validation**. These are separate deliberate actions. Check requires
   the approved existing one-hop `_acme-challenge.<apex>` CNAME.
7. **Request wildcard certificate** issues this deployment's own apex-plus-
   wildcard certificate. Existing valid exact-profile certificates remain in
   place; queued work stays queued and due renewal reuses its lineage. Watch
   the local certificate and separate renewal status, or Refresh after timeout.

Only global DNS managers (`sys.manage_dns | sys.security`) see local mutation
controls, and every action also requires the backend's current per-target flag.
Controller operations additionally require v2 `shared_validation` and
`can_manage_trust`, then exact-allocation authority. A human controller can have
`can_consume:false`; local project setup uses the server-held project identity
independently. Ordinary DNS managers cannot grant themselves trust. Groupless
house domains are read-only and ineligible in this rollout; direct operation
remains available and Portal never assigns a group automatically.

### Local API and safe state

| Method | Local route under `/api/dnsman` | Input |
|---|---|---|
| GET | `delegation/plan` | `{domain}` or `{group,name}`, optional `allocation_ref` |
| POST | `delegation/connect` | Same target plus `allocation_ref`, optional explicit `restart:true` |
| POST | `delegation/check` | `{delegation:<local id>}` |
| POST | `delegation/request` | `{delegation:<local id>}`; no custom SANs, force or keys |
| GET | `delegation/group-choice` | `id` or bounded `search/start/size` |

All setup actions return Readiness v1. Portal strictly projects only public
metadata and validates version, selected identity, source/target, fixed profile,
booleans and enums. Expected 409s can include the same safe readiness DTO.
Unknown containers and provider error text are discarded before state. Plans,
descriptors and controller identities are modal-local; no draft is persisted or
written to URLs, diagnostics or logs. Writes are imperative and non-retrying,
freeze the scope, recheck auth/session/permission before send, and reject late
responses after scope loss. After every attempted write, safe Domain,
Certificate and legacy delegation caches are invalidated and plan/trust is
refreshed. Ambiguous results require successful Refresh before another write.
A 440 prompts authentication but never automatically repeats the operation.
Every explicit session replacement, including the same user signing in again,
clears controller capabilities, recipients and participant facts. Check controller
access and select an authorized allocation again. A new grant also requires a matching imported request and freshly resolved active recipient.
Closing a view cannot cancel a write already submitted.

Controller POSTs use only the local `/api/dnsman/acme` endpoints:
`capabilities {}`, `allocation/list {domain,cursor?}`,
`trust/list {allocation_ref,cursor?}`,
`trust/recipient {allocation_ref,consumer_project_uuid}`,
`trust/grant {connection_request}` and
`trust/revoke {allocation_ref,participant_ref}`. Each page contains at most 20
rows. Only a capability-approved controller probes the allocation/trust routes;
there is no arbitrary project directory, remote hub call, key provisioning or
consumer/status call from a human JWT. Recipient and allocation authorization
are repeated server-side on every operation.

### Operator setup and mixed versions

If the local plan says the hub is unconfigured or misconfigured, a deployment
operator uses the existing server configuration delivery to set
`DNSMAN_ACME_HUB_URL` to the already-used Maestro hub and
`DNSMAN_ACME_HUB_API_KEY` to the already-provisioned protected project key in
Django settings, normally `VAR_ROOT/django.conf`. Upgrade the hub first, then
project API and every certificate worker; drain/restart old issuance workers
before shared connections are accepted. Restart application and worker
processes and **Refresh Portal**. A responsive API does not prove that workers
were restarted; worker version is unknown unless authoritative telemetry exists.
These settings are static deployment configuration, never DB Setting overrides,
browser fields, arbitrary per-site URLs or values copied into descriptors.

404/405 and unsupported new versions disable only shared setup; existing strict
DNS config, direct-provider and legacy single-consumer certificate paths retain
their contracts. 401/403 report access refusal instead of suggesting an upgrade.
Disabled sharing, unconfigured/auth-rejected/unavailable hubs and unknown proof
never display setup as complete. Portal does not bypass backend activation.

### Repair and revocation

ACME validation and traffic routing are separate. The validation CNAME does not
route apex/www/API/app traffic. Follow the deployment's separate A/AAAA/CNAME
traffic instructions. Missing, changed or chained validation proof shows the
expected and bounded observed target and its check time. Ask the domain owner
to restore the approved one-hop route after checking other consumers. Portal
does not replace/remove that CNAME or rotate the allocation as a default repair.

Controller maintenance starts cold with **Check controller access**, an **Exact
 domain** and **Find allocations**. Native choices show target and owner UUID.
**Next allocation page** / **First allocation page** and **Next project page** /
**First project page** navigate bounded 20-row pages. Select an allocation to
inspect participants, role, state, exact scope and revoked time. No request file
or recipient lookup is needed for this path. An imported inactive consumer can
fail recipient lookup while participant inspection, revoke and cleanup remain
available. Owner participants cannot be revoked. **Refresh trust** checks current
capabilities; an unsuccessful reconciliation blocks mutation until refresh succeeds.

Controller revocation stops future DNS-01 validation for that project. Already-
issued certificates remain valid until expiry or separate certificate revocation,
and other trusted projects keep working. A 503 may occur after revocation was
persisted; refreshed trust can say revoked while DNS cleanup remains unconfirmed.
Retrying cleanup never regrants the reference. A revoked reference cannot be
revived: the project must explicitly confirm **Prepare fresh request**, keep
the existing target, and obtain a new exact controller grant.

A valid local certificate with blocked/failed/retrying renewal is shown as
“valid until …; renewal needs attention.” It is not labeled expired or revoked
as a repair. Material custody is API-node evidence, not proof that any serving
host installed that certificate. Shared pending/broken/revoked routing never
permits fallback TXT writes through the direct provider. Private keys stay in
each deployment.

The mock showcase includes deterministic controller-maintenance pages and an inactive consumer, plus the complete project/controller handshake, viewer,
revoked, pending/changed/chained DNS, disconnected/unconfigured/disabled hub,
older API, failed renewal and 390px embedded-content scenarios. Scenario changes
reset mock shared state; identity changes preserve it. Leaving the demo restores
its default mock identity and scenario. `verify:admin-dns-shared-validation`
runs API/projection and React StrictMode mounted contracts. Real browser proof
remains required for focus, native-dialog stacking, clipboard and both themes.

Owner and consumer project identities preserve existing lowercase16hex Group
IDs as well as the previously supported32hex and canonical UUID forms. They
are compared exactly and never padded, regenerated or rewritten. Client and
participant references retain their strict UUID validation; a short project ID
cannot stand in for either reference.


Shared setup prerequisites now link literal deployment operators to the actual
mount-aware Fleet shared-validation connection topic. It owns named approved
profiles, write-only protected keys, expected/observed identity and revision-bound
Preview/Publish/Apply. Ordinary DNS managers receive a concrete domain, next
action and checked-time handoff with no private inputs or private API background
calls. This route does not perform the protected hub activation ceremony.
