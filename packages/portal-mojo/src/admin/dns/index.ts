import type { AdminSection } from '../index';
import { ProviderCredentialsPage } from './ProviderCredentialsPage';
import { DomainsPage } from './DomainsPage';
import { DnsRecordsPage } from './DnsRecordsPage';
import { CertificatesPage } from './CertificatesPage';
import { DomainPurchasesPage } from './DomainPurchasesPage';
import { RegistrantContactPage } from './RegistrantContactPage';
import { resolveDnsDomainByName } from './api';
import { registerDnsAdminIntegration } from './dns-integration';
import { DNS_MANAGE_PERMISSIONS, DNS_VIEW_PERMISSIONS } from './models';
import { registerDnsDomainLinks } from './domain-links';

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
export * from './certificate-data';
export * from './CertificateLifecyclePoller';
export * from './CertificatesPage';
export * from './CertificateDetail';
export * from './CertificateRequestDialog';
export * from './DomainCertificatesSection';
export * from './purchase-data';
export * from './registrant-data';
export * from './DomainPurchaseWizard';
export * from './DomainOnboardingDialog';
export * from './DomainPurchaseDetail';
export * from './DomainPurchasesPage';
export * from './RegistrantContactPage';

registerDnsAdminIntegration({
    resolveDomainByName: resolveDnsDomainByName,
    recordsHref: (domainId) => `dns/records?domain=${encodeURIComponent(domainId)}`,
});

registerDnsDomainLinks(
    { key: 'domains', label: 'Domains', icon: 'bi-globe2', route: 'domains' },
    { key: 'records', label: 'DNS Records', icon: 'bi-list-columns', route: (domain) => `records?domain=${encodeURIComponent(domain.id)}` },
    { key: 'certificates', label: 'Certificates', icon: 'bi-patch-check', route: (domain) => `certificates?domain__exact=${encodeURIComponent(domain.id)}` },
    { key: 'purchases', label: 'Domain Purchases', icon: 'bi-receipt', route: 'purchases' },
    { key: 'registrant', label: 'Registrant Contact', icon: 'bi-person-vcard', route: 'registrant' },
    { key: 'credentials', label: 'Provider Credentials', icon: 'bi-key', route: 'credentials' },
);

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
            path: 'certificates', label: 'Certificates',
            component: CertificatesPage, permissions: DNS_VIEW_PERMISSIONS,
        },
        {
            path: 'purchases', label: 'Domain Purchases',
            component: DomainPurchasesPage, permissions: DNS_VIEW_PERMISSIONS,
        },
        {
            path: 'registrant', label: 'Registrant Contact',
            component: RegistrantContactPage, permissions: DNS_MANAGE_PERMISSIONS,
        },
        {
            path: 'credentials', label: 'Provider Credentials',
            component: ProviderCredentialsPage, permissions: DNS_VIEW_PERMISSIONS,
        },
    ],
} satisfies AdminSection;
