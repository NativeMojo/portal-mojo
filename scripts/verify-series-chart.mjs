// Mounted SVG contracts: sparse samples, numeric X, bounded axes and inspection.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'HTMLElement', 'SVGElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'Node']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let resize;
let disconnected = false;
globalThis.ResizeObserver = class {
    constructor(callback) { resize = callback; }
    observe() {}
    disconnect() { disconnected = true; }
};
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const root = createRoot(document.getElementById('root'));
const svg = () => document.querySelector('.series-svg');
const dots = () => [...document.querySelectorAll('.series-dot')];
const paths = () => [...document.querySelectorAll('.series-line')];
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.001, `${message}: ${actual} ≠ ${expected}`);
const key = async (value) => React.act(async () => svg().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value })));
const pointer = async (type, x, pointerType = 'mouse') => React.act(async () => {
    const hit = svg().querySelector('[fill="transparent"]');
    hit.getBoundingClientRect = () => ({ left: 48, top: 10, width: Number(hit.getAttribute('width')), height: 224 });
    const event = new MouseEvent(type, { bubbles: true, clientX: x });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    hit.dispatchEvent(event);
});
const finiteGeometry = () => {
    for (const node of svg().querySelectorAll('*')) {
        for (const attr of ['d', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'width', 'height']) {
            assert.doesNotMatch(node.getAttribute(attr) ?? '', /NaN|Infinity|undefined|null/, `${node.tagName}.${attr} is finite`);
        }
    }
};
try {
    const { SeriesChart } = await server.ssrLoadModule('/packages/portal-mojo/src/charts/SeriesChart.tsx');
    const mount = async (props) => React.act(async () => root.render(React.createElement(SeriesChart, props)));
    const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    const sparse = { labels, datasets: [{ label: 'CPU', data: [10, 20, null, 30, 40, NaN, Infinity, undefined, 50] }], smoothing: 0 };
    await mount(sparse);
    assert.equal(paths().length, 2, 'missing samples split lines into finite runs; a singleton is a dot');
    assert.equal(dots().length, 5, 'missing samples never render zero-valued dots');
    finiteGeometry();
    await mount({ ...sparse, chartType: 'area' });
    assert.equal(svg().querySelectorAll('path[opacity="0.16"]').length, 2, 'area fill closes each finite run independently');
    assert.ok([...svg().querySelectorAll('path[opacity="0.16"]')].every((p) => /^M.*Z$/.test(p.getAttribute('d'))));

    const inspections = [];
    const timed = {
        labels: ['00:10', '00:20', '01:30', '01:40'],
        datasets: [{ label: 'CPU', data: [10, 20, null, 40] }, { label: 'Memory', data: [20, 40, 60, 80] }],
        xValues: [10, 20, 90, 100], xDomain: [0, 120], maxGap: 30,
        minValue: 0, maxValue: 100, smoothing: 0, ariaLabel: 'Kiosk resource history',
        valueFormatter: (v) => `${v}%`, onInspect: (index) => inspections.push(index),
    };
    await mount(timed);
    assert.equal(inspections[0], null, 'mount communicates that no sample is inspected');
    close(Number(dots()[0].getAttribute('cx')), 48 + 538 / 12, 'explicit domain retains leading empty time');
    close(Number(dots()[1].getAttribute('cx')) - Number(dots()[0].getAttribute('cx')), 538 / 12, 'time separation controls X geometry');
    assert.equal(paths().length, 3, 'maxGap breaks otherwise finite runs');
    assert.deepEqual([...svg().querySelectorAll('text[text-anchor="end"]')].map((n) => n.textContent), ['0%', '20%', '40%', '60%', '80%', '100%'], 'explicit bounds are exact');
    assert.equal(svg().getAttribute('aria-label'), timed.ariaLabel);
    assert.equal(svg().getAttribute('tabindex'), '0');
    await key('Home');
    assert.equal(inspections.at(-1), 0);
    await key('ArrowRight');
    assert.equal(inspections.at(-1), 1);
    await key('ArrowRight');
    assert.match(document.querySelector('[role="status"]').textContent, /01:30.*CPU: Unavailable.*Memory: 60%/);
    assert.equal(document.querySelectorAll('.series-inspect-dot').length, 1, 'missing sample has no ghost dot');
    assert.match(document.querySelector('.chart-tip').textContent, /Unavailable/);
    await key('End');
    assert.equal(inspections.at(-1), 3);
    await key('ArrowLeft');
    assert.equal(inspections.at(-1), 2);
    await key('Escape');
    assert.equal(inspections.at(-1), null);
    await pointer('pointermove', 48 + 538 * 0.18);
    assert.equal(inspections.at(-1), 1, 'pointer snaps to nearest timestamp, not categorical index');
    await pointer('pointerdown', 48 + 538 * 0.82, 'touch');
    assert.equal(inspections.at(-1), 3, 'touch selects a timestamp through the shared hit area');
    await React.act(async () => resize([{ contentRect: { width: 320 } }]));
    assert.equal(svg().getAttribute('width'), '320');
    close(Number(dots()[0].getAttribute('cx')), 48 + 258 / 12, 'resize recomputes real timestamp positions');
    finiteGeometry();
    await mount({ ...timed, xDomain: [0, 60] });
    assert.equal(document.querySelector('.chart-tip'), null, 'changed domain clears old inspection');
    assert.equal(inspections.at(-1), null);

    await mount(timed);
    await key('Home');
    const beforeEquivalent = inspections.length;
    await mount({ ...timed, labels: [...timed.labels], datasets: timed.datasets.map((ds) => ({ ...ds, data: [...ds.data] })) });
    assert.equal(inspections.length, beforeEquivalent, 'equivalent props keep inspection without duplicate callbacks');
    await mount({ ...timed, datasets: [{ label: 'CPU', data: [11, 20, null, 40] }, timed.datasets[1]] });
    assert.equal(inspections.at(-1), null, 'corrected values clear internal and external inspection together');
    assert.equal(document.querySelector('.chart-tip'), null);

    await mount({ labels: Array.from({ length: 80 }, (_, i) => String(i)), datasets: [{ label: 'Sparse', data: Array.from({ length: 80 }, (_, i) => i === 50 ? 5 : null) }], showDots: false });
    assert.equal(dots().length, 1, 'isolated evidence remains visible in long series with routine dots off');
    assert.equal(paths().length, 0);

    await mount({ labels: ['Missing', 'Still missing'], datasets: [{ label: 'Disk', data: [null, undefined] }], onInspect: timed.onInspect });
    assert.ok(svg(), 'all-missing history keeps a keyboard-inspectable chart');
    await key('End');
    assert.match(document.querySelector('[role="status"]').textContent, /Still missing.*Disk: Unavailable/);
    assert.equal(dots().length, 0);
    assert.equal(document.querySelectorAll('.series-inspect-dot').length, 0);
    finiteGeometry();

    await mount({ labels: ['A', 'B'], datasets: [{ label: 'One', data: [2, -3] }, { label: 'Two', data: [4, -2] }], chartType: 'bar' });
    const bars = [...svg().querySelectorAll('.bar')];
    assert.equal(bars.length, 4);
    assert.equal(bars[0].getAttribute('x'), bars[1].getAttribute('x'), 'default bars stack at the same category');
    close(Number(bars[1].getAttribute('y')) + Number(bars[1].getAttribute('height')), Number(bars[0].getAttribute('y')), 'positive stack joins at preceding top');
    close(Number(bars[2].getAttribute('y')) + Number(bars[2].getAttribute('height')), Number(bars[3].getAttribute('y')), 'negative stack joins at preceding bottom');
    await mount({ labels: ['A', 'B'], datasets: [{ label: 'One', data: [2, -3] }, { label: 'Two', data: [4, -2] }], chartType: 'bar', stacked: false });
    assert.notEqual(svg().querySelectorAll('.bar')[0].getAttribute('x'), svg().querySelectorAll('.bar')[1].getAttribute('x'), 'grouped bars remain side by side');
    await mount({ labels: ['A'], datasets: [{ label: 'One', data: [null] }, { label: 'Two', data: [4] }], chartType: 'bar' });
    assert.equal(svg().querySelectorAll('.bar').length, 1, 'missing bars are absent');
    await key('Home');
    assert.equal(document.querySelector('.chart-tip-total .chart-tip-val').textContent, 'Unavailable', 'a partial stack must not claim a complete total');
    finiteGeometry();
    await React.act(async () => [...document.querySelectorAll('.legend-item')].forEach((b) => b.click()));
    assert.equal(svg().querySelectorAll('.bar').length, 0, 'all series can be hidden without invalid scale geometry');
    finiteGeometry();

    await mount({ labels: ['A', 'B', 'C', 'D'], datasets: [{ label: 'Value', data: [1, 2, 3, 1e100] }], xValues: [10, NaN, 20, 100], xDomain: [0, 30] });
    assert.equal(dots().length, 2, 'invalid and out-of-domain X values are omitted');
    assert.equal(paths().length, 0, 'an invalid timestamp breaks a run');
    assert.ok(![...svg().querySelectorAll('text[text-anchor="end"]')].some((n) => n.textContent.includes('e+')), 'out-of-domain values do not distort visible scale');
    finiteGeometry();
    console.log('SeriesChart mounted regression: sparse line/area/bar data, finite geometry, timestamp domains/gaps, bounds, categorical stacks/groups, keyboard/pointer/touch inspection and resize passed.');
} finally {
    await React.act(async () => root.unmount());
    assert.ok(disconnected, 'ResizeObserver disconnects on unmount');
    await server.close();
    dom.window.close();
}
