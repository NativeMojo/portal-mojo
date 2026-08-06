// Targeted contract verifier for global Storage Admin (#1298).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { QueryClient } from '@tanstack/react-query';

globalThis.window = {
    addEventListener() {}, removeEventListener() {}, confirm: () => true,
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

try {
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const models = await server.ssrLoadModule('/packages/portal-mojo/src/admin/storage/models.ts');
    const renditions = await server.ssrLoadModule('/packages/portal-mojo/src/admin/storage/file-renditions.ts');
    const errors = await server.ssrLoadModule('/packages/portal-mojo/src/client/errors.ts');
    const me = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');

    // Registration, route order, dual mount, and exact global audience split.
    assert.deepEqual(models.STORAGE_VIEW_PERMS, ['sys.view_fileman', 'sys.manage_files', 'sys.files']);
    assert.deepEqual(models.STORAGE_MANAGE_PERMS, ['sys.manage_files', 'sys.files']);
    assert.deepEqual(models.BUCKET_MANAGE_PERMS, ['sys.manage_aws', 'sys.files']);
    const section = admin.STORAGE_ADMIN_SECTION;
    assert.equal(section.id, 'storage');
    assert.equal(section.navigationGroup, 'infrastructure');
    assert.deepEqual(section.routes.map((route) => route.path), ['buckets', 'backends', 'files']);
    assert.deepEqual(section.routes.map((route) => route.permissions), [models.BUCKET_MANAGE_PERMS, models.STORAGE_VIEW_PERMS, models.STORAGE_VIEW_PERMS]);
    assert(admin.ADMIN_SECTIONS.includes(section));
    assert(!section.routes.some((route) => route.path.includes(':id')));
    assert(admin.adminSectionRoutes([section]).some((route) => route.path === 'storage/files'));
    assert(admin.adminSectionRoutes([section], { mount: '/system' }).some((route) => route.path === 'system/storage/files'));
    const visible = (permissions) => section.routes.filter((route) => me.hasPermission({ id: 1, permissions }, section.permissions, null)
        && me.hasPermission({ id: 1, permissions }, route.permissions, null)).map((route) => route.path);
    assert.deepEqual(visible({ manage_aws: true }), ['buckets']);
    assert.deepEqual(visible({ manage_files: true }), ['backends', 'files']);
    assert.deepEqual(visible({ files: true }), ['buckets', 'backends', 'files']);
    assert.equal(me.hasPermission({ id: 1, permissions: {} }, section.permissions, { permissions: { files: true, manage_aws: true } }), false);

    // Shared error boundary preserves numeric status + semantic code + safe evidence.
    const safeEvidence = { complete: false, mutation_state: 'partial', counts: { deleted_objects: 2 }, failed: { versions: 1 }, remaining: null, failure: { operation: 'create', provider_code: 'AccessDenied', retryable: false }, requested_public: false, configured_public: null, created_new: true };
    const mojoError = new errors.MojoError('incomplete', 409, 's3_operation_incomplete', safeEvidence);
    assert.equal(mojoError.status, 409);
    assert.equal(mojoError.errorCode, 's3_operation_incomplete');
    assert.deepEqual(mojoError.data, safeEvidence);
    const parsedEvidence = models.parseS3Failure(mojoError);
    assert.deepEqual(parsedEvidence.counts, { deleted_objects: 2 });
    assert.deepEqual(parsedEvidence.failed, { versions: 1 });
    assert.equal(parsedEvidence.remaining, null);
    assert.deepEqual(parsedEvidence.failure, safeEvidence.failure);
    assert.equal(parsedEvidence.requested_public, false);
    assert.equal(parsedEvidence.configured_public, null);
    assert.equal(parsedEvidence.created_new, true);

    // Strict bucket parsers distinguish true empty, success, and malformed data.
    assert.deepEqual(models.parseBucketList({ status: true, data: [] }), []);
    assert.throws(() => models.parseBucketList({ status: true, data: null }), /invalid list/);
    assert.deepEqual(models.parseBucketCreate({ id: 'a', name: 'a', created_new: null }), { id: 'a', name: 'a', created_new: null });
    assert.equal(models.parseBucketAccess({ name: 'a', is_public: true, configured_public: true, complete: true, mutation_state: 'complete' }).is_public, true);
    assert.deepEqual(models.parseBucketEmpty({ name: 'a', complete: true, mutation_state: 'complete', deleted_objects: 1, deleted_versions: 2, deleted_markers: 3, aborted_uploads: 4 }).deleted_versions, 2);
    assert.throws(() => models.parseBucketEmpty({ name: 'a', complete: true, mutation_state: 'complete', deleted_objects: null, deleted_versions: 2, deleted_markers: 3, aborted_uploads: 4 }), /deleted_objects/);

    // Manager graph and sanitizer: forced graph + recursive secret canary absence.
    assert.deepEqual(models.FileManagerModel.normalizeListParams({ graph: 'raw', evil: 1, is_public: true }), { graph: 'list', is_public: true, sort: '-created' });
    const canary = 'raw-storage-secret-canary';
    const sanitized = models.sanitizeFileManagerRow({ id: 1, created: 1, name: 'Safe', use: 'x', backend_type: 's3', backend_url: 's3://safe', is_active: true, is_default: false, is_public: false, aws_key: canary, aws_secret: canary, secrets: { nested: canary }, group: { id: 1, name: 'G', secret: canary } });
    assert(!JSON.stringify(sanitized).includes(canary));
    assert.deepEqual(models.scrubFileManagerChanges({ aws_key: '', aws_secret: ' ', aws_key_masked: 'x', name: 'A' }), { name: 'A' });
    const queryClient = new QueryClient();
    queryClient.setQueryData(models.FileManagerModel.keys.one(1), sanitized);
    assert(!JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.state.data)).includes(canary));
    assert(!JSON.stringify(queryClient.getMutationCache().getAll()).includes(canary));
    assert.deepEqual(models.SUPPORTED_FILE_MANAGER_BACKENDS.map((option) => option.value), ['file', 's3']);

    // Capability URL refusal and export projections.
    for (const value of ['/safe/path', 'https://example.test/a', 'http://example.test/a']) assert.equal(models.isSafeCapabilityUrl(value), true, value);
    for (const value of ['//example.test/a', 'https://user:pass@example.test/a', 'javascript:alert(1)', 'data:text/plain,x', 'relative-no-slash', ' https://example.test']) assert.equal(models.isSafeCapabilityUrl(value), false, value);
    assert.equal(models.FileModel.normalizeListParams({ graph: 'upload', upload_token: canary, category: 'image' }).graph, 'list');

    // Full rendition signatures and finite decision/controller matrix.
    const baseRendition = { id: 1, role: 'thumbnail', upload_status: 'rendering', modified: 1, width: 100, height: 100, file_size: 10 };
    assert.notEqual(renditions.renditionSignature(baseRendition), renditions.renditionSignature({ ...baseRendition, modified: 2 }));
    assert.deepEqual(renditions.normalizeRenditionRoles([' a ', 'a', '', 'b']), ['a', 'b']);
    assert.equal(renditions.normalizeRenditionRoles(Array.from({ length: 25 }, (_, index) => `r${index}`)).length, 20);
    const beforeFile = { upload_status: 'completed', renditions: { thumbnail: baseRendition } };
    const before = renditions.renditionTargetSignature(beforeFile, ['thumbnail']);
    assert.deepEqual(renditions.decideRenditionPoll({ expectedFileId: 1, currentFileId: 2, open: true, attempt: 1, beforeSignature: before, targetRoles: ['thumbnail'], file: beforeFile }), { done: true, reason: 'file-changed' });
    assert.equal(renditions.decideRenditionPoll({ expectedFileId: 1, currentFileId: 1, open: true, attempt: 12, beforeSignature: before, targetRoles: ['thumbnail'], file: beforeFile }).reason, 'timeout');
    assert.equal(renditions.decideRenditionPoll({ expectedFileId: 1, currentFileId: 1, open: true, attempt: 1, beforeSignature: before, targetRoles: ['thumbnail'], file: { upload_status: 'failed', renditions: {} } }).reason, 'failed');
    const unrelatedChange = { upload_status: 'completed', renditions: { thumbnail: baseRendition, preview: { ...baseRendition, id: 2, role: 'preview', modified: 99 } } };
    assert.equal(renditions.decideRenditionPoll({ expectedFileId: 1, currentFileId: 1, open: true, attempt: 1, beforeSignature: before, targetRoles: ['thumbnail'], file: unrelatedChange }).done, false);
    assert.equal(renditions.decideRenditionPoll({ expectedFileId: 1, currentFileId: 1, open: true, attempt: 1, beforeSignature: before, targetRoles: ['thumbnail'], file: { upload_status: 'completed', renditions: { thumbnail: { ...baseRendition, modified: 2 } } } }).reason, 'changed');
    let fetches = 0;
    const converged = await renditions.pollRenditionConvergence({ fileId: 1, beforeSignature: before, targetRoles: ['thumbnail'], isCurrent: () => true, wait: async () => {}, fetch: async () => ({ id: 1, upload_status: 'completed', renditions: { thumbnail: { ...baseRendition, modified: ++fetches + 1 } } }) });
    assert.equal(converged, 'changed');
    assert(fetches <= 12);

    const login = async (email) => {
        const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } });
        return { Authorization: `Bearer ${response.data.access_token}` };
    };
    const viewer = await login('storage.viewer@nativemojo.com');
    const manager = await login('storage.manager@nativemojo.com');
    const bucketManager = await login('bucket.manager@nativemojo.com');
    const member = await login('storage.member@nativemojo.com');
    const superuser = await login('dns.platform@nativemojo.com');
    assert.equal((await mock.mockFetch('/api/fileman/file', { headers: viewer })).status, true);
    assert.equal((await mock.mockFetch('/api/fileman/file/5101', { method: 'POST', headers: viewer, body: { is_public: true } })).error_code, 403);
    assert.equal((await mock.mockFetch('/api/aws/s3/bucket', { headers: manager })).error_code, 403);
    assert.equal((await mock.mockFetch('/api/fileman/manager', { headers: bucketManager })).error_code, 403);
    assert.equal((await mock.mockFetch('/api/fileman/file', { headers: member })).error_code, 403);

    const inventory = await mock.mockFetch('/api/aws/s3/bucket', { headers: bucketManager });
    assert.equal(inventory.status, true);
    assert.equal(inventory.count, inventory.data.length);
    assert.deepEqual(Object.keys(inventory.data[0]).sort(), ['created', 'id', 'name']);
    const unavailable = await mock.mockFetch('/api/aws/s3/bucket', { headers: bucketManager, params: { __mock_error: 'work_limit' } });
    assert.equal(unavailable.code, 503);
    assert.equal(unavailable.error_code, 'work_limit');
    const created = await mock.mockFetch('/api/aws/s3/bucket/verifier-private', { method: 'POST', headers: bucketManager, body: {} });
    assert.equal(created.data.created_new, true);
    assert.equal((await mock.mockFetch('/api/aws/s3/bucket/verifier-private', { method: 'POST', headers: bucketManager, body: {} })).data.created_new, false);
    const access = await mock.mockFetch('/api/aws/s3/bucket/verifier-private', { method: 'POST', headers: bucketManager, body: { set_public: true } });
    assert.deepEqual({ is_public: access.data.is_public, complete: access.data.complete, state: access.data.mutation_state }, { is_public: true, complete: true, state: 'complete' });
    const wrongEmpty = await mock.mockFetch('/api/aws/s3/bucket/verifier-private', { method: 'POST', headers: bucketManager, body: { empty: { confirm_name: 'wrong' } } });
    assert.equal(wrongEmpty.code, 400);
    const emptied = await mock.mockFetch('/api/aws/s3/bucket/verifier-private', { method: 'POST', headers: bucketManager, body: { empty: { confirm_name: 'verifier-private' } } });
    assert.equal(emptied.data.complete, true);
    assert.deepEqual(['deleted_objects', 'deleted_versions', 'deleted_markers', 'aborted_uploads'].map((key) => typeof emptied.data[key]), ['number', 'number', 'number', 'number']);
    assert.equal((await mock.mockFetch('/api/aws/s3/bucket/verifier-private', { method: 'DELETE', headers: bucketManager })).code, 405);
    const partial = await mock.mockFetch('/api/aws/s3/bucket/mojo-partial-demo', { method: 'POST', headers: bucketManager, body: { empty: { confirm_name: 'mojo-partial-demo' } } });
    assert.equal(partial.error_code, 's3_operation_incomplete');
    assert.equal(partial.data.mutation_state, 'partial');
    const incompleteCreate = await mock.mockFetch('/api/aws/s3/bucket/mojo-create-incomplete-demo', { method: 'POST', headers: bucketManager, body: {} });
    assert.equal(incompleteCreate.error_code, 's3_operation_incomplete');
    assert.equal(incompleteCreate.data.created_new, true);
    assert.equal(incompleteCreate.data.requested_public, false);
    assert.equal(incompleteCreate.data.configured_public, null);

    const managerCountBeforeDeniedCreate = (await mock.mockFetch('/api/fileman/manager', { headers: manager })).count;
    const deniedSystemCreate = await mock.mockFetch('/api/fileman/manager', { method: 'POST', headers: manager, body: { name: 'Unauthorized system backend', backend_type: 'file', backend_url: '/tmp/nope' } });
    assert.equal(deniedSystemCreate.error_code, 403);
    assert.equal((await mock.mockFetch('/api/fileman/manager', { headers: manager })).count, managerCountBeforeDeniedCreate);
    const scopedCreate = await mock.mockFetch('/api/fileman/manager', { method: 'POST', headers: manager, body: { name: 'Scoped backend', backend_type: 'file', backend_url: '/srv/scoped', group: 1 } });
    assert.equal(scopedCreate.data.group.id, 1);
    const systemCreate = await mock.mockFetch('/api/fileman/manager', { method: 'POST', headers: superuser, body: { name: 'System backend', backend_type: 'file', backend_url: '/srv/system' } });
    assert.equal(systemCreate.data.group, null);
    assert.equal(systemCreate.data.user, null);
    const credentialWrite = await mock.mockFetch('/api/fileman/manager/4101', { method: 'POST', headers: manager, body: { aws_key: canary, aws_secret: canary } });
    assert.equal(credentialWrite.status, true);
    assert(!JSON.stringify(credentialWrite).includes(canary));
    assert.deepEqual(Object.keys(credentialWrite.data).filter((key) => /secret|key/.test(key)).sort(), ['aws_key_masked', 'aws_secret_masked']);
    const moved = await mock.mockFetch('/api/fileman/file/5101', { method: 'POST', headers: manager, body: { group: 2 } });
    assert.equal(moved.data.group.id, 2);
    const shared = await mock.mockFetch('/api/fileman/file/5101', { method: 'POST', headers: manager, body: { share: { expire_days: 7, track_clicks: true, note: 'verify' } } });
    assert.equal(shared.status, true);
    const visibleShares = await mock.mockFetch('/api/shortlink/link', { headers: manager, params: { graph: 'default', source: 'fileman-share', file: 5101 } });
    assert.equal(visibleShares.count, 1);
    assert.equal((await mock.mockFetch(`/api/shortlink/link/${visibleShares.data[0].id}`, { method: 'POST', headers: manager, body: { is_active: false } })).data.is_active, false);
    const initialPending = await mock.mockFetch('/api/fileman/file/5106', { headers: manager });
    assert.deepEqual(initialPending.data.renditions, {});
    const initialArrived = await mock.mockFetch('/api/fileman/file/5106', { headers: manager });
    assert.deepEqual(Object.keys(initialArrived.data.renditions).sort(), ['preview', 'thumbnail']);
    const previewModified = initialArrived.data.renditions.preview.modified;
    const regenerated = await mock.mockFetch('/api/fileman/file/5106', { method: 'POST', headers: manager, body: { regenerate_renditions: ['preview', 'preview'] } });
    assert.deepEqual(regenerated.data.roles, ['preview']);
    assert.equal((await mock.mockFetch('/api/fileman/file/5106', { headers: manager })).data.renditions.preview.modified, previewModified);
    assert((await mock.mockFetch('/api/fileman/file/5106', { headers: manager })).data.renditions.preview.modified > previewModified);
    await mock.mockFetch('/api/fileman/file/5107', { method: 'POST', headers: manager, body: { regenerate_renditions: ['preview'] } });
    assert.equal((await mock.mockFetch('/api/fileman/file/5107', { headers: manager })).data.upload_status, 'completed');
    assert.equal((await mock.mockFetch('/api/fileman/file/5107', { headers: manager })).data.upload_status, 'failed');
    await mock.mockFetch('/api/fileman/file/5108', { method: 'POST', headers: manager, body: { regenerate_renditions: ['preview'] } });
    await mock.mockFetch('/api/fileman/file/5108', { headers: manager });
    assert.equal((await mock.mockFetch('/api/fileman/file/5108', { headers: manager })).data.upload_status, 'expired');

    // Source-level omissions and the imperative secret/capability boundary.
    const storageSources = stripComments(await Promise.all([
        'BucketsPage.tsx', 'BucketDetail.tsx', 'BackendsPage.tsx', 'FileManagerDetail.tsx',
        'FilesPage.tsx', 'FileView.tsx', 'FilePreview.tsx', 'storage-dialogs.tsx', 'models.ts',
    ].map((name) => read(`packages/portal-mojo/src/admin/storage/${name}`))).then((parts) => parts.join('\n')));
    assert(!storageSources.includes('/api/fileman/upload'));
    assert(!storageSources.includes('type="file"'));
    assert(!storageSources.includes('onDrop'));
    assert(!/mojoDelete\([^\n]*FileManager/.test(storageSources));
    assert(!/mojoDelete\([^\n]*bucket/i.test(storageSources));
    assert.match(storageSources, /withFreshAuth\(request\)/);
    assert.match(storageSources, /createFileShare/);
    assert.match(storageSources, /StableMediaPreview/);
    assert.match(storageSources, /storageRefreshFailure/);
    assert.match(storageSources, /finally\s*\{/);
    assert.match(storageSources, /refetchQueries/);
    assert.match(storageSources, /removeQueries/);
    assert.match(storageSources, /evidence\.failed/);
    assert.match(storageSources, /evidence\.remaining/);
    assert.match(storageSources, /evidence\.failure/);
    assert.match(storageSources, /evidence\.requested_public/);
    assert.match(storageSources, /evidence\.configured_public/);
    const managerDetailSource = await read('packages/portal-mojo/src/admin/storage/FileManagerDetail.tsx');
    assert.equal((managerDetailSource.match(/useCan\(/g) ?? []).length, 3);
    assert(!managerDetailSource.includes('|| useCan('));
    const fileViewSource = await read('packages/portal-mojo/src/admin/storage/FileView.tsx');
    assert.match(fileViewSource, /pollGeneration/);
    assert.match(fileViewSource, /regenerationBusyRef/);
    assert.match(fileViewSource, /disabled=\{pollingDisabled\}/);
    const clientSource = await read('packages/portal-mojo/src/client/client.ts');
    assert.match(clientSource, /errorCode = body\.error_code/);
    assert.match(clientSource, /body\.code \?\? legacyStatus/);
    assert.match(await read('apps/showcase/src/pages/components/ComponentsPage.tsx'), /admin-storage/);
    assert.match(await read('packages/portal-mojo/docs/admin-storage.md'), /five seconds|12 fetch attempts/i);

    console.log('verify-admin-storage: all assertions passed');
} finally {
    await server.close();
}
