// verify-action-results — the #1608 inside-the-200 action refusal contract.
//
// django-mojo action handlers fail INSIDE an HTTP 200 as either the flat
// `{success:false, code, error}` dict or the wrapped
// `{status:true, data:{success:false,…}}` shape; `revoke_sessions` spells the
// flag `status` inside its payload. Envelope-level `status:false` is a
// DIFFERENT failure and already rejects at the unwrap boundary.
//
// This script asserts, in order:
//   1. `readActionResult` over the full fixture matrix (both refusal shapes,
//      the `status` spelling, both success shapes, the diagnostic flag,
//      payload merge order, one-shot secrets from both directions);
//   2. `mojoAction` against the REAL mock transport (auth hooks installed
//      directly — no JWT refresh machinery): resolves on the happy disable,
//      throws ActionRefusedError(ALREADY_DISABLED) on the duplicate;
//   3. source wiring: useAction normalizes + throws with the
//      `refusal ?? 'reject'` default, and ui/ModelTable.tsx never imports
//      action-result (the #1937 boundary).
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

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
    root,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
});

try {
    const actionResult = await server.ssrLoadModule('/packages/portal-mojo/src/client/action-result.ts');
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
    const errors = await server.ssrLoadModule('/packages/portal-mojo/src/client/errors.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const { readActionResult, mojoAction, ActionRefusedError } = actionResult;

    // ── 1. readActionResult fixture matrix ────────────────────────────
    const flatRefusal = readActionResult({ success: false, code: 'WRONG_STATUS', error: 'User is already disabled' });
    assert.equal(flatRefusal.ok, false, 'flat success:false must refuse');
    assert.equal(flatRefusal.code, 'WRONG_STATUS');
    assert.equal(flatRefusal.error, 'User is already disabled');

    const wrappedRefusal = readActionResult({ status: true, data: { success: false, code: 'MISSING_DETAILS', error: 'details required' } });
    assert.equal(wrappedRefusal.ok, false, 'wrapped data.success:false must refuse');
    assert.equal(wrappedRefusal.code, 'MISSING_DETAILS');
    assert.equal(wrappedRefusal.error, 'details required');

    // The `status`-spelling oddball (revoke_sessions payload).
    const statusSpelled = readActionResult({ status: true, data: { status: false, error: 'sessions locked' } });
    assert.equal(statusSpelled.ok, false, 'payload status:false (revoke_sessions spelling) must refuse');
    assert.equal(statusSpelled.error, 'sessions locked');

    const flatSuccess = readActionResult({ status: true, message: 'Sessions revoked. Re-authenticate to continue.' });
    assert.equal(flatSuccess.ok, true, 'a truthy flat payload must resolve');
    assert.equal(flatSuccess.payload.message, 'Sessions revoked. Re-authenticate to continue.');

    const wrappedSuccess = readActionResult({ status: true, data: { username: 'renamed' } });
    assert.equal(wrappedSuccess.ok, true, 'a wrapped success payload must resolve');
    assert.equal(wrappedSuccess.payload.username, 'renamed', 'action fields must surface through payload');

    // Diagnostic flag: refuses (ok:false) but carries NO code/error — the
    // caller that wants it as a datum declares `refusal:'return'`.
    const diagnostic = readActionResult({ status: true, data: { success: false, key_count: 0 } });
    assert.equal(diagnostic.ok, false);
    assert.equal(diagnostic.code, undefined, 'a diagnostic refusal has no semantic code');
    assert.equal(diagnostic.error, undefined, 'a diagnostic refusal has no error text');
    assert.equal(diagnostic.payload.key_count, 0, 'diagnostic data stays readable from payload');

    // Merge order: the action dict WINS over envelope fields.
    const merged = readActionResult({ status: true, note: 'env', data: { note: 'action' } });
    assert.equal(merged.payload.note, 'action', 'payload merge must prefer the action dict');

    // One-shot secrets ride top-level on create, inside the payload on
    // rotate — both read from the same place.
    assert.equal(readActionResult({ status: true, token: 'tok-create' }).payload.token, 'tok-create',
        'a top-level (create-direction) secret must be readable from payload');
    assert.equal(readActionResult({ status: true, data: { token: 'tok-rotate' } }).payload.token, 'tok-rotate',
        'an action-dict (rotate-direction) secret must be readable from payload');

    // Envelope-vs-action distinction: readActionResult does NOT treat
    // top-level status:false as a refusal — that is unwrap's jurisdiction
    // (it never reaches this layer).
    assert.equal(readActionResult({ status: false, error: 'envelope failure' }).ok, true,
        'envelope-level status:false is not an action refusal (unwrap already rejects it)');

    // ── 2. mojoAction against the real mock transport ─────────────────
    // Auth hooks installed directly with a mock-minted token: the real
    // header path without the refresh watcher.
    const loginBody = await mock.mockFetch('/api/login', {
        method: 'POST', body: { username: 'groups.manager@nativemojo.com', password: 'mojo' },
    });
    const token = loginBody?.data?.access_token;
    assert.equal(typeof token, 'string', 'mock login must mint an access token');
    client.installAuthHooks({
        async preRequest() {},
        authHeader: () => `Bearer ${token}`,
    });
    const authed = { Authorization: `Bearer ${token}` };

    const directory = await mock.mockFetch('/api/user', { headers: authed, params: { size: 100 } });
    const target = directory.data.find((row) => row.is_active && row.id !== 13);
    assert(target, 'mock seeds must include an active target user');

    // Happy path: resolves with the refreshed row in the merged payload.
    const disabled = await mojoAction('/api/user', target.id, 'disable', { reason: 'admin' });
    assert.equal(disabled.ok, true);
    assert.equal(disabled.payload.is_active, false, 'the refreshed row rides the merged payload');

    // The duplicate disable is the mock's flat ALREADY_DISABLED refusal —
    // inside the 200, so it must reject HERE, not at unwrap.
    await assert.rejects(
        () => mojoAction('/api/user', target.id, 'disable', { reason: 'admin' }),
        (err) => {
            assert(err instanceof ActionRefusedError, 'the refusal must throw ActionRefusedError');
            assert(err instanceof errors.MojoError, 'ActionRefusedError must remain a MojoError');
            assert.equal(err.status, 200, 'the HTTP layer succeeded — the handler refused');
            assert.equal(err.errorCode, 'ALREADY_DISABLED');
            assert.equal(err.message, 'User is already disabled', 'the toastable message is the backend text');
            assert.equal(err.result.ok, false);
            return true;
        },
    );

    // Restore + prove argument-less actions send `true`.
    const reactivated = await mojoAction('/api/user', target.id, 'reactivate');
    assert.equal(reactivated.ok, true);
    assert.equal(reactivated.payload.is_active, true, 'reactivate must restore the seed row');

    // Reason validation stayed an ENVELOPE rejection (unwrap's MojoError,
    // never ActionRefusedError) — the two layers must not blur.
    await assert.rejects(
        () => mojoAction('/api/user', target.id, 'disable', { reason: 'bogus' }),
        (err) => {
            assert(!(err instanceof ActionRefusedError), 'an envelope failure is not an action refusal');
            assert(err instanceof errors.MojoError);
            assert.match(err.message, /reason must be one of/);
            return true;
        },
    );
    client.installAuthHooks(null);

    // ── 3. source wiring ──────────────────────────────────────────────
    const modelSource = await readFile(new URL('../packages/portal-mojo/src/client/model.ts', import.meta.url), 'utf8');
    assert.match(modelSource, /readActionResult\(body\)/, 'useAction must normalize through the one reader');
    assert.match(modelSource, /throw new ActionRefusedError\(action, result\)/, 'useAction must throw the typed refusal');
    assert.match(modelSource, /def\.refusal \?\? 'reject'/, "the refusal mode must default to 'reject'");

    const tableSource = await readFile(new URL('../packages/portal-mojo/src/ui/ModelTable.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(tableSource, /action-result/, 'ModelTable must not import action-result (#1937 boundary)');

    const indexSource = await readFile(new URL('../packages/portal-mojo/src/client/index.ts', import.meta.url), 'utf8');
    assert.match(indexSource, /action-result/, 'the client barrel must export the action-result module');

    console.log('action-result contract verified');
} finally {
    await server.close();
}
