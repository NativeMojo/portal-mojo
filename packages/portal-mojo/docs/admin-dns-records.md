# DNS domains and live records

Import from `portal-mojo/admin`:

```tsx
import {
  DNS_ADMIN_SECTION, DomainsPage, DnsRecordsPage, DnsRecordsPanel,
  DnsRecordEditor, DNS_VIEW_PERMISSIONS, DNS_MANAGE_PERMISSIONS,
  registerDnsAdminIntegration, registerDnsDomainLinks,
} from 'portal-mojo/admin';
```

## Routes and permissions

The one canonical DNS section is `id: "dns"`, `basePath: "dns"`, in Infrastructure. Its routes are ordered `domains`, `records`, `certificates`, `purchases`, `registrant`, `credentials`. The read surfaces accept the global, system-pinned any-of view clause `sys.view_dns | sys.manage_dns | sys.security`; registrant and record mutation controls use `sys.manage_dns | sys.security`. Group/member grants never open Admin.

Domains uses the server-backed `DomainModel` list and `modal.detail`. Detail composes Overview, DNS Records, and the bounded Certificates section; Records is the same `DnsRecordsPanel` used by the standalone page. That page owns only `domain` and `record_type` in the URL. It may select the first active domain only when `domain` is absent. Invalid, denied, missing, and inactive deep links are preserved and shown as errors.

## Wire contract

Domain list/default reads are standard model envelopes. List asks only for paging, search, sort, provider, status, group and the `list` graph. Live records are deliberately not a model:

```text
GET /api/dnsman/dns?domain=8201
{status:true,data:{domain:"acme.example",provider:"route53",
records:[{type:"A",name:"acme.example",record_values:["192.0.2.10"],ttl:300}]}}
```

Records have no database id, paging, search, or graph. The parser fails closed on malformed payloads or an invented `id`. Local identity is `TYPE|normalized-fqdn`.

Upsert replaces the complete ordered set and sends exactly
`{domain,type,name,record_values,ttl}`. Whole-set deletion sends only
`{domain,type,name}`. Removing some values is an upsert of all survivors,
never a partial delete.

Both write endpoints answer at the top level as
`{status:true,change_id:string|null,provider:string}`. Route 53 supplies a
change id; GoDaddy may return `null`. There is no nested `data` write payload.

## Editor invariants

A, AAAA, CNAME, TXT, MX, SRV, CAA, and delegated non-apex NS use controlled structured rows, intersected with `allowed_record_types`. Unknown types remain readable and have no editor. Existing type/name are immutable.

Paste and blur may correct invisible characters, NBSP, curly quotes, URL/path/trailing dots, hostname case, bracketed IPs, and surrounding TXT/CAA quotes. Every correction records field, before, after, and message. Existing TXT values, including meaningful leading, trailing, and repeated whitespace, parse, format, edit, and submit losslessly unless the operator explicitly triggers and acknowledges a paste/blur correction. Submit never trims, dequotes, lowercases, normalizes, or deduplicates unacknowledged state. Blank/duplicate values, incomplete structured rows, invalid IPv4/full IPv6, hostname/range/TTL errors, out-of-zone or malformed names, invalid wildcards, apex NS/SOA/CNAME, and CNAME coexistence fail before the request. Server refusal remains authoritative.

Confirmation shows identity, TTL, unchanged/removed/added values, and contextual warnings from the editor opening snapshot. After confirmation the coordinator performs an uncached read, compares the exact set and every same-owner record (including CNAME coexistence), and writes immediately only when unchanged. A `finally` read reconciles cache after success, rejection, or an ambiguous response, and the zone query is invalidated unconditionally even when that read fails so stale cache is never authoritative. The draft and original error survive. This is best-effort preflight: no ETag/CAS exists, so a narrow GET-to-POST race remains.

## Provider behavior

- Route 53 supports complete-set upsert and separately confirmed whole-set delete.
- GoDaddy manages DNS here; registrar operations stay in its account. The server clamps refreshed TTLs to 600 and cannot express whole-set deletion. Exact `_acme-challenge.* TXT ["retired"]` rows are spent/inert only for GoDaddy.
- `provider="mojo"` is certificate-only and fails closed for general DNS.
- Pending/registering domains, unknown providers, and missing/inactive/unverified credentials render explicit blocked states.

## Composition seams

`dns-integration.ts` is dependency-free and HMR-safe. Partial registrations merge: production supplies exact-name resolution and `dns/records?domain=<id>`; the central mock supplies `applyManagedDnsRecords` against its sole DNS store. Absence is `null`, so permission is never mistaken for feature availability.

`registerDnsDomainLinks` is the reverse registry for certificate, WHOIS, or purchase children. Stable keys replace on HMR. Each entry owns label/icon, mount-relative route, optional system permission, capability/domain predicate, and optional order. Built-in related links are deterministically ordered Domains, DNS Records, Certificates, Provider Credentials.

## Mock and verification

The central mock is the only DNS state owner and mirrors id-less envelopes, global-versus-tenant authorization, active/provider/credential gates, complete replacement, Route 53 delete, GoDaddy floor/refusal/spent placeholders, Mojo, unknown records, and structured types. Mutation verification is mock-only. Live verification may read a zone and open/cancel an editor, but must never POST or DELETE DNS records.

Both Portal and Showcase import `theme/admin-dns.css`; all colors use theme tokens. Run `npm run verify:admin-dns-records` with the orchestration-owned typecheck/build/browser pass.
