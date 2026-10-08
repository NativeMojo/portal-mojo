import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
    const manifest = JSON.parse(await readFile(new URL('../packages/portal-mojo/package.json', import.meta.url), 'utf8'));
    assert.equal(manifest.name, 'portal-mojo');
    assert.equal(manifest.private, undefined);
    assert.equal(manifest.license, 'Apache-2.0');
    assert.equal(manifest.repository?.url, 'git+https://github.com/NativeMojo/portal-mojo.git');
    assert.equal(manifest.publishConfig?.access, 'public');
    assert.equal(manifest.publishConfig?.registry, 'https://registry.npmjs.org/');
    assert.equal(manifest.peerDependencies?.['react-dom'], '^19');
    assert.deepEqual(Object.keys(manifest.exports).sort(), ['./account', './admin', './admin/assistant', './admin/assistant/launcher', './admin/communications', './admin/core', './admin/identity', './admin/infrastructure', './admin/observability', './admin/operations', './admin/registry', './admin/security', './charts', './client', './client/runtime', './personas', './ui', './ui/shell']);
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    for (const name of ['ASSISTANT_ADMIN_SECTION', 'AssistantFeed', 'AssistantPanel', 'AssistantLauncher', 'AssistantContextLauncher', 'ConversationsPage', 'SkillsPage', 'MemoriesPage']) assert(admin[name] !== undefined, `portal-mojo/admin must export ${name}`);
    for (const name of ['FilesPage', 'FileUploadSurface', 'FileManagerUploadPolicyModel']) assert(admin[name] !== undefined, `portal-mojo/admin must export ${name}`);
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/index.ts');
    const ui = await server.ssrLoadModule('/packages/portal-mojo/src/ui/index.ts');
    for (const name of ['safeFileReference', 'safeRecordFeedRow']) assert(client[name] !== undefined, `portal-mojo/client must export ${name}`);
    for (const name of ['AttachmentQueue', 'RecordFeed', 'showSecretDialog', 'SecretBox']) assert(ui[name] !== undefined, `portal-mojo/ui must export ${name}`);
    const account = await server.ssrLoadModule('/packages/portal-mojo/src/account/index.ts');
    for (const name of ['AccountModal', 'openAccountModal', 'MeSaveModel', 'PasskeyModel', 'ApiKeyModel', 'useGenerateUserApiKey', 'OAuthConnectionModel', 'PasskeyList', 'NotificationPreferences', 'ApiKeysSection', 'registerPasskey', 'revokeOtherSessions', 'confirmEmailChange']) assert(account[name] !== undefined, `portal-mojo/account must export ${name}`);
    for (const name of ['PasskeyModel', 'ApiKeyModel', 'useGenerateUserApiKey', 'OAuthConnectionModel', 'showSecretDialog']) assert.equal(admin[name], name === 'showSecretDialog' ? ui[name] : account[name], `portal-mojo/admin must re-export the shared ${name}`);
    console.log('portal-mojo package exports verified');
} finally { await server.close(); }
