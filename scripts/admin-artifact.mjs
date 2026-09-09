import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, posix } from 'node:path';

// Shared non-executing checks: importing this module never starts a producer or verifier.
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function safePath(path) {
    return typeof path === 'string' && /^[A-Za-z0-9_.@/-]+$/.test(path)
        && !path.startsWith('/') && path.split('/').every((part) => part && part !== '.' && part !== '..');
}
export async function inventory(directory) {
    const files = [];
    async function walk(base, prefix = '') {
        for (const entry of await readdir(base, { withFileTypes: true })) {
            const path = prefix + entry.name;
            assert(safePath(path), `Unsafe path: ${path}`);
            assert(!entry.isSymbolicLink(), `Symlink: ${path}`);
            if (entry.isDirectory()) await walk(join(base, entry.name), `${path}/`);
            else {
                assert(entry.isFile(), `Nonregular file: ${path}`);
                if (path === 'admin-artifact.json') continue;
                const bytes = await readFile(join(directory, path));
                files.push({ path, size: bytes.length, sha256: hash(bytes) });
            }
        }
    }
    assert((await lstat(directory)).isDirectory() && !(await lstat(directory)).isSymbolicLink(), 'Artifact root must be a real directory');
    await walk(directory);
    return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function keys(value, expected) {
    assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected object');
    assert.deepEqual(Object.keys(value).sort(), expected.split(' ').sort(), 'Unexpected schema keys');
}
export async function verifyArtifact(directory, { expectedHash, requireClean = false } = {}) {
    const manifestPath = join(directory, 'admin-artifact.json');
    assert((await lstat(manifestPath)).isFile() && !(await lstat(manifestPath)).isSymbolicLink(), 'Manifest must be regular');
    const bytes = await readFile(manifestPath);
    if (expectedHash) assert.equal(hash(bytes), expectedHash, 'Manifest identity mismatch');
    const meta = JSON.parse(bytes);
    keys(meta, 'schema_version artifact version source_revision source_dirty toolchain lockfile_sha256 entrypoint asset_base api_mode source_session_contract vite_manifest files');
    const fixed = { schema_version: 1, artifact: 'portal-mojo-admin', entrypoint: 'index.html', asset_base: './', api_mode: 'same-origin', source_session_contract: 1, vite_manifest: '.vite/manifest.json' };
    for (const [key, value] of Object.entries(fixed)) assert.equal(meta[key], value, key);
    assert.match(meta.version, /^\d+\.\d+\.\d+$/);
    assert.match(meta.source_revision, /^[a-f0-9]{40}$/);
    assert.match(meta.lockfile_sha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof meta.source_dirty, 'boolean');
    if (requireClean) assert.equal(meta.source_dirty, false, 'Draft artifact cannot be vendored');
    assert.deepEqual(meta.toolchain, { node: '24.21.0', npm: '11.19.0' });
    assert(Array.isArray(meta.files) && meta.files.length > 0);
    const declared = new Set();
    let previous = '';
    for (const file of meta.files) {
        keys(file, 'path size sha256');
        assert(safePath(file.path) && file.path !== 'admin-artifact.json', `Unsafe inventory path: ${file.path}`);
        assert(file.path > previous, 'Inventory must be sorted and unique'); previous = file.path;
        assert(Number.isSafeInteger(file.size) && file.size >= 0); assert.match(file.sha256, /^[a-f0-9]{64}$/);
        assert(!file.path.endsWith('.map'), 'Distribution sourcemaps forbidden');
        declared.add(file.path);
    }
    assert.deepEqual(await inventory(directory), meta.files, 'Inventory differs from emitted files');
    assert(declared.has('index.html') && declared.has('.vite/manifest.json'));
    const vite = JSON.parse(await readFile(join(directory, meta.vite_manifest), 'utf8'));
    assert(vite['index.html']?.isEntry, 'Missing Vite entry');
    const visited = new Set();
    function visit(key) {
        if (visited.has(key)) return;
        visited.add(key);
        const entry = vite[key];
        assert(entry && typeof entry.file === 'string', `Unresolved Vite module: ${key}`);
        for (const file of [entry.file, ...entry.css ?? [], ...entry.assets ?? []]) {
            assert(safePath(file) && declared.has(file), `Unresolved Vite file: ${file}`);
        }
        for (const dependency of [...entry.imports ?? [], ...entry.dynamicImports ?? []]) visit(dependency);
    }
    // Validate all entries, including otherwise-unreachable stale metadata.
    Object.keys(vite).forEach(visit);
    for (const representative of ['GroupsPage', 'ApiKeysPage', 'LoginPage', 'FilesPage', 'UsersPage']) {
        assert(Object.keys(vite).some((key) => key.includes(representative)), `Missing lazy page: ${representative}`);
    }
    for (const file of meta.files) {
        if (!/\.(html|css|js)$/.test(file.path)) continue;
        const content = await readFile(join(directory, file.path), 'utf8');
        assert(!content.includes('sourceMappingURL='), 'Unresolved source map');
        assert(!content.includes('localhost:9009') && !content.includes('localhost:5199'), 'Development origin in artifact');
        assert(!/mock-[A-Za-z0-9_-]+\.js/.test(file.path), 'Packaged runtime must not emit mock transport');
        // Static HTML/CSS references and emitted ESM imports are checked beyond
        // Vite's graph so a forgotten font or stale chunk cannot pass inventory alone.
        const patterns = file.path.endsWith('.html') ? [/(?:src|href)=["']([^"']+)["']/g]
            : file.path.endsWith('.css') ? [/url\(\s*["']?([^\s)'";]+)["']?\s*\)/g]
                : [/(?:from\s*|import\s*\(?)["'](\.\.?\/[^"']+)["']/g];
        for (const pattern of patterns) for (const [, raw] of content.matchAll(pattern)) {
            if (/^(data:|#)/.test(raw)) continue;
            assert(!/^(?:[a-z]+:|\/)/i.test(raw), `Non-relative static dependency: ${raw}`);
            const target = posix.normalize(posix.join(posix.dirname(file.path), raw.split(/[?#]/)[0]));
            assert(safePath(target) && declared.has(target), `Unresolved static dependency: ${raw}`);
        }
    }
    return { manifest: meta, sha256: hash(bytes), directory };
}
