import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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

async function typeScriptFiles(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await typeScriptFiles(path));
        else if (/\.tsx?$/.test(entry.name)) files.push(path);
    }
    return files;
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
        'src/admin/core/index.ts', 'src/admin/public/identity.ts',
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
        "import { adminSectionRoutes, type AdminRoute } from 'portal-mojo/admin/core';",
        "import { USERS_ADMIN_SECTION } from 'portal-mojo/admin/identity';",
        "import { SECURITY_OPERATIONS_ADMIN_SECTION } from 'portal-mojo/admin/security';",
        "import { MONITORING_ADMIN_SECTION } from 'portal-mojo/admin/observability';",
        "import { JOBS_ADMIN_SECTION } from 'portal-mojo/admin/operations';",
        "import { DNS_ADMIN_SECTION } from 'portal-mojo/admin/infrastructure';",
        "import { EMAIL_ADMIN_SECTION } from 'portal-mojo/admin/communications';",
        "import { ASSISTANT_ADMIN_SECTION } from 'portal-mojo/admin/assistant';",
        "const routes: AdminRoute[] = USERS_ADMIN_SECTION.routes;",
        "document.querySelector('#app')!.textContent = String([initAuth, Badge, SeriesChart, ADMIN_SECTIONS, adminSectionRoutes, routes, SECURITY_OPERATIONS_ADMIN_SECTION, MONITORING_ADMIN_SECTION, JOBS_ADMIN_SECTION, DNS_ADMIN_SECTION, EMAIL_ADMIN_SECTION, ASSISTANT_ADMIN_SECTION].length);",
        '',
    ].join('\n'));

    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumerDir);
    run('npm', ['run', 'typecheck'], consumerDir);
    run('npm', ['run', 'build'], consumerDir);

    const installed = JSON.parse(await readFile(join(consumerDir, 'node_modules/portal-mojo/package.json'), 'utf8'));
    assert.equal(installed.private, undefined, 'installed package must not be private');
    assert.equal(installed.license, 'Apache-2.0', 'installed package must declare Apache-2.0');
    assert.deepEqual(Object.keys(installed.exports).sort(), ['./admin', './admin/assistant', './admin/communications', './admin/core', './admin/identity', './admin/infrastructure', './admin/observability', './admin/operations', './admin/security', './charts', './client', './ui']);
    const installedRoot = join(consumerDir, 'node_modules/portal-mojo');
    const program = ts.createProgram(await typeScriptFiles(join(installedRoot, 'src')), {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
        skipLibCheck: true,
    });
    const checker = program.getTypeChecker();
    const adminSource = program.getSourceFile(join(installedRoot, 'src/admin/index.ts'));
    const adminSymbol = adminSource && checker.getSymbolAtLocation(adminSource);
    assert(adminSymbol, 'packed admin source must expose a TypeScript module symbol');
    const packedExports = checker.getExportsOfModule(adminSymbol).map((symbol) => symbol.name).sort();
    const exportContract = JSON.parse(await readFile(resolve(root, 'scripts/admin-export-contract.json'), 'utf8'));
    assert.deepEqual(packedExports, exportContract, 'packed admin TypeScript export map must match source exactly');
    console.log(`portal-mojo@${artifact.version} tarball verified in a clean consumer (${artifact.files.length} files)`);
} finally {
    await rm(tempRoot, { recursive: true, force: true });
}
