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

Portal and Showcase both import `theme/admin-dns-certificates.css`, which uses
semantic tokens only. The executable demo is **Develop → Components → DNS
certificates & ACME** with manager, viewer, platform-house, and unconfigured
legs. Run:

```bash
npm run verify:admin-dns-certificates
npm run verify:admin-dns
npm run verify:admin-dns-records
```

Live verification is read-only. Do not request or revoke a real certificate
without separate operator authorization.
