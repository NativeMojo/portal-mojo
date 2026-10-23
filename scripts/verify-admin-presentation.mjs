import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

// Test the styles each app actually serves, rather than finding CSS files on disk.
const selectors = ['.geo-admin', '.operational-fleet', '.fleet-scale', '.fleet-page', '.fleet-standalone-dialog', '.admin-maintenance', '.maintenance-resource', '.admin-deployments', '.domains-header', '.edge-serving-evidence', '.assistant-setup-overview', '.assistant-setup-dialog', '.assistant-setup-help-content'];
for (const app of ['showcase', 'portal']) {
    const root = resolve(`apps/${app}`);
    const theme = await readFile(resolve(root, 'src/theme.css'), 'utf8');
    assert(theme.includes('@import "portal-mojo/styles.css"'), `${app} must consume the same canonical package stylesheet`);
    assert(!/@import\s+["']\.\/theme\/(?!demos-)/.test(theme), `${app} must not override package components with stale copies`);
    const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), logLevel: 'silent', server: { middlewareMode: true } });
    try {
        const result = await server.transformRequest('/src/theme.css');
        assert(result, `${app} stylesheet compiles`);
        for (const selector of selectors) assert(result.code.includes(selector), `${app} served CSS is missing ${selector}`);
        if (app === 'portal') assert(result.code.includes('.admin-sidebar-dismiss'), 'Portal mobile navigation must overlay rather than squeeze the page');
        console.log(`PASS ${app}: canonical stylesheet, ${selectors.length} operations layout selectors compiled`);
    } finally { await server.close(); }
}
