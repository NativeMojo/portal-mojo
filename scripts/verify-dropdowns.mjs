import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'Node']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
HTMLElement.prototype.scrollIntoView = () => {};
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { flushSync } = await import('react-dom');
const { act } = React;
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const root = createRoot(document.getElementById('root'));
const changes = [];
try {
    const { ComboBox } = await server.ssrLoadModule('/packages/portal-mojo/src/ui/ComboBox.tsx');
    const opts = [{ value: '', label: 'Off' }, { value: 'usb', label: 'USB' }, { value: 'hdmi', label: 'HDMI', disabled: true }, { value: 7, label: 'Numeric' }];
    let disabled = false;
    const render = () => root.render(React.createElement('dialog', { open: true }, React.createElement(ComboBox, {
        value: 'usb', options: opts, allowCustom: false, disabled, 'aria-label': 'Speaker output', onChange: value => changes.push(value),
    })));
    await act(async () => render());
    const input = document.querySelector('input');
    await act(async () => {
        flushSync(() => input.focus());
        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        input.dispatchEvent(escape);
        assert.equal(escape.defaultPrevented, true, 'Escape must protect the parent dialog in the opening frame');
    });
    assert.equal(document.querySelector('[role=listbox]'), null);
    assert.deepEqual(changes, []);
    const second = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(second);
    assert.equal(second.defaultPrevented, false, 'next Escape reaches the dialog');
    await act(async () => document.querySelector('.combo-toggle').click());
    assert.equal(document.querySelector('[role=option][aria-disabled=true]')?.textContent, 'HDMI');
    await act(async () => document.querySelector('[aria-disabled=true]').click());
    assert.deepEqual(changes, [], 'disabled options cannot commit');
    const key = async key => act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown'); await key('Enter');
    assert.deepEqual(changes, [7], 'keyboard skips disabled option and preserves numeric value');
    await act(async () => document.querySelector('.combo-toggle').click());
    disabled = true;
    await act(async () => render());
    assert.equal(document.querySelector('[role=listbox]'), null, 'permission loss closes an open menu');
    assert.equal(input.disabled, true);
    assert.equal(input.getAttribute('aria-label'), 'Speaker output');
    console.log('Dropdowns: immediate Escape, parent dismissal, disabled options, numeric values, authority loss and accessible name passed.');
} finally {
    await act(async () => root.unmount());
    await server.close();
}
