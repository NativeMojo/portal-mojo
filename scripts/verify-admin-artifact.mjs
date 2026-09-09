import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory, verifyArtifact } from './admin-artifact.mjs';

// Preserve the original programmatic verifier surface.
export { hash, safePath, inventory, verifyArtifact } from './admin-artifact.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));

async function verifyProducer() {
    const { buildAdmin } = await import('./build-admin.mjs');
    await mkdir(join(root, 'dist'), { recursive: true });
    const workspace = await mkdtemp(join(root, 'dist/.admin-verify-'));
    try {
        const first = await buildAdmin({ output: join(workspace, 'first') });
        const second = await buildAdmin({ output: join(workspace, 'second') });
        assert.equal(first.sha256, second.sha256, 'Fresh builds differ');
        assert.deepEqual(first.manifest.files, second.manifest.files);
        // The schema fixture itself must agree with the executable validator.
        const schema = JSON.parse(await readFile(join(root, 'scripts/admin-artifact-schema.json')));
        assert.deepEqual(Object.keys(first.manifest).sort(), schema.required.sort());
        for (const [key, definition] of Object.entries(schema.properties)) {
            if ('const' in definition) assert.equal(first.manifest[key], definition.const);
        }
        const fixture = join(workspace, 'negative');
        async function rejects(label, corrupt) {
            await rm(fixture, { force: true, recursive: true });
            await cp(first.directory, fixture, { recursive: true });
            const meta = JSON.parse(await readFile(join(fixture, 'admin-artifact.json')));
            await corrupt(meta);
            await writeFile(join(fixture, 'admin-artifact.json'), JSON.stringify(meta));
            await assert.rejects(verifyArtifact(fixture), label);
        }
        await rejects('extra', async () => writeFile(join(fixture, 'stale.js'), 'stale'));
        await rejects('missing', async () => rm(join(fixture, 'index.html')));
        await rejects('altered', async () => writeFile(join(fixture, 'index.html'), 'corrupt'));
        await rejects('duplicate', async (meta) => meta.files.push(meta.files[0]));
        await rejects('unsorted', async (meta) => meta.files.reverse());
        for (const path of ['/absolute', '../escape', 'assets/../escape', 'assets\\escape', 'assets//escape', './escape']) {
            await rejects(path, async (meta) => { meta.files[0].path = path; });
        }
        await rejects('symlink', async () => { await rm(join(fixture, 'index.html')); await symlink(join(first.directory, 'index.html'), join(fixture, 'index.html')); });
        await rejects('unresolved dependency even after rehash', async (meta) => {
            const path = '.vite/manifest.json';
            const vite = JSON.parse(await readFile(join(fixture, path)));
            vite['index.html'].dynamicImports.push('missing-module');
            await writeFile(join(fixture, path), JSON.stringify(vite));
            meta.files = await inventory(fixture);
        });
        for (const env of [{ VITE_MOJO_API: 'https://contamination.invalid' }, { VITE_MOJO_AUTH: 'inapp' }, { VITE_OTHER: 'bad' }, { NODE_ENV: 'development' }]) {
            assert.throws(() => execFileSync(process.execPath, [join(root, 'scripts/build-admin.mjs')], { cwd: root, env: { ...process.env, ...env }, stdio: 'pipe' }), 'Environment contamination must reject');
        }
        console.log(`verify:admin-artifact OK — two fresh byte-identical builds (${first.manifest.source_dirty ? 'draft inputs; clean canonical proof still required' : 'canonical'}), inventory/dependency corruption and environment fixtures; manifest ${first.sha256}`);
    } finally { await rm(workspace, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv[2] === '--check') {
        const result = await verifyArtifact(resolve(process.argv[3] ?? join(root, 'dist/admin')), { requireClean: true, expectedHash: process.argv[4] });
        console.log(`Verified ${result.sha256}`);
    } else await verifyProducer();
}
