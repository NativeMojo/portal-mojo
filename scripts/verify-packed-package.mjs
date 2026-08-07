import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(join(tmpdir(), 'portal-mojo-package-'));
const packDir = join(tempRoot, 'pack');
const consumerDir = join(tempRoot, 'consumer');

function run(command, args, cwd) {
    return execFileSync(command, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

try {
    await mkdir(packDir);
    const packed = JSON.parse(run('npm', [
        'pack', '--json', '--workspace', 'portal-mojo',
        '--pack-destination', packDir,
    ], root));
    assert.equal(packed.length, 1, 'npm pack must produce exactly one package');

    const artifact = packed[0];
    assert.equal(artifact.name, 'portal-mojo', 'packed package name must be portal-mojo');
    assert.match(artifact.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'package version must be SemVer');
    assert.ok(artifact.unpackedSize <= 5_000_000, `unpacked package exceeds 5 MB budget (${artifact.unpackedSize})`);

    const files = new Set(artifact.files.map((entry) => entry.path));
    for (const required of [
        'package.json', 'README.md', 'LICENSE',
        'src/client/index.ts', 'src/ui/index.ts',
        'src/charts/index.ts', 'src/admin/index.ts',
    ]) {
        assert.ok(files.has(required), `packed package must include ${required}`);
    }
    for (const path of files) {
        assert.doesNotMatch(path, /(^|\/)(?:apps|planning|scripts|test|tests|\.github)(\/|$)/, `unexpected repository file in package: ${path}`);
        assert.doesNotMatch(path, /(?:^|\/)(?:\.env(?:\.|$)|.*\.(?:key|pem|p12))/, `sensitive-looking file in package: ${path}`);
    }

    const tarball = join(packDir, artifact.filename);
    await mkdir(join(consumerDir, 'src'), { recursive: true });
    await writeFile(join(consumerDir, 'package.json'), JSON.stringify({
        name: 'portal-mojo-packed-consumer',
        private: true,
        type: 'module',
        scripts: {
            typecheck: 'tsc --noEmit',
            build: 'vite build',
        },
        dependencies: {
            '@tanstack/react-query': '^5.62.0',
            'portal-mojo': `file:${tarball}`,
            react: '^19.2.0',
            'react-dom': '^19.2.0',
            'react-router-dom': '^7.6.1',
        },
        devDependencies: {
            '@types/react': '^19.2.7',
            '@types/react-dom': '^19.2.3',
            typescript: '~5.9.3',
            vite: '^7.1.0',
        },
    }, null, 2));
    await writeFile(join(consumerDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2022',
            lib: ['ES2022', 'DOM', 'DOM.Iterable'],
            module: 'ESNext',
            moduleResolution: 'bundler',
            jsx: 'react-jsx',
            strict: true,
            skipLibCheck: true,
            types: ['vite/client'],
        },
        include: ['src'],
    }, null, 2));
    await writeFile(join(consumerDir, 'index.html'), '<div id="app"></div><script type="module" src="/src/main.ts"></script>\n');
    await writeFile(join(consumerDir, 'src/main.ts'), [
        "import { initAuth } from 'portal-mojo/client';",
        "import { Badge } from 'portal-mojo/ui';",
        "import { SeriesChart } from 'portal-mojo/charts';",
        "import { ADMIN_SECTIONS } from 'portal-mojo/admin';",
        "document.querySelector('#app')!.textContent = String([initAuth, Badge, SeriesChart, ADMIN_SECTIONS].length);",
        '',
    ].join('\n'));

    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumerDir);
    run('npm', ['run', 'typecheck'], consumerDir);
    run('npm', ['run', 'build'], consumerDir);

    const installed = JSON.parse(await readFile(join(consumerDir, 'node_modules/portal-mojo/package.json'), 'utf8'));
    assert.equal(installed.private, undefined, 'installed package must not be private');
    assert.equal(installed.license, 'Apache-2.0', 'installed package must declare Apache-2.0');
    assert.deepEqual(Object.keys(installed.exports).sort(), ['./admin', './charts', './client', './ui']);
    console.log(`portal-mojo@${artifact.version} tarball verified in a clean consumer (${artifact.files.length} files)`);
} finally {
    await rm(tempRoot, { recursive: true, force: true });
}
