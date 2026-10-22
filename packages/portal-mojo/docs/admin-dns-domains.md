# Domains

`DomainsPage` is the everyday global DNS inventory at `/dns/domains`, under the
host Admin mount. Import it from `portal-mojo/admin/infrastructure`. It keeps
`DomainModel`, the `admin:dns:domains` table persistence key and server search,
provider/status filters, sorting and paging. Scope comes from each row's group
or Platform; the active product group is never used.

The header exposes **Register existing**, **Adopt**, and **Buy domain**. Register
and Buy need global `sys.manage_dns | sys.security`. Adopt also needs literal
`me.is_superuser === true`; the backend independently refuses noninteractive
and key-backed authority. Viewer sessions can inspect domains, DNS records and
certificates without mutation controls.

## Explicit onboarding

`showDomainOnboarding()` preserves its original menu. An optional
`{ initialMode: 'menu' | 'register' | 'adopt' | 'purchase' }` opens a workflow
directly. The page imports the dialog only after a button click.

Register existing selects one authorized group from bounded
`/api/dnsman/credential/group-choice`, then an active verified GoDaddy
credential queried through `DnsCredentialModel` with exact group/provider and
verification filters. No credential selector mounts before an explicit group.
The selector remounts by group, clears its selection on group change and rejects
resolved credentials from another group or unsupported/unusable credentials.
There is no `/api/group` read, free-form group id, provider-secret input or
provider-account enumeration. The exact normalized name is probed for ownership
without spending money. The only body is `{ group, domain, credential }`.

Adopt takes one normalized existing public zone name, then explicitly reviews
that name and Platform scope before posting `{ domain }`. It never supplies
`group` or `create_zone`, discovers inventory or assigns a tenant. Review and
mutation guard native dialog dismissal; Cancel review performs no mutation.
Registration/adoption use an immediate single-flight ref. An unknown outcome
invalidates inventory and requires operator review before starting another flow.

Buy preserves the bounded typed-TLD, prerequisite, tri-state search and durable
ledger flow documented in [the registrar reference](admin-dns-registrar.md).
The purchase body is exactly `{ group, purchase, confirm_token, confirm_domain,
confirm_price }`. Name and decimal price come from the immutable validated quote,
not editable confirmation inputs. The quote token is removed from its mounted
ref before the operation and kept transient through `withFreshAuth`; only a 440
may resume the identical body once. Cancelled step-up and other failures never
replay. An attempted purchase is terminal in that mounted wizard and reconciles
against the durable ledger, including ambiguous provider outcomes.

## Inspection and registrar settings

A row opens the standard `modal.detail` overview. Server-owned name, provider,
status, scope, registration/expiry dates and redacted failure remain read-only.
DNS Records is a direct shortcut for Route 53 and GoDaddy; Mojo explains its
certificate-only limitation. Shortcuts derive their mount from the observed DNS
route, so root, `/admin` and embedded prefixes work. Serving links explicitly
navigate to the mount's sibling `/edge/vhosts`; they are outside the registry
whose routes are relative to `/dns`.

Only Route 53 managers receive **Registrar settings**. Its focused guarded native
modal sends only changed boolean `auto_renew`/`privacy` fields to the existing
generic domain save endpoint. It never edits group, credentials, raw metadata,
protected fields or registrar contacts. Every attempted save authoritatively
refetches and invalidates DomainModel, including rejection. HTTP success alone
is not registrar success: a nonempty `last_error` stays visible with a historical
warning and instructions to inspect the registrar. Uncertain writes keep the
modal open, disable additional writes and require review. There is no automatic
retry. GoDaddy registrar/privacy/WHOIS management remains in GoDaddy; Mojo is
certificate-only. Unknown providers remain labeled and read-only.

## Advanced validation

**Domains → Advanced → Shared validation setup** opens without an existing
domain, preserving external-domain consumer setup and controller review.
Domain detail retains Advanced validation, DNS Records and Certificates sections,
existing registered related links and the permission/readiness-gated setup action.
Descriptor import/export, TLS paths and shared-validation protocol are unchanged.

## Verification and showcase

`verify-admin-domains.mjs` exercises the independent strict purchase peer,
fresh-auth continuation/cancellation and ambiguous no-replay. Its central mock
contract leg requires missing/mismatched name and decimal-price tuples to leave
the quote unspent. `verify-admin-domains-mounted.mjs` mounts real wizard, picker,
page and editor components to prove scope isolation, action authority, deliberate
adoption, registrar reconciliation and mount-aware navigation. The closing browser
pass supplies native focus, responsive layout and light/dark evidence.

The focused **Admin → Domains** showcase uses mock manager, platform and viewer
identities and preserves every earlier DNS showcase.

### KISS presentation

Domain/provider share one table cell. The page header owns registration/adoption/purchase; technical registrar facts are in Registration details. Provider warnings remain visible. See [visual QA](admin-presentation.md).
