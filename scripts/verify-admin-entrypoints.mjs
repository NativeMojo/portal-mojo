import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const mode of ['core', 'legacy', 'email-first']) {
    execFileSync(process.execPath, [resolve(root, 'scripts/verify-admin-side-effects.mjs'), mode], { cwd: root, stdio: 'inherit' });
}
const manifest = JSON.parse(await readFile(resolve(root, 'packages/portal-mojo/package.json'), 'utf8'));
const expectedEntrypoints = ['./admin', './admin/assistant', './admin/communications', './admin/core', './admin/identity', './admin/infrastructure', './admin/observability', './admin/operations', './admin/security', './charts', './client', './ui'];
assert.deepEqual(Object.keys(manifest.exports).sort(), expectedEntrypoints);
const [coreSource, showcaseSource] = await Promise.all([
    readFile(resolve(root, 'packages/portal-mojo/src/admin/core/index.ts'), 'utf8'),
    readFile(resolve(root, 'apps/showcase/src/pages/components/ComponentsPage.tsx'), 'utf8'),
]);
assert.match(coreSource, /class LazyPageBoundary/);
assert.match(coreSource, /['"]Retry['"]/);
assert.match(coreSource, /setAttempt\(\(value\) => value \+ 1\)/);
assert.match(showcaseSource, /class DemoLoadBoundary/);
assert.doesNotMatch(showcaseSource, /^import .* from ['"]\.\/demos-/m, 'Showcase demos must have no eager imports');
for (const match of showcaseSource.matchAll(/render:\s*\(\)\s*=>\s*<([A-Za-z0-9]+Demo)\s*\/>/g)) {
    assert.match(showcaseSource, new RegExp(`const ${match[1]} = lazyDemo\\(`), `${match[1]} must use the typed lazy descriptor`);
}

const configPath = resolve(root, 'packages/portal-mojo/tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const adminSource = program.getSourceFile(resolve(root, 'packages/portal-mojo/src/admin/index.ts'));
assert(adminSource, 'admin source entry must be in the package TypeScript program');
const adminSymbol = checker.getSymbolAtLocation(adminSource);
assert(adminSymbol, 'admin source entry must have a module symbol');
const sourceExports = checker.getExportsOfModule(adminSymbol).map((symbol) => symbol.name).sort();
const exportContract = JSON.parse(await readFile(resolve(root, 'scripts/admin-export-contract.json'), 'utf8'));
assert.deepEqual(sourceExports, exportContract, 'portal-mojo/admin TypeScript export map changed');

const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
    const core = await server.ssrLoadModule('/packages/portal-mojo/src/admin/core/index.ts');
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    assert.deepEqual(admin.ADMIN_SECTIONS.map((section) => section.id), ['dashboard', 'users', 'members', 'credentials', 'monitoring', 'cloudwatch', 'settings', 'security-operations', 'bouncer', 'device-intel', 'geoip', 'jobs', 'network-security', 'dns', 'storage', 'shortlinks', 'email', 'public-messages', 'push', 'phonehub', 'assistant']);
    assert(admin.ADMIN_SECTIONS.flatMap((section) => section.routes).every((route) => 'loadComponent' in route && !('component' in route)), 'all built-in routes must use the explicit lazy arm');

    const domainPaths = ['identity', 'security', 'observability', 'operations', 'infrastructure', 'communications', 'assistant'];
    for (const domain of domainPaths) {
        const entry = await server.ssrLoadModule(`/packages/portal-mojo/src/admin/public/${domain}.ts`);
        for (const section of admin.ADMIN_SECTIONS) {
            const named = Object.entries(entry).find(([name]) => name.endsWith('_ADMIN_SECTION') && entry[name]?.id === section.id);
            if (named) assert.equal(named[1], section, `${domain} section object identity must match legacy aggregate`);
        }
    }

    const SyncPage = () => null;
    let allowedLoads = 0;
    const external = { id: 'external', title: 'External', icon: 'bi-box', permissions: ['sys.external'], routes: [{ path: '', component: SyncPage }] };
    const lazySection = { id: 'lazy', title: 'Lazy', icon: 'bi-box', permissions: ['sys.lazy'], routes: [{ path: '', loadComponent: async () => { allowedLoads += 1; return { default: SyncPage }; } }] };
    assert.equal(core.adminSectionRoutes([external, lazySection]).length, 2);
    assert.equal(allowedLoads, 0, 'route construction must not invoke a lazy loader');
    const renderRoute = (permissions) => {
        const client = new QueryClient();
        client.setQueryData(['me', null], { id: 1, permissions });
        const route = core.adminSectionRoutes([lazySection])[0];
        renderToString(createElement(QueryClientProvider, { client }, route.element));
    };
    renderRoute({});
    assert.equal(allowedLoads, 0, 'a denied route must not invoke its loader');
    renderRoute({ lazy: true });
    assert.equal(allowedLoads, 1, 'an allowed route must invoke its loader inside the guards');
    assert.equal('component' in lazySection.routes[0], false, 'lazy routes never infer from callability');
    console.log('admin entrypoints, source exports, side effects, registry identity and lazy contract verified');
} finally { await server.close(); }
