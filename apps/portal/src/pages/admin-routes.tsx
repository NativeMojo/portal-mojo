// C4 route fragment (board #1281) — the first live screens.
// MERGE-WIRE: main.tsx routes — spread into the App children array:
//   children: [ …existing, ...adminRoutes ]
import type { RouteObject } from 'react-router-dom';
import { ADMIN_SECTIONS, adminSectionRoutes } from 'portal-mojo/admin';
import { Guarded } from 'portal-mojo/ui';
import { GROUP_VIEW_PERMS } from '../models';
import { GroupsPage } from './GroupsPage';
import { ApiKeysPage } from './ApiKeysPage';

function AdminDenied() {
    return (
        <div className="panel">
            <div className="empty">
                <i className="bi bi-shield-lock" />
                <h2>Access denied</h2>
                <p className="dim">Your account does not have permission to open this admin page.</p>
            </div>
        </div>
    );
}

export const adminRoutes: RouteObject[] = [
    {
        path: 'groups',
        element: (
            <Guarded permission={GROUP_VIEW_PERMS} fallback={<AdminDenied />}>
                <GroupsPage />
            </Guarded>
        ),
    },
    { path: 'apikeys', element: <ApiKeysPage /> },
    ...adminSectionRoutes(ADMIN_SECTIONS),
];
