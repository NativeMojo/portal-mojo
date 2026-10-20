import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent', 'Node']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const copied = [];
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value) => copied.push(value) } });

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { act } = React;
const held = [];
const fixture = globalThis.__tempPasswordTest = {
    allowed: true, fresh: 0,
    call: (...args) => new Promise((resolve, reject) => held.push({ args, resolve, reject })),
};
const virtual = {
    '/__temp_runtime.ts': `export * from '/packages/portal-mojo/src/client/runtime.ts'; export const mojoCall = (...args) => globalThis.__tempPasswordTest.call(...args); export const withFreshAuth = (work) => { globalThis.__tempPasswordTest.fresh++; return work(); };`,
    '/__temp_shared.tsx': `export * from '/packages/portal-mojo/src/admin/identity/users/sections/shared.tsx'; export const useAdminCaller = () => globalThis.__tempPasswordTest.allowed;`,
};
const server = await createServer({
    root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true },
    plugins: [{
        name: 'temp-password-fixtures', enforce: 'pre',
        resolveId: (id) => id in virtual ? id : null,
        load: (id) => virtual[id] ?? null,
        transform(source, id) {
            if (!id.endsWith('/identity/users/sections/actions.tsx')) return;
            return source.replace("from '../../../../client/runtime'", "from '/__temp_runtime.ts'")
                .replace("from './shared'", "from '/__temp_shared.tsx'");
        },
    }],
});
const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
let root;
try {
    const ui = await server.ssrLoadModule('/packages/portal-mojo/src/ui/index.ts');
    const { useUserAdminActions } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/identity/users/sections/actions.tsx');
    const { SecuritySection } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/identity/users/sections/SecuritySection.tsx');
    const user = { id: 42, username: 'test.person', display_name: 'Test Person', is_active: true };
    function Harness() {
        const actions = useUserAdminActions(user);
        return React.createElement(React.Fragment, null,
            React.createElement(SecuritySection, { user, actions, canManage: fixture.allowed, canPasskeys: false }),
            React.createElement(ui.ModalHost));
    }
    root = createRoot(document.getElementById('root'));
    const render = () => act(async () => root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Harness))));
    const button = (label) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === label);
    const click = async (label) => {
        assert(button(label), `the ${label} button is present`);
        await act(async () => button(label).click());
    };
    const dialog = () => document.querySelector('dialog');
    const release = async (result, reject = false) => {
        const request = held.shift();
        assert(request, 'a temporary-password request is pending');
        await act(async () => request[reject ? 'reject' : 'resolve'](result));
    };
    await render();
    await click('Set temporary password…');
    assert.match(dialog().textContent, /Test Person/);
    assert.match(dialog().textContent, /sign.*out/i);
    assert.equal(held.length, 0, 'opening the confirmation does not change the password');
    await click('Cancel');
    assert.equal(dialog(), null, 'cancel closes without issuing a password');
    await click('Set temporary password…');
    await click('Set temporary password');
    assert.deepEqual(held[0].args, ['/api/account/admin/user/password/temporary', { method: 'POST', body: { user: 42 } }]);
    assert.equal(fixture.fresh, 1, 'the write uses fresh authentication');
    assert(button('Generating…').disabled, 'pending writes prevent repeat submission');
    assert(button('Cancel').disabled, 'pending writes disable Cancel');
    await act(async () => dialog().dispatchEvent(new Event('cancel', { cancelable: true })));
    await act(async () => dialog().dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    assert(dialog(), 'pending writes cannot be dismissed with Escape or the backdrop');
    await release(new Error('permission denied'), true);
    assert.match(dialog().textContent, /permission denied/);
    await click('Set temporary password');
    await release({ data: { user: 42, requires_password_change: true, temporary_password: 'Only-once-password-42!' } });
    assert.equal(document.querySelector('[aria-label="Temporary password"]').textContent, 'Only-once-password-42!');
    assert.match(dialog().textContent, /change.*password.*sign.*in/i);
    await click('Copy');
    assert.deepEqual(copied, ['Only-once-password-42!'], 'copy uses only the revealed value');
    const cache = JSON.stringify({ queries: qc.getQueryCache().getAll().map((q) => q.state), mutations: qc.getMutationCache().getAll().map((m) => m.state) });
    assert(!cache.includes('Only-once-password-42!'), 'the temporary password never enters Query or Mutation cache');
    assert.equal(window.localStorage.length + window.sessionStorage.length, 0, 'the password is not persisted');
    await click('Close');
    assert(!document.body.textContent.includes('Only-once-password-42!'), 'close scrubs the revealed password');
    await click('Set temporary password…');
    assert(!document.body.textContent.includes('Only-once-password-42!'), 'reopening cannot reveal an earlier password');
    await click('Set temporary password');
    fixture.allowed = false;
    await render();
    assert.equal(dialog(), null, 'permission loss closes the operation');
    assert.equal(button('Set temporary password…'), undefined, 'read-only callers cannot issue passwords');
    await release({ data: { user: 42, requires_password_change: true, temporary_password: 'Late-secret-42!' } });
    assert(!document.body.textContent.includes('Late-secret-42!'), 'a late response cannot reopen a revoked reveal');
    console.log('admin temporary password: confirmation, fresh auth, pending lifecycle, refusal, one-time copy, cache isolation and permission loss verified');
} finally {
    if (root) await act(async () => root.unmount());
    qc.clear();
    await server.close();
    dom.window.close();
}
