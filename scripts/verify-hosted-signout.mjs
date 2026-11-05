// verify:hosted-signout — #9564: hosted sign-out lands on django-mojo's
// /auth?signed_out=1 (#9568), so the auth host forgets its stored session and
// the next sign-in shows the form instead of silently signing the previous
// person back in. Covers AccountModal, UserMenu and the portal app's
// non-packaged sign-out, plus VITE_MOJO_AUTH_ORIGIN (valid, invalid,
// packaged, mock). JSDOM only; the split-host browser run is recorded on #9564.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const APP = 'https://admin.app.test/console/?tab=one%20two#/system/users?group=7';
const RETURN = APP.split('#')[0];
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: APP });
for (const key of ['document', 'HTMLElement', 'HTMLDialogElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'Node', 'MutationObserver', 'localStorage', 'sessionStorage']) globalThis[key] = dom.window[key];
let location;
const land = (url) => { location = new URL(url, APP); };
land(APP);
globalThis.window = new Proxy(dom.window, { get(target, key) {
    if (key === 'location') return location;
    if (key === 'history') return { state: null, replaceState(_state, _title, url) { land(url); } };
    return Reflect.get(target, key);
} });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');

const jwt = (uid = 4) => `e30.${Buffer.from(JSON.stringify({ uid, email: `user${uid}@test.invalid`, auth_time: 1, exp: Math.floor(Date.now() / 1000) + 7200 })).toString('base64url')}.sig`;
const requests = [];
globalThis.fetch = async (url) => {
    requests.push(String(url));
    return Response.json({ status: true, data: { id: 4, email: 'user4@test.invalid', display_name: 'User Four' } });
};
const warnings = [];
const warn = console.warn;
console.warn = (...args) => { warnings.push(args.join(' ')); };

const servers = [];
async function load(env) {
    const define = Object.fromEntries(Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]));
    const server = await createServer({ root: process.cwd(), configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', define, server: { middlewareMode: true } });
    servers.push(server);
    const mod = (path) => server.ssrLoadModule(path);
    return { auth: await mod('/packages/portal-mojo/src/client/auth.ts'), mod };
}
const signedOut = (origin) => `${origin}/auth?redirect=${encodeURIComponent(RETURN)}&signed_out=1&force_reauth=1`;
const button = (label) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === label);
const tokensGone = () => ['access_token', 'refresh_token'].every((key) => localStorage.getItem(key) === null && sessionStorage.getItem(key) === null);

async function mount(element) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await React.act(async () => root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(MemoryRouter, null, element))));
    return async () => { await React.act(async () => root.unmount()); host.remove(); qc.clear(); };
}
async function click(label) {
    const node = button(label);
    assert(node, `"${label}" button is rendered`);
    await React.act(async () => { node.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
}

try {
    // ── Separate API host, no auth origin: today's default host ──
    {
        const { auth, mod } = await load({ VITE_MOJO_API: 'https://api.test' });
        assert.equal(auth.hostedAuthUrl(), `https://api.test/auth?redirect=${encodeURIComponent(RETURN)}`, 'sign-in link is unchanged');
        assert.equal(auth.hostedSignOutUrl?.(), signedOut('https://api.test'), 'sign-out lands on signed_out=1 with the force_reauth guard');

        const { AccountModal } = await mod('/packages/portal-mojo/src/account/AccountModal.tsx');
        land(APP); auth.setTokens(jwt(), jwt(), true);
        let unmount = await mount(React.createElement(AccountModal, { authMode: 'hosted', onClose() {} }));
        await click('Sign out');
        assert.equal(location.href, signedOut('https://api.test'), 'AccountModal hosted sign-out clears the auth host, not a plain /auth that signs back in');
        assert(tokensGone(), 'AccountModal still clears this origin first');
        await unmount();

        const { UserMenu } = await mod('/packages/portal-mojo/src/ui/UserMenu.tsx');
        for (const mode of ['hosted', 'inapp']) {
            land(APP); auth.setTokens(jwt(), jwt(), true);
            unmount = await mount(React.createElement(UserMenu, { authMode: mode }));
            const trigger = document.querySelector('.user-menu-trigger');
            assert(trigger, 'UserMenu trigger is rendered');
            await React.act(async () => trigger.click());
            await click('Sign out');
            if (mode === 'hosted') assert.equal(location.href, signedOut('https://api.test'), 'UserMenu hosted sign-out clears the auth host');
            else assert.equal(location.href, APP, 'UserMenu in-app sign-out does not leave the app');
            assert(tokensGone(), `UserMenu ${mode} sign-out clears this origin`);
            await unmount();
        }

        const source = await mod('/apps/portal/src/admin-source-session.ts');
        land(APP); auth.setTokens(jwt(), jwt(), true);
        await source.revokeAdminSourceSession();
        assert.equal(location.href, signedOut('https://api.test'), "the portal app's non-packaged sign-out clears the auth host");
        // The app's signed-out guard (HostedRedirect) re-renders after logout
        // and calls redirectToHostedAuth(); it must not replace the landing.
        assert.equal(auth.redirectToHostedAuth(), true);
        assert.equal(location.href, signedOut('https://api.test'), 'a guard redirect after sign-out keeps the signed_out landing');
        // A canceled sign-out navigation (beforeunload "Stay") leaves the page
        // here; a later Sign in must still navigate, to the signed_out landing.
        land(APP);
        assert.equal(auth.redirectToHostedAuth(), true);
        assert.equal(location.href, signedOut('https://api.test'), 'Sign in after a canceled sign-out navigates instead of doing nothing');
        // A new session ends the signed-out state: ordinary hosted links again.
        land(APP); auth.setTokens(jwt(), jwt(), false);
        assert.equal(auth.redirectToHostedAuth({ forceReauth: true }), true);
        assert.equal(location.href, `https://api.test/auth?redirect=${encodeURIComponent(RETURN)}&force_reauth=1`, 'step-up after a new sign-in is unaffected');
        auth.logout(); land(APP);
        assert.equal(auth.redirectToHostedAuth(), true);
        assert.equal(location.href, `https://api.test/auth?redirect=${encodeURIComponent(RETURN)}`, 'after a new session, a plain logout + sign-in uses the ordinary link');
        assert(tokensGone(), 'the app sign-out clears this origin');
    }

    // ── VITE_MOJO_AUTH_ORIGIN set: hosted links only, never API requests ──
    {
        const { auth, mod } = await load({ VITE_MOJO_API: 'https://api.test', VITE_MOJO_AUTH_ORIGIN: 'https://auth.test' });
        land(APP);
        assert.equal(auth.hostedAuthUrl(), `https://auth.test/auth?redirect=${encodeURIComponent(RETURN)}`, 'sign-in uses the auth origin');
        assert.equal(auth.hostedAuthUrl(undefined, { forceReauth: true }), `https://auth.test/auth?redirect=${encodeURIComponent(RETURN)}&force_reauth=1`, 'step-up keeps its own force_reauth link');
        assert.equal(auth.hostedSignOutUrl(), signedOut('https://auth.test'), 'sign-out uses the auth origin');
        const { mojoCall } = await mod('/packages/portal-mojo/src/client/client.ts');
        requests.length = 0;
        await mojoCall('/api/user/me');
        assert(requests.length > 0 && requests.every((url) => url.startsWith('https://api.test/')), `API requests stay on the API origin: ${requests.join(', ')}`);
        auth.setTokens(jwt(), jwt(), false);
        assert.equal(auth.signOutHosted(), true);
        assert.equal(location.href, signedOut('https://auth.test'));
        assert(tokensGone(), 'signOutHosted clears this origin');
    }
    {
        const { auth } = await load({ VITE_MOJO_API: 'https://api.test', VITE_MOJO_AUTH_ORIGIN: 'http://localhost:9009' });
        land(APP);
        assert.equal(auth.hostedSignOutUrl(), signedOut('http://localhost:9009'), 'http is allowed on localhost');
    }

    // ── Invalid values warn once and fall back to the API origin ──
    for (const bad of ['http://auth.test', 'https://auth.test/sub', 'https://auth.test/?x=1', 'https://user:pw@auth.test', 'javascript:alert(1)', 'auth.test']) {
        const { auth } = await load({ VITE_MOJO_API: 'https://api.test', VITE_MOJO_AUTH_ORIGIN: bad });
        land(APP); warnings.length = 0;
        assert.equal(auth.hostedAuthUrl(), `https://api.test/auth?redirect=${encodeURIComponent(RETURN)}`, `${bad} falls back for sign-in`);
        assert.equal(auth.hostedSignOutUrl(), signedOut('https://api.test'), `${bad} falls back for sign-out`);
        assert.equal(warnings.filter((line) => line.includes('VITE_MOJO_AUTH_ORIGIN')).length, 1, `${bad} warns once`);
    }

    // ── Packaged Admin is same-origin and ignores the setting ──
    {
        const { auth } = await load({ VITE_MOJO_PACKAGED_ADMIN: '1', VITE_MOJO_AUTH_ORIGIN: 'https://auth.test' });
        land(APP);
        assert.equal(auth.hostedSignOutUrl(), signedOut('https://admin.app.test'), 'packaged Admin keeps its own origin');
    }

    // ── Mock transport: no hosted page, sign-out is local only ──
    {
        const { auth } = await load({ VITE_MOJO_AUTH_ORIGIN: 'https://auth.test' });
        land(APP); auth.setTokens(jwt(), jwt(), true);
        assert.equal(auth.hostedSignOutUrl(), null, 'no hosted page under the mock');
        assert.equal(auth.signOutHosted(), false, 'nothing to navigate to');
        assert.equal(location.href, APP);
        assert(tokensGone(), 'mock sign-out still clears this origin');
    }
    console.log('hosted sign-out verified (AccountModal, UserMenu, app sign-out, auth origin valid/invalid/packaged/mock)');
} finally {
    console.warn = warn;
    await Promise.all(servers.map((server) => server.close()));
}
process.exit(0);
