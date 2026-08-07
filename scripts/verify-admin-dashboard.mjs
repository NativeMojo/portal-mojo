import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

try {
    const [admin, data, mock] = await Promise.all([
        server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts'),
        server.ssrLoadModule('/packages/portal-mojo/src/admin/dashboard/data.ts'),
        server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts'),
    ]);
    const [page, dataSource, adminIndex, portalMain, portalMenus, mockSource, devices, sentPage, showcase, docs] = await Promise.all([
        read('packages/portal-mojo/src/admin/dashboard/AdminDashboardPage.tsx'),
        read('packages/portal-mojo/src/admin/dashboard/data.ts'),
        read('packages/portal-mojo/src/admin/index.ts'),
        read('apps/portal/src/main.tsx'),
        read('apps/portal/src/menus.ts'),
        read('packages/portal-mojo/src/client/mock.ts'),
        read('packages/portal-mojo/src/admin/security/devices/models.ts'),
        read('packages/portal-mojo/src/admin/messaging/SentMessagesPage.tsx'),
        read('apps/showcase/src/pages/components/ComponentsPage.tsx'),
        read('packages/portal-mojo/docs/admin-dashboard.md'),
    ]);

    assert.deepEqual([...data.DASHBOARD_SERIES], ['user_activity_day', 'group_activity_day', 'api_calls', 'api_errors']);
    assert.deepEqual([...data.DASHBOARD_SCALARS], ['total_users', 'total_groups']);
    for (const value of [0, 12, '12', '12.5']) assert.equal(data.parseDashboardScalar(value, 'test'), Number(value));
    for (const value of [null, true, {}, [], '', -1, '-1', Infinity, 'wat']) {
        assert.throws(() => data.parseDashboardScalar(value, 'test'));
    }

    const dashboard = admin.ADMIN_SECTIONS[0];
    assert.equal(dashboard.id, 'dashboard');
    assert.equal(dashboard.basePath, '');
    assert.equal(dashboard.routes[0].path, '');
    assert.equal(dashboard.routes[0].fallbackToFirstVisible, true);
    assert(admin.adminSectionRoutes(admin.ADMIN_SECTIONS).some((route) => route.path === ''));
    assert(admin.adminSectionRoutes(admin.ADMIN_SECTIONS, { mount: '/system' }).some((route) => route.path === 'system'));
    const menu = admin.adminSectionsMenu(admin.ADMIN_SECTIONS, { grouped: true });
    const overview = menu.items.find((item) => item.id === 'admin:overview');
    assert.deepEqual(overview.children.map((item) => [item.label, item.route]), [['Dashboard', '/']]);
    assert.match(adminIndex, /fallbackToFirstVisible/);
    assert.doesNotMatch(portalMain, /DashboardPage/);
    assert.doesNotMatch(portalMenus, /id:\s*'admin:dashboard'/);
    await assert.rejects(access(new URL('../apps/portal/src/pages/DashboardPage.tsx', import.meta.url)));

    for (const endpoint of ['/api/metrics/value/get', '/api/incident/incident', '/api/jobs/job', '/api/aws/email/sent']) {
        assert.match(`${page}\n${dataSource}`, new RegExp(endpoint.replaceAll('/', '\\/')));
    }
    for (const route of ['/security/incidents?status=open', '/jobs/list?status=failed', '/email/sent?status=bounced']) assert(page.includes(route));
    assert.match(page, /drStart=\{dashboardLoginStart\(\)\}/);
    assert.doesNotMatch(page, /drEnd=/);
    assert.match(devices, /auth\.uid/);
    assert.match(devices, /queryKey:\s*\[path, auth\.uid, params\]/);
    assert.match(sentPage, /key:'status'.*type:'select'/);
    assert.doesNotMatch(sentPage, /status__in/);
    assert.match(showcase, /admin-dashboard/);
    assert.match(docs, /authoritative/i);

    for (const slug of [...data.DASHBOARD_SERIES, ...data.DASHBOARD_SCALARS]) assert(mockSource.includes(slug), slug);
    assert.doesNotMatch(mockSource, /slug:\s*'logins'|slug:\s*'errors'/);
    assert.match(mockSource, /status:'bounced'/);

    const login = await mock.mockFetch('/api/login', { method: 'POST', body: { username: 'showcase.operator@nativemojo.com', password: 'mojo' } });
    const headers = { Authorization: `Bearer ${login.data.access_token}` };
    const scalars = await mock.mockFetch('/api/metrics/value/get', { headers, params: { account: 'global', slugs: 'total_users,total_groups' } });
    assert.equal(typeof scalars.data.total_users, 'number');
    assert.equal(typeof scalars.data.total_groups, 'number');
    const series = await mock.mockFetch('/api/metrics/fetch', { headers, params: { account: 'global', slugs: data.DASHBOARD_SERIES.join(','), granularity: 'days', range: '30d' } });
    assert.equal(series.status, true);
    const [incidents, jobs, bounced] = await Promise.all([
        mock.mockFetch('/api/incident/incident', { headers, params: { status: 'open', size: 0 } }),
        mock.mockFetch('/api/jobs/job', { headers, params: { status: 'failed', size: 0 } }),
        mock.mockFetch('/api/aws/email/sent', { headers, params: { status: 'bounced', size: 0 } }),
    ]);
    for (const response of [incidents, jobs, bounced]) assert(response.count > 0);

    console.log('admin dashboard contract verified');
} finally {
    await server.close();
}
