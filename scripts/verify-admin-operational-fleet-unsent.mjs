import assert from 'node:assert/strict';
import { createServer } from 'vite';
globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', define: { 'import.meta.env.VITE_MOJO_API': JSON.stringify('http://fleet-unsent.invalid') }, server: { middlewareMode: true } });
const coordinators = [];
try {
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/operational-fleet-mock.ts');
    const ops = await server.ssrLoadModule('/packages/portal-mojo/src/admin/fleet/operations.ts');
    const plan = mock.handleOperationalFleetMock('/api/aws/capacity/plan', 'POST', { steps: [{ action: 'add_node' }] }, undefined, { id: 1, is_superuser: true }, Date.now() / 1000).data;
    let tick = Date.now(), release, posts = 0;
    globalThis.fetch = async () => { posts++; throw new TypeError('Connection lost after request dispatch'); };
    client.installAuthHooks({ preRequest: async () => new Promise(resolve => { release = resolve; }), authHeader: () => null });
    const coordinator = ops.createFleetOperationCoordinator({ scope: () => '1:original', now: () => tick }); coordinators.push(coordinator);
    const pending = coordinator.submit('1:original', { ...plan, expires_at: new Date(tick + 1000).toISOString() });
    for (let i = 0; i < 20 && !release; i++) await new Promise(resolve => setTimeout(resolve, 0));
    assert(release); tick += 2000; release();
    await assert.rejects(pending, /expired/i, 'Expiry during asynchronous auth gate is a provably unsent refusal');
    assert.equal(posts, 0); assert.equal(coordinator.get('1:original').status, 'idle'); assert.equal(coordinator.blocked('1:original'), false);
    assert.match(coordinator.get('1:original').message, /refresh|review/i);
    client.installAuthHooks({ preRequest: async () => {}, authHeader: () => null });
    await coordinator.submit('1:original', { ...plan, expires_at: new Date(tick + 10000).toISOString() });
    assert.equal(posts, 1); assert.equal(coordinator.get('1:original').status, 'unknown', 'A true post-dispatch transport failure retains the durable uncertainty guard');
    console.log('PASS Fleet dispatch boundary: delayed-auth expiry sends zero POSTs and releases guard; dispatched loss stays unknown');
} finally { coordinators.forEach(c => c.dispose()); await server.close(); }
