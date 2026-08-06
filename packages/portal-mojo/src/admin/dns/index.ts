import type { AdminSection } from '../index';
import { ProviderCredentialsPage } from './ProviderCredentialsPage';
import { DomainsPage } from './DomainsPage';
import { DnsRecordsPage } from './DnsRecordsPage';
import { resolveDnsDomainByName } from './api';
import { registerDnsAdminIntegration } from './dns-integration';
import { DNS_VIEW_PERMISSIONS } from './models';

export * from './models';
export * from './api';
export * from './data';
export * from './ProviderCredentialsPage';
export * from './dns-data';
export * from './dns-integration';
export * from './domain-links';
export * from './DomainsPage';
export * from './DomainDetail';
export * from './DnsRecordsPage';
export * from './DnsRecordsPanel';
export * from './DnsRecordEditor';

registerDnsAdminIntegration({
    resolveDomainByName: resolveDnsDomainByName,
    recordsHref: (domainId) => `dns/records?domain=${encodeURIComponent(domainId)}`,
});

export const DNS_ADMIN_SECTION = {
    id: 'dns',
    title: 'DNS',
    icon: 'bi-globe2',
    navigationGroup: 'infrastructure' as const,
    basePath: 'dns',
    permissions: DNS_VIEW_PERMISSIONS,
    routes: [
        {
            path: 'domains', label: 'Domains',
            component: DomainsPage, permissions: DNS_VIEW_PERMISSIONS,
        },
        {
            path: 'records', label: 'DNS Records',
            component: DnsRecordsPage, permissions: DNS_VIEW_PERMISSIONS,
        },
        {
            path: 'credentials', label: 'Provider Credentials',
            component: ProviderCredentialsPage, permissions: DNS_VIEW_PERMISSIONS,
        },
    ],
} satisfies AdminSection;
