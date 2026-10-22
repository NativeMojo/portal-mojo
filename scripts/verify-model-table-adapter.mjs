// Mounted controlled/default ModelTable contract. One real table and URL store;
// only the network response is a fixture. No source-string assertions.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://verify.invalid/' });
for (const name of ['window', 'document', 'location', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'Node', 'localStorage', 'sessionStorage']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
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
let responseStatus = 200;
globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (responseStatus !== 200) return { ok: false, status: responseStatus, json: async () => ({ status: false, error: `Access denied (${responseStatus})` }) };
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
    const choose = async (input, value) => {
        await click(input);
        const list = document.getElementById(input.getAttribute('aria-controls'));
        assert(list, 'shared dropdown opened its owned listbox');
        await click(list.querySelector(`[role="option"][data-value="${value}"]`));
    };
    const size = document.querySelector('.pager [role="combobox"]');
    await choose(size, '25');
    assert.equal(seen.at(-1).params.size, 25);
    await choose(size, '10');
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

    // The Fleet page and two modal tables share a router, but modal params
    // must start fresh and never change the page or one another's requests.
    const LocalIdentity = React.createContext('fleet');
    const localSeen = new Map();
    const localRequests = new Map();
    function LocalAdapter({ params, enabled, children }) {
        const id = React.useContext(LocalIdentity);
        const signature = JSON.stringify(params);
        localSeen.set(id, { params, enabled });
        React.useEffect(() => {
            if (enabled) localRequests.set(id, (localRequests.get(id) ?? 0) + 1);
        }, [id, signature, enabled]);
        return children({ data: { rows: [{ id: 1, name: `${id} row` }], count: 100 }, status: 'success', isFetching: false, refetch() {} });
    }
    const fleetEntry = '/?page=4&size=25&search=fleet&sort=-created&status=online&group=99';
    let localScope = { group: 7, graph: 'private' };
    let localKey = 0;
    let localPersistence = false;
    const tableNode = (id, extra) => h('section', { id, key: id }, h(LocalIdentity.Provider, { value: id }, h(ModelTable, {
        model, columns: [{ key: 'name', label: 'Name' }], title: id, queryAdapter: LocalAdapter,
        presets: [{ key: 'all', label: 'All', params: {} }, { key: 'done', label: 'Done', params: { status: 'done' } }],
        ...extra,
    })));
    const renderLocal = async () => {
        await React.act(async () => {
            root.render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { key: 'local-contract', initialEntries: [fleetEntry] },
                tableNode('fleet', { fixedParams: { group: 9 } }),
                tableNode('schedule', { key: localKey, paramsMode: 'local', fixedParams: localScope, defaultParams: { size: 5, sort: 'name', status: 'queued' }, persistState: localPersistence, persistKey: 'local-schedule' }),
                tableNode('analytics', { paramsMode: 'local', fixedParams: { group: 8 }, defaultParams: { size: 10, sort: '-id' } }),
                h(Location))));
            await settle();
        });
    };
    const paramsOf = id => localSeen.get(id).params;
    const urlState = () => document.querySelector('#url').textContent;
    const inTable = (id, selector) => document.querySelector(`#${id} ${selector}`);
    const searchTable = async (id, term) => {
        const input = inTable(id, 'input[type="search"]');
        await React.act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, term);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
    };
    const done = id => [...document.querySelectorAll(`#${id} .seg-btn`)].find(n => n.textContent === 'Done');
    await renderLocal();
    const initialFleet = { ...paramsOf('fleet') };
    const initialUrl = urlState();
    assert.equal(initialFleet.start, 75, 'Fleet consumes the URL page');
    assert.equal(initialFleet.search, 'fleet');
    assert.equal(paramsOf('schedule').start, 0, 'local table starts on page one instead of inheriting Fleet page');
    assert.equal(paramsOf('schedule').search, undefined, 'local table ignores Fleet search');
    assert.equal(paramsOf('schedule').size, 5);
    assert.equal(paramsOf('schedule').status, 'queued', 'local defaults ignore Fleet filters');
    assert.equal(paramsOf('schedule').sort, 'name');
    assert.equal(paramsOf('analytics').status, undefined);
    assert.equal(paramsOf('analytics').size, 10);
    assert.equal(paramsOf('schedule').graph, 'private', 'fixed params still override normalization');
    const initialAnalytics = { ...paramsOf('analytics') };
    const fleetRequests = localRequests.get('fleet');
    const untouchedStorage = localStorage.getItem('mojo:tableview:local-schedule');
    await click(inTable('schedule', '[title="Next page"]'));
    assert.equal(paramsOf('schedule').start, 5);
    await searchTable('schedule', 'schedule term');
    assert.equal(paramsOf('schedule').search, 'schedule term');
    assert.equal(paramsOf('schedule').start, 0);
    await click(inTable('schedule', '.th-sort'));
    assert.equal(paramsOf('schedule').sort, '-name');
    await click(done('schedule'));
    assert.equal(paramsOf('schedule').status, 'done');
    await click(inTable('schedule', '[title="Remove filter"]'));
    assert.equal(paramsOf('schedule').status, undefined, 'removing local filter does not resurrect defaults');
    const localSize = inTable('schedule', '.pager [role="combobox"]');
    await choose(localSize, '10');
    assert.equal(paramsOf('schedule').size, 10, 'local size serialization uses caller default');
    assert.deepEqual(paramsOf('fleet'), initialFleet);
    assert.deepEqual(paramsOf('analytics'), initialAnalytics);
    assert.equal(localRequests.get('fleet'), fleetRequests, 'local edits trigger no underlying Fleet request');
    assert.equal(urlState(), initialUrl, 'local writes never touch route state');
    assert.equal(localStorage.getItem('mojo:tableview:local-schedule'), untouchedStorage, 'local persistence defaults off');
    const scheduleAfterEdits = { ...paramsOf('schedule') };
    await click(inTable('analytics', '[title="Next page"]'));
    await searchTable('analytics', 'analytics term');
    await click(inTable('analytics', '.th-sort'));
    await click(done('analytics'));
    assert.equal(paramsOf('analytics').search, 'analytics term');
    assert.equal(paramsOf('analytics').sort, 'name');
    assert.equal(paramsOf('analytics').status, 'done');
    assert.deepEqual(paramsOf('schedule'), scheduleAfterEdits, 'two local instances remain independent');
    const analyticsAfterEdits = { ...paramsOf('analytics') };
    const scheduleRequests = localRequests.get('schedule');
    const analyticsRequests = localRequests.get('analytics');
    await click(inTable('fleet', '[title="Next page"]'));
    await searchTable('fleet', 'fleet changed');
    assert.equal(paramsOf('fleet').search, 'fleet changed');
    assert(urlState().includes('search=fleet+changed'), 'default URL behavior remains active');
    assert.deepEqual(paramsOf('schedule'), scheduleAfterEdits);
    assert.deepEqual(paramsOf('analytics'), analyticsAfterEdits);
    assert.equal(localRequests.get('schedule'), scheduleRequests, 'outer URL edits do not requery local tables');
    assert.equal(localRequests.get('analytics'), analyticsRequests);
    const changedFleetUrl = urlState();
    const changedFleetRequests = localRequests.get('fleet');
    await click(inTable('schedule', '[title="Next page"]'));
    localScope = { group: 17, graph: 'private' };
    await renderLocal();
    assert.equal(paramsOf('schedule').start, 0, 'local scope change resets only local paging');
    assert.equal(paramsOf('schedule').group, 17);
    assert.equal(inTable('schedule', '.filter-pills')?.textContent.includes('group') ?? false, false);
    localScope = null;
    await renderLocal();
    assert.equal(localSeen.get('schedule').enabled, false);
    assert(!document.querySelector('#schedule').textContent.includes('schedule row'));
    localScope = { group: 17, graph: 'private' };
    localKey++;
    await renderLocal();
    assert.equal(paramsOf('schedule').start, 0);
    assert.equal(paramsOf('schedule').search, undefined, 'remount starts fresh');
    assert.equal(paramsOf('schedule').size, 5);
    assert.equal(paramsOf('schedule').status, 'queued');
    // Explicit persistence can restore a local table, but never from the URL.
    localStorage.setItem('mojo:tableview:local-schedule', JSON.stringify({ v: 2, search: 'saved local', sort: '-id', size: 25, filters: { status: 'saved', group: '999' } }));
    localPersistence = true;
    localKey++;
    await renderLocal();
    assert.equal(paramsOf('schedule').search, 'saved local');
    assert.equal(paramsOf('schedule').sort, '-id');
    assert.equal(paramsOf('schedule').size, 25);
    assert.equal(paramsOf('schedule').status, 'saved');
    assert.equal(paramsOf('schedule').group, 17, 'saved scope cannot replace fixed identity');
    assert.equal(JSON.parse(localStorage.getItem('mojo:tableview:local-schedule')).filters.group, undefined, 'fixed scope is never persisted');
    assert.equal(urlState(), changedFleetUrl, 'scope reset and local hydration never write the URL');
    assert.equal(localRequests.get('fleet'), changedFleetRequests);
    assert.deepEqual(paramsOf('analytics'), analyticsAfterEdits);
    assert.equal(calls.length, 0, 'all adapters suppress underlying default queries');
    assert.equal(qc.getQueryCache().getAll().length, 0, 'local mode does not introduce shared query caching');
    console.log('PASS ModelTable local params: outer Fleet URL plus two independent tables, search/sort/filter/pager, no cross-requests, scope reset, remount, and opt-in persistence');

    // JavaScript callers can supply unknown options; fallback must be visible
    // to developers, bounded across rerenders, and retain URL semantics.
    const warnings = [];
    const originalWarn = console.warn;
    query = { ...query, data: { rows: [{ id: 1, name: 'Mode row' }], count: 100 } };
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        for (const mode of [undefined, 'url', 'local', ' modal']) {
            route++;
            props = { ...base, persistState: false, paramsMode: mode };
            await render();
            assert.equal(seen.at(-1).params.search, mode === 'local' ? undefined : 'initial');
            if (mode === ' modal') {
                assert.equal(warnings.length, 1, 'unknown params mode warns once');
                assert.match(warnings[0], /unknown.*modal.*falling back to.*url/);
            } else {
                assert.equal(warnings.length, 0, 'known and omitted params modes do not warn');
            }
            const initialModeUrl = urlState();
            await click(document.querySelector('[title="Next page"]'));
            assert.equal(seen.at(-1).params.start, 25);
            if (mode === 'local') assert.equal(urlState(), initialModeUrl);
            else assert(urlState().includes('page=2'), 'URL/default/unknown mode writes the URL');
            assert.equal(warnings.length, mode === ' modal' ? 1 : 0, 'rerenders do not repeat the warning');
        }
    } finally {
        console.warn = originalWarn;
    }
    console.log('PASS ModelTable params modes: valid modes unchanged; unknown option warns once and falls back to URL');

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
    // Generic callers have no actor/scope authority to retain rows on errors.
    // TanStack keeps successful data after a denied refresh, so exercise the
    // actual success → 403 → 401 path without clearing its cache ourselves.
    const beforeDeniedActivations = rowActivations;
    for (const status of [403, 401]) {
        responseStatus = status;
        await click(document.querySelector('[title="Refresh"]'));
        await React.act(settle);
        const cached = qc.getQueryCache().getAll().find(query => query.queryKey[0] === '/api/adapter-probe');
        assert.equal(cached.state.status, 'error');
        assert.equal(cached.state.data.rows[0].name, 'Sanitized row', 'fixture retains the old successful query data');
        assert(!document.body.textContent.includes('Sanitized row'), `default ${status} hides the old row`);
        assert.equal(document.querySelectorAll('tr.row-click').length, 0, `default ${status} exposes no activatable row`);
        assert.equal([...document.querySelectorAll('tbody button')].filter(button => button.textContent === 'Nested').length, 0, `default ${status} exposes no nested row action`);
        assert(document.body.textContent.includes('Could not load records'));
        assert(document.body.textContent.includes(`Access denied (${status})`));
        assert.equal(document.querySelectorAll('.form-alert').length, 0, 'retained-data banner belongs only to a controlled adapter');
        await key(document.querySelector('tbody'), 'Enter');
        await key(document.querySelector('tbody'), ' ');
        assert.equal(rowActivations, beforeDeniedActivations, 'error view cannot activate the previous row');
    }
    console.log('PASS ModelTable adapter: hydration, fixed/normalized URL params, one shared render, zero default fetch/cache, keyboard, nested controls, refresh, pager, search, filters, retained errors, scope clearing, default callers, and default success→403→401 row removal');
} finally {
    if (root) await React.act(async () => root.unmount());
    qc.clear();
    await server.close();
    dom.window.close();
}
