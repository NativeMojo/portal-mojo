import assert from 'node:assert/strict';
import { createServer } from 'vite';
globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/operational-fleet-mock.ts');
    const api = await server.ssrLoadModule('/packages/portal-mojo/src/admin/fleet/api.ts');
    const data = await server.ssrLoadModule('/packages/portal-mojo/src/admin/fleet/data.ts');
    const wire = mock.handleOperationalFleetMock('/api/aws/capacity', 'GET', undefined, undefined, { id: 1, is_superuser: true }, Date.now() / 1000).data;
    const database = wire.databases[0], reader = database.readers[0];
    database.reader_instance_classes[reader] = null;
    Object.assign(database.members.find(member => member.id === reader), { status: null, instance_class: null, lifecycle_state: 'error', can_resize: false, can_remove: false });
    database.blocked_reason = 'resource_transitioning';
    const report = api.parseCapacity(wire);
    assert.equal(report.databases[0].reader_instance_classes[reader], null);
    assert.equal(report.databases[0].members.find(member => member.id === reader).status, null);
    assert.equal(report.nodes.instances.length, wire.nodes.instances.length);
    assert.equal(report.caches.length, wire.caches.length);
    const draft = data.newFleetDraft(report); draft.addNodes = 1;
    assert.deepEqual(data.compileFleetSteps(report, draft), [{ action: 'add_node' }], 'Unknown database member evidence does not hide or block unrelated capacity changes');
    draft.databases[database.identifier].readers++;
    assert.throws(() => data.compileFleetSteps(report, draft), /resource_transitioning/, 'The affected database remains blocked');
    console.log('PASS partial fleet: nullable Aurora evidence survives; affected database blocked; unrelated nodes/cache remain available');
} finally { await server.close(); }
