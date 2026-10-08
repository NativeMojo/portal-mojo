// Mounted Edge dialogs under a held write (#1616). A declare, save or delete
// that is still in flight must not be dismissable with Escape or the backdrop,
// and save and delete share one pending state. JSDOM has no native <dialog>,
// so showModal/close are stubbed and Escape is the dialog's `cancel` event.
// EDGE_DIALOG_REGRESSION_REF=<commit> loads the two pages from that commit.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'Event', 'MouseEvent', 'CustomEvent', 'Node']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
dom.window.HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
dom.window.HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { act } = React;

// Every write is held until the test releases it.
const held = [];
const fixture = globalThis.__edge1616 = { hold: (kind, args) => new Promise((resolve, reject) => held.push({ kind, args, resolve, reject })) };
const virtual = {
    '/__1616_api.ts': `export * from '/packages/portal-mojo/src/admin/edge/api.ts'; export const declareUpstream = (input) => globalThis.__edge1616.hold('declare', input);`,
    '/__1616_runtime.ts': `export * from '/packages/portal-mojo/src/client/runtime.ts'; export const withFreshAuth = (work) => work(); export const mojoSave = (...args) => globalThis.__edge1616.hold('save', args); export const mojoDelete = (...args) => globalThis.__edge1616.hold('delete', args);`,
    '/__1616_ui.ts': `export * from '/packages/portal-mojo/src/ui/index.ts'; export const CollectionSelect = () => null;`,
};
const pages = ['/admin/edge/UpstreamsPage.tsx', '/admin/edge/BlocklistPage.tsx'];
const server = await createServer({
    root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true },
    plugins: [{
        name: 'edge-dialog-fixtures', enforce: 'pre',
        resolveId: (id) => (id in virtual ? id : null),
        load: (id) => virtual[id] ?? null,
        transform(source, id) {
            if (!pages.some((path) => id.endsWith(path))) return undefined;
            const text = process.env.EDGE_DIALOG_REGRESSION_REF
                ? execFileSync('git', ['show', `${process.env.EDGE_DIALOG_REGRESSION_REF}:${id.replace(`${process.cwd()}/`, '')}`], { encoding: 'utf8' })
                : source;
            return text.replace("from './api'", "from '/__1616_api.ts'").replace("from '../../client/runtime'", "from '/__1616_runtime.ts'").replace("from '../../ui'", "from '/__1616_ui.ts'");
        },
    }],
});

const dialog = () => document.querySelector('dialog');
const button = (name) => [...document.querySelectorAll('dialog button')].find((node) => node.textContent.trim() === name);
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const type = (input, value) => act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
});
const escape = () => act(async () => { dialog()?.dispatchEvent(new Event('cancel', { cancelable: true })); });
const backdrop = () => act(async () => { dialog()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
const release = async (value, reject = false) => {
    const write = held.shift();
    assert(write, 'a write is in flight');
    await act(async () => { write[reject ? 'reject' : 'resolve'](value); });
    await settle();
    return write;
};
// A dismissal resolves the opener's promise; a refused one leaves it pending.
const track = (promise) => { const state = { done: false, value: undefined }; void promise.then((value) => { state.done = true; state.value = value; }); return state; };
const refusedDismissals = async (state, what) => {
    await escape();
    await backdrop();
    await settle();
    assert(dialog(), `${what}: Escape and the backdrop leave the dialog open`);
    assert.equal(state.done, false, `${what}: and do not report a cancellation`);
};

let root;
try {
    const ui = await server.ssrLoadModule('/packages/portal-mojo/src/ui/index.ts');
    const toasts = [];
    ui.toast.success = (message) => toasts.push(message);
    ui.toast.error = (message) => toasts.push(message);
    const upstreams = await server.ssrLoadModule('/packages/portal-mojo/src/admin/edge/UpstreamsPage.tsx');
    const blocklist = await server.ssrLoadModule('/packages/portal-mojo/src/admin/edge/BlocklistPage.tsx');
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(ui.ModalHost))));

    // ── Declare upstream ──
    let opened;
    await act(async () => { opened = track(upstreams.openDeclareUpstream()); });
    const fields = () => [...document.querySelectorAll('dialog input')];
    await type(fields()[0], 'orders-api');
    await type(fields()[1], '10.0.4.12');
    await type(fields()[2], '8080');
    await act(async () => button('Declare upstream').click());
    await settle();
    assert.equal(held.length, 1, 'the declare is in flight');
    assert.deepEqual(held[0].args, { name: 'orders-api', kind: 'http', host: '10.0.4.12', port: 8080, group: null });
    assert.equal(button('Declaring…').disabled, true);
    assert.equal(button('Cancel').disabled, true);
    await refusedDismissals(opened, 'declare in flight');
    await release(new Error('upstream name must be lowercase'), true);
    assert.equal(document.querySelector('dialog .form-alert')?.textContent, 'upstream name must be lowercase', 'a refusal is shown in the dialog');
    assert.equal(opened.done, false);
    await act(async () => button('Declare upstream').click());
    await settle();
    await refusedDismissals(opened, 'declare retried');
    await release({ id: 8699, name: 'orders-api' });
    assert.deepEqual([opened.done, opened.value?.id, dialog()], [true, 8699, null], 'the finished declare closes the dialog with the stored row');
    // Idle again, Escape closes and reports a cancellation.
    await act(async () => { opened = track(upstreams.openDeclareUpstream()); });
    await escape();
    await settle();
    assert.deepEqual([opened.done, opened.value, dialog()], [true, null, null], 'an idle dialog still closes on Escape');

    // ── Blocklist entry: save ──
    const row = { id: 8801, kind: 'ip', value: '203.0.113.0/24', mode: 'log', note: '', created: 1, modified: 1 };
    await act(async () => { opened = track(blocklist.openBlocklistEditor(row)); });
    await act(async () => button('Save').click());
    await settle();
    assert.equal(held.length, 1, 'the save is in flight');
    assert.equal(held[0].kind, 'save');
    assert.deepEqual([button('Saving…').disabled, button('Cancel').disabled, button('Delete').disabled], [true, true, true], 'save locks Cancel and Delete');
    await refusedDismissals(opened, 'save in flight');
    await release(new Error('a ip blocklist entry for 203.0.113.0/24 already exists'), true);
    assert.equal(document.querySelector('dialog .form-alert')?.textContent, 'a ip blocklist entry for 203.0.113.0/24 already exists');
    assert.deepEqual([opened.done, button('Save').disabled], [false, false], 'a refused save leaves the editor open and usable');

    // ── Blocklist entry: delete shares the pending state ──
    await act(async () => button('Delete').click());
    await act(async () => button('Click again to remove this entry from every node').click());
    await settle();
    assert.equal(held.length, 1, 'the delete is in flight');
    assert.equal(held[0].kind, 'delete');
    assert.deepEqual([button('Save')?.disabled ?? button('Saving…')?.disabled, button('Cancel').disabled], [true, true], 'delete locks Save and Cancel');
    assert.equal(document.querySelector('dialog .form-alert'), null, 'starting a delete clears the earlier refusal');
    await act(async () => { document.querySelector('dialog form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await settle();
    assert.equal(held.length, 1, 'a save cannot start over a delete');
    await refusedDismissals(opened, 'delete in flight');
    await release(new Error('permission denied'), true);
    assert.equal(document.querySelector('dialog .form-alert')?.textContent, 'permission denied');
    assert.deepEqual([opened.done, button('Save').disabled, button('Cancel').disabled], [false, false, false], 'a refused delete releases the editor');
    await act(async () => button('Delete').click());
    await act(async () => button('Click again to remove this entry from every node').click());
    await settle();
    await release({ status: 'deleted' });
    assert.deepEqual([opened.done, opened.value, dialog()], [true, 'deleted', null], 'the finished delete closes the editor');
    assert(toasts.includes('203.0.113.0/24 removed from the blocklist.'));
    console.log('verify-admin-edge-dialogs: held declare, save and delete refuse Escape and the backdrop, share one pending state, and close only on their own result.');
} finally {
    if (root) await act(async () => root.unmount());
    await server.close();
}
