// C4 route fragment (board #1281) — the first live screens.
// MERGE-WIRE: main.tsx routes — spread into the App children array:
//   children: [ …existing, ...adminRoutes ]
import type { RouteObject } from 'react-router-dom';
import { ADMIN_SECTIONS, adminSectionRoutes } from 'portal-mojo/admin';
import { GroupsPage } from './GroupsPage';
import { ApiKeysPage } from './ApiKeysPage';
import { LogsPage } from './LogsPage';

export const adminRoutes: RouteObject[] = [
    { path: 'groups', element: <GroupsPage /> },
    { path: 'apikeys', element: <ApiKeysPage /> },
    { path: 'logs', element: <LogsPage /> },
    ...adminSectionRoutes(ADMIN_SECTIONS),
];
