import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { verifyStyleContract } from './style-contract.mjs';

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
    // 5.5 MB since #5921: the component stylesheets ship in the package.
    assert.ok(artifact.unpackedSize <= 5_500_000, `unpacked package exceeds 5.5 MB budget (${artifact.unpackedSize})`);

    const files = new Set(artifact.files.map((entry) => entry.path));
    // Every stylesheet the source entry imports must be in the tarball (#5921).
    const stylesIndex = await readFile(resolve(root, 'packages/portal-mojo/src/styles/index.css'), 'utf8');
    const styleFiles = [...stylesIndex.matchAll(/@import "\.\/([\w/-]+\.css)"/g)].map((match) => `src/styles/${match[1]}`);
    assert.ok(styleFiles.length > 1 && styleFiles.includes('src/styles/core.css'), 'styles entry must import core.css and the component files');
    for (const required of [
        'package.json', 'README.md', 'LICENSE',
        'src/client/index.ts', 'src/client/runtime.ts',
        'src/ui/index.ts', 'src/ui/shell.ts',
        'src/charts/index.ts', 'src/admin/index.ts',
        'src/admin/core/index.ts', 'src/admin/registry.ts',
        'src/admin/public/identity.ts', 'src/admin/public/assistant-launcher.ts',
        'src/styles/index.css', 'src/styles/required-tokens.json', ...styleFiles,
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
            '@tailwindcss/vite': '^4.1.8',
            tailwindcss: '^4.1.8',
            typescript: '~5.9.3',
            vite: '^7.1.0',
        },
    }, null, 2));
    await writeFile(join(consumerDir, 'vite.config.js'), [
        "import { defineConfig } from 'vite';",
        "import tailwindcss from '@tailwindcss/vite';",
        'export default defineConfig({ plugins: [tailwindcss()] });',
        '',
    ].join('\n'));
    // The documented CSS entry: Tailwind, then the package, with no layer()
    // and no @source of the consumer's own.
    await writeFile(join(consumerDir, 'src/app.css'), '@import "tailwindcss";\n@import "portal-mojo/styles.css";\n');
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
        "import './app.css';",
        "import { initAuth } from 'portal-mojo/client';",
        "import { usingMockTransport } from 'portal-mojo/client/runtime';",
        "import { Badge } from 'portal-mojo/ui';",
        "import { openAccountModal } from 'portal-mojo/account';",
        "import { ThemeProvider } from 'portal-mojo/ui/shell';",
        "import { SeriesChart } from 'portal-mojo/charts';",
        "import { ADMIN_SECTIONS } from 'portal-mojo/admin';",
        "import { ADMIN_SECTIONS as REGISTRY_ADMIN_SECTIONS } from 'portal-mojo/admin/registry';",
        "import { adminSectionRoutes, type AdminRoute } from 'portal-mojo/admin/core';",
        "import { USERS_ADMIN_SECTION } from 'portal-mojo/admin/identity';",
        "import { SECURITY_OPERATIONS_ADMIN_SECTION } from 'portal-mojo/admin/security';",
        "import { MONITORING_ADMIN_SECTION } from 'portal-mojo/admin/observability';",
        "import { JOBS_ADMIN_SECTION } from 'portal-mojo/admin/operations';",
        "import { DNS_ADMIN_SECTION } from 'portal-mojo/admin/infrastructure';",
        "import { EMAIL_ADMIN_SECTION } from 'portal-mojo/admin/communications';",
        "import { ASSISTANT_ADMIN_SECTION } from 'portal-mojo/admin/assistant';",
        "import { AssistantLauncher } from 'portal-mojo/admin/assistant/launcher';",
        "const routes: AdminRoute[] = USERS_ADMIN_SECTION.routes;",
        "document.querySelector('#app')!.textContent = String([initAuth, usingMockTransport, Badge, ThemeProvider, SeriesChart, ADMIN_SECTIONS, REGISTRY_ADMIN_SECTIONS, adminSectionRoutes, routes, SECURITY_OPERATIONS_ADMIN_SECTION, MONITORING_ADMIN_SECTION, JOBS_ADMIN_SECTION, DNS_ADMIN_SECTION, EMAIL_ADMIN_SECTION, ASSISTANT_ADMIN_SECTION, AssistantLauncher, openAccountModal].length);",
        '',
    ].join('\n'));

    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumerDir);
    run('npm', ['run', 'typecheck'], consumerDir);
    run('npm', ['run', 'build'], consumerDir);

    const installed = JSON.parse(await readFile(join(consumerDir, 'node_modules/portal-mojo/package.json'), 'utf8'));
    assert.equal(installed.private, undefined, 'installed package must not be private');
    assert.equal(installed.license, 'Apache-2.0', 'installed package must declare Apache-2.0');
    assert.deepEqual(Object.keys(installed.exports).sort(), ['./account', './admin', './admin/assistant', './admin/assistant/launcher', './admin/communications', './admin/core', './admin/identity', './admin/infrastructure', './admin/observability', './admin/operations', './admin/registry', './admin/security', './charts', './client', './client/runtime', './personas', './styles.css', './ui', './ui/shell']);
    // The installed stylesheets meet the same contract as the source: every
    // file imported in layer(portal-mojo), no orphan, and the token list exact.
    assert.equal(installed.exports['./styles.css'], './src/styles/index.css', 'installed portal-mojo/styles.css must resolve to src/styles/index.css');
    const installedStyles = join(consumerDir, 'node_modules/portal-mojo/src/styles');
    const { imported: installedImports } = await verifyStyleContract(installedStyles);
    const packedStyles = [...files].filter((path) => path.startsWith('src/styles/') && path.endsWith('.css')).sort();
    assert.deepEqual(packedStyles, ['src/styles/index.css', ...installedImports.map((file) => `src/styles/${file}`)].sort(), 'the tarball must hold exactly the stylesheets index.css imports');

    // The CSS subpath, the layer and the package's own @source all work from
    // node_modules. The consumer's source holds no class name, so a Tailwind
    // utility in its CSS can only come from the package scanning itself:
    // `xl:grid-cols-4` is used by the Users overview and by no package style.
    const assets = join(consumerDir, 'dist/assets');
    const cssAssets = (await readdir(assets)).filter((name) => name.endsWith('.css'));
    assert.equal(cssAssets.length, 1, 'consumer build must emit exactly one CSS asset');
    const css = await readFile(join(assets, cssAssets[0]), 'utf8');
    // Layers take their order from first appearance; the minifier may fold
    // the order statement into the blocks, so read the order, not the text.
    const layerOrder = [];
    for (const match of css.matchAll(/@layer\s+([\w-]+(?:\s*,\s*[\w-]+)*)\s*[;{]/g)) {
        for (const name of match[1].split(',').map((part) => part.trim())) if (!layerOrder.includes(name)) layerOrder.push(name);
    }
    assert.equal(layerOrder.at(-1), 'portal-mojo', `consumer CSS must order the portal-mojo layer last, after utilities (got ${layerOrder.join(', ')})`);
    assert.ok(layerOrder.includes('utilities'), 'consumer CSS must hold the Tailwind utilities layer');
    assert.ok(/@layer portal-mojo\s*\{/.test(css), 'consumer CSS must hold the portal-mojo layer');
    for (const selector of ['.guardrail-effect', '.signin-card', '.side-nav']) assert.ok(css.includes(selector), `consumer CSS must hold the package rule ${selector}`);
    assert.ok(css.includes('.xl\\:grid-cols-4'), 'consumer CSS must hold a utility used only in package markup: the package @source must scan from node_modules');
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
