import { DnsRecordsPage, DomainsPage } from 'portal-mojo/admin/infrastructure';

/** The shipped pages, not a visual facsimile. They run against the sole central mock. */
export function AdminDnsRecordsDemo({ surface }: { surface: 'domains' | 'records' }) {
    if (surface === 'domains') return <section><div className="eyebrow">Domain inventory + KISS detail</div><p className="dim">Open a row to inspect Overview and its shared live Records panel.</p><DomainsPage /></section>;
    return <section><div className="eyebrow">Standalone live records</div><p className="dim">Domain and record type are URL-owned. Try Route 53, GoDaddy, pending, certificate-only, and credential-blocked fixtures.</p><DnsRecordsPage /></section>;
}
