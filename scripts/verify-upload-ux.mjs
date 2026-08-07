import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.File = File;
const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.localStorage = storage;
globalThis.sessionStorage = storage;
globalThis.window = {
    setTimeout, clearTimeout,
    addEventListener() {}, removeEventListener() {},
    location: { origin: 'http://localhost', hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function fakeTask(file, id) {
    const listeners = new Set();
    let generation = 1;
    let state = { phase: 'initiating', generation, fileId: id, loadedBytes: 0, totalBytes: file.size, outcome: null };
    let run = deferred();
    const publish = (patch) => {
        state = { ...state, ...patch };
        listeners.forEach((listener) => listener({ ...state }));
    };
    const startAgain = (phase) => {
        generation += 1;
        run = deferred();
        publish({ phase, generation, outcome: null, loadedBytes: 0 });
        return run.promise;
    };
    return {
        get result() { return run.promise; },
        getSnapshot: () => ({ ...state }),
        subscribe(listener) { listeners.add(listener); listener({ ...state }); return () => listeners.delete(listener); },
        cancel() {},
        retry: () => startAgain('initiating'),
        recover: () => startAgain('reconciling'),
        emitProgress(loaded) { publish({ phase: 'uploading', loadedBytes: loaded, totalBytes: file.size }); },
        complete() {
            const outcome = { status: 'completed', file: { id, filename: file.name, contentType: file.type, size: file.size, category: null, fileManagerId: null, groupId: null } };
            publish({ phase: 'completed', outcome, loadedBytes: file.size });
            run.resolve(outcome);
        },
        fail() {
            const outcome = { status: 'failed', fileId: id, failure: { stage: 'transfer', code: 'request_failed', message: 'The upload request failed.', retryable: true } };
            publish({ phase: 'failed', outcome });
            run.resolve(outcome);
        },
        uncertain(known = true) {
            const outcome = { status: 'uncertain', fileId: known ? id : null, failure: { stage: 'reconcile', code: 'remote_state_unknown', message: 'The server could not confirm the upload state.', retryable: true } };
            publish({ phase: 'uncertain', fileId: known ? id : null, outcome });
            run.resolve(outcome);
        },
    };
}

try {
    const toastModule = await server.ssrLoadModule('/packages/portal-mojo/src/ui/toast.tsx');
    const progressEvents = [];
    toastModule.toast.progress = (label) => ({
        update: (percent) => progressEvents.push(['update', label, percent]),
        finalizing: (message) => progressEvents.push(['finalizing', message]),
        done: (message) => progressEvents.push(['done', message]),
        fail: (message) => progressEvents.push(['fail', message]),
        remove: () => progressEvents.push(['remove', label]),
    });
    toastModule.toast.success = () => {};
    toastModule.toast.warning = () => {};

    const { validateFileSelection } = await server.ssrLoadModule('/packages/portal-mojo/src/ui/FileDrop.tsx');
    const { createUploadQueue } = await server.ssrLoadModule('/packages/portal-mojo/src/ui/UploadQueue.tsx');
    const valid = new File(['ok'], 'ok.pdf', { type: 'application/pdf', lastModified: 1 });
    const wrong = new File(['no'], 'no.exe', { type: 'application/octet-stream', lastModified: 2 });
    const tooBig = new File(['12345'], 'big.pdf', { type: 'application/pdf', lastModified: 3 });
    const validation = validateFileSelection([valid, wrong, tooBig], { accept: ['.pdf'], maxFileSize: 4, maxFiles: 2 });
    assert.deepEqual(validation.accepted.map((file) => file.name), ['ok.pdf']);
    assert.deepEqual(validation.rejected.map((item) => item.code), ['type', 'size']);

    const started = [];
    const tasks = [];
    let releaseCallback;
    const callbackGate = new Promise((resolve) => { releaseCallback = resolve; });
    const queue = createUploadQueue({
        concurrency: 2, capacity: 3,
        startTask(file, destination) {
            started.push([file.name, { ...destination }]);
            const task = fakeTask(file, 100 + tasks.length);
            tasks.push(task);
            return task;
        },
    });
    const batch = [1, 2, 3, 4].map((n) => new File([new Uint8Array(100)], `file-${n}.txt`, { type: 'text/plain', lastModified: n }));
    const queued = queue.enqueue(batch, { consumerKey: 'editor-a', destination: { use: 'docs', groupId: 9 }, onComplete: () => callbackGate });
    assert.equal(queued.acceptedIds.length, 3);
    assert.equal(queued.rejected[0].code, 'capacity');
    assert.equal(started.length, 2, 'tasks are created only when a scheduler slot opens');
    assert.deepEqual(started[0][1], { groupId: 9, use: 'docs' });
    assert.equal(queue.getSnapshot().queuedCount, 1);
    assert.strictEqual(queue.getSnapshot(), queue.getSnapshot(), 'snapshot identity is stable between transitions');
    assert.equal(JSON.stringify(queue.getSnapshot()).includes('consumerKey'), false);
    assert.equal(JSON.stringify(queue.getSnapshot()).includes('destination'), false);
    assert.equal(Object.values(queue.getSnapshot().items[0]).some((value) => value instanceof File), false, 'public snapshots never expose File');

    tasks[0].emitProgress(10);
    tasks[0].emitProgress(10);
    tasks[0].emitProgress(11);
    assert.deepEqual(progressEvents.filter(([kind]) => kind === 'update').map((event) => event[2]), [10, 11], 'toast updates follow displayed byte progress only');
    tasks[0].complete();
    await tick();
    assert.equal(started.length, 3, 'callback finalization does not occupy a transfer slot');
    assert.equal(queue.getSnapshot().items[0].status, 'finalizing');
    assert.equal(queue.getSnapshot().items[0].canCancel, false);
    releaseCallback();
    await tick();
    assert.equal(queue.getSnapshot().items[0].status, 'completed');

    const dedupeTasks = [];
    const dedupe = createUploadQueue({ concurrency: 1, capacity: 6, startTask(file) { const task = fakeTask(file, 200 + dedupeTasks.length); dedupeTasks.push(task); return task; } });
    const same = new File(['same'], 'same.txt', { type: 'text/plain', lastModified: 8 });
    assert.equal(dedupe.enqueue([same], { consumerKey: 'a', destination: { use: 'one' } }).acceptedIds.length, 1);
    assert.equal(dedupe.enqueue([same], { consumerKey: 'a', destination: { use: 'one' } }).rejected[0].code, 'duplicate');
    assert.equal(dedupe.enqueue([same], { consumerKey: 'b', destination: { use: 'one' } }).acceptedIds.length, 1, 'consumer participates in dedupe');
    assert.equal(dedupe.enqueue([same], { consumerKey: 'a', destination: { use: 'two' } }).acceptedIds.length, 1, 'destination participates in dedupe');
    dedupe.dispose();

    let callbackAttempt = 0;
    const warningTasks = [];
    const warningQueue = createUploadQueue({ concurrency: 1, startTask(file) { const task = fakeTask(file, 300); warningTasks.push(task); return task; } });
    const warningId = warningQueue.enqueue([new File(['x'], 'warning.txt', { type: 'text/plain' })], {
        consumerKey: 'warning', onComplete() { callbackAttempt += 1; if (callbackAttempt === 1) throw new Error('private detail'); },
    }).acceptedIds[0];
    warningTasks[0].complete();
    await tick();
    assert.equal(warningQueue.getSnapshot().items[0].status, 'completed-warning');
    assert.equal(JSON.stringify(warningQueue.getSnapshot()).includes('private detail'), false);
    warningQueue.retry(warningId);
    await tick();
    assert.equal(warningQueue.getSnapshot().items[0].status, 'completed', 'retrying a follow-up does not replay upload bytes');
    assert.equal(warningTasks.length, 1);

    const recoveryTasks = [];
    const recoveryQueue = createUploadQueue({ concurrency: 1, startTask(file) { const task = fakeTask(file, 400); recoveryTasks.push(task); return task; } });
    const recoveryId = recoveryQueue.enqueue([new File(['x'], 'recover.txt')], { consumerKey: 'recover' }).acceptedIds[0];
    recoveryTasks[0].uncertain(true);
    await tick();
    assert.equal(recoveryQueue.getSnapshot().items[0].canRecover, true);
    recoveryQueue.recover(recoveryId);
    await tick();
    recoveryTasks[0].complete();
    await tick();
    assert.equal(recoveryQueue.getSnapshot().items[0].status, 'completed');

    const cancelTasks = [];
    const cancelQueue = createUploadQueue({ concurrency: 1, startTask(file) { const task = fakeTask(file, 500); cancelTasks.push(task); return task; } });
    const cancelId = cancelQueue.enqueue([new File(['x'], 'cancel.txt')], { consumerKey: 'cancel' }).acceptedIds[0];
    cancelQueue.cancel(cancelId);
    assert.equal(cancelQueue.getSnapshot().items[0].status, 'cancelling', 'cancel request is not reported as completed cancellation');
    cancelTasks[0].uncertain(true);
    await tick();
    assert.equal(cancelQueue.getSnapshot().items[0].status, 'uncertain');

    const portalCss = await readFile(new URL('../apps/portal/src/theme/file-upload.css', import.meta.url), 'utf8');
    const showcaseCss = await readFile(new URL('../apps/showcase/src/theme/file-upload.css', import.meta.url), 'utf8');
    assert.equal(portalCss, showcaseCss, 'Portal and Showcase upload CSS must remain byte-identical');
    const source = await readFile(new URL('../packages/portal-mojo/src/ui/UploadQueue.tsx', import.meta.url), 'utf8');
    assert(!/localStorage|sessionStorage|useQuery|QueryClient/.test(source), 'queue is component-local and has no persistence/query ownership');
    assert.match(source, /startTask\(fileValue!, entry\.destination\)/, 'task creation remains inside the scheduler');
    assert.match(source, /progressToasts\.set\(entry\.id, toast\.progress/, 'each active attempt owns one existing progress toast');
    await stat(new URL('../packages/portal-mojo/docs/file-upload-ux.md', import.meta.url));

    queue.dispose();
    warningQueue.dispose();
    recoveryQueue.dispose();
    cancelQueue.dispose();
    console.log('verify-upload-ux: all contracts passed');
} finally {
    await server.close();
}
