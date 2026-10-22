/** Mock-owned Maintenance provider simulation. Never performs a provider request. */
import { backendGlobalCan, type BackendGlobalUser } from '../admin/fleet/access';
import type { Finding, Framework, Report } from '../admin/maintenance/data';
export const MAINTENANCE_SCENARIOS = [
    'findings',
    'support-overdue', 'support-soon', 'later-target', 'status-missing', 'status-error',
    'framework-cached', 'policy-lost-response', 'policy-refused', 'framework-converged', 'framework-converged-version-missing', 'framework-failed', 'framework-missing-deployment',
    'empty',
    'denied-inventory',
    'unavailable',
    'scanning-off',
    'external',
    'bootstrap-denied',
    'bootstrap-malformed',
    'next-window',
    'target-before-settled',
    'settled-old',
    'mixed-cache',
    'all-members-upgraded',
    'provider-unknown',
    'duplicate',
    'cache-refusal',
    'stale-target',
    'reauth',
    'framework-held',
    'framework-pinned',
    'framework-current',
    'framework-unknown',
    'framework-no-converged',
    'framework-requires-superuser',
    'framework-pin-cleared-503',
    'framework-lost-response',
] as const;
export type MaintenanceScenario = (typeof MAINTENANCE_SCENARIOS)[number];
let scenario: MaintenanceScenario = 'findings';
const pending = new Map<string, { target: string; immediate: boolean; reads: number }>();
let frameworkRequested = false;
let policyValue: string | undefined;
let deploymentReads = 0;
const deploymentId = '92450000-0000-4000-8000-000000000001';
export function setMockMaintenanceScenario(value: MaintenanceScenario) {
    scenario = value;
    pending.clear();
    frameworkRequested = false; policyValue = undefined; deploymentReads = 0;
}
export function readMaintenanceBootstrapFacts(): {
    mode: 'managed' | 'external';
    infrastructureManaged: boolean;
    bootstrap: 'ok' | 'denied' | 'malformed';
} {
    return {
        mode: scenario === 'external' ? 'external' : 'managed',
        infrastructureManaged: scenario !== 'external',
        bootstrap:
            scenario === 'bootstrap-denied'
                ? 'denied'
                : scenario === 'bootstrap-malformed'
                  ? 'malformed'
                  : 'ok',
    };
}
const date = () => new Date().toISOString();
const finding = (
    kind: Finding['kind'],
    resource_id: string,
    engine: string,
    current_version: string,
    available_major: string,
): Finding => ({
    kind,
    resource_id,
    engine,
    current_version,
    available_major,
    deadline: kind === 'elasticache' ? null : '2027-02-28T00:00:00Z',
    extended_deadline: kind === 'elasticache' ? null : '2030-02-28T00:00:00Z',
    days_remaining: kind === 'elasticache' ? null : scenario === 'support-overdue' ? -14 : scenario === 'support-soon' ? 30 : 130,
    note:
        kind === 'elasticache'
            ? 'A replication group can contain mixed member versions.'
            : 'Review engine compatibility and snapshot recovery before applying.',
    release_notes_url: 'https://docs.aws.amazon.com/',
    status: 'available',
    pending_version: null,
    settled: true,
    ...(kind === 'elasticache' ? { members: 2, engine_versions: ['6.2', '6.0'] } : {}),
});
export function maintenanceMockReport(): Report {
    return {
        schema_version: 1,
        generated_at: date(),
        region: 'us-east-1',
        status: scenario === 'unavailable' ? 'unavailable' : 'ok',
        level: 5,
        scheduled: scenario !== 'scanning-off',
        findings: ['empty', 'unavailable'].includes(scenario)
            ? []
            : [
                  { ...finding('rds-instance', 'orders-db', 'postgres', scenario === 'later-target' && (pending.get('rds-instance:orders-db')?.reads ?? 0) >= 2 ? pending.get('rds-instance:orders-db')!.target : '14.12', scenario === 'later-target' && (pending.get('rds-instance:orders-db')?.reads ?? 0) >= 2 ? '17.2' : '16.4') },
                  finding('rds-cluster', 'analytics-cluster', 'aurora-postgresql', '13.12', '15.8'),
                  finding('elasticache', 'session-cache', 'redis', '6.2', '7.1'),
                  finding('elasticache', 'standalone-cache', 'redis', '6.0', '7.1'),
              ],
        warnings:
            scenario === 'denied-inventory'
                ? [
                      { iam_action: 'rds:DescribeDBClusters', aws_code: 'AccessDenied' },
                      { iam_action: 'elasticache:DescribeReplicationGroups', aws_code: 'AccessDenied' },
                  ]
                : [],
        reason: scenario === 'unavailable' ? 'AWS credentials unavailable' : null,
    };
}
export function maintenanceMockFramework(user: BackendGlobalUser): Framework {
    const defaultPin = ['framework-held','framework-pin-cleared-503'].includes(scenario) ? 'hold' : scenario === 'framework-pinned' ? '4.0.0' : '';
    const pin = policyValue ?? (frameworkRequested ? '' : defaultPin);
    const mode = pin === '' ? 'latest' : pin === 'hold' ? 'hold' : 'pinned';
    const unknown = scenario === 'framework-unknown';
    const latest = unknown ? null : scenario === 'framework-current' ? '4.0.0' : '4.1.0';
    const installed = '4.0.0';
    const update_available = !!latest && latest !== installed && mode === 'latest';
    const blocked_reason: Framework['blocked_reason'] = scenario === 'external' ? 'infrastructure_external' : !latest || !update_available && mode === 'latest' ? 'update_unavailable' : mode !== 'latest' && user.is_superuser !== true ? 'requires_superuser' : scenario === 'framework-no-converged' ? 'no_converged_deployment' : scenario === 'framework-requires-superuser' ? 'requires_superuser' : null;
    return {schema_version:1, installed, latest, checked_at:date(), source:unknown?'unavailable':scenario==='framework-cached'?'cache':'pypi',update_available,pin:{mode,value:pin||null},can_update:blocked_reason===null,blocked_reason};
}
const ok = (data: unknown) => ({ status: true, data });
const fail = (code: string, status: number, data?: unknown) => ({
    status: false,
    error: code.replaceAll('_', ' '),
    error_code: code,
    code: status,
    ...(data ? { data } : {}),
});
export interface MaintenanceMockContext {
    user?: (BackendGlobalUser & { is_active?: boolean; id?: number | string }) | null;
    keyBacked?: boolean;
    fresh?: boolean;
}
export function maintenanceMock(
    path: string,
    method: string,
    body: Record<string, unknown> | undefined,
    params: Record<string, unknown> = {},
    context: MaintenanceMockContext = {},
): unknown {
    const aws = [
            '/api/aws/maintenance/versions',
            '/api/aws/maintenance/status',
            '/api/aws/maintenance/apply',
        ].includes(path),
        framework =
            path === '/api/account/admin/platform/framework' ||
            path === '/api/account/admin/platform/framework/update';
    const policy = path === '/api/account/admin/advanced/settings' && Object.hasOwn(body ?? {}, 'framework_pin');
    const platform = path === '/api/account/admin/platform' && params.sections === 'deployments';
    if (!aws && !framework && !policy && !platform) return undefined;
    const user = context.user;
    if (!user || user.is_active === false) return fail('permission_denied', 403);
    if (!backendGlobalCan(user, aws ? 'manage_aws' : ['view_platform', 'manage_platform', 'admin']))
        return fail('permission_denied', 403);
    if (platform && method === 'GET') {
        deploymentReads++;
        const status = scenario === 'framework-failed' ? 'failed' : deploymentReads >= 2 ? 'converged' : 'fleet';
        return ok({ schema_version: 1, sections: { deployments: { status: 'ok', data: { items: !frameworkRequested || scenario === 'framework-missing-deployment' ? [] : [{ id: deploymentId, sha: 'a'.repeat(40), status, framework_version: '4.1.0', frozen_roster: ['runner-maint-1'], node_evidence: [{runner: 'runner-maint-1', state: status === 'converged' ? 'proven' : 'dispatched', observed_at: date(), stale_after: new Date(Date.now()+60000).toISOString(), proof: {platform_deployment: deploymentId, platform_sha: 'a'.repeat(40), django_mojo_version: scenario === 'framework-converged-version-missing' ? null : '4.1.0'}}] }] } } } });
    }
    if (method === 'GET' && path === '/api/aws/maintenance/versions') return ok(maintenanceMockReport());
    if (method === 'GET' && path === '/api/account/admin/platform/framework')
        return ok(maintenanceMockFramework(user));
    if (method === 'GET' && path === '/api/aws/maintenance/status') {
        if (scenario === 'status-error') return fail('provider_unavailable',503);
        if (scenario === 'status-missing') return ok({schema_version:1,kind:params.kind,resource:params.resource,target_version:params.target_version,found:false,status:null,engine_version:null,engine_versions:[],pending_version:null,settled:false,upgraded:false});
        const f = maintenanceMockReport().findings.find(
            (f) => f.kind === params.kind && f.resource_id === params.resource,
        );
        if (!f || typeof params.target_version !== 'string') return fail('invalid_request', 400);
        const attempt = pending.get(`${f.kind}:${f.resource_id}`);
        if (attempt) attempt.reads++;
        const waiting =
            ['next-window', 'settled-old', 'provider-unknown'].includes(scenario) ||
            (!!attempt && !attempt.immediate);
        const targetObserved = !!attempt && !waiting && attempt.reads >= 2;
        const settled =
            targetObserved && (scenario !== 'target-before-settled' || (attempt?.reads ?? 0) >= 4);
        const mixed = scenario === 'mixed-cache' && f.kind === 'elasticache';
        const versions = targetObserved
            ? mixed
                ? [params.target_version, f.current_version]
                : [params.target_version, params.target_version]
            : [f.current_version];
        return ok({
            schema_version: 1,
            kind: f.kind,
            resource: f.resource_id,
            target_version: params.target_version,
            found: true,
            status: waiting || settled ? 'available' : 'modifying',
            engine_version: versions[0],
            engine_versions: versions,
            pending_version: attempt && !settled ? attempt.target : null,
            settled: waiting || settled,
            upgraded: targetObserved && !mixed,
        });
    }
    if (
        method !== 'POST' ||
        !['/api/aws/maintenance/apply', '/api/account/admin/platform/framework/update', '/api/account/admin/advanced/settings'].includes(path)
    )
        return fail('method_not_allowed', 405);
    if (context.keyBacked) return fail('permission_denied', 403);
    if (!context.fresh || scenario === 'reauth') return fail('fresh_auth_required', 440);
    if (!backendGlobalCan(user, ['manage_platform', 'admin'])) return fail('permission_denied', 403);
    if (policy) {
        if (user.is_superuser !== true) return fail('permission_denied',403);
        const value = body?.framework_pin;
        if (typeof value !== 'string' || !(value === '' || value === 'hold' || /^[0-9][a-z0-9._!+-]{0,63}$/.test(value))) return fail('invalid_request',400);
        if (scenario === 'policy-refused') return fail('invalid_request',400);
        policyValue = value;
        if (scenario === 'policy-lost-response') return fail('service_unavailable',503);
        return ok({schema_version:1,saved:true,value});
    }
    if (scenario === 'external') return fail('infrastructure_external', 403);
    if (!body) return fail('invalid_request', 400);
    if (aws) {
        const f = maintenanceMockReport().findings.find(
            (f) => f.kind === body.kind && f.resource_id === body.resource,
        );
        if (!f || body.confirm_resource !== body.resource || typeof body.apply_immediately !== 'boolean')
            return fail('invalid_request', 400);
        if (body.target_version !== f.available_major || scenario === 'stale-target')
            return fail('upgrade_not_offered', 409);
        const key = `${f.kind}:${f.resource_id}`;
        if (pending.has(key) && !(scenario === 'later-target' && pending.get(key)!.reads >= 2) || scenario === 'duplicate') return fail('upgrade_in_progress', 409);
        if (scenario === 'cache-refusal') return fail('cache_unavailable', 503);
        pending.set(key, { target: f.available_major, immediate: body.apply_immediately, reads: 0 });
        if (scenario === 'provider-unknown')
            return fail('provider_unavailable', 503, {
                failure: {
                    operation: 'rds.modify_db_instance',
                    provider_code: 'RequestTimeout',
                    retryable: true,
                    mutation_state: 'unknown',
                    iam_action: 'rds:ModifyDBInstance',
                },
            });
        return ok({
            schema_version: 1,
            requested: true,
            resource: f.resource_id,
            kind: f.kind,
            engine: f.engine,
            from_version: f.current_version,
            target_version: f.available_major,
            apply_immediately: body.apply_immediately,
            release_notes_url: f.release_notes_url,
            operation:
                f.kind === 'elasticache'
                    ? f.resource_id === 'standalone-cache'
                        ? 'elasticache.modify_cache_cluster'
                        : 'elasticache.modify_replication_group'
                    : f.kind === 'rds-cluster'
                      ? 'rds.modify_db_cluster'
                      : 'rds.modify_db_instance',
        });
    }
    const fw = maintenanceMockFramework(user);
    if (!fw.can_update || body.version !== fw.latest || body.confirm_version !== body.version)
        return fail('update_unavailable', 409);
    frameworkRequested = true; policyValue = ''; deploymentReads = 0;
    if (['framework-pin-cleared-503', 'framework-lost-response'].includes(scenario))
        return fail('deployment_coordination_unavailable', 503);
    return ok({
        schema_version: 1,
        requested: true,
        version: fw.latest,
        cleared_pin: fw.pin.value,
        deployment: { id: deploymentId, sha: 'a'.repeat(40), status: 'pending' },
    });
}

export const getMockMaintenanceScenario = () => scenario;
/** Demo-only provider passage: retain receipts and server operations; never replay a write. */
export function advanceMockMaintenance() {
    scenario = 'all-members-upgraded';
    for (const operation of pending.values()) { operation.immediate = true; operation.reads = Math.max(2, operation.reads); }
    deploymentReads = Math.max(2, deploymentReads);
}
