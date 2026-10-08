import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'Node']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
const { act } = React;
const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)), appType: 'custom', logLevel: 'silent',
    server: { middlewareMode: true },
    plugins: [{ name: 'member-operator-fixture', enforce: 'pre', transform(source, id) {
        if (!id.endsWith('/members/MemberDetail.tsx')) return;
        return source.replace("import { useCan, type PermSpec } from '../../../client/runtime';", "import { type PermSpec } from '../../../client/runtime'; const useCan = () => ({ can: true, isLoading: false });");
    } }],
});
let root;
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
try {
    const ui = await server.ssrLoadModule('/packages/portal-mojo/src/ui/index.ts');
    const models = await server.ssrLoadModule('/packages/portal-mojo/src/admin/identity/members/models.ts');
    const { MemberDetail } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/identity/members/MemberDetail.tsx');
    const row = { id: 27, group: { id: 4, name: 'Test tenant' }, user: { id: 8, display_name: 'Test member' }, is_active: true, permissions: { untouched: true }, metadata: {}, created: 1, modified: 1 };
    const writes = [];
    models.MemberModel.useOne = () => ({ data: row, isPending: false });
    models.MemberModel.useSave = () => ({ mutateAsync: async (vars) => {
        writes.push(vars);
        row.permissions = { ...row.permissions, ...vars.changes.permissions };
        return { ...row };
    } });
    models.MemberModel.useAction = () => ({ mutateAsync: async () => ({}) });
    models.MemberModel.invalidate = async () => {};
    const render = () => React.createElement(QueryClientProvider, { client: qc }, React.createElement(MemoryRouter, null, React.createElement(MemberDetail, { id: row.id, onClose() {} })));
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(render()));
    const button = (name) => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === name);
    assert(!button('Product permissions'), 'no empty product section appears before registration');
    await act(async () => {
        models.registerMemberPermissions([{ name: 'view_orders', label: 'View orders' }]);
        ui.registerFormTabs(models.MEMBER_APP_PERMS_TABSET, [{ key: 'orders', label: 'Orders', fields: [{ name: 'permissions.view_orders', type: 'switch', label: 'View orders' }, { name: 'permissions.sys.users', type: 'switch', label: 'Forbidden system grant' }, { name: 'permissions.unregistered', type: 'switch', label: 'Unregistered grant' }, { name: 'group', type: 'number', label: 'Forbidden group edit' }, { name: 'user', type: 'number', label: 'Forbidden user edit' }] }]);
    });
    assert(button('Product permissions'), 'late product registration adds the native detail section');
    await act(async () => button('Permissions').click());
    assert(!document.querySelector('label')?.textContent.includes('View orders'), 'product controls leave the ordinary permission form');
    assert(![...document.querySelectorAll('.detail-content [role="tabpanel"]:not([hidden]), .detail-content .dv-keep')].filter(node => !node.hidden && getComputedStyleSafe(node)).some(node => node.textContent.includes('View orders')), 'ordinary permissions contain no duplicate product editor');
    await act(async () => button('Product permissions').click());
    const label = [...document.querySelectorAll('label')].find(node => node.textContent.includes('View orders'));
    assert(label, 'registered product switch renders');
    assert(!document.querySelector('.detail-content').textContent.includes('Forbidden'), 'system grants and membership relations cannot become product controls');
    assert(!document.querySelector('.detail-content').textContent.includes('Unregistered grant'), 'unregistered grants cannot become product controls');
    await act(async () => { label.querySelector('input').click(); await new Promise(resolve => setTimeout(resolve, 400)); });
    assert.equal(writes.length, 1, 'a product toggle makes one autosave');
    assert.equal(writes[0].id, 27, 'save targets the inspected membership');
    assert.deepEqual(writes[0].changes, { permissions: { view_orders: true } }, 'save contains only the toggled grant');
    assert.equal(row.group.id, 4, 'product edit cannot redirect the membership to another group');
    assert.equal(row.permissions.untouched, true, 'unrelated stored grants survive');
    console.log('Member product permissions: optional/late section, separate editor, invalid-field rejection, one scoped partial autosave, preserved unrelated grants verified.');
} finally {
    if (root) await act(async () => root.unmount());
    qc.clear(); await server.close(); dom.window.close();
}

function getComputedStyleSafe(node) {
    return window.getComputedStyle(node).display !== 'none';
}
