// verify-group-scope — the group a request carries on the first render
// after a group switch (#5918).
//
// Two faults this pins, both mounted (real React, real TanStack Query, the
// real GroupProvider):
//   - The provider mirrored its group into the active-group signal from a
//     PASSIVE effect. A child's query fetch also starts from a passive
//     effect, and React runs child effects before the parent's, so a
//     hand-rolled `useQuery({ queryFn: () => mojoScopedCall(...) })` sent
//     the PREVIOUS group on the switch commit.
//   - useScopedQuery borrowed the signal whenever the context's group was
//     null, so after a clear it kept the old group's key and data, and
//     while an unseeded switch was loading it fired stale or unscoped.
//
// Method notes:
//   - `./client` is rewritten in scoped.ts to a recorder that keeps
//     {path, params, body} and answers group-tagged rows, and in group.tsx
//     to a fixture whose group fetch the script controls. Everything else
//     is the shipped source, loaded through Vite's ssrLoadModule.
//   - Wire assertions alone would pass on the old code for the clear case:
//     that one is a cache hit under the old key, with no request at all. So
//     the clear case reads the OBSERVED query's key and its rendered data.
//   - Every case runs and reports; the script exits 1 if any failed.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Event', 'Node', 'localStorage', 'sessionStorage']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const fixture = globalThis.__groupScope = {
    calls: [],
    // The provider's group fetch; a case replaces it to hold the load open.
    getGroup: async (_endpoint, id) => ({ id, name: `group ${id}`, kind: 'organization' }),
};
const REAL_CLIENT = '/packages/portal-mojo/src/client/client.ts';
const recorder = `export * from '${REAL_CLIENT}';
export const mojoCall = async (path, opts = {}) => {
    globalThis.__groupScope.calls.push({ path, params: opts.params ?? null, body: opts.body ?? null });
    return { status: true, data: [{ g: opts.params?.group ?? opts.body?.group ?? null }] };
};`;
const groupClient = `export * from '${REAL_CLIENT}';
export const mojoGet = (endpoint, id) => globalThis.__groupScope.getGroup(endpoint, id);
export const mojoCall = async () => ({ status: true, data: { id: 1, permissions: {} } });`;
const VIRTUAL = { '/__group_scope_recorder.ts': recorder, '/__group_scope_group_client.ts': groupClient };
const REWRITES = { '/client/scoped.ts': '/__group_scope_recorder.ts', '/client/group.tsx': '/__group_scope_group_client.ts' };
const rewritten = new Set();

const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{
    name: 'group-scope-fixture', enforce: 'pre',
    resolveId: id => id in VIRTUAL ? id : null,
    load: id => VIRTUAL[id] ?? null,
    transform(source, id) {
        const file = id.split('?')[0];
        for (const [suffix, target] of Object.entries(REWRITES)) {
            if (!file.endsWith(suffix)) continue;
            assert.ok(source.includes("from './client'"), `${suffix} must import from './client' for the fixture to take its place`);
            rewritten.add(suffix);
            return source.replace("from './client'", `from '${target}'`);
        }
    },
}] });

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider, useQuery } = await import('@tanstack/react-query');
const h = React.createElement;

const failures = [];
let passed = 0;

try {
    const { GroupProvider, useActiveGroup } = await server.ssrLoadModule('/packages/portal-mojo/src/client/group.tsx');
    const { useScopedQuery, mojoScopedCall } = await server.ssrLoadModule('/packages/portal-mojo/src/client/scoped.ts');
    const { registerEndpointScope, resetEndpointScopes } = await server.ssrLoadModule('/packages/portal-mojo/src/client/endpoint-scope.ts');
    const { getActiveGroupId, setActiveGroupSignal } = await server.ssrLoadModule('/packages/portal-mojo/src/client/active-group.ts');
    const { setTokens, clearTokens } = await server.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
    assert.deepEqual([...rewritten].sort(), Object.keys(REWRITES).sort(), 'both fixtures must have replaced ./client');

    // A signed-in session: the provider only loads a group, and only reports
    // `loading`, for an authenticated user. Decode-only on the client, so an
    // unsigned token with a future expiry is enough.
    const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${b64({ alg: 'none' })}.${b64({ uid: 1, email: 'probe@example.com', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;

    const flush = (ms = 20) => React.act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
    const group = id => ({ id, name: `group ${id}`, kind: 'organization' });
    const callsTo = path => fixture.calls.filter(call => call.path === path);
    const groupOf = call => call.params?.group ?? call.body?.group ?? null;

    let ctx = null;
    function Capture() {
        ctx = useActiveGroup();
        return null;
    }

    // A hand-rolled query: the group reaches the request through the SIGNAL.
    function PlainProbe() {
        const active = useActiveGroup();
        useQuery({
            queryKey: ['probe', active.group?.id ?? null],
            queryFn: async () => (await mojoScopedCall('/api/probe/x')).data,
            enabled: !!active.group,
        });
        return null;
    }

    const rendered = {};
    function ScopedProbe({ path, name, opts }) {
        const query = useScopedQuery(path, {}, opts);
        rendered[name] = query.data;
        return null;
    }

    async function run(name, { url = '/', provider = true, getGroup, signal = null, children }, body) {
        fixture.calls.length = 0;
        fixture.getGroup = getGroup ?? (async (_endpoint, id) => group(id));
        for (const key of Object.keys(rendered)) delete rendered[key];
        ctx = null;
        localStorage.clear();
        sessionStorage.clear();
        window.history.replaceState(null, '', url);
        setTokens(token);
        resetEndpointScopes();
        registerEndpointScope('/api/probe/');
        registerEndpointScope('/api/probe-opt/', { required: false });
        setActiveGroupSignal(signal);
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const root = createRoot(document.getElementById('root'));
        const tree = provider ? h(GroupProvider, null, h(Capture), ...children) : h(React.Fragment, null, ...children);
        try {
            await React.act(async () => root.render(h(QueryClientProvider, { client: qc }, tree)));
            await flush();
            await body({ qc });
            passed += 1;
            console.log(`ok    ${name}`);
        } catch (error) {
            failures.push(name);
            console.error(`FAIL  ${name}\n      ${String(error?.message ?? error).split('\n').join('\n      ')}`);
        } finally {
            await React.act(async () => root.unmount());
            qc.clear();
            clearTokens({ silent: true });
            setActiveGroupSignal(null);
        }
    }

    const observedKey = (qc, path) => {
        const observed = qc.getQueryCache().findAll({ queryKey: [path] }).filter(query => query.getObserversCount() > 0);
        assert.equal(observed.length, 1, `exactly one mounted query for ${path}, found ${observed.length}`);
        return observed[0].queryKey;
    };

    // ── A. Signal lag: a plain scoped call on the switch commit ───────
    await run('A  the first plain scoped call after a switch carries the new group', { children: [h(PlainProbe, { key: 'p' })] }, async () => {
        await React.act(async () => ctx.setActiveGroup(group(4)));
        await flush();
        const first = callsTo('/api/probe/x').map(groupOf);
        const before = fixture.calls.length;
        await React.act(async () => ctx.setActiveGroup(group(7)));
        await flush();
        const after = fixture.calls.slice(before).filter(call => call.path === '/api/probe/x').map(groupOf);
        assert.deepEqual(after, [7], `after switching 4 -> 7 the child's fetch must send group 7, sent ${JSON.stringify(after)}`);
        // The same lag on the very first activation: the signal was still
        // empty when the child fetched, so a required family threw instead.
        assert.deepEqual(first, [4], `the first activation must fetch under group 4, sent ${JSON.stringify(first)}`);
        assert.equal(getActiveGroupId(), 7, 'the signal must hold the committed group');
    });

    // ── B. Clear: useScopedQuery must let go of the previous group ────
    await run('B  after clearActiveGroup, useScopedQuery leaves the previous group', { children: [h(ScopedProbe, { key: 's', path: '/api/probe-opt/x', name: 'opt' })] }, async ({ qc }) => {
        await React.act(async () => ctx.setActiveGroup(group(4)));
        await flush();
        assert.deepEqual(rendered.opt, [{ g: 4 }], 'group 4 rows must be rendered before the clear');
        assert.equal(observedKey(qc, '/api/probe-opt/x')[2], 4, 'the key must carry group 4 before the clear');
        const before = fixture.calls.length;
        await React.act(async () => ctx.clearActiveGroup());
        await flush();
        assert.equal(observedKey(qc, '/api/probe-opt/x')[2], null, 'after the clear the rendered query key must carry no group');
        assert.notDeepEqual(rendered.opt, [{ g: 4 }], "after the clear the previous group's rows must not be rendered");
        const stale = fixture.calls.slice(before).filter(call => groupOf(call) === 4);
        assert.deepEqual(stale, [], 'no call after the clear may carry group 4');
    });

    // ── C. Unseeded switch: hold until the group resolves ─────────────
    // `?group=9` with nothing seeded; the group fetch stays open until the
    // case releases it.
    let release = null;
    await run('C  while an unseeded group loads, a registered query waits', {
        url: '/?group=9',
        getGroup: () => new Promise(resolve => { release = resolve; }),
        children: [h(ScopedProbe, { key: 's', path: '/api/probe-opt/x', name: 'opt' })],
    }, async () => {
        assert.equal(typeof release, 'function', 'the provider must have started loading group 9');
        assert.equal(ctx.loading, true, 'the provider must report loading while group 9 is in flight');
        assert.equal(ctx.group, null, 'no group is resolved yet');
        assert.deepEqual(callsTo('/api/probe-opt/x'), [], 'nothing may be sent, scoped or unscoped, while the group is loading');
        await React.act(async () => release(group(9)));
        await flush();
        assert.deepEqual(callsTo('/api/probe-opt/x').map(groupOf), [9], 'once group 9 resolves, exactly one call goes out, under group 9');
        assert.deepEqual(rendered.opt, [{ g: 9 }], 'group 9 rows are rendered');
    });

    // ── D. An explicit group still wins, in hooks and plain calls ─────
    await run('D  an explicit group option is honoured', { children: [
        h(ScopedProbe, { key: 'a', path: '/api/probe-opt/explicit', name: 'explicit', opts: { group: 12 } }),
        h(ScopedProbe, { key: 'b', path: '/api/probe-opt/none', name: 'none', opts: { group: null } }),
    ] }, async ({ qc }) => {
        await React.act(async () => ctx.setActiveGroup(group(4)));
        await flush();
        assert.deepEqual(callsTo('/api/probe-opt/explicit').map(groupOf), [12], 'useScopedQuery must send the explicit group, not the active one');
        assert.equal(observedKey(qc, '/api/probe-opt/explicit')[2], 12, 'the explicit group rides the key');
        assert.deepEqual(callsTo('/api/probe-opt/none').map(groupOf), [null], 'an explicit null means unscoped by choice');
        assert.equal(observedKey(qc, '/api/probe-opt/none')[2], null, 'an explicit null rides the key');
        await mojoScopedCall('/api/probe/plain', { group: 12 });
        assert.deepEqual(callsTo('/api/probe/plain').map(groupOf), [12], 'mojoScopedCall must send the explicit group');
        await mojoScopedCall('/api/probe/plain-active');
        assert.deepEqual(callsTo('/api/probe/plain-active').map(groupOf), [4], 'without an explicit group a plain call reads the signal');
        // unchanged on purpose: a plain call treats a null group as not passed
        await mojoScopedCall('/api/probe-opt/plain-null', { group: null });
        assert.deepEqual(callsTo('/api/probe-opt/plain-null').map(groupOf), [4], 'a null group on mojoScopedCall still falls back to the signal');
    });

    // ── E. No provider mounted: the signal is still the fallback ──────
    await run('E  with no provider and no signal, an optional query goes unscoped', { provider: false, children: [h(ScopedProbe, { key: 's', path: '/api/probe-opt/x', name: 'opt' })] }, async () => {
        assert.deepEqual(callsTo('/api/probe-opt/x').map(groupOf), [null], 'no provider and no signal means unscoped');
    });
    await run('F  with no provider, a set signal scopes the query', { provider: false, signal: 5, children: [h(ScopedProbe, { key: 's', path: '/api/probe-opt/x', name: 'opt' })] }, async () => {
        assert.deepEqual(callsTo('/api/probe-opt/x').map(groupOf), [5], 'the signal scopes the query when nothing provides a context');
    });
} finally {
    await server.close();
    dom.window.close();
    delete globalThis.__groupScope;
}

console.log(`group scope: ${passed + failures.length} cases, ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
console.log('Mounted group scope: the first request after a switch carries the new group, and useScopedQuery follows the context.');
