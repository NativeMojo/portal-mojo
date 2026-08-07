import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.File = File;
const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.localStorage = storage;
globalThis.sessionStorage = storage;
globalThis.window = { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, location: { origin: 'http://localhost', hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

try {
    const [record, assistantData, mock, recordUi, queueUi, assistantApi, queueModule, toastModule] = await Promise.all([
        server.ssrLoadModule('/packages/portal-mojo/src/client/record-feed.ts'),
        server.ssrLoadModule('/packages/portal-mojo/src/admin/assistant/data.ts'),
        server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts'),
        readFile(new URL('../packages/portal-mojo/src/ui/RecordFeed.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/ui/AttachmentQueue.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/admin/assistant/api.ts', import.meta.url), 'utf8'),
        server.ssrLoadModule('/packages/portal-mojo/src/ui/UploadQueue.tsx'),
        server.ssrLoadModule('/packages/portal-mojo/src/ui/toast.tsx'),
    ]);

    const safe = record.safeFileReference({ id: 12, filename: 'evidence.txt', content_type: 'text/plain', category: 'text', url: 'https://secret', upload_token: 'secret' });
    assert.deepEqual(safe, { id: 12, filename: 'evidence.txt', content_type: 'text/plain', category: 'text' });
    assert.equal(record.safeFileReference(new File(['x'], 'browser.txt')), null);
    assert.equal(record.safeFileReference({ id: 0, filename: 'bad', content_type: 'text/plain' }), null);
    assert.match(recordUi, /previousIds\.has\(item\.id\)/, 'ambiguous reconciliation must exclude snapshot ids');
    assert.match(recordUi, /onSuccess:[\s\S]{0,1400}setAttachmentReset/, 'record candidate reset must be success-owned');
    assert.match(recordUi, /key=\{JSON\.stringify\(props\.adapter\.queryKey\)\}/, 'record changes must remount local state');
    assert.doesNotMatch(queueUi, /mojoDelete|URL\.createObjectURL|upload_token|upload_url/, 'attachment queue must neither delete Files nor retain capabilities');
    assert.doesNotMatch(assistantApi, /WebSocket|EventSource/);
    const portalRecordCss = await readFile(new URL('../apps/portal/src/theme/record-feed.css', import.meta.url), 'utf8');
    const showcaseRecordCss = await readFile(new URL('../apps/showcase/src/theme/record-feed.css', import.meta.url), 'utf8');
    assert.equal(portalRecordCss, showcaseRecordCss, 'RecordFeed attachment CSS must remain byte-identical across themes');
    for (const cssPath of ['../apps/portal/src/theme/admin-assistant.css', '../apps/showcase/src/theme/admin-assistant.css']) {
        assert.match(await readFile(new URL(cssPath, import.meta.url), 'utf8'), /assistant-attachment-chip/);
    }

    toastModule.toast.progress = () => ({ update() {}, finalizing() {}, done() {}, fail() {}, remove() {} });
    toastModule.toast.success = () => {};
    toastModule.toast.warning = () => {};
    let nextTask = 0;
    const outcomes = ['completed', 'failed'];
    const partialQueue = queueModule.createUploadQueue({ concurrency: 2, capacity: 5, startTask(file) {
        const id = 9000 + nextTask;
        const status = outcomes[nextTask++];
        const outcome = status === 'completed'
            ? { status, file: { id, filename: file.name, contentType: file.type, size: file.size, category: 'text', fileManagerId: 4105, groupId: null } }
            : { status, fileId: id, failure: { stage: 'transfer', code: 'request_failed', message: 'failed', retryable: true } };
        const state = { phase: status, generation: 1, fileId: id, loadedBytes: status === 'completed' ? file.size : 0, totalBytes: file.size, outcome };
        return { result: Promise.resolve(outcome), getSnapshot: () => ({ ...state }), subscribe(listener) { listener({ ...state, outcome: null }); return () => {}; }, cancel() {}, retry: () => Promise.resolve(outcome), recover: () => Promise.resolve(outcome) };
    } });
    const partialIds = partialQueue.enqueue([new File(['ok'], 'ok.txt', { type: 'text/plain' }), new File(['bad'], 'bad.txt', { type: 'text/plain' })], { consumerKey: 'assistant:partial' }).acceptedIds;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(partialQueue.getSnapshot().items.map((item) => item.status), ['completed', 'failed']);
    partialQueue.remove(partialIds[1]);
    assert.deepEqual(partialQueue.getSnapshot().items.map((item) => item.filename), ['ok.txt'], 'removing a failed item preserves the completed reference');
    partialQueue.remove(partialIds[0]);
    assert.equal(partialQueue.getSnapshot().items.length, 0, 'removal only detaches queue state');
    partialQueue.dispose();

    const projectedUser = assistantData.projectMessage({ id: 1, role: 'user', content: 'hello', created: 1, blocks: [{ type: 'attachment', files: [{ ...safe, url: 'https://secret', token: 'secret' }] }, { type: 'file', filename: 'wrong-role', url: '/download' }] });
    assert.deepEqual(projectedUser.blocks, [{ type: 'attachment', files: [safe] }]);
    const projectedAssistant = assistantData.projectMessage({ id: 2, role: 'assistant', content: 'done', created: 2, blocks: [{ type: 'attachment', files: [safe] }, { type: 'file', filename: 'generated.csv', url: '/download' }] });
    assert.deepEqual(projectedAssistant.blocks.map((block) => block.type), ['file'], 'generated file blocks stay distinct');

    const login = await mock.mockFetch('/api/login', { method: 'POST', body: { username: 'showcase.operator@nativemojo.com', password: 'mojo' } });
    const headers = { Authorization: `Bearer ${login.data.access_token}` };

    const ticketNotes = await mock.mockFetch('/api/incident/ticket/note', { headers, params: { parent: 501, group: 1, size: 100 } });
    const seededTicketMedia = ticketNotes.data.find((row) => row.media);
    assert.deepEqual(Object.keys(seededTicketMedia.media).sort(), ['category', 'content_type', 'filename', 'id']);
    const ticketSaved = await mock.mockFetch('/api/incident/ticket/note', { method: 'POST', headers, body: { parent: 501, group: 1, note: 'Attached evidence', media: 5101 } });
    assert.deepEqual(ticketSaved.data.media, { id: 5101, filename: 'launch-photo.jpg', content_type: 'image/jpeg', category: 'image' });
    for (const media of [5110, 5104, 999999]) {
        const denied = await mock.mockFetch('/api/incident/ticket/note', { method: 'POST', headers, body: { parent: 501, group: 1, note: 'Rejected evidence', media } });
        assert.equal(denied.error_code, 400);
        assert.equal(denied.error, 'Media must reference an active, completed File in the record scope');
    }
    const empty = await mock.mockFetch('/api/incident/ticket/note', { method: 'POST', headers, body: { parent: 501, group: 1, note: ' ', media: 5101 } });
    assert.equal(empty.error_code, 400, 'text remains required');
    mock.armMockRecordNoteFault();
    await assert.rejects(() => mock.mockFetch('/api/incident/ticket/note', { method: 'POST', headers, body: { parent: 501, group: 1, note: 'Ambiguous evidence note', media: 5101 } }));
    const reconciled = await mock.mockFetch('/api/incident/ticket/note', { headers, params: { parent: 501, group: 1, size: 100 } });
    assert.equal(reconciled.data.filter((row) => row.note === 'Ambiguous evidence note').length, 1);

    const incidentSaved = await mock.mockFetch('/api/incident/incident/history', { method: 'POST', headers, body: { parent: 601, group: 999, kind: 'comment', note: 'Incident evidence', media: 5101 } });
    assert.equal(incidentSaved.data.group, 1, 'mock captures parent group instead of ambient/supplied group');
    assert.deepEqual(Object.keys(incidentSaved.data.media).sort(), ['category', 'content_type', 'filename', 'id']);

    const conversationListBefore = await mock.mockFetch('/api/assistant/conversation', { headers });
    for (const attachments of [null, '5104', true, [], [true], ['5104'], [5101], [5110], [999999], [5104, 5104], [5104, 5109, 5101, 5102, 5103, 5110]]) {
        const denied = await mock.mockFetch('/api/assistant', { method: 'POST', headers, body: { message: 'Do not create this conversation', attachments } });
        assert.equal(denied.error, 'Invalid assistant attachments');
    }
    const conversationListAfter = await mock.mockFetch('/api/assistant/conversation', { headers });
    assert.equal(conversationListAfter.count, conversationListBefore.count, 'invalid batch is atomic before conversation creation');
    const sent = await mock.mockFetch('/api/assistant', { method: 'POST', headers, body: { message: 'Export with this metadata reference', attachments: [5104] } });
    assert.equal(sent.status, true);
    assert(sent.data.blocks.some((block) => block.type === 'file'), 'assistant-generated file response remains distinct');
    const detail = await mock.mockFetch(`/api/assistant/conversation/${sent.data.conversation_id}`, { headers, params: { graph: 'detail' } });
    const userAttachment = detail.data.messages.find((message) => message.role === 'user').blocks[0];
    assert.equal(userAttachment.type, 'attachment');
    assert.deepEqual(Object.keys(userAttachment.files[0]).sort(), ['category', 'content_type', 'filename', 'id']);
    assert(!JSON.stringify(userAttachment).match(/url|token|provider|transfer/i));

    console.log('record and Assistant attachment contracts verified');
} finally { await server.close(); }
