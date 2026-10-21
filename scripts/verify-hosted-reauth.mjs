// Real FreshAuthHost + auth bridge, with a configured-login fixture. No live OAuth claim.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://portal.test/custom/v2/?keep=one%20two#/system/credentials?group=7' });
for (const key of ['document', 'HTMLElement', 'HTMLDialogElement', 'Event', 'MouseEvent', 'Node', 'localStorage', 'sessionStorage']) globalThis[key] = dom.window[key];
let location;
const land = (url) => { location = new URL(url, 'https://portal.test'); };
land(dom.window.location.href);
globalThis.window = new Proxy(dom.window, { get(target, key) {
    if (key === 'location') return location;
    if (key === 'history') return { state: { usr: { draft: true }, key: 'route', idx: 2 }, replaceState(_state, _title, url) { land(url); } };
    return Reflect.get(target, key);
} });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const jwt = (uid = 4, authTime = 1, email = `user${uid}@test.invalid`) => `e30.${Buffer.from(JSON.stringify({ uid, email, auth_time: authTime, exp: Math.floor(Date.now() / 1000) + 7200 })).toString('base64url')}.sig`;
const server = await createServer({ root: process.cwd(), configFile: false, envFile: false, appType: 'custom', logLevel: 'silent',
    define: { 'import.meta.env.VITE_MOJO_PACKAGED_ADMIN': JSON.stringify('1') }, server: { middlewareMode: true } });
const auth = await server.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
const { FreshAuthHost } = await server.ssrLoadModule('/apps/portal/src/pages/auth/FreshAuthHost.tsx');
const root = createRoot(document.getElementById('root'));
const returnTo = 'https://portal.test/custom/v2/?keep=one%20two#/system/credentials?group=7';
const button = (label) => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === label);
const challenge = async () => { let pending; await React.act(async () => { pending = auth.requestFreshAuth(); }); return { pending }; };
let posts = 0;
globalThis.fetch = async () => { posts++; return Response.json({ status: true, data: { access_token: jwt(4, 100), refresh_token: jwt(4, 100), user: { id: 4 } } }); };
try {
    auth.initAuth(); auth.setTokens(jwt(), jwt(), false);
    await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(FreshAuthHost))));
    let prompt = await challenge();
    assert(button('Continue to sign-in'), 'Hosted confirmation must use the configured sign-in page, including Google');
    assert.equal(document.querySelector('input[type="password"]'), null, 'Hosted confirmation must not demand a local password');
    await React.act(async () => button('Cancel').click());
    assert.equal(await prompt.pending, false, 'Cancel must not retry an action');
    assert.equal(posts, 0, 'Cancel does not contact login or replay a mutation');

    prompt = await challenge();
    await React.act(async () => button('Continue to sign-in').click());
    assert.equal(await prompt.pending, false, 'Hosted navigation ends the original action, even before unloading');
    const login = new URL(location.href);
    assert.equal(login.pathname, '/auth', 'Reuse the existing hosted sign-in');
    assert.equal(login.searchParams.get('force_reauth'), '1', 'Refresh cannot satisfy a forced sign-in');
    assert.equal(login.searchParams.get('redirect'), returnTo.split('#')[0], 'Hash-free handoff keeps the query');
    assert.equal(posts, 0, 'Continue never sends inline password or OAuth requests');

    // Existing hosted login writes localStorage; same-origin return has no auth_code.
    land(login.searchParams.get('redirect'));
    auth.setTokens(jwt(4, 100), jwt(4, 100), true);
    await auth.handleAuthCodeFromURL();
    assert.equal(location.href, returnTo, 'Same-origin return restores the exact hash and query');
    assert.equal(auth.sessionIsPersistent(), false, 'Session-only confirmation stays session-only');
    assert.equal(localStorage.getItem('access_token'), null, 'No persistent credential remains after return');
    assert.equal(posts, 0, 'Same-origin return uses the existing hosted session without exchange or replay');

    for (const persistent of [false, true]) {
        land(returnTo); auth.setTokens(jwt(), jwt(), persistent);
        assert(auth.redirectToHostedAuth({ forceReauth: true }));
        land(new URL(location.href).searchParams.get('redirect') + '&auth_code=once');
        await auth.handleAuthCodeFromURL();
        assert.equal(location.href, returnTo, 'Code handoff restores the original route and query');
        assert.equal(auth.sessionIsPersistent(), persistent, 'Code handoff preserves the original storage');
        assert.equal(location.search.includes('auth_code'), false, 'One-use code is scrubbed');
        auth.stopAutoRefresh();
    }

    // Returning with another account is a new session and screen, never the old operation.
    land(returnTo); auth.setTokens(jwt(), jwt(), false);
    prompt = await challenge(); await React.act(async () => button('Continue to sign-in').click());
    const before = posts;
    land(new URL(location.href).searchParams.get('redirect'));
    auth.setTokens(jwt(9, 100), jwt(9, 100), true);
    await auth.handleAuthCodeFromURL();
    assert.equal(await prompt.pending, false, 'Account switching cannot resume the former actor');
    assert.equal(auth.getAuthSnapshot().uid, '9', 'A new account is not silently replaced by the former actor');
    assert.equal(posts, before, 'Different-account return never replays an operation');

    // Back/cancel, failed exchange, ordinary reload, stale metadata and denied storage.
    land(returnTo); auth.setTokens(jwt(), jwt(), false); auth.redirectToHostedAuth({ forceReauth: true });
    land(returnTo); await auth.handleAuthCodeFromURL();
    assert.equal(auth.sessionIsPersistent(), false, 'Back retains the initiating session choice');
    land(returnTo); auth.redirectToHostedAuth({ forceReauth: true });
    land(new URL(location.href).searchParams.get('redirect') + '&auth_code=denied');
    globalThis.fetch = async () => Response.json({ status: false, error: 'denied' }, { status: 403 });
    assert.equal(await auth.handleAuthCodeFromURL(), null, 'A denied exchange never completes sign-in');
    auth.setTokens(jwt(9), jwt(9), true); land(returnTo); await auth.handleAuthCodeFromURL();
    assert.equal(auth.sessionIsPersistent(), true, 'Consumed return intent never changes a later session');
    auth.setTokens(jwt(), jwt(), false);
    auth.redirectToHostedAuth({ forceReauth: true });
    auth.setTokens(jwt(9), jwt(9), true);
    const realNow = Date.now; Date.now = () => realNow() + 3_600_000;
    try { land(returnTo); await auth.handleAuthCodeFromURL(); } finally { Date.now = realNow; }
    assert.equal(auth.sessionIsPersistent(), true, 'Expired return metadata cannot rehome credentials');
    auth.setTokens(jwt(), jwt(), false); auth.redirectToHostedAuth({ forceReauth: true });
    auth.setTokens(jwt(9), jwt(9), true); land('https://portal.test/unrelated/');
    await auth.handleAuthCodeFromURL();
    assert.equal(auth.sessionIsPersistent(), true, 'Return intent cannot affect another destination');
    const realStorage = globalThis.sessionStorage;
    globalThis.sessionStorage = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); }, removeItem() {} };
    try { assert.equal(auth.redirectToHostedAuth({ forceReauth: true }), false, 'Do not leave if the storage choice cannot be preserved'); }
    finally { globalThis.sessionStorage = realStorage; }

    await React.act(async () => root.render(null));
    const inapp = await createServer({ root: process.cwd(), configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
    let inlineAuth;
    try {
        inlineAuth = await inapp.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
        const { FreshAuthHost: InlineHost } = await inapp.ssrLoadModule('/apps/portal/src/pages/auth/FreshAuthHost.tsx');
        inlineAuth.setTokens(jwt(), jwt(), false);
        await React.act(async () => root.render(React.createElement(InlineHost)));
        let pending; await React.act(async () => { pending = inlineAuth.requestFreshAuth(); });
        assert(document.querySelector('input[type="password"]'), 'In-app mode retains the existing inline form');
        assert.equal(button('Continue to sign-in'), undefined, 'Mock mode has no hosted page');
        await React.act(async () => button('Cancel').click()); assert.equal(await pending, false);
        // The inline second factor loads only when challenged, within the same dialog.
        inlineAuth.initAuth(); inlineAuth.setTokens(jwt(2), jwt(2), false);
        const inlineClient = await inapp.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
        const mfaUser = (await inlineClient.mojoCall('/api/user/me')).data;
        inlineAuth.setTokens(jwt(2, 1, mfaUser.email), jwt(2), false);
        await React.act(async () => { pending = inlineAuth.requestFreshAuth(); });
        const fill = async (node, value) => React.act(async () => {
            assert(node, 'Expected the current sign-in input');
            Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(node, value);
            node.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const wait = async (predicate, name) => {
            for (let tries = 0; tries < 150; tries++) {
                if (predicate()) return;
                await React.act(async () => new Promise(resolve => setTimeout(resolve, 20)));
            }
            assert.fail(`Timed out: ${name}; ${document.body.textContent}`);
        };
        await fill(document.querySelector('input[type="password"]'), 'mojo');
        await React.act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        await wait(() => document.querySelector('[data-testid="mfa-panel"]'), 'existing MFA panel loads');
        assert(document.querySelector('dialog[open] [data-testid="mfa-panel"]'), 'MFA stays in the native confirmation dialog');
        await fill(document.querySelector('input[autocomplete="one-time-code"]'), '123456');
        await React.act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        await wait(() => !document.querySelector('dialog'), 'MFA confirmation completes');
        assert.equal(await pending, true, 'Existing inline MFA can still complete a fresh sign-in');
        assert.equal(inlineAuth.sessionIsPersistent(), false, 'Lazy MFA preserves session-only storage');
        inlineAuth.stopAutoRefresh();
        await React.act(async () => root.render(null));
    } finally { inlineAuth?.stopAutoRefresh(); await inapp.close(); }

    const hosted = await createServer({ root: process.cwd(), configFile: false, envFile: false, appType: 'custom', logLevel: 'silent',
        define: { 'import.meta.env.VITE_MOJO_API': JSON.stringify('https://auth.test') }, server: { middlewareMode: true } });
    try {
        const crossAuth = await hosted.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
        crossAuth.initAuth(); land(returnTo); crossAuth.setTokens(jwt(), jwt(), false);
        crossAuth.redirectToHostedAuth({ forceReauth: true });
        assert.equal(location.origin, 'https://auth.test', 'Separate-origin deployment uses its configured auth origin');
        land(new URL(location.href).searchParams.get('redirect') + '&auth_code=once');
        let exchangeUrl;
        globalThis.fetch = async url => { exchangeUrl = url; return Response.json({ status: true, data: { access_token: jwt(4, 100), refresh_token: jwt(4, 100), user: { id: 4 } } }); };
        await crossAuth.handleAuthCodeFromURL();
        assert.equal(exchangeUrl, 'https://auth.test/api/auth/exchange', 'Handoff exchanges only at the configured API');
        assert.equal(location.href, returnTo, 'Separate-origin return restores the exact route/query');
        assert.equal(crossAuth.sessionIsPersistent(), false, 'Separate-origin return remains session-only');
        crossAuth.stopAutoRefresh();
    } finally { await hosted.close(); }
    console.log('PASS hosted reauth: actual StrictMode host, cancellation/no replay, forced normal sign-in, no-code/code returns, query/hash, both storage modes, account switch, failure/back/stale/storage denial, lazy inline MFA completion');
} finally {
    await React.act(async () => root.unmount()); auth.stopAutoRefresh(); await server.close(); dom.window.close();
}
