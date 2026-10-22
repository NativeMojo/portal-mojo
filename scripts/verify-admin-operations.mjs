import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '', origin: 'http://localhost' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
globalThis.location = window.location;
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const bridge = await server.ssrLoadModule('/packages/portal-mojo/src/client/operations-mock.ts');
    const fleet = await server.ssrLoadModule('/packages/portal-mojo/src/client/operational-fleet-mock.ts');
    const geo = await server.ssrLoadModule('/packages/portal-mojo/src/client/geo-provider-mock.ts');
    const login = await mock.mockFetch('/api/login', { method: 'POST', body: { username: 'dns.platform@nativemojo.com', password: 'mojo' } });
    const original = login.data.access_token;
    const claims = JSON.parse(Buffer.from(original.split('.')[1], 'base64url').toString());
    const headers = (patch = {}) => {
        const value = { ...claims, ...patch };
        if (patch.auth_time === null) delete value.auth_time;
        return { Authorization: `Bearer ${original.split('.')[0]}.${Buffer.from(JSON.stringify(value)).toString('base64url')}.mock-signature` };
    };
    let result = await mock.mockFetch('/api/account/admin/bootstrap', { headers: headers() });
    assert.equal(result.status, true); assert.equal(result.data.user.id, claims.uid); assert.equal(result.data.features.platform.capabilities.infrastructure_managed, true);
    assert.equal((await mock.mockFetch('/api/account/admin/bootstrap', { method: 'POST', headers: headers() })).error_code, 405);
    for (const credential_kind of ['api_key', 'group_token', 'group_scoped_token']) assert.equal((await mock.mockFetch('/api/account/admin/bootstrap', { headers: headers({ credential_kind }) })).error_code, 403);
    assert.equal((await mock.mockFetch('/api/account/admin/bootstrap', { headers: headers({ token_type: 'user_api_key' }) })).status, true, 'Ordinary operator bootstrap admits a per-user API key');
    fleet.setMockOperationalFleetScenario('external');
    result = await mock.mockFetch('/api/account/admin/bootstrap', { headers: headers() });
    assert.equal(result.data.infrastructure.mode, 'external'); assert.equal(result.data.features.platform.capabilities.infrastructure_managed, false);
    fleet.setMockOperationalFleetScenario('healthy');
    result = await mock.mockFetch('/api/account/admin/settings', { headers: headers() });
    assert.equal(result.data.schema_version, 1); assert(result.data.provider_setup.geoip); assert.equal(result.data.sms, undefined);
    const user = { id: 44, is_active: true, is_superuser: false, permissions: { users: true } };
    assert.equal((await bridge.operationsMock('/api/account/admin/bootstrap', {}, { user })).status, true, 'Finite category users admits manage_users bootstrap');
    assert.equal((await bridge.operationsMock('/api/aws/capacity', {}, { user: { ...user, permissions: { admin: true } } })).code, 403);
    assert.equal((await bridge.operationsMock('/api/account/admin/settings', {}, { user })).error_code, 403);
    assert.equal((await bridge.operationsMock('/api/account/admin/bootstrap', {}, { user: { ...user, is_active: false, is_superuser: true } })).error_code, 401);
    const secret = 'distinctive-private-geo-key-7f8e9d';
    const body = { action: 'test_providers', topic: 'geoip', providers: { expected_revision: geo.geoProviderSetupMock().configuration_revision, geoip: { ...geo.geoProviderSetupMock().geoip, GEOIP_API_KEY_MOJO: secret } } };
    delete body.providers.geoip.GEOIP_API_KEY_MOJO_CONFIGURED; delete body.providers.geoip.GEOIP_API_KEY_MOJO_HINT;
    assert.equal((await mock.mockFetch('/api/account/admin/settings', { method: 'POST', body, headers: headers({ auth_time: null }) })).error_code, 440, 'No invented freshness for a superuser bearer');
    assert.equal((await mock.mockFetch('/api/account/admin/settings', { method: 'POST', body, headers: { ...headers(), Origin: 'https://foreign.example.invalid' } })).error_code, 403);
    assert.equal((await mock.mockFetch('/api/account/admin/settings', { method: 'POST', body, headers: headers() })).tested, true);
    const history = JSON.stringify(mock.getMockRequestHistory());
    assert(!history.includes(secret)); assert(!history.includes('Authorization')); assert(!history.includes('providers'));
    const maintenance = await server.ssrLoadModule('/packages/portal-mojo/src/client/maintenance-mock.ts');
    maintenance.setMockMaintenanceScenario('external');
    result = await mock.mockFetch('/api/account/admin/bootstrap', { headers: headers() });
    assert.equal(result.data.infrastructure.mode, 'external'); assert.equal(result.data.features.platform.capabilities.infrastructure_managed, false);
    maintenance.setMockMaintenanceScenario('bootstrap-denied');
    assert.equal((await mock.mockFetch('/api/account/admin/bootstrap', { headers: headers() })).error_code, 403);
    maintenance.setMockMaintenanceScenario('bootstrap-malformed');
    result = await mock.mockFetch('/api/account/admin/bootstrap', { headers: headers() });
    assert.equal(result.data.infrastructure.mode, undefined); assert.equal(result.data.features.platform.capabilities.infrastructure_managed, undefined);
    maintenance.setMockMaintenanceScenario('findings');
    const serving = await server.ssrLoadModule('/packages/portal-mojo/src/client/serving-mock.ts');
    const parsers = await server.ssrLoadModule('/packages/portal-mojo/src/admin/edge/serving-data.ts');
    const readiness = () => mock.mockFetch('/api/account/admin/setup/readiness', { headers: headers({ auth_time: 0 }), params: { section: 'hosting_vhosts' } });
    serving.setMockServingScenario('ready');
    assert.equal((await readiness()).error_code, 403, 'Readiness requires a successful same-identity bootstrap');
    await mock.mockFetch('/api/account/admin/bootstrap', { headers: headers({ auth_time: 0 }) });
    assert.equal(parsers.parseHostingReadiness((await readiness()).data).overall, 'pass', 'Read-only readiness has no invented freshness timeout');
    for (const scenario of ['http-disabled', 'unavailable', 'unexpected-issuance']) {
        serving.setMockServingScenario(scenario);
        const value = (await mock.mockFetch('/api/account/admin/bootstrap', { headers: headers() })).data;
        const parsed = parsers.parseServingBootstrap(value, claims.uid);
        assert.equal(parsed.edge.http_enabled, scenario === 'http-disabled' ? false : scenario === 'unavailable' ? null : true);
        if (scenario === 'unexpected-issuance') assert.equal(parsed.edge.dnsman_issuance, null);
        assert.equal(value.features.webapps.enabled, true, 'Serving facts do not overwrite Deployment features');
        assert(Array.isArray(value.webapp_groups)); assert.equal(value.features.settings.capabilities.owner_edit, true);
    }
    for (const scenario of ['reordered', 'truncated', 'missing-section', 'readiness-malformed', 'stale-refresh']) {
        serving.setMockServingScenario(scenario);
        await mock.mockFetch('/api/account/admin/bootstrap', { headers: headers({ auth_time: 0 }) });
        const report = (await readiness()).data;
        if (['missing-section', 'readiness-malformed'].includes(scenario)) assert.throws(() => parsers.parseHostingReadiness(report));
        else {
            const parsed = parsers.parseHostingReadiness(report); assert.equal(parsed.sections[0].code, 'hosting_vhosts');
            if (scenario === 'truncated') assert.equal(parsed.sections[0].coverage.omitted, 2);
            if (scenario === 'stale-refresh') assert.equal((await readiness()).error_code, 503);
        }
    }
    serving.setMockServingScenario('ready');
    for (const role of ['viewer', 'platform', 'webapp', 'group', 'denied']) {
        const session = await mock.mockFetch('/api/login', { method: 'POST', body: { username: `deployments.${role}@nativemojo.com`, password: 'mojo' } });
        assert.equal(session.status, true, `Deployment ${role} persona is usable`);
        const personaHeaders = { Authorization: `Bearer ${session.data.access_token}` };
        const apiLane = await mock.mockFetch('/api/account/admin/platform', { headers: personaHeaders, params: { sections: 'deployments,api' } });
        const webLane = await mock.mockFetch('/api/edge/webapp/summaries', { headers: personaHeaders });
        assert.equal(apiLane.status, ['viewer', 'platform'].includes(role));
        assert.equal(webLane.status, ['viewer', 'webapp'].includes(role));
    }
    const manager = await mock.mockFetch('/api/login', { method: 'POST', body: { username: 'dns.manager@nativemojo.com', password: 'mojo' } });
    const managerHeaders = { Authorization: `Bearer ${manager.data.access_token}` };
    const register = (domain, credential = 8101) => mock.mockFetch('/api/dnsman/registrar/register-existing', { method: 'POST', headers: managerHeaders, body: { group: 1, domain, credential } });
    assert.equal((await register('integration-owned.example')).status, true);
    assert.equal((await register(' INTEGRATION-OWNED.EXAMPLE. ')).status, false, 'Normalized duplicate is refused');
    for (const credential of [8102, 8104, 8105, 8106]) assert.equal((await register(`credential-${credential}.example`, credential)).status, false);
    assert.equal((await register('provider-failure.example')).status, false);
    mock.armMockDomainRegistrarSaveFault('warning');
    result = await mock.mockFetch('/api/dnsman/domain/8201', { method: 'POST', headers: managerHeaders, body: { auto_renew: false } });
    assert.equal(result.status, true); assert(result.data.last_error);
    mock.armMockDomainRegistrarSaveFault('ambiguous');
    assert.equal((await mock.mockFetch('/api/dnsman/domain/8201', { method: 'POST', headers: managerHeaders, body: { privacy: false } })).error_code, 503);
    result = await mock.mockFetch('/api/dnsman/domain/8201', { headers: managerHeaders }); assert.equal(result.data.privacy, false); assert(result.data.last_error);
    const source = await readFile('packages/portal-mojo/src/client/mock.ts', 'utf8');
    assert(!/^import .*operations-mock/m.test(source)); assert(source.includes("await import('./operations-mock')"));
    console.log('PASS operations bridge: exact admission, confined provenance, allowed per-user keys, real freshness, external facts, Geo catalog and safe history');
} finally { await server.close(); }
