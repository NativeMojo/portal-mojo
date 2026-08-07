import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = {
    addEventListener() {}, removeEventListener() {}, setInterval, clearInterval,
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

try {
    const [admin, data, mock, client] = await Promise.all([
        server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts'),
        server.ssrLoadModule('/packages/portal-mojo/src/admin/cloudwatch/data.ts'),
        server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts'),
        server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts'),
    ]);
    const [page, cloudwatchChart, resourceDetail, dataSource, metricsChart, adminIndex, portalTheme, showcaseTheme, portalCss, showcaseCss, demo, components, docs] = await Promise.all([
        read('packages/portal-mojo/src/admin/cloudwatch/CloudWatchDashboardPage.tsx'),
        read('packages/portal-mojo/src/admin/cloudwatch/CloudWatchChart.tsx'),
        read('packages/portal-mojo/src/admin/cloudwatch/CloudWatchResourceDetail.tsx'),
        read('packages/portal-mojo/src/admin/cloudwatch/data.ts'),
        read('packages/portal-mojo/src/charts/MetricsChart.tsx'),
        read('packages/portal-mojo/src/admin/index.ts'),
        read('apps/portal/src/theme.css'),
        read('apps/showcase/src/theme.css'),
        read('apps/portal/src/theme/admin-cloudwatch.css'),
        read('apps/showcase/src/theme/admin-cloudwatch.css'),
        read('apps/showcase/src/pages/components/demos-admin-cloudwatch.tsx'),
        read('apps/showcase/src/pages/components/ComponentsPage.tsx'),
        read('packages/portal-mojo/docs/admin-cloudwatch.md'),
    ]);

    assert.deepEqual(data.CLOUDWATCH_PERMISSIONS, ['sys.manage_aws']);
    assert.deepEqual([...data.CLOUDWATCH_ACCOUNTS], ['ec2', 'rds', 'redis']);
    assert.deepEqual([...data.CLOUDWATCH_GRANULARITIES], ['minutes', 'hours', 'days']);
    assert.equal(data.CLOUDWATCH_DASHBOARD_CHARTS.length, 12);
    assert.deepEqual(data.CLOUDWATCH_DASHBOARD_CHARTS.map((item) => `${item.account}:${item.category}`), [
        'ec2:cpu', 'ec2:net_out', 'ec2:memory', 'ec2:disk',
        'rds:cpu', 'rds:conns', 'rds:read_latency', 'rds:write_latency',
        'redis:cpu', 'redis:conns', 'redis:cache_misses', 'redis:cache_hits',
    ]);
    assert.equal(data.CLOUDWATCH_DASHBOARD_CHARTS.some((item) => ['elb', 'lambda'].includes(item.account)), false);

    assert.equal(admin.CLOUDWATCH_ADMIN_SECTION.navigationGroup, 'observability');
    assert.deepEqual(admin.CLOUDWATCH_ADMIN_SECTION.routes.map((route) => route.path), ['']);
    assert(admin.ADMIN_SECTIONS.includes(admin.CLOUDWATCH_ADMIN_SECTION));
    assert(admin.adminSectionRoutes([admin.CLOUDWATCH_ADMIN_SECTION]).some((route) => route.path === 'cloudwatch'));
    assert(admin.adminSectionRoutes([admin.CLOUDWATCH_ADMIN_SECTION], { mount: '/system' }).some((route) => route.path === 'system/cloudwatch'));
    assert.doesNotMatch(adminIndex, /cloudwatch.*:id|path:\s*['"]:.*cloudwatch/i);

    const clean = data.sanitizeCloudWatchResources({
        status: true,
        ec2: [{ id: 'i-1', slug: 'api', name: 'api', state: 'running', instance_type: 't3', private_ip: '', public_ip: '' }],
        rds: [{ id: 'db', slug: 'db', engine: 'postgres', status: 'available', instance_class: 'db.t3', endpoint: '' }],
        redis: [{ id: 'cache', slug: 'cache', engine: 'redis', status: 'available', node_type: 'cache.t3', num_nodes: 1 }],
    });
    assert.equal(clean.redis[0].num_nodes, 1);
    assert.throws(() => data.sanitizeCloudWatchResources({ ec2: [], rds: [], redis: [{ id: 'x', slug: 'x', status: 'available', num_nodes: 0 }] }), /positive integer/);
    assert.throws(() => data.sanitizeCloudWatchResources({ data: { ec2: [], rds: [], redis: [] } }), /top-level ec2/);
    assert(!data.sanitizeCloudWatchError('Authorization: Bearer secret AKIA1234567890123456').message.includes('secret'));

    const login = await mock.mockFetch('/api/login', { method: 'POST', body: { username: 'showcase.operator@nativemojo.com', password: 'mojo' } });
    const headers = { Authorization: `Bearer ${login.data.access_token}` };
    const resources = await mock.mockFetch('/api/aws/cloudwatch/resources', { headers });
    assert.equal(resources.status, true);
    assert.equal(resources.data, undefined, 'resource arrays are envelope-top-level');
    assert.equal(resources.ec2.length, 3);
    assert.equal(resources.redis.every((row) => row.num_nodes > 0), true);

    const deniedLogin = await mock.mockFetch('/api/login', { method: 'POST', body: { username: 'support.viewer@nativemojo.com', password: 'mojo' } });
    assert.equal((await mock.mockFetch('/api/aws/cloudwatch/resources', { headers: { Authorization: `Bearer ${deniedLogin.data.access_token}` } })).error_code, 403);

    client.installAuthHooks({ preRequest: async () => {}, authHeader: () => login.data.access_token });
    const now = Math.floor(Date.now() / 1000);
    mock.clearMockRequestHistory();
    const all = await data.loadCloudWatchSeries({ account: 'ec2', category: 'cpu', slugs: '', granularity: 'hours', stat: 'avg', dt_start: now - 7200, dt_end: now });
    const request = mock.getMockRequestHistory().find((entry) => entry.path === '/api/aws/cloudwatch/fetch');
    assert(request);
    assert.equal('slugs' in request.params, false, 'empty selection omits slugs so backend discovers resources');
    assert.deepEqual(Object.keys(request.params).sort(), ['account', 'category', 'dt_end', 'dt_start', 'granularity', 'stat']);
    assert.equal(all.datasets.length, 2, 'duplicate EC2 Name tags collapse in the backend response map');

    const rawId = await data.loadCloudWatchSeries({ account: 'ec2', category: 'cpu', slugs: 'i-0abc0002', granularity: 'hours', stat: 'avg', dt_start: now - 7200, dt_end: now });
    assert.equal(rawId.datasets[0].label, 'worker-prod', 'raw-id input receives the backend friendly response slug');
    const explicitlyEmpty = await mock.mockFetch('/api/aws/cloudwatch/fetch', { headers, params: { account: 'ec2', category: 'cpu', slugs: '', granularity: 'hours', dt_start: now - 7200, dt_end: now } });
    assert.deepEqual(explicitlyEmpty.data.data, {});
    assert.equal((await mock.mockFetch('/api/aws/cloudwatch/fetch', { headers, params: { account: 'ec2', category: 'cpu', granularity: 'weeks' } })).error_code, 400);

    assert.match(metricsChart, /allowedGranularities\?: string\[\]/);
    assert.match(metricsChart, /refreshSignal\?: unknown/);
    assert.match(metricsChart, /if \(range\.kind === 'quick'\) setRange[\s\S]*else void query\.refetch\(\)/, 'quick refresh does not also refetch');
    assert.doesNotMatch(metricsChart, /if \(range\.kind === 'quick'\) setRange[^;]+;\s*void query\.refetch\(\)/);
    assert.match(page, /EAGER_CHART_COUNT = 4/);
    assert.match(cloudwatchChart, /IntersectionObserver/);
    assert.match(cloudwatchChart, /showRefresh=\{false\}/);
    assert.match(page, /300_000/);
    assert.match(resourceDetail, /slugs=\{\[resource\.id\]\}/);
    assert.match(page, /modal\.detail/);
    assert.match(page, /import\('\.\/CloudWatchResourceDetail'\)/, 'resource detail code is lazy-loaded only after selection');
    assert.doesNotMatch(page, /useNavigate|useParams/);
    assert.match(dataSource, /if \(typeof params\.slugs === 'string' && params\.slugs\.trim\(\)\) wire\.slugs/);
    assert.match(dataSource, /catch \(error\)[\s\S]*sanitizeCloudWatchError/);

    assert.equal(portalCss, showcaseCss);
    assert.doesNotMatch(portalCss, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(portalTheme, /admin-dashboard\.css/);
    assert.match(portalTheme, /admin-cloudwatch\.css/);
    assert.match(showcaseTheme, /admin-dashboard\.css/);
    assert.match(showcaseTheme, /admin-cloudwatch\.css/);
    assert.match(demo, /CloudWatchDashboardPage/);
    assert.match(components, /admin-cloudwatch/);
    assert.match(docs, /Name tags|Name tag/i);
    assert.match(docs, /ELB and Lambda/);

    console.log('admin CloudWatch contract verified');
} finally {
    await server.close();
}
