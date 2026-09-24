import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const path = '/api/account/admin/signin';

    assert.deepEqual(admin.SIGNIN_ADMIN_PERMISSIONS, ['sys.manage_settings', 'sys.admin']);
    assert.equal(admin.SIGNIN_ADMIN_SECTION.basePath, 'system/sign-in');
    assert.equal(admin.SIGNIN_ADMIN_SECTION.navigationGroup, 'identity-access');
    assert(admin.ADMIN_SECTIONS.includes(admin.SIGNIN_ADMIN_SECTION));
    assert(admin.adminSectionRoutes([admin.SIGNIN_ADMIN_SECTION]).some((route) => route.path === 'system/sign-in'));

    const login = async (email) => {
        const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } });
        return { Authorization: `Bearer ${response.data.access_token}` };
    };
    assert.equal((await mock.mockFetch(path, {})).error_code, 401, 'anonymous callers are rejected');
    const viewer = await login('phone.viewer@nativemojo.com');
    assert.equal((await mock.mockFetch(path, { headers: viewer })).error_code, 403, 'callers without manage_settings/admin are rejected');
    const su = await login('dns.platform@nativemojo.com');

    const initial = (await mock.mockFetch(path, { headers: su })).data;
    assert.equal(initial.schema_version, 1);
    assert(initial.editable.includes('theme.app_title') && initial.editable.includes('login.methods'));
    assert.deepEqual(initial.options.layouts, ['minimal', 'compact', 'branded-panel', 'editorial']);
    assert(initial.options.layouts.includes(initial.auth.theme.layout), 'legacy layout tokens are normalized');
    const byName = Object.fromEntries(initial.providers.map((provider) => [provider.name, provider]));
    assert.deepEqual(Object.keys(byName), ['google', 'apple', 'github']);
    assert.equal(byName.apple.ready, false);
    assert.deepEqual(byName.apple.missing, ['Key ID', 'Private key (.p8)']);
    assert.equal(byName.apple.fields.find((field) => field.key === 'APPLE_CLIENT_ID').label, 'Services ID');
    assert.equal(byName.google.fields.every((field) => field.source === 'none'), true);
    assert.equal(byName.github.ready, true);
    assert(byName.github.fields.every((field) => field.source === 'deployment'));
    for (const provider of initial.providers) for (const field of provider.fields) if (field.secret) assert.equal(field.value, null, `${field.key} value never leaves the server`);
    assert.match(byName.apple.callback_url, /\/api\/auth\/oauth\/apple\/callback$/);

    const saved = (await mock.mockFetch(path, { method: 'POST', headers: su, body: { auth: { 'theme.app_title': 'Acme', 'theme.layout': 'editorial' } } })).data;
    assert.equal(saved.auth.theme.app_title, 'Acme');
    assert.equal(saved.auth.theme.layout, 'editorial');
    const publicConfig = (await mock.mockFetch('/api/auth/config', { params: {} })).data;
    assert.equal(publicConfig.theme.app_title, 'Acme', '/api/auth/config reflects system saves');

    const noPassword = await mock.mockFetch(path, { method: 'POST', headers: su, body: { auth: { 'login.methods': ['google'] } } });
    assert.equal(noPassword.status, false);
    assert.equal(noPassword.error_code, 400);
    assert.equal((await mock.mockFetch(path, { method: 'POST', headers: su, body: { auth: { 'theme.api_base': 'x' } } })).error_code, 400, 'non-editable paths are rejected');
    assert.equal((await mock.mockFetch(path, { method: 'POST', headers: su, body: { auth: { 'theme.layout': 'card' } } })).error_code, 400);

    const key = '-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49\n-----END PRIVATE KEY-----';
    const apple = (await mock.mockFetch(path, { method: 'POST', headers: su, body: { provider: 'apple', values: { APPLE_KEY_ID: 'KEY123', APPLE_PRIVATE_KEY: key, APPLE_TEAM_ID: '' } } })).data.providers.find((provider) => provider.name === 'apple');
    assert.equal(apple.ready, true);
    assert.equal(apple.fields.find((field) => field.key === 'APPLE_TEAM_ID').value, 'ABCDE12345', 'blank keeps the stored value');
    assert.equal(apple.fields.find((field) => field.key === 'APPLE_PRIVATE_KEY').value, null);
    const cleared = (await mock.mockFetch(path, { method: 'POST', headers: su, body: { provider: 'apple', values: { APPLE_PRIVATE_KEY: null } } })).data.providers.find((provider) => provider.name === 'apple');
    assert.deepEqual(cleared.missing, ['Private key (.p8)']);

    const off = (await mock.mockFetch(path, { method: 'POST', headers: su, body: { provider: 'apple', enabled: false } })).data;
    assert.equal(off.providers.find((provider) => provider.name === 'apple').enabled, false);
    assert(!off.auth.login.methods.includes('apple') && !off.auth.registration.methods.includes('apple'));
    const on = (await mock.mockFetch(path, { method: 'POST', headers: su, body: { provider: 'apple', enabled: true } })).data;
    assert(on.auth.login.methods.includes('apple') && on.auth.registration.methods.includes('apple'));
    assert.equal((await mock.mockFetch(path, { method: 'POST', headers: su, body: { provider: 'nope' } })).error_code, 400);
    console.log('admin sign-in contract verified');
} finally {
    await server.close();
}
