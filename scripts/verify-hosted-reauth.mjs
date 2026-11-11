// Real FreshAuthHost + auth bridge, with a configured-login fixture. No live OAuth claim.
// #10670: hosted/packaged confirmation happens in place — account-matched inline
// methods, and the deployment's sign-in in a pop-up that relays back. The page
// never navigates and a same-account step-up keeps the session.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://portal.test/custom/v2/?keep=one%20two#/system/credentials?group=7' });
for (const key of ['document', 'HTMLElement', 'HTMLDialogElement', 'Event', 'MouseEvent', 'Node', 'localStorage', 'sessionStorage']) globalThis[key] = dom.window[key];
let location;
const land = (url) => { location = new URL(url, 'https://portal.test'); };
land(dom.window.location.href);
// Pop-up and opener seams: what window.open returns, who opened this window, close().
const opened = [];
let popupFactory = () => { const popup = { closed: false, focus() {}, close() { this.closed = true; } }; return popup; };
let opener = null;
let closedSelf = false;
globalThis.window = new Proxy(dom.window, { get(target, key) {
    if (key === 'location') return location;
    if (key === 'history') return { state: { usr: { draft: true }, key: 'route', idx: 2 }, replaceState(_state, _title, url) { land(url); } };
    if (key === 'open') return (url, name, features) => { const popup = popupFactory(); opened.push({ url, name, features, popup }); return popup; };
    if (key === 'opener') return opener;
    if (key === 'close') return () => { closedSelf = true; };
    const value = Reflect.get(target, key);
    return ['addEventListener', 'removeEventListener', 'dispatchEvent'].includes(key) ? value.bind(target) : value;
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
const text = () => document.body.textContent;
const settle = async (ms = 20) => React.act(async () => new Promise(resolve => setTimeout(resolve, ms)));
const waitFor = async (predicate, name) => {
    for (let tries = 0; tries < 150; tries++) { if (predicate()) return; await settle(); }
    assert.fail(`Timed out: ${name}; ${text()}`);
};
const challenge = async () => {
    let pending; await React.act(async () => { pending = auth.requestFreshAuth(); });
    let settled = false; pending.then(() => { settled = true; });
    return { pending, settled: () => settled };
};
const click = async (label) => { const node = button(label); assert(node, `Missing button ${label}`); await React.act(async () => node.click()); };
const fill = async (node, value) => React.act(async () => {
    assert(node, 'Expected the current sign-in input');
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
});
// What a relaying pop-up landing posts, delivered as the browser would.
const deliver = async (data, origin = 'https://portal.test', source = opened.at(-1)?.popup) => React.act(async () => {
    const event = new dom.window.Event('message');
    Object.defineProperties(event, { data: { value: data }, origin: { value: origin }, source: { value: source } });
    dom.window.dispatchEvent(event);
});
const nonceOf = (entry) => new URL(new URL(entry.url).searchParams.get('redirect')).searchParams.get('mojo_stepup');
// The hosted page in the pop-up shares this origin's storage and writes the new pair.
const hostedSignIn = (uid, authTime = 100) => { localStorage.setItem('access_token', jwt(uid, authTime)); localStorage.setItem('refresh_token', jwt(uid, authTime)); };

let profile;
let posts = 0;
const requests = [];
globalThis.fetch = async (url, opts = {}) => {
    const target = new URL(String(url));
    requests.push({ method: opts.method ?? 'GET', path: target.pathname, params: target.searchParams });
    if (target.pathname === '/api/user/me') return Response.json({ status: true, data: { id: 4, has_password: profile.password, has_passkey: profile.passkey } });
    if (target.pathname === '/api/account/oauth_connection') return Response.json({ status: true, data: profile.links.map((provider, i) => ({ id: i + 1, provider, is_active: true })), count: profile.links.length, start: 0, size: 50 });
    if (target.pathname === '/api/auth/config') return Response.json({ status: true, data: { login: { methods: profile.methods } } });
    if (target.pathname === '/api/login' || target.pathname === '/api/auth/exchange') {
        if (target.pathname === '/api/login') posts++;
        return Response.json({ status: true, data: { access_token: jwt(4, 100), refresh_token: jwt(4, 100), user: { id: 4 } } });
    }
    return Response.json({ status: false, error: 'unexpected' }, { status: 404 });
};
try {
    auth.initAuth(); auth.setTokens(jwt(), jwt(), false);
    await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(FreshAuthHost))));

    // Password + Google account: both offered inline, nothing navigates.
    profile = { password: true, passkey: false, links: ['google', 'github'], methods: ['password', 'passkey', 'google', 'magic'] };
    let prompt = await challenge();
    await waitFor(() => document.querySelector('input[type="password"]'), 'password offered for an account that has one');
    assert(button('Continue with Google'), 'A linked, enabled provider is offered');
    assert.equal(button('Continue with GitHub'), undefined, 'A provider the deployment no longer lists is not offered');
    assert.equal(button('Use passkey'), undefined, 'No passkey button for an account without one');
    assert(button('Use the sign-in page'), 'The sign-in page stays available as a fallback');
    const links = requests.find(r => r.path === '/api/account/oauth_connection');
    assert.equal(links.params.get('user'), '4', 'Provider links are read for this account only (admins can list everyone)');
    assert.equal(location.href, returnTo, 'Opening the check never navigates');
    await click('Cancel');
    assert.equal(await prompt.pending, false, 'Cancel must not retry an action');
    assert.equal(posts, 0, 'Cancel does not contact login or replay a mutation');

    // Inline password in packaged Admin: same session, storage kept.
    const revision = auth.getAuthSessionRevision();
    prompt = await challenge();
    await waitFor(() => document.querySelector('input[type="password"]'), 'password form');
    await fill(document.querySelector('input[type="password"]'), 'secret');
    await React.act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(await prompt.pending, true, 'Inline password confirms in place');
    assert.equal(posts, 1);
    assert.equal(auth.getAuthSessionRevision(), revision, 'A same-account step-up keeps the session revision');
    assert.equal(auth.sessionIsPersistent(), false, 'Session-only storage is kept');
    assert.equal(location.href, returnTo, 'Inline confirmation never navigates');

    // Google-only account: the pop-up runs the normal sign-in and relays back.
    profile = { password: false, passkey: false, links: ['google'], methods: ['password', 'google'] };
    auth.setTokens(jwt(), jwt(), false);
    const before = auth.getAuthSessionRevision();
    prompt = await challenge();
    await waitFor(() => button('Continue with Google'), 'Google offered');
    assert.equal(document.querySelector('input[type="password"]'), null, 'No password demanded from a Google-only account');
    assert.match(button('Continue with Google').className, /btn-primary/, 'The only method is the primary action');
    await click('Continue with Google');
    assert.equal(opened.length, 1, 'One sign-in pop-up');
    const signIn = new URL(opened[0].url);
    assert.equal(signIn.origin + signIn.pathname, 'https://portal.test/auth', 'Reuse the existing hosted sign-in');
    assert.equal(signIn.searchParams.get('force_reauth'), '1', 'Refresh cannot satisfy a forced sign-in');
    const back = new URL(signIn.searchParams.get('redirect'));
    assert.equal(back.hash, '', 'Hash-free return so the handoff code survives');
    assert.equal(back.searchParams.get('keep'), 'one two', 'The return keeps the app query');
    assert(nonceOf(opened[0]), 'The return carries a one-time step-up marker');
    assert.match(opened[0].features, /popup/);
    assert.match(text(), /Finish in the sign-in window/);
    assert.equal(location.href, returnTo, 'The page stays put while the pop-up signs in');
    hostedSignIn(4);
    await deliver({ type: 'mojo:stepup', nonce: nonceOf(opened[0]), code: null }, 'https://evil.test');
    await deliver({ type: 'mojo:stepup', nonce: 'other', code: null });
    await deliver({ type: 'mojo:stepup', nonce: nonceOf(opened[0]), code: null }, 'https://portal.test', {});
    await settle(); assert.equal(prompt.settled(), false, 'Wrong origin, nonce or window is ignored');
    await deliver({ type: 'mojo:stepup', nonce: nonceOf(opened[0]), code: null });
    assert.equal(await prompt.pending, true, 'The pop-up confirms the same account in place');
    assert.equal(auth.getAuthSessionRevision(), before, 'Pop-up step-up keeps the session revision');
    assert.equal(auth.sessionIsPersistent(), false, 'The session stays session-only');
    assert.equal(localStorage.getItem('access_token'), null, 'No persistent credential remains');
    assert.equal(location.href, returnTo, 'Still on the exact route and query');

    // A provider that cuts the pop-up's link back (COOP): shared storage still completes it.
    auth.setTokens(jwt(), jwt(), false);
    prompt = await challenge();
    await waitFor(() => button('Continue with Google'), 'Google offered');
    await click('Continue with Google');
    assert(sessionStorage.getItem('mojo:auth-return-route'), 'A same-tab fallback could still come back to this screen');
    const storageEvent = (key) => React.act(async () => dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key })));
    localStorage.setItem('access_token', jwt(4, 100)); await storageEvent('access_token');
    await settle(); assert.equal(prompt.settled(), false, 'Half a pair is not a sign-in');
    // Another tab's refresh (same account, auth_time unchanged) is not a sign-in either.
    localStorage.setItem('access_token', jwt(4, 1, 'refreshed@test.invalid')); localStorage.setItem('refresh_token', jwt(4, 1, 'refreshed@test.invalid'));
    await storageEvent('refresh_token'); await settle();
    assert.equal(prompt.settled(), false, 'A refresh in another tab does not complete the check');
    localStorage.setItem('access_token', jwt(4, 100)); localStorage.setItem('refresh_token', jwt(4, 100)); await storageEvent('refresh_token');
    assert.equal(await prompt.pending, true, 'Same-origin storage completes a pop-up whose link back was cut');
    assert.equal(sessionStorage.getItem('mojo:auth-return-route'), null, 'The fallback return is dropped once confirmed in place');
    assert.equal(auth.sessionIsPersistent(), false, 'The session stays session-only');

    // A relay without a newer sign-in (an older server ignoring force_reauth) is not a confirmation.
    auth.setTokens(jwt(), jwt(), false);
    prompt = await challenge();
    await waitFor(() => button('Continue with Google'), 'Google offered');
    await click('Continue with Google');
    localStorage.setItem('access_token', jwt(4, 1, 'same-time@test.invalid')); localStorage.setItem('refresh_token', jwt(4, 1, 'same-time@test.invalid'));
    await deliver({ type: 'mojo:stepup', nonce: nonceOf(opened.at(-1)), code: null });
    await waitFor(() => /did not finish/.test(text()), 'a relay with an unchanged auth_time is refused');
    assert.equal(prompt.settled(), false, 'The check stays open');
    await click('Cancel');
    assert.equal(await prompt.pending, false);

    // Another account in the pop-up is refused and this tab's session is put back.
    auth.setTokens(jwt(), jwt(), true);
    prompt = await challenge();
    await waitFor(() => button('Continue with Google'), 'Google offered again');
    await click('Continue with Google');
    hostedSignIn(9);
    await deliver({ type: 'mojo:stepup', nonce: nonceOf(opened.at(-1)), code: null });
    await waitFor(() => /different account/.test(text()), 'another account is refused');
    assert.equal(auth.getAuthSnapshot().uid, '4', 'The original account is restored');
    assert.equal(prompt.settled(), false, 'The prompt stays open to try again');
    await click('Cancel');
    assert.equal(await prompt.pending, false, 'Another account never answers the challenge');

    // Blocked and closed pop-ups never fall back to navigation.
    prompt = await challenge();
    await waitFor(() => button('Continue with Google'), 'Google offered');
    popupFactory = () => null;
    await click('Continue with Google');
    assert.match(text(), /blocked the sign-in window/, 'A blocked pop-up is explained inline');
    assert.equal(location.href, returnTo, 'A blocked pop-up never navigates');
    popupFactory = () => ({ closed: false, focus() {}, close() { this.closed = true; } });
    await click('Use the sign-in page');
    opened.at(-1).popup.closed = true;
    await waitFor(() => /closed before you finished/.test(text()), 'an early-closed pop-up is noticed');
    const reopenedFrom = opened.length;
    await click('Reopen window');
    assert.equal(opened.length, reopenedFrom + 1, 'Reopen opens the sign-in again');
    const last = opened.at(-1).popup;
    await click('Cancel');
    assert.equal(await prompt.pending, false);
    assert.equal(last.closed, true, 'Cancel closes the pop-up');

    // A different account's re-login (any path) is a new session, never a step-up.
    await React.act(async () => root.render(null));
    auth.setTokens(jwt(), jwt(), false);
    auth.setFreshAuthHandler(async () => { auth.setTokens(jwt(9, 100), jwt(9, 100), false); return true; });
    const switched = auth.getAuthSessionRevision();
    assert.equal(await auth.requestFreshAuth(), false, 'Only the challenged account answers');
    assert.notEqual(auth.getAuthSessionRevision(), switched, 'Another account replaces the session');
    auth.setFreshAuthHandler(null);

    // A caller that joins an open prompt after the session changed is answered for its own account.
    auth.setTokens(jwt(), jwt(), false);
    let release; auth.setFreshAuthHandler(() => new Promise((resolve) => { release = resolve; }));
    const first = auth.requestFreshAuth();
    auth.setTokens(jwt(9), jwt(9), false);
    const joiner = auth.requestFreshAuth();
    auth.setTokens(jwt(4, 100), jwt(4, 100), false); release(true);
    assert.equal(await first, true, 'The account that opened the prompt is confirmed');
    assert.equal(await joiner, false, 'Another account that joined is never retried under the confirming account');
    auth.setFreshAuthHandler(null);

    // The pop-up landing relays and closes; without an opener it boots normally.
    opener = { posted: [], postMessage(data, origin) { this.posted.push({ data, origin }); } };
    land('https://portal.test/custom/v2/?keep=1&mojo_stepup=n1&auth_code=c1#/x');
    assert.equal(auth.relayHostedStepUp(), true, 'The pop-up only relays');
    assert.deepEqual(opener.posted, [{ data: { type: 'mojo:stepup', nonce: 'n1', code: 'c1' }, origin: 'https://portal.test' }], 'Code goes only to a same-origin opener; never tokens');
    assert.equal(location.href, 'https://portal.test/custom/v2/?keep=1#/x', 'Marker and code are scrubbed');
    assert.equal(closedSelf, true, 'The pop-up closes itself');
    opener = null;
    land('https://portal.test/custom/v2/?keep=1&mojo_stepup=n1&auth_code=c1#/x');
    assert.equal(auth.relayHostedStepUp(), false, 'No opener: boot as a normal return');
    assert.equal(location.href, 'https://portal.test/custom/v2/?keep=1&auth_code=c1#/x', 'The code is left for the normal exchange');
    land('https://portal.test/custom/v2/?keep=1#/x');
    assert.equal(auth.relayHostedStepUp(), false, 'Ordinary loads are untouched');

    // A browser that opens the "pop-up" in this tab comes back to this exact screen.
    land(returnTo); auth.setTokens(jwt(), jwt(), false);
    const sameTab = auth.openHostedStepUp({ remember: false });
    land(new URL(opened.at(-1).url).searchParams.get('redirect'));
    hostedSignIn(4);
    assert.equal(auth.relayHostedStepUp(), false, 'No opener: boot as a normal hosted return');
    await auth.handleAuthCodeFromURL();
    assert.equal(location.href, returnTo, 'The same-tab fallback restores the exact route and query');
    assert.equal(auth.sessionIsPersistent(), false, 'and the initiating storage choice');
    sameTab.cancel();

    // Full-page hosted return (still used by the signed-out gate) keeps working.
    land(returnTo); auth.setTokens(jwt(), jwt(), false);
    assert(auth.redirectToHostedAuth({ forceReauth: true }));
    const login = new URL(location.href);
    land(login.searchParams.get('redirect'));
    auth.setTokens(jwt(4, 100), jwt(4, 100), true);
    await auth.handleAuthCodeFromURL();
    assert.equal(location.href, returnTo, 'Same-origin return restores the exact hash and query');
    assert.equal(auth.sessionIsPersistent(), false, 'Session-only confirmation stays session-only');
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
    const realStorage = globalThis.sessionStorage;
    globalThis.sessionStorage = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); }, removeItem() {} };
    try { assert.equal(auth.redirectToHostedAuth({ forceReauth: true }), false, 'Do not leave if the storage choice cannot be preserved'); }
    finally { globalThis.sessionStorage = realStorage; }

    const inapp = await createServer({ root: process.cwd(), configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
    let inlineAuth;
    try {
        land(returnTo);
        inlineAuth = await inapp.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
        const { FreshAuthHost: InlineHost } = await inapp.ssrLoadModule('/apps/portal/src/pages/auth/FreshAuthHost.tsx');
        inlineAuth.setTokens(jwt(), jwt(), false);
        await React.act(async () => root.render(React.createElement(InlineHost)));
        let pending; await React.act(async () => { pending = inlineAuth.requestFreshAuth(); });
        await waitFor(() => document.querySelector('input[type="password"]'), 'In-app mode retains the existing inline form');
        assert.equal(button('Use the sign-in page'), undefined, 'Mock mode has no hosted page');
        await click('Cancel'); assert.equal(await pending, false);
        // The inline second factor loads only when challenged, within the same dialog.
        inlineAuth.initAuth(); inlineAuth.setTokens(jwt(2), jwt(2), false);
        const inlineClient = await inapp.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
        const mfaUser = (await inlineClient.mojoCall('/api/user/me')).data;
        inlineAuth.setTokens(jwt(2, 1, mfaUser.email), jwt(2), false);
        await React.act(async () => { pending = inlineAuth.requestFreshAuth(); });
        await waitFor(() => document.querySelector('input[type="password"]'), 'password form for the MFA account');
        await fill(document.querySelector('input[type="password"]'), 'mojo');
        await React.act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        await waitFor(() => document.querySelector('[data-testid="mfa-panel"]'), 'existing MFA panel loads');
        assert(document.querySelector('dialog[open] [data-testid="mfa-panel"]'), 'MFA stays in the native confirmation dialog');
        await fill(document.querySelector('input[autocomplete="one-time-code"]'), '123456');
        await React.act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        await waitFor(() => !document.querySelector('dialog'), 'MFA confirmation completes');
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
        let exchanges = [];
        let grantUid = 9;
        globalThis.fetch = async url => { exchanges.push(String(url)); return Response.json({ status: true, data: { access_token: jwt(grantUid, 100), refresh_token: jwt(grantUid, 100), user: { id: grantUid } } }); };
        let step = crossAuth.openHostedStepUp({ remember: false });
        assert.equal(new URL(opened.at(-1).url).origin, 'https://auth.test', 'Separate-origin deployment signs in at its configured auth origin');
        await deliver({ type: 'mojo:stepup', nonce: nonceOf(opened.at(-1)), code: 'c-other' });
        assert.equal(await step.result, 'other-account', 'Another account is refused before it touches storage');
        assert.deepEqual(exchanges, ['https://auth.test/api/auth/exchange'], 'Handoff exchanges only at the configured API');
        assert.equal(crossAuth.getAuthSnapshot().uid, '4', 'This tab keeps its account');
        grantUid = 4;
        step = crossAuth.openHostedStepUp({ remember: false });
        await deliver({ type: 'mojo:stepup', nonce: nonceOf(opened.at(-1)), code: 'c-same' });
        assert.equal(await step.result, 'confirmed', 'The code is exchanged by the opener');
        assert.equal(crossAuth.sessionIsPersistent(), false, 'Separate-origin step-up remains session-only');
        assert.equal(location.href, returnTo, 'Separate-origin step-up never navigates');
        crossAuth.stopAutoRefresh();
    } finally { await hosted.close(); }
    console.log('PASS hosted reauth: in-place StrictMode host, account-matched methods, inline password, Google pop-up relay (origin/nonce/window checks), other-account refusal and restore, storage completion when the link back is cut, same-tab fallback return, blocked/closed/reopened pop-up, same-account session continuity, relay landing, full-page return compatibility, lazy inline MFA, separate-origin code exchange');
} finally {
    await React.act(async () => root.unmount()); auth.stopAutoRefresh(); await server.close(); dom.window.close();
}
