// Independent intent/wire assertions for the standalone compiler; synthetic inventory only.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
    const { newCapacityDraft, compileCapacityDraft, completeAllowlist } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/fleet/standalone-data.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/operational-fleet-mock.ts');
    mock.setMockOperationalFleetScenario('healthy');
    const actor = { id: 9244, is_superuser: true, permissions: {} };
    const report = mock.handleOperationalFleetMock('/api/aws/capacity', 'GET', undefined, {}, actor).data;
    const copy = value => structuredClone(value);
    let checks = 0;
    const draft = newCapacityDraft(report);
    assert.deepEqual(compileCapacityDraft(report, draft), [], 'A new workspace draft stages nothing');
    draft.addNodes = 1;
    assert.throws(() => compileCapacityDraft(report, draft), /explicit healthy source/i, 'New nodes require a deliberately selected source');
    draft.source = 'i-mockb';
    assert.deepEqual(compileCapacityDraft(report, draft), [{ action: 'add_node', source_instance: 'i-mockb' }], 'Selected source reaches the wire exactly');
    draft.removeNodes = ['i-mockb'];
    assert.throws(() => compileCapacityDraft(report, draft), /selected source/i, 'A source cannot be removed in its own addition plan');
    checks++;

    const asymmetric = copy(report);
    asymmetric.databases[0].members.find(row => row.id === 'db-reader-a').can_resize = false;
    asymmetric.databases[0].members.find(row => row.id === 'db-reader-b').can_remove = false;
    const db = newCapacityDraft(asymmetric);
    db.databases['mock-database'].sizes['db-reader-b'] = 'medium';
    db.databases['mock-database'].removeReaders = ['db-reader-a'];
    assert.deepEqual(compileCapacityDraft(asymmetric, db), [
        { action: 'remove_reader', resource: 'db-reader-a' },
        { action: 'resize_database', resource: 'db-reader-b', size: 'medium', apply_immediately: true },
    ], 'Asymmetric independent member capabilities do not collapse to a database-wide choice');
    db.databases['mock-database'].sizes['db-reader-a'] = 'large';
    assert.throws(() => compileCapacityDraft(asymmetric, db), /resize or removal/i, 'A member cannot resize and be removed in the same draft');
    db.databases['mock-database'].removeReaders = [];
    assert.throws(() => compileCapacityDraft(asymmetric, db), /available member/i, 'Injected resize intent cannot bypass a disabled member capability');
    delete db.databases['mock-database'].sizes['db-reader-a'];
    db.databases['mock-database'].removeReaders = ['db-reader-b'];
    assert.throws(() => compileCapacityDraft(asymmetric, db), /removal is unavailable/i, 'Injected removal intent cannot bypass its separate member capability');
    checks++;

    const redis = newCapacityDraft(report);
    redis.caches['mock-redis'] = { replicas: 2, size: 'medium' };
    assert.throws(() => compileCapacityDraft(report, redis), /size or replica count/i, 'Same Redis group cannot combine size and replica changes even if inputs are injected');
    const twoGroups = copy(report);
    twoGroups.caches.push({ ...copy(twoGroups.caches[0]), identifier: 'mock-redis-secondary' });
    const independent = newCapacityDraft(twoGroups);
    independent.caches['mock-redis'].replicas = 2;
    independent.caches['mock-redis-secondary'].size = 'medium';
    assert.deepEqual(compileCapacityDraft(twoGroups, independent), [
        { action: 'set_cache_replicas', resource: 'mock-redis', count: 2, apply_immediately: true },
        { action: 'resize_cache', resource: 'mock-redis-secondary', size: 'medium', apply_immediately: true },
    ], 'Redis conflict scope is the exact group, so independent groups remain usable');
    checks++;

    const scarce = copy(report);
    scarce.nodes.instances.forEach(node => { node.healthy = node.id === 'i-mockb'; });
    const removal = newCapacityDraft(scarce);
    removal.removeNodes = ['i-mockb'];
    removal.addNodes = 2;
    removal.source = 'i-mockb';
    assert.throws(() => compileCapacityDraft(scarce, removal), /selected source/i, 'Optimistic additions cannot permit removal of their own source');
    removal.addNodes = 0;
    assert.throws(() => compileCapacityDraft(scarce, removal), /Keep at least one currently healthy target/i, 'At least one already healthy target must survive');
    removal.removeNodes = ['i-mocka'];
    assert.throws(() => compileCapacityDraft(scarce, removal), /answering your request/i, 'The serving node remains protected');
    const missingIdentity = copy(report);
    missingIdentity.nodes.self_check = 'unmatched';
    removal.removeNodes = ['i-mockc'];
    assert.throws(() => compileCapacityDraft(missingIdentity, removal), /identify itself/i, 'An unresolved serving identity blocks removal');
    checks++;

    const unsafe = newCapacityDraft(report);
    unsafe.addNodes = 19; unsafe.source = 'i-mockb'; unsafe.removeNodes = ['i-mockc'];
    assert.throws(() => compileCapacityDraft(report, unsafe), /20 steps/i, 'Drain and terminate count independently toward the global step limit');
    unsafe.addNodes = 0; unsafe.removeNodes = ['i-mockc', 'i-mockc'];
    assert.throws(() => compileCapacityDraft(report, unsafe), /duplicate/i, 'A duplicate resource does not become multiple destructive steps');
    checks++;

    assert(completeAllowlist(report), 'Complete enabled outbound evidence is eligible for copying');
    for (const key of ['available', 'fleet_available', 'addresses_available', 'policy_available', 'enabled']) {
        const incomplete = copy(report); incomplete.egress[key] = false;
        assert.equal(completeAllowlist(incomplete), false, `Missing ${key} prevents an allowlist claim`);
    }
    const pending = copy(report); pending.egress.pending_nodes = ['i-pending-synthetic'];
    assert.equal(completeAllowlist(pending), false, 'Pending nodes prevent copying an incomplete allowlist');
    checks++;
    console.log(`PASS standalone Fleet intent contracts: ${checks} groups (explicit source, exact members, Redis group scope, serving/healthy guards, step budget, complete allowlist)`);
} finally {
    await server.close();
}
