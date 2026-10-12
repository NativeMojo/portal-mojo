// Mounted controlled/default ModelTable contract. One real table and URL store;
// only the network response is a fixture. No source-string assertions.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://verify.invalid/' });
for (const name of ['window', 'document', 'location', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'Node', 'localStorage', 'sessionStorage']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), appType: 'custom', logLevel: 'silent', define: { 'import.meta.env.VITE_MOJO_API': JSON.stringify('https://verify.invalid') }, server: { middlewareMode: true } });
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter, useLocation } = await import('react-router-dom');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const h = React.createElement;
const settle = () => new Promise(r => setTimeout(r, 15));
let root;
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
const calls = [];
globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return { ok: true, json: async () => ({ status: true, data: [{ id: 1, name: 'Network row', secret: 'raw' }], count: 53 }) };
};
try {
    const { ModelTable } = await server.ssrLoadModule('/packages/portal-mojo/src/ui/ModelTable.tsx');
    const { defineModel } = await server.ssrLoadModule('/packages/portal-mojo/src/client/model.ts');
    const seen = [];
    let query = { data: { rows: [{ id: 1, name: 'Private row', media: 'private-capability' }], count: 53 }, status: 'success', isFetching: false, refetch: () => { refreshes++; } };
    let refreshes = 0;
    let rowActivations = 0;
    let nestedActivations = 0;
    function Adapter({ params, enabled, children }) { seen.push({ params, enabled }); return children(query); }
    function Location() { return h('output', { id: 'url' }, useLocation().search); }
    const columns = [{ key: 'name', label: 'Name' }, { key: 'action', label: 'Action', sortable: false, render: () => h('button', { onClick: () => { nestedActivations++; } }, 'Nested') }];
    const model = defineModel({ name: 'AdapterProbe', endpoint: '/api/adapter-probe', normalizeListParams: params => ({ ...params, graph: 'safe' }), sanitizeRow: row => ({ id: row.id, name: 'Sanitized row' }) });
    const base = { model, columns, title: 'Records', queryAdapter: Adapter, persistState: true, persistKey: 'adapter-probe', fixedParams: { group: 7, graph: 'private' }, defaultParams: { sort: 'name', size: 25 }, presets: [{ key: 'all', label: 'All', params: {} }, { key: 'active', label: 'Active', params: { is_active: 'true' } }], onRowClick: () => { rowActivations++; } };
    localStorage.setItem('mojo:tableview:adapter-probe', JSON.stringify({ v: 2, size: 10, sort: '-id' }));
    let props = base;
    let route = 0;
    const render = async () => { await React.act(async () => { root.render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { key: route, initialEntries: ['/?sort=name&group=99&search=initial'] }, h(ModelTable, props), h(Location)))); await settle(); }); };
    root = createRoot(document.getElementById('root'));
    await render();
    assert.equal(seen[0].enabled, false, 'adapter observes persistence gate before restore');
    const request = seen.filter(s => s.enabled).at(-1).params;
    assert.equal(request.group, 7);
    assert.equal(request.graph, 'private', 'fixed params override normalized graph');
    assert.equal(request.size, 10, 'saved size wins over default');
    assert(document.querySelector('#url').textContent.includes('size=10'), 'saved global size is explicit when caller defaults to 25');
    assert.equal(request.sort, 'name', 'URL sort wins over saved state');
    assert.equal(document.querySelectorAll('table').length, 1);
    assert.equal(document.querySelectorAll('.toolbar').length, 1);
    assert(document.body.textContent.includes('Private row'));
    assert.equal(calls.length, 0, 'controlled mode sends no default list request');
    assert.equal(qc.getQueryCache().getAll().length, 0, 'private adapter rows never enter generic Query cache');

    const click = async element => { assert(element, 'click target exists'); await React.act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); await settle(); }); };
    const key = async (element, value) => { await React.act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))); };
    const row = document.querySelector('tr.row-click');
    assert.equal(row.tabIndex, 0);
    await key(row, 'Enter');
    await key(row, ' ');
    await click(row.querySelector('td'));
    assert.equal(rowActivations, 3, 'row responds once to Enter, Space, and cell click');
    const nested = row.querySelector('button');
    await key(nested, 'Enter');
    await key(nested, ' ');
    await click(nested);
    assert.equal(rowActivations, 3, 'nested control events do not activate row');
    assert.equal(nestedActivations, 1);
    await click(document.querySelector('[title="Refresh"]'));
    assert.equal(refreshes, 1);
    const size = document.querySelector('.pager select');
    await React.act(async () => { size.value = '25'; size.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(seen.at(-1).params.size, 25);
    await React.act(async () => { size.value = '10'; size.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(seen.at(-1).params.size, 10, 'choosing 10 survives caller default 25');
    await click(document.querySelector('[title="Next page"]'));
    assert.equal(seen.at(-1).params.start, 10);
    await click([...document.querySelectorAll('.seg-btn')].find(n => n.textContent === 'Active'));
    assert.equal(seen.at(-1).params.is_active, 'true');
    assert.equal(seen.at(-1).params.start, 0);
    assert(document.querySelector('#url').textContent.includes('is_active=true'));
    await click(document.querySelector('.th-sort'));
    assert.equal(seen.at(-1).params.sort, '-name');
    const search = document.querySelector('input[type="search"]');
    await React.act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'updated term');
        search.dispatchEvent(new Event('input', { bubbles: true }));
        search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    assert.equal(seen.at(-1).params.search, 'updated term');
    assert(document.querySelector('#url').textContent.includes('search=updated+term'));


    query = { ...query, status: 'error', error: new Error('Temporary outage') };
    await render();
    assert(document.body.textContent.includes('Private row'), 'background failure preserves authorized current rows');
    assert(document.querySelector('[role="alert"]').textContent.includes('Temporary outage'));
    query = { ...query, data: undefined };
    await render();
    assert(!document.body.textContent.includes('Private row'), 'clearing adapter data immediately clears old private rows');
    assert(document.body.textContent.includes('Could not load records'));
    query = { ...query, data: { rows: [{ id: 1, name: 'Hidden old scope' }], count: 1 }, status: 'success' };
    props = { ...base, fixedParams: null };
    await render();
    assert.equal(seen.at(-1).enabled, false);
    assert(!document.body.textContent.includes('Hidden old scope'));
    assert(document.querySelector('[title="Refresh"]').disabled);
    assert.equal(calls.length, 0);
    assert.equal(qc.getQueryCache().getAll().length, 0);

    // Default callers still fetch normalized/fixed params and sanitize rows.
    route++;
    props = { ...base, queryAdapter: undefined, persistState: false, searchable: false };
    await render();
    await React.act(settle);
    assert.equal(calls.length, 1, 'default mode still fetches once');
    const sent = new URL(calls[0].url);
    assert.equal(sent.searchParams.get('group'), '7');
    assert.equal(sent.searchParams.get('graph'), 'private');
    assert.equal(sent.searchParams.has('search'), false, 'searchable=false strips stale URL search before fetching');
    assert(document.body.textContent.includes('Sanitized row'));
    assert(!JSON.stringify(qc.getQueryCache().getAll().map(q => q.state.data)).includes('raw'));
    console.log('PASS ModelTable adapter: hydration, fixed/normalized URL params, one shared render, zero default fetch/cache, keyboard, nested controls, refresh, pager, search, filters, retained errors, scope clearing, and default callers');
} finally {
    if (root) await React.act(async () => root.unmount());
    qc.clear();
    await server.close();
    dom.window.close();
}
