// verify:permissions — executable contract for the `sys.` user-only check
// (board #5919): `sys.X` is the user-only form of `X`, at every gate that
// calls hasPermission. Pins only the rows of the semantics table in
// packages/portal-mojo/docs/menus-and-access.md where the client and the
// django-mojo server agree.
//
// Deliberately NOT asserted in either direction (known client/server
// divergences, owned by the permission-parity bug — changing them must not
// fight a release gate):
//   - the user `admin` wildcard (no fixture user holds `admin`);
//   - the member `admin` wildcard on an unprefixed key;
//   - member category rollup on an unprefixed key.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { setTimeout, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

try {
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');
    const reg = await server.ssrLoadModule('/packages/portal-mojo/src/ui/menu-registry.ts');
    const { hasPermission, memberHasPermission, registerPermissionCategories } = client;

    const X = 'view_jobs';
    const user = (permissions = {}, extra = {}) => ({ id: 1, is_superuser: false, permissions, ...extra });
    const memberAdmin = { permissions: { admin: true } };
    const memberDirect = { permissions: { [X]: true } };
    const members = { none: null, memberAdmin, memberDirect };

    // ── pinned rows: `sys.X` with any member ──
    for (const [name, member] of Object.entries(members)) {
        assert.equal(hasPermission(null, `sys.${X}`, member), false, `me null → sys.X false (${name})`);
        assert.equal(hasPermission(user({}, { is_superuser: true }), `sys.${X}`, member), true, `is_superuser → sys.X true (${name})`);
        assert.equal(hasPermission(user({ [X]: true }), `sys.${X}`, member), true, `user X → sys.X true (${name})`);
        assert.equal(hasPermission(user({ [X]: 1 }), `sys.${X}`, member), true, `user X=1 → sys.X true (${name})`);
        assert.equal(hasPermission(user({ jobs: true }), `sys.${X}`, member), true, `user category → sys.X true (${name})`);
        assert.equal(hasPermission(user(), `sys.${X}`, member), false, `user lacks X → sys.X false (${name})`);
    }

    // ── pinned rows: unprefixed `X` where client and server agree ──
    assert.equal(hasPermission(null, X, memberDirect), false, 'me null → X false');
    assert.equal(hasPermission(user({}, { is_superuser: true }), X, null), true, 'is_superuser → X true');
    assert.equal(hasPermission(user({ [X]: true }), X, null), true, 'user X → X true');
    assert.equal(hasPermission(user({ jobs: true }), X, null), true, 'user category → X true');
    assert.equal(hasPermission(user(), X, memberDirect), true, 'only the member holds X → X true');

    // ── the user-only row: a member never satisfies sys.X ──
    assert.equal(hasPermission(user(), `sys.${X}`, memberDirect), false, 'only the member holds X → sys.X false');
    assert.equal(hasPermission(user(), `sys.${X}`, memberAdmin), false, 'only the member holds admin → sys.X false');
    assert.equal(memberHasPermission(memberAdmin, `sys.${X}`), false, 'member admin never satisfies sys.*');
    assert.equal(memberHasPermission({ permissions: { [`sys.${X}`]: true } }, `sys.${X}`), false, 'a literal member sys.X key is refused');
    assert.equal(hasPermission(user(), `sys.${X}`, { permissions: { [`sys.${X}`]: true } }), false, 'a literal member sys.X key never reaches the user check');

    // ── equivalence: sys.k with any member === k with no member (pinned fixtures) ──
    const pinnedUsers = [null, user(), user({}, { is_superuser: true }), user({ [X]: true }), user({ jobs: true }), user({ other: true })];
    for (const me of pinnedUsers) {
        for (const [name, member] of Object.entries(members)) {
            for (const k of [X, 'manage_jobs', 'view_users']) {
                assert.equal(hasPermission(me, `sys.${k}`, member), hasPermission(me, k, null), `sys.${k} ≡ ${k} without member (${JSON.stringify(me?.permissions ?? null)}, ${name})`);
            }
        }
    }

    // ── arrays: any-of per element, modes mix ──
    assert.equal(hasPermission(user(), [`sys.${X}`, 'manage_group'], { permissions: { manage_group: true } }), true, 'mixed array: member satisfies the unprefixed element');
    assert.equal(hasPermission(user(), [`sys.${X}`, `sys.manage_jobs`], memberDirect), false, 'all-sys array: member satisfies nothing');
    assert.equal(hasPermission(user({ manage_jobs: true }), [`sys.${X}`, 'sys.manage_jobs'], null), true, 'all-sys array: user holds one element');

    // ── the prefix reaches menu gates ──
    const item = { label: 'Jobs', route: '/jobs', permissions: `sys.${X}` };
    assert.equal(reg.itemVisible(item, { me: user(), member: memberAdmin, group: null }), false, 'menu sys.X hidden for a member admin');
    assert.equal(reg.itemVisible(item, { me: user(), member: memberDirect, group: null }), false, 'menu sys.X hidden for a member holding X');
    assert.equal(reg.itemVisible(item, { me: user({ [X]: true }), member: memberAdmin, group: null }), true, 'menu sys.X shown when the user holds X');
    const clauses = { label: 'Jobs', route: '/jobs', permissionClauses: [`sys.${X}`] };
    assert.equal(reg.itemVisible(clauses, { me: user(), member: memberAdmin, group: null }), false, 'menu clause sys.X hidden for a member admin');

    // ── registered categories roll up under sys. for the user only ──
    registerPermissionCategories({ verify_perm_cat: ['verify_perm_granular'] });
    assert.equal(hasPermission(user({ verify_perm_cat: true }), 'sys.verify_perm_granular', null), true, 'user registered category → sys.<granular> true');
    assert.equal(hasPermission(user(), 'sys.verify_perm_granular', { permissions: { verify_perm_cat: true } }), false, 'member registered category → sys.<granular> false');
    // The member's unprefixed result for a category is a divergent row: not asserted.

    console.log('verify:permissions OK — sys.X is the user-only form of X; divergent rows left unpinned');
} finally {
    await server.close();
}
