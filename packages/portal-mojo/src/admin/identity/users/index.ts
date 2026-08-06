import type { AdminSection } from '../../index';
import { UserDetail } from './UserDetail';
import { UsersPage } from './UsersPage';
import { USER_VIEW_PERMISSIONS } from './models';

export * from './models';
export * from './UsersPage';
export * from './UserDetail';
export * from './sections/permission-catalog';

export const USERS_ADMIN_SECTION: AdminSection = {
    id: 'users',
    basePath: '',
    title: 'Users',
    icon: 'bi-people',
    navigationGroup: 'identity-access',
    permissions: USER_VIEW_PERMISSIONS,
    routes: [{
        path: 'users',
        label: 'Users',
        component: UsersPage,
        permissions: USER_VIEW_PERMISSIONS,
    }],
};

/** Useful to custom routers that open a User detail outside ModelTable. */
export const USER_ADMIN_SURFACES = { UsersPage, UserDetail } as const;
