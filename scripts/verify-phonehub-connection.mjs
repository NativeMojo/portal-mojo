import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Event', 'Node', 'localStorage', 'sessionStorage']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const fixture = globalThis.__phoneConnection = { reply: {}, writes: [] };
const runtime = `export * from '/packages/portal-mojo/src/client/runtime.ts'; export const useCan=()=>({can:true,me:{id:1}}); export const mojoList=async()=>({rows:[]}); export const mojoCall=async(path,opts)=>{globalThis.__phoneConnection.writes.push({path,body:{...opts.body}});return globalThis.__phoneConnection.reply;};`;
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{
    name: 'phone-connection-fixture', enforce: 'pre',
    resolveId: id => id === '/__phone_runtime.ts' ? id : null,
    load: id => id === '/__phone_runtime.ts' ? runtime : null,
    transform(source, id) {
        if (!id.includes('/admin/phonehub/')) return;
        source = source.replace("from '../../client/runtime'", "from '/__phone_runtime.ts'");
        if (id.endsWith('/PhoneHubPage.tsx')) source += '\nexport { ConfigEditor, ConfigDetail };';
        return source;
    },
}] });
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
qc.invalidateQueries = async () => {};
const root = createRoot(document.getElementById('root'));
try {
    const api = await server.ssrLoadModule('/packages/portal-mojo/src/admin/phonehub/api.ts');
    for (const wrapped of [false, true]) {
        const data = { success: false, message: 'Mojo provider requires mojo_remote_url and mojo_api_key', error: 'missing_credentials' };
        fixture.reply = wrapped ? { status: true, data } : { status: true, ...data };
        assert.equal((await api.testPhoneConfigImperative(7)).status, false, 'A provider failure is not a successful connection, even with a successful REST envelope');
    }
    fixture.reply = { status: true, data: { success: true, message: 'Key verified' } };
    assert.equal((await api.testPhoneConfigImperative(7)).status, true);
    fixture.reply = { status: true, data: { id: 7 } };
    assert.equal((await api.testPhoneConfigImperative(7)).status, false, 'Missing verdict must not imply success');
    fixture.reply = { status: true, data: { success: true, test_mode: true, message: 'Provider not tested' } };
    assert.equal((await api.testPhoneConfigImperative(7)).testMode, true);

    const { ConfigEditor, ConfigDetail } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/phonehub/PhoneHubPage.tsx');
    const { toast } = await server.ssrLoadModule('/packages/portal-mojo/src/ui/toast.tsx');
    toast.success = () => {};
    const row = { id: 7, name: 'Mojo Remote SMS', provider: 'mojo', group: null, is_active: true, mojo_remote_url: 'https://api.mojoverify.com', lookup_enabled: true, lookup_cache_days: 90, test_mode: false };
    fixture.reply = { status: true, data: row };
    let saved;
    await React.act(async () => root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(React.StrictMode, null, React.createElement(ConfigEditor, { row, close: value => { saved = value; } })))));
    const key = document.querySelector('#phonehub-mojo_api_key');
    await React.act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(key, 'fake-local-fixture-key');
        key.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await React.act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Save configuration').click());
    const write = fixture.writes.at(-1);
    assert.equal(write.path, '/api/phonehub/config/7');
    assert.equal(write.body.mojo_api_key, 'fake-local-fixture-key', 'Editor must send entered credentials');
    assert.equal(write.body.group, null);
    assert.equal(write.body.mojo_remote_url, row.mojo_remote_url);
    assert.equal(saved.id, 7);
    assert.equal(key.value, '', 'Saved secret must leave the input');
    assert(!JSON.stringify(qc.getQueryCache().getAll()).includes('fake-local-fixture-key'));
    assert.equal(qc.getMutationCache().getAll().length, 0);
    const { PhoneConfigModel } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/phonehub/models.ts');
    PhoneConfigModel.useOne = () => ({ data: row, refetch: async () => {} });
    let finishTest;
    fixture.reply = new Promise(resolve => { finishTest = resolve; });
    await React.act(async () => root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(ConfigDetail, { id: 7, onClose() {} }))));
    const clickMenu = async label => {
        await React.act(async () => document.querySelector('[aria-label="More actions"]').click());
        await React.act(async () => [...document.querySelectorAll('[role="menuitem"]')].find(button => button.textContent.trim() === label).click());
    };
    await clickMenu('Test stored connection');
    await React.act(async () => document.querySelector('[aria-label="More actions"]').click());
    assert.equal([...document.querySelectorAll('[role="menuitem"]')].find(button => button.textContent.trim() === 'Edit configuration').disabled, true, 'Credentials cannot be edited while their test is pending');
    await React.act(async () => finishTest({ status: true, data: { success: true, message: 'Key verified' } }));
    assert.match(document.body.textContent, /Connection test: Passed/);
    console.log('Phone Hub: exact provider verdicts, test mode, mounted credential submission and cache isolation passed.');
} finally {
    await React.act(async () => root.unmount());
    qc.clear();
    await server.close();
    dom.window.close();
    delete globalThis.__phoneConnection;
}
