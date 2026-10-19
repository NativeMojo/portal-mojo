import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
    const { ASSISTANT_ADMIN_SECTION } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/domains/assistant.ts');
    const route = ASSISTANT_ADMIN_SECTION.routes.find((entry) => entry.path === 'setup');
    assert(route, 'Assistant must expose a dedicated Setup route');
    assert.equal(route.requireSuperuser, true, 'Setup is literal-owner-only before lazy loading');
    assert.equal(typeof route.loadComponent, 'function');
    console.log('Assistant Setup missing-route regression passed');
} finally { await server.close(); }
