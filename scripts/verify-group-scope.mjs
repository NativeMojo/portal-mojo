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
    getMember: async () => ({ id: 1, permissions: { view_probe: true } }),
    dispatchGate: null,
    groupDispatches: [],
    actorDispatches: [],
};
const REAL_CLIENT = '/packages/portal-mojo/src/client/client.ts';
const recorder = `export * from '${REAL_CLIENT}';
export const mojoCall = async (path, opts = {}) => {
    globalThis.__groupScope.calls.push({ path, params: opts.params ?? null, body: opts.body ?? null });
    return { status: true, data: [{ g: opts.params?.group ?? opts.body?.group ?? null }] };
};`;
const groupClient = `export * from '${REAL_CLIENT}';
import {getAuthSnapshot} from '/packages/portal-mojo/src/client/auth.ts';
export const mojoGet = (endpoint, id) => globalThis.__groupScope.getGroup(endpoint, id);
export const mojoCall = async (path, opts = {}) => {
    const f = globalThis.__groupScope;
    if (f.dispatchGate) await f.dispatchGate;
    opts.beforeSend?.();
    opts.signal?.throwIfAborted();
    f.groupDispatches.push(path);
    f.actorDispatches.push({path,uid:getAuthSnapshot().uid});
    const member = path.endsWith('/member');
    const id = Number(path.split('/')[3]);
    return { status: true, data: await (member ? f.getMember(id) : f.getGroup('/api/group', id)) };
};`;
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
const { QueryClient, QueryClientProvider, useQuery, QueryObserver } = await import('@tanstack/react-query');
const h = React.createElement;

const failures = [];
let passed = 0;

try {
    const { MojoError } = await server.ssrLoadModule('/packages/portal-mojo/src/client/errors.ts');
    const { hasPermission } = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');
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
        // A host workspace must use the explicit denial flag as well as identity.
        return ctx.group && !ctx.accessDenied ? h('div', {'data-private-probe':true}, 'private data') : null;
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
        fixture.groupDispatches.length = 0;
        fixture.actorDispatches.length = 0;
        fixture.dispatchGate = null;
        fixture.getMember = async () => ({ id: 1, permissions: { view_probe: true } });
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
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
        const root = createRoot(document.getElementById('root'));
        const tree = provider ? h(GroupProvider, null, h(Capture), ...children) : h(React.Fragment, null, ...children);
        try {
            await React.act(async () => root.render(h(QueryClientProvider, { client: qc }, tree)));
            await flush();
            await body({ qc,
                unmountProvider: () => React.act(async () => root.render(h(QueryClientProvider, {client:qc}))),
                remountProvider: () => React.act(async () => root.render(h(QueryClientProvider, {client:qc}, h(GroupProvider,null,h(Capture))))),
            });
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

    await run('G  cached group 503 retains group, URL, storage and member', { url:'/?group=4', children:[] }, async ({qc}) => {
        await React.act(async () => ctx.setActiveGroup(group(4)));
        await flush();
        fixture.getGroup = async () => { throw new MojoError('Temporary outage',503); };
        await React.act(async () => { await qc.refetchQueries({queryKey:['group',4,'1']}); });
        await flush();
        assert.equal(ctx.group?.id,4,'a cached 503 must retain the group');
        assert.equal(ctx.member?.permissions.view_probe,true);
        assert.equal(getActiveGroupId(),4);
        assert.equal(localStorage.getItem('active_group_id'),'4');
        assert.equal(new URLSearchParams(window.location.search).get('group'),'4');
        assert.notEqual(ctx.accessDenied,true);
        assert.ok(document.querySelector('[data-private-probe]'),'a temporary failure must preserve the mounted private shell');
    });
    await run('H  cached member 503 retains member permissions', { url:'/?group=4',children:[] },async ({qc}) => {
        fixture.getMember = async () => { throw new MojoError('Temporary outage',503); };
        await React.act(async () => { await qc.refetchQueries({queryKey:['group-member',4,'1']}); });
        await flush();
        assert.equal(ctx.group?.id,4);
        assert.equal(ctx.member?.permissions.view_probe,true);
        assert.notEqual(ctx.accessDenied,true);
    });
    await run('I  cached member 403 exposes explicit workspace denial', { url:'/?group=4',children:[] },async ({qc}) => {
        let calls=0;
        fixture.getMember=async () => { calls++; throw new MojoError('Forbidden',403); };
        // Even a consumer that configures retries may not postpone denial.
        qc.setDefaultOptions({queries:{retry:3,retryDelay:0}});
        await React.act(async () => { await qc.refetchQueries({queryKey:['group-member',4,'1']}); });
        await flush();
        assert.equal(calls,1,'definitive membership denial must not retry');
        assert.equal(ctx.group?.id,4,'identity may remain for a denied shell');
        assert.equal(ctx.member,null,'cached grants must disappear');
        assert.equal(ctx.accessDenied,true,'a workspace must have an explicit fence');
        assert.equal(ctx.loading,false,'denial is not loading');
        assert.equal(hasPermission({id:1,permissions:{view_probe:true}},'view_probe',ctx.member),true,'user grants remain separate; the workspace must use accessDenied');
    });
    await run('J  cached group 403 never remains resolved', { url:'/?group=4',children:[] },async ({qc}) => {
        fixture.getGroup=async () => { throw new MojoError('Forbidden',403); };
        await React.act(async () => { await qc.refetchQueries({queryKey:['group',4,'1']}); });
        await flush();
        assert.equal(ctx.group,null);
        assert.equal(ctx.member,null);
        assert.equal(getActiveGroupId(),null);
    });
    await run('K  initial unresolved group failure still clears context', { url:'/?group=4',getGroup:async () => { throw new MojoError('Forbidden',403); },children:[] },async () => {
        await flush();
        assert.equal(ctx.group,null);
        assert.equal(new URLSearchParams(window.location.search).get('group'),null);
    });
    await run('L  a held dispatch cannot send after the group changes', { url:'/?group=4',children:[] },async ({qc}) => {
        let release;
        fixture.dispatchGate=new Promise(resolve => { release=resolve; });
        fixture.groupDispatches.length=0;
        fixture.actorDispatches.length=0;
        const pending=qc.refetchQueries({queryKey:['group-member',4,'1']});
        await flush();
        await React.act(async () => ctx.setActiveGroup(group(7)));
        await React.act(async () => { release(); await pending; });
        fixture.dispatchGate=null;
        await flush();
        assert.ok(!fixture.groupDispatches.includes('/api/group/4/member'),'beforeSend must reject the old candidate after auth waiting');
        assert.equal(ctx.group?.id,7);
    });
    await run('M  a late result cannot restore a cleared group while another observer holds its key', { url:'/?group=4',children:[] },async ({qc}) => {
        const key=['group-member',4,'1'];
        const observer=new QueryObserver(qc,{queryKey:key,enabled:false});
        const unsubscribe=observer.subscribe(() => {});
        let release;
        // The late request must be rejected, not retried as a new selection.
        qc.setDefaultOptions({queries:{retry:false}});
        fixture.getMember=() => new Promise(resolve => { release=resolve; });
        const pending=qc.refetchQueries({queryKey:key});
        await flush();
        await React.act(async () => ctx.clearActiveGroup());
        await React.act(async () => { release({id:999,permissions:{view_probe:true}}); await pending; });
        await flush();
        assert.notEqual(qc.getQueryData(key)?.id,999,'post-await guard must reject a late response even with another observer');
        assert.equal(ctx.group,null);
        assert.equal(ctx.member,null);
        unsubscribe();
    });
    await run('N  membership denial survives a later outage until a successful authorization read', {url:'/?group=4',children:[]},async ({qc}) => {
        const key=['group-member',4,'1'];
        fixture.getMember=async () => { throw new MojoError('Forbidden',403); };
        await React.act(async () => { await qc.refetchQueries({queryKey:key}); });
        await flush();
        assert.equal(ctx.accessDenied,true);
        fixture.getMember=async () => { throw new MojoError('Temporary outage',503); };
        await React.act(async () => { await qc.refetchQueries({queryKey:key}); });
        await flush();
        assert.equal(ctx.accessDenied,true,'a 503 must not erase a prior definitive denial');
        assert.equal(ctx.member,null,'a 503 must not restore cached grants');
        assert.equal(document.querySelector('[data-private-probe]'),null,'private content must remain fenced after 403 then 503');
        fixture.getMember=async () => ({id:22,permissions:{view_probe:true}});
        await React.act(async () => { await qc.refetchQueries({queryKey:key}); });
        await flush();
        assert.equal(ctx.accessDenied,false,'a successful member read may restore access');
        assert.equal(ctx.member?.id,22);
        assert.ok(document.querySelector('[data-private-probe]'),'positive revalidation may restore the private shell');
    });
    await run('O  selecting a denied cached row requires fresh group and member reads', {url:'/?group=4',children:[]},async ({qc}) => {
        fixture.getGroup=async () => { throw new MojoError('Forbidden',403); };
        await React.act(async () => { await qc.refetchQueries({queryKey:['group',4,'1']}); });
        await flush();
        fixture.getGroup=async () => { throw new MojoError('Temporary outage',503); };
        fixture.groupDispatches.length=0;
        await React.act(async () => ctx.setActiveGroup(group(4)));
        await flush();
        assert.ok(fixture.groupDispatches.includes('/api/group/4'),'a denied selection cannot seed authorization from a switcher row');
        assert.equal(ctx.group,null);
        assert.equal(ctx.member,null);
        fixture.getGroup=async (_endpoint,id) => group(id);
        fixture.getMember=async () => ({id:23,permissions:{view_probe:true}});
        await React.act(async () => ctx.setActiveGroup(group(4)));
        await flush();
        assert.equal(ctx.group?.id,4);
        assert.equal(ctx.member?.id,23,'membership must be freshly authorized after a group denial');
        assert.equal(ctx.accessDenied,false);
    });
    await run('P  clear and reselect cannot accept a held old membership result', {url:'/?group=4',children:[]},async ({qc}) => {
        const key=['group-member',4,'1'];
        const observer=new QueryObserver(qc,{queryKey:key,enabled:false});
        const unsubscribe=observer.subscribe(() => {});
        let release;
        fixture.getMember=() => new Promise(resolve => { release=resolve; });
        const pending=qc.refetchQueries({queryKey:key});
        await flush();
        await React.act(async () => ctx.clearActiveGroup());
        await React.act(async () => ctx.setActiveGroup(group(4)));
        await React.act(async () => { release({id:999,permissions:{view_probe:true}}); await pending; });
        await flush();
        assert.notEqual(qc.getQueryData(key)?.id,999,'returning to the same group cannot revive an old request generation');
        unsubscribe();
    });
    await run('Q  switching accounts rejects held member dispatches and logout rejects late responses', {url:'/?group=4',children:[]},async ({qc}) => {
        let release;
        fixture.dispatchGate=new Promise(resolve => { release=resolve; });
        fixture.groupDispatches.length=0;
        fixture.actorDispatches.length=0;
        const pending=qc.refetchQueries({queryKey:['group-member',4,'1']});
        const token2=`${b64({alg:'none'})}.${b64({uid:2,exp:Math.floor(Date.now()/1000)+3600})}.x`;
        await React.act(async () => setTokens(token2));
        await React.act(async () => { release(); await pending; });
        fixture.dispatchGate=null;
        await flush();
        assert.ok(!fixture.actorDispatches.some(call => call.path==='/api/group/4/member' && call.uid==='1'),'the old actor cannot dispatch after account switch');
        const key=['group-member',4,'2'];
        const observer=new QueryObserver(qc,{queryKey:key,enabled:false});
        const unsubscribe=observer.subscribe(() => {});
        fixture.getMember=() => new Promise(resolve => { release=resolve; });
        const late=qc.refetchQueries({queryKey:key});
        await flush();
        await React.act(async () => clearTokens());
        await React.act(async () => { release({id:999,permissions:{view_probe:true}}); await late; });
        await flush();
        assert.notEqual(qc.getQueryData(key)?.id,999);
        assert.equal(ctx.group,null);
        assert.equal(ctx.member,null);
        unsubscribe();
    });
    await run('R  reselecting the current denied membership performs positive revalidation', {url:'/?group=4',children:[]},async ({qc}) => {
        fixture.getMember=async () => { throw new MojoError('Forbidden',403); };
        await React.act(async () => { await qc.refetchQueries({queryKey:['group-member',4,'1']}); });
        await flush();
        assert.equal(ctx.group?.id,4);
        assert.equal(ctx.accessDenied,true);
        fixture.getMember=async () => ({id:24,permissions:{view_probe:true}});
        await React.act(async () => ctx.setActiveGroup(group(4)));
        await flush();
        assert.equal(ctx.accessDenied,false);
        assert.equal(ctx.member?.id,24);
    });
    await run('S  provider teardown rejects a late result retained by another observer', {url:'/?group=4',children:[]},async ({qc,unmountProvider,remountProvider}) => {
        const key=['group-member',4,'1'];
        const observer=new QueryObserver(qc,{queryKey:key,enabled:false,gcTime:0});
        const unsubscribe=observer.subscribe(() => {});
        let release;
        fixture.getMember=() => new Promise(resolve => {release=resolve;});
        const pending=qc.refetchQueries({queryKey:key});
        await flush();
        await unmountProvider();
        await React.act(async () => {release({id:999,permissions:{view_probe:true}});await pending;});
        assert.notEqual(qc.getQueryData(key)?.id,999,'an unmounted provider cannot accept or re-authorize a late response');
        fixture.getMember=async () => ({id:25,permissions:{view_probe:true}});
        await remountProvider();
        await flush();
        assert.notEqual(ctx.member?.id,999);
        unsubscribe();
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
