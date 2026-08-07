# Admin DNS

Import from `portal-mojo/admin`.

`DNS_ADMIN_SECTION` mounts Domains, DNS Records, Certificates, Domain Purchases,
Registrant Contact, and Provider Credentials under `dns/` (or `system/dns/` embedded). Its global view gate is the ANY-of
clause `sys.view_dns | sys.manage_dns | sys.security`; mutations use
`sys.manage_dns | sys.security`. Member grants cannot satisfy either clause.

## Capability gate

`useDnsCapabilities(group?)` reads `/api/dnsman/config`. The parser is strict:
every flag, limit, provider capability, ACME field, and delegated-ACME field
must be present with the correct type. There are no provider or feature
defaults. Until that contract succeeds, dependent controls do not render and
the page shows **DNS administration unavailable**.

Provider controls are derived only from the response. A provider is offered
for credential linking only when it reports `requires_credential: true`.

## Safe models and operations

The package defines `DomainModel`, `DnsCredentialModel`,
`DomainPurchaseModel`, and `CertificateModel`. Their endpoints and graphs are
pinned and list params are allowlisted; export params are not accepted.
Defence-in-depth sanitizers are explicit safe-graph projectors. Only approved
scalar fields and approved sub-fields of group, user, credential, and domain
relations survive; unknown or equivalent secret containers drop by default
before data reaches TanStack Query.

DNS records, registrar search/suggest/quote/purchase, house-domain adoption,
registrant contact, WHOIS, and certificate request/revoke use typed imperative
helpers. There is deliberately no certificate-material helper.

House discovery returns the live `{count,truncated,domains}` contract. Each
domain includes registration/hosted-zone presence, safe zone metadata,
tracking/adoption state, and a reason. `untracked=true` returns only untracked
rows; discovery and assignment remain interactive-superuser operations.

The operator registrar workflow is documented in [admin-dns-registrar.md](admin-dns-registrar.md). It does not use discovery: House adoption is manual exact-name only. Purchase tokens remain transient, all post-confirmation outcomes reconcile through the read-only ledger, and contact PII remains imperative/local.

These responses require local call-flow handling and must never enter Query or
Mutation cache, logs, URL state, or mock state:

- provider API keys and secrets;
- registrar confirmation tokens;
- registrant and WHOIS contact PII;
- certificate PEM, chains, and private keys.

## Provider credentials

`ProviderCredentialsPage` is a server-driven `ModelTable`. Search, filters,
sorting, and paging go to django-mojo. It has no export and no detail route.
Clicking a row opens a compact `modal.detail`-style KISS surface showing only
masked key/secret values and verification health.

Link and rotation submit raw values through a fresh-auth imperative POST to
`/api/dnsman/credential/link`. They are held in uncontrolled password refs,
cleared after every attempt, sanitized before any explicit cache write, and
the credential queries are invalidated in `finally`.

The link picker uses only `/api/dnsman/credential/group-choice` with bounded
`search/start/size` listing. A stored ID is hydrated through the exact
`?id=<id>` form. The full selected object is held by `CollectionSelect`, so it
never invents `/group-choice/<id>`, reads an active group context, calls
`/api/group`, or accepts a free-form ID.

Verification is transactional at the UI boundary: a failed first link adds
nothing; a failed rotation rejects, preserves the previous masks/encrypted
pair, and refetches the now-unverified row with its provider error. Successful
verification replaces the masks and marks the row verified. Viewer-only users
can inspect safe rows; managers can link, rotate, activate/retire, and arm
deletion.

## Themes and showcase

The page composes existing portal primitives and semantic tokens; it adds no
fixed colors or theme-specific stylesheet. The executable three-leg showcase
is **Develop → Components → Admin → DNS**: live manager lifecycle,
viewer-only contract, and malformed-capability unavailable state.
