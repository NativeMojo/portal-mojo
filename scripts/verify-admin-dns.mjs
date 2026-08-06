// Targeted contract verifier for global DNS administration (#1429).
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
    const sanitized = models.sanitizeDnsCredentialRow({
        id: 1, api_key: secretCanary, api_secret: secretCanary, token: secretCanary,
        api_key_masked: '****1234', api_secret_masked: '****5678', nested: { private_key_pem: secretCanary },
    });
    assert(!JSON.stringify(sanitized).includes(secretCanary));
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

    const config = await mock.mockFetch('/api/dnsman/config', { headers: viewer });
    assert.equal(config.status, true);
    assert.equal(api.parseDnsCapabilities(config.data).providers.length, 2);
    const viewerChoice = await mock.mockFetch('/api/dnsman/credential/group-choice', { headers: viewer });
    assert.equal(viewerChoice.error_code, 403);
    const choices = await mock.mockFetch('/api/dnsman/credential/group-choice', {
        headers: manager, params: { search: 'north', start: 0, size: 25 },
    });
    assert.equal(choices.status, true);
    assert(choices.data.length > 0);
    const chosen = choices.data[0];
    const exact = await mock.mockFetch('/api/dnsman/credential/group-choice', {
        headers: manager, params: { id: String(chosen.id) },
    });
    assert.deepEqual(exact.data, [chosen]);
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

    const credentialSource = stripComments(await read('packages/portal-mojo/src/admin/dns/ProviderCredentialsPage.tsx'));
    const apiSource = stripComments(await read('packages/portal-mojo/src/admin/dns/api.ts'));
    const mockSource = stripComments(await read('packages/portal-mojo/src/client/mock.ts'));
    assert.match(credentialSource, /CollectionSelect/);
    assert.match(credentialSource, /DNS_GROUP_CHOICE_ENDPOINT/);
    assert(!credentialSource.includes('/api/group'));
    assert(!credentialSource.includes('RightPanel'));
    assert(!credentialSource.includes('download'));
    assert(!apiSource.includes('/certificate/material'));
    assert(!mockSource.includes("path === '/api/dnsman/certificate/material'"));
    assert.match(await read('apps/showcase/src/pages/components/ComponentsPage.tsx'), /admin-dns/);
    assert.match(await read('packages/portal-mojo/docs/admin-dns.md'), /Both themes|Themes and showcase/i);

    console.log('verify-admin-dns: all assertions passed');
} finally {
    await server.close();
}
