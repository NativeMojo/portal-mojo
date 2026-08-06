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
    const members = await server.ssrLoadModule('/packages/portal-mojo/src/admin/identity/members/models.ts');
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');

    assert.equal(me.memberHasPermission({ permissions: { 'sys.manage_groups': true } }, 'sys.manage_groups'), false);
    assert.equal(me.memberHasPermission({ permissions: { admin: true } }, 'manage_group'), true,
        'non-system product-portal admin compatibility remains');
    assert.equal(me.hasPermission({ id: 1, permissions: { manage_groups: true } }, 'sys.manage_groups'), true);
    assert.equal(me.hasPermission({ id: 1, is_superuser: true }, 'sys.anything'), true);

    assert(admin.MEMBERS_ADMIN_SECTION.permissions.every((permission) => permission.startsWith('sys.')));
    assert(admin.MEMBERS_ADMIN_SECTION.routes.every((route) =>
        Array.isArray(route.permissions) && route.permissions.every((permission) => permission.startsWith('sys.'))));
    assert.equal(members.MemberModel.actions.resend_invite.response, 'payload');
    assert.deepEqual(Object.keys(members.MemberModel.actions), ['resend_invite']);
    assert.equal(members.normalizeMemberListParams({ sort: 'user__email', graph: 'token', evil: 1 }).sort, undefined);
    assert.deepEqual(members.ignoredMemberGrants({ admin: true, full_member: true, 'sys.groups': true }), ['admin', 'full_member', 'sys.groups']);

    const standalone = admin.adminSectionRoutes([admin.MEMBERS_ADMIN_SECTION]);
    const embedded = admin.adminSectionRoutes([admin.MEMBERS_ADMIN_SECTION], { mount: '/system' });
    assert(standalone.some((route) => route.path === 'members'));
    assert(embedded.some((route) => route.path === 'system/members'));
    const pageSource = await readFile(new URL('../packages/portal-mojo/src/admin/identity/members/MembersPage.tsx', import.meta.url), 'utf8');
    assert(!/label:\s*['"](?:Remove|Move)/.test(pageSource), 'unsupported Remove/Move controls stay absent');

    const login = async (email) => {
        const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } });
        return { Authorization: `Bearer ${response.data.access_token}` };
    };
    const manager = await login('groups.manager@nativemojo.com');
    const owner = await login('ian@mojoverify.com');

    const inactiveGroupInvite = await mock.mockFetch('/api/group/member/invite', { method: 'POST', headers: manager, body: { group: 10, email: 'hidden@example.test' } });
    const missingGroupInvite = await mock.mockFetch('/api/group/member/invite', { method: 'POST', headers: manager, body: { group: 999999, email: 'hidden@example.test' } });
    assert.deepEqual(inactiveGroupInvite, missingGroupInvite, 'inactive and nonexistent invitation groups are indistinguishable');

    const beforeInvite = await mock.mockFetch('/api/group/member', { headers: manager, params: { group: 1, size: 1 } });
    const inviteEmail = 'member-contract-new@example.test';
    const invitedNew = await mock.mockFetch('/api/group/member/invite', { method: 'POST', headers: manager, body: { group: 1, email: inviteEmail } });
    const invitedExisting = await mock.mockFetch('/api/group/member/invite', { method: 'POST', headers: manager, body: { group: 1, email: inviteEmail } });
    assert.deepEqual(Object.keys(invitedNew).sort(), Object.keys(invitedExisting).sort());
    assert.deepEqual(Object.keys(invitedNew.data).sort(), Object.keys(invitedExisting.data).sort());
    const afterInvite = await mock.mockFetch('/api/group/member', { headers: manager, params: { group: 1, size: 1 } });
    assert.equal(afterInvite.count, beforeInvite.count + 1, 'idempotent reinvite mutates count once');

    const users = await mock.mockFetch('/api/user', { headers: manager, params: { size: 100 } });
    const current = await mock.mockFetch('/api/group/member', { headers: manager, params: { group: 2, size: 100 } });
    const memberUserIds = new Set(current.data.map((row) => row.user.id));
    const candidate = users.data.find((user) => !memberUserIds.has(user.id));
    assert(candidate);
    const beforeCreate = current.count;
    const created = await mock.mockFetch('/api/group/member', { method: 'POST', headers: manager, body: { group: 2, user: candidate.id } });
    assert.equal(Array.isArray(created.data), false, 'collection POST returns one serialized row');
    assert.equal(created.data.group.id, 2);
    const afterCreate = await mock.mockFetch('/api/group/member', { headers: manager, params: { group: 2, size: 100 } });
    assert.equal(afterCreate.count, beforeCreate + 1);
    const duplicate = await mock.mockFetch('/api/group/member', { method: 'POST', headers: manager, body: { group: 2, user: candidate.id } });
    assert.equal(duplicate.error_code, 400);

    const deniedGlobalMembers = await mock.mockFetch('/api/group/member', { headers: owner, params: { size: 5 } });
    assert.equal(deniedGlobalMembers.error_code, 403);
    const scopedMembers = await mock.mockFetch('/api/group/member', { headers: owner, params: { group: 1, size: 5 } });
    assert.equal(scopedMembers.status, true);
    const hiddenDirectorySearch = await mock.mockFetch('/api/user', { headers: owner, params: { search: 'groups.manager', size: 10 } });
    assert.equal(hiddenDirectorySearch.count, 0, 'ordinary owners cannot search arbitrary users');

    console.log('admin members contract verified');
} finally {
    await server.close();
}
