// Targeted executable contract verifier for Admin Metrics Explorer (#1300).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

try {
    const [admin, data, explorer, client, mock, me, stats, chart] = await Promise.all([
        server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts'),
        server.ssrLoadModule('/packages/portal-mojo/src/admin/monitoring/metrics-explorer-data.ts'),
        server.ssrLoadModule('/packages/portal-mojo/src/admin/monitoring/metrics-explorer-client.ts'),
        server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts'),
        server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts'),
        server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts'),
        server.ssrLoadModule('/packages/portal-mojo/src/charts/stats.ts'),
        server.ssrLoadModule('/packages/portal-mojo/src/charts/MetricsChart.tsx'),
    ]);
    const [pageSource, pickerSource, adapterSource, chartSource] = await Promise.all([
        read('packages/portal-mojo/src/admin/monitoring/MetricsExplorerPage.tsx'),
        read('packages/portal-mojo/src/admin/monitoring/MetricsSourcePicker.tsx'),
        read('packages/portal-mojo/src/admin/monitoring/metrics-explorer-client.ts'),
        read('packages/portal-mojo/src/charts/MetricsChart.tsx'),
    ]);

    assert.deepEqual(admin.METRICS_EXPLORER_PERMISSIONS, ['sys.view_metrics', 'sys.metrics']);
    assert.deepEqual(admin.METRICS_PERMISSIONS_ADMIN_PERMISSIONS,
        ['sys.manage_incidents', 'sys.metrics', 'sys.manage_metrics']);
    assert.deepEqual(admin.MONITORING_ADMIN_SECTION.routes.map((route) => route.path),
        ['logs', 'metrics/explorer', 'metrics/permissions']);
    assert(admin.adminSectionRoutes([admin.MONITORING_ADMIN_SECTION])
        .some((route) => route.path === 'metrics/explorer'));
    assert(admin.adminSectionRoutes([admin.MONITORING_ADMIN_SECTION], { mount: '/system' })
        .some((route) => route.path === 'system/metrics/explorer'));

    const visible = (permissions, clause) => me.hasPermission({ id: 700, permissions }, clause, null);
    assert.equal(visible({ view_metrics: true }, admin.METRICS_EXPLORER_PERMISSIONS), true);
    assert.equal(visible({ view_metrics: true }, admin.METRICS_PERMISSIONS_ADMIN_PERMISSIONS), false);
    assert.equal(visible({ metrics: true }, admin.METRICS_EXPLORER_PERMISSIONS), true);
    assert.equal(visible({ metrics: true }, admin.METRICS_PERMISSIONS_ADMIN_PERMISSIONS), true);
    assert.equal(visible({ manage_metrics: true }, admin.METRICS_EXPLORER_PERMISSIONS), false);
    assert.equal(visible({ manage_metrics: true }, admin.METRICS_PERMISSIONS_ADMIN_PERMISSIONS), true);
    assert.equal(me.hasPermission({ id: 700, permissions: {} }, admin.METRICS_EXPLORER_PERMISSIONS,
        { permissions: { view_metrics: true } }), false, 'tenant grants cannot mount global Metrics Explorer');

    assert.deepEqual(data.parseMetricAccount(' public '), { kind: 'public', value: 'public' });
    assert.deepEqual(data.parseMetricAccount('group-42'), { kind: 'group', value: 'group-42', id: 42 });
    assert.deepEqual(data.parseMetricAccount('user-9'), { kind: 'user', value: 'user-9', id: 9 });
    assert.deepEqual(data.parseMetricAccount('ops:custom'), { kind: 'custom', value: 'ops:custom' });
    for (const malformed of ['group-0', 'group--1', 'group-x', 'user-01', 'user-']) {
        assert.throws(() => data.parseMetricAccount(malformed), /positive integer/);
    }
    assert.deepEqual(data.dedupeMetricSlugs(['auth:failures', 'auth:failures', 'foo:count']),
        ['auth:failures', 'foo:count']);
    assert.deepEqual(data.planMetricHistoryRequests(['auth:failures', 'foo:count', 'bar:count']),
        [['auth:failures'], ['foo:count'], ['bar:count']]);
    assert.throws(() => data.dedupeMetricSlugs(['bad,slug']), /comma-delimited/);

    const login = await mock.mockFetch('/api/login', {
        method: 'POST', body: { username: 'showcase.operator@nativemojo.com', password: 'mojo' },
    });
    const headers = { Authorization: `Bearer ${login.data.access_token}` };
    client.installAuthHooks({ preRequest: async () => {}, authHeader: () => login.data.access_token });

    const catalog = await explorer.discoverMetrics({ resource: 'accounts', start: 0, size: 500 });
    assert.equal(catalog.resource, 'accounts');
    assert.deepEqual(catalog.filters, { search: '' });
    assert(catalog.data.includes('global'));
    assert(catalog.data.includes('ops-private'));
    assert(!catalog.data.includes('finance-hidden'));
    assert.equal(catalog.count, catalog.data.length, 'hidden accounts do not influence count');
    const collisions = await explorer.discoverMetrics({ resource: 'slugs', account: 'global', category: 'collisions', start: 0, size: 1 });
    assert.equal(collisions.count, 2);
    assert.equal(collisions.pageCount, 1);
    assert.equal(collisions.nextStart, 1);
    assert.deepEqual(collisions.filters, { account: 'global', category: 'collisions', search: '' });
    await assert.rejects(() => explorer.discoverMetrics({ resource: 'categories', account: 'finance-hidden' }), /permission denied/i);

    const now = Math.floor(Date.now() / 1000);
    mock.clearMockRequestHistory();
    const repaired = await explorer.loadExactMetricSeries({
        account: 'global', slugs: 'foo:count,bar:count', granularity: 'hours',
        dt_start: now - 7200, dt_end: now, child_kind: undefined, breakdown: undefined,
    });
    assert.deepEqual(repaired.datasets.map((series) => series.label), ['foo:count', 'bar:count']);
    const fetches = mock.getMockRequestHistory().filter((entry) => entry.path === '/api/metrics/fetch');
    assert.equal(fetches.length, 2, 'duplicate tails are isolated');
    assert(fetches.every((entry) => 'dt_start' in entry.params && 'dt_end' in entry.params));
    assert(fetches.every((entry) => !('dr_start' in entry.params) && !('dr_end' in entry.params)));
    const lossy = await mock.mockFetch('/api/metrics/fetch', {
        headers, params: { account: 'global', slugs: 'foo:count,bar:count', granularity: 'hours', dt_start: now - 7200, dt_end: now },
    });
    assert.deepEqual(Object.keys(lossy.data.data), ['count'], 'central mock intentionally mirrors live tail collision');

    const points = await explorer.fetchMetricPoints({
        account: 'global', slugs: ['auth:failures', 'baseline:new_users'], granularity: 'hours', when: now,
    });
    assert.deepEqual(points.map((point) => point.slug), ['auth:failures', 'baseline:new_users']);
    assert.equal(points[1].previous, 0);
    assert.equal('deltaPct' in points[1], false, 'previous zero legitimately omits delta_pct');
    const scalar = await explorer.readMetricValue('global', 'limits:max_users');
    assert.deepEqual(scalar, { account: 'global', slug: 'limits:max_users', value: 5000 });
    const dashboardSeries = await mock.mockFetch('/api/metrics/fetch', { headers, params: { account: 'global', slugs: 'user_activity_day,group_activity_day,api_calls,api_errors', granularity: 'days', range: '30d' } });
    assert.equal(dashboardSeries.status, true);

    assert.equal(stats.csvEscape('=SUM(A1:A2)'), "'=SUM(A1:A2)");
    assert.equal(stats.csvEscape('+cmd'), "'+cmd");
    assert.equal(stats.csvEscape('-formula'), "'-formula");
    assert.equal(stats.csvEscape('@link'), "'@link");
    assert.equal(stats.csvEscape('\tformula'), "'\tformula");
    assert.equal(stats.csvEscape('\rformula'), '"\'\rformula"');
    assert.equal(stats.csvEscape(-42), '-42', 'numeric negatives stay numeric');
    assert.equal(stats.csvEscape('line\r\n"two"'), '"line\r\n""two"""');

    const geofence = chart.remapMetricSeriesIdentity({
        labels: ['now'],
        datasets: [
            { label: 'blocks', data: [9] },
            { label: 'exempt', data: [2] },
        ],
    }, ['geofence:blocks', 'geofence:exempt']);
    assert.deepEqual(geofence.datasets.map((series) => series.label),
        ['geofence:blocks', 'geofence:exempt'], 'default charts repair unique live tails');
    assert.throws(() => chart.remapMetricSeriesIdentity({
        labels: ['now'], datasets: [{ label: 'count', data: [1] }],
    }, ['foo:count', 'bar:count']), /ambiguous.*exact series loader/i);

    assert.match(adapterSource, /mojoCall\('\/api\/metrics\/discover'/);
    assert.doesNotMatch(adapterSource, /mojoList/);
    assert.match(chartSource, /queryKey:\s*\['metrics',\s*seriesCacheKey,\s*wire\]/);
    assert.match(chartSource, /loadSeries\(wire\)/);
    assert.match(pageSource, /const callerId = auth\.uid \?\? 'anonymous'/);
    assert.match(pageSource, /enabled:\s*identityReady/);
    assert.match(pickerSource, /\{groupDirectory\s*&&\s*\([\s\S]*?<CollectionSelect/);
    assert.match(pickerSource, /\{userDirectory\s*&&\s*\([\s\S]*?<CollectionSelect/);
    const productionPage = stripComments(pageSource);
    assert.doesNotMatch(productionPage, /metrics\/record|value\/set|metrics\/permissions|\b_mode\b/);
    assert.doesNotMatch(productionPage, /dr_start|dr_end/);

    console.log('admin metrics explorer contract verified');
} finally {
    try {
        const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
        client.installAuthHooks(null);
    } finally {
        await server.close();
    }
}
