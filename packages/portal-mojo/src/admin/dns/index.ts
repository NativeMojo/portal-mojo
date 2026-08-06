import type { AdminSection } from '../index';
import { ProviderCredentialsPage } from './ProviderCredentialsPage';
import { DNS_VIEW_PERMISSIONS } from './models';

export * from './models';
export * from './api';
export * from './data';
export * from './ProviderCredentialsPage';

export const DNS_ADMIN_SECTION = {
    id: 'dns',
    title: 'DNS',
    icon: 'bi-globe2',
    navigationGroup: 'infrastructure' as const,
    permissions: DNS_VIEW_PERMISSIONS,
    routes: [
        {
            path: 'credentials', label: 'Provider Credentials',
            component: ProviderCredentialsPage, permissions: DNS_VIEW_PERMISSIONS,
        },
    ],
} satisfies AdminSection;
