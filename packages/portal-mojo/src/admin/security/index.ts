import type { AdminSection } from '../index';
import { SECURITY_VIEW_PERMS } from '../security-permissions';
import { TicketsPage } from './tickets';

export * from './models';
export * from './tickets';

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
    ],
};
