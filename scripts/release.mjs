import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = 'packages/portal-mojo/package.json';
const releaseFiles = [manifestPath, 'package-lock.json'];

function run(command, args, options = {}) {
    return execFileSync(command, args, {
        cwd: root,
        encoding: 'utf8',
        stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })?.trim();
}

export function parseStableVersion(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match) throw new Error(`Expected a stable SemVer version, got ${version}`);
    return match.slice(1).map(Number);
}

export function nextVersion(version, releaseType) {
    const [major, minor, patch] = parseStableVersion(version);
    if (releaseType === 'major') return `${major + 1}.0.0`;
    if (releaseType === 'minor') return `${major}.${minor + 1}.0`;
    if (releaseType === 'patch') return `${major}.${minor}.${patch + 1}`;
    throw new Error(`Release type must be patch, minor, or major; got ${releaseType}`);
}

function packageVersion() {
    return JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8')).version;
}

function assertCleanMain() {
    const branch = run('git', ['branch', '--show-current']);
    if (branch !== 'main') throw new Error(`Releases must run from main, not ${branch || 'detached HEAD'}`);
    if (run('git', ['status', '--porcelain'])) throw new Error('Working tree must be clean before releasing');

    run('git', ['fetch', 'origin', 'main'], { inherit: true });
    const head = run('git', ['rev-parse', 'HEAD']);
    const remoteMain = run('git', ['rev-parse', 'origin/main']);
    if (head !== remoteMain) throw new Error('Local main must exactly match origin/main before releasing');
}

function assertOnlyVersionFilesChanged() {
    const changed = run('git', ['status', '--porcelain'])
        .split('\n')
        .filter(Boolean)
        .map((line) => line.slice(3));
    const unexpected = changed.filter((path) => !releaseFiles.includes(path));
    if (unexpected.length) throw new Error(`Release verification changed unexpected files: ${unexpected.join(', ')}`);
    for (const path of releaseFiles) {
        if (!changed.includes(path)) throw new Error(`Version bump did not update ${path}`);
    }
}

function assertTagAvailable(tag) {
    try {
        run('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`]);
        throw new Error(`Tag ${tag} already exists locally`);
    } catch (error) {
        if (error.status !== 1) throw error;
    }
    try {
        run('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`]);
        throw new Error(`Tag ${tag} already exists on origin`);
    } catch (error) {
        if (error.status !== 2) throw error;
    }
}

function main() {
    const releaseType = process.argv[2] ?? 'patch';
    const current = packageVersion();
    const next = nextVersion(current, releaseType);
    const tag = `v${next}`;
    let bumped = false;
    let committed = false;

    assertCleanMain();
    assertTagAvailable(tag);

    console.log(`Releasing portal-mojo ${current} → ${next}`);
    try {
        run('npm', ['version', releaseType, '--workspace', 'portal-mojo', '--no-git-tag-version'], { inherit: true });
        bumped = true;
        if (packageVersion() !== next) throw new Error(`npm version did not produce ${next}`);

        run('npm', ['run', 'verify:release'], { inherit: true });
        assertOnlyVersionFilesChanged();
        run('git', ['add', ...releaseFiles], { inherit: true });
        run('git', ['commit', '-m', `Release portal-mojo ${tag}`], { inherit: true });
        committed = true;
        run('git', ['tag', tag], { inherit: true });
        run('git', ['push', '--atomic', 'origin', 'main', tag], { inherit: true });
    } catch (error) {
        if (bumped && !committed) run('git', ['restore', '--staged', '--worktree', '--', ...releaseFiles], { inherit: true });
        if (committed) {
            console.error(`\nRelease commit remains local. Fix the problem, then retry: git push --atomic origin main ${tag}`);
        }
        throw error;
    }

    console.log(`\n${tag} pushed. GitHub Actions is verifying and publishing it to npm.`);
    console.log('https://github.com/NativeMojo/portal-mojo/actions/workflows/release.yml');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
