import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, lstat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory, verifyArtifact } from './admin-artifact.mjs';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const TOOLCHAIN = Object.freeze({ node: '24.21.0', npm: '11.19.0' });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function buildAdmin({ output = join(root, 'dist/admin'), canonical = false } = {}) {
    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith('VITE_') && value) throw new Error(`Packaged build rejects inherited ${key}`);
    }
    if (process.env.NODE_ENV && process.env.NODE_ENV !== 'production') throw new Error('Packaged build rejects conflicting NODE_ENV');
    const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
    if (process.versions.node !== TOOLCHAIN.node || npmVersion !== TOOLCHAIN.npm) {
        throw new Error(`Admin producer requires Node ${TOOLCHAIN.node} / npm ${TOOLCHAIN.npm}`);
    }
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const sourceDirty = git('status', '--porcelain', '--untracked-files=normal') !== '';
    if (canonical && sourceDirty) throw new Error('Canonical Admin artifact requires clean source');
    const revision = git('rev-parse', 'HEAD');
    const lockfile = await readFile(join(root, 'package-lock.json'));
    if (!sourceDirty && !lockfile.equals(execFileSync('git', ['show', 'HEAD:package-lock.json'], { cwd: root }))) {
        throw new Error('Lockfile differs from committed source');
    }
    const { version } = JSON.parse(await readFile(join(root, 'packages/portal-mojo/package.json'), 'utf8'));
    // Vite receives no dotenv or inherited environment definitions. These non-Vite
    // settings are fixed too because Tailwind/minifiers inspect NODE_ENV.
    output = resolve(output);
    if (output !== join(root, 'dist/admin') && !output.startsWith(join(root, 'dist') + '/')) {
        throw new Error('Admin output must remain under this repository dist directory');
    }
    let ancestor = resolve(root);
    for (const part of relative(root, dirname(output)).split('/')) {
        ancestor = join(ancestor, part);
        try {
            const info = await lstat(ancestor);
            if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe Admin output ancestry');
        } catch (error) { if (error.code === 'ENOENT') break; throw error; }
    }
    await mkdir(dirname(output), { recursive: true });
    const stage = await mkdtemp(join(dirname(output), '.admin-stage-'));
    let backup;
    try {
        const { build } = await import('vite');
        const inherited = process.env;
        process.env = Object.fromEntries(Object.entries({ PATH: inherited.PATH, HOME: inherited.HOME,
            TMPDIR: inherited.TMPDIR, SystemRoot: inherited.SystemRoot,
            NODE_ENV: 'production', TZ: 'UTC', LANG: 'C', LC_ALL: 'C' }).filter(([, value]) => value != null));
        try {
            await build({ root: join(root, 'apps/portal'), configFile: join(root, 'apps/portal/vite.config.ts'),
                mode: 'django-admin', logLevel: 'warn', build: { outDir: stage, manifest: true, sourcemap: false, emptyOutDir: true } });
        } finally { process.env = inherited; }
        if (!sourceDirty && (git('status', '--porcelain', '--untracked-files=normal') !== ''
            || git('rev-parse', 'HEAD') !== revision
            || !(await readFile(join(root, 'package-lock.json'))).equals(lockfile))) {
            throw new Error('Clean source changed during Admin build; retry from a stable checkout');
        }
        const manifest = {
            schema_version: 1, artifact: 'portal-mojo-admin', version,
            source_revision: revision, source_dirty: sourceDirty, toolchain: TOOLCHAIN,
            lockfile_sha256: sha256(lockfile), entrypoint: 'index.html', asset_base: './',
            api_mode: 'same-origin', source_session_contract: 1, vite_manifest: '.vite/manifest.json',
            files: await inventory(stage),
        };
        const { writeFile } = await import('node:fs/promises');
        await writeFile(join(stage, 'admin-artifact.json'), JSON.stringify(manifest, null, 2) + '\n');
        const result = await verifyArtifact(stage);
        try {
            if (!(await lstat(output)).isDirectory() || (await lstat(output)).isSymbolicLink()) throw new Error('Unsafe output destination');
            backup = `${stage}-previous`;
            await rename(output, backup);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        try { await rename(stage, output); } catch (error) { if (backup) await rename(backup, output); throw error; }
        if (backup) await rm(backup, { recursive: true });
        console.log(`Admin ${version} ${revision} ${sourceDirty ? 'DRAFT' : 'canonical'} ${result.sha256} ${output}`);
        return { ...result, directory: output };
    } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== '--canonical')) throw new Error('Usage: build-admin.mjs [--canonical]');
    await buildAdmin({ canonical: args.includes('--canonical') });
}
