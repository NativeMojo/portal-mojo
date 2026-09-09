import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = JSON.parse(await readFile(new URL('./fixtures/admin-source-session-v1.json', import.meta.url)));
const storage = () => {
    const values = new Map();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key), values };
};
const jwt = (seconds = 3600, uid = 1) => `e30.${Buffer.from(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + seconds })).toString('base64url')}.sig`;
const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function browser(path = '/admin/v2/') {
    const events = new Map();
    const on = (type, cb) => { const set = events.get(type) ?? new Set(); set.add(cb); events.set(type, set); };
    const off = (type, cb) => events.get(type)?.delete(cb);
    globalThis.localStorage = storage(); globalThis.sessionStorage = storage();
    globalThis.window = {
        location: { origin: 'https://deployment.test', pathname: path, search: '', hash: '#/users' },
        addEventListener: on, removeEventListener: off, setTimeout, clearTimeout,
        history: { replaceState(_state, _unused, url) {
            const next = new URL(url, window.location.origin);
            Object.assign(window.location, { pathname: next.pathname, search: next.search, hash: next.hash });
        } },
    };
    globalThis.document = { visibilityState: 'visible', hidden: false, addEventListener: on, removeEventListener: off,
        createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
    const messages = [];
    globalThis.BroadcastChannel = class {
        constructor(name) { assert.equal(name, fixture.coordination.channel); }
        postMessage(value) { messages.push(value); }
        close() {}
    };
    let queue = Promise.resolve();
    let held = 0;
    const locks = { request(name, callback) {
        assert.equal(name, fixture.coordination.lock);
        const result = queue.then(async () => {
            assert.equal(held++, 0, 'Cookie mutations must be exclusive');
            try { return await callback(); } finally { held--; }
        });
        queue = result.catch(() => {});
        return result;
    } };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks, userAgent: 'fixture' } });
    return { messages, dispatch: (type) => events.get(type)?.forEach((cb) => cb({ key: fixture.coordination.storage })), locks };
}
async function modules(mode) {
    const vite = await createServer({ root, configFile: false, envFile: false, appType: 'custom', logLevel: 'silent',
        define: { 'import.meta.env.VITE_MOJO_API': JSON.stringify(mode === 'live' ? 'https://explicit.test' : ''),
            'import.meta.env.VITE_MOJO_PACKAGED_ADMIN': JSON.stringify(mode === 'packaged' ? '1' : '') },
        server: { middlewareMode: true } });
    const load = (path) => vite.ssrLoadModule(path);
    const client = await load('/packages/portal-mojo/src/client/client.ts');
    const auth = await load('/packages/portal-mojo/src/client/auth.ts');
    return { vite, load, client, auth };
}

for (const mode of ['mock', 'live', 'packaged']) {
    browser();
    const { vite, load, client, auth } = await modules(mode);
    try {
        assert.equal(client.usingMockTransport(), mode === 'mock');
        assert.equal(client.isPackagedAdmin(), mode === 'packaged');
        const origin = mode === 'mock' ? '' : mode === 'live' ? 'https://explicit.test' : window.location.origin;
        assert.equal(client.apiOrigin(), origin);
        assert.equal(auth.hostedAuthUrl()?.startsWith(origin + '/auth?redirect=') ?? false, mode !== 'mock');
        const shortlinks = await load('/packages/portal-mojo/src/admin/shortlinks/models.ts');
        assert.equal(shortlinks.functionalShortlinkUrl('a b'), origin + '/s/a%20b');
        const { RealtimeClient } = await load('/packages/portal-mojo/src/client/realtime.ts');
        const realtime = new RealtimeClient();
        if (origin) assert.equal(realtime.url, origin.replace('https:', 'wss:') + '/ws/realtime/');
        const requests = [];
        globalThis.fetch = async (url, options = {}) => {
            requests.push({ url, options });
            if (String(url).includes('download_format')) return new Response('csv');
            return Response.json({ status: true, data: { access_token: jwt(), refresh_token: jwt(7200), user: { id: 1 } } });
        };
        auth.initAuth();
        if (mode === 'mock') {
            await auth.login('showcase.operator@nativemojo.com', 'mojo');
            await client.mojoCall('/api/user/me');
            assert.equal(requests.length, 0, 'Unset-env development must remain mock');
        } else {
            for (const persistent of [true, false]) {
                auth.setTokens('malformed-dead-access', 'malformed-dead-refresh', persistent);
                await auth.login('operator', 'password', { remember: persistent });
                assert.equal(auth.sessionIsPersistent(), persistent, 'Carried login recovery preserves requested storage');
                assert(requests.some(({ url }) => url === origin + '/api/login'));
                await auth.refreshTokens();
                assert.equal(auth.sessionIsPersistent(), persistent, 'Refresh must preserve storage');
                assert.equal((persistent ? sessionStorage : localStorage).getItem('access_token'), null);
            }
            await client.mojoCall('/api/user/me');
            auth.setTokens('expired-access', 'expired-refresh');
            assert(await auth.exchangeAuthCode('one-time-code'), 'Hosted sign-in must recover from a dead session');
            assert(requests.some(({ url }) => url === origin + '/api/auth/exchange'));
            await client.mojoDownload('/api/user', {}, 'csv');
            assert(requests.every(({ url }) => url.startsWith(origin + '/api/')));
            const { startFileUpload } = await load('/packages/portal-mojo/src/client/upload.ts');
            for (const provider of ['/fileman/transfer', 'https://provider.test/signed-upload']) {
                let completed = false; const transfers = [];
                globalThis.XMLHttpRequest = class {
                    headers = {}; upload = {}; status = 200;
                    open(method, url) { this.method = method; this.url = url; }
                    setRequestHeader(key, value) { this.headers[key] = value; }
                    send() { transfers.push(this); queueMicrotask(() => { this.onload(); this.onloadend(); }); }
                    abort() { this.onabort(); }
                };
                globalThis.fetch = async (url, options = {}) => {
                    requests.push({ url, options });
                    if (options.method === 'POST' && String(url).includes('/fileman/file/')) completed = true;
                    return Response.json({ status: true, data: {
                        id: 123, filename: 'proof.txt', content_type: 'text/plain', file_size: 5,
                        upload_status: completed ? 'completed' : 'uploading', upload_url: provider, method: 'PUT',
                    } });
                };
                const result = await startFileUpload(new File(['proof'], 'proof.txt', { type: 'text/plain' })).result;
                assert.equal(result.status, 'completed', 'Full initiate/transfer/complete flow');
                assert.equal(transfers[0].url, provider.startsWith('/') ? origin + '/api' + provider : provider);
                assert(!transfers[0].headers.Authorization && !transfers[0].headers['X-Mojo-UID']);
                assert.notEqual(transfers[0].withCredentials, true);
            }
            assert(requests.every(({ url }) => url.startsWith(origin + '/api/')));
        }
    } finally { auth.stopAutoRefresh(); await vite.close(); }
}

async function scenario(run, path) {
    const env = browser(path);
    const { vite, load, auth } = await modules('packaged');
    const coordinator = await load('/apps/portal/src/admin-source-session.ts');
    const calls = [];
    let responseData = () => ({ ...fixture.response.data, path: window.location.pathname.replace(/v2\/$/, ''), source_session_expires_at: Math.floor(Date.now() / 1000) + 300 });
    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url, method: options.method });
        if (String(url).endsWith('_session')) return new Response(null, { status: 204 });
        if (String(url).endsWith('/api/token/refresh')) return Response.json({ status: true, data: { access_token: jwt(), refresh_token: jwt(7200) } });
        return Response.json({ status: true, data: responseData() });
    };
    try {
        await run({ ...env, coordinator, auth, calls, setResponse: (data) => { responseData = () => data; } });
    } finally { coordinator.disposeAdminSourceSession(); auth.stopAutoRefresh(); await vite.close(); }
}

await scenario(async ({ coordinator: c, auth, calls }) => {
    assert.deepEqual(c.SOURCE_PROTOCOL, Object.fromEntries(['version', 'lock', 'storage', 'channel'].map((key) => [key, fixture.coordination[key]])));
    const grant = c.validateSourceGrant({ ...fixture.response.data, path: '/custom/' }, 2_000_000_000_000);
    assert.equal(grant.expiresAt, 2_000_000_300_000);
    assert.equal(grant.renewAt, 2_000_000_210_000, 'Renew at 70% of actual bounded lifetime');
    c.initializeAdminSourceSession(); auth.initAuth();
    sessionStorage.setItem('refresh_token', jwt(7200));
    await Promise.all([c.ensureAdminSourceSession(), c.ensureAdminSourceSession(), c.ensureAdminSourceSession()]);
    assert.equal(c.getAdminSourceSnapshot().status, 'ready');
    assert.equal(auth.sessionIsPersistent(), false, 'Refresh-only boot remains sessionStorage');
    assert.equal(calls.filter(({ url }) => url.endsWith('/admin/session')).length, 1, 'Single-flight issuance');
    assert.equal(calls.filter(({ url }) => url.endsWith('/token/refresh')).length, 1, 'Single-flight refresh');
    let loaded = false;
    await c.withAdminSourceSession(async () => { loaded = true; })();
    assert(loaded);
    await c.revokeAdminSourceSession();
    assert.equal(calls.at(-1).url, '/custom/_session');
    assert.equal(c.getAdminSourceSnapshot().status, 'expired');
    assert.equal(auth.getAccessToken(), null);
    assert.equal(JSON.parse(localStorage.getItem(fixture.coordination.storage)).state, 'revoked');
    loaded = false;
    await assert.rejects(c.withAdminSourceSession(async () => { loaded = true; })()); assert(!loaded);
}, '/custom/v2/');

await scenario(async ({ coordinator: c, auth, calls, dispatch }) => {
    c.initializeAdminSourceSession(); auth.initAuth(); auth.setTokens(jwt(), jwt(7200));
    await c.ensureAdminSourceSession();
    const stable = c.getAdminSourceSnapshot();
    assert.equal(stable, c.getAdminSourceSnapshot(), 'Readiness snapshot is stable');
    let updates = 0; const unsubscribe = c.subscribeAdminSourceSession(() => updates++);
    // Simulate a suspended tab waking after the actual cookie deadline.
    const realNow = Date.now;
    Date.now = () => realNow() + 400_000;
    try { dispatch('pageshow'); await c.ensureAdminSourceSession(); }
    finally { Date.now = realNow; }
    assert(calls.filter(({ url }) => url.endsWith('/admin/session')).length >= 2);
    assert(updates > 0); unsubscribe();
    const before = calls.length;
    auth.setTokens(jwt(4000), jwt(8000));
    await turn(); await c.ensureAdminSourceSession();
    assert(calls.length > before, 'Token replacement renews source grant');
    assert(calls.length < 8, 'Auth notifications cannot recursively issue');
});

for (const data of [null, {}, { ...fixture.response.data, path: '//evil.test/' },
    { ...fixture.response.data, path: '/other/' }, { ...fixture.response.data, path: '/admin/../other/' },
    { ...fixture.response.data, source_session_expires_in: '300' },
    { ...fixture.response.data, source_session_expires_at: 1 }]) {
    await scenario(async ({ coordinator: c, auth, setResponse }) => {
        c.initializeAdminSourceSession(); auth.initAuth(); auth.setTokens(jwt(), jwt(7200)); setResponse(data);
        await assert.rejects(c.ensureAdminSourceSession());
        assert.notEqual(c.getAdminSourceSnapshot().status, 'ready', 'Malformed grants cannot establish readiness');
    });
}
await scenario(async ({ coordinator: c, auth }) => {
    c.initializeAdminSourceSession(); auth.initAuth(); auth.setTokens(jwt(), jwt(7200));
    globalThis.fetch = async () => Response.json({ status: false }, { status: 403 });
    await assert.rejects(c.ensureAdminSourceSession()); assert.equal(c.getAdminSourceSnapshot().status, 'denied');
});
await scenario(async ({ coordinator: c, auth }) => {
    c.initializeAdminSourceSession(); auth.initAuth(); auth.setTokens(jwt(), jwt(7200));
    const originalTimeout = globalThis.setTimeout;
    const pending = []; let attempts = 0;
    globalThis.setTimeout = (callback, delay) => { pending.push({ callback, delay }); return 987654; };
    globalThis.fetch = async () => { attempts++; throw new TypeError('Offline'); };
    try {
        await assert.rejects(c.ensureAdminSourceSession());
        assert.equal(c.getAdminSourceSnapshot().status, 'unavailable');
        assert.equal(pending.length, 1); assert.equal(pending[0].delay, 1000);
        pending.shift().callback(); await assert.rejects(c.ensureAdminSourceSession());
        assert.equal(pending.length, 1); assert.equal(pending[0].delay, 2000);
        pending.shift().callback(); await assert.rejects(c.ensureAdminSourceSession());
        assert.equal(attempts, 3); assert.equal(pending.length, 0, 'Retry budget is bounded');
    } finally { globalThis.setTimeout = originalTimeout; }
});
await scenario(async ({ coordinator: c, auth }) => {
    localStorage.setItem(fixture.coordination.storage, JSON.stringify(fixture.coordination.record));
    c.initializeAdminSourceSession(); auth.initAuth();
    globalThis.fetch = async (url) => Response.json({ status: true, data: String(url).endsWith('/api/login')
        ? { access_token: jwt(), refresh_token: jwt(7200), user: { id: 1 } }
        : { ...fixture.response.data, source_session_expires_at: Math.floor(Date.now() / 1000) + 300 } });
    await auth.login('operator', 'password');
    await c.ensureAdminSourceSession();
    assert.equal(c.getAdminSourceSnapshot().status, 'ready', 'Explicit fresh login may activate a captured tombstone');
    assert.equal(JSON.parse(localStorage.getItem(fixture.coordination.storage)).state, 'active');
});
await scenario(async ({ coordinator: c, auth, messages }) => {
    c.initializeAdminSourceSession(); auth.initAuth(); auth.setTokens(jwt(), jwt(7200), false);
    const started = deferred(); const response = deferred(); const deleted = deferred();
    const order = [];
    globalThis.fetch = async (url) => {
        if (String(url).endsWith('/admin/session')) {
            order.push('issue'); started.resolve(); await response.promise;
            order.push('issue-response');
            return Response.json({ status: true, data: { ...fixture.response.data, source_session_expires_at: Math.floor(Date.now() / 1000) + 300 } });
        }
        order.push('delete'); await deleted.promise; order.push('delete-response'); return new Response(null, { status: 204 });
    };
    const issue = c.ensureAdminSourceSession(); const rejection = assert.rejects(issue);
    await started.promise;
    const signout = c.revokeAdminSourceSession(); let done = false; signout.then(() => { done = true; });
    assert.equal(JSON.parse(localStorage.getItem(fixture.coordination.storage)).state, 'revoked', 'Tombstone is immediate');
    assert.equal(auth.getAccessToken(), null);
    await turn(); assert.deepEqual(order, ['issue']); assert(!done);
    response.resolve(); await rejection; await turn();
    assert.deepEqual(order, ['issue', 'issue-response', 'delete']); assert(!done);
    deleted.resolve(); await signout;
    assert.deepEqual(order, ['issue', 'issue-response', 'delete', 'delete-response']);
    // A stale sessionStorage tab/token refresh may restore JS tokens; it must not mint source access.
    auth.setTokens(jwt(), jwt(7200), false);
    await assert.rejects(c.ensureAdminSourceSession());
    assert(messages.every((message) => Object.keys(message).sort().join(',') === 'generation,state,type,version'));
    assert(messages.every((message) => !JSON.stringify(message).includes('sig')));
});
await scenario(async ({ coordinator: c, auth, locks }) => {
    const blocked = deferred();
    const holder = locks.request(fixture.coordination.lock, () => blocked.promise);
    c.initializeAdminSourceSession(); auth.initAuth(); auth.setTokens(jwt(), jwt(7200));
    const waiting = c.ensureAdminSourceSession(); const rejected = assert.rejects(waiting);
    const tombstone = fixture.coordination.record;
    localStorage.setItem(fixture.coordination.storage, JSON.stringify(tombstone));
    blocked.resolve(); await holder; await rejected;
    assert.equal(c.getAdminSourceSnapshot().status, 'expired', 'Queued issue must recheck generation after acquiring lock');
});
await scenario(async ({ coordinator: c }) => {
    navigator.locks = undefined;
    c.initializeAdminSourceSession();
    assert.equal(c.getAdminSourceSnapshot().status, 'unsupported');
    await assert.rejects(c.ensureAdminSourceSession());
});

// Consumer seams are declarative: protect every actual lazy callback, not only router.lazy.
const source = async (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
const main = await source('apps/portal/src/main.tsx');
assert(main.indexOf('initializeAdminSourceSession();') < main.indexOf('mojo.initAuth();'));
assert(main.indexOf('handleAuthTokenLanding();') < main.indexOf('function createAdminRouter'));
assert.match(main, /await authExchange;\s*await ensureAdminSourceSession\(\);\s*router\?\.dispose\(\);\s*router = createAdminRouter\(\)/);
assert.match(await source('apps/portal/src/admin-sections.ts'), /withAdminSourceSession\(route.loadComponent\)/);
assert.equal(((await source('apps/portal/src/pages/admin-routes.tsx')).match(/withAdminSourceSession\(\(\) => import/g) ?? []).length, 2);
assert.equal(((await source('apps/portal/src/pages/auth/routes.tsx')).match(/withAdminSourceSession\(\(\) => import/g) ?? []).length, 4);
assert.match(await source('apps/portal/src/components/Sidebar.tsx'), /usingMockTransport\(\)/);
assert.match(await source('apps/portal/src/components/Sidebar.tsx'), /v\{version\}/);
assert(!/import\s*\(|location\.reload/.test(await source('apps/portal/src/AdminSourceSessionGate.tsx')));
assert.match(await source('packages/portal-mojo/src/client/upload.ts'), /new URL\(url, origin\)/);
assert.match(await source('packages/portal-mojo/src/client/upload.ts'), /apiOrigin\(\)/);
assert(!/withCredentials\s*=\s*true/.test(await source('packages/portal-mojo/src/client/upload.ts')), 'Provider transfers must not acquire API cookies');
console.log('verify:admin-runtime OK — transport modes, storage/login recovery, refresh-only boot, source lifecycle, suspension, malformed/denied grants, lazy seams, serialized issue/logout fixtures; real Set-Cookie browser race proof belongs to Django');
