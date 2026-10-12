// Shared MetricsChartView contracts; mounted components, not source-text substitutes.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'HTMLSelectElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'Node']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const root = createRoot(document.getElementById('root'));
const e = React.createElement;
const click = async (name) => React.act(async () => {
    const button = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === name || b.textContent.trim() === name);
    assert(button, `button ${name} exists`); assert(!button.disabled, `${name} enabled`); button.click();
});
const text = () => document.body.textContent;
const drain = () => React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const originalNow = Date.now;
let qc;
try {
    const { MetricsChartView } = await server.ssrLoadModule('/packages/portal-mojo/src/charts/MetricsChartView.tsx');
    const { MetricsChart } = await server.ssrLoadModule('/packages/portal-mojo/src/charts/MetricsChart.tsx');
    const { modal, ModalHost } = await server.ssrLoadModule('/packages/portal-mojo/src/ui/modal.tsx');
    const { computeSeriesStats, buildCsv, defaultStatFormat } = await server.ssrLoadModule('/packages/portal-mojo/src/charts/stats.ts');
    const { QUICK_RANGES, metricsQuickWindow } = await server.ssrLoadModule('/packages/portal-mojo/src/charts/metrics-window.ts');
    const baseWindow = metricsQuickWindow('1h', 'minutes');
    const stats = computeSeriesStats([{ label: 'Sparse', data: [0, null, 10, undefined, NaN, Infinity] }, { label: 'Absent', data: [null] }]);
    assert.equal(stats[0].count, 2); assert.equal(stats[0].sum, 10); assert.equal(stats[0].avg, 5); assert.equal(stats[0].median, 5); assert.equal(stats[0].min, 0);
    assert.ok(Number.isNaN(stats[0].latest)); assert.ok(Number.isNaN(stats[1].sum)); assert.equal(stats[1].count, 0);
    assert.equal(defaultStatFormat(Infinity), '–');
    assert.equal(buildCsv(['Label', '=Formula'], [['A', null], ['B', 0], ['C', -2]]), "Label,'=Formula\nA,\nB,0\nC,-2");

    // No QueryClientProvider: the shared view cannot accidentally rely on Query.
    let changes = [], refreshes = 0, inspections = [];
    let owner = new AbortController();
    const initial = {
        title: 'Private resource', window: baseWindow, onWindowChange: (next) => changes.push(next), onRefresh: () => refreshes++,
        signal: owner.signal, labels: ['Outside', 'Start', 'Missing', 'End'],
        datasets: [{ label: 'CPU', data: [999, 0, null, 10] }, { label: 'Absent', data: [999, null, null, null] }],
        xValues: [0, 10, 20, 90], xDomain: [5, 100], maxGap: 30, minValue: 0, maxValue: 100,
        valueFormatter: (value) => { assert(Number.isFinite(value), 'unavailable never reaches caller formatters'); return `${value}%`; },
        onInspect: (index) => inspections.push(index), smoothing: 0,
        allowedRanges: QUICK_RANGES.filter((r) => r.value !== '30d'), allowedGranularities: ['minutes', 'hours', 'days'],
    };
    let current = initial;
    const mount = async (props = current, host = true) => { current = props; await React.act(async () => root.render(e(React.StrictMode, null, e(MetricsChartView, props), host && e(ModalHost)))); };
    await mount();
    assert(!text().includes('30D')); assert(!text().includes('WK')); assert(!text().includes('MO'));
    assert.equal(document.querySelectorAll('.series-dot').length, 2);
    assert.equal(document.querySelectorAll('.series-line').length, 0, 'missing/gap values remain separate');
    await React.act(async () => document.querySelector('svg').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' })));
    assert.equal(inspections.at(-1), 3, 'original sample index survives presentation');
    await click('Bar (stacked)'); assert.equal(document.querySelectorAll('.bar').length, 2);
    await click('Area'); assert.equal(document.querySelectorAll('.bar').length, 0);
    await click('Refresh'); assert.equal(refreshes, 1); assert.equal(changes.length, 0, 'refresh is owned externally');
    await click('7D'); assert.equal(changes.at(-1).range, '7d'); assert.equal(changes.at(-1).granularity, 'days');
    assert.equal(changes.at(-1).dt_end - changes.at(-1).dt_start, 7 * 86400);
    assert.equal(document.querySelector('[aria-label="Date range"] .seg-active').textContent, '1H', 'window stays controlled until props update');
    await mount({ ...current, window: changes.at(-1) });
    await click('HR'); assert.equal(changes.at(-1).granularity, 'hours');

    await click('Stats');
    assert.equal(document.querySelectorAll('dialog').length, 1);
    const statRows = [...document.querySelectorAll('.chart-stats-table tbody tr')].map((r) => [...r.cells].map((c) => c.textContent));
    assert.deepEqual(statRows[0], ['CPU', '2', '10%', '0%', '10%', '5%', '5%', '10%']);
    assert.deepEqual(statRows[1], ['Absent', '0', ...Array(6).fill('Unavailable')]);
    assert.doesNotMatch(text(), /NaN|Infinity|999/);
    await click('Close');
    let downloaded;
    const savedCreate = URL.createObjectURL, savedRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (blob) => { downloaded = blob; return 'blob:test'; }; URL.revokeObjectURL = () => {};
    const anchorClick = dom.window.HTMLAnchorElement.prototype.click; dom.window.HTMLAnchorElement.prototype.click = () => {};
    await click('View data');
    assert.match(document.querySelector('.chart-data-table').textContent, /MissingUnavailableUnavailable/);
    await click('Download CSV');
    assert.equal(await downloaded.text(), 'Label,CPU,Absent\nStart,0,\nMissing,,\nEnd,10,');
    URL.createObjectURL = savedCreate; URL.revokeObjectURL = savedRevoke; dom.window.HTMLAnchorElement.prototype.click = anchorClick;
    await mount({ ...current, datasets: [{ label: 'Replacement', data: [] }], labels: [] });
    assert.equal(document.querySelectorAll('dialog').length, 0, 'payload expiry closes captured data');
    await mount(initial); await click('Stats');
    await mount({ ...initial, datasets: initial.datasets.map((d) => ({ ...d, data: [...d.data] })), labels: [...initial.labels] });
    assert.equal(document.querySelectorAll('dialog').length, 1, 'equivalent re-render keeps dialog');
    await React.act(async () => owner.abort());
    assert.equal(document.querySelectorAll('dialog').length, 0); assert.doesNotMatch(text(), /Private resource|CPU|Replacement/, 'abort clears chart and captured data');
    await mount(initial); assert.equal(document.querySelector('.chart-panel'), null, 'an already-aborted signal cannot resurrect data');

    owner = new AbortController();
    await mount({ ...initial, signal: owner.signal }); await click('Custom date range');
    await React.act(async () => owner.abort()); assert.equal(document.querySelectorAll('dialog').length, 0, 'range abort removes pending form');
    owner = new AbortController(); await mount({ ...initial, signal: owner.signal }); await click('View data');
    await React.act(async () => root.render(e(ModalHost))); assert.equal(document.querySelectorAll('dialog').length, 0, 'unmount removes owned dialog');

    // Retention filters quick presets and day presets, and clamps partial days.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const minDate = today.getTime() / 1000 + 12 * 3600;
    const maxDate = minDate + 2 * 3600;
    await mount({ ...initial, signal: new AbortController().signal, minDate, maxDate, window: { dt_start: minDate, dt_end: maxDate, granularity: 'minutes' } });
    assert(!text().includes('24H')); assert(!text().includes('7D'));
    await click('Custom date range');
    assert(!text().includes('Last 30 days')); assert(!text().includes('This year'));
    await click('Today'); await click('Apply');
    assert.equal(changes.at(-1).dt_start, minDate); assert.equal(changes.at(-1).dt_end, maxDate); assert.equal(changes.at(-1).range, undefined);
    await mount({ ...initial, signal: new AbortController().signal, loading: true });
    assert(document.querySelector('.chart-overlay')); assert(!document.querySelector('svg'));
    await mount({ ...current, loading: false, error: new Error('Snapshot failed') });
    assert.match(text(), /Snapshot failed/); await click('Retry'); assert.equal(refreshes, 2);
    await mount({ ...initial, signal: new AbortController().signal, allowedGranularities: [] });
    assert.equal(document.querySelectorAll('.gran-toggle button').length, 0, 'explicit empty capabilities do not fall back to unsupported values');

    await mount({ ...initial, signal: new AbortController().signal, showGranularity: false, content: e('table', null, e('tbody', null, e('tr', null, e('td', null, 'Owned usage report')))) });
    assert.match(text(), /Owned usage report/); assert(!document.querySelector('svg'), 'content replaces only the plot');
    await click('Stats'); assert.equal(document.querySelector('.chart-dialog-sub').textContent, '3 points', 'raw observations claim no bucket noun');
    await click('Close');
    await mount({ ...current, loading: true }); assert(!text().includes('Owned usage report'), 'loading covers owner report');

    // Stack ownership works even if a body has never been rendered by a host.
    await React.act(async () => root.render(null));
    const beforeHost = new AbortController();
    const pending = modal.open(() => e('div', null, 'Never show private body'), { signal: beforeHost.signal });
    beforeHost.abort(); beforeHost.abort(); assert.equal(await pending, null);
    await React.act(async () => root.render(e(ModalHost))); assert(!text().includes('Never show private body'));
    const preAborted = new AbortController(); preAborted.abort();
    assert.equal(await modal.open(() => e('div', null, 'Already expired'), { signal: preAborted.signal }), null);
    assert(!text().includes('Already expired'));
    let closeDialog;
    const afterClose = new AbortController(); let settlements = 0;
    let repeated;
    await React.act(async () => { repeated = modal.open((close) => { closeDialog = close; return e('div', null, 'Normal close'); }, { signal: afterClose.signal }).then(() => settlements++); });
    await drain(); await React.act(async () => { closeDialog('ok'); closeDialog('again'); afterClose.abort(); }); await repeated;
    assert.equal(settlements, 1); assert.equal(document.querySelectorAll('dialog').length, 0);

    // Legacy query adapter: its shared controls retain exact loader identity and one-request refreshes.
    Date.now = () => 1_800_000_000_000;
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    const requests = [];
    const loader = async (wire) => { requests.push(wire); return { labels: ['A', 'B'], datasets: [{ label: 'raw_metric', data: [1, 2] }] }; };
    const legacy = (refreshSignal) => e(QueryClientProvider, { client: qc }, e(MetricsChart, { title: 'Legacy widget', slugs: ['raw_metric'], loadSeries: loader, seriesCacheKey: 'legacy-test', refreshSignal }), e(ModalHost));
    await React.act(async () => root.render(legacy(0))); await drain(); assert.equal(requests.length, 1); assert.match(text(), /Raw Metric/);
    await click('Refresh'); await drain(); assert.equal(requests.length, 2, 'same-second refresh still requests once');
    Date.now = () => 1_800_000_010_000;
    await click('Refresh'); await drain(); assert.equal(requests.length, 3, 'new quick window fetches once'); assert.equal(requests.at(-1).dt_end, 1_800_000_010);
    await React.act(async () => root.render(legacy(1))); await drain(); assert.equal(requests.length, 4, 'parent refresh signal requests once');
    await click('Custom date range'); await click('Today'); await click('Apply'); await drain(); assert.equal(requests.length, 5); assert.equal(requests.at(-1).range, undefined);
    await click('Refresh'); await drain(); assert.equal(requests.length, 6, 'custom window refresh requests once');
    console.log('MetricsChart shared-view regression passed: controlled controls, retained request counts, sparse math/CSV/domain, bounded dates, abort/unmount/replacement and pre-host modal disposal.');
} finally {
    Date.now = originalNow;
    await React.act(async () => root.unmount()); qc?.clear(); await server.close(); dom.window.close();
}
