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
        if (id.endsWith('/jobs/JobDashboardPage.tsx')) return source.replace('import { hasPermission, useMe }', 'import { hasPermission }').replace('export function JobDashboardPage()', 'const useMe = () => ({ data: { id: 1, is_superuser: true } });\nexport function JobDashboardPage()');
        if (!id.endsWith('/ui/SidebarNav.tsx')) return;
        return source.replace("import { useMe } from '../client/me';", 'const useMe = () => ({ data: globalThis.__sidebarActor ?? { id: 1, is_superuser: true } });');
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
    const links = () => [...document.querySelectorAll('a')];
    assert(!links().some(node => node.textContent.trim() === 'Provider Credentials'), 'secondary tools do not fill ordinary navigation');
    const input = document.querySelector('input[type="search"]');
    const search = async value => { await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }); };
    await search('Provider Credentials');
    let secondary = links().find(node => node.textContent.trim() === 'Provider Credentials');
    assert(secondary, 'navigation search discovers the exact secondary destination');
    await act(async () => secondary.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
    await search('');
    secondary = links().find(node => node.textContent.trim() === 'Provider Credentials');
    assert(secondary?.classList.contains('nav-active'), 'a secondary deep link stays visible and selected after clearing search');
    assert.equal(document.querySelectorAll('[aria-current="page"]').length, 1);
    const hosting = [...document.querySelectorAll('.nav-parent')].find(node => node.textContent.includes('Domains & Hosting'));
    assert.equal(hosting.getAttribute('aria-expanded'), 'true', 'secondary navigation expands its owning group');
    const home = links().find(node => node.textContent.trim() === 'Dashboard');
    await act(async () => home.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
    assert(!links().some(node => node.textContent.trim() === 'Provider Credentials'), 'leaving secondary tools restores the compact sidebar');
    await search('no-such-destination');
    assert(document.querySelector('[role="status"]').textContent.includes('No admin pages found'));
    await search('');
    // Render the actual exported pages with registered custom base paths.
    // SSR does not start background reads or operation timers.
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { AdminRouteContext } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/core/route-context.ts');
    const { JobDashboardPage } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/jobs/JobDashboardPage.tsx');
    const { VhostsPage } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/edge/VhostsPage.tsx');
    const pageLinks = (Page, pathname, paths, mount) => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const markup = renderToStaticMarkup(React.createElement(QueryClientProvider, { client },
            React.createElement(MemoryRouter, { initialEntries: [pathname] },
                React.createElement(AdminRouteContext.Provider, { value: paths ? { mount, paths } : null }, React.createElement(Page)))));
        const fragment = document.createElement('div'); fragment.innerHTML = markup;
        client.clear();
        return [...fragment.querySelectorAll('a')].map(node => node.getAttribute('href'));
    };
    for (const base of ['/jobs', '/custom/jobs', '/system/operations/jobs']) {
        const paths = ['list', 'runners', 'scheduled-tasks'].map(path => `${base}/${path}`);
        assert.deepEqual(pageLinks(JobDashboardPage, base, paths, '/system'), paths, `Jobs tools preserve actual dashboard base ${base}`);
    }
    assert.deepEqual(pageLinks(JobDashboardPage, '/', null), ['/jobs/list', '/jobs/runners', '/jobs/scheduled-tasks'], 'Showcase root has deliberate Jobs fallback');
    assert.deepEqual(pageLinks(JobDashboardPage, '/jobs', [], ''), [], 'unregistered Jobs tools are omitted');
    for (const base of ['/edge', '/system/hosting']) {
        assert(pageLinks(VhostsPage, `${base}/vhosts`, [`${base}/upstreams`], '/system').includes(`${base}/upstreams`), 'Serving uses its registered sibling, not a hardcoded base');
    }
    assert(!pageLinks(VhostsPage, '/edge/vhosts', [], '').includes('/edge/upstreams'), 'unregistered Upstreams shortcut is omitted');
    globalThis.__sidebarActor = { id: 2, permissions: { view_scheduled_tasks: true } };
    const limitedMarkup = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/system-admin/unrelated'] }, React.createElement(SidebarNav)));
    const limited = document.createElement('div'); limited.innerHTML = limitedMarkup;
    assert(limited.querySelector('a[href="/system-admin/jobs/scheduled-tasks"]'), 'scheduled-task-only operators retain a discoverable primary entry away from that page');
    assert(!limited.querySelector('a[href="/system-admin/jobs"]'), 'independent Jobs Dashboard grant is not widened');
    delete globalThis.__sidebarActor;
    console.log('Sidebar selection: mounted root, one highlighted leaf, matching ARIA, automatic parent expansion, return navigation verified.');
} finally {
    delete globalThis.__sidebarActor;
    if (root) await act(async () => root.unmount());
    await server.close();
    dom.window.close();
}
