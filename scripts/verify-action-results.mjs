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
//      action-result (the #1937 boundary);
//   4. the unwrap boundary itself (#5922): a raw mojoCall REJECTS a flat
//      inside-the-200 refusal with ActionRefusedError, `refusal:'return'`
//      opts out, a wrapped `data.success`/`data.status:false` stays data, and
//      the query defaults never retry a refusal.
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
// Section 4's wrapped-data probe: no mock route answers a wrapped
// `{status:true, data:{success:false}}` inside a 2xx, so a stub path is put in
// front of the real mock. Every other path still reaches the real mock.
const MOCK = '/packages/portal-mojo/src/client/mock.ts';
const WRAPPED_PATH = '/__probe/wrapped-refusal';
const wrappedProbe = globalThis.__wrappedProbe = { calls: [] };
const probeMock = `export * from '${MOCK}'; import { mockFetch as real } from '${MOCK}';
export const mockFetch = async (path, opts) => {
    if (path !== '${WRAPPED_PATH}') return real(path, opts);
    globalThis.__wrappedProbe.calls.push(opts.method ?? 'GET');
    return { status: true, data: { success: false, code: 'NOT_LIVE', error: 'deploy queued', step: 'queued' } };
};`;
const server = await createServer({
    root,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
    plugins: [{
        name: 'wrapped-refusal-probe', enforce: 'pre',
        resolveId: (id) => (id === '/__probe_mock.ts' ? id : null),
        load: (id) => (id === '/__probe_mock.ts' ? probeMock : null),
        transform(source, id) {
            if (id.endsWith('/client/client.ts')) return source.replaceAll("import('./mock')", "import('/__probe_mock.ts')");
        },
    }],
});

try {
    const actionResult = await server.ssrLoadModule('/packages/portal-mojo/src/client/action-result.ts');
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
    const errors = await server.ssrLoadModule('/packages/portal-mojo/src/client/errors.ts');
    const mock = await server.ssrLoadModule(MOCK);
    const { readActionResult, mojoAction, ActionRefusedError } = actionResult;
    // The reader and the error moved to errors.ts (#5922); action-result.ts
    // re-exports the same objects, so imports from either place agree.
    assert.equal(readActionResult, errors.readActionResult, 'action-result must re-export the errors.ts reader');
    assert.equal(ActionRefusedError, errors.ActionRefusedError, 'action-result must re-export the errors.ts error');

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

    // A refusal with no string error falls back to a string message
    // (diagnostics and provider refusals put the human text there).
    assert.equal(readActionResult({ success: false, message: 'm' }).error, 'm', 'a refused message must become the error text');
    assert.equal(readActionResult({ status: true, message: 'ok' }).error, undefined, 'a success message is not error text');
    // django-mojo JsonResponse injects a numeric code (the HTTP status) when
    // a body has none: only string codes are refusal codes.
    assert.equal(readActionResult({ success: false, error: 'x', code: 200 }).code, undefined, 'a numeric code must be ignored');

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

    // ── 4. the unwrap boundary rejects a flat refusal (#5922) ─────────
    const userPath = `/api/user/${target.id}`;
    const disableRaw = (opts = {}) => client.mojoCall(userPath, { method: 'POST', body: { disable: { reason: 'admin' } }, unscoped: true, ...opts });
    await mojoAction('/api/user', target.id, 'disable', { reason: 'admin' });
    // The regression: before #5922 this resolved, so a raw caller showed
    // success when the server had refused.
    let refusal;
    await assert.rejects(
        () => disableRaw(),
        (err) => {
            assert(err instanceof ActionRefusedError, 'a raw mojoCall must reject a flat success:false with ActionRefusedError');
            assert(err instanceof errors.MojoError, 'the raw refusal must remain a MojoError');
            assert.equal(err.status, 200, 'the HTTP layer succeeded — the handler refused');
            assert.equal(err.errorCode, 'ALREADY_DISABLED');
            assert.equal(err.message, 'User is already disabled', 'the message is the server text');
            assert.equal(err.data.code, 'ALREADY_DISABLED', 'data carries the full reply');
            assert.equal(err.result.payload.code, 'ALREADY_DISABLED', 'result.payload carries the full reply');
            refusal = err;
            return true;
        },
    );
    // Opt-out: the flat refusal is a result, read by the one reader.
    const returned = await disableRaw({ refusal: 'return' });
    assert.equal(returned.success, false, "refusal:'return' must resolve with the flat reply");
    assert.equal(readActionResult(returned).ok, false);

    // PhoneConfig test_connection answers flat on the real wire (rest.py
    // returns the action dict verbatim): the default rejects, the opt-out
    // resolves with the provider verdict.
    const probe = await client.mojoCall('/api/phonehub/config', { method: 'POST', body: { name: 'Refusal probe', provider: 'twilio', test_mode: false } });
    const configPath = `/api/phonehub/config/${probe.data.id}`;
    await assert.rejects(
        () => client.mojoCall(configPath, { method: 'POST', body: { test_connection: 1 } }),
        (err) => err instanceof ActionRefusedError && err.status === 200,
        'a flat provider verdict without the opt-out must reject',
    );
    const verdict = await client.mojoCall(configPath, { method: 'POST', body: { test_connection: 1 }, refusal: 'return' });
    assert.equal(verdict.success, false, "refusal:'return' must resolve the flat provider verdict");
    assert.equal(verdict.message, 'twilio credentials are incomplete');
    await client.mojoCall(configPath, { method: 'DELETE' });

    // Wrapped data.status:false (storage tester on a non-S3 manager) is data
    // on a POST: unwrap must not reject it. The storage manager holds the grant.
    const storageLogin = await mock.mockFetch('/api/login', {
        method: 'POST', body: { username: 'storage.manager@nativemojo.com', password: 'mojo' },
    });
    client.installAuthHooks({ async preRequest() {}, authHeader: () => `Bearer ${storageLogin.data.access_token}` });
    const cors = await client.mojoCall('/api/fileman/manager/4104', { method: 'POST', body: { check_cors: 1 } });
    assert.equal(cors.data.status, false, 'a wrapped data.status:false must resolve as data');
    client.installAuthHooks({ async preRequest() {}, authHeader: () => `Bearer ${token}` });

    // A wrapped data.success:false is ordinary data on EVERY method (e.g. a
    // successful POST webapp/rollback answers success:false for a queued
    // deploy): a raw mojoCall resolves it unchanged and never throws.
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const wrapped = await client.mojoCall(WRAPPED_PATH, { method, ...(method === 'GET' || method === 'DELETE' ? {} : { body: { probe: 1 } }) })
            .catch((err) => assert.fail(`${method}: a wrapped data.success:false must resolve, not throw ${err?.name}: ${err?.message}`));
        assert.deepEqual(wrapped, { status: true, data: { success: false, code: 'NOT_LIVE', error: 'deploy queued', step: 'queued' } },
            `${method}: a wrapped data.success:false must resolve with the reply unchanged`);
    }
    assert.deepEqual(wrappedProbe.calls, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], 'each method must reach the probe once');

    // A refusal is deterministic: the query defaults never retry it.
    const { retry } = client.mojoQueryDefaults().queries;
    assert.equal(retry(0, refusal), false, 'an ActionRefusedError must not retry');
    assert.equal(retry(0, new errors.MojoError('offline', 0)), true, 'a status-0 MojoError still retries once');

    await mojoAction('/api/user', target.id, 'reactivate');
    client.installAuthHooks(null);

    // ── 3. source wiring ──────────────────────────────────────────────
    const modelSource = await readFile(new URL('../packages/portal-mojo/src/client/model.ts', import.meta.url), 'utf8');
    assert.match(modelSource, /readActionResult\(body\)/, 'useAction must normalize through the one reader');
    assert.match(modelSource, /throw new ActionRefusedError\(action, result\)/, 'useAction must throw the typed refusal');
    assert.match(modelSource, /def\.refusal \?\? 'reject'/, "the refusal mode must default to 'reject'");

    assert.match(modelSource, /refusal: 'return'/, "useAction must opt out of unwrap's refusal check to name the action");
    const actionSource = await readFile(new URL('../packages/portal-mojo/src/client/action-result.ts', import.meta.url), 'utf8');
    assert.match(actionSource, /refusal: 'return'/, "mojoAction must opt out of unwrap's refusal check to name the action");
    const phoneSource = await readFile(new URL('../packages/portal-mojo/src/admin/phonehub/api.ts', import.meta.url), 'utf8');
    assert.match(phoneSource, /test_connection:1\},refusal:'return'/, "the Phone Hub test must opt out: its flat success:false is a verdict");
    const clientSource = await readFile(new URL('../packages/portal-mojo/src/client/client.ts', import.meta.url), 'utf8');
    const unwrapSource = clientSource.slice(clientSource.indexOf('async function unwrap('), clientSource.indexOf('export function mojoCall('));
    assert.match(unwrapSource, /new ActionRefusedError\(path, readActionResult\(body\)\)/, 'unwrap must build the refusal through the one reader');

    const tableSource = await readFile(new URL('../packages/portal-mojo/src/ui/ModelTable.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(tableSource, /action-result/, 'ModelTable must not import action-result (#1937 boundary)');

    const indexSource = await readFile(new URL('../packages/portal-mojo/src/client/index.ts', import.meta.url), 'utf8');
    assert.match(indexSource, /action-result/, 'the client barrel must export the action-result module');

    console.log('action-result contract verified');
} finally {
    await server.close();
    delete globalThis.__wrappedProbe;
}
