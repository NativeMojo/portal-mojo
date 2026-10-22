// Fixture-only transport seam until/after central mock registration. Never records raw bodies.
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
export async function geoHarness() {
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
    for (const name of ['window','document','location','Element','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','HTMLDialogElement','Event','MouseEvent','Node','localStorage','sessionStorage','CustomEvent']) globalThis[name] = dom.window[name];
    Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const fixture = { posts: [], reads: 0, delay: 0, mapReply: null, onSend: null };
    const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{
        name: 'geo-provider-fixture-only', enforce: 'pre',
        transform(source, id) {
            if (!id.endsWith('/src/client/mock.ts')) return;
            return source.replace('export async function mockFetch(path: string, opts: MockFetchOpts): Promise<unknown> {', 'export async function mockFetch(path: string, opts: MockFetchOpts): Promise<unknown> { if (path === "/api/account/admin/settings") return globalThis.__geoProviderFixture(path, opts);');
        },
    }] });
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/geo-provider-mock.ts');
    globalThis.__geoProviderFixture = async (path, opts) => {
        fixture.onSend?.(opts);
        if (opts.method === 'POST') {
            const { GEOIP_API_KEY_MOJO, ...safe } = opts.body.providers.geoip;
            fixture.posts.push({ action: opts.body.action, topic: opts.body.topic, providers: { expected_revision: opts.body.providers.expected_revision, geoip: structuredClone(safe) }, hasReplacement: typeof GEOIP_API_KEY_MOJO === 'string' });
        } else fixture.reads++;
        let result = mock.geoProviderMock(path, opts.method ?? 'GET', opts.body, true);
        if (fixture.mapReply) result = fixture.mapReply(result, opts);
        if (fixture.delay) await new Promise(resolve => setTimeout(resolve, fixture.delay));
        return result;
    };
    const reset = scenario => { mock.setMockGeoProviderScenario(scenario); fixture.posts.length = 0; fixture.reads = 0; fixture.delay = 0; fixture.mapReply = null; fixture.onSend = null; };
    const close = async () => { delete globalThis.__geoProviderFixture; await server.close(); dom.window.close(); };
    return { server, mock, fixture, reset, close };
}
