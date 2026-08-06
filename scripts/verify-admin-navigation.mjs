import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// A few UI barrels initialize the theme media query at module load. This
// verification never renders them, but SSR import still needs the browser
// shape they feature-detect.
globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
    }),
};

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
    root,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
});

try {
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const menus = await server.ssrLoadModule('/packages/portal-mojo/src/ui/menu-registry.ts');
    const EmptyPage = () => null;
    const sections = [
        {
            id: 'alpha', basePath: '', title: 'Alpha', icon: 'bi-a',
            permissions: ['sys.view_alpha'],
            routes: [{ path: 'alpha', label: 'Alpha', component: EmptyPage, permissions: ['sys.manage_alpha'] }],
        },
        {
            id: 'beta', basePath: '', title: 'Beta', icon: 'bi-b',
            permissions: ['sys.view_beta'],
            routes: [{ path: 'beta', label: 'Beta', component: EmptyPage, permissions: ['sys.manage_beta'] }],
        },
    ];

    const routeObjects = admin.adminSectionRoutes(sections, { mount: '/system' });
    assert.equal(routeObjects.filter((route) => route.path === 'system').length, 1,
        'root AdminSections must emit one shared embedded mount landing');
    assert(routeObjects.some((route) => route.path === 'system/alpha'));
    assert(routeObjects.some((route) => route.path === 'system/beta'));

    const menu = admin.adminSectionsMenu(sections, { mount: '/system', grouped: true });
    const category = menu.items.find((item) => item.id === 'admin:other');
    const alpha = category?.children?.find((item) => item.label === 'Alpha');
    assert(alpha, 'legacy sections without navigationGroup must land under Other');

    const ctx = (permissions, memberPermissions = {}) => ({
        me: { id: 1, permissions },
        member: { permissions: memberPermissions },
        group: { id: 10, name: 'Group', kind: 'org' },
    });
    assert.equal(menus.itemVisible(alpha, ctx({ view_alpha: true })), false,
        'section-only grant must not reveal the route');
    assert.equal(menus.itemVisible(alpha, ctx({ manage_alpha: true })), false,
        'route-only grant must not reveal the route');
    assert.equal(menus.itemVisible(alpha, ctx({ view_alpha: true, manage_alpha: true })), true,
        'both system grants must reveal the route');
    assert.equal(menus.itemVisible(alpha, ctx({}, { view_alpha: true, manage_alpha: true })), false,
        'active-group member grants must not satisfy sys.* Admin clauses');

    console.log('admin navigation contract verified');
} finally {
    await server.close();
}
