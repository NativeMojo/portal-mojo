// Mounted lifecycle regression. Native top-layer visibility and pointer/focus
// behavior are also verified in the showcase browser, not inferred from JSDOM.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'MutationObserver', 'Node']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const matches = HTMLElement.prototype.matches;
HTMLElement.prototype.matches = function (selector) {
    if (selector === ':popover-open') return this.hasAttribute('data-shown');
    if (selector === ':modal') return this.tagName === 'DIALOG' && this.open;
    return matches.call(this, selector);
};
HTMLElement.prototype.showPopover = function () { this.setAttribute('data-shown', ''); };
HTMLElement.prototype.hidePopover = function () { this.removeAttribute('data-shown'); };
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const root = createRoot(document.getElementById('root'));
try {
    const { ToastHost, toast } = await server.ssrLoadModule('/packages/portal-mojo/src/ui/toast.tsx');
    await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(ToastHost))));
    let undone = 0, cancelled = 0;
    let progress;
    await React.act(async () => { progress = toast.progress('Uploading', { onCancel: () => cancelled++ }); });
    const host = document.querySelector('.toast-host');
    const outer = document.createElement('dialog');
    const inner = document.createElement('dialog');
    // DOM order is deliberately different from opening order.
    document.body.append(inner, outer);
    await React.act(async () => { outer.open = true; });
    assert(host.parentElement === outer, 'Toasts must follow the modal out of the inert document');
    assert(host.matches(':popover-open'), 'Toasts need the native top layer above the backdrop');
    await React.act(async () => { inner.open = true; });
    assert(host.parentElement === inner, 'Newest modal wins, even when DOM order differs');
    await React.act(async () => { progress.update(43); });
    assert.equal(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '43');
    await React.act(async () => host.querySelector('button').click());
    assert.equal(cancelled, 1);
    await React.act(async () => { inner.open = false; });
    assert(host.parentElement === outer, 'Closing a nested modal restores the outer host');
    let undo;
    await React.act(async () => { undo = toast.undo('Removed', () => undone++, { timeout: 60_000 }); });
    await React.act(async () => host.querySelector('.undo-btn').click());
    assert.equal(undone, 1);
    undo.dismiss();
    await React.act(async () => outer.remove());
    assert(host.parentElement === document.body, 'Removing a dialog without close preserves notifications');
    await React.act(async () => progress.remove());
    assert(!host.matches(':popover-open'), 'An empty host must leave the top layer');
    await React.act(async () => root.unmount());
    assert.equal(document.querySelectorAll('.toast-host').length, 0, 'StrictMode host and observers clean up');
    console.log('Toast modal lifecycle: nested/reversed opening order, updates, actions, removal and cleanup passed.');
} finally {
    await server.close();
    dom.window.close();
}
