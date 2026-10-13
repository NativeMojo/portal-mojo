import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

import { JSDOM } from 'jsdom';
import { createElement, act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://verify.invalid/' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'localStorage', 'sessionStorage']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const realTimeout = AbortSignal.timeout;
let deadlines = [];
AbortSignal.timeout = ms => { const c = new AbortController(); deadlines.push({ ms, expire: () => c.abort(new DOMException('Refresh deadline', 'TimeoutError')) }); return c.signal; };
const realNow = Date.now;
let now = realNow();
Date.now = () => now;
const jwt = (lifetime, uid = 42) => `e30.${Buffer.from(JSON.stringify({ uid, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + lifetime })).toString('base64url')}.synthetic`;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const response = (status, data) => ({ ok: status < 400, status, json: async () => ({ status: status < 400, data, error: 'Fixture refusal' }) });
class Clock {
    timers = new Map(); next = 1;
    now = () => now;
    random = () => .5;
    setTimeout = (fn, ms) => { const id = this.next++; this.timers.set(id, { fn, at: now + ms }); return id; };
    clearTimeout = id => this.timers.delete(id);
    advance(ms) { now += ms; for (const [id, timer] of [...this.timers]) if (timer.at <= now) { this.timers.delete(id); timer.fn(); } }
}
let refreshes = [], protectedCalls = 0;
globalThis.fetch = (url, opts) => {
    if (!String(url).endsWith('/api/token/refresh')) { protectedCalls++; return Promise.resolve(response(200, {})); }
    return new Promise((resolve, reject) => {
        refreshes.push({ resolve, signal: opts.signal });
        opts.signal?.addEventListener('abort', () => reject(opts.signal.reason), { once: true });
    });
};
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ root, appType: 'custom', logLevel: 'silent',
    define: { 'import.meta.env.VITE_MOJO_API': JSON.stringify('https://verify.invalid') }, server: { middlewareMode: true } });
let auth;
try {
    auth = await vite.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
    const { mojoCall } = await vite.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
    const { RealtimeClient, RealtimeProvider } = await vite.ssrLoadModule('/packages/portal-mojo/src/client/realtime.ts');
    function rig(lifetime = -1, bind = true) {
        auth.logout(); refreshes = []; deadlines = []; protectedCalls = 0;
        auth.setTokens(jwt(lifetime), jwt(86400), false); auth.initAuth();
        const clock = new Clock(), sockets = [], sent = [], states = [];
        const client = new RealtimeClient({ clock, socketFactory: () => {
            const socket = { readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null,
                send: raw => sent.push(JSON.parse(raw)),
                close: (code = 1000) => { socket.readyState = 3; socket.onclose?.({ code }); },
                open: () => { socket.readyState = 1; socket.onopen?.({}); },
                frame: frame => socket.onmessage?.({ data: JSON.stringify(frame) }),
            };
            sockets.push(socket); return socket;
        } });
        const unstatus = client.subscribeStatus(() => states.push(client.getStatus().status));
        const unsub = bind ? client.bindAuthSession() : () => {};
        if (bind) client.setEnabled(true);
        return { client, clock, sockets, sent, states, unbind: unsub, cleanup: () => { unsub(); unstatus(); client.destroy(); auth.stopAutoRefresh(); } };
    }
    const succeed = (uid = 42) => { const access = jwt(7200, uid); refreshes.at(-1).resolve(response(200, { access_token: access, refresh_token: jwt(86400, uid) })); return access; };
    const authenticate = async r => { const s = r.sockets.at(-1); s.open(); s.frame({ type: 'auth_required' }); await flush(); return s; };

    // The HTTP gate and the first WebSocket authentication share one refresh.
    {
        const r = rig();
        const http = mojoCall('/api/protected');
        await flush();
        assert.equal(refreshes.length, 1);
        assert.equal(r.sockets.length, 0, 'expired credentials must be renewed BEFORE creating a socket');
        assert.equal(protectedCalls, 0);
        const renewed = succeed(); await http; await flush();
        assert.equal(r.sockets.length, 1, 'token rotation and pending preparation must create only one socket');
        const s = await authenticate(r);
        assert.equal(r.sent.length, 1); assert.equal(r.sent[0].token, renewed);
        s.frame({ type: 'auth_success', user_id: 42, user_type: 'user' });
        assert.equal(r.client.getStatus().status, 'ready');
        assert(!r.states.includes('auth-failed'));
        r.cleanup();
    }
    // A refresh-only stored session is enough to recover at startup.
    {
        const r = rig(-1, false);
        sessionStorage.removeItem('access_token');
        const unbind = r.client.bindAuthSession(); r.client.setEnabled(true);
        await flush(); assert.equal(refreshes.length, 1); assert.equal(r.sockets.length, 0);
        succeed(); await flush(); assert.equal(r.sockets.length, 1);
        unbind(); r.cleanup();
    }

    // Sleep past expiry, then repeated focus events: one renewal, one socket.
    {
        const r = rig(7200); await flush();
        const old = await authenticate(r); old.frame({ type: 'auth_success' });
        now += 7_500_000; old.close(1001);
        for (let i = 0; i < 10; i++) r.client.nudge();
        await flush();
        assert.equal(refreshes.length, 1); assert.equal(r.sockets.length, 1);
        const renewed = succeed(); await flush();
        assert.equal(r.sockets.length, 2);
        const fresh = await authenticate(r);
        assert.equal(r.sent.filter(f => f.type === 'authenticate').at(-1).token, renewed);
        old.frame({ type: 'error', message: 'Token expired' });
        fresh.frame({ type: 'auth_success' });
        assert.equal(r.client.getStatus().status, 'ready');
        assert(!r.states.includes('auth-failed')); r.cleanup();
    }
    // A socket opened with a valid session may receive its challenge after sleep.
    // Repeated challenges, including after send but before ack, send only once.
    {
        const r = rig(7200); await flush();
        const old = r.sockets[0]; old.open(); now += 7_500_000;
        old.frame({ type: 'auth_required' }); old.frame({ type: 'auth_required' });
        await flush(); assert.equal(refreshes.length, 1); assert.equal(r.sent.length, 0);
        old.frame({ type: 'auth_success' });
        assert.equal(r.client.getStatus().status, 'authenticating', 'unsolicited success cannot skip renewal');
        succeed(); await flush();
        const fresh = await authenticate(r); fresh.frame({ type: 'auth_required' }); await flush();
        assert.equal(r.sent.length, 1); fresh.frame({ type: 'auth_success' });
        assert.equal(r.client.getStatus().status, 'ready'); r.cleanup();
    }
    // HTTP/refresh failures and refresh deadline preserve recoverability and do
    // not let protected writes or expired credentials reach the server.
    for (const failure of ['503', 'timeout', '401']) {
        const r = rig();
        const http = mojoCall('/api/protected', { method: 'POST', body: { change: true } }).catch(e => e);
        await flush(); assert.equal(refreshes.length, 1); assert.equal(deadlines[0].ms, 15_000);
        if (failure === 'timeout') deadlines[0].expire();
        else refreshes[0].resolve(response(Number(failure), {}));
        const error = await http; await flush();
        assert(error instanceof Error); assert.equal(protectedCalls, 0); assert.equal(r.sockets.length, 0);
        assert.equal(r.client.getStatus().status, failure === '401' ? 'auth-failed' : 'backoff');
        if (failure === '401') {
            r.client.nudge(); r.clock.advance(60_000); await flush(); assert.equal(refreshes.length, 1);
        } else {
            r.clock.advance(2_000); await flush(); assert.equal(refreshes.length, 2);
            succeed(); await flush(); assert.equal(r.sockets.length, 1);
            assert(!r.states.includes('auth-failed'));
        }
        r.cleanup();
    }
    // Server handshake timeout before credentials were sent is a transport
    // timeout. The same text after send and any generic auth error still deny.
    for (const outcome of ['success', '503']) {
        const r = rig(7200); await flush();
        const old = r.sockets[0]; old.open(); now += 7_500_000;
        old.frame({ type: 'auth_required' }); await flush();
        old.frame({ type: 'error', message: 'Authentication timeout' });
        assert.equal(r.client.getStatus().status, 'backoff');
        r.clock.advance(2_000); await flush(); assert.equal(refreshes.length, 1);
        if (outcome === 'success') succeed(); else refreshes[0].resolve(response(503, {}));
        await flush();
        assert.equal(r.sockets.length, outcome === 'success' ? 2 : 1);
        assert(!r.states.includes('auth-failed')); r.cleanup();
    }
    for (const message of ['Token expired', 'Authentication timeout']) {
        const r = rig(7200); await flush(); const socket = await authenticate(r);
        socket.frame({ type: 'error', message });
        assert.equal(r.client.getStatus().status, 'auth-failed'); r.cleanup();
    }
    // Logout/unmount/disable fence late completion; account replacement may
    // connect only the new actor and stale socket frames have no authority.
    for (const action of ['logout', 'disable', 'unbind', 'account']) {
        const r = rig(); await flush();
        const pending = refreshes[0];
        if (action === 'logout') auth.logout();
        if (action === 'disable') r.client.setEnabled(false);
        if (action === 'unbind') r.cleanup();
        if (action === 'account') auth.setTokens(jwt(7200, 99), jwt(86400, 99), false);
        await flush();
        pending.resolve(response(200, { access_token: jwt(7200), refresh_token: jwt(86400) }));
        await flush();
        assert.equal(r.sockets.length, action === 'account' ? 1 : 0);
        if (action === 'account') {
            await authenticate(r);
            assert.equal(JSON.parse(Buffer.from(r.sent[0].token.split('.')[1], 'base64url')).uid, 99);
        }
        if (action === 'disable') { r.client.setEnabled(true); await flush(); assert.equal(r.sockets.length, 1); }
        r.cleanup();
    }
    // A refresh started before revocation must not revive that connection.
    // An intentional replacement session can still authenticate afterwards.
    for (const terminal of ['forced-disconnect', 'auth-failed']) {
        const r = rig(7200); await flush();
        const old = r.sockets[0]; old.open(); now += 7_500_000;
        old.frame({ type: 'auth_required' }); await flush();
        if (terminal === 'forced-disconnect') old.frame({ type: 'message', timestamp: now / 1000, data: { type: 'disconnect', reason: 'forced_disconnect' } });
        else old.frame({ type: 'error', message: 'Token expired' });
        assert.equal(r.client.getStatus().status, terminal);
        succeed(); await flush();
        assert.equal(r.client.getStatus().status, terminal, 'a pending renewal cannot clear terminal suspension');
        r.unbind(); const rebound = r.client.bindAuthSession(); r.client.setEnabled(true);
        assert.equal(r.client.getStatus().status, terminal, 'rebinding the same renewed session retains suspension');
        r.client.nudge(); r.clock.advance(60_000); await flush();
        assert.equal(r.sockets.length, 1, 'revocation must not open a replacement socket');
        auth.setTokens(jwt(7200, 99), jwt(86400, 99), false); await flush();
        assert.equal(r.sockets.length, 2, 'an intentional new session can connect');
        rebound(); r.cleanup();
    }
    // Admission cooldown survives token rotation, unmount/remount and focus.
    {
        const r = rig(7200); await flush(); const socket = await authenticate(r);
        socket.frame({ type: 'error', message: 'Too many connections' });
        now += 1_000; auth.setTokens(jwt(7200), jwt(86400), false);
        r.client.setEnabled(false); r.client.setEnabled(true);
        for (let i = 0; i < 10; i++) r.client.nudge();
        await flush(); assert.equal(r.sockets.length, 1); assert.equal(refreshes.length, 0);
        r.clock.advance(59_000); await flush(); assert.equal(r.sockets.length, 2);
        const fresh = await authenticate(r); fresh.frame({ type: 'auth_success' });
        fresh.frame({ type: 'message', timestamp: now / 1000, data: { type: 'disconnect', reason: 'forced_disconnect' } });
        assert.equal(r.client.getStatus().status, 'forced-disconnect');
        r.client.nudge(); r.clock.advance(60_000); await flush(); assert.equal(r.sockets.length, 2); r.cleanup();
    }
    // Exercise the actual Provider effect lifecycle, including injected clients
    // and StrictMode cleanup; the old text-match assertion missed this race.
    {
        const r = rig(-1, false); const root = createRoot(document.getElementById('root'));
        await act(async () => { root.render(createElement(StrictMode, null, createElement(RealtimeProvider, { client: r.client }))); await flush(); });
        assert.equal(refreshes.length, 1); assert.equal(r.sockets.length, 0);
        await act(async () => { succeed(); await flush(); }); assert.equal(r.sockets.length, 1);
        await act(async () => root.unmount());
        auth.setTokens(jwt(7200, 99), jwt(86400, 99), false); await flush();
        assert.equal(r.sockets.length, 1); assert.equal(r.sockets[0].readyState, 3); r.cleanup();
    }
    console.log('Realtime auth: shared renewal, resume, delayed handshake, transient/terminal errors, deadline, actor fences, admission budget and mounted Provider passed.');
} finally { auth?.stopAutoRefresh(); Date.now = realNow; AbortSignal.timeout = realTimeout; await vite.close(); dom.window.close(); }
