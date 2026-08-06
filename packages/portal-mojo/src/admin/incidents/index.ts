import type { AdminRoute } from '../index';
import { SECURITY_VIEW_PERMS } from '../security-permissions';
import { EventsPage } from './EventsPage';
import { IncidentsPage } from './IncidentsPage';

export * from './models';
export * from './sanitize';
export * from './IncidentDetail';
export * from './EventDetail';

export const INCIDENTS_ADMIN_ROUTES: AdminRoute[] = [
    { path: 'incidents', label: 'Incidents', component: IncidentsPage, permissions: SECURITY_VIEW_PERMS },
    { path: 'events', label: 'Events', component: EventsPage, permissions: SECURITY_VIEW_PERMS },
];
