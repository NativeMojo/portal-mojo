// verify-token-replacement — a save that changes the caller's own password
// comes back with the only tokens that still work (django-mojo #6226).
//
// django-mojo ends every other session when a password changes. So that the
// device making the change stays signed in, the save answers with a `tokens`
// pair beside `data`. The unwrap boundary must hand that pair to the auth hook
// `tokensReplaced`; a client that drops it sends its user to the sign-in page.
//
// This script asserts:
//   1. an own password change through mojoSave hands the pair to the hook,
//      and the pair keeps the session's auth_time;
//   2. setting SOMEONE ELSE's password hands over nothing;
//   3. a save that changes no password hands over nothing;
//   4. a harness with no `tokensReplaced` hook still gets its response;
//   5. source wiring: initAuth stores the pair in the session's own storage.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
const backing = new Map();
globalThis.localStorage = {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => { backing.set(key, String(value)); },
    removeItem: (key) => { backing.delete(key); },
};

function claims(token) {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
    root,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
});

try {
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');

    const loginBody = await mock.mockFetch('/api/login', {
        method: 'POST', body: { username: 'groups.manager@nativemojo.com', password: 'mojo' },
    });
    const token = loginBody?.data?.access_token;
    assert.equal(typeof token, 'string', 'mock login must mint an access token');
    const me = claims(token);

    const received = [];
    client.installAuthHooks({
        async preRequest() {},
        authHeader: () => `Bearer ${token}`,
        tokensReplaced: (pair) => { received.push(pair); },
    });

    // ── 1. own password change ────────────────────────────────────────
    const saved = await client.mojoSave('/api/user', me.uid, { new_password: 'A-new-strong-password-91!' });
    assert.equal(saved.id, me.uid, 'the save must still resolve with the account');
    assert.equal(received.length, 1, 'an own password change must hand one token pair to the auth hook');
    const [pair] = received;
    assert.equal(typeof pair.access_token, 'string', 'the pair must carry an access token');
    assert.equal(typeof pair.refresh_token, 'string', 'the pair must carry a refresh token');
    assert.equal(claims(pair.access_token).uid, me.uid, 'the new access token must belong to the same account');
    assert.equal(claims(pair.access_token).auth_time, me.auth_time,
        'a password change is not a new sign-in: auth_time must be carried over');

    // ── 2. someone else's password ────────────────────────────────────
    const directory = await mock.mockFetch('/api/user', {
        headers: { Authorization: `Bearer ${token}` }, params: { size: 100 },
    });
    const other = directory.data.find((row) => row.is_active && row.id !== me.uid);
    assert(other, 'mock seeds must include another active user');
    await client.mojoSave('/api/user', other.id, { new_password: 'Another-strong-password-92!' });
    assert.equal(received.length, 1, "setting someone else's password must hand over no tokens");

    // ── 3. a save with no password ────────────────────────────────────
    await client.mojoSave('/api/user', me.uid, { display_name: 'Groups Manager' });
    assert.equal(received.length, 1, 'a save that changes no password must hand over no tokens');

    // ── 3b. the "My account" route ────────────────────────────────────
    // The account modal changes the password with POST /api/user/me, not
    // /api/user/<id>; the pair must come back and be handed over there too.
    await client.mojoCall('/api/user/me', {
        method: 'POST', body: { current_password: 'mojo', new_password: 'A-fourth-strong-password-94!' },
    });
    assert.equal(received.length, 2, 'an own password change through /api/user/me must hand over a token pair');
    assert.equal(claims(received[1].access_token).auth_time, me.auth_time,
        'the /api/user/me route must carry auth_time over as well');

    // ── 4. a harness without the hook ─────────────────────────────────
    client.installAuthHooks({ async preRequest() {}, authHeader: () => `Bearer ${token}` });
    const bare = await client.mojoSave('/api/user', me.uid, { new_password: 'A-third-strong-password-93!' });
    assert.equal(bare.id, me.uid, 'a harness with no tokensReplaced hook must still get its response');
    client.installAuthHooks(null);

    // ── 5. source wiring ──────────────────────────────────────────────
    const authSource = await readFile(new URL('../packages/portal-mojo/src/client/auth.ts', import.meta.url), 'utf8');
    assert.match(authSource,
        /tokensReplaced\(tokens\)\s*\{[\s\S]*?setTokens\(tokens\.access_token, tokens\.refresh_token, sessionIsPersistent\(\)\);/,
        'initAuth must store a replacement pair in the storage the session already lives in');
    const clientSource = await readFile(new URL('../packages/portal-mojo/src/client/client.ts', import.meta.url), 'utf8');
    assert.match(clientSource, /authHooks\?\.tokensReplaced\?\.\(body\.tokens\)/,
        'the unwrap boundary must hand Envelope.tokens to the auth hook');

    console.log('verify-token-replacement: ok');
} finally {
    await server.close();
}
