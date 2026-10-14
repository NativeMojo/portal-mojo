// Mounted regression for Storage → Media rendering (#8200 / #8203): the page and
// its write handler never write without a successful read of the global row.
// Before the fix a failed `GET /api/settings` left Save enabled and Save sent a
// CREATE, duplicating an existing platform-wide override.
// JSDOM deliberately does not claim layout or theme coverage; that stays browser-owned.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://verify.invalid/' });
for (const name of ['window', 'document', 'location', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'MouseEvent', 'Node', 'localStorage', 'sessionStorage']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { act } = React;
const server = await createServer({
    root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true },
    define: { 'import.meta.env.VITE_MOJO_API': JSON.stringify('https://verify.invalid') },
});

const KEY = 'FILEMAN_RENDITIONS_IMAGE';
const category = {
    key: KEY, defaults: { thumbnail: { width: 100, height: 100 } }, automatic_default: ['thumbnail'],
    override: { thumbnail: { width: 150 } }, effective: { roles: { thumbnail: { width: 150, height: 100 } }, automatic: ['thumbnail'] },
    role_kinds: { thumbnail: 'image' }, fields: { image: ['width', 'height'] }, choices: { image: {} }, limits: { width: [1, 4096], height: [1, 4096] },
};
const descriptor = { status: true, data: { categories: { image: category }, engine: { key: 'FILEMAN_VIDEO_ENGINE', effective: 'ffmpeg', choices: ['ffmpeg'] } } };
const existingRow = { id: 41, key: KEY, group: null, is_secret: false, value: category.override };

// One programmable backend: `settingsRead` answers GET /api/settings ('fail' | 'hang' | rows[]).
let calls = [];
let settingsRead = 'fail';
const reply = (status, body) => ({ ok: status < 400, status, headers: new dom.window.Headers({ 'content-type': 'application/json' }), json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (input, opts = {}) => {
    const url = new URL(String(input));
    const method = (opts.method ?? 'GET').toUpperCase();
    calls.push({ path: url.pathname, method, body: opts.body ?? null });
    if (url.pathname === '/api/fileman/renditions/options') return reply(200, descriptor);
    if (url.pathname.startsWith('/api/settings') && method === 'GET') {
        if (settingsRead === 'hang') return new Promise(() => {});
        if (settingsRead === 'fail') return reply(503, { status: false, error: 'settings read unavailable', code: 503 });
        return reply(200, { status: true, data: settingsRead, count: settingsRead.length, start: 0, size: 10 });
    }
    if (url.pathname.startsWith('/api/settings') && method === 'POST') {
        const body = JSON.parse(opts.body ?? '{}');
        return reply(200, { status: true, data: { id: url.pathname.split('/')[3] ? Number(url.pathname.split('/')[3]) : 99, key: KEY, group: null, is_secret: false, value: body.value } });
    }
    return reply(404, { status: false, error: `unexpected ${method} ${url.pathname}`, code: 404 });
};
const posts = () => calls.filter((call) => call.method === 'POST');
const settle = async (rounds = 6) => { for (let i = 0; i < rounds; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 20))); };
const button = (text) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === text);
const typeInto = async (input, value) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
});

const results = [];
const check = async (name, body) => {
    calls = [];
    try { await body(); results.push({ name, ok: true }); console.log(`PASS ${name}`); } catch (error) { results.push({ name, ok: false }); console.log(`FAIL ${name}\n     ${error.message.split('\n')[0]}`); }
};

let root; let queryClient;
const mountPage = async (MediaRenderingPage) => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MediaRenderingPage))));
    await settle();
};
const unmountPage = async () => { if (root) await act(async () => root.unmount()); root = null; queryClient?.clear(); };

try {
    const auth = await server.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
    const token = 'e30.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, user_id: 1 })).toString('base64url') + '.verify';
    auth.setTokens(token);
    const ui = await server.ssrLoadModule('/packages/portal-mojo/src/ui/index.ts');
    const toasts = [];
    for (const tone of ['success', 'info', 'error']) ui.toast[tone] = (message) => toasts.push({ tone, message });
    const { MediaRenderingPage } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/storage/MediaRenderingPage.tsx');
    const settings = await server.ssrLoadModule('/packages/portal-mojo/src/admin/storage/rendition-settings.ts');

    await check('(a) failed row read: alert shown, inputs, Save and Reset disabled, a dispatched Save sends no POST', async () => {
        settingsRead = 'fail';
        await mountPage(MediaRenderingPage);
        try {
            assert.match(document.body.textContent, /current override could not be read/, 'the read error alert is shown');
            const inputs = [...document.querySelectorAll('.media-rendering-panel input')];
            assert(inputs.length > 0, 'the form rendered');
            // Collect every problem so a failing run shows the blind write, not only the first symptom.
            const problems = [];
            if (!inputs.every((input) => input.disabled)) problems.push('inputs are enabled');
            if (button('Save')?.disabled !== true) problems.push('Save is enabled');
            if (button('Reset to defaults…')?.disabled !== true) problems.push('Reset is enabled');
            if (!/could not be read — Save is disabled until it loads/.test(document.querySelector('.media-rendering-actions').textContent)) problems.push('status text does not name the failed read');
            await typeInto(document.querySelector('.media-rendering-panel input[type="number"]'), '200');
            await act(async () => { button('Save').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
            await settle(2);
            if (posts().length) problems.push(`Save sent ${posts().map((call) => `${call.method} ${call.path} ${call.body}`).join('; ')}`);
            assert.deepEqual(problems, [], problems.join('; '));
        } finally { await unmountPage(); }
    });

    await check('(a2) pending row read: Save and Reset disabled with a reading status', async () => {
        settingsRead = 'hang';
        await mountPage(MediaRenderingPage);
        try {
            assert.equal(button('Save')?.disabled, true);
            assert.equal(button('Reset to defaults…')?.disabled, true);
            assert.match(document.querySelector('.media-rendering-actions').textContent, /Reading the current override…/);
        } finally { await unmountPage(); }
    });

    await check('(a3) Retry after a failed read re-enables the form and Save updates the existing row', async () => {
        settingsRead = 'fail';
        await mountPage(MediaRenderingPage);
        try {
            settingsRead = [existingRow];
            await act(async () => { button('Retry').click(); });
            await settle();
            assert.equal(document.querySelector('.media-rendering-panel input[type="number"]').disabled, false, 'inputs enabled once the read succeeds');
            assert.match(document.querySelector('.media-rendering-actions').textContent, /Override row #41/);
            await typeInto(document.querySelector('.media-rendering-panel input[type="number"]'), '200');
            assert.equal(button('Save').disabled, false);
            await act(async () => { button('Save').click(); });
            await settle();
            assert.deepEqual(posts().map((call) => call.path), ['/api/settings/41'], 'Save updates row 41 and creates nothing');
        } finally { await unmountPage(); }
    });

    await check('(b) saveCategoryValue(category, null) with a failed read rejects and sends no POST', async () => {
        settingsRead = 'fail';
        await assert.rejects(settings.saveCategoryValue(category, null, { thumbnail: { width: 200 } }), /could not be read, so nothing was saved/);
        assert.equal(posts().length, 0);
    });

    await check('(c) saveCategoryValue(category, null) with an existing global row rejects naming its id', async () => {
        settingsRead = [existingRow];
        await assert.rejects(settings.saveCategoryValue(category, null, { thumbnail: { width: 200 } }), /already exists \(id 41\)/);
        assert.equal(posts().length, 0);
    });

    await check('(d) saveCategoryValue(category, null) with no row sends exactly one create', async () => {
        settingsRead = [];
        const saved = await settings.saveCategoryValue(category, null, { thumbnail: { width: 200 } });
        assert.equal(saved.id, 99);
        assert.deepEqual(posts().map((call) => [call.path, JSON.parse(call.body)]), [['/api/settings', { key: KEY, is_secret: false, group: null, value: { thumbnail: { width: 200 } } }]]);
    });

    await check('(e) resetCategory(category, null) resolves null and sends nothing', async () => {
        assert.equal(await settings.resetCategory(category, null), null);
        assert.equal(calls.length, 0);
    });
} finally {
    await unmountPage();
    await server.close();
    dom.window.close();
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\nMedia rendering mounted: ${results.length - failed} passed, ${failed} failed, ${results.length} total`);
if (failed) process.exitCode = 1;
