import type { AdminSection } from '../index';
import { SECURITY_VIEW_PERMS } from '../security-permissions';
import { TicketsPage } from './tickets';
import { INCIDENTS_ADMIN_ROUTES } from '../incidents';
import { RULES_ADMIN_ROUTES } from '../rules';

export * from './models';
export * from './tickets';
// Two sibling sections under the same Security navigation group (#1291):
// Devices & Logins at security/devices, IP Intelligence at security/geoip.
export * from './devices';
export * from './geoip';

export const SECURITY_OPERATIONS_ADMIN_SECTION: AdminSection = {
    id: 'security-operations',
    basePath: 'security',
    title: 'Security Operations',
    icon: 'bi-shield-check',
    navigationGroup: 'security',
    permissions: SECURITY_VIEW_PERMS,
    routes: [
        {
            path: 'tickets',
            label: 'Tickets',
            component: TicketsPage,
            permissions: SECURITY_VIEW_PERMS,
        },
        ...INCIDENTS_ADMIN_ROUTES,
        ...RULES_ADMIN_ROUTES,
    ],
};
