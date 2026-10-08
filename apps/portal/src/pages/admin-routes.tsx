// C4 route fragment (board #1281) — the first live screens.
// MERGE-WIRE: main.tsx routes — spread into the App children array:
//   children: [ …existing, ...adminRoutes ]
import type { RouteObject } from 'react-router-dom';
import { adminSectionRoutes } from 'portal-mojo/admin/core';
import { ADMIN_SECTIONS } from '../admin-sections';

export const adminRoutes: RouteObject[] = [
    ...adminSectionRoutes(ADMIN_SECTIONS),
];
