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
    const rawTask = upload.startFileUpload(new File(['hello'], 'C:\\fakepath\\hello.txt', { type: 'text/plain' }));
    const raw = await rawTask.result;
    assert.equal(raw.status, 'completed');
    assert.equal(raw.file.filename, 'hello.txt');
    assert.equal(raw.file.contentType, 'text/plain');
    assert.equal(typeof raw.file.fileManagerId, 'number');
    assert.equal(JSON.stringify(rawTask.getSnapshot()).includes('mock-upload'), false);
    assert.deepEqual(Object.keys(raw.file).sort(), ['category', 'contentType', 'fileManagerId', 'filename', 'groupId', 'id', 'size']);
    assert.equal(mock.getMockUploadObservations()[0].method, 'PUT');

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
    mock.armMockUploadFault('complete-ambiguous');
    const completeAmbiguous = upload.startFileUpload(new File(['done'], 'done.txt', { type: 'text/plain' }));
    assert.equal((await completeAmbiguous.result).status, 'completed', 'completion ambiguity reconciles authoritative state');

    assert.equal(upload.sanitizeUploadBasename('/tmp/path/name.txt'), 'name.txt');
    assert.equal(upload.sanitizeUploadBasename('..'), 'upload.bin');

    const source = await readFile(new URL('../packages/portal-mojo/src/client/upload.ts', import.meta.url), 'utf8');
    assert.match(source, /form\.append\('file', request\.file\)/);
    assert.match(source, /initiated\.contentType/);
    assert(!source.includes("headers['Authorization']"));
    assert(!source.includes('getDuid'));
    assert.match(source, /#initiated/);

    console.log('verify-file-upload: all contracts passed');
} finally {
    await server.close();
}
