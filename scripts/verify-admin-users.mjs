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
    const account = await server.ssrLoadModule('/packages/portal-mojo/src/account/models.ts');
    for (const name of ['ApiKeyModel', 'PasskeyModel', 'OAuthConnectionModel', 'useGenerateUserApiKey']) assert.equal(users[name], account[name], `admin users re-exports the shared ${name}`);

    const standalone = admin.adminSectionRoutes([admin.USERS_ADMIN_SECTION]);
    const embedded = admin.adminSectionRoutes([admin.USERS_ADMIN_SECTION], { mount: '/system' });
    assert(standalone.some((route) => route.path === 'users'));
    assert(embedded.some((route) => route.path === 'system/users'));

    const mainSource = await readFile(new URL('../apps/portal/src/main.tsx', import.meta.url), 'utf8');
    const menuSource = await readFile(new URL('../apps/portal/src/menus.ts', import.meta.url), 'utf8');
    const querySource = await readFile(new URL('../packages/portal-mojo/src/admin/identity/users/sections/queries.ts', import.meta.url), 'utf8');
    // The key-generation boundary moved to portal-mojo/account (admin re-exports it).
    // The credential models (ApiKeyModel + useGenerateUserApiKey) live beside the account models since the eager-chunk split.
    const modelSource = await readFile(new URL('../packages/portal-mojo/src/account/models.ts', import.meta.url), 'utf8')
        + await readFile(new URL('../packages/portal-mojo/src/account/credential-models.ts', import.meta.url), 'utf8');
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

    const temporaryPath = '/api/account/admin/user/password/temporary';
    const temporaryTarget = directory.data.find((row) => row.is_active && !row.is_superuser && row.id !== 13);
    assert(temporaryTarget, 'a non-superuser target is available');
    const issueTemporary = (headers, user = temporaryTarget.id, method = 'POST') => mock.mockFetch(temporaryPath, { method, headers, body: { user } });
    assert.equal((await issueTemporary(undefined)).error_code, 401, 'anonymous callers cannot issue temporary passwords');
    assert.equal((await issueTemporary(ordinary)).error_code, 403, 'ordinary callers cannot issue temporary passwords');
    assert.equal((await issueTemporary(manager, temporaryTarget.id, 'GET')).error_code, 405, 'issuance requires POST');
    assert.equal((await issueTemporary(manager, 'invalid')).error_code, 400, 'invalid targets are refused');
    assert.equal((await issueTemporary(manager, 999999)).error_code, 400, 'missing targets are refused');
    const privilegedTarget = directory.data.find((row) => row.is_superuser);
    assert(privilegedTarget, 'a superuser target is available');
    assert.equal((await issueTemporary(manager, privilegedTarget.id)).error_code, 403, 'subordinate admins cannot recover superusers');
    const withClaims = (extra) => {
        const token = manager.Authorization.slice(7).split('.');
        token[1] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(token[1], 'base64url').toString()), ...extra })).toString('base64url');
        return { Authorization: `Bearer ${token.join('.')}` };
    };
    assert.equal((await issueTemporary(withClaims({ auth_time: 1 }))).error_code, 440, 'stale sessions require fresh authentication');
    for (const credential_kind of ['api_key', 'group_scoped_token']) {
        assert.equal((await issueTemporary(withClaims({ credential_kind }))).error_code, 403, 'key-backed sessions cannot recover a user');
    }
    const oldSession = await login(temporaryTarget.email);
    const issued = await issueTemporary(manager);
    assert.equal(issued.status, true, 'an authorized fresh session can issue a temporary password');
    assert.equal(issued.data.user, temporaryTarget.id);
    assert.equal(issued.data.requires_password_change, true);
    assert.equal(typeof issued.data.temporary_password, 'string');
    assert(issued.data.temporary_password.length >= 18, 'a generated password is revealed once');
    assert.equal((await mock.mockFetch('/api/user/me', { headers: oldSession })).error_code, 401, 'issuance revokes the target session');
    const afterTemporary = await mock.mockFetch(`/api/user/${temporaryTarget.id}`, { headers: manager });
    assert.equal(afterTemporary.data.requires_password_change, true);
    assert(!JSON.stringify(afterTemporary).includes(issued.data.temporary_password), 'later user reads never expose the generated password');

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
    // A duplicate disable is the contract's flat INSIDE-THE-200 refusal:
    // `success:false` + code, with NO envelope-level `status:false` — unwrap
    // passes it through and client/action-result rejects it.
    const duplicateDisable = await mock.mockFetch(`/api/user/${target.id}`, {
        method: 'POST', headers: manager, body: { disable: { reason: 'admin' } },
    });
    assert.equal(duplicateDisable.success, false);
    assert.equal(duplicateDisable.code, 'ALREADY_DISABLED');
    assert.notEqual(duplicateDisable.status, false, 'the refusal must ride inside the 200, not the envelope');
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

    // Owner scoping matches the server: a users-grant caller is served every
    // user's keys unless ?user= narrows them; anyone else only their own, and
    // asking for another user's is an empty 200.
    const managerMe = (await mock.mockFetch('/api/user/me', { headers: manager })).data;
    const ordinaryMe = (await mock.mockFetch('/api/user/me', { headers: ordinary })).data;
    assert.notEqual(managerMe.id, ordinaryMe.id);
    const keyIds = (response) => response.data.map((row) => row.id);
    assert(listed.data.length > 0 && keyIds(listed).includes(minted.data.id), 'an ordinary caller lists their own keys');
    const managerAll = await mock.mockFetch('/api/account/api_keys', { headers: manager, params: { size: 100 } });
    assert(keyIds(managerAll).includes(minted.data.id), 'a users-grant caller with no ?user= is served other users\' keys');
    assert(managerAll.data.length > listed.data.length, 'the unfiltered manager list spans more than one owner');
    const managerOwn = await mock.mockFetch('/api/account/api_keys', { headers: manager, params: { size: 100, user: managerMe.id } });
    assert(!keyIds(managerOwn).includes(minted.data.id), '?user=<self> narrows a users-grant caller to their own keys');
    const managerTarget = await mock.mockFetch('/api/account/api_keys', { headers: manager, params: { size: 100, user: ordinaryMe.id } });
    assert.deepEqual(keyIds(managerTarget).sort(), keyIds(listed).sort(), '?user=<other> serves that user\'s keys to a users-grant caller');
    const ordinaryOther = await mock.mockFetch('/api/account/api_keys', { headers: ordinary, params: { size: 100, user: managerMe.id } });
    assert.equal(ordinaryOther.status, true);
    assert.deepEqual(ordinaryOther.data, [], 'an ordinary caller asking for another user gets an empty list');

    console.log('admin users contract verified');
} finally {
    await server.close();
}
