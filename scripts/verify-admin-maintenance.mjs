import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { maintenanceTestBridge } from './verify-admin-maintenance-harness.mjs';
const dom = new JSDOM('', { url: 'http://localhost/' });
for (const n of ['window', 'document', 'localStorage', 'sessionStorage', 'CustomEvent'])
    globalThis[n] = dom.window[n];
const server = await createServer({
    root: process.cwd(),
    appType: 'custom',
    logLevel: 'silent',
    plugins: [maintenanceTestBridge()],
    server: { middlewareMode: true },
});
let checks = 0;
try {
    const data = await server.ssrLoadModule('/packages/portal-mojo/src/admin/maintenance/data.ts');
    const ops = await server.ssrLoadModule('/packages/portal-mojo/src/admin/maintenance/operations.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/maintenance-mock.ts');
    const auth = await server.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
    const user = { id: 1, is_superuser: true },
        ctx = { user, fresh: true },
        base = '/api/aws/maintenance/';
    for (const permissions of [
        { comms: true },
        { admin: true },
        { manage_platform: true },
        { view_platform: true },
        { manage_aws: true },
    ]) {
        const a = data.maintenanceAccess({ permissions });
        assert.equal(a.aws, permissions.manage_aws === true, 'exact AWS gate excludes comms/admin wildcard');
        assert.equal(
            a.framework,
            !!(permissions.admin || permissions.manage_platform || permissions.view_platform),
        );
        checks += 2;
    }
    const response = (path, method = 'GET', body, params = {}, context = ctx) =>
        mock.maintenanceMock(path, method, body, params, context);
    assert.equal(response('/api/edge/webapp'), undefined, 'sibling paths unclaimed');
    assert.equal(response(base + 'future'), undefined, 'unowned AWS path unclaimed');
    checks += 2;
    let report = data.parseReport(mock.maintenanceMockReport());
    assert.equal(report.findings.length, 4);
    checks++;
    for (const bad of [
        (r) => (r.schema_version = 2),
        (r) => (r.status = 'future'),
        (r) => (r.scheduled = 'false'),
        (r) => (r.findings[0].kind = 'future'),
        (r) => (r.findings[0].settled = 1),
        (r) => r.findings.push(r.findings[0]),
    ]) {
        const r = structuredClone(report);
        bad(r);
        assert.throws(() => data.parseReport(r));
        checks++;
    }
    assert.equal(data.releaseNotesURL('javascript:alert(1)'), null);
    assert.equal(data.releaseNotesURL('https://user:secret@example.com/'), null);
    checks += 2;
    assert.throws(() =>
        data.parseInfrastructure({
            infrastructure: { mode: 'managed' },
            features: { platform: { capabilities: { infrastructure_managed: false } } },
        }),
    );
    checks++;
    const f = report.findings[0],
        input = {
            kind: f.kind,
            resource: f.resource_id,
            target_version: f.available_major,
            confirm_resource: f.resource_id,
            apply_immediately: false,
        };
    for (const permissions of [
        { manage_aws: true },
        { manage_platform: true },
        { admin: true },
        { comms: true, manage_platform: true },
    ]) {
        assert.equal(
            response(base + 'apply', 'POST', input, {}, { user: { permissions }, fresh: true }).status,
            false,
        );
        checks++;
    }
    assert.equal(
        response(
            base + 'apply',
            'POST',
            input,
            {},
            { user: { permissions: { manage_aws: true, manage_platform: true } }, fresh: true },
        ).status,
        true,
        'AND grant works',
    );
    checks++;
    for (const bad of [
        { ...input, apply_immediately: 'false' },
        { ...input, apply_immediately: undefined },
        { ...input, confirm_resource: 'ORDERS-DB' },
        { ...input, target_version: '99' },
    ]) {
        mock.setMockMaintenanceScenario('findings');
        assert.equal(response(base + 'apply', 'POST', bad).status, false);
        checks++;
    }
    for (const context of [
        { user, fresh: false },
        { user, fresh: true, keyBacked: true },
        { user: { ...user, is_active: false }, fresh: true },
    ]) {
        assert.equal(response(base + 'apply', 'POST', input, {}, context).status, false);
        checks++;
    }
    auth.initAuth();
    globalThis.__maintenanceFixture = { persona: { is_superuser: true } };
    await auth.login('showcase.operator@nativemojo.com', 'mojo');
    auth.stopAutoRefresh();
    const scope = () => data.maintenanceFence();
    mock.setMockMaintenanceScenario('next-window');
    globalThis.__maintenanceFixture.posts = 0;
    const next = await ops.requestMaintenance(input, scope());
    assert.equal(globalThis.__maintenanceFixture.lastImmediate, false, 'false remains a boolean');
    assert.equal(globalThis.__maintenanceFixture.posts, 1);
    checks += 2;
    await ops.observeMaintenance(next, scope());
    assert.equal(next.state, 'waiting', 'settled old next-window remains waiting');
    assert.equal(ops.maintenanceCompleted(next.observation), false);
    checks += 2;
    ops.maintenanceObservationLimit(next);
    await assert.rejects(() => ops.requestMaintenance(input, scope()));
    assert.equal(globalThis.__maintenanceFixture.posts, 1, 'timeout cannot send again');
    checks++;
    const savedRevision = auth.getAuthSessionRevision();
    assert.equal(await auth.refreshTokens(), true);
    assert.equal(
        auth.getAuthSessionRevision(),
        savedRevision,
        'ordinary renewal keeps the session fence stable',
    );
    assert.equal(
        ops.getMaintenanceAttempt(ops.resourceKey(input)),
        next,
        'ordinary renewal preserves the outstanding receipt',
    );
    checks += 3;
    await auth.login('showcase.operator@nativemojo.com', 'mojo');
    auth.stopAutoRefresh();
    assert.notEqual(savedRevision, auth.getAuthSessionRevision());
    await assert.rejects(() => ops.requestMaintenance(input, scope()));
    assert.equal(
        globalThis.__maintenanceFixture.posts,
        1,
        'same actor reauthentication preserves resource attempt',
    );
    checks++;
    mock.setMockMaintenanceScenario('target-before-settled');
    const cluster = report.findings[1],
        clusterInput = {
            ...input,
            kind: cluster.kind,
            resource: cluster.resource_id,
            confirm_resource: cluster.resource_id,
            target_version: cluster.available_major,
            apply_immediately: true,
        };
    const target = await ops.requestMaintenance(clusterInput, scope());
    await ops.observeMaintenance(target, scope());
    await ops.observeMaintenance(target, scope());
    assert.equal(target.observation.upgraded, true);
    assert.equal(target.state, 'waiting', 'target before settled keeps waiting');
    await ops.observeMaintenance(target, scope());
    await ops.observeMaintenance(target, scope());
    assert.equal(target.state, 'complete');
    checks += 3;
    mock.setMockMaintenanceScenario('mixed-cache');
    const cache = report.findings[2],
        cacheInput = {
            ...input,
            kind: cache.kind,
            resource: cache.resource_id,
            confirm_resource: cache.resource_id,
            target_version: cache.available_major,
            apply_immediately: true,
        };
    const mixed = await ops.requestMaintenance(cacheInput, scope());
    await ops.observeMaintenance(mixed, scope());
    await ops.observeMaintenance(mixed, scope());
    assert.equal(mixed.state, 'waiting', 'mixed cache member versions are unconfirmed');
    checks++;
    const mismatched = { ...mixed.observation, target_version: 'different' };
    assert.throws(() => data.parseResourceStatus(mismatched, cacheInput));
    checks++;
    mock.setMockMaintenanceScenario('provider-unknown');
    const standalone = report.findings[3],
        unknownInput = {
            ...cacheInput,
            resource: standalone.resource_id,
            confirm_resource: standalone.resource_id,
        };
    await assert.rejects(
        () => ops.requestMaintenance(unknownInput, scope()),
        (e) => e.mutationState === 'unknown' && e.failure.iam_action === 'rds:ModifyDBInstance',
    );
    const unknown = ops.getMaintenanceAttempt(ops.resourceKey(unknownInput));
    assert.equal(unknown.state, 'uncertain');
    await data.readMaintenance(scope(), true);
    ops.refreshRefusedMaintenanceAttempt(unknown.key);
    await ops.observeMaintenance(unknown, scope());
    await assert.rejects(() => ops.requestMaintenance(unknownInput, scope()));
    checks += 3;
    mock.setMockMaintenanceScenario('framework-held');
    assert.equal(
        data.frameworkActionLabel(data.parseFramework(mock.maintenanceMockFramework(user))),
        'Resume and update',
    );
    checks++;
    mock.setMockMaintenanceScenario('framework-pin-cleared-503');
    await assert.rejects(() => ops.requestFramework('4.1.0', scope())); // offered 4.1.0 in this scenario
    const frameworkAttempt = ops.getMaintenanceAttempt('framework');
    assert.equal(frameworkAttempt.state, 'uncertain');
    assert.equal((await data.readFramework(scope(), true)).pin.mode, 'latest');
    ops.refreshRefusedMaintenanceAttempt('framework');
    await auth.login('showcase.operator@nativemojo.com', 'mojo');
    auth.stopAutoRefresh();
    await assert.rejects(() => ops.requestFramework('4.1.0', scope()));
    assert.equal(
        ops.getMaintenanceAttempt('framework'),
        frameworkAttempt,
        'policy and unknown deployment survive same-actor session replacement',
    );
    checks += 3;
    const stale = scope();
    await auth.login('showcase.operator@nativemojo.com', 'mojo');
    auth.stopAutoRefresh();
    assert.throws(
        () => stale.beforeSend(),
        (e) => e.code === 'denied',
        'session replacement fences even the same uid before send',
    );
    checks++;
    const me = await client.mojoCall('/api/user/me');
    assert(me.data.id);
    checks++;
    await auth.login('dns.platform@nativemojo.com', 'mojo');
    auth.stopAutoRefresh();
    mock.setMockMaintenanceScenario('findings');
    const wire = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    wire.armMockResponseOnce('POST', '/api/aws/maintenance/apply', {
        mapData: (r) => ({ ...r, schema_version: 2 }),
    });
    await assert.rejects(
        () => ops.requestMaintenance(input, scope()),
        (e) => e.mutationState === 'unknown',
    );
    assert.equal(
        ops.getMaintenanceAttempt(ops.resourceKey(input)).state,
        'uncertain',
        'malformed accepted AWS response retains the operation guard',
    );
    wire.armMockResponseOnce('POST', '/api/account/admin/platform/framework/update', {
        mapData: (r) => ({ ...r, deployment: { id: null } }),
    });
    await assert.rejects(
        () => ops.requestFramework('4.1.0', scope()),
        (e) => e.mutationState === 'unknown',
    );
    assert.equal(
        ops.getMaintenanceAttempt('framework').state,
        'uncertain',
        'malformed accepted deployment response cannot unlock another update',
    );
    checks += 4;
    await auth.login('assistant.operator@nativemojo.com', 'mojo');
    auth.stopAutoRefresh();
    mock.setMockMaintenanceScenario('duplicate');
    await assert.rejects(
        () => ops.requestMaintenance(input, scope()),
        (e) => e.code === 'upgrade_in_progress' && e.mutationState === 'unknown',
    );
    ops.refreshRefusedMaintenanceAttempt(ops.resourceKey(input));
    assert.equal(
        ops.getMaintenanceAttempt(ops.resourceKey(input)).state,
        'uncertain',
        'another active provider operation cannot be unlocked by an old-version refresh',
    );
    checks += 2;
    mock.setMockMaintenanceScenario('findings');
    wire.armMockResponseOnce('POST', '/api/account/admin/platform/framework/update', {
        mapData: () => {
            throw new client.MojoError('No converged row after clear', 409, 409);
        },
    });
    await assert.rejects(
        () => ops.requestFramework('4.1.0', scope()),
        (e) => e.mutationState === 'unknown',
    );
    assert.equal(
        ops.getMaintenanceAttempt('framework').state,
        'uncertain',
        'generic Framework409 can follow a cleared pin',
    );
    checks += 2;
    console.log(`Maintenance contracts: ${checks} assertions passed`);
} finally {
    delete globalThis.__maintenanceFixture;
    await server.close();
    dom.window.close();
}
