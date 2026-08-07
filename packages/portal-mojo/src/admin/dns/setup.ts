import { usingMockTransport } from '../../client/client';
import { registerDnsAdminIntegration, type ManagedDnsRecordInput } from './dns-integration';
import { registerDnsDomainLinks } from './domain-links';

// Registration is synchronous and page-free. The compatibility aggregate and
// infrastructure domain both install it, so Email may be visited before DNS.
registerDnsAdminIntegration({
    resolveDomainByName: async (normalizedName: string) => {
        const { resolveDnsDomainByName } = await import('./api');
        return resolveDnsDomainByName(normalizedName);
    },
    recordsHref: (domainId) => `dns/records?domain=${encodeURIComponent(domainId)}`,
    ...(usingMockTransport() ? {
        applyManagedDnsRecords: async (domainId: number, records: readonly ManagedDnsRecordInput[]) => {
            const { applyMockManagedDnsRecords } = await import('../../client/mock');
            applyMockManagedDnsRecords(domainId, records);
        },
    } : {}),
});
registerDnsDomainLinks(
    { key: 'domains', label: 'Domains', icon: 'bi-globe2', route: 'domains' },
    { key: 'records', label: 'DNS Records', icon: 'bi-list-columns', route: (domain) => `records?domain=${encodeURIComponent(domain.id)}` },
    { key: 'certificates', label: 'Certificates', icon: 'bi-patch-check', route: (domain) => `certificates?domain__exact=${encodeURIComponent(domain.id)}` },
    { key: 'purchases', label: 'Domain Purchases', icon: 'bi-receipt', route: 'purchases' },
    { key: 'registrant', label: 'Registrant Contact', icon: 'bi-person-vcard', route: 'registrant' },
    { key: 'credentials', label: 'Provider Credentials', icon: 'bi-key', route: 'credentials' },
);
