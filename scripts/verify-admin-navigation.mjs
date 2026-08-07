import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
    const [appShell, settingsRoutes, settingDetail] = await Promise.all([
        readFile(new URL('../apps/portal/src/App.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/admin/settings/index.ts', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/admin/settings/SettingDetail.tsx', import.meta.url), 'utf8'),
    ]);
    assert.doesNotMatch(appShell, /RightPanelProvider|RightPanelSlot|useRightPanel|app-right-panel-open/,
        'the global Admin shell must not reserve a persistent record-detail panel');
    assert.doesNotMatch(`${settingsRoutes}\n${settingDetail}`, /SettingDetailPage|useNavigate|useParams|path:\s*['"]:id/,
        'Settings detail must be modal-owned, not route-owned');

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
    assert.deepEqual(admin.SETTINGS_ADMIN_SECTION.routes.map((route) => route.path), ['']);
    assert(admin.ADMIN_SECTIONS.flatMap((section) => section.routes).every((route) => !route.path.includes(':')),
        'shipped Admin record details must not register child routes');
    const metricsRoutes = admin.MONITORING_ADMIN_SECTION.routes.filter((route) => route.path.startsWith('metrics/'));
    assert.equal(admin.ADMIN_SECTIONS[0].id, 'dashboard');
    assert(admin.adminSectionRoutes(admin.ADMIN_SECTIONS).some((route) => route.path === ''));
    assert(admin.adminSectionRoutes(admin.ADMIN_SECTIONS, { mount: '/system' }).some((route) => route.path === 'system'));
    assert.deepEqual(metricsRoutes.map((route) => route.path), ['metrics/explorer', 'metrics/permissions']);
    assert.deepEqual(metricsRoutes[0].permissions, ['sys.view_metrics', 'sys.metrics']);
    assert.deepEqual(metricsRoutes[1].permissions, ['sys.manage_incidents', 'sys.metrics', 'sys.manage_metrics']);
    assert(admin.adminSectionRoutes([admin.MONITORING_ADMIN_SECTION], { mount: '/system' })
        .some((route) => route.path === 'system/metrics/explorer'));

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
