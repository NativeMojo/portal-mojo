import { DnsRecordsPage, DomainsPage } from 'portal-mojo/admin';

/** The shipped pages, not a visual facsimile. They run against the sole central mock. */
export function AdminDnsRecordsDemo() {
    return <div style={{ display: 'grid', gap: 18 }}>
        <section><div className="eyebrow">Domain inventory + KISS detail</div><p className="dim">Open a row to inspect Overview and the same live Records panel used below.</p><DomainsPage /></section>
        <section><div className="eyebrow">Standalone live records</div><p className="dim">Domain and record type are URL-owned. Try Route 53, GoDaddy, pending, certificate-only, and credential-blocked fixtures.</p><DnsRecordsPage /></section>
    </div>;
}
