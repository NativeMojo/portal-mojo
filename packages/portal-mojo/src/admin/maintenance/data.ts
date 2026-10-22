/** Narrow Maintenance protocol boundary; no mutation cache, retry or replay. */
import { apiOrigin, usingMockTransport } from '../../client/client';
import { getAuthSessionRevision, getAuthSnapshot, mojoCall, MojoError } from '../../client/runtime';
import { backendGlobalCan, type BackendGlobalUser } from '../fleet/access';
export const MAINTENANCE_ENDPOINTS = {
    versions: '/api/aws/maintenance/versions',
    status: '/api/aws/maintenance/status',
    apply: '/api/aws/maintenance/apply',
    framework: '/api/account/admin/platform/framework',
    update: '/api/account/admin/platform/framework/update',
    bootstrap: '/api/account/admin/bootstrap',
    policy: '/api/account/admin/advanced/settings',
    platform: '/api/account/admin/platform',
} as const;
export type Kind = 'rds-instance' | 'rds-cluster' | 'elasticache';
export interface Finding {
    kind: Kind;
    resource_id: string;
    engine: string;
    current_version: string;
    available_major: string;
    deadline: string | null;
    extended_deadline: string | null;
    days_remaining: number | null;
    note: string | null;
    release_notes_url: string | null;
    status: string | null;
    pending_version: string | null;
    settled: boolean | null;
    members?: number;
    engine_versions?: string[];
}
export interface Report {
    schema_version: 1;
    generated_at: string | null;
    region: string | null;
    status: 'ok' | 'unavailable';
    level: number;
    scheduled: boolean;
    findings: Finding[];
    warnings: { iam_action: string; aws_code: string | null }[];
    reason: string | null;
}
export interface ResourceStatus {
    schema_version: 1;
    kind: Kind;
    resource: string;
    target_version: string;
    found: boolean;
    status: string | null;
    engine_version: string | null;
    engine_versions: string[];
    pending_version: string | null;
    settled: boolean;
    upgraded: boolean;
}
export interface Framework {
    schema_version: 1;
    installed: string | null;
    latest: string | null;
    checked_at: string | number | null;
    source: 'pypi' | 'cache' | 'unavailable';
    update_available: boolean;
    pin: { mode: 'latest' | 'hold' | 'pinned'; value: string | null };
    can_update: boolean;
    blocked_reason:
        | 'update_unavailable'
        | 'requires_superuser'
        | 'no_converged_deployment'
        | 'infrastructure_external'
        | null;
}
export interface ApplyInput {
    kind: Kind;
    resource: string;
    target_version: string;
    confirm_resource: string;
    apply_immediately: boolean;
}
export interface Scope {
    signal?: AbortSignal;
    beforeSend?: () => void;
}
export class MaintenanceError extends Error {
    constructor(
        public code: string,
        public mutationState: 'none' | 'attempted' | 'unknown' = 'none',
        public failure?: {
            operation: string;
            provider_code: string;
            retryable: boolean;
            mutation_state: string;
            iam_action?: string;
        },
    ) {
        super(
            code === 'fresh_auth_required'
                ? 'Authenticate again, then refresh and review a new confirmation. Nothing is replayed.'
                : code === 'incompatible'
                  ? 'Maintenance returned incompatible evidence. Refresh before continuing.'
                  : code === 'denied'
                    ? 'Current global permission or session does not allow this operation.'
                    : `${code.replaceAll('_', ' ')}${mutationState !== 'none' ? ' — the operation may have started; reconcile provider status before another request.' : '. Refresh authoritative evidence before continuing.'}`,
        );
        if (failure) {
            this.message += ` Operation: ${failure.operation}; provider code: ${failure.provider_code}; mutation state: ${failure.mutation_state}; retryable: ${String(failure.retryable)}${failure.iam_action ? `; IAM action: ${failure.iam_action}` : ''}.`;
        }
    }
}
const invalid = (): never => {
    throw new MaintenanceError('incompatible');
};
const obj = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : invalid();
const text = (v: unknown, max = 512): string =>
    typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v) ? v : invalid();
const nullableText = (v: unknown) => (v == null ? null : text(v));
const errorToken = (v: unknown): string =>
    typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(v) ? v : invalid();
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : invalid());
const enumeration = <T extends string>(v: unknown, values: readonly T[]): T =>
    values.includes(v as T) ? (v as T) : invalid();
const array = (v: unknown, max = 1024): unknown[] => (Array.isArray(v) && v.length <= max ? v : invalid());
const schema = (v: unknown) => {
    const r = obj(v);
    if (r.schema_version !== 1) invalid();
    return r;
};
const kind = (v: unknown) => enumeration(v, ['rds-instance', 'rds-cluster', 'elasticache'] as const);
export function releaseNotesURL(v: unknown): string | null {
    if (v == null) return null;
    const s = text(v, 2048);
    try {
        const u = new URL(s);
        return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
    } catch {
        return null;
    }
}
export function parseFinding(v: unknown): Finding {
    const r = obj(v);
    return {
        kind: kind(r.kind),
        resource_id: text(r.resource_id),
        engine: text(r.engine),
        current_version: text(r.current_version),
        available_major: text(r.available_major),
        deadline: nullableText(r.deadline),
        extended_deadline: nullableText(r.extended_deadline),
        days_remaining:
            r.days_remaining == null
                ? null
                : typeof r.days_remaining === 'number' && Number.isFinite(r.days_remaining)
                  ? r.days_remaining
                  : invalid(),
        note: nullableText(r.note),
        release_notes_url: releaseNotesURL(r.release_notes_url),
        status: nullableText(r.status),
        pending_version: nullableText(r.pending_version),
        settled: r.settled == null ? null : bool(r.settled),
        ...(r.members == null
            ? {}
            : {
                  members:
                      Number.isSafeInteger(r.members) && Number(r.members) >= 0
                          ? Number(r.members)
                          : invalid(),
              }),
        ...(r.engine_versions == null
            ? {}
            : { engine_versions: array(r.engine_versions, 256).map((x) => text(x)) }),
    };
}
export function parseReport(v: unknown): Report {
    const r = schema(v);
    const findings = array(r.findings).map(parseFinding);
    if (new Set(findings.map((f) => `${f.kind}:${f.resource_id}`)).size !== findings.length) invalid();
    return {
        schema_version: 1,
        generated_at: nullableText(r.generated_at),
        region: nullableText(r.region),
        status: enumeration(r.status, ['ok', 'unavailable']),
        level: typeof r.level === 'number' && Number.isFinite(r.level) ? r.level : invalid(),
        scheduled: bool(r.scheduled),
        findings,
        warnings: array(r.warnings, 128).map((v) => {
            const w = obj(v);
            return { iam_action: text(w.iam_action), aws_code: nullableText(w.aws_code) };
        }),
        reason: nullableText(r.reason),
    };
}
export function parseResourceStatus(
    v: unknown,
    target: Pick<ApplyInput, 'kind' | 'resource' | 'target_version'>,
): ResourceStatus {
    const r = schema(v);
    if (
        r.kind !== target.kind ||
        r.resource !== target.resource ||
        r.target_version !== target.target_version
    )
        invalid();
    return {
        schema_version: 1,
        kind: kind(r.kind),
        resource: text(r.resource),
        target_version: text(r.target_version),
        found: bool(r.found),
        status: nullableText(r.status),
        engine_version: nullableText(r.engine_version),
        engine_versions: array(r.engine_versions, 256).map((x) => text(x)),
        pending_version: nullableText(r.pending_version),
        settled: bool(r.settled),
        upgraded: bool(r.upgraded),
    };
}
export function parseFramework(v: unknown): Framework {
    const r = schema(v),
        p = obj(r.pin);
    const result: Framework = {
        schema_version: 1,
        installed: nullableText(r.installed),
        latest: nullableText(r.latest),
        checked_at:
            r.checked_at == null
                ? null
                : typeof r.checked_at === 'number' && Number.isFinite(r.checked_at)
                  ? r.checked_at
                  : text(r.checked_at),
        source: enumeration(r.source, ['pypi', 'cache', 'unavailable']),
        update_available: bool(r.update_available),
        pin: { mode: enumeration(p.mode, ['latest', 'hold', 'pinned']), value: nullableText(p.value) },
        can_update: bool(r.can_update),
        blocked_reason:
            r.blocked_reason === null
                ? null
                : enumeration(r.blocked_reason, [
                      'update_unavailable',
                      'requires_superuser',
                      'no_converged_deployment',
                      'infrastructure_external',
                  ] as const),
    };
    if (
        result.can_update &&
        (!result.latest ||
            result.blocked_reason ||
            (!result.update_available && result.pin.mode === 'latest'))
    )
        invalid();
    return result;
}
export function parseInfrastructure(v: unknown): 'managed' | 'external' {
    const r = obj(v),
        mode = enumeration(obj(r.infrastructure).mode, ['managed', 'external'] as const),
        managed = obj(obj(obj(r.features).platform).capabilities).infrastructure_managed;
    if (managed !== (mode === 'managed')) invalid();
    return mode;
}
export function maintenanceAccess(user: BackendGlobalUser | null | undefined) {
    return {
        aws: backendGlobalCan(user, 'manage_aws'),
        framework: backendGlobalCan(user, ['view_platform', 'manage_platform', 'admin']),
        bootstrap: backendGlobalCan(user, ['view_admin', 'manage_users', 'manage_settings', 'admin']),
        manage: backendGlobalCan(user, ['manage_platform', 'admin']),
    };
}
export function maintenanceFence(scope: Scope = {}): Scope {
    const revision = getAuthSessionRevision(),
        actor = getAuthSnapshot().uid;
    return {
        signal: scope.signal,
        beforeSend() {
            if (
                scope.signal?.aborted ||
                !actor ||
                !getAuthSnapshot().authenticated ||
                actor !== getAuthSnapshot().uid ||
                revision !== getAuthSessionRevision()
            )
                throw new MaintenanceError('denied');
            scope.beforeSend?.();
        },
    };
}
function sameOrigin() {
    if (
        !usingMockTransport() &&
        new URL(apiOrigin(), window.location.origin).origin !== window.location.origin
    )
        throw new MaintenanceError('denied');
}
async function call(
    path: string,
    scope: Scope = {},
    body?: Record<string, unknown>,
    params?: Record<string, string | number>,
) {
    const fence = maintenanceFence(scope);
    try {
        if (body) sameOrigin();
        return (
            await mojoCall(path, {
                ...(body ? { method: 'POST', body } : { params }),
                signal: scope.signal,
                beforeSend: () => {
                    if (body) sameOrigin();
                    fence.beforeSend?.();
                },
            })
        ).data;
    } catch (e) {
        if (e instanceof MaintenanceError) throw e;
        if (e instanceof MojoError) {
            const knownCodes = new Set([
                'provider_denied',
                'provider_unavailable',
                'provider_error',
                'cache_unavailable',
                'upgrade_in_progress',
                'upgrade_not_offered',
                'infrastructure_external',
                'permission_denied',
                'invalid_request',
                'update_unavailable',
                'deployment_coordination_unavailable',
            ]);
            const code =
                e.status === 440
                    ? 'fresh_auth_required'
                    : typeof e.errorCode === 'string' && knownCodes.has(e.errorCode)
                      ? e.errorCode
                      : [401, 403].includes(e.status)
                        ? 'denied'
                        : 'service_unavailable';
            let failure: MaintenanceError['failure'];
            try {
                const f = obj(obj(e.data).failure);
                failure = {
                    operation: errorToken(f.operation),
                    provider_code: errorToken(f.provider_code),
                    retryable: bool(f.retryable),
                    mutation_state: enumeration(f.mutation_state, ['none', 'attempted', 'unknown']),
                    ...(f.iam_action == null ? {} : { iam_action: errorToken(f.iam_action) }),
                };
            } catch {
                /* No provider evidence. */
            }
            // A generic Framework 409 may follow a successful pin clear. An
            // upgrade_in_progress refusal also proves outstanding provider work.
            // Neither outcome is safe to unlock from a refreshed old version.
            const preProviderCodes = new Set([
                'cache_unavailable',
                'upgrade_not_offered',
                'invalid_request',
                'infrastructure_external',
                'permission_denied',
                'update_unavailable',
            ]);
            const safeRefusal =
                e.status === 440 ||
                (!failure &&
                    (preProviderCodes.has(code) ||
                        ([400, 401, 403, 404, 405].includes(e.status) &&
                            !['provider_denied', 'provider_error', 'provider_unavailable'].includes(code))));
            throw new MaintenanceError(
                code,
                failure?.mutation_state === 'attempted'
                    ? 'attempted'
                    : failure?.mutation_state === 'unknown' || (body && !safeRefusal)
                      ? 'unknown'
                      : 'none',
                failure,
            );
        }
        throw new MaintenanceError(
            body ? 'operation_uncertain' : 'service_unavailable',
            body ? 'unknown' : 'none',
        );
    }
}
export const readMaintenance = async (scope?: Scope, refresh = false) =>
    parseReport(
        await call(MAINTENANCE_ENDPOINTS.versions, scope, undefined, refresh ? { refresh: 1 } : undefined),
    );
export const readFramework = async (scope?: Scope, refresh = false) =>
    parseFramework(
        await call(MAINTENANCE_ENDPOINTS.framework, scope, undefined, refresh ? { refresh: 1 } : undefined),
    );
export const readInfrastructure = async (scope?: Scope) =>
    parseInfrastructure(await call(MAINTENANCE_ENDPOINTS.bootstrap, scope));
export const readMaintenanceStatus = async (
    target: Pick<ApplyInput, 'kind' | 'resource' | 'target_version'>,
    scope?: Scope,
) => parseResourceStatus(await call(MAINTENANCE_ENDPOINTS.status, scope, undefined, target), target);
export async function applyMaintenance(input: ApplyInput, scope?: Scope) {
    kind(input.kind);
    text(input.resource);
    text(input.target_version);
    if (input.confirm_resource !== input.resource || typeof input.apply_immediately !== 'boolean') invalid();
    const raw = await call(MAINTENANCE_ENDPOINTS.apply, scope, { ...input });
    try {
        const r = schema(raw);
        if (
            r.requested !== true ||
            r.kind !== input.kind ||
            r.resource !== input.resource ||
            r.target_version !== input.target_version ||
            r.apply_immediately !== input.apply_immediately
        )
            throw new MaintenanceError('operation_uncertain', 'unknown');
        return { requested: true as const, operation: text(r.operation) };
    } catch {
        throw new MaintenanceError('operation_uncertain', 'unknown');
    }
}
export async function updateFramework(version: string, scope?: Scope) {
    text(version);
    const raw = await call(MAINTENANCE_ENDPOINTS.update, scope, { version, confirm_version: version });
    try {
        const r = schema(raw);
        if (r.requested !== true || r.version !== version)
            throw new MaintenanceError('operation_uncertain', 'unknown');
        const d = obj(r.deployment);
        return {
            requested: true as const,
            version,
            cleared_pin: nullableText(r.cleared_pin),
            deployment: { id: text(d.id), sha: text(d.sha), status: text(d.status) },
        };
    } catch {
        throw new MaintenanceError('operation_uncertain', 'unknown');
    }
}
export const frameworkActionLabel = (f: Framework) =>
    f.pin.mode === 'latest' ? `Update to ${f.latest}` : 'Resume and update';

/** These labels do not interpret policy-suppressed update_available as current. */
export function frameworkStatusLabel(f: Framework) {
    if (!f.latest || f.source === 'unavailable') return 'Latest version unknown';
    if (!f.installed) return 'Installed version unknown';
    if (f.pin.mode !== 'latest') return f.latest === f.installed ? 'Update policy paused' : 'Published version differs · policy paused';
    if (f.update_available) return 'Update available';
    return f.latest === f.installed ? 'Current' : 'Published version differs';
}
export function supportUrgency(f: Finding) {
    const days = f.days_remaining;
    return days == null ? null : days < 0 ? `Standard support ended ${Math.abs(days)} days ago` : days === 0 ? 'Standard support ends today' : days <= 30 ? `Standard support ends in ${days} days` : null;
}
export function normalizePolicy(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === '' || normalized === 'hold' || /^[0-9][a-z0-9._!+-]{0,63}$/.test(normalized)) return normalized;
    throw new MaintenanceError('invalid_framework_version');
}
export function policyMatches(pin: Framework['pin'], value: string) {
    return value === '' ? pin.mode === 'latest' : value === 'hold' ? pin.mode === 'hold' : pin.mode === 'pinned' && pin.value === value;
}
export async function saveFrameworkPolicy(value: string, scope?: Scope) {
    const pin = normalizePolicy(value);
    const raw = await call(MAINTENANCE_ENDPOINTS.policy, scope, { framework_pin: pin });
    try { const r = schema(raw); if (r.saved !== true || r.value !== pin) invalid(); return pin; }
    catch { throw new MaintenanceError('operation_uncertain', 'unknown'); }
}
export interface FrameworkObservation {
    id: string; sha: string; status: string; framework_version: string | null;
    nodes: { runner: string; state: string; version: string | null }[];
    terminal: boolean; versionProven: boolean;
}
export async function readFrameworkDeployment(target: { id: string; sha: string }, version: string, scope?: Scope): Promise<FrameworkObservation> {
    const r = schema(await call(MAINTENANCE_ENDPOINTS.platform, scope, undefined, { sections: 'deployments' }));
    const collector = obj(obj(r.sections).deployments);
    if (!['ok', 'healthy', 'degraded', 'unhealthy'].includes(String(collector.status))) invalid();
    const row = array(obj(collector.data).items, 50).map(obj).find(d => d.id === target.id);
    if (!row || row.sha !== target.sha) throw new MaintenanceError('deployment_evidence_missing');
    const roster = array(row.frozen_roster, 256).map(v => text(v));
    const evidence = array(row.node_evidence, 256).map(obj);
    const nodes = evidence.map(e => ({ runner: text(e.runner), state: text(e.state), version: obj(e.proof ?? {}).django_mojo_version === '' ? null : nullableText(obj(e.proof ?? {}).django_mojo_version) }));
    const status = text(row.status);
    const versionProven = status === 'converged' && row.framework_version === version && roster.length > 0 && new Set(roster).size === roster.length && roster.every(runner => {
        const matches = evidence.filter(e => e.runner === runner); if (matches.length !== 1) return false;
        const e = matches[0]!, p = obj(e.proof ?? {});
        return e.state === 'proven' && typeof e.observed_at === 'string' && Number.isFinite(Date.parse(e.observed_at)) && Date.parse(e.observed_at) <= Date.now()+60_000 && typeof e.stale_after === 'string' && Date.parse(e.stale_after) > Date.now() && p.platform_deployment === target.id && typeof p.platform_sha === 'string' && /^[a-f0-9]{40}$/i.test(p.platform_sha) && p.platform_sha === target.sha && p.django_mojo_version === version;
    });
    return { id: target.id, sha: target.sha, status, framework_version: row.framework_version === '' ? null : nullableText(row.framework_version), nodes, terminal: ['converged','failed','superseded'].includes(status), versionProven };
}
