import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
    const manifest = JSON.parse(await readFile(new URL('../packages/portal-mojo/package.json', import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(manifest.exports).sort(), ['./admin', './charts', './client', './ui']);
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    for (const name of ['ASSISTANT_ADMIN_SECTION', 'AssistantFeed', 'AssistantPanel', 'AssistantLauncher', 'AssistantContextLauncher', 'ConversationsPage', 'SkillsPage', 'MemoriesPage']) assert(admin[name] !== undefined, `portal-mojo/admin must export ${name}`);
    for (const name of ['FilesPage', 'FileUploadSurface', 'FileManagerUploadPolicyModel']) assert(admin[name] !== undefined, `portal-mojo/admin must export ${name}`);
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/index.ts');
    const ui = await server.ssrLoadModule('/packages/portal-mojo/src/ui/index.ts');
    for (const name of ['safeFileReference', 'safeRecordFeedRow']) assert(client[name] !== undefined, `portal-mojo/client must export ${name}`);
    for (const name of ['AttachmentQueue', 'RecordFeed']) assert(ui[name] !== undefined, `portal-mojo/ui must export ${name}`);
    console.log('portal-mojo package exports verified');
} finally { await server.close(); }
