# Shortlinks Admin

Import from `portal-mojo/admin`. `SHORTLINKS_ADMIN_SECTION` contributes
`shortlinks/links` and `shortlinks/history` to the global, no-group
Communications navigation. Both routes require `sys.manage_shortlinks`.

## Privacy boundary

django-mojo's `graph=list` includes the destination `url`. `ShortlinkModel`
therefore applies a positive row projection inside the query function before
TanStack Query receives a row. Destinations and metadata are omitted.

Click history is manage-only and projects raw records into: click id, shortlink
id/code, bot classification, timestamp, a bounded browser/bot summary, and an
HTTP(S) referrer origin. IP addresses, raw user-agent strings, referrer
path/query/fragment, metadata, and nested `shortlink.url` are never cached.
Neither table supports search or export, and list parameters are allowlisted.

## Mutations and short URLs

Create, active-state changes, and delete are imperative one-shot requests. They
do not claim fresh-auth protection the backend does not provide and do not use
retrying mutation hooks. Every outcome runs an authoritative reconciliation in
`finally` semantics. If reconciliation itself fails, the UI warns that the
change may have persisted and blocks retry until a successful refresh.

Short URLs are `${apiOrigin()}/s/{code}` (or `/s/{code}` for the same-origin
mock). The package makes no canonical-host claim.

Human and bot totals are counts of retained tracking records. The displayed
remainder is `max(0, hit_count - human - bot)`; `hit_count` also includes hits
made while tracking was disabled.
