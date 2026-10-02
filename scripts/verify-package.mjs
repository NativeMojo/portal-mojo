import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const root = fileURLToPath(new URL('..', import.meta.url));

// The package stylesheet contract (#5921): one self-layered, self-scanning
// entry, every component file reachable from it, and a token contract the
// reference app meets. Comments are stripped before any rule is read.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const exists = (url) => access(url).then(() => true, () => false);
async function verifyStyles(manifest) {
    assert.equal(manifest.exports['./styles.css'], './src/styles/index.css', 'portal-mojo/styles.css must resolve to src/styles/index.css');
    const styles = new URL('../packages/portal-mojo/src/styles/', import.meta.url);
    const index = stripComments(await readFile(new URL('index.css', styles), 'utf8'));
    const statements = index.split(';').map((statement) => statement.trim()).filter(Boolean);
    assert.equal(statements[0], '@layer theme, base, components, utilities, portal-mojo', 'index.css must open with the layer order, portal-mojo after utilities');
    assert.equal(statements[1], '@source "../"', 'index.css must scan the package source right after the layer order');
    const imports = statements.slice(2);
    const imported = [];
    for (const statement of imports) {
        const match = /^@import "\.\/(components\/[\w-]+\.css|core\.css)" layer\(portal-mojo\)$/.exec(statement);
        assert(match, `index.css may only hold package imports in layer(portal-mojo): ${statement}`);
        imported.push(match[1]);
    }
    assert.equal(imported.at(-1), 'core.css', 'index.css must import core.css last, after every component file');
    assert.equal(new Set(imported).size, imported.length, 'index.css must import each styles file once');
    const onDisk = (await readdir(new URL('components/', styles))).filter((name) => name.endsWith('.css')).map((name) => `components/${name}`).sort();
    assert.deepEqual(imported.slice(0, -1).sort(), onDisk, 'src/styles/components and the index.css imports must be the same set');

    // Tokens: a var() with no fallback is either declared by the package's own
    // styles (component-private) or part of the contract the app must meet.
    const consumed = new Set();
    const declared = new Set();
    for (const file of imported) {
        const css = stripComments(await readFile(new URL(file, styles), 'utf8'));
        for (const match of css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) consumed.add(match[1]);
        for (const match of css.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)) declared.add(match[1]);
    }
    const contract = JSON.parse(await readFile(new URL('required-tokens.json', styles), 'utf8'));
    const undeclared = Object.keys(contract.knownUndeclared ?? {});
    const needed = [...consumed].filter((name) => !declared.has(name)).sort();
    assert.deepEqual([...contract.required, ...undeclared].sort(), needed, 'required-tokens.json must list exactly the tokens the package styles consume without a fallback and do not declare');
    assert.deepEqual(contract.required, [...contract.required].sort(), 'required-tokens.json must keep its list sorted');

    // The reference app meets the contract, in light and in dark.
    const theme = stripComments(await readFile(new URL('../apps/portal/src/theme.css', import.meta.url), 'utf8'));
    const block = (selector) => {
        const start = theme.indexOf(`${selector} {`);
        assert(start !== -1, `apps/portal/src/theme.css must declare ${selector}`);
        return theme.slice(start, theme.indexOf('}', start));
    };
    const light = block(':root');
    const dark = block(':root[data-theme="dark"]');
    for (const name of contract.required) {
        assert(light.includes(`${name}:`), `apps/portal/src/theme.css must declare ${name} for light`);
        assert(dark.includes(`${name}:`), `apps/portal/src/theme.css must declare ${name} for dark`);
    }
    for (const name of undeclared) assert(!theme.includes(`${name}:`), `${name} is now declared: drop it from knownUndeclared`);
    assert(/@import "tailwindcss";\s*@import "portal-mojo\/styles\.css";/.test(theme), 'apps/portal/src/theme.css must import portal-mojo/styles.css right after tailwindcss');
    assert(!theme.includes('@source'), 'apps/portal/src/theme.css must not point Tailwind at the package: the package scans itself');
    assert(!theme.includes('./theme/'), 'apps/portal/src/theme.css must not import copied component files');
    assert(!await exists(new URL('../apps/portal/src/theme', import.meta.url)), 'apps/portal/src/theme must not exist: component styles ship with the package');
}
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
    assert.deepEqual(Object.keys(manifest.exports).sort(), ['./admin', './admin/assistant', './admin/assistant/launcher', './admin/communications', './admin/core', './admin/identity', './admin/infrastructure', './admin/observability', './admin/operations', './admin/registry', './admin/security', './charts', './client', './client/runtime', './personas', './styles.css', './ui', './ui/shell']);
    await verifyStyles(manifest);
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    for (const name of ['ASSISTANT_ADMIN_SECTION', 'AssistantFeed', 'AssistantPanel', 'AssistantLauncher', 'AssistantContextLauncher', 'ConversationsPage', 'SkillsPage', 'MemoriesPage']) assert(admin[name] !== undefined, `portal-mojo/admin must export ${name}`);
    for (const name of ['FilesPage', 'FileUploadSurface', 'FileManagerUploadPolicyModel']) assert(admin[name] !== undefined, `portal-mojo/admin must export ${name}`);
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/index.ts');
    const ui = await server.ssrLoadModule('/packages/portal-mojo/src/ui/index.ts');
    for (const name of ['safeFileReference', 'safeRecordFeedRow']) assert(client[name] !== undefined, `portal-mojo/client must export ${name}`);
    for (const name of ['AttachmentQueue', 'RecordFeed']) assert(ui[name] !== undefined, `portal-mojo/ui must export ${name}`);
    console.log('portal-mojo package exports verified');
} finally { await server.close(); }
