import { namedPage } from './lazy-page';
import type { AdminSection } from '../core';
import { DNS_MANAGE_PERMISSIONS, DNS_VIEW_PERMISSIONS } from '../dns/models';
import { BUCKET_MANAGE_PERMS, STORAGE_VIEW_PERMS } from '../storage/permissions';
import { SETTINGS_PERMISSIONS } from '../settings/model';

export const DNS_ADMIN_SECTION: AdminSection = {
    id: 'dns', title: 'DNS', icon: 'bi-globe2', navigationGroup: 'hosting', basePath: 'dns', permissions: DNS_VIEW_PERMISSIONS,
    routes: [
        { path: 'domains', label: 'Domains', loadComponent: () => import('../dns/DomainsPage').then(namedPage('DomainsPage')), permissions: DNS_VIEW_PERMISSIONS },
        { path: 'records', label: 'DNS Records', searchOnly: true, loadComponent: () => import('../dns/DnsRecordsPage').then(namedPage('DnsRecordsPage')), permissions: DNS_VIEW_PERMISSIONS },
        { path: 'certificates', label: 'Certificates', loadComponent: () => import('../dns/CertificatesPage').then(namedPage('CertificatesPage')), permissions: DNS_VIEW_PERMISSIONS },
        { path: 'purchases', label: 'Domain Purchases', searchOnly: true, loadComponent: () => import('../dns/DomainPurchasesPage').then(namedPage('DomainPurchasesPage')), permissions: DNS_VIEW_PERMISSIONS },
        { path: 'registrant', label: 'Registrant Contact', searchOnly: true, loadComponent: () => import('../dns/RegistrantContactPage').then(namedPage('RegistrantContactPage')), permissions: DNS_MANAGE_PERMISSIONS },
        { path: 'credentials', label: 'Provider Credentials', searchOnly: true, loadComponent: () => import('../dns/ProviderCredentialsPage').then(namedPage('ProviderCredentialsPage')), permissions: DNS_VIEW_PERMISSIONS },
    ],
};
export const STORAGE_ADMIN_SECTION: AdminSection = {
    id: 'storage', basePath: 'storage', title: 'Storage', icon: 'bi-hdd-stack', navigationGroup: 'storage', permissions: ['sys.view_fileman', 'sys.manage_files', 'sys.manage_aws', 'sys.files', ...SETTINGS_PERMISSIONS],
    routes: [
        { path: 'buckets', label: 'Buckets', loadComponent: () => import('../storage/BucketsPage').then(namedPage('BucketsPage')), permissions: BUCKET_MANAGE_PERMS },
        { path: 'backends', label: 'Backends', loadComponent: () => import('../storage/BackendsPage').then(namedPage('BackendsPage')), permissions: STORAGE_VIEW_PERMS },
        { path: 'files', label: 'Files', loadComponent: () => import('../storage/FilesPage').then(namedPage('FilesPage')), permissions: STORAGE_VIEW_PERMS },
        // Media rendering edits three Setting rows, so it carries the Settings page's gate, not the storage one.
        { path: 'rendering', label: 'Media rendering', loadComponent: () => import('../storage/MediaRenderingPage').then(namedPage('MediaRenderingPage')), permissions: SETTINGS_PERMISSIONS },
    ],
};
export const EDGE_ADMIN_SECTION: AdminSection = {
    id: 'edge', basePath: 'edge', title: 'Edge', icon: 'bi-hdd-network', navigationGroup: 'hosting', permissions: DNS_VIEW_PERMISSIONS,
    routes: [
        { path: 'vhosts', label: 'Serving', loadComponent: () => import('../edge/VhostsPage').then(namedPage('VhostsPage')), permissions: DNS_VIEW_PERMISSIONS },
        { path: 'upstreams', label: 'Upstreams', searchOnly: true, loadComponent: () => import('../edge/UpstreamsPage').then(namedPage('UpstreamsPage')), permissions: DNS_VIEW_PERMISSIONS },
    ],
};
export const FLEET_ADMIN_SECTION: AdminSection = {
    id: 'fleet', title: 'Fleet', icon: 'bi-cloud', navigationGroup: 'operations',
    permissions: ['sys.view_admin', 'sys.manage_users', 'sys.manage_settings', 'sys.admin', 'sys.manage_aws'],
    routes: [{ path: '', label: 'Fleet', loadComponent: () => import('../fleet/FleetPage').then(namedPage('FleetPage')) }],
};
export const INFRASTRUCTURE_ADMIN_SECTIONS = [FLEET_ADMIN_SECTION, DNS_ADMIN_SECTION, STORAGE_ADMIN_SECTION, EDGE_ADMIN_SECTION] as const;
