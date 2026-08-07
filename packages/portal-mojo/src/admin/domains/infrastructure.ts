import type { AdminSection } from '../core';
import { DNS_MANAGE_PERMISSIONS, DNS_VIEW_PERMISSIONS } from '../dns/models';
import { BUCKET_MANAGE_PERMS, STORAGE_VIEW_PERMS } from '../storage/permissions';

export const DNS_ADMIN_SECTION: AdminSection = {
    id: 'dns', title: 'DNS', icon: 'bi-globe2', navigationGroup: 'infrastructure', basePath: 'dns', permissions: DNS_VIEW_PERMISSIONS,
    routes: [
        { path: 'domains', label: 'Domains', loadComponent: () => import('../dns/DomainsPage').then(({ DomainsPage }) => ({ default: DomainsPage })), permissions: DNS_VIEW_PERMISSIONS },
        { path: 'records', label: 'DNS Records', loadComponent: () => import('../dns/DnsRecordsPage').then(({ DnsRecordsPage }) => ({ default: DnsRecordsPage })), permissions: DNS_VIEW_PERMISSIONS },
        { path: 'certificates', label: 'Certificates', loadComponent: () => import('../dns/CertificatesPage').then(({ CertificatesPage }) => ({ default: CertificatesPage })), permissions: DNS_VIEW_PERMISSIONS },
        { path: 'purchases', label: 'Domain Purchases', loadComponent: () => import('../dns/DomainPurchasesPage').then(({ DomainPurchasesPage }) => ({ default: DomainPurchasesPage })), permissions: DNS_VIEW_PERMISSIONS },
        { path: 'registrant', label: 'Registrant Contact', loadComponent: () => import('../dns/RegistrantContactPage').then(({ RegistrantContactPage }) => ({ default: RegistrantContactPage })), permissions: DNS_MANAGE_PERMISSIONS },
        { path: 'credentials', label: 'Provider Credentials', loadComponent: () => import('../dns/ProviderCredentialsPage').then(({ ProviderCredentialsPage }) => ({ default: ProviderCredentialsPage })), permissions: DNS_VIEW_PERMISSIONS },
    ],
};
export const STORAGE_ADMIN_SECTION: AdminSection = {
    id: 'storage', basePath: 'storage', title: 'Storage', icon: 'bi-hdd-stack', navigationGroup: 'infrastructure', permissions: ['sys.view_fileman', 'sys.manage_files', 'sys.manage_aws', 'sys.files'],
    routes: [
        { path: 'buckets', label: 'Buckets', loadComponent: () => import('../storage/BucketsPage').then(({ BucketsPage }) => ({ default: BucketsPage })), permissions: BUCKET_MANAGE_PERMS },
        { path: 'backends', label: 'Backends', loadComponent: () => import('../storage/BackendsPage').then(({ BackendsPage }) => ({ default: BackendsPage })), permissions: STORAGE_VIEW_PERMS },
        { path: 'files', label: 'Files', loadComponent: () => import('../storage/FilesPage').then(({ FilesPage }) => ({ default: FilesPage })), permissions: STORAGE_VIEW_PERMS },
    ],
};
export const INFRASTRUCTURE_ADMIN_SECTIONS = [DNS_ADMIN_SECTION, STORAGE_ADMIN_SECTION] as const;
