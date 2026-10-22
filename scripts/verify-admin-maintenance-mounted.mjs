// StrictMode/JSDOM lifecycle checks; pixels and native focus are centrally browser-verified.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { maintenanceTestBridge } from './verify-admin-maintenance-harness.mjs';
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
for (const n of [
    'window',
    'document',
    'location',
    'Element',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLDialogElement',
    'Event',
    'MouseEvent',
    'Node',
    'localStorage',
    'sessionStorage',
    'CustomEvent',
])
    globalThis[n] = dom.window[n];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
};
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const React = await import('react'),
    { act } = React,
    { createRoot } = await import('react-dom/client'),
    { QueryClient, QueryClientProvider } = await import('@tanstack/react-query'),
    { MemoryRouter } = await import('react-router-dom');
const server = await createServer({
    root: process.cwd(),
    appType: 'custom',
    logLevel: 'silent',
    plugins: [maintenanceTestBridge()],
    server: { middlewareMode: true },
});
let root,
    qc,
    checks = 0;
const wait = async (fn, name) => {
    for (let i = 0; i < 200; i++) {
        await act(async () => new Promise((r) => setTimeout(r, 10)));
        if (fn()) return;
    }
    assert.fail(`Timed out: ${name}; ${document.body.textContent}`);
};
const buttons = (n) => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === n),
    button = (n) => buttons(n)[0];
const click = async (n) => {
    await wait(() => button(n) && !button(n).disabled, `${n} enabled`);
    await act(async () => button(n).click());
};
const field = async (value) => {
    const node = document.querySelector('dialog input:not([type="radio"])');
    assert(node);
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value);
        node.dispatchEvent(new Event('input', { bubbles: true }));
    });
};
try {
    const auth = await server.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
    auth.initAuth();
    const wire = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/maintenance-mock.ts');
    const { MaintenancePage: Page, maintenanceDeploymentsHref } = await server.ssrLoadModule(
        '/packages/portal-mojo/src/admin/maintenance/MaintenancePage.tsx',
    );
    const ops = await server.ssrLoadModule('/packages/portal-mojo/src/admin/maintenance/operations.ts');
    globalThis.__maintenanceFixture = { persona: { is_superuser: true }, posts: 0 };
    const fixture = globalThis.__maintenanceFixture;
    const login = async (email = 'showcase.operator@nativemojo.com') =>
        act(async () => {
            await auth.login(email, 'mojo');
            auth.stopAutoRefresh();
        });
    const mount = async (props = {}) => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
        root = createRoot(document.getElementById('root'));
        await act(async () =>
            root.render(
                React.createElement(
                    QueryClientProvider,
                    { client: qc },
                    React.createElement(
                        MemoryRouter,
                        { initialEntries: ['/product/custom/admin/maintenance'] },
                        React.createElement(
                            React.StrictMode,
                            null,
                            React.createElement(Page, { pollInterval: 8, pollLimit: 6, ...props }),
                        ),
                    ),
                ),
            ),
        );
    };
    const unmount = async () => {
        await act(async () => {
            root?.unmount();
            root = null;
        });
        qc?.clear();
    };
    const ready = () =>
        wait(
            () =>
                document.body.textContent.includes('Scan time:') ||
                document.body.textContent.includes('Latest published'),
            'evidence loaded',
        );
    const configure = async (persona, scenario = 'findings') => {
        fixture.persona = persona;
        fixture.posts = 0;
        mock.setMockMaintenanceScenario(scenario);
        await login();
        wire.clearMockRequestHistory();
        await mount();
    };
    const paths = () => wire.getMockRequestHistory().map((r) => r.path);
    const review = async (resource, window = 'Immediately') => {
        await click(`Upgrade ${resource}`);
        await field(resource);
        await act(async () => {
            [...document.querySelectorAll('dialog label')]
                .find((l) => l.textContent.trim() === window)
                .querySelector('input')
                .click();
        });
    };
    assert.equal(
        maintenanceDeploymentsHref('/product/custom/admin/maintenance'),
        '#/product/custom/admin/deployments',
    );
    checks++;
    await configure({ is_superuser: false, permissions: { comms: true, admin: false } });
    await wait(() => document.body.textContent.includes('requires global AWS'), 'comms denied');
    assert(
        !paths().some(
            (p) => p.includes('/maintenance/') || p.endsWith('/framework') || p.endsWith('/bootstrap'),
        ),
        'denied page makes zero operational requests',
    );
    checks++;
    await unmount();
    await configure({ is_superuser: false, permissions: { manage_aws: true } });
    await ready();
    assert(paths().includes('/api/aws/maintenance/versions'));
    assert(
        !paths().some((p) => p.includes('/framework') || p.includes('/bootstrap') || p.endsWith('/status')),
        'AWS-only never reads framework/bootstrap/status',
    );
    assert(!button('Upgrade orders-db'), 'without mode proof no writes');
    checks += 3;
    await unmount();
    await configure({ is_superuser: false, permissions: { view_platform: true } });
    await ready();
    assert(paths().includes('/api/account/admin/platform/framework'));
    assert(
        !paths().some((p) => p.startsWith('/api/aws/') || p.endsWith('/bootstrap')),
        'framework-only never reads AWS or bootstrap',
    );
    checks += 2;
    await unmount();
    await configure(
        {
            is_superuser: false,
            permissions: { manage_aws: true, manage_platform: true, manage_settings: true },
        },
        'bootstrap-denied',
    );
    await ready();
    await wait(() => document.body.textContent.includes('mode is unconfirmed'), 'bootstrap failure retained');
    assert(document.body.textContent.includes('orders-db'));
    assert(!button('Upgrade orders-db'));
    checks += 2;
    await unmount();
    await configure({ is_superuser: true }, 'external');
    await ready();
    assert(document.body.textContent.includes('infrastructure team'));
    assert(!button('Upgrade orders-db'));
    assert(!button('Update to 4.1.0'));
    checks += 3;
    await unmount();
    await configure({ is_superuser: true }, 'denied-inventory');
    await ready();
    assert(document.body.textContent.includes('rds:DescribeDBClusters'));
    assert(document.body.textContent.includes('elasticache:DescribeReplicationGroups'));
    assert(document.body.textContent.includes('Standard support deadline'));
    assert(document.body.textContent.includes('Extended support deadline'));
    checks += 4;
    await unmount();
    await configure({ is_superuser: true }, 'framework-held');
    await ready();
    await click('Resume automatic updates and redeploy');
    assert(document.querySelector('dialog').textContent.includes('last converged application SHA'));
    await click('Cancel');
    assert.equal(fixture.posts, 0);
    checks += 2;
    await unmount();
    await configure({ is_superuser: true }, 'target-before-settled');
    await ready();
    await review('orders-db');
    await act(async () => {
        button('Apply upgrade').click();
        button('Apply upgrade').click();
    });
    await wait(
        () => document.body.textContent.includes('AWS reports every member settled'),
        'target and settled completion',
    );
    assert.equal(fixture.posts, 1, 'double activation single POST');
    assert.equal(fixture.lastImmediate, true);
    assert.equal(
        document.querySelector('a[href="#/product/custom/admin/deployments"]').textContent,
        'Open Deployments',
    );
    checks += 3;
    await unmount();
    await configure({ is_superuser: true }, 'next-window');
    await ready();
    await review('analytics-cluster', 'Next maintenance window');
    await click('Apply upgrade');
    await wait(
        () => document.body.textContent.includes('Automatic observations reached their limit'),
        'bounded next-window observation',
    );
    assert.equal(fixture.lastImmediate, false);
    assert(!document.body.textContent.includes('Upgraded to 15.8'));
    await unmount();
    await mount();
    await ready();
    assert(!button('Upgrade analytics-cluster'), 'timeout guard survives remount');
    await click('Refresh submitted resource status');
    assert.equal(fixture.posts, 1, 'manual status never reapplies');
    checks += 4;
    await unmount();
    await configure({ is_superuser: true }, 'reauth');
    await ready();
    let fresh = 0;
    auth.setFreshAuthHandler(async () => {
        fresh++;
        await auth.login('showcase.operator@nativemojo.com', 'mojo');
        auth.stopAutoRefresh();
        return true;
    });
    await review('standalone-cache');
    await click('Apply upgrade');
    await wait(() => fresh === 1 && !document.querySelector('dialog'), '440 spends consent and prompts once');
    await act(async () => new Promise((r) => setTimeout(r, 60)));
    assert.equal(fixture.posts, 1, 'fresh authentication never replays');
    assert(!button('Upgrade standalone-cache'), 'renewed session retains refusal until explicit refresh');
    mock.setMockMaintenanceScenario('findings');
    await click('Refresh Maintenance');
    await wait(() => button('Upgrade standalone-cache'), 'explicit successful refresh permits new review');
    assert.equal(fixture.posts, 1);
    auth.setFreshAuthHandler(null);
    checks += 3;
    await unmount();
    await configure({ is_superuser: true }, 'provider-unknown');
    await ready();
    await review('session-cache');
    await click('Apply upgrade');
    await wait(
        () => document.body.textContent.includes('operation may have started'),
        'unknown provider outcome visible',
    );
    assert.equal(fixture.posts, 1);
    await unmount();
    await login();
    await mount();
    await ready();
    assert(
        !button('Upgrade session-cache'),
        'same actor replacement/remount cannot resend unknown operation',
    );
    await click('Refresh Maintenance');
    await ready();
    await click('Refresh submitted resource status');
    assert.equal(fixture.posts, 1, 'old version report/status cannot unlock uncertainty');
    checks += 3;
    await unmount();
    await configure({ is_superuser: true }, 'framework-pin-cleared-503');
    await ready();
    await click('Update to 4.1.0');
    await field('4.1.0');
    await click('Confirm framework update');
    await wait(
        () => document.body.textContent.includes('pin may already be cleared'),
        'separate policy/deployment uncertainty',
    );
    assert.equal(fixture.posts, 1);
    await unmount();
    await login();
    await mount();
    await ready();
    await click('Refresh Maintenance');
    await ready();
    assert(
        !button('Update to 4.1.0'),
        'same actor renewed session cannot duplicate unknown framework operation',
    );
    assert(document.body.textContent.includes('deployment acceptance is unknown'));
    assert(
        !JSON.stringify(qc.getMutationCache().getAll()).includes('version'),
        'imperative writes leave Mutation cache empty',
    );
    checks += 4;
    await unmount();
    // A second actor has independent receipts; an accepted deploy with lost response is still uncertain.
    fixture.persona = { is_superuser: true };
    fixture.posts = 0;
    mock.setMockMaintenanceScenario('framework-lost-response');
    await login('dns.platform@nativemojo.com');
    await mount();
    await ready();
    await click('Update to 4.1.0');
    await field('4.1.0');
    fixture.delay = 80;
    await click('Confirm framework update');
    await wait(() => fixture.posts === 1, 'provider accepted before owner leaves');
    await unmount();
    fixture.delay = 0;
    await act(async () => new Promise((r) => setTimeout(r, 110)));
    await mount();
    await ready();
    assert(!button('Update to 4.1.0'), 'late lost response cannot restore a new confirmation');
    assert.equal(fixture.posts, 1);
    assert(ops.getMaintenanceAttempt('framework'), 'receipt outlives owner unmount');
    checks += 3;
    await unmount();
    mock.setMockMaintenanceScenario('findings');
    await login('assistant.operator@nativemojo.com');
    await mount();
    await ready();
    await click('Upgrade orders-db');
    await login('dns.manager@nativemojo.com');
    await wait(() => !document.querySelector('dialog'), 'session replacement dismisses owned consent');
    assert.equal(fixture.posts, 1, 'unsent old consent cannot create a request');
    checks++;
    await unmount();
    console.log(`Maintenance mounted: ${checks} assertions passed`);
} finally {
    await act(async () => root?.unmount());
    delete globalThis.__maintenanceFixture;
    await server.close();
    dom.window.close();
}
