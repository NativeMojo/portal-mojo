// Targeted contract verifier for global DNS administration (#1429).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { QueryClient } from '@tanstack/react-query';

globalThis.window = {
    addEventListener() {}, removeEventListener() {}, confirm: () => true,
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const secretCanary = 'canary-raw-dns-secret';

try {
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const api = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/api.ts');
    const models = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/models.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const me = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');
    const catalog = await server.ssrLoadModule('/packages/portal-mojo/src/admin/identity/users/sections/permission-catalog.ts');

    assert.deepEqual(models.DNS_VIEW_PERMISSIONS, ['sys.view_dns', 'sys.manage_dns', 'sys.security']);
    assert.deepEqual(models.DNS_MANAGE_PERMISSIONS, ['sys.manage_dns', 'sys.security']);
    const platformPermissions = catalog.GRANULAR_PERMISSION_TABS
        .find((tab) => tab.label === 'Platform').permissions;
    assert.equal(platformPermissions.find((permission) => permission.name === 'view_dns').label, 'View DNS');
    assert.equal(platformPermissions.find((permission) => permission.name === 'manage_dns').label, 'Manage DNS');
    assert.equal(me.hasPermission({ id: 1, permissions: { security: true } }, ['sys.manage_dns'], null), true,
        'existing Security category rolls down to DNS');
    assert.equal(me.hasPermission({ id: 1, permissions: { manage_dns: true } }, ['sys.security'], null), false,
        'DNS authority never rolls up to Security');
    assert.equal(me.hasPermission({ id: 1, permissions: {} }, models.DNS_VIEW_PERMISSIONS,
        { permissions: { view_dns: true } }), false, 'active-member grants cannot open global DNS Admin');
    assert.equal(admin.DNS_ADMIN_SECTION.id, 'dns');
    assert.equal(admin.DNS_ADMIN_SECTION.navigationGroup, 'infrastructure');
    assert.deepEqual(admin.DNS_ADMIN_SECTION.routes.map((route) => route.path), ['credentials']);
    assert(admin.ADMIN_SECTIONS.includes(admin.DNS_ADMIN_SECTION));
    assert(admin.adminSectionRoutes([admin.DNS_ADMIN_SECTION]).some((route) => route.path === 'dns/credentials'));
    assert(admin.adminSectionRoutes([admin.DNS_ADMIN_SECTION], { mount: '/system' })
        .some((route) => route.path === 'system/dns/credentials'));

    assert.equal(models.DomainModel.endpoint, '/api/dnsman/domain');
    assert.equal(models.DnsCredentialModel.endpoint, '/api/dnsman/credential');
    assert.equal(models.DomainPurchaseModel.endpoint, '/api/dnsman/purchase');
    assert.equal(models.CertificateModel.endpoint, '/api/dnsman/certificate');
    assert.equal(models.normalizeDomainListParams({ graph: 'material', filename: 'x', evil: 1 }).graph, 'list');
    assert.equal(models.normalizeCredentialListParams({ graph: 'raw', download_format: 'json' }).graph, 'default');
    const malicious = {
        id: 1, created: 1, modified: 1, name: 'Safe', provider: 'godaddy', status: 'active',
        is_active: true, verified: true, verified_at: 1, domain_count: 1, last_error: null,
        api_key_masked: '****1234', api_secret_masked: '****5678', expires: null,
        api_key: secretCanary, equivalent_secret_container: { anything: secretCanary },
        group: { id: 1, name: 'Group', credential_vault: secretCanary },
        user: { id: 1, display_name: 'User', private_payload: secretCanary },
        credential: { id: 1, name: 'Safe', provider: 'godaddy', is_active: true, verified: true, raw_pair: secretCanary },
        domain_name: 'safe.example', kind: 'register', price: '12', cost: '12', currency: 'USD', years: 1,
        quote_expires: null, operation_id: null, error: null,
        common_name: 'safe.example', sans: ['safe.example'], issuer: null, serial: null,
        not_before: null, not_after: null, renew_after: null, attempts: 0, days_remaining: null,
        domain: { id: 1, name: 'safe.example', provider: 'route53', status: 'active', expires: null, pem_bundle: secretCanary },
    };
    const safeRows = [
        models.sanitizeDnsCredentialRow(malicious),
        models.sanitizeDomainRow(malicious),
        models.sanitizeDomainPurchaseRow(malicious),
        models.sanitizeCertificateRow(malicious),
    ];
    assert(!JSON.stringify(safeRows).includes(secretCanary));
    const queryClient = new QueryClient();
    queryClient.setQueryData(models.DnsCredentialModel.keys.one(1), safeRows[0]);
    queryClient.setQueryData(models.DomainModel.keys.one(1), safeRows[1]);
    queryClient.setQueryData(models.DomainPurchaseModel.keys.one(1), safeRows[2]);
    queryClient.setQueryData(models.CertificateModel.keys.one(1), safeRows[3]);
    assert(!JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.state.data)).includes(secretCanary),
        'equivalent secret containers cannot enter Query cache');
    assert(!JSON.stringify(queryClient.getMutationCache().getAll()).includes(secretCanary),
        'imperative raw-secret operations never create MutationCache variables');
    const sanitized = safeRows[0];
    assert.equal(sanitized.api_key_masked, '****1234');

    assert.throws(() => api.parseDnsCapabilities({}), /unavailable/i);
    assert.throws(() => api.parseDnsCapabilities({ providers: [] }), /unavailable/i);

    const login = async (email) => {
        const response = await mock.mockFetch('/api/login', {
            method: 'POST', body: { username: email, password: 'mojo' },
        });
        return { Authorization: `Bearer ${response.data.access_token}` };
    };
    const viewer = await login('dns.viewer@nativemojo.com');
    const manager = await login('dns.manager@nativemojo.com');
    const tenant = await login('ian@mojoverify.com');
    const platform = await login('dns.platform@nativemojo.com');

    const config = await mock.mockFetch('/api/dnsman/config', { headers: viewer });
    assert.equal(config.status, true);
    assert.equal(api.parseDnsCapabilities(config.data).providers.length, 2);
    const viewerChoice = await mock.mockFetch('/api/dnsman/credential/group-choice', { headers: viewer });
    assert.equal(viewerChoice.error_code, 403);
    for (const field of ['start', 'size']) {
        for (const value of ['', ' ', '1e2', true, [], {}]) {
            assert.throws(() => api.normalizeGroupChoiceParams({ [field]: value }), /Invalid credential group-choice query/);
            const rejected = await mock.mockFetch('/api/dnsman/credential/group-choice', {
                headers: manager, params: { [field]: value },
            });
            assert.equal(rejected.error_code, 400, `${field}=${JSON.stringify(value)} is rejected before coercion`);
        }
    }
    const choices = await mock.mockFetch('/api/dnsman/credential/group-choice', {
        headers: manager, params: { search: 'aCmE', start: 0, size: 1 },
    });
    assert.equal(choices.status, true);
    assert.deepEqual(
        { count: choices.count, start: choices.start, size: choices.size, names: choices.data.map((row) => row.name) },
        { count: 1, start: 0, size: 1, names: ['Acme Corp'] },
        'choice search is case-insensitive and preserves bounded paging metadata',
    );
    const emptyChoices = await mock.mockFetch('/api/dnsman/credential/group-choice', {
        headers: manager, params: { search: 'not-a-real-group-name', start: 0, size: 25 },
    });
    assert.deepEqual(
        { count: emptyChoices.count, data: emptyChoices.data },
        { count: 0, data: [] },
        'a valid non-matching search returns the exact empty list contract',
    );
    const chosen = choices.data[0];
    const exact = await mock.mockFetch('/api/dnsman/credential/group-choice', {
        headers: manager, params: { id: String(chosen.id) },
    });
    assert.deepEqual(exact.data, [chosen]);
    mock.clearMockRequestHistory();
    const rehydrated = await mock.mockFetch('/api/dnsman/credential/group-choice', {
        headers: manager, params: api.normalizeGroupChoiceParams({ id: chosen.id }),
    });
    assert.deepEqual(rehydrated.data, [chosen]);
    const hydrationHistory = mock.getMockRequestHistory();
    assert.deepEqual(hydrationHistory, [{
        method: 'GET', path: '/api/dnsman/credential/group-choice', params: { id: String(chosen.id) },
    }], 'numeric selection rehydrates through exact ?id=, never a child URL');
    const invalidChoice = await mock.mockFetch('/api/dnsman/credential/group-choice', {
        headers: manager, params: { id: chosen.id, search: 'x' },
    });
    assert.equal(invalidChoice.error_code, 400);

    const before = await mock.mockFetch('/api/dnsman/credential', {
        headers: manager, params: { group: chosen.id, size: 100 },
    });
    const failedFirst = await mock.mockFetch('/api/dnsman/credential/link', {
        method: 'POST', headers: manager,
        body: { group: chosen.id, provider: 'godaddy', api_key: 'invalid', api_secret: secretCanary },
    });
    assert.equal(failedFirst.status, false);
    const afterFailedFirst = await mock.mockFetch('/api/dnsman/credential', {
        headers: manager, params: { group: chosen.id, size: 100 },
    });
    assert.equal(afterFailedFirst.count, before.count, 'failed first link adds no row');

    const linked = await mock.mockFetch('/api/dnsman/credential/link', {
        method: 'POST', headers: manager,
        body: { group: chosen.id, provider: 'godaddy', name: 'Verifier DNS', api_key: 'key-1234', api_secret: secretCanary },
    });
    assert.equal(linked.status, true);
    assert.equal(linked.data.verified, true);
    assert(!JSON.stringify(linked).includes(secretCanary));
    const oldMasks = [linked.data.api_key_masked, linked.data.api_secret_masked];
    const failedRotation = await mock.mockFetch('/api/dnsman/credential/link', {
        method: 'POST', headers: manager,
        body: { credential: linked.data.id, group: chosen.id, provider: 'godaddy', api_key: 'reject', api_secret: 'reject' },
    });
    assert.equal(failedRotation.status, false);
    const failedRow = await mock.mockFetch(`/api/dnsman/credential/${linked.data.id}`, { headers: manager });
    assert.equal(failedRow.data.verified, false);
    assert.deepEqual([failedRow.data.api_key_masked, failedRow.data.api_secret_masked], oldMasks);
    const rotated = await mock.mockFetch('/api/dnsman/credential/link', {
        method: 'POST', headers: manager,
        body: { credential: linked.data.id, group: chosen.id, provider: 'godaddy', api_key: 'rotated-4321', api_secret: 'rotated-8765' },
    });
    assert.equal(rotated.data.verified, true);
    assert.notDeepEqual([rotated.data.api_key_masked, rotated.data.api_secret_masked], oldMasks);
    const retired = await mock.mockFetch(`/api/dnsman/credential/${linked.data.id}`, {
        method: 'POST', headers: manager, body: { is_active: false },
    });
    assert.equal(retired.data.is_active, false);

    const tenantGlobal = await mock.mockFetch('/api/dnsman/credential', { headers: tenant, params: { size: 10 } });
    const tenantScoped = await mock.mockFetch('/api/dnsman/credential', { headers: tenant, params: { group: 1, size: 10 } });
    assert.equal(tenantGlobal.error_code, 403, 'tenant membership never opens the global collection');
    assert.equal(tenantScoped.status, true, 'live tenant-scoped REST semantics remain available');

    const managerDiscovery = await mock.mockFetch('/api/dnsman/registrar/discover', { headers: manager });
    assert.equal(managerDiscovery.error_code, 403, 'house discovery remains platform-only');
    const untrackedDiscovery = await mock.mockFetch('/api/dnsman/registrar/discover', {
        headers: platform, params: { untracked: true },
    });
    assert.deepEqual(Object.keys(untrackedDiscovery.data).sort(), ['count', 'domains', 'truncated']);
    assert.equal(untrackedDiscovery.data.count, untrackedDiscovery.data.domains.length);
    assert(untrackedDiscovery.data.domains.every((row) => row.tracked === false));
    assert.deepEqual(Object.keys(untrackedDiscovery.data.domains[0]).sort(), [
        'adoptable', 'auto_renew', 'domain', 'expires', 'hosted_zone', 'hosted_zone_id',
        'name', 'reason', 'record_count', 'registered', 'tracked',
    ]);
    const adopted = await mock.mockFetch('/api/dnsman/registrar/adopt', {
        method: 'POST', headers: platform, body: { domain: untrackedDiscovery.data.domains[0].name },
    });
    assert.equal(adopted.data.group, null);
    const assigned = await mock.mockFetch('/api/dnsman/registrar/assign-group', {
        method: 'POST', headers: platform, body: { domain: adopted.data.id, group: 1 },
    });
    assert.equal(assigned.data.group.id, 1);

    const deleted = await mock.mockFetch(`/api/dnsman/credential/${linked.data.id}`, {
        method: 'DELETE', headers: manager,
    });
    assert.equal(deleted.status, 'deleted');
    const missingAfterDelete = await mock.mockFetch(`/api/dnsman/credential/${linked.data.id}`, { headers: manager });
    assert.equal(missingAfterDelete.error_code, 404);
    assert(!JSON.stringify(mock.getMockRequestHistory()).includes(secretCanary),
        'request history stores no bodies or raw secret variables');
    const requestedPaths = mock.getMockRequestHistory().map((entry) => entry.path);
    assert(!requestedPaths.some((path) => path.startsWith('/api/group')));
    assert(!requestedPaths.some((path) => /\/credential\/group-choice\//.test(path)));

    const credentialSource = stripComments(await read('packages/portal-mojo/src/admin/dns/ProviderCredentialsPage.tsx'));
    const apiSource = stripComments(await read('packages/portal-mojo/src/admin/dns/api.ts'));
    const mockSource = stripComments(await read('packages/portal-mojo/src/client/mock.ts'));
    assert.match(credentialSource, /CollectionSelect/);
    assert.match(credentialSource, /DNS_GROUP_CHOICE_ENDPOINT/);
    assert(!credentialSource.includes('/api/group'));
    assert(!credentialSource.includes('RightPanel'));
    assert(!credentialSource.includes('download'));
    assert(!credentialSource.includes('useMutation'));
    assert(!apiSource.includes('/certificate/material'));
    assert(!mockSource.includes("path === '/api/dnsman/certificate/material'"));
    assert.match(await read('apps/showcase/src/pages/components/ComponentsPage.tsx'), /admin-dns/);
    const showcaseSource = await read('apps/showcase/src/pages/components/demos-admin-dns.tsx');
    assert.equal((showcaseSource.match(/<ProviderCredentialsPage \/>/g) ?? []).length, 3,
        'manager, viewer and unavailable legs render the shipped page');
    assert.match(showcaseSource, /dns\.viewer@nativemojo\.com/);
    assert.match(showcaseSource, /setMockDnsConfigMalformed\(leg === 'unavailable'\)/);
    assert.match(await read('packages/portal-mojo/docs/admin-dns.md'), /Both themes|Themes and showcase/i);

    console.log('verify-admin-dns: all assertions passed');
} finally {
    await server.close();
}
