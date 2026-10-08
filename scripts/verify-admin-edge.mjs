// Targeted contract verifier for the Edge admin domain (#1616): vhosts by
// template kind, site_api routes, upstreams and the fleet blocklist.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = {
    addEventListener() {}, removeEventListener() {}, confirm: () => true,
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const canary = 'canary-edge-private';

try {
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const models = await server.ssrLoadModule('/packages/portal-mojo/src/admin/edge/models.ts');
    const dns = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/models.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const me = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');

    // ── 1. Permission clauses, exactly the server's ──
    assert.deepEqual(admin.EDGE_VIEW_PERMS, ['sys.view_dns', 'sys.manage_dns', 'sys.security']);
    assert.deepEqual(admin.EDGE_MANAGE_PERMS, ['sys.manage_dns', 'sys.security']);
    assert.equal(admin.EDGE_VIEW_PERMS, dns.DNS_VIEW_PERMISSIONS, 'vhost clauses are the DNS clauses, not a copy');
    assert.deepEqual(admin.EDGE_BLOCKLIST_VIEW_PERMS, ['sys.view_security', 'sys.manage_security', 'sys.security']);
    assert.deepEqual(admin.EDGE_BLOCKLIST_MANAGE_PERMS, ['sys.manage_security', 'sys.security']);
    assert.equal(me.hasPermission({ id: 1, permissions: { manage_security: true } }, admin.EDGE_BLOCKLIST_VIEW_PERMS, null), true,
        'manage_security alone can view the blocklist, as on the server');
    assert.equal(me.hasPermission({ id: 1, permissions: {} }, admin.EDGE_BLOCKLIST_VIEW_PERMS, { permissions: { view_security: true } }), false,
        'a member-scoped grant cannot open the fleet blocklist');
    for (const [name, model, endpoint] of [
        ['vhost', models.EdgeVhostModel, '/api/edge/vhost'], ['route', models.EdgeRouteModel, '/api/edge/route'],
        ['upstream', models.EdgeUpstreamModel, '/api/edge/upstream'], ['blocklist', models.EdgeBlocklistModel, '/api/edge/blocklist'],
    ]) assert.equal(model.endpoint, endpoint, `${name} endpoint`);
    assert.equal(models.EdgeUpstreamModel.permissions.delete, undefined, 'an upstream is retired, never deleted');

    // ── 2. Section and navigation registration ──
    const section = admin.EDGE_ADMIN_SECTION;
    assert(admin.ADMIN_SECTIONS.includes(section));
    assert.deepEqual({ id: section.id, basePath: section.basePath, group: section.navigationGroup }, { id: 'edge', basePath: 'edge', group: 'infrastructure' });
    assert.deepEqual(section.routes.map((route) => route.path), ['vhosts', 'upstreams']);
    assert.equal(admin.ADMIN_SECTIONS.indexOf(section), admin.ADMIN_SECTIONS.indexOf(admin.STORAGE_ADMIN_SECTION) + 1, 'Edge follows Storage');
    assert(admin.adminSectionRoutes([section]).some((route) => route.path === 'edge/vhosts'));
    assert(admin.adminSectionRoutes([section], { mount: '/system' }).some((route) => route.path === 'system/edge/upstreams'));
    const network = admin.NETWORK_SECURITY_ADMIN_SECTION;
    const blocklistRoute = network.routes.find((route) => route.path === 'edge-blocklist');
    assert(blocklistRoute, 'the blocklist is a Network Security route');
    assert.deepEqual(blocklistRoute.permissions, admin.EDGE_BLOCKLIST_VIEW_PERMS);
    assert(network.permissions.includes('sys.manage_security'), 'the section union gained the blocklist clause');
    const securityOnly = { id: 9, permissions: { view_security: true } };
    assert.equal(me.hasPermission(securityOnly, section.permissions, null), false, 'a security-only operator is denied the Edge section');
    assert.equal(me.hasPermission(securityOnly, network.permissions, null) && me.hasPermission(securityOnly, blocklistRoute.permissions, null), true,
        'and still reaches the blocklist, which is why it does not live under Edge');

    // ── 3. Sanitizers: positive projection only ──
    const hostile = {
        id: 1, created: 1, modified: 2, kind: 'api', pool: 'default', is_enabled: true, server_name: 'a.example', label: 'a',
        spa: false, body_size_mb: 50, quiet_paths: ['/health', 7], serve_static: false, mojosec_policy: {}, redirect_to: null,
        alias_of: canary, web_root_name: canary,
        domain: { id: 2, name: 'example', provider: 'route53', status: 'active', expires: null, group: canary },
        upstream: { id: 3, name: 'up', kind: 'http', host: canary }, certificate: { id: 4, common_name: 'a.example', status: 'active', not_after: null, pem: canary },
        vhost: { id: 1, kind: 'site_api', is_enabled: true, server_name: 'a.example', domain: canary }, path_prefix: '/api',
        name: 'up', host: '10.0.0.1', port: 80, socket_path: null, group: { id: 5, name: 'G', uuid: canary },
        value: '10.0.0.0/8', mode: 'log', note: 'n', secret: canary,
    };
    const projected = [models.sanitizeEdgeVhostRow(hostile), models.sanitizeEdgeRouteRow(hostile), models.sanitizeEdgeUpstreamRow(hostile), models.sanitizeEdgeBlocklistRow(hostile)];
    assert(!JSON.stringify(projected).includes(canary), 'no key outside the graph reaches a row');
    assert.deepEqual(projected[0].quiet_paths, ['/health']);
    assert.equal('group' in projected[0].domain, false, 'house-ness is not readable off a vhost');
    assert.deepEqual(Object.keys(models.sanitizeEdgeVhostRow({ id: 1, created: 1, kind: 'site', pool: 'default', is_enabled: true, server_name: 'x.example', domain: null })).sort(),
        ['created', 'domain', 'id', 'is_enabled', 'kind', 'pool', 'server_name'], 'a list-graph row gains no default-graph keys');

    // ── 4. List params are allowlists ──
    assert.deepEqual(models.normalizeVhostListParams({ kind: 'api', domain__group: 1, evil: 1, graph: 'raw', sort: '-created', download_format: 'csv' }),
        { graph: 'list', kind: 'api', domain__group: 1, sort: '-created' });
    assert.equal(models.normalizeVhostListParams({ graph: 'default' }).graph, 'default');
    assert.equal(models.normalizeVhostListParams({ sort: 'certificate' }).sort, undefined);
    assert.deepEqual(models.normalizeRouteListParams({ vhost: 3, upstream: 1 }), { graph: 'default', vhost: 3 });
    assert.deepEqual(models.normalizeUpstreamListParams({ is_enabled: true, host: 'x' }), { graph: 'default', is_enabled: true });
    assert.deepEqual(models.normalizeBlocklistListParams({ mode__in: 'log,enforce', note: 'x' }), { graph: 'default', mode__in: 'log,enforce' });
    assert.equal(dns.normalizeDomainListParams({ group__isnull: false }).group__isnull, false, 'the wizard can keep house domains out of the picker');

    // ── 5. The kind cards and the payload allowlist ──
    assert.deepEqual(models.VHOST_KIND_CARDS.map((card) => card.value), ['api', 'site', 'site_api', 'redirect']);
    assert(models.VHOST_KIND_CARDS.every((card) => card.title && card.description && card.icon.startsWith('bi-')));
    const everything = { domain: 8201, label: 'x', certificate: 8401, pool: 'default', is_enabled: true, upstream: 8603, serve_static: true, quiet_paths: ['/h'], body_size_mb: 10, spa: true, redirect_to: 'www.acme.example' };
    const payload = (kind, create = true) => models.buildVhostPayload({ ...everything, kind }, { create });
    assert.deepEqual(payload('api'), { domain: 8201, label: 'x', kind: 'api', certificate: 8401, pool: 'default', is_enabled: true, upstream: 8603, redirect_to: null, spa: false, serve_static: true, quiet_paths: ['/h'], body_size_mb: 10 });
    assert.deepEqual(payload('site'), { domain: 8201, label: 'x', kind: 'site', certificate: 8401, pool: 'default', is_enabled: true, upstream: null, redirect_to: null, spa: true, serve_static: false, quiet_paths: [], body_size_mb: 10 });
    assert.deepEqual(payload('site_api'), { domain: 8201, label: 'x', kind: 'site_api', certificate: 8401, pool: 'default', is_enabled: true, upstream: null, redirect_to: null, spa: true, serve_static: true, quiet_paths: ['/h'], body_size_mb: 10 });
    assert.deepEqual(payload('redirect'), { domain: 8201, label: 'x', kind: 'redirect', certificate: 8401, pool: 'default', is_enabled: true, upstream: null, redirect_to: 'www.acme.example', spa: false, serve_static: false, quiet_paths: [] });
    assert.equal('domain' in payload('site', false), false, 'an edit never sends the domain');
    assert.equal(Object.keys(payload('api')).some((key) => ['mojosec_policy', 'alias_of', 'claims_reserved'].includes(key)), false, 'platform-owned fields are never sent');

    // ── 6. Client mirrors of the server validators ──
    for (const label of ['', '*', 'www', 'a-b', 'a1']) assert.equal(models.validateVhostLabel(label), null, `label ${JSON.stringify(label)}`);
    for (const label of ['-a', 'a-', 'A', 'a.b', 'a_b', 'x'.repeat(64)]) assert.notEqual(models.validateVhostLabel(label), null, `label ${label}`);
    assert.equal(models.deriveServerName('acme.example', ''), 'acme.example');
    assert.equal(models.deriveServerName('acme.example', '*'), '*.acme.example');
    assert.equal(models.validateRedirectTarget('www.acme.example'), null);
    for (const target of ['', 'https://acme.example', 'acme.example/path', 'acme.example:8443', '*.acme.example', 'localhost']) assert.notEqual(models.validateRedirectTarget(target), null, `redirect ${target}`);
    assert.equal(models.validateRequestPath('/api/health'), null);
    for (const path of ['api', '/a//b', '/a/../b', '/a b', '/a;b', `/${'x'.repeat(128)}`]) assert.notEqual(models.validateRequestPath(path), null, `path ${path}`);
    assert.equal(models.validateRoutePrefix('/api'), null);
    assert.match(models.validateRoutePrefix('/'), /whole-host/);
    for (const size of [1, 50, 4096]) assert.equal(models.validateBodySizeMb(size), null);
    for (const size of [0, 4097, 1.5, '50', null]) assert.notEqual(models.validateBodySizeMb(size), null, `size ${size}`);
    const wildcard = { common_name: 'acme.example', sans: ['acme.example', '*.acme.example'] };
    assert.equal(models.certificateCovers(wildcard, 'www.acme.example'), true, 'a wildcard covers exactly one label');
    assert.equal(models.certificateCovers(wildcard, 'a.b.acme.example'), false, 'and not two');
    assert.equal(models.certificateCovers(wildcard, '*.acme.example'), true, 'an identical wildcard name is covered directly');
    assert.equal(models.certificateCovers({ common_name: '*.acme.example', sans: [] }, 'acme.example'), false, 'a wildcard does not cover the apex');
    assert.equal(models.certificateCovers({ common_name: 'ACME.example', sans: null }, 'acme.EXAMPLE'), true);
    assert.match(models.validateRouteDrafts([]), /at least one route/i);
    assert.match(models.validateRouteDrafts([{ path_prefix: '/api', upstream: 1 }, { path_prefix: '/api', upstream: 2 }]), /twice/);
    assert.match(models.validateRouteDrafts([{ path_prefix: '/api', upstream: null }]), /upstream/);
    assert.equal(models.validateRouteDrafts([{ path_prefix: '/api', upstream: 1 }]), null);
    assert.equal(models.quietPathUncovered(['/api/health', '/ws/ping'], ['/api']), '/ws/ping');
    assert.equal(models.validateBlocklistValue('ip', '10.1.2.3/8'), null);
    assert.equal(models.validateBlocklistValue('ip', '2001:db8::/32'), null);
    for (const value of ['', '10.0.0.256', '10.0.0.0/33', 'example.com', '10.0.0.0/8/8']) assert.notEqual(models.validateBlocklistValue('ip', value), null, `ip ${value}`);
    assert.equal(models.validateBlocklistValue('ua', 'curl/7\\.'), null);
    for (const value of ['bad bot', 'a"b', 'a{2}', 'abc\\']) assert.notEqual(models.validateBlocklistValue('ua', value), null, `ua ${value}`);
    // The first pass never refuses what the server accepts; compiling is the server's call.
    for (const value of ['10.9.0.0/255.255.0.0', '10.7.7.7/0.0.0.255', '10.0.0.0/0008', 'fe80::1%eth0', 'fe80::1%eth0/64']) assert.equal(models.validateBlocklistValue('ip', value), null, `ip ${value}`);
    for (const value of ['(?i)bot', 'a*+', '[]]', '(unclosed', '\\q']) assert.equal(models.validateBlocklistValue('ua', value), null, `ua ${value}`);

    // ── 7. The mock speaks the server contract ──
    const login = async (email) => {
        const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } });
        return { Authorization: `Bearer ${response.data.access_token}` };
    };
    const viewer = await login('dns.viewer@nativemojo.com');
    const manager = await login('dns.manager@nativemojo.com');
    const tenant = await login('dns.tenant@nativemojo.com');
    const platform = await login('dns.platform@nativemojo.com');
    const securityViewer = await login('security.viewer@nativemojo.com');
    const securityManager = await login('security.manager@nativemojo.com');
    const securityManageOnly = await login('security.manage-only@nativemojo.com');
    const call = (path, headers, opts = {}) => mock.mockFetch(path, { headers, ...opts });
    const post = (path, headers, body) => call(path, headers, { method: 'POST', body });
    const refused = async (promise, pattern, code = 400) => {
        const response = await promise;
        assert.equal(response.status, false, `expected a refusal matching ${pattern}`);
        assert.equal(response.error_code, code, `${response.error}`);
        assert.match(response.error, pattern);
    };

    assert.equal((await call('/api/edge/vhost', {})).error_code, 401);

    // Graphs, exactly.
    const list = await call('/api/edge/vhost', manager, { params: models.normalizeVhostListParams({ size: 50 }) });
    assert.equal(list.graph, 'list');
    assert.deepEqual(Object.keys(list.data[0]).sort(), ['created', 'domain', 'id', 'is_enabled', 'kind', 'pool', 'server_name']);
    assert.deepEqual(Object.keys(list.data[0].domain).sort(), ['expires', 'id', 'name', 'provider', 'status']);
    assert.deepEqual([...new Set(list.data.map((row) => row.kind))].sort(), ['api', 'redirect', 'site', 'site_api'], 'one fixture per kind');
    const detail = await call('/api/edge/vhost/8703', manager);
    assert.deepEqual(Object.keys(detail.data).sort(), ['body_size_mb', 'certificate', 'created', 'domain', 'id', 'is_enabled', 'kind', 'label', 'modified', 'mojosec_policy', 'pool', 'quiet_paths', 'redirect_to', 'serve_static', 'server_name', 'spa', 'upstream']);
    assert.equal(detail.data.server_name, 'app.acme.example');
    assert.deepEqual(Object.keys(detail.data.certificate).sort(), ['common_name', 'id', 'not_after', 'status']);
    assert.equal((await call('/api/edge/vhost/8704', manager)).data.server_name, 'acme.example', 'an empty label serves the apex');
    assert.deepEqual(Object.keys((await call('/api/edge/vhost/8701', manager)).data.upstream).sort(), ['id', 'kind', 'name']);
    const routes = await call('/api/edge/route', manager, { params: models.normalizeRouteListParams({ vhost: 8703 }) });
    assert.deepEqual(routes.data.map((row) => row.path_prefix), ['/api', '/ws']);
    assert.deepEqual(Object.keys(routes.data[0]).sort(), ['created', 'id', 'modified', 'path_prefix', 'upstream', 'vhost']);
    assert.deepEqual(Object.keys(routes.data[0].vhost).sort(), ['id', 'is_enabled', 'kind', 'server_name']);
    const upstreams = await call('/api/edge/upstream', manager, { params: models.normalizeUpstreamListParams({ size: 50 }) });
    assert.deepEqual(Object.keys(upstreams.data[0]).sort(), ['created', 'group', 'host', 'id', 'is_enabled', 'kind', 'modified', 'name', 'port', 'socket_path']);
    const blocklist = await call('/api/edge/blocklist', securityViewer, { params: models.normalizeBlocklistListParams({ size: 50 }) });
    assert.deepEqual(Object.keys(blocklist.data[0]).sort(), ['created', 'id', 'kind', 'mode', 'modified', 'note', 'value']);
    assert.deepEqual([...new Set(blocklist.data.map((row) => row.mode))].sort(), ['allow', 'enforce', 'log', 'off'], 'one seed per mode');

    // House rows: hidden from every non-superuser list, refused on the detail.
    assert.equal(list.data.some((row) => row.id === 8706), false, 'a global manage_dns holder never lists a house vhost');
    assert((await call('/api/edge/vhost', platform, { params: { size: 50 } })).data.some((row) => row.id === 8706));
    await refused(call('/api/edge/vhost/8706', manager), /House vhosts is restricted to platform administrators/, 403);
    await refused(post('/api/edge/vhost', manager, { domain: 8209, label: 'x', kind: 'site', certificate: 8408, is_enabled: false }), /Creating a vhost on a house domain/, 403);
    await refused(post('/api/edge/route', manager, { vhost: 8706, path_prefix: '/api', upstream: 8601 }), /Creating a route on a house vhost/, 403);

    // Tenancy and the read/write split.
    await refused(post('/api/edge/vhost/8702', viewer, { spa: false }), /permission denied/, 403);
    await refused(call('/api/edge/vhost', tenant), /permission denied/, 403);
    const tenantList = await call('/api/edge/vhost', tenant, { params: { group: 1 } });
    assert.equal(tenantList.status, true, 'a group member lists that group\'s vhosts');
    await refused(post('/api/edge/vhost/8702', tenant, { spa: false }), /permission denied/, 403);
    const groupUpstreams = await call('/api/edge/upstream', tenant, { params: { group: 1 } });
    assert.deepEqual(groupUpstreams.data.map((row) => row.name).sort(), ['acme-backend', 'legacy-api', 'mojo-api', 'mojo-asgi'], 'the group\'s own rows plus the shared ones');

    // The kind matrix.
    const base = { domain: 8201, certificate: 8401, is_enabled: false };
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'm1', kind: 'api' }), /an api vhost requires an upstream/);
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'm2', kind: 'site', upstream: 8603 }), /a site vhost has no whole-host upstream/);
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'm3', kind: 'site_api', upstream: 8603 }), /site_api proxies per-route/);
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'm4', kind: 'redirect' }), /a redirect vhost requires redirect_to/);
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'm5', kind: 'redirect', redirect_to: 'https://x.example/a' }), /not a valid server name/);
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'm6', kind: 'redirect', redirect_to: '*.acme.example' }), /cannot be a wildcard/);
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'm7', kind: 'site', redirect_to: 'www.acme.example' }), /a site vhost has no redirect target/);
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'm8', kind: 'api', upstream: 8603, spa: true }), /spa applies to site and site_api/);
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'm9', kind: 'site', serve_static: true }), /serve_static applies to api and site_api/);
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'm10', kind: 'site', quiet_paths: ['/h'] }), /quiet_paths applies to api and site_api/);
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'm11', kind: 'api', upstream: 8603, quiet_paths: ['/h', '/h'] }), /contains a duplicate/);
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'm12', kind: 'api', upstream: 8603, quiet_paths: ['h'] }), /a quiet path must start with/);
    for (const old of ['static', 'spa', 'proxy']) {
        await refused(post('/api/edge/vhost', manager, { ...base, label: `old-${old}`, kind: old }), new RegExp(`unknown vhost kind '${old}'`));
    }
    // Shared rules.
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'Bad_Label', kind: 'site' }), /label must be empty/);
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'p1', kind: 'site', pool: 'isolated' }), /isolated is not a declared pool \(default\)/);
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'b1', kind: 'site', body_size_mb: 0 }), /between 1 and 4096/);
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'b2', kind: 'site', body_size_mb: '50' }), /must be an integer/);
    await refused(post('/api/edge/vhost', manager, { label: 'nodomain', kind: 'site', certificate: 8401 }), /a vhost requires a domain/);
    await refused(post('/api/edge/vhost', manager, { domain: 8201, label: 'nocert', kind: 'site', is_enabled: false }), /a vhost requires a certificate/);
    await refused(post('/api/edge/vhost/8702', manager, { domain: 8202 }), /cannot be moved to another domain/);
    await refused(post('/api/edge/vhost/8703', manager, { mojosec_policy: { version: 1, impossible_path_families: [], response_class: 'redirect' } }), /response_class for site_api must be site_api/);

    // Coverage and ownership gate ENABLING only; a disabled row may stage either.
    await refused(post('/api/edge/vhost', manager, { domain: 8202, label: 'www', kind: 'site', certificate: 8402, is_enabled: true }), /certificate acme-byo\.example does not cover www\.acme-byo\.example/);
    await refused(post('/api/edge/vhost', manager, { domain: 8202, label: '', kind: 'site', certificate: 8401, is_enabled: true }), /must belong to this vhost's domain/);
    const staged = await post('/api/edge/vhost', manager, { domain: 8202, label: 'www', kind: 'site', certificate: 8402, is_enabled: false });
    assert.equal(staged.status, true, 'a disabled row may stage a certificate that does not cover it yet');
    await refused(post(`/api/edge/vhost/${staged.data.id}`, manager, { is_enabled: true }), /does not cover www\.acme-byo\.example/);
    // Two ENABLED rows cannot share a name; the disabled twin is a staged replacement.
    await refused(post('/api/edge/vhost/8705', manager, { is_enabled: true }), /already serves www\.acme\.example/);
    assert.equal((await post('/api/edge/vhost/8702', manager, { is_enabled: false })).status, true);
    assert.equal((await post('/api/edge/vhost/8705', manager, { is_enabled: true })).data.is_enabled, true, 'the swap works once the live twin is off');

    // Create and read back, one per kind.
    const createdApi = await post('/api/edge/vhost', manager, models.buildVhostPayload({ kind: 'api', domain: 8201, label: 'orders', certificate: 8401, pool: 'default', is_enabled: true, upstream: 8603, serve_static: true, quiet_paths: ['/health'], body_size_mb: 100 }, { create: true }));
    assert.equal(createdApi.status, true, createdApi.error);
    assert.deepEqual({ name: createdApi.data.server_name, upstream: createdApi.data.upstream.id, quiet: createdApi.data.quiet_paths, size: createdApi.data.body_size_mb }, { name: 'orders.acme.example', upstream: 8603, quiet: ['/health'], size: 100 });
    // A reference that names nothing is refused, on create and on update, and a
    // stored vhost cannot lose its certificate even while disabled.
    await refused(post('/api/edge/vhost', manager, { ...base, label: 'ghost', kind: 'api', upstream: 999999 }), /an api vhost requires an upstream/);
    await refused(post(`/api/edge/vhost/${createdApi.data.id}`, manager, { upstream: 999999 }), /an api vhost requires an upstream/);
    await refused(post(`/api/edge/vhost/${createdApi.data.id}`, manager, { certificate: null }), /a vhost requires a certificate/);
    await refused(post(`/api/edge/vhost/${createdApi.data.id}`, manager, { certificate: null, is_enabled: false }), /a vhost requires a certificate/);
    await refused(post(`/api/edge/vhost/${createdApi.data.id}`, manager, { certificate: 999999, is_enabled: false }), /a vhost requires a certificate/);
    assert.deepEqual({ upstream: (await call(`/api/edge/vhost/${createdApi.data.id}`, manager)).data.upstream.id, certificate: (await call(`/api/edge/vhost/${createdApi.data.id}`, manager)).data.certificate.id }, { upstream: 8603, certificate: 8401 }, 'a refused update changes nothing');
    const createdSite = await post('/api/edge/vhost', manager, models.buildVhostPayload({ kind: 'site', domain: 8201, label: 'docs', certificate: 8401, pool: 'default', is_enabled: true, spa: true, body_size_mb: 50 }, { create: true }));
    assert.equal(createdSite.data.spa, true);
    const createdRedirect = await post('/api/edge/vhost', manager, models.buildVhostPayload({ kind: 'redirect', domain: 8201, label: 'old', certificate: 8401, pool: 'default', is_enabled: true, redirect_to: 'www.acme.example' }, { create: true }));
    assert.deepEqual({ to: createdRedirect.data.redirect_to, size: createdRedirect.data.body_size_mb }, { to: 'www.acme.example', size: 50 });
    assert.equal((await call(`/api/edge/vhost/${createdRedirect.data.id}`, viewer)).data.kind, 'redirect');

    // site_api: the quiet-path check reads the routes of a STORED row, so the
    // only order that works is vhost, then routes, then quiet paths.
    const siteApi = { kind: 'site_api', domain: 8201, label: 'shop', certificate: 8401, pool: 'default', is_enabled: true, spa: true, serve_static: false, quiet_paths: ['/api/health'], body_size_mb: 50 };
    await refused(post('/api/edge/vhost', manager, models.buildVhostPayload(siteApi, { create: true })), /quiet path \/api\/health is not under any route prefix \(none declared\)/);
    const shell = await post('/api/edge/vhost', manager, models.buildVhostPayload({ ...siteApi, quiet_paths: [], is_enabled: false }, { create: true }));
    assert.deepEqual({ ok: shell.status, enabled: shell.data.is_enabled }, { ok: true, enabled: false }, 'created disabled first');
    const shopRoute = await post('/api/edge/route', manager, { vhost: shell.data.id, path_prefix: '/api', upstream: 8603 });
    assert.equal(shopRoute.status, true, shopRoute.error);
    const finalized = await post(`/api/edge/vhost/${shell.data.id}`, manager, models.buildVhostPayload(siteApi, { create: false }));
    assert.deepEqual({ quiet: finalized.data.quiet_paths, enabled: finalized.data.is_enabled }, { quiet: ['/api/health'], enabled: true }, 'one final update carries the quiet paths and the real enablement');
    await refused(post(`/api/edge/vhost/${shell.data.id}`, manager, { quiet_paths: ['/other'] }), /not under any route prefix \(\/api\)/);
    await refused(post(`/api/edge/vhost/${shell.data.id}`, manager, { kind: 'site', quiet_paths: [] }), /cannot carry routes — delete them before changing kind/);

    // Routes.
    await refused(post('/api/edge/route', manager, { vhost: shell.data.id, path_prefix: '/', upstream: 8603 }), /cannot be '\/'/);
    await refused(post('/api/edge/route', manager, { vhost: shell.data.id, path_prefix: '/a//b', upstream: 8603 }), /may not contain '\/\/'/);
    await refused(post('/api/edge/route', manager, { vhost: shell.data.id, path_prefix: '/api', upstream: 8601 }), /already has a route for \/api/);
    await refused(post('/api/edge/route', manager, { vhost: shell.data.id, path_prefix: '/x', upstream: 8605 }), /shared one or belong to this vhost's group/);
    await refused(post('/api/edge/route', manager, { vhost: 8702, path_prefix: '/api', upstream: 8603 }), /routes belong to site_api vhosts, not site/);
    await refused(post('/api/edge/route', manager, { vhost: shell.data.id, path_prefix: '/x' }), /a route requires an upstream/);
    await refused(post('/api/edge/route', viewer, { vhost: shell.data.id, path_prefix: '/x', upstream: 8603 }), /permission denied/, 403);
    // Deleting the last route under a quiet path makes the next save fail.
    assert.equal((await call(`/api/edge/route/${shopRoute.data.id}`, manager, { method: 'DELETE' })).status, 'deleted');
    await refused(post(`/api/edge/vhost/${shell.data.id}`, manager, { spa: false }), /quiet path \/api\/health is not under any route prefix \(none declared\)/);
    assert.equal((await call(`/api/edge/vhost/${shell.data.id}`, manager, { method: 'DELETE' })).status, 'deleted');
    assert.equal((await call(`/api/edge/vhost/${shell.data.id}`, manager)).error_code, 404);

    // Upstreams: `is_enabled` is the only writable field; declare and retire are platform-only.
    const pinned = await post('/api/edge/upstream/8603', manager, { is_enabled: false, host: '169.254.169.254', port: 1, name: 'evil', group: null });
    assert.deepEqual({ host: pinned.data.host, port: pinned.data.port, name: pinned.data.name, enabled: pinned.data.is_enabled }, { host: '10.0.4.12', port: 8080, name: 'acme-backend', enabled: false });
    await post('/api/edge/upstream/8603', manager, { is_enabled: true });
    await refused(post('/api/edge/upstream/8603', viewer, { is_enabled: false }), /permission denied/, 403);
    await refused(post('/api/edge/upstream', manager, { name: 'x', kind: 'http' }), /not allowed/, 403);
    await refused(call('/api/edge/upstream/8603', manager, { method: 'DELETE' }), /not allowed/, 403);
    await refused(post('/api/edge/upstream/declare', manager, { name: 'x', kind: 'http', host: '10.0.0.1', port: 80 }), /Declaring an edge upstream is restricted to platform administrators/, 403);
    await refused(post('/api/edge/upstream/retire', manager, { upstream: 8603 }), /Retiring an edge upstream is restricted to platform administrators/, 403);
    await refused(post('/api/edge/upstream/declare', platform, { name: 'x', kind: 'tcp' }), /kind must be 'http' or 'unix'/);
    await refused(post('/api/edge/upstream/declare', platform, { name: 'Bad Name', kind: 'http', host: '10.0.0.1', port: 80 }), /upstream name must be lowercase/);
    await refused(post('/api/edge/upstream/declare', platform, { name: 'meta', kind: 'http', host: '169.254.169.254', port: 80 }), /link-local/);
    await refused(post('/api/edge/upstream/declare', platform, { name: 'p', kind: 'http', host: '10.0.0.1', port: 70000 }), /between 1 and 65535/);
    await refused(post('/api/edge/upstream/declare', platform, { name: 's', kind: 'unix', socket_path: '/run/mojo/../../etc/x.sock' }), /must resolve under \/run\/mojo/);
    await refused(post('/api/edge/upstream/declare', platform, { name: 'h', kind: 'http', host: '10.0.0.1', port: 80, socket_path: '/run/mojo/a.sock' }), /an http upstream has no socket path/);
    await refused(post('/api/edge/upstream/declare', platform, { name: 'mojo-api', kind: 'http', host: '10.0.0.1', port: 80 }), /already exists/);
    const declared = await post('/api/edge/upstream/declare', platform, { name: 'orders-api', kind: 'unix', socket_path: '/run/mojo/orders.sock' });
    assert.deepEqual({ kind: declared.data.kind, socket: declared.data.socket_path, host: declared.data.host, group: declared.data.group, enabled: declared.data.is_enabled }, { kind: 'unix', socket: '/run/mojo/orders.sock', host: null, group: null, enabled: true });
    const retired = await post('/api/edge/upstream/retire', platform, { upstream: declared.data.id });
    assert.equal(retired.data.is_enabled, false, 'retiring disables; the row stays');
    assert((await call('/api/edge/upstream', platform, { params: { size: 50 } })).data.some((row) => row.id === declared.data.id));

    // Blocklist: GLOBAL security grants only.
    await refused(call('/api/edge/blocklist', manager), /permission denied/, 403);
    await refused(call('/api/edge/blocklist', tenant, { params: { group: 1 } }), /permission denied/, 403);
    assert.equal((await call('/api/edge/blocklist', securityManageOnly)).status, true, 'manage_security alone may view');
    await refused(post('/api/edge/blocklist', securityViewer, { kind: 'ip', value: '10.9.9.9' }), /permission denied/, 403);
    const normalized = await post('/api/edge/blocklist', securityManager, { kind: 'ip', value: '10.1.2.3/8', note: 'verify' });
    assert.deepEqual({ value: normalized.data.value, mode: normalized.data.mode }, { value: '10.0.0.0/8', mode: 'log' }, 'stored as its network, and log by default');
    assert.equal((await post('/api/edge/blocklist', securityManager, { kind: 'ip', value: '192.0.2.44' })).data.value, '192.0.2.44/32');
    assert.equal((await post('/api/edge/blocklist', securityManager, { kind: 'ip', value: '2001:DB8:0:0:1::5/64' })).data.value, '2001:db8::/64');
    await refused(post('/api/edge/blocklist', securityManager, { kind: 'ip', value: '10.0.0.1/8' }), /already exists/);
    await refused(post('/api/edge/blocklist', securityManager, { kind: 'ip', value: 'example.com' }), /is not an IP address or CIDR network/);
    await refused(post('/api/edge/blocklist', securityManager, { kind: 'ua', value: 'bad bot' }), /a user-agent pattern may use/);
    await refused(post('/api/edge/blocklist', securityManager, { kind: 'ua', value: 'abc\\' }), /cannot end with an unescaped backslash/);
    await refused(post('/api/edge/blocklist', securityManager, { kind: 'ua', value: '(unclosed' }), /does not compile/);
    // The server parses with Python's `ipaddress` and compiles with Python's
    // `re`. Every verdict below was taken from Python 3.12, not from JavaScript.
    for (const value of ['010.1.2.3/8', '::ffff:01.2.3.4', '10.0.0.0/255.0.255.0', 'fe80::1%', '10.0.0.0/33', '1.2.3.4/8/9']) {
        await refused(post('/api/edge/blocklist', securityManager, { kind: 'ip', value }), /is not an IP address or CIDR network/);
    }
    for (const [value, stored] of [['10.9.0.0/255.255.0.0', '10.9.0.0/16'], ['10.7.7.7/0.0.0.255', '10.7.7.0/24'], ['10.6.0.0/0016', '10.6.0.0/16'], ['fe80::1%eth0', 'fe80::1%eth0/128'], ['fe80::1%eth0/64', 'fe80::/64']]) {
        const made = await post('/api/edge/blocklist', securityManager, { kind: 'ip', value });
        assert.equal(made.data?.value, stored, `${value}: ${made.error}`);
        await call(`/api/edge/blocklist/${made.data.id}`, securityManager, { method: 'DELETE' });
    }
    for (const value of ['\\q', 'a[]', 'a**', '\\1', 'a|(?i)b', '(?L)a', '[z-a]', '[\\d-a]', '(?(2)a)(b)']) {
        await refused(post('/api/edge/blocklist', securityManager, { kind: 'ua', value }), /user-agent pattern does not compile/);
    }
    for (const value of ['(?i)bot', 'a*+', '[]]', '(a)\\1', 'wget/1\\.', '(a)(?(1)b|c)']) {
        const made = await post('/api/edge/blocklist', securityManager, { kind: 'ua', value });
        assert.equal(made.status, true, `${value}: ${made.error}`);
        await call(`/api/edge/blocklist/${made.data.id}`, securityManager, { method: 'DELETE' });
    }
    await refused(post('/api/edge/blocklist', securityManager, { kind: 'asn', value: '1' }), /unknown blocklist kind/);
    await refused(post('/api/edge/blocklist', securityManager, { kind: 'ip', value: '10.5.0.0/16', mode: 'block' }), /unknown blocklist mode/);
    const flipped = await post(`/api/edge/blocklist/${normalized.data.id}`, securityManager, { mode: 'enforce' });
    assert.equal(flipped.data.mode, 'enforce', 'log first, then enforce');
    await refused(call(`/api/edge/blocklist/${normalized.data.id}`, securityViewer, { method: 'DELETE' }), /permission denied/, 403);
    assert.equal((await call(`/api/edge/blocklist/${normalized.data.id}`, securityManager, { method: 'DELETE' })).status, 'deleted');
    assert.equal((await call('/api/edge/blocklist', securityManager, { params: { mode__in: 'allow,off' } })).data.length, 2);

    // ── 8. Sources ──
    const edgeSources = (await Promise.all(['models.ts', 'api.ts', 'permissions.ts', 'index.ts', 'VhostWizard.tsx', 'VhostsPage.tsx', 'VhostDetail.tsx', 'UpstreamsPage.tsx', 'BlocklistPage.tsx']
        .map((name) => read(`packages/portal-mojo/src/admin/edge/${name}`)))).join('\n');
    // django-mojo removed the reserved-name mechanism (bc2c57b1); a control for
    // it would call an address that does not exist.
    assert(!/claim_reserved|claims_reserved/.test(edgeSources + await read('packages/portal-mojo/src/client/mock.ts')), 'no claim-reserved surface');
    assert(!/['"](static|proxy)['"]/.test(edgeSources), 'no old kind value is referenced');
    assert(!edgeSources.includes('useMutation'));
    assert.match(edgeSources, /is_enabled: false \}, \{ create: true \}/, 'a site_api create is disabled first');
    assert.match(edgeSources, /group__isnull: false/, 'non-superusers never see house domains in the wizard');
    assert.match(edgeSources, /me\?\.is_superuser === true/, 'declare and retire follow the server\'s platform gate');
    const packageCss = await read('packages/portal-mojo/src/styles/components/admin-edge.css');
    assert.equal(packageCss, await read('apps/showcase/src/theme/admin-edge.css'), 'the package and the showcase ship the same Edge styles');
    assert.match(await read('packages/portal-mojo/src/styles/index.css'), /@import "\.\/components\/admin-edge\.css" layer\(portal-mojo\);/);
    assert.match(await read('apps/showcase/src/theme.css'), /admin-edge\.css/);
    assert.match(await read('apps/showcase/src/pages/components/ComponentsPage.tsx'), /admin-edge/);
    const docs = await read('packages/portal-mojo/docs/admin-edge.md');
    for (const topic of [/site_api/, /quiet/i, /Both themes|Themes and showcase/i, /claim/i]) assert.match(docs, topic);

    console.log('verify-admin-edge: all assertions passed');
} finally {
    await server.close();
}
