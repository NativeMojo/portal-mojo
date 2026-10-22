# Domains

Import `DomainsPage` from `portal-mojo/admin/infrastructure`. The global DNS
inventory lives at the host's `/dns/domains` mount. Server search, filters,
sort and paging stay on `DomainModel` with `admin:dns:domains` persistence.
Scope comes from each row, never the active product group. An absent expiry
means **Unknown**, not Never. Narrow layouts combine provider, scope and status
under the name so the Records action stays visible.

## Everyday tasks

**Add domain** opens three explicit choices: **Connect GoDaddy domain**,
**Buy domain**, and literal-superuser **Adopt Route 53 zone**. Purchasing has its
own read-only ledger shortcut. **More domain actions → Shared validation setup**
keeps external-domain/controller setup available without an existing domain.
Viewers get inspection and Purchases; writes require global
`sys.manage_dns | sys.security`. Platform adoption/assignment additionally require
literal interactive `is_superuser`; backend gates remain authoritative.

A row opens a compact native dialog with Overview, provider-applicable DNS
records, Certificates, and manager Registration. It has no side rail or nested
registration disclosure. Only the selected task mounts. The same record panel
serves the standalone Records page; its type filter is controlled by that page's
URL or locally when embedded. Serving is an explicit sibling route under the
observed Admin mount. Extra registered domain links retain their own gates.

## Connect, repair and adopt

Connect selects one explicit authorized group through bounded
`/api/dnsman/credential/group-choice`, then an active, verified GoDaddy
credential in that exact group. Changing group clears credential state and
fences late replies. **Link credential** opens the existing write-only credential
editor locked to that group; a verified return resumes the same domain draft.
There is no generic group list, free-form group id or provider-account discovery.
The ownership probe sends exactly `{ group, domain, credential }` and spends no
money. Domain names are normalized before submission.

An existing GoDaddy domain with an unusable linked credential offers **Repair
linked credential**. Rotation verifies the same credential/group, clears raw
password refs, then refreshes safe credential and domain projections. This does
not expose an arbitrary credential-FK reassignment: the backend has no same-group
validation for that generic save. A domain with no linked credential cannot be
silently attached to a newly linked one.

Adoption reviews one exact existing public zone name and Platform scope before
posting `{ domain }`. It never supplies `group`/`create_zone` or discovers the AWS
account. Native dismissal is guarded during review and mutation. Cancel review
writes nothing. Unknown onboarding outcomes require inventory/provider review;
submitted forms never repeat their request.

A Platform domain offers **Assign to group** to literal superusers. Choose the
destination, review domain/from/to, and type the exact destination name. The UI
checks current authority, current domain ownership and the exact authorized group
again before `{ domain, group }`. Already-grouped rows never offer reassignment.
A lost receipt retains **Refresh owner** and refuses replay, even if the fresh
read still says Platform; a read cannot prove an older write has finished.

All onboarding writes check their owner at the transport's `beforeSend` boundary,
after any asynchronous auth refresh. Credential/purchase step-up continuations
perform that same check. A replacement session never inherits old consent.

## Registration

Registration starts with an explicit manager-only **Read registration**. WHOIS
contacts stay in the mounted dialog, outside Query, URLs, storage and logs.
Route 53 DNS hosting alone never admits registrar edits: the returned registrar
must identify Amazon Registrar/Route 53. Hosted-zone-only, unavailable or unknown
registrations remain read-only. GoDaddy registration tasks hand off to its account;
Mojo remains certificate-only. No manual Renew action is invented.

Confirmed Route 53 registration offers focused settings and contacts dialogs.
Auto-renew uses the existing best-effort boolean save; privacy uses its dedicated
all-contact action. Fresh owner/registrar/value preflight precedes writes. Only
live WHOIS readback can establish observed values; an accepted DB save is not
provider proof. Unknown outcomes lock the submitted editor and never replay.
An unchanged desired DB value may not re-run a failed model hook; the registrar
account handoff remains available.

Contact inspection groups identity, email/phone and postal address. Identical
Registrant/Admin/Technical contacts share one view; differing contacts get useful
role tabs. Editing keeps one draft across Contact/Address tabs. **Replace all
contacts** explicitly replaces all three roles, matching the backend contract.
Entering edit mode never submits. Registry extension fields are preserved locally.
Pending operations guard tab switches, native dismissal and repeated writes.

## Purchase and QA

Buying is restricted to one quoted year until the backend binds multi-year
payable totals. Privacy limits and acknowledged downgrades stay visible.
See [registrar flows](admin-dns-registrar.md) for exact confirmation and recovery.

`verify:admin-domains` includes delayed-auth transport fences.
`verify:admin-domains-mounted` runs onboarding, assignment/filter/credential,
registration and purchase/contact journey contracts, including StrictMode and
stale-session/scope cases. JSDOM establishes behavior only. Closing acceptance
uses actual Portal and built Showcase screenshots and interactions in light/dark,
desktop and 390px; see [visual QA](admin-presentation.md). No live registrar
purchase or infrastructure mutation is required for this mock acceptance.
