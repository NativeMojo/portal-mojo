import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.File = File;
globalThis.window = {
    setTimeout, clearTimeout,
    addEventListener() {}, removeEventListener() {},
    location: { origin: 'http://localhost', hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

try {
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
    const upload = await server.ssrLoadModule('/packages/portal-mojo/src/client/upload.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const login = await mock.mockFetch('/api/login', { method: 'POST', body: { username: 'ian@mojoverify.com', password: 'mojo' } });
    client.installAuthHooks({
        async preRequest() {},
        authHeader: () => `Bearer ${login.data.access_token}`,
    });

    mock.clearMockUploadObservations();
    mock.setMockUploadMode('raw-put');
    const rawTask = upload.startFileUpload(new File(['hello'], 'C:\\fakepath\\hello.txt', { type: 'text/plain' }), { use: 'uploads', groupId: 1 });
    const raw = await rawTask.result;
    assert.equal(raw.status, 'completed');
    assert.equal(raw.file.filename, 'hello.txt');
    assert.equal(raw.file.contentType, 'text/plain');
    assert.equal(raw.file.fileManagerId, 4101, 'flat use selector reaches manager resolution');
    assert.equal(JSON.stringify(rawTask.getSnapshot()).includes('mock-upload'), false);
    assert.deepEqual(Object.keys(raw.file).sort(), ['category', 'contentType', 'fileManagerId', 'filename', 'groupId', 'id', 'size']);
    assert.equal(mock.getMockUploadObservations()[0].method, 'PUT');

    mock.clearMockUploadObservations();
    mock.armMockUploadFault('initiate-ambiguous');
    const lostInitiate = upload.startFileUpload(new File(['same'], 'same-key.txt', { type: 'text/plain' }));
    assert.deepEqual(await lostInitiate.result, {
        status: 'uncertain', fileId: null,
        failure: { stage: 'initiate', code: 'remote_state_unknown', message: 'The server could not confirm the upload state.', retryable: true },
    });
    const lostRecovered = await lostInitiate.retry();
    assert.equal(lostRecovered.status, 'completed');
    const lostInitiations = mock.getMockUploadInitiationObservations();
    assert.equal(lostInitiations.length, 2);
    assert.equal(lostInitiations[0].keyDigest, lostInitiations[1].keyDigest, 'ambiguous initiation retry retains its private idempotency key');
    assert.equal(lostInitiations[0].fileId, lostInitiations[1].fileId, 'same-key replay returns the committed File');
    assert.equal(lostInitiations[1].replay, true);

    mock.clearMockUploadObservations();
    mock.armMockUploadFault('transfer-failed');
    const terminalAttempt = upload.startFileUpload(new File(['fresh'], 'fresh-key.txt', { type: 'text/plain' }));
    const terminalUnknown = await terminalAttempt.result;
    assert.equal(terminalUnknown.status, 'uncertain');
    const terminalRetry = await terminalAttempt.retry();
    assert.equal(terminalRetry.status, 'completed', 'one explicit retry replaces a server-terminal attempt');
    const terminalInitiations = mock.getMockUploadInitiationObservations();
    assert.equal(terminalInitiations.length, 2);
    assert.notEqual(terminalInitiations[0].keyDigest, terminalInitiations[1].keyDigest, 'server-terminal retry rotates the private idempotency key');
    assert.notEqual(terminalInitiations[0].fileId, terminalInitiations[1].fileId, 'server-terminal retry creates a fresh File');

    mock.setMockUploadMode('raw-put-unprefixed');
    const repairedTask = upload.startFileUpload(new File(['repair'], 'repair.txt', { type: 'text/plain' }));
    assert.equal((await repairedTask.result).status, 'completed', 'root-relative direct paths receive the missing /api prefix');

    mock.clearMockUploadObservations();
    mock.setMockUploadMode('config-post');
    const multipartTask = upload.startFileUpload(new File(['payload'], '../report.pdf', { type: 'application/pdf' }));
    const progress = [];
    multipartTask.subscribe((state) => progress.push([state.loadedBytes, state.totalBytes]));
    assert.equal((await multipartTask.result).status, 'completed');
    const multipart = mock.getMockUploadObservations()[0];
    assert.deepEqual(multipart.fieldOrder, ['key', 'policy', 'Content-Type', 'file']);
    assert(multipart.total > 7, 'multipart progress uses wire bytes, including overhead');
    assert.equal(multipart.headerNames.some((name) => /authorization|x-mojo-uid|content-type/i.test(name)), false);
    assert.equal(multipart.contentType, 'application/pdf');
    assert(progress.some(([loaded, total]) => loaded === total && total > 7));

    mock.clearMockUploadObservations();
    mock.setMockUploadMode('config-put');
    mock.armMockUploadFault('transfer-ambiguous');
    const uncertainTask = upload.startFileUpload(new File(['retry'], 'retry.bin', { type: '' }));
    const uncertain = await uncertainTask.result;
    assert.equal(uncertain.status, 'uncertain');
    assert.equal(JSON.stringify(uncertain).includes('mock-upload'), false);
    const recoveryA = uncertainTask.recover();
    const recoveryB = uncertainTask.recover();
    assert.strictEqual(recoveryA, recoveryB, 'recovery is single-flight');
    assert.equal((await recoveryA).status, 'completed');
    assert.equal(mock.getMockUploadObservations().length, 1, 'recovery reconciles/completes without replay');

    mock.setMockUploadMode('raw-put');
    const cancelledInitiation = upload.startFileUpload(new File(['cancel'], 'cancel.txt', { type: 'text/plain' }));
    cancelledInitiation.cancel();
    const unknownInitiation = await cancelledInitiation.result;
    assert.deepEqual(
        { status: unknownInitiation.status, fileId: unknownInitiation.fileId, code: unknownInitiation.failure.code },
        { status: 'uncertain', fileId: null, code: 'remote_state_unknown' },
        'an aborted initiation never claims that no row committed',
    );
    assert.strictEqual(cancelledInitiation.recover(), cancelledInitiation.result, 'id-less recovery cannot create a possible duplicate');
    assert.equal((await cancelledInitiation.retry()).status, 'completed', 'id-less uncertainty can explicitly restart');

    mock.setMockUploadMode('config-put-bearer');
    const bearerTask = upload.startFileUpload(new File(['bearer'], 'bearer.txt', { type: 'text/plain' }));
    const bearerOutcome = await bearerTask.result;
    assert.equal(bearerOutcome.status, 'uncertain');
    assert.equal(typeof bearerOutcome.fileId, 'number', 'known initiation id remains available for reconciliation');
    assert.equal(JSON.stringify(bearerOutcome).includes('api-token-must-not-cross'), false, 'Bearer capability is rejected with only a fixed safe error');

    mock.setMockUploadMode('raw-put');
    mock.armMockUploadFault('complete-ambiguous');
    const completeAmbiguous = upload.startFileUpload(new File(['done'], 'done.txt', { type: 'text/plain' }));
    assert.equal((await completeAmbiguous.result).status, 'completed', 'completion ambiguity reconciles authoritative state');

    mock.clearMockRequestHistory();
    mock.armMockUploadFault('complete-body-malformed');
    const completionBodyTrap = upload.startFileUpload(new File(['authoritative'], 'authoritative.txt', { type: 'text/plain' }));
    const authoritative = await completionBodyTrap.result;
    assert.equal(authoritative.status, 'completed', 'completion POST data is ignored in favor of a later GET');
    assert.equal(JSON.stringify(authoritative).includes('mock-capability-must-not-land'), false);
    const fileHistory = mock.getMockRequestHistory().filter((entry) => entry.path === `/api/fileman/file/${authoritative.file.id}`);
    assert.deepEqual(fileHistory.slice(-2).map((entry) => entry.method), ['POST', 'GET'], 'authoritative GET follows completion POST');

    assert.equal(upload.sanitizeUploadBasename('/tmp/path/name.txt'), 'name.txt');
    assert.equal(upload.sanitizeUploadBasename('..'), 'upload.bin');

    const source = await readFile(new URL('../packages/portal-mojo/src/client/upload.ts', import.meta.url), 'utf8');
    assert.match(source, /form\.append\('file', request\.file\)/);
    assert.match(source, /initiated\.contentType/);
    assert.match(source, /body\.use = this\.#options\.use\.trim\(\)/);
    assert.match(source, /\? value : `\/api\$\{value\}`/);
    assert(!source.includes("headers['Authorization']"));
    assert(!source.includes('getDuid'));
    assert.match(source, /#initiated/);

    console.log('verify-file-upload: all contracts passed');
} finally {
    await server.close();
}
