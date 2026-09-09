/** Full built-in roster without the broad compatibility/domain barrels. */
import { ADMIN_SECTIONS as sections } from 'portal-mojo/admin/registry';
import { withAdminSourceSession } from './admin-source-session';

// Do not modify package descriptors: embedded product Admin has its own lifecycle.
export const ADMIN_SECTIONS = sections.map((section) => ({
    ...section,
    routes: section.routes.map((route) => route.loadComponent
        ? { ...route, loadComponent: withAdminSourceSession(route.loadComponent) }
        : { ...route }),
}));
