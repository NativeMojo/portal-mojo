// The portal's menus — data registered into the A4 sidebar engine. The
// engine resolves the active menu from (route, active group, me); items
// carry their own permission gates. Admin sections will contribute a menu
// here via adminSectionsMenu() as Phase 2 pages stabilize.
import { registerMenus, setDefaultMenu } from 'portal-mojo/ui';

registerMenus([
    {
        name: 'main',
        items: [
            { divider: 'Main' },
            { label: 'Dashboard', icon: 'bi-grid-1x2', route: '/' },
            { label: 'Users', icon: 'bi-people', route: '/users' },
            { divider: 'System' },
            { label: 'Settings', icon: 'bi-gear', route: '/settings', permissions: 'view_admin' },
        ],
    },
    {
        // Active for ANY group kind — kind-specific portals register their
        // own menus (e.g. groupKind: 'org') ahead of this fallback.
        name: 'group',
        groupKind: 'any',
        items: [
            { divider: 'Group' },
            { label: 'Overview', icon: 'bi-diagram-3', route: '/group' },
            { divider: 'Portal' },
            { label: 'Back to main', icon: 'bi-arrow-left-short', route: '/' },
        ],
    },
]);
setDefaultMenu('main');
