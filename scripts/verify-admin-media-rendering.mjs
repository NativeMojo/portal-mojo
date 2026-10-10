// Targeted contract verifier for Storage → Media rendering (#7729): the
// form↔JSON mapper both ways, the 400-message routing, the reset payload, the
// mock descriptor/validator, and the registry gate.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};

const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

try {
    const rs = await server.ssrLoadModule('/packages/portal-mojo/src/admin/storage/rendition-settings.ts');
    const labels = await server.ssrLoadModule('/packages/portal-mojo/src/admin/storage/file-renditions.ts');
    const rmock = await server.ssrLoadModule('/packages/portal-mojo/src/client/renditions-mock.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const { STORAGE_ADMIN_SECTION: section } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/domains/infrastructure.ts');
    const me = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');

    // ── Descriptor shape (the executable spec of django-mojo #7728) ──────
    const described = rmock.describeRenditions([]);
    assert.deepEqual(Object.keys(described.categories).sort(), ['document', 'image', 'video']);
    const video = described.categories.video;
    assert.equal(video.key, 'FILEMAN_RENDITIONS_VIDEO');
    assert.deepEqual(Object.keys(video.defaults), ['video_thumbnail', 'thumbnail', 'video_preview', 'video_mp4', 'video_webm', 'video_hevc']);
    assert.deepEqual(video.automatic_default, ['video_thumbnail', 'thumbnail', 'video_preview']);
    assert.equal(video.override, null);
    assert.deepEqual(video.effective.automatic, video.automatic_default);
    assert.deepEqual(video.role_kinds, { video_thumbnail: 'thumbnail', thumbnail: 'thumbnail', video_preview: 'transcode', video_mp4: 'transcode', video_webm: 'transcode', video_hevc: 'transcode' });
    assert.deepEqual(video.fields.transcode, ['audio', 'bitrate', 'codec', 'crf', 'duration', 'format', 'height', 'preset', 'width']);
    assert.deepEqual(video.choices.transcode.codec, ['h264', 'h265']);
    assert.deepEqual(video.limits, { width: [1, 4096], height: [1, 4096], crf: [18, 51], duration: [1, 60] });
    assert.deepEqual(video.defaults.video_hevc, { width: 1280, height: 720, format: 'mp4', codec: 'h265', crf: 28, preset: 'medium', audio: true });
    const image = described.categories.image;
    assert.deepEqual(image.fields.image, ['format', 'height', 'mode', 'quality', 'width']);
    assert.equal(image.defaults.thumbnail.format, undefined, 'image defaults carry no format (renderer class attribute)');
    assert.deepEqual(image.limits, { width: [1, 4096], height: [1, 4096], quality: [1, 100] });
    const document = described.categories.document;
    // The server lists a bound for every option NAME it limits anywhere in the category — document
    // `quality` is a choice on pdf roles yet still appears here (config.describe), so typing must prefer choices.
    assert.deepEqual(document.limits, { width: [1, 4096], height: [1, 4096], quality: [1, 100], max_pages: [1, 200], page: [1, 500] });
    assert.deepEqual(document.choices.pdf.quality, ['low', 'medium', 'high']);
    assert.deepEqual(described.engine, { key: 'FILEMAN_VIDEO_ENGINE', choices: ['ffmpeg'], effective: 'ffmpeg' });
    // An empty object is "defaults": reported as override null (config.global_override).
    assert.equal(rmock.describeRenditions([{ key: 'FILEMAN_RENDITIONS_VIDEO', value: '{}' }]).categories.video.override, null);
    const withOverride = rmock.describeRenditions([{ key: 'FILEMAN_RENDITIONS_VIDEO', value: JSON.stringify({ video_hevc: { crf: 24 }, _automatic: ['thumbnail', 'video_hevc'] }) }]).categories.video;
    assert.deepEqual(withOverride.override, { video_hevc: { crf: 24 }, _automatic: ['thumbnail', 'video_hevc'] });
    assert.equal(withOverride.effective.roles.video_hevc.crf, 24);
    assert.equal(withOverride.effective.roles.video_hevc.preset, 'medium', 'per-role options shallow-merge over defaults');
    assert.deepEqual(withOverride.effective.automatic, ['thumbnail', 'video_hevc']);

    // ── Mock validator speaks the server's grammar ───────────────────────
    const v = rmock.validateRenditionSetting;
    assert.equal(v('FILEMAN_RENDITIONS_VIDEO', {}), null);
    assert.equal(v('FILEMAN_RENDITIONS_VIDEO', '{}'), null);
    assert.equal(v('SITE_NAME', 'anything'), null, 'other keys are untouched');
    assert.equal(v('FILEMAN_RENDITIONS_VIDEO', { video_hevc: { crf: 99 } }), 'video_hevc.crf: must be between 18 and 51');
    assert.equal(v('FILEMAN_RENDITIONS_VIDEO', { video_hevc: { crf: '24' } }), 'video_hevc.crf: must be a whole number');
    assert.equal(v('FILEMAN_RENDITIONS_VIDEO', { video_webm: { codec: 'h265' } }), 'video_webm.codec: only valid when format is mp4');
    assert.equal(v('FILEMAN_RENDITIONS_VIDEO', { video_mp4: { format: 'webm' } }), null, 'format wins: switching to webm with a default codec is accepted');
    assert.equal(v('FILEMAN_RENDITIONS_VIDEO', { video_mp4: { format: 'webm', crf: 20 } }), 'video_mp4.crf: only valid when format is mp4');
    assert.equal(v('FILEMAN_RENDITIONS_VIDEO', { nope: {} }), 'nope: unknown role (valid: thumbnail, video_hevc, video_mp4, video_preview, video_thumbnail, video_webm)');
    assert.equal(v('FILEMAN_RENDITIONS_VIDEO', { thumbnail: { codec: 'h264' } }), 'thumbnail.codec: unknown option (valid: format, height, time_offset, width)');
    assert.equal(v('FILEMAN_RENDITIONS_VIDEO', { _automatic: ['nope'] }), '_automatic: unknown role nope (valid: thumbnail, video_hevc, video_mp4, video_preview, video_thumbnail, video_webm)');
    assert.equal(v('FILEMAN_RENDITIONS_VIDEO', { video_mp4: { bitrate: 'fast' } }), 'video_mp4.bitrate: must look like 2000k or 2M');
    assert.equal(v('FILEMAN_RENDITIONS_VIDEO', { thumbnail: { time_offset: '3' } }), 'thumbnail.time_offset: must look like HH:MM:SS');
    assert.equal(v('FILEMAN_RENDITIONS_VIDEO', []), 'FILEMAN_RENDITIONS_VIDEO must be a JSON object');
    assert.equal(v('FILEMAN_RENDITIONS_IMAGE', { thumbnail: { quality: 0 } }), 'thumbnail.quality: must be between 1 and 100');
    assert.equal(v('FILEMAN_RENDITIONS_DOCUMENT', { document_preview: { quality: 90 } }), 'document_preview.quality: must be one of low, medium, high');

    // ── Mapper: draft ↔ value ────────────────────────────────────────────
    const untouched = rs.valueToDraft(video, null);
    assert.deepEqual(untouched.roles.video_hevc, video.defaults.video_hevc);
    assert.deepEqual(untouched.automatic, video.automatic_default);
    assert.deepEqual(rs.draftToValue(video, untouched), {}, 'an untouched draft emits no override');
    const edited = structuredClone(untouched);
    edited.roles.video_hevc.crf = 24;
    assert.deepEqual(rs.draftToValue(video, edited), { video_hevc: { crf: 24 } }, 'only the changed option is emitted');
    edited.roles.video_hevc.crf = 28;
    assert.deepEqual(rs.draftToValue(video, edited), {}, 'a value restored to its default disappears from the override');
    // Seeding from an override, not from effective (deployment-file values never become DB rows).
    const seeded = rs.valueToDraft(video, { video_mp4: { width: 1920 }, _automatic: ['thumbnail', 'video_hevc', 'ghost_role'] });
    assert.equal(seeded.roles.video_mp4.width, 1920);
    assert.equal(seeded.roles.video_mp4.height, 720);
    assert.deepEqual(seeded.automatic, ['thumbnail', 'video_hevc'], 'roles the defaults do not declare are dropped');
    assert.deepEqual(rs.draftToValue(video, seeded), { video_mp4: { width: 1920 }, _automatic: ['thumbnail', 'video_hevc'] }, 'round trip');
    const fileValued = { ...video, effective: { roles: { ...video.effective.roles, video_mp4: { ...video.effective.roles.video_mp4, width: 1920 } }, automatic: video.effective.automatic } };
    assert.deepEqual(rs.draftToValue(fileValued, rs.valueToDraft(fileValued, fileValued.override)), {}, 'an effective-only value is not a change');
    // `_automatic`: compared as a set, emitted in default order with additions appended.
    const reordered = structuredClone(untouched);
    reordered.automatic = ['video_preview', 'thumbnail', 'video_thumbnail'];
    assert.deepEqual(rs.draftToValue(video, reordered), {}, 'order alone is not a change');
    reordered.automatic = ['video_hevc', 'video_preview', 'thumbnail', 'video_thumbnail'];
    assert.deepEqual(rs.draftToValue(video, reordered)._automatic, ['video_thumbnail', 'thumbnail', 'video_preview', 'video_hevc']);
    reordered.automatic = ['thumbnail'];
    assert.deepEqual(rs.draftToValue(video, reordered)._automatic, ['thumbnail']);
    // mp4-only trio is stripped on a non-mp4 role, kept on mp4.
    const webm = structuredClone(untouched);
    webm.roles.video_mp4.format = 'webm';
    webm.roles.video_mp4.crf = 20;
    webm.roles.video_mp4.preset = 'fast';
    assert.deepEqual(rs.draftToValue(video, webm), { video_mp4: { format: 'webm' } });
    assert.equal(rs.hidesMp4Options(video, webm, 'video_mp4'), true);
    assert.equal(rs.hidesMp4Options(video, webm, 'video_webm'), true, 'the default webm role hides the trio too');
    assert.equal(rs.hidesMp4Options(video, webm, 'video_hevc'), false);
    assert.equal(rs.hidesMp4Options(video, webm, 'thumbnail'), false, 'thumbnail kinds never carry codec');
    assert.equal(v('FILEMAN_RENDITIONS_VIDEO', rs.draftToValue(video, webm)), null, 'what the mapper emits, the server accepts');
    // One typing rule for every field; number inputs are coerced before compare/emit.
    assert.equal(rs.fieldType(video, 'transcode', 'width'), 'number');
    assert.equal(rs.fieldType(video, 'transcode', 'codec'), 'choice');
    assert.equal(rs.fieldType(video, 'transcode', 'audio'), 'boolean');
    assert.equal(rs.fieldType(video, 'transcode', 'bitrate'), 'string');
    assert.equal(rs.fieldType(image, 'image', 'quality'), 'number');
    assert.equal(rs.fieldType(image, 'image', 'format'), 'choice');
    assert.equal(rs.fieldType(document, 'pdf', 'quality'), 'choice', 'a choice listed under limits still renders as a choice');
    assert.equal(rs.fieldType(document, 'pdf', 'max_pages'), 'number');
    assert.equal(rs.coerceFieldValue('number', '300'), 300);
    assert.equal(rs.coerceFieldValue('number', ''), null);
    assert.equal(rs.coerceFieldValue('number', 'abc'), null);
    assert.equal(rs.coerceFieldValue('boolean', 'true'), true);
    assert.equal(rs.coerceFieldValue('string', 7), '7');
    const typed = structuredClone(untouched);
    typed.roles.video_mp4.width = rs.coerceFieldValue('number', '1280');
    assert.deepEqual(rs.draftToValue(video, typed), {}, 'a coerced number equal to the default is not a change');
    typed.roles.video_mp4.width = rs.coerceFieldValue('number', '1920');
    assert.deepEqual(rs.draftToValue(video, typed), { video_mp4: { width: 1920 } });
    assert.equal(typeof rs.draftToValue(video, typed).video_mp4.width, 'number');
    // Image fields with no default: unset is omitted, set is emitted, cleared is omitted again.
    const img = rs.valueToDraft(image, null);
    assert.deepEqual(rs.draftToValue(image, img), {});
    img.roles.thumbnail.format = 'webp';
    img.roles.thumbnail.quality = 90;
    assert.deepEqual(rs.draftToValue(image, img), { thumbnail: { format: 'webp', quality: 90 } });
    assert.equal(rs.isDefaultValue(image, img, 'thumbnail', 'format'), false);
    img.roles.thumbnail.format = '';
    assert.equal(rs.isDefaultValue(image, img, 'thumbnail', 'format'), true, 'unset with no default reads as default');
    assert.deepEqual(rs.draftToValue(image, img), { thumbnail: { quality: 90 } });
    assert.equal(rs.sameOverride({}, null), true);
    assert.equal(rs.sameOverride({ a: 1 }, null), false);

    // ── Client hints mirror the server's wording (advisory, not a gate) ───
    const bad = structuredClone(untouched);
    bad.roles.video_hevc.crf = 99;
    bad.roles.video_mp4.bitrate = 'fast';
    bad.roles.thumbnail.time_offset = '3';
    bad.roles.video_mp4.format = 'avi';
    assert.deepEqual(rs.validateDraft(video, bad).map((entry) => entry.message).sort(), [
        'thumbnail.time_offset: must look like HH:MM:SS',
        'video_hevc.crf: must be between 18 and 51',
        'video_mp4.bitrate: must look like 2000k or 2M',
        'video_mp4.format: must be one of mp4, webm',
    ]);
    assert.deepEqual(rs.validateDraft(video, untouched), []);
    const docDraft = rs.valueToDraft(document, null);
    docDraft.roles.document_preview.max_pages = 500;
    assert.deepEqual(rs.validateDraft(document, docDraft), [{ role: 'document_preview', field: 'max_pages', message: 'document_preview.max_pages: must be between 1 and 200' }]);

    // ── 400 routing ──────────────────────────────────────────────────────
    const roles = [...Object.keys(video.defaults), '_automatic'];
    assert.deepEqual(rs.routeRenditionError('video_hevc.crf: must be between 18 and 51', roles), { role: 'video_hevc', field: 'crf', message: 'must be between 18 and 51' });
    assert.deepEqual(rs.routeRenditionError('video_hevc: must be an object of options', roles), { role: 'video_hevc', field: null, message: 'must be an object of options' });
    assert.deepEqual(rs.routeRenditionError('_automatic: unknown role nope (valid: a, b)', roles), { role: '_automatic', field: null, message: 'unknown role nope (valid: a, b)' });
    assert.deepEqual(rs.routeRenditionError('FILEMAN_RENDITIONS_VIDEO must be a JSON object', roles), { role: null, field: null, message: 'FILEMAN_RENDITIONS_VIDEO must be a JSON object' });
    assert.deepEqual(rs.routeRenditionError('ghost.crf: nope', roles), { role: null, field: null, message: 'ghost.crf: nope' }, 'a role not on screen falls back to the panel');
    assert.deepEqual(rs.routeRenditionError('Setting with this Key and Group already exists.', roles).role, null);

    // ── Labels and category order ────────────────────────────────────────
    assert.equal(labels.renditionRoleLabel('video_hevc'), 'Video HEVC');
    assert.equal(labels.renditionRoleLabel('thumbnail_sm'), 'Thumbnail sm');
    assert.equal(labels.renditionRoleLabel('document_pdf'), 'Document PDF');
    assert.deepEqual(rs.orderedCategories(described), ['image', 'video', 'document']);
    assert.deepEqual(rs.orderedCategories({ categories: { audio: video, video } }), ['video', 'audio']);

    // ── Mock REST round trip: options → create → update → 400 → reset ────
    const login = async (email) => {
        const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } });
        return { Authorization: `Bearer ${response.data.access_token}` };
    };
    const manager = await login('security.manager@nativemojo.com');
    const storageMember = await login('storage.member@nativemojo.com');
    const storageViewer = await login('storage.viewer@nativemojo.com');
    assert.equal((await mock.mockFetch('/api/fileman/renditions/options', { headers: storageMember })).error_code, 403, 'a member-only grant cannot read the descriptor');
    assert.equal((await mock.mockFetch('/api/fileman/renditions/options', { headers: storageViewer })).error_code, 403, 'view_fileman alone cannot read the descriptor');
    assert.equal((await mock.mockFetch('/api/fileman/renditions/options', { headers: manager, method: 'POST', body: {} })).error_code, 405);
    const options = await mock.mockFetch('/api/fileman/renditions/options', { headers: manager });
    assert.equal(options.status, true);
    assert.deepEqual(options.data.categories.video.override, { video_hevc: { crf: 24 } }, 'the seeded global row is reported as the override');
    assert.equal(options.data.categories.video.effective.roles.video_hevc.crf, 24);
    assert.equal(options.data.categories.image.override, null);
    const seededRows = await mock.mockFetch('/api/settings', { headers: manager, params: { key: 'FILEMAN_RENDITIONS_VIDEO', group__isnull: true, size: 10 } });
    assert.equal(seededRows.data.length, 1, 'key + group__isnull finds exactly the global row');
    const seededRow = seededRows.data[0];
    assert.equal(seededRow.key, 'FILEMAN_RENDITIONS_VIDEO');
    // Create for a category with no row: the object body is stored as JSON text.
    const created = await mock.mockFetch('/api/settings', { headers: manager, method: 'POST', body: { key: 'FILEMAN_RENDITIONS_IMAGE', is_secret: false, group: null, value: { thumbnail: { width: 200 } } } });
    assert.equal(created.status, true);
    assert.equal(created.data.value, JSON.stringify({ thumbnail: { width: 200 } }));
    assert.deepEqual((await mock.mockFetch('/api/fileman/renditions/options', { headers: manager })).data.categories.image.override, { thumbnail: { width: 200 } });
    // Update: a refused value answers 400 with the server's message and leaves the row untouched.
    const refused = await mock.mockFetch(`/api/settings/${seededRow.id}`, { headers: manager, method: 'POST', body: { value: { video_hevc: { crf: 99 } } } });
    assert.deepEqual(refused, { status: false, error: 'video_hevc.crf: must be between 18 and 51', error_code: 400 });
    assert.deepEqual((await mock.mockFetch('/api/fileman/renditions/options', { headers: manager })).data.categories.video.override, { video_hevc: { crf: 24 } });
    const refusedCreate = await mock.mockFetch('/api/settings', { headers: manager, method: 'POST', body: { key: 'FILEMAN_RENDITIONS_DOCUMENT', is_secret: false, group: null, value: { document_preview: { max_pages: 0 } } } });
    assert.equal(refusedCreate.error, 'document_preview.max_pages: must be between 1 and 200');
    assert.equal((await mock.mockFetch('/api/fileman/renditions/options', { headers: manager })).data.categories.document.override, null);
    const updated = await mock.mockFetch(`/api/settings/${seededRow.id}`, { headers: manager, method: 'POST', body: { value: { video_mp4: { width: 1920 }, _automatic: ['thumbnail'] } } });
    assert.equal(updated.status, true);
    const afterUpdate = (await mock.mockFetch('/api/fileman/renditions/options', { headers: manager })).data.categories.video;
    assert.deepEqual(afterUpdate.override, { video_mp4: { width: 1920 }, _automatic: ['thumbnail'] });
    assert.deepEqual(afterUpdate.effective.automatic, ['thumbnail']);
    assert.equal(afterUpdate.effective.roles.video_hevc.crf, 28, 'the previous override is replaced whole, not merged');
    // Reset = write {}; DELETE stays refused exactly as live.
    assert.equal((await mock.mockFetch(`/api/settings/${seededRow.id}`, { headers: manager, method: 'DELETE' })).error_code, 403);
    const reset = await mock.mockFetch(`/api/settings/${seededRow.id}`, { headers: manager, method: 'POST', body: { value: {} } });
    assert.equal(reset.status, true);
    const afterReset = (await mock.mockFetch('/api/fileman/renditions/options', { headers: manager })).data.categories.video;
    assert.equal(afterReset.override, null);
    assert.deepEqual(afterReset.effective.roles, afterReset.defaults);
    assert.deepEqual(afterReset.effective.automatic, afterReset.automatic_default);
    assert.equal((await mock.mockFetch('/api/settings', { headers: storageMember, method: 'POST', body: { key: 'FILEMAN_RENDITIONS_VIDEO', value: {} } })).error_code, 403, 'writes keep the Settings gate');
    // The page's save helper sends the create body the server expects (key, plain, global, object value).
    const saveSource = await read('packages/portal-mojo/src/admin/storage/rendition-settings.ts');
    assert.match(saveSource, /\{ key: category\.key, is_secret: false, group: null, value \}/);
    assert.match(saveSource, /mojoSave<SettingRow>\('\/api\/settings', row\?\.id \?\? null, changes\)/);
    assert.match(saveSource, /withFreshAuth\(/);
    assert.doesNotMatch(saveSource, /mojoDelete/, 'reset never deletes: the live Setting model has no CAN_DELETE');

    // ── Registry: route, gate, dual mount, export surface ────────────────
    const route = section.routes.find((entry) => entry.path === 'rendering');
    assert(route, 'storage/rendering is registered');
    assert.equal(route.label, 'Media rendering');
    assert.deepEqual(route.permissions, ['sys.manage_settings', 'sys.groups']);
    assert(admin.adminSectionRoutes([section], { mount: '/system' }).some((entry) => entry.path === 'system/storage/rendering'));
    const sees = (permissions) => me.hasPermission({ id: 1, permissions }, section.permissions, null) && me.hasPermission({ id: 1, permissions }, route.permissions, null);
    assert.equal(sees({ manage_settings: true }), true);
    assert.equal(sees({ groups: true }), true);
    assert.equal(sees({ files: true }), false, 'a files grant can read the descriptor but not open the editor');
    assert.equal(sees({ manage_files: true }), false);
    assert.equal(me.hasPermission({ id: 1, permissions: {} }, route.permissions, { permissions: { manage_settings: true, groups: true } }), false, 'member grants never satisfy the system gate');
    assert.equal(typeof admin.MediaRenderingPage, 'function');
    assert.equal(typeof admin.draftToValue, 'function');
    assert.match(await read('packages/portal-mojo/src/styles/index.css'), /@import "\.\/components\/admin-media-rendering\.css" layer\(portal-mojo\);/);
    assert.match(await read('apps/showcase/src/pages/components/ComponentsPage.tsx'), /admin-media-rendering/);
    assert.match(await read('packages/portal-mojo/docs/admin-media-rendering.md'), /CAN_DELETE|refuses DELETE/);
    const page = await read('packages/portal-mojo/src/admin/storage/MediaRenderingPage.tsx');
    assert.doesNotMatch(page, /textarea/, 'no free-form JSON editor on this page');
    assert.doesNotMatch(page, /CollectionSelect|\/api\/group/, 'global scope only: no group selector');

    console.log('verify-admin-media-rendering: all assertions passed');
} finally {
    await server.close();
}
