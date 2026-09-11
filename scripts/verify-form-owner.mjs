import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Event', 'Node', 'localStorage', 'sessionStorage']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const fixture = globalThis.__formOwner = { writes: [] };
const client = `export * from '/packages/portal-mojo/src/client/client.ts'; export const mojoSave=async(endpoint,id,changes)=>{globalThis.__formOwner.writes.push({endpoint,id,changes});return {id,...changes};};`;
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{
    name: 'form-owner-fixture', enforce: 'pre',
    resolveId: id => id === '/__form_owner_client.ts' ? id : null,
    load: id => id === '/__form_owner_client.ts' ? client : null,
    transform(source, id) {
        if (id.endsWith('/client/model.ts')) return source.replace("from './client'", "from '/__form_owner_client.ts'");
    },
}] });
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
const root = createRoot(document.getElementById('root'));
try {
    const { FormView } = await server.ssrLoadModule('/packages/portal-mojo/src/ui/FormView.tsx');
    const { defineModel } = await server.ssrLoadModule('/packages/portal-mojo/src/client/model.ts');
    const first = defineModel({ name: 'First', endpoint: '/api/first' });
    const second = defineModel({ name: 'Second', endpoint: '/api/second' });
    for (const change of ['model', 'row', 'refetch']) {
        fixture.writes.length = 0;
        let resolveGate;
        let gateCalls = 0;
        const gate = new Promise(resolve => { resolveGate = resolve; });
        const props = { model: first, row: { id: 1, enabled: false }, fields: [{ name: 'enabled', type: 'switch', label: 'Enabled' }], debounceMs: 1, savedFlashMs: 1, beforeSave: () => { gateCalls += 1; return gate; } };
        const render = async value => React.act(async () => root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(FormView, value))));
        await render(props);
        await React.act(async () => document.querySelector('[role="switch"]').click());
        await React.act(async () => new Promise(resolve => setTimeout(resolve, 20)));
        assert.equal(gateCalls, 1, 'the real autosave hook must be awaiting confirmation');
        await render({ ...props, model: change === 'model' ? second : first, row: { id: change === 'row' ? 2 : 1, enabled: false } });
        await React.act(async () => { resolveGate(true); await new Promise(resolve => setTimeout(resolve, 20)); });
        assert.deepEqual(fixture.writes, [{ endpoint: '/api/first', id: 1, changes: { enabled: true } }], `${change}: approval cannot switch model or record`);
        assert.equal(document.querySelector('[role="switch"]').checked, change === 'refetch', `${change}: the new owner cannot inherit the old owner's draft or settlement`);
        await React.act(async () => root.render(null));
        qc.clear();
    }
    console.log('Mounted FormView ownership: deferred confirmation survives same-owner refetch without crossing model, record or reducer boundaries.');
} finally {
    await React.act(async () => root.unmount());
    qc.clear();
    await server.close();
    dom.window.close();
    delete globalThis.__formOwner;
}
