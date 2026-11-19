// React lifecycle and data-boundary regression. The fake renderer deliberately
// makes no visual/WebGL claims; those are verified in a real browser separately.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dir = await mkdtemp(join(tmpdir(), 'mojo-map-test-'));
const fakePath = join(dir, 'engine.mjs');
await writeFile(fakePath, `
export const maps = []; export const popups = [];
export class Map {
 constructor(options) { this.options = options; this.events = {}; this.sources = {}; this.layers = {}; this.removed = false; this.camera = { lng: options.center[0], lat: options.center[1] }; this.zoom = options.zoom; this.fits = 0; this.features = []; this.container = options.container; maps.push(this); }
 on(name, fn) { (this.events[name] ??= new Set()).add(fn); return this; }
 off(name, fn) { this.events[name]?.delete(fn); return this; }
 emit(name, event = {}) { for (const fn of this.events[name] ?? []) fn(event); }
 addControl() {} getCanvas() { return this.container; }
 addSource(id, spec) { this.sources[id] = { spec, updates: [], setData: async (data) => { this.sources[id].updates.push(data); }, setClusterOptions: async () => {}, getClusterExpansionZoom: () => this.expansion ?? Promise.resolve(12) }; }
 getSource(id) { return this.sources[id]; } addLayer(layer) { this.layers[layer.id] = layer; }
 getLayer(id) { return this.layers[id]; } setPaintProperty() {}
 queryRenderedFeatures(_point, options) { return this.features.filter(f => options.layers.includes(f.layer)); }
 fitBounds() { this.fits++; } getCenter() { return this.camera; } getZoom() { return this.zoom; }
 easeTo(options) { this.eased = options; } jumpTo(options) { this.camera = { lng: options.center[0], lat: options.center[1] }; this.zoom = options.zoom; }
 setStyle(style) { this.style = style; this.sources = {}; this.layers = {}; } resize() {} remove() { this.removed = true; }
}
export class NavigationControl {}
export class Marker { constructor(options) { this.el = options.element; } setLngLat(coordinates) { this.coordinates = coordinates; return this; } addTo(map) { map.container.append(this.el); return this; } remove() { this.el.remove(); } getElement() { return this.el; } }
export class Popup {
 constructor() { this.events = {}; popups.push(this); } setLngLat(point) { this.point = point; return this; }
 setDOMContent(node) { this.node = node; return this; } addTo(map) { map.container.append(this.node); return this; }
 on(name, fn) { this.events[name] = fn; return this; } off(name) { delete this.events[name]; return this; }
 remove() { this.node.remove(); this.events.close?.(); }
}
`);
const dom = new JSDOM('<div id="root"></div>', { url: 'https://map-test.invalid' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver']) globalThis[name] = dom.window[name];
globalThis.getComputedStyle = dom.window.getComputedStyle;
const observers = [];
globalThis.ResizeObserver = class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', resolve: { alias: [{ find: /^maplibre-gl$/, replacement: fakePath }] }, server: { middlewareMode: true } });
let root;
try {
    const { validMapMarkers, markersToGeoJSON, markerBounds } = await server.ssrLoadModule('/packages/portal-mojo/src/maps/markers.ts');
    const zero = { id: 'zero', longitude: 0, latitude: 0, label: '<img src=x onerror=alert(1)>', data: { token: 'PRIVATE' } };
    const far = { id: 'far', longitude: 100, latitude: 20, label: 'Far' };
    assert.deepEqual(validMapMarkers([zero, zero, { ...zero, id: 'bad', latitude: NaN }, { ...zero, id: 'range', longitude: 181 }, { ...zero, id: '' }]), [zero]);
    const json = markersToGeoJSON([zero]);
    assert.deepEqual(json.features[0].geometry.coordinates, [0, 0]);
    assert(!JSON.stringify(json).includes('PRIVATE') && !JSON.stringify(json).includes('<img'));
    assert.deepEqual(markerBounds([{ ...zero, longitude: 179 }, { ...far, longitude: -179 }]), [[179, 0], [181, 20]]);
    assert.equal(markerBounds([]), null);
    console.log('PASS valid coordinates, zero coordinates, duplicate IDs and worker privacy');
    const { MapLibreMap } = await server.ssrLoadModule('/packages/portal-mojo/src/maps/MapLibreMap.tsx');
    const engine = await server.ssrLoadModule(fakePath);
    const style = { version: 8, sources: {}, layers: [] };
    const choices = []; const errors = [];
    let props = { mapStyle: style, markers: [zero, far], onSelectionChange: (id) => choices.push(id), onError: (error) => errors.push(error) };
    root = createRoot(document.getElementById('root'));
    const render = async () => React.act(async () => root.render(React.createElement(MapLibreMap, props)));
    const emit = async (map, event, value) => React.act(async () => map.emit(event, value));
    await render();
    const map = engine.maps.at(-1);
    await emit(map, 'style.load');
    assert.equal(map.fits, 1);
    const picker = document.querySelector('select');
    await React.act(async () => { picker.value = 'zero'; picker.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(choices.at(-1), 'zero');
    assert(document.body.textContent.includes(zero.label));
    assert.equal(document.querySelector('img'), null, 'popup labels are React-escaped');
    const popup = engine.popups.at(-1);
    props = { ...props, markers: [{ ...zero, label: 'Updated', tone: 'ok' }, far] };
    await render();
    assert(document.body.textContent.includes('Updated'));
    assert.equal(engine.popups.at(-1), popup, 'status/label update retains popup');
    assert.equal(engine.maps.length, 1, 'live updates retain engine');
    assert.equal(map.fits, 1, 'live updates retain camera');
    assert.equal(map.getSource('mojo-markers').updates.at(-1).features[0].properties.tone, 'ok');
    props = { ...props, markers: [far] }; await render();
    assert.equal(choices.at(-1), null); assert(!document.body.contains(popup.node));
    console.log('PASS live source updates preserve camera and selection; safe popup updates/closes on removal');
    map.features = [{ layer: 'mojo-clusters', geometry: { type: 'Point', coordinates: [100, 20] }, properties: { cluster_id: 1, point_count: 4 } }];
    await emit(map, 'render');
    const cluster = document.querySelector('.mojo-map-cluster');
    assert.equal(cluster.textContent, '4');
    map.features[0].properties.point_count = 5; await emit(map, 'render');
    assert.equal(cluster.textContent, '5');
    let resolveZoom; map.expansion = new Promise((resolve) => { resolveZoom = resolve; });
    cluster.click(); props = { ...props, markers: [] }; await render();
    await React.act(async () => resolveZoom(12));
    assert.equal(map.eased.zoom, 13, 'stale expansion did not overwrite the picker camera');
    assert(document.body.textContent.includes('No locations to show'));
    console.log('PASS cluster count updates, stale async expansion and empty state');
    props = { ...props, mapStyle: { ...style }, markers: [far] }; await render();
    await emit(map, 'style.load');
    assert.equal(engine.maps.length, 1); assert(map.getSource('mojo-markers'));
    await emit(map, 'error', { error: new Error('tile provider unavailable') });
    assert(document.querySelector('[role="alert"]')); assert.equal(errors.length, 1);
    assert.equal(document.querySelector('select').disabled, false);
    await React.act(async () => root.unmount()); root = null;
    assert(map.removed && observers.every((observer) => observer.disconnected));
    assert.equal(document.querySelector('.mojo-map-cluster'), null);
    console.log('PASS style replacement, resource failure fallback and complete unmount disposal');
    root = createRoot(document.getElementById('root'));
    await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(MapLibreMap, props))));
    const strictMaps = engine.maps.slice(1);
    assert.equal(strictMaps.length, 2); assert.equal(strictMaps[0].removed, true);
    await React.act(async () => root.unmount()); root = null;
    assert(strictMaps.every((item) => item.removed));
    console.log('PASS StrictMode remount removes the discarded engine');
} finally {
    if (root) await React.act(async () => root.unmount());
    await server.close(); await rm(dir, { recursive: true, force: true });
}
