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

try {
    const me = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');
    const models = await server.ssrLoadModule('/apps/portal/src/models.ts');
    const authConfig = await server.ssrLoadModule('/apps/portal/src/pages/group-sections/auth-config.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');

    assert(models.GROUP_VIEW_PERMS.every((permission) => permission.startsWith('sys.')));
    assert(models.GROUP_MANAGE_PERMS.every((permission) => permission.startsWith('sys.')));
    assert.equal(me.hasPermission({ id: 1, permissions: {} }, models.GROUP_VIEW_PERMS, {
        permissions: { groups: true, manage_groups: true },
    }), false, 'member-only grants cannot satisfy global Group Admin');

    const routeSource = await readFile(new URL('../apps/portal/src/pages/admin-routes.tsx', import.meta.url), 'utf8');
    const menuSource = await readFile(new URL('../apps/portal/src/menus.ts', import.meta.url), 'utf8');
    const identitySource = await readFile(new URL('../apps/portal/src/pages/group-sections/IdentitySection.tsx', import.meta.url), 'utf8');
    assert.match(routeSource, /Guarded permission=\{GROUP_VIEW_PERMS\}/);
    assert.match(menuSource, /admin:groups[^\n]+permissions: GROUP_VIEW_PERMS/);
    assert.doesNotMatch(identitySource, /CollectionSelect/);
    assert.match(identitySource, /changes: \{ parent: null \}/);

    assert(authConfig.LOGIN_METHOD_OPTS.some((method) => method.value === 'github'));
    assert(authConfig.REGISTRATION_METHOD_OPTS.some((method) => method.value === 'github'));
    const deployment = {
        theme: { app_title: 'Deployment', hero_headline: 'Base' },
        login: { methods: ['password', 'github'] },
        registration: { enabled: true },
    };
    const resolved = authConfig.resolveAuthConfigChain(deployment, [
        { metadata: { auth_config: { theme: { app_title: 'Root' } } } },
        { metadata: { auth_config: { theme: { hero_headline: 'Child' } } } },
    ]);
    assert.equal(resolved.theme.app_title, 'Root');
    assert.equal(resolved.theme.hero_headline, 'Child');
    assert.deepEqual(resolved.login.methods, ['password', 'github']);
    const baseline = authConfig.buildAuthBaseline({}, resolved);
    const changed = { ...baseline, login_methods: ['github'] };
    assert.deepEqual(authConfig.buildAuthConfigDiff(changed, baseline), { login: { methods: ['github'] } });

    const login = async (email) => {
        const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } });
        return { Authorization: `Bearer ${response.data.access_token}` };
    };
    const manager = await login('groups.manager@nativemojo.com');
    const viewer = await login('groups.viewer@nativemojo.com');
    const member = await login('ian@mojoverify.com');

    const viewerRows = await mock.mockFetch('/api/group', { headers: viewer, params: { size: 100 } });
    assert(viewerRows.count > 0, 'global groups viewer can inspect rows');
    const memberRows = await mock.mockFetch('/api/group', { headers: member, params: { size: 100 } });
    assert(memberRows.count > 0 && memberRows.count < viewerRows.count,
        'product group reads remain membership-filtered on shared /api/group');

    const target = viewerRows.data.find((group) => group.is_active && group.parent);
    assert(target);
    const invalidDisable = await mock.mockFetch(`/api/group/${target.id}`, {
        method: 'POST', headers: manager, body: { disable: { reason: 'not-a-reason' } },
    });
    assert.equal(invalidDisable.error_code, 400);
    const disabled = await mock.mockFetch(`/api/group/${target.id}`, {
        method: 'POST', headers: manager, body: { disable: { reason: 'archived' } },
    });
    assert.equal(disabled.data.is_active, false);
    const reactivated = await mock.mockFetch(`/api/group/${target.id}`, {
        method: 'POST', headers: manager, body: { reactivate: {} },
    });
    assert.equal(reactivated.data.is_active, true);
    const parentSave = await mock.mockFetch(`/api/group/${target.id}`, {
        method: 'POST', headers: manager, body: { parent: 1 },
    });
    assert.equal(typeof parentSave.data.parent, 'object');
    assert.equal(parentSave.data.parent.id, 1);
    const deniedDelete = await mock.mockFetch(`/api/group/${target.id}`, { method: 'DELETE', headers: manager });
    assert.equal(deniedDelete.error_code, 403);

    await mock.mockFetch(`/api/group/${target.id}`, {
        method: 'POST', headers: manager, body: { metadata: { auth_config: { theme: { app_title: 'Temporary' } } } },
    });
    const reset = await mock.mockFetch(`/api/group/${target.id}`, {
        method: 'POST', headers: manager, body: { metadata: { auth_config: null } },
    });
    assert.equal('auth_config' in reset.data.metadata, false, 'null reset deletes only the auth override');

    const inactive = viewerRows.data.find((group) => !group.is_active);
    assert(inactive);
    if (!inactive.uuid) {
        const withUuid = await mock.mockFetch(`/api/group/${inactive.id}`, {
            method: 'POST', headers: manager, body: { uuid: '00000000000000000000000000000010' },
        });
        inactive.uuid = withUuid.data.uuid;
    }
    const publicDeployment = await mock.mockFetch('/api/auth/config', { params: {} });
    const inactivePublic = await mock.mockFetch('/api/auth/config', { params: { group_uuid: inactive.uuid } });
    assert.deepEqual(inactivePublic.data, publicDeployment.data,
        'public inactive-group lookup deliberately falls back to deployment defaults');

    console.log('admin groups contract verified');
} finally {
    await server.close();
}
