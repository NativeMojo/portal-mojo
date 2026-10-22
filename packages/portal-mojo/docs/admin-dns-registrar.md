# Admin DNS registrar and registrant contact

Import `DomainPurchasesPage`, `DomainPurchaseWizard`, `showDomainOnboarding`, and `RegistrantContactPage` from `portal-mojo/admin`.

The global, no-active-group DNS workspace mounts `purchases` and `registrant` between Certificates and Provider Credentials. Purchase-ledger viewing uses the global DNS view clause. Search is read-only; quote, purchase, adoption, and registrant writes require DNS manage authority. House contact and manual House adoption additionally require the literal interactive `is_superuser` identity.

## Search, quote, and purchase

The wizard asks for one explicit group through bounded `/api/dnsman/credential/group-choice` search. It never reads `/api/group`, active-group state, or free-form group ids. TLDs are operator-typed and bounded by `config.search_batch_limit`; the client has no invented supported-TLD catalog. Search availability stays tri-state: `true`, `false`, or `null` (registry did not answer). Only literal `true` advances.

`POST /registrar/quote` returns `{purchase,name,price,currency,years,token,expires,privacy_supported}`. The raw token lives only in an immutable ref in the mounted wizard. It is never state, URL data, Query/Mutation cache data, mock request history, or durable mock data. The exact tuple binds purchase id, token, group, normalized domain, years, decimal price, currency, and expiry. Any upstream change or expiry clears it.

The portal purchases **one year** only. The backend currently keeps raw TLD
registration price separately from years, so the UI does not multiply it into an
allegedly authoritative multi-year payable total. `privacy_supported` is part of
the retained quote identity; an unsupported registry is explained before consent,
and an acknowledged `privacy_downgraded` result stays visible.

The operator types the exact normalized domain before the single-flight, nonretry `POST /registrar/purchase`. The token is removed from the ref before the request. Success and every exception reconcile through an imperative `GET /purchase/<id>?graph=default`; one non-overlapping bounded-backoff loop follows `submitted` to a durable terminal row. Timeout keeps exact **View purchase** and **Refresh** actions available. Each
refresh reads the retained purchase ID and never submits another purchase. A
completed receipt opens the acknowledged domain ID when available; the ledger
graph has no domain FK, so other completed receipts use a mount-relative
name-filtered inventory handoff.

After purchase is attempted, the wizard cannot retry or requote. A final
transport owner check runs after the asynchronous auth gate and before every
permitted 440 continuation. Session replacement stops that continuation. Only
the purchase ID/owner survives a same-user revision change, giving an exact-ID
recovery view; a different user receives none of the previous recovery state. A failed, ambiguous, or timed-out result always says that money may have moved and directs the operator to the AWS Route 53 Domains operation console and durable ledger first.

## Purchase ledger

`DomainPurchaseModel` lists only `graph=basic`: id, domain, status, price, and currency. Export/download and alternate graphs are rejected. Clicking a row performs an imperative default-graph read into a focused modal
with an exact-ID Refresh action; the detail response and redacted error are modal-local and never Query-cached.

## Registrant PII

The contact page starts with no scope and no contact. Operators explicitly choose one authorized group, or literal superusers may choose House. Reads and writes are imperative; generation guards discard late responses after scope changes/unmount, and local contact state is cleared immediately.

An inherited group response renders a blank form and only the backend-authored boolean status; inherited values are never disclosed. Normal editable values may seed from that scope's database row or the House settings-file response. `Fax` and opaque `ExtraParams` are preserved only when the original response is a direct database row for the exact same scope. They are never carried across scope, inheritance, or deployment-file override boundaries.

## Scoped purchase contact setup

A missing-contact search offers **Set up contact** without discarding the explicit
purchasing group or intended name. `RegistrantContactPage` accepts optional
`initialGroup`, `lockScope`, `onSaved`, `onClose`, and `onBusyChange` for that
focused native dialog. Reads are explicit manager-only, fenced by scope/session,
and never Query-cached. Contact/Address tabs keep one draft; save returns to the
same purchase search and rechecks scoped capabilities. There is no active-group
fallback. The standalone page retains its explicit scope chooser.

## House adoption

House adoption is a separate, literal-superuser-only menu option. The operator types one exact existing name and submits `/registrar/adopt` without `group`. The UI never calls `/registrar/discover`, auto-discovers account domains, or silently assigns the adopted asset to a tenant.

## Themes, showcase, and verification

Both themes import the same token-only `admin-dns-registrar.css`. The showcase has manager-ready, missing-contact, viewer-ledger, and platform-House legs. `npm run verify:admin-dns-registrar` is mock-only and performs no real registrar quote or purchase.
