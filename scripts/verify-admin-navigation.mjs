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
    assert.equal((appShell.match(/<RightPanelProvider>/g) ?? []).length, 1,
        'the global Admin shell must own exactly one Assistant panel provider');
    assert.equal((appShell.match(/<RightPanelSlot/g) ?? []).length, 1,
        'the global Admin shell must own exactly one Assistant panel slot');
    assert.match(appShell, /app-right-panel-open/);
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
    assert(admin.ADMIN_SECTIONS.includes(admin.CLOUDWATCH_ADMIN_SECTION));
    assert(admin.ADMIN_SECTIONS.includes(admin.ASSISTANT_ADMIN_SECTION));
    assert(admin.adminSectionRoutes([admin.CLOUDWATCH_ADMIN_SECTION], { mount: '/system' })
        .some((route) => route.path === 'system/cloudwatch'));
    assert(admin.adminSectionRoutes(admin.ADMIN_SECTIONS).some((route) => route.path === ''));

    // Regression: every packaged route element must carry a DISTINCT React
    // key. All of them render the same tree (AdminGlobalScope > Guarded >
    // Guarded > AdminLazyPage) at the same outlet position; without a key
    // React reconciles route A into route B in place, the lazy page swaps
    // inside a Suspense that already holds committed content, and hash
    // navigation between admin pages silently keeps showing the old page.
    const keyedRoutes = admin.adminSectionRoutes(admin.ADMIN_SECTIONS).filter((route) => route.element?.key != null);
    const elementRoutes = admin.adminSectionRoutes(admin.ADMIN_SECTIONS).filter((route) => route.element != null && route.path !== '');
    assert(elementRoutes.length > 0, 'expected packaged routes with elements');
    const keys = elementRoutes.map((route) => route.element.key);
    assert(keys.every((k) => typeof k === 'string' && k.length > 0), 'every packaged route element must be keyed');
    assert.equal(new Set(keys).size, keys.length, 'packaged route element keys must be unique');
    assert(keyedRoutes.length >= elementRoutes.length, 'keyed route count regressed');
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
