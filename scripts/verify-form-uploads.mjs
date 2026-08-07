import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readFile, stat } from 'node:fs/promises';
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
globalThis.sessionStorage = globalThis.localStorage;

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

try {
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const upload = await server.ssrLoadModule('/packages/portal-mojo/src/client/upload.ts');
    const wire = await server.ssrLoadModule('/packages/portal-mojo/src/ui/field-wire.ts');
    const autosave = await server.ssrLoadModule('/packages/portal-mojo/src/ui/form-autosave.ts');
    const types = await server.ssrLoadModule('/packages/portal-mojo/src/client/types.ts');
    const me = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');
    const users = await server.ssrLoadModule('/packages/portal-mojo/src/admin/identity/users/models.ts');
    const fileField = await server.ssrLoadModule('/packages/portal-mojo/src/ui/FileField.tsx');
    await server.ssrLoadModule('/packages/portal-mojo/src/ui/field-registry.tsx');

    const imageField = { name: 'avatar', type: 'image', label: 'Avatar' };
    assert.equal(wire.fileRelationId(42), 42);
    assert.equal(wire.fileRelationId({ id: 42, url: 'https://capability.invalid' }), 42);
    for (const rejected of ['42', true, false, 0, -1, 1.5, { id: '42' }, { id: true }]) {
        assert.equal(wire.fileRelationId(rejected), null, `strict File id rejects ${JSON.stringify(rejected)}`);
    }
    assert.equal(autosave.toDisplay(imageField, { id: 88, url: '/private' }), 88);
    assert.equal(autosave.toDisplay(imageField, '88'), null, 'relation normalization precedes generic String coercion');
    assert.equal(autosave.valueChanged(imageField, 88, 88), false);
    assert.equal(autosave.valueChanged(imageField, null, 88), true);
    assert.equal(fileField.reconcileFileOwnerResult(202, { generation: 5, status: 'success', requestedValue: 101, authoritativeValue: 101 }, 4), 'ignore', 'candidate A result cannot settle replacement B');
    assert.equal(fileField.reconcileFileOwnerResult(202, { generation: 6, status: 'success', requestedValue: 202, authoritativeValue: 201 }, 5), 'failed', 'matching attempt with mismatched owner relation is attach-failed');
    assert.equal(fileField.reconcileFileOwnerResult(202, { generation: 6, status: 'success', requestedValue: 202, authoritativeValue: 202 }, 5), 'attached');
    assert.equal(fileField.reconcileFileOwnerResult(null, { generation: 7, status: 'success', requestedValue: null, authoritativeValue: null }, 6), 'attached');
    assert.equal(fileField.reconcileFileOwnerResult(null, { generation: 7, status: 'success', requestedValue: 'null', authoritativeValue: null }, 6), 'ignore');

    const expanded = { id: 2, display_name: 'Maya', avatar: { id: 5101, url: '/secret', thumbnail: '/secret-thumb', upload_url: 'never' } };
    assert.deepEqual(types.sanitizeAvatarRelation(expanded.avatar), { id: 5101 });
    assert.deepEqual(me.sanitizeMe(expanded).avatar, { id: 5101 }, 'me cache boundary strips capabilities independently');
    assert.deepEqual(users.sanitizeUserRow(expanded).avatar, { id: 5101 }, 'UserModel cache boundary strips capabilities independently');

    const login = await mock.mockFetch('/api/login', { method: 'POST', body: { username: 'groups.manager@nativemojo.com', password: 'mojo' } });
    client.installAuthHooks({ async preRequest() {}, authHeader: () => `Bearer ${login.data.access_token}` });
    mock.setMockUploadMode('raw-put');
    const completed = await upload.startFileUpload(new File(['avatar'], 'avatar.png', { type: 'image/png' })).result;
    assert.equal(completed.status, 'completed');
    assert.equal(completed.file.groupId, null, 'avatar candidate is in personal, not group, scope');
    const attached = await client.mojoSave('/api/user', 2, { avatar: completed.file.id });
    assert.equal(attached.avatar.id, completed.file.id, 'owner response authoritatively confirms the numeric relation');
    assert.equal(typeof attached.avatar.url, 'string', 'wire mock expands the avatar relation like django-mojo');
    assert.deepEqual(users.sanitizeUserRow(attached).avatar, { id: completed.file.id });
    const retainedOwner = await client.mojoGet('/api/fileman/file', completed.file.id);
    assert.equal(retainedOwner.user.id, 13, 'admin-on-behalf attachment retains acting uploader ownership');
    const cleared = await client.mojoSave('/api/user', 2, { avatar: null });
    assert.equal(cleared.avatar, null);
    assert.equal((await client.mojoGet('/api/fileman/file', completed.file.id)).id, completed.file.id, 'clear detaches without deleting File');
    await assert.rejects(() => client.mojoSave('/api/user', 2, { avatar: String(completed.file.id) }), /positive File id or null/);
    await assert.rejects(() => client.mojoSave('/api/user', 2, { avatar: true }), /positive File id or null/);
    await assert.rejects(() => client.mojoSave('/api/user', 2, { avatar: 5109 }), /File unavailable/, 'admin cannot attach another uploader’s candidate');

    const [fieldSource, queueSource, coreSource, formSource, wizardSource, formViewSource, avatarSource, portalCss, showcaseCss] = await Promise.all([
        readFile(new URL('../packages/portal-mojo/src/ui/FileField.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/ui/UploadQueue.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/ui/schema-form-core.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/ui/FormFields.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/ui/FormWizard.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/ui/FormView.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/admin/identity/users/sections/actions.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../apps/portal/src/theme/file-upload.css', import.meta.url), 'utf8'),
        readFile(new URL('../apps/showcase/src/theme/file-upload.css', import.meta.url), 'utf8'),
    ]);
    for (const state of ['keep', 'clear', 'replacement-in-progress', 'replacement-failed', 'completed-awaiting-attach', 'attach-failed']) assert(fieldSource.includes(`'${state}'`), `explicit field state: ${state}`);
    assert.match(fieldSource, /<FileDropZone/, 'field itself is keyboard-accessible and accepts drop');
    assert.match(fieldSource, /result\.generation <= lastGeneration/, 'stale owner results are generation-guarded');
    assert.match(fieldSource, /requestedMatches/, 'owner results are tied to the exact sent File value');
    assert.match(fieldSource, /referrerPolicy="no-referrer"/, 'stored image capabilities do not leak through referrers');
    assert.match(fieldSource, /URL\.revokeObjectURL/, 'local object previews are revoked');
    assert.match(fieldSource, /if \(item\.canCancel\) queue\.cancel\(item\.id\);\s*queue\.remove\(item\.id\)/, 'active queue work is cancelled before removal');
    assert(!/localStorage|sessionStorage|useQuery|QueryClient|console\.|throw new Error\([^)]*url/i.test(fieldSource), 'capabilities never persist, cache, log, or enter errors');
    assert.match(queueSource, /if \(!next\.authenticated \|\| next\.uid !== authUid\) store\.dispose\(\)/, 'auth loss disposes and cancels the real queue task');
    assert.match(coreSource, /setUploadPending/);
    assert.match(formSource, /disabled=\{busy \|\| form\.uploadPending\}/);
    assert.match(wizardSource, /const locked = busy \|\| form\.uploadPending/);
    assert.match(formViewSource, /publishOwnerResult\(info\.fields, 'success', info\.changes, info\.row\)/);
    assert.match(avatarSource, /onPendingChange\(uploadPending \|\| busy\)/, 'avatar dismissal covers transfer and owner save');
    assert.match(avatarSource, /authoritative !== avatar/, 'avatar success requires exact returned id/null');
    assert.equal(portalCss, showcaseCss, 'both themes carry byte-identical upload field styles');
    await stat(new URL('../packages/portal-mojo/docs/forms.md', import.meta.url));
    await stat(new URL('../packages/portal-mojo/docs/admin-identity-users.md', import.meta.url));
    console.log('verify-form-uploads: all contracts passed');
} finally {
    await server.close();
}
