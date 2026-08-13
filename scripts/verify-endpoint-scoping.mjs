// verify-endpoint-scoping — the #1936 scoped middle tier contract.
//
// Raw useQuery + mojoCall forgetting the scope param was the first consumer
// audit's largest bug class; this script pins the three defenses: the
// endpoint-scope registry, the injection helpers (mojoScopedCall / mojoRpc /
// mojoAction), and the assertScoped dev tripwire inside the unwrap boundary.
//
// Method notes:
//   - `import.meta.env.DEV` is TRUE for modules loaded through the Vite dev
//     server's ssrLoadModule (as here). We do not read the flag directly —
//     assertScoped and mojoScopedCall only throw when DEV is true, so every
//     throwing assertion below is itself the proof.
//   - The mock request history records method/path (plus a params safelist,
//     never bodies), so params/body PLACEMENT of an injection cannot be
//     observed at the transport. Placement is pinned by source-text asserts
//     on scoped.ts / action-result.ts; PRESENCE of the injected key is
//     proven behaviorally by registering the family as REQUIRED and letting
//     the assertScoped tripwire be the observer — a call only survives
//     unwrap if the injected key actually rides the request.
//   - Deviation from the workspec's "register real endpoints with
//     required:false" suggestion: real endpoints ('/api/user', '/api/group')
//     are registered required:TRUE here, because required:false silences the
//     tripwire and a passing call would prove nothing. Setup calls (login,
//     directory read) ride mock.mockFetch directly — they never cross
//     assertScoped, so no auth flow breaks.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
const backing = new Map();
globalThis.localStorage = {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => { backing.set(key, String(value)); },
    removeItem: (key) => { backing.delete(key); },
};

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
    root,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
});

try {
    const scope = await server.ssrLoadModule('/packages/portal-mojo/src/client/endpoint-scope.ts');
    const scoped = await server.ssrLoadModule('/packages/portal-mojo/src/client/scoped.ts');
    const active = await server.ssrLoadModule('/packages/portal-mojo/src/client/active-group.ts');
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
    const actionResult = await server.ssrLoadModule('/packages/portal-mojo/src/client/action-result.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const {
        registerEndpointScope, endpointScopeFor, endpointScopeValue,
        resetEndpointScopes, assertScoped,
    } = scope;
    const { setActiveGroupSignal } = active;

    // ── 1. Registry semantics ─────────────────────────────────────────
    resetEndpointScopes();
    registerEndpointScope('/api/wallet/');
    let reg = endpointScopeFor('/api/wallet/deposit');
    assert(reg, 'a registered prefix must govern its paths');
    assert.equal(reg.key, 'group', "key must default to 'group'");
    assert.equal(reg.required, true, 'required must default to true');

    registerEndpointScope('/api/wallet/tx', { key: 'gid', required: false });
    assert.equal(endpointScopeFor('/api/wallet/tx/9').key, 'gid', 'longest prefix must win');
    assert.equal(endpointScopeFor('/api/wallet/deposit').key, 'group', 'shorter prefixes keep governing the rest of the family');

    registerEndpointScope('/api/wallet/tx', { key: 'player__group' });
    reg = endpointScopeFor('/api/wallet/tx/9');
    assert.equal(reg.key, 'player__group', 're-registration must replace, not shadow');
    assert.equal(reg.required, true, 're-registration must replace the whole entry (required back to default)');

    registerEndpointScope(['/api/a/', '/api/b/'], { key: 'gid' });
    assert.equal(endpointScopeFor('/api/a/x')?.key, 'gid', 'array form must register every prefix');
    assert.equal(endpointScopeFor('/api/b/x')?.key, 'gid', 'array form must register every prefix');

    assert.equal(endpointScopeFor('/api/unregistered'), null, 'unregistered paths carry no scope');

    registerEndpointScope('/api/billing/', { key: 'account', format: (g) => `group-${g}` });
    assert.equal(endpointScopeValue(endpointScopeFor('/api/billing/plan'), 7), 'group-7',
        'format must produce the wire spelling (account=group-<pk>)');
    assert.equal(endpointScopeValue(endpointScopeFor('/api/wallet/deposit'), 7), 7,
        'without format the wire value is the raw group id');

    // ── 2. assertScoped (the dev tripwire, pure) ──────────────────────
    resetEndpointScopes();
    registerEndpointScope('/api/fake-scoped');
    assert.throws(() => assertScoped('/api/fake-scoped/thing', {}), /scope-registered/,
        'a required scope absent from params AND body must throw (this also proves import.meta.env.DEV is true here)');
    assert.doesNotThrow(() => assertScoped('/api/fake-scoped/thing', { params: { group: 4 } }),
        'scope in params must satisfy the tripwire');
    assert.doesNotThrow(() => assertScoped('/api/fake-scoped/thing', { method: 'POST', body: { group: 4 } }),
        'scope in body must satisfy the tripwire');
    assert.doesNotThrow(() => assertScoped('/api/fake-scoped/thing', { unscoped: true }),
        'unscoped: true is the explicit escape hatch');
    assert.doesNotThrow(() => assertScoped('/api/not-registered', {}),
        'unregistered paths must pass untouched');
    registerEndpointScope('/api/fake-optional', { required: false });
    assert.doesNotThrow(() => assertScoped('/api/fake-optional/thing', {}),
        'required:false families never trip');

    // ── 3. Transport integration: the tripwire fires BEFORE any fetch ─
    resetEndpointScopes();
    registerEndpointScope('/api/fake-scoped');
    mock.clearMockRequestHistory();
    await assert.rejects(() => client.mojoCall('/api/fake-scoped/thing'), /scope-registered/,
        'a raw mojoCall to a registered-required path must throw the tripwire');
    assert.equal(mock.getMockRequestHistory().some((entry) => entry.path.startsWith('/api/fake-scoped')), false,
        'the mock must never have seen the request — the throw happened before fetch');
    await assert.rejects(() => client.mojoCall('/api/fake-scoped/thing', { unscoped: true }), /No mock for/,
        'unscoped: true must clear the tripwire and reach the transport');
    assert.equal(mock.getMockRequestHistory().some((entry) => entry.path.startsWith('/api/fake-scoped')), true,
        'the unscoped call must actually reach the mock');

    // ── 4. mojoScopedCall / mojoRpc injection ─────────────────────────
    // Auth hooks installed directly with a mock-minted token (the
    // verify-action-results pattern — no JWT refresh machinery).
    const loginBody = await mock.mockFetch('/api/login', {
        method: 'POST', body: { username: 'groups.manager@nativemojo.com', password: 'mojo' },
    });
    const token = loginBody?.data?.access_token;
    assert.equal(typeof token, 'string', 'mock login must mint an access token');
    client.installAuthHooks({
        async preRequest() {},
        authHeader: () => `Bearer ${token}`,
    });

    resetEndpointScopes();
    const seenGids = [];
    registerEndpointScope('/api/group', { format: (g) => { seenGids.push(g); return g; } });

    // Signal-driven injection into params (GET shape): the call only
    // survives the REQUIRED tripwire because the injected key rides it.
    setActiveGroupSignal(4);
    const groups = await scoped.mojoScopedCall('/api/group', { params: { size: 1 } });
    assert(Array.isArray(groups.data), 'the scoped GET must resolve against the mock');
    assert.equal(seenGids.at(-1), 4, 'the injected value must come from the active-group signal');

    // Explicit `group` opt beats the signal.
    await scoped.mojoScopedCall('/api/group', { params: { size: 1 }, group: 1 });
    assert.equal(seenGids.at(-1), 1, "an explicit `group` option must beat the signal");

    // Body-shape injection: a REQUIRED fake family — surviving the tripwire
    // proves the key was injected; the rejection is the transport's 404,
    // never the tripwire's. (Params-vs-body placement is a source assert.)
    registerEndpointScope('/api/fake-scoped');
    await assert.rejects(
        () => scoped.mojoScopedCall('/api/fake-scoped/x', { method: 'POST', body: { a: 1 } }),
        /No mock for/,
        'a body-shaped scoped call must clear the tripwire (scope injected) and fail only at the unknown mock route',
    );
    // mojoRpc rides the same injection under withFreshAuth.
    await assert.rejects(() => scoped.mojoRpc('/api/fake-scoped/x', { a: 1 }), /No mock for/,
        'mojoRpc must clear the tripwire the same way');

    // REQUIRED + no group + dev → mojoScopedCall throws its own loud error
    // (synchronously — before any transport work).
    setActiveGroupSignal(null);
    assert.throws(() => scoped.mojoScopedCall('/api/group', { params: { size: 1 } }),
        /requires 'group' scope/,
        'a required scope with no active group and no explicit group must throw in dev');

    // not-required + no group → passes through unscoped.
    registerEndpointScope('/api/group', { required: false });
    const unscopedGroups = await scoped.mojoScopedCall('/api/group', { params: { size: 1 } });
    assert(Array.isArray(unscopedGroups.data), 'an optional scope with no group must pass through unscoped');

    // ── 5. mojoAction body injection ──────────────────────────────────
    // '/api/user' registered required:TRUE — the tripwire is the observer:
    // the disable action only succeeds if mojoAction put the scope key in
    // the action body (the mock records no bodies, so this is the proof).
    resetEndpointScopes();
    registerEndpointScope('/api/user', { key: 'group' });
    setActiveGroupSignal(4);

    const authed = { Authorization: `Bearer ${token}` };
    const directory = await mock.mockFetch('/api/user', { headers: authed, params: { size: 100 } });
    const target = directory.data.find((row) => row.is_active && row.id !== 13);
    assert(target, 'mock seeds must include an active target user');

    const disabled = await actionResult.mojoAction('/api/user', target.id, 'disable', { reason: 'admin' });
    assert.equal(disabled.ok, true, 'a scope-registered action with an active group must succeed (scope rode the body)');
    assert.equal(disabled.payload.is_active, false);
    const reactivated = await actionResult.mojoAction('/api/user', target.id, 'reactivate');
    assert.equal(reactivated.ok, true, 'restore the seed row');

    // No active group → mojoAction injects nothing → the tripwire throws
    // before the mock ever sees the POST.
    setActiveGroupSignal(null);
    mock.clearMockRequestHistory();
    await assert.rejects(
        () => actionResult.mojoAction('/api/user', target.id, 'disable', { reason: 'admin' }),
        /scope-registered/,
        'a required-scoped action with no group must trip before transport',
    );
    assert.equal(
        mock.getMockRequestHistory().some((entry) => entry.method === 'POST' && entry.path === `/api/user/${target.id}`),
        false,
        'the refused action must never have reached the mock',
    );

    // Inert when nothing is registered — the design guarantee that keeps
    // the base admin (and verify-action-results) untouched.
    resetEndpointScopes();
    const plainDisable = await actionResult.mojoAction('/api/user', target.id, 'disable', { reason: 'admin' });
    assert.equal(plainDisable.ok, true, 'with no registrations the injection must be inert');
    await actionResult.mojoAction('/api/user', target.id, 'reactivate');
    client.installAuthHooks(null);

    // ── 6. Source wiring ──────────────────────────────────────────────
    const clientSource = await readFile(new URL('../packages/portal-mojo/src/client/client.ts', import.meta.url), 'utf8');
    assert.match(clientSource, /assertScoped\(path, opts\)/, 'unwrap must run the tripwire on every request');

    const scopedSource = await readFile(new URL('../packages/portal-mojo/src/client/scoped.ts', import.meta.url), 'utf8');
    assert.match(scopedSource, /queryKey: \[path, params, gid \?\? null\]/,
        'useScopedQuery must key on [path, params, gid] — brand switches must never share cache entries');
    assert.match(scopedSource, /body: \{ \[reg\.key\]: value, \.\.\.rest\.body \}/,
        'mojoScopedCall must inject into the BODY when a body is present');
    assert.match(scopedSource, /params: \{ \[reg\.key\]: value, \.\.\.\(rest\.params \?\? \{\}\) \}/,
        'mojoScopedCall must inject into PARAMS for parameter-only requests');

    const actionSource = await readFile(new URL('../packages/portal-mojo/src/client/action-result.ts', import.meta.url), 'utf8');
    assert.match(actionSource, /endpointScopeFor\(path\)/, 'mojoAction must consult the scope registry');
    assert.match(actionSource, /\{ \.\.\.scope, \[action\]: payload \?\? true \}/,
        'mojoAction must merge the injected scope into the action body');

    const tableSource = await readFile(new URL('../packages/portal-mojo/src/ui/ModelTable.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(tableSource, /endpoint-scope/, 'ModelTable must not import endpoint-scope (#1937 boundary)');
    assert.doesNotMatch(tableSource, /from '\.\.\/client\/scoped'/, 'ModelTable must not import scoped helpers (#1937 boundary)');

    const indexSource = await readFile(new URL('../packages/portal-mojo/src/client/index.ts', import.meta.url), 'utf8');
    assert.match(indexSource, /endpoint-scope/, 'the client barrel must export the endpoint-scope module');
    assert.match(indexSource, /'\.\/scoped'/, 'the client barrel must export the scoped helpers');
    assert.match(indexSource, /'\.\/active-group'/, 'the client barrel must export the active-group signal');

    console.log('endpoint-scoping contract verified');
} finally {
    await server.close();
}
