/** Mock-owned Maintenance provider simulation. Never performs a provider request. */
import { backendGlobalCan, type BackendGlobalUser } from '../admin/fleet/access';
import type { Finding, Framework, Report } from '../admin/maintenance/data';
export const MAINTENANCE_SCENARIOS = [
    'findings',
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
export function setMockMaintenanceScenario(value: MaintenanceScenario) {
    scenario = value;
    pending.clear();
    frameworkRequested = false;
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
    days_remaining: kind === 'elasticache' ? null : 130,
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
                  finding('rds-instance', 'orders-db', 'postgres', '14.12', '16.4'),
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
    const held = ['framework-held', 'framework-pin-cleared-503'].includes(scenario),
        pinned = scenario === 'framework-pinned',
        noNewer = ['framework-current', 'framework-held', 'framework-pinned'].includes(scenario),
        unknown = scenario === 'framework-unknown';
    let blocked: Framework['blocked_reason'] =
        scenario === 'external'
            ? 'infrastructure_external'
            : unknown || scenario === 'framework-current'
              ? 'update_unavailable'
              : scenario === 'framework-no-converged'
                ? 'no_converged_deployment'
                : scenario === 'framework-requires-superuser' ||
                    ((held || pinned) && user.is_superuser !== true && !frameworkRequested)
                  ? 'requires_superuser'
                  : null;
    if (frameworkRequested && noNewer) blocked = 'update_unavailable';
    if (frameworkRequested && scenario === 'framework-pin-cleared-503') blocked = null;
    return {
        schema_version: 1,
        installed: '4.0.0',
        latest: unknown ? null : noNewer ? '4.0.0' : '4.1.0',
        checked_at: date(),
        source: unknown ? 'unavailable' : 'pypi',
        update_available: !unknown && !noNewer,
        pin: {
            mode: !frameworkRequested && held ? 'hold' : !frameworkRequested && pinned ? 'pinned' : 'latest',
            value: !frameworkRequested && (held || pinned) ? '4.0.0' : null,
        },
        can_update: blocked === null,
        blocked_reason: blocked,
    };
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
    if (!aws && !framework) return undefined;
    const user = context.user;
    if (!user || user.is_active === false) return fail('permission_denied', 403);
    if (!backendGlobalCan(user, aws ? 'manage_aws' : ['view_platform', 'manage_platform', 'admin']))
        return fail('permission_denied', 403);
    if (method === 'GET' && path === '/api/aws/maintenance/versions') return ok(maintenanceMockReport());
    if (method === 'GET' && path === '/api/account/admin/platform/framework')
        return ok(maintenanceMockFramework(user));
    if (method === 'GET' && path === '/api/aws/maintenance/status') {
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
            pending_version: attempt && !waiting ? attempt.target : null,
            settled: waiting || settled,
            upgraded: targetObserved && !mixed,
        });
    }
    if (
        method !== 'POST' ||
        !['/api/aws/maintenance/apply', '/api/account/admin/platform/framework/update'].includes(path)
    )
        return fail('method_not_allowed', 405);
    if (context.keyBacked) return fail('permission_denied', 403);
    if (!context.fresh || scenario === 'reauth') return fail('fresh_auth_required', 440);
    if (!backendGlobalCan(user, ['manage_platform', 'admin'])) return fail('permission_denied', 403);
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
        if (pending.has(key) || scenario === 'duplicate') return fail('upgrade_in_progress', 409);
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
    frameworkRequested = true;
    if (['framework-pin-cleared-503', 'framework-lost-response'].includes(scenario))
        return fail('deployment_coordination_unavailable', 503);
    return ok({
        schema_version: 1,
        requested: true,
        version: fw.latest,
        cleared_pin: fw.pin.value,
        deployment: { id: 'maintenance-deployment-1', sha: 'a'.repeat(40), status: 'pending' },
    });
}
