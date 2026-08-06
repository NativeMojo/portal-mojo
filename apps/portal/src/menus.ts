// The standalone artifact is one GLOBAL Admin portal. Product portals own
// their own groupKind menus and GroupProvider; this app deliberately has no
// active-group navigation or member-derived permission context.
import { registerMenus, setDefaultMenu, type MenuItem } from 'portal-mojo/ui';
import {
    ADMIN_NAVIGATION_GROUPS,
    ADMIN_SECTIONS,
    adminSectionsMenu,
} from 'portal-mojo/admin';
import { GROUP_VIEW_PERMS } from './models';

const contributions = adminSectionsMenu(ADMIN_SECTIONS, {
    name: 'admin-contributions',
    grouped: true,
    presentation: 'accordion',
});
const contributedById = new Map(
    contributions.items
        .filter((item): item is MenuItem & { id: string } => Boolean(item.id))
        .map((item) => [item.id, item]),
);

const identityMeta = ADMIN_NAVIGATION_GROUPS['identity-access'];
const identityContribution = contributedById.get(identityMeta.id);
const identity: MenuItem = {
    id: identityMeta.id,
    label: identityMeta.label,
    icon: identityMeta.icon,
    children: [
        { id: 'admin:users', label: 'Users', route: '/users' },
        { id: 'admin:groups', label: 'Groups', route: '/groups', permissions: GROUP_VIEW_PERMS },
        { id: 'admin:personal-api-keys', label: 'Personal API Keys', route: '/apikeys' },
        ...(identityContribution?.children ?? []),
    ],
};

const contributedCategories = contributions.items.filter((item) =>
    !item.divider && item.id !== identityMeta.id);

registerMenus([{
    name: 'admin',
    scope: 'admin',
    presentation: 'accordion',
    items: [
        { divider: 'Admin' },
        {
            id: 'admin:overview',
            label: 'Overview',
            icon: 'bi-grid-1x2',
            children: [{ id: 'admin:dashboard', label: 'Dashboard', route: '/' }],
        },
        identity,
        ...contributedCategories,
    ],
}]);
setDefaultMenu('admin');
