// verify-model-scope — model record calls send no scope and are never blocked for lacking one (#5923).
//
// On a REST record route (`<endpoint>/<id>`) django-mojo binds the request to
// the ROW's own group, whatever the caller sends. A `group` key sent there is
// also saved as the row's `group` field. So the model layer and mojoAction
// declare their record calls `unscoped: true` and send no scope key. This
// script mounts the real defineModel hooks against the real mock and reads
// what reached the transport.
//
// Method notes:
//   - The mock's own request history keeps no bodies. A Vite transform points
//     client.ts's `import('./mock')` at a module that re-exports the real mock
//     and wraps mockFetch to record {method, path, params, body}.
//   - '/api/user' is registered REQUIRED. On code that does not declare record
//     calls unscoped, cases A-E reject at the assertScoped tripwire and nothing
//     reaches the recorder.
//   - A collection create is NOT a record call: it still sends only the
//     caller's `changes` (case D passes `group` there by hand).
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Event', 'Node', 'localStorage', 'sessionStorage']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const MOCK = '/packages/portal-mojo/src/client/mock.ts';
const fixture = globalThis.__modelScope = { calls: [] };
const recorder = `export * from '${MOCK}'; import { mockFetch as real } from '${MOCK}';
export const mockFetch = async (path, opts) => { globalThis.__modelScope.calls.push({ method: opts.method ?? 'GET', path, params: opts.params, body: opts.body }); return real(path, opts); };`;
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{
    name: 'model-scope-recorder', enforce: 'pre',
    resolveId: id => id === '/__model_scope_mock.ts' ? id : null,
    load: id => id === '/__model_scope_mock.ts' ? recorder : null,
    transform(source, id) {
        if (id.endsWith('/client/client.ts')) return source.replaceAll("import('./mock')", "import('/__model_scope_mock.ts')");
    },
}] });
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
const root = createRoot(document.getElementById('root'));

/** The one recorded request to `path` with `method`; the log is cleared before each case. */
const sent = (method, path) => {
    const hits = fixture.calls.filter(call => call.method === method && call.path === path);
    assert.equal(hits.length, 1, `exactly one ${method} ${path} must reach the transport (saw ${hits.length})`);
    return hits[0];
};
const noScope = (call, what) => {
    assert.equal('group' in (call.params ?? {}), false, `${what}: params must carry no 'group'`);
    assert.equal('group' in (call.body ?? {}), false, `${what}: body must carry no 'group'`);
};

try {
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
    const mock = await server.ssrLoadModule(MOCK);
    const { registerEndpointScope, resetEndpointScopes } = await server.ssrLoadModule('/packages/portal-mojo/src/client/endpoint-scope.ts');
    const { setActiveGroupSignal } = await server.ssrLoadModule('/packages/portal-mojo/src/client/active-group.ts');
    const { GroupContext } = await server.ssrLoadModule('/packages/portal-mojo/src/client/group-context.ts');
    const { defineModel } = await server.ssrLoadModule('/packages/portal-mojo/src/client/model.ts');
    const { useSaveModel } = await server.ssrLoadModule('/packages/portal-mojo/src/client/hooks.ts');
    const { mojoAction } = await server.ssrLoadModule('/packages/portal-mojo/src/client/action-result.ts');

    // Auth hooks installed directly with a mock-minted token (the
    // verify-endpoint-scoping pattern — no JWT refresh machinery).
    const loginBody = await mock.mockFetch('/api/login', {
        method: 'POST', body: { username: 'groups.manager@nativemojo.com', password: 'mojo' },
    });
    const token = loginBody?.data?.access_token;
    assert.equal(typeof token, 'string', 'mock login must mint an access token');
    client.installAuthHooks({ async preRequest() {}, authHeader: () => `Bearer ${token}` });
    const directory = await mock.mockFetch('/api/user', { headers: { Authorization: `Bearer ${token}` }, params: { size: 100 } });
    const target = directory.data.find(row => row.is_active && row.id !== 13);
    const other = directory.data.find(row => row.id !== target?.id && row.id !== 13);
    assert(target && other, 'mock seeds must include two target users');

    resetEndpointScopes();
    registerEndpointScope('/api/user', { key: 'group' });
    const M = defineModel({ name: 'user', endpoint: '/api/user', actions: { disable: {}, reactivate: {} } });

    let probe = null;
    const Probe = ({ oneId }) => {
        probe = { disable: M.useAction('disable'), reactivate: M.useAction('reactivate'), save: M.useSave(), remove: M.useDelete(), one: M.useOne(oneId), genericSave: useSaveModel('/api/user') };
        return null;
    };
    // A group is active in the React context throughout: record calls must
    // stay unscoped even so.
    const group = { group: { id: 4, name: 'G', kind: 'org' }, member: null, loading: false, setActiveGroup() {}, clearActiveGroup() {} };
    const render = oneId => React.act(async () => root.render(React.createElement(QueryClientProvider, { client: qc },
        React.createElement(GroupContext.Provider, { value: group }, React.createElement(Probe, { oneId })))));
    const settle = () => React.act(async () => new Promise(resolve => setTimeout(resolve, 20)));
    // A mutation's observers are notified a tick after it settles; keep that inside act.
    const run = fn => React.act(async () => { const out = await fn(); await new Promise(resolve => setTimeout(resolve, 0)); return out; });
    await render(null);
    const path = `/api/user/${target.id}`;

    // ── A. Action: the body is exactly {[key]: payload} ──
    fixture.calls.length = 0;
    const outcome = await run(() => probe.disable.mutateAsync({ id: target.id, payload: { reason: 'admin' } }));
    assert.equal(outcome.row.is_active, false, 'A: the action must succeed on a required family');
    let call = sent('POST', path);
    assert.deepEqual(call.body, { disable: { reason: 'admin' } }, 'A: the action body must be exactly {[key]: payload}');
    noScope(call, 'A: useAction');
    await run(() => probe.reactivate.mutateAsync({ id: target.id }));

    // ── B. Update: the body is exactly the caller's changes ──
    fixture.calls.length = 0;
    await run(() => probe.save.mutateAsync({ id: target.id, changes: { display_name: 'x' } }));
    call = sent('POST', path);
    assert.deepEqual(call.body, { display_name: 'x' }, 'B: an update must send exactly the caller\'s changes');
    noScope(call, 'B: useSave with an id');

    // ── C. Get: useOne and fetchOne ──
    fixture.calls.length = 0;
    await render(target.id);
    // The mock answers after its own latency: wait for the query, not a fixed time.
    for (let tries = 0; probe.one.isFetching && tries < 100; tries += 1) await settle();
    assert.equal(probe.one.error, null, `C: useOne must not be blocked (${probe.one.error?.message})`);
    assert.equal(probe.one.data?.id, target.id, 'C: useOne must resolve the record');
    noScope(sent('GET', path), 'C: useOne');
    const fetched = await M.fetchOne(qc, other.id);
    assert.equal(fetched.id, other.id, 'C: fetchOne must resolve the record');
    noScope(sent('GET', `/api/user/${other.id}`), 'C: fetchOne');
    await render(null);

    // ── D. Delete — and the collection create that feeds it is unchanged ──
    fixture.calls.length = 0;
    const changes = { username: 'scope.probe', email: 'scope.probe@nativemojo.com', group: 4 };
    const created = await run(() => probe.save.mutateAsync({ id: null, changes }));
    assert.deepEqual(sent('POST', '/api/user').body, changes, 'D: a collection create still sends only the caller\'s changes');
    await run(() => probe.remove.mutateAsync({ id: created.id }));
    noScope(sent('DELETE', `/api/user/${created.id}`), 'D: useDelete');

    // ── E. Update through the generic useSaveModel hook ──
    fixture.calls.length = 0;
    await run(() => probe.genericSave.mutateAsync({ id: target.id, changes: { display_name: 'y' } }));
    call = sent('POST', path);
    assert.deepEqual(call.body, { display_name: 'y' }, 'E: a generic update must send exactly the caller\'s changes');
    noScope(call, 'E: useSaveModel with an id');

    // ── F. mojoAction: no injection, with a group active in the signal ──
    setActiveGroupSignal(4);
    fixture.calls.length = 0;
    const disabled = await mojoAction('/api/user', target.id, 'disable', { reason: 'admin' });
    assert.equal(disabled.ok, true, 'F: mojoAction must succeed on a required family');
    call = sent('POST', path);
    assert.deepEqual(call.body, { disable: { reason: 'admin' } }, 'F: mojoAction must send exactly {[action]: payload} — a sent group is saved as the row\'s group field');
    noScope(call, 'F: mojoAction');
    await mojoAction('/api/user', target.id, 'reactivate');

    console.log('Model scope: action, update (useSave and useSaveModel), get, delete and mojoAction send no group on record routes and pass a required family; a collection create sends only the caller\'s changes.');
} finally {
    await React.act(async () => root.unmount());
    qc.clear();
    await server.close();
    dom.window.close();
    delete globalThis.__modelScope;
}
