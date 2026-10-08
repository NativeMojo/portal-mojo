// Mounted FormWizard under React StrictMode (#1616). StrictMode replays the
// mount effect in development; the wizard must still accept what onNext and
// onFinish return, or a refused step leaves it busy with no message.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'MouseEvent', 'CustomEvent', 'Node']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const button = (name) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === name);
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
let root;
try {
    const { FormWizard } = await server.ssrLoadModule('/packages/portal-mojo/src/ui/FormWizard.tsx');
    let refuse = true;
    let finished = 0;
    const sections = [
        { key: 'first', label: 'First', fields: [], onNext: async () => { if (refuse) throw new Error('Step refused by its owner'); } },
        { key: 'second', label: 'Second', fields: [] },
    ];
    const finish = async () => { finished += 1; if (finished === 1) throw new Error('Save refused once'); };
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(React.createElement(React.StrictMode, null,
        React.createElement(FormWizard, { mode: 'wizard', sections, onFinish: finish }))));

    await act(async () => button('Next').click());
    await settle();
    assert.equal(document.querySelector('.form-alert')?.textContent, 'Step refused by its owner', 'a refused step shows its reason');
    assert.equal(button('Next').disabled, false, 'and the wizard is not left busy');
    assert.equal(document.querySelector('.form-wizard').getAttribute('aria-busy'), null);

    refuse = false;
    await act(async () => button('Next').click());
    await settle();
    assert(button('Finish'), 'an accepted step advances');
    assert.equal(document.querySelector('[aria-current="step"]').textContent.includes('Second'), true);

    await act(async () => button('Finish').click());
    await settle();
    assert.equal(document.querySelector('.form-alert')?.textContent, 'Save refused once', 'a refused finish shows its reason');
    assert.equal(button('Finish').disabled, false, 'and can be tried again');
    await act(async () => button('Finish').click());
    await settle();
    assert.equal(finished, 2);
    assert.equal(document.querySelector('.form-alert'), null);
    console.log('Mounted FormWizard under StrictMode: refused step and refused finish report and release; accepted step advances.');
} finally {
    if (root) await act(async () => root.unmount());
    await server.close();
}
