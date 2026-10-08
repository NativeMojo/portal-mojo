import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'MouseEvent', 'Node']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { act } = React;
const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)), appType: 'custom', logLevel: 'silent',
    server: { middlewareMode: true },
    plugins: [{ name: 'sidebar-operator-fixture', enforce: 'pre', transform(source, id) {
        if (!id.endsWith('/ui/SidebarNav.tsx')) return;
        return source.replace("import { useMe } from '../client/me';", 'const useMe = () => ({ data: { id: 1, is_superuser: true } });');
    } }],
});
let root;
try {
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/core/index.ts');
    const registry = await server.ssrLoadModule('/packages/portal-mojo/src/admin/registry.ts');
    const menus = await server.ssrLoadModule('/packages/portal-mojo/src/ui/menu-registry.ts');
    const { SidebarNav } = await server.ssrLoadModule('/packages/portal-mojo/src/ui/SidebarNav.tsx');
    const menu = admin.adminSectionsMenu(registry.ADMIN_SECTIONS, { mount: 'system-admin', grouped: true, presentation: 'accordion' });
    menus.registerMenu(menu);
    menus.setDefaultMenu(menu.name);
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/system-admin/users'] }, React.createElement(SidebarNav))));
    const selected = [...document.querySelectorAll('.nav-active')];
    assert.equal(selected.length, 1, 'only the active leaf page is highlighted');
    assert.equal(selected[0].textContent.trim(), 'Users', 'Users is the selected destination');
    assert.equal(document.querySelectorAll('[aria-current="page"]').length, 1, 'ARIA current page agrees with the visual selection');
    const parent = [...document.querySelectorAll('.nav-parent')].find(node => node.textContent.includes('Identity & Access'));
    assert.equal(parent.getAttribute('aria-expanded'), 'true', 'the selected child opens its actual parent branch');
    assert(!parent.classList.contains('nav-active'), 'the disclosure control is not a selected page');
    const dashboard = [...document.querySelectorAll('a')].find(node => node.textContent.trim() === 'Dashboard');
    assert(!dashboard.classList.contains('nav-active') && !dashboard.hasAttribute('aria-current'), 'mounted Dashboard does not match Users');
    await act(async () => dashboard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
    assert.equal(document.querySelectorAll('.nav-active').length, 1, 'returning to Dashboard still selects exactly one page');
    assert(dashboard.classList.contains('nav-active') && dashboard.getAttribute('aria-current') === 'page');
    console.log('Sidebar selection: mounted root, one highlighted leaf, matching ARIA, automatic parent expansion, return navigation verified.');
} finally {
    if (root) await act(async () => root.unmount());
    await server.close();
    dom.window.close();
}
