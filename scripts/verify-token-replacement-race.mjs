// verify-token-replacement-race — a refresh that was already in flight must
// not undo a session that replaced the one it was sent for (django-mojo #6226).
//
// django-mojo ends every other session when a password changes, and the save
// answers with the only pair that still works. A refresh sent just before
// that save was for the old session. Its answer can arrive after the save's:
//   · a late success carries an old-generation pair, signed with the key the
//     server has just replaced. Stored, it signs the user out on the next call;
//   · a late 401 is about the old refresh token. Acted on, it reports the
//     new, working session as unauthorized and stops its upkeep.
// The same holds for a sign-out with a refresh in flight: the late pair must
// not sign the user back in.
//
// This script drives the real auth storage and the real transport, with only
// fetch replaced, and asserts:
//   1. late success after a replacement: the replacement pair stays stored;
//   2. late 401 after a replacement: the pair stays, nothing reports unauthorized;
//   3. late success after a sign-out: the session stays signed out;
//   4. controls, no overlap: a refresh still stores its pair, and a refused
//      refresh still reports unauthorized.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const store = () => {
    const backing = new Map();
    return {
        getItem: (key) => (backing.has(key) ? backing.get(key) : null),
        setItem: (key, value) => { backing.set(key, String(value)); },
        removeItem: (key) => { backing.delete(key); },
    };
};
globalThis.localStorage = store();
globalThis.sessionStorage = store();
globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    location: { origin: 'https://verify.invalid', hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};

function token(generation, kind) {
    const now = Math.floor(Date.now() / 1000);
    const claims = { uid: 42, iat: now, exp: now + 86400, auth_time: now - 4000, generation, token_type: kind };
    return `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic`;
}
const pair = (generation) => ({
    access_token: token(generation, 'access'),
    refresh_token: token(generation, 'refresh'),
});

// One refresh answer at a time, held until the test releases it.
let refreshGate = null;
function holdRefresh() {
    const gate = {};
    gate.started = new Promise((resolve) => { gate.markStarted = resolve; });
    gate.answer = new Promise((resolve) => { gate.release = resolve; });
    refreshGate = gate;
    return gate;
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const refused = () => ({ ok: false, status: 401, json: async () => ({ status: false, error: 'Invalid token signature' }) });

let saveAnswer = null;
globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/token/refresh')) {
        const gate = refreshGate;
        gate.markStarted();
        return gate.answer;
    }
    return ok(saveAnswer);
};

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
    root,
    appType: 'custom',
    logLevel: 'silent',
    define: { 'import.meta.env.VITE_MOJO_API': JSON.stringify('https://verify.invalid') },
    server: { middlewareMode: true },
});

try {
    const auth = await server.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
    assert.equal(client.usingMockTransport(), false, 'this check must run on the network transport');

    const events = [];
    for (const name of ['refreshed', 'unauthorized', 'refresh-failed']) auth.onAuth(name, () => events.push(name));

    function begin(persistent) {
        auth.logout();
        events.length = 0;
        const before = pair('before');
        auth.setTokens(before.access_token, before.refresh_token, persistent);
        auth.initAuth();
        return before;
    }
    async function ownPasswordSave(replacement) {
        saveAnswer = { status: true, data: { id: 42 }, tokens: replacement };
        await client.mojoSave('/api/user', 42, { new_password: 'A-new-strong-password-91!' });
    }

    // ── 1. late success after a replacement ───────────────────────────
    for (const persistent of [true, false]) {
        begin(persistent);
        const gate = holdRefresh();
        const refresh = auth.refreshTokens();
        await gate.started;
        const replacement = pair('after');
        await ownPasswordSave(replacement);
        assert.equal(auth.getAccessToken(), replacement.access_token, 'the save must store the replacement pair');
        gate.release(ok({ status: true, data: pair('before-refreshed') }));
        const result = await refresh;
        assert.equal(auth.getAccessToken(), replacement.access_token,
            'a refresh answered after the replacement must not overwrite the replacement access token');
        assert.equal(auth.getRefreshToken(), replacement.refresh_token,
            'a refresh answered after the replacement must not overwrite the replacement refresh token');
        assert.equal(auth.sessionIsPersistent(), persistent, 'the session must stay in the storage it lives in');
        assert.equal(result, true, 'callers waiting on that refresh must be told the session is usable');
        assert.deepEqual(events, [], 'a superseded refresh must report nothing');
    }

    // ── 2. late 401 after a replacement ───────────────────────────────
    {
        begin(true);
        const gate = holdRefresh();
        const refresh = auth.refreshTokens();
        await gate.started;
        const replacement = pair('after');
        await ownPasswordSave(replacement);
        gate.release(refused());
        const result = await refresh;
        assert.equal(auth.getAccessToken(), replacement.access_token, 'a late refusal must leave the replacement pair stored');
        assert.equal(auth.getRefreshToken(), replacement.refresh_token, 'a late refusal must leave the replacement refresh token stored');
        assert.equal(result, true, 'the session is the replacement, and it is usable');
        assert.deepEqual(events, [], 'a refusal of the old refresh token must not report the new session unauthorized');
    }

    // ── 3. late success after a sign-out ──────────────────────────────
    {
        begin(true);
        const gate = holdRefresh();
        const refresh = auth.refreshTokens();
        await gate.started;
        auth.logout();
        gate.release(ok({ status: true, data: pair('before-refreshed') }));
        const result = await refresh;
        assert.equal(auth.getAccessToken(), null, 'a refresh answered after a sign-out must not sign the user back in');
        assert.equal(auth.getRefreshToken(), null, 'a refresh answered after a sign-out must store no refresh token');
        assert.equal(result, false, 'there is no session to use');
    }

    // ── 4. controls: no overlap ───────────────────────────────────────
    {
        begin(false);
        const gate = holdRefresh();
        const refresh = auth.refreshTokens();
        await gate.started;
        const next = pair('refreshed');
        gate.release(ok({ status: true, data: next }));
        assert.equal(await refresh, true, 'a refresh with nothing in its way must succeed');
        assert.equal(auth.getAccessToken(), next.access_token, 'a refresh with nothing in its way must store its pair');
        assert.equal(auth.sessionIsPersistent(), false, 'a refresh must keep the storage the session lives in');
        assert.deepEqual(events, ['refreshed'], 'a refresh with nothing in its way must report refreshed');
    }
    {
        const before = begin(true);
        const gate = holdRefresh();
        const refresh = auth.refreshTokens();
        await gate.started;
        gate.release(refused());
        assert.equal(await refresh, false, 'a refused refresh of the current session must fail');
        assert.deepEqual(events, ['unauthorized'], 'a refused refresh of the current session must report unauthorized');
        assert.equal(auth.getRefreshToken(), before.refresh_token, 'a refused refresh must not touch the stored tokens');
    }

    auth.logout();
    client.installAuthHooks(null);
    console.log('verify-token-replacement-race: ok');
} finally {
    await server.close();
}
