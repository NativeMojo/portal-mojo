import type { AdminSection } from '../index';
import { ShortlinkHistoryPage } from './ShortlinkHistoryPage';
import { ShortlinksPage } from './ShortlinksPage';
import { SHORTLINK_MANAGE_PERMISSIONS } from './models';

export * from './models';
export * from './ShortlinksPage';
export * from './ShortlinkHistoryPage';
export * from './ShortlinkDetail';

export const SHORTLINKS_ADMIN_SECTION: AdminSection = {
    id: 'shortlinks', basePath: 'shortlinks', title: 'Shortlinks', icon: 'bi-link-45deg', navigationGroup: 'communications',
    permissions: SHORTLINK_MANAGE_PERMISSIONS,
    routes: [
        { path: 'links', label: 'Links', component: ShortlinksPage, permissions: SHORTLINK_MANAGE_PERMISSIONS },
        { path: 'history', label: 'Click history', component: ShortlinkHistoryPage, permissions: SHORTLINK_MANAGE_PERMISSIONS },
    ],
};
