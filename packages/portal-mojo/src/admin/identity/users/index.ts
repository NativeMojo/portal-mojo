import { UserDetail } from './UserDetail';
import { UsersPage } from './UsersPage';

export * from './models';
export * from './UsersPage';
export * from './UserDetail';
export * from './sections/permission-catalog';

export { USERS_ADMIN_SECTION } from '../../domains/identity';

/** Useful to custom routers that open a User detail outside ModelTable. */
export const USER_ADMIN_SURFACES = { UsersPage, UserDetail } as const;
