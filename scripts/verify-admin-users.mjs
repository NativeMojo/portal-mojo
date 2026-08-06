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
const secretKeys = new Set(['token', 'jti', 'auth_key', 'secret', 'token_hash']);
const containsSecret = (value) => {
    if (Array.isArray(value)) return value.some(containsSecret);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) => secretKeys.has(key) || containsSecret(child));
};

try {
    const me = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');
    const users = await server.ssrLoadModule('/packages/portal-mojo/src/admin/identity/users/models.ts');
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');

    assert(users.USER_VIEW_PERMISSIONS.every((permission) => permission.startsWith('sys.')));
    assert(users.USER_MANAGE_PERMISSIONS.every((permission) => permission.startsWith('sys.')));
    assert.equal(me.hasPermission(
        { id: 1, permissions: {} },
        users.USER_VIEW_PERMISSIONS,
        { permissions: { users: true, manage_users: true, 'sys.users': true } },
    ), false, 'member grants cannot satisfy global Users Admin');
    assert.equal(users.UserModel.actions.change_username.response, 'payload');

    const standalone = admin.adminSectionRoutes([admin.USERS_ADMIN_SECTION]);
    const embedded = admin.adminSectionRoutes([admin.USERS_ADMIN_SECTION], { mount: '/system' });
    assert(standalone.some((route) => route.path === 'users'));
    assert(embedded.some((route) => route.path === 'system/users'));

    const mainSource = await readFile(new URL('../apps/portal/src/main.tsx', import.meta.url), 'utf8');
    const menuSource = await readFile(new URL('../apps/portal/src/menus.ts', import.meta.url), 'utf8');
    const querySource = await readFile(new URL('../packages/portal-mojo/src/admin/identity/users/sections/queries.ts', import.meta.url), 'utf8');
    const modelSource = await readFile(new URL('../packages/portal-mojo/src/admin/identity/users/models.ts', import.meta.url), 'utf8');
    const mockSource = await readFile(new URL('../packages/portal-mojo/src/client/mock.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(mainSource, /path:\s*['"]users['"]/);
    assert.doesNotMatch(menuSource, /admin:users/);
    assert.match(querySource, /enabled:\s*access\.(?:devices|members|events|logs|apiKeys)/);
    assert.doesNotMatch(mockSource, /path === ['"]\/api\/auth\/manage\/generate_api_key['"]/);
    assert.match(modelSource, /delete created\[key\]/);

    const login = async (email) => {
        const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } });
        return { Authorization: `Bearer ${response.data.access_token}` };
    };
    const manager = await login('groups.manager@nativemojo.com');
    const ordinary = await login('ian@mojoverify.com');
    const directory = await mock.mockFetch('/api/user', { headers: manager, params: { size: 100 } });
    const target = directory.data.find((row) => row.is_active && row.id !== 13);
    assert(target);

    const changedName = `${target.username}.contract`;
    const changed = await mock.mockFetch(`/api/user/${target.id}`, {
        method: 'POST', headers: manager, body: { change_username: { username: changedName } },
    });
    assert.equal(changed.data.username, changedName);
    const changedRow = await mock.mockFetch(`/api/user/${target.id}`, { headers: manager });
    assert.equal(changedRow.data.username, changedName);

    const disabled = await mock.mockFetch(`/api/user/${target.id}`, {
        method: 'POST', headers: manager, body: { disable: { reason: 'admin' } },
    });
    assert.equal(disabled.data.is_active, false);
    const duplicateDisable = await mock.mockFetch(`/api/user/${target.id}`, {
        method: 'POST', headers: manager, body: { disable: { reason: 'admin' } },
    });
    assert.equal(duplicateDisable.error_code, 400);
    const reactivated = await mock.mockFetch(`/api/user/${target.id}`, {
        method: 'POST', headers: manager, body: { reactivate: {} },
    });
    assert.equal(reactivated.data.is_active, true);
    const duplicateReactivate = await mock.mockFetch(`/api/user/${target.id}`, {
        method: 'POST', headers: manager, body: { reactivate: {} },
    });
    assert.equal(duplicateReactivate.error_code, 400);

    const callerPrefs = await mock.mockFetch('/api/account/notification/preferences', { headers: manager });
    const targetedPrefs = await mock.mockFetch('/api/account/notification/preferences', {
        headers: manager, params: { user: target.id },
    });
    assert.deepEqual(targetedPrefs, callerPrefs, 'target user is ignored for notification preferences');

    const deniedThrottle = await mock.mockFetch('/api/auth/manage/throttle', {
        headers: ordinary, params: { user_id: target.id, key: 'login' },
    });
    assert.equal(deniedThrottle.error_code, 403);
    const allowedThrottle = await mock.mockFetch('/api/auth/manage/throttle', {
        headers: manager, params: { user_id: target.id, key: 'login' },
    });
    assert.equal(allowedThrottle.status, true);

    const minted = await mock.mockFetch('/api/auth/generate_api_key', {
        method: 'POST', headers: ordinary, body: { label: 'contract', expire_days: 30 },
    });
    assert.equal(typeof minted.data.token, 'string');
    const listed = await mock.mockFetch('/api/account/api_keys', { headers: ordinary, params: { size: 100 } });
    assert.equal(containsSecret(listed), false, 'ordinary key reads contain no signing material');

    console.log('admin users contract verified');
} finally {
    await server.close();
}
