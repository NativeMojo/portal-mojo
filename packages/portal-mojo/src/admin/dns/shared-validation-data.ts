/** Internal public-metadata boundary. Raw responses never become component/cache state. */
export class SharedValidationError extends Error {
    constructor(public kind: 'unsupported' | 'access' | 'unavailable' | 'invalid' | 'reauth' | 'prerequisite', public readiness: Readiness | null = null, public code: string | null = null) {
        super({ unsupported: 'Shared validation needs a compatible backend. Ordinary DNS and legacy certificates remain available.', access: 'Shared validation is unavailable with this session or allocation.', unavailable: 'Shared validation could not be refreshed. Check the deployment and try Refresh.', invalid: 'Shared validation returned an incompatible response. Refresh after checking the backend.', reauth: 'Authenticate again, then Refresh and deliberately repeat the action.', prerequisite: 'The backend refused this action. Review the refreshed validation state.' }[kind]);
    }
}
export type SetupTarget = { domain: number } | { group: number; name: string };
export interface ConnectionRequest { version: 1; consumer_project_uuid: string; client_ref: string; domain: string; allocation_ref: string }
export interface Readiness {
    version: 1; checked_at: string;
    domain: { id: number | null; name: string; provider: string | null; group: { id: number; name: string } | null };
    profile: { name: 'apex_wildcard'; names: string[] };
    hub: { state: string; protocol_version: number | null; consumer_project_uuid: string | null };
    connection: { id: number; mode: 'shared' | 'allocated'; state: string; client_ref: string; allocation_ref: string | null; participant_ref: string | null; verified_at: string | null } | null;
    trust: { state: string; can_publish: boolean; can_withdraw: boolean };
    alias: { state: string; source: string; target: string | null; observed_target: string | null; one_hop: boolean | null; checked_at: string | null };
    certificate: { id: number; state: string; names: string[]; not_after: string | null; renew_after: string | null; serving_valid: boolean | null; material_state: string } | null;
    renewal: { state: string; next_attempt_at: string | null; attempts: number; error_code: string | null; cleanup_pending: boolean; job: { id: string; state: string } | null; worker_version: string | null };
    capabilities: { group_choices: boolean; can_connect: boolean; can_restart: boolean; can_check: boolean; can_request: boolean };
    next_action: { code: string; actor: string };
    connection_request: ConnectionRequest | null;
    operation: { action: string; outcome: string; changed: boolean };
}
export interface HubCapabilities { version: 2; shared_validation: boolean; consumer_project_uuid: string | null; can_consume: boolean; can_manage_trust: boolean; trust_scope: 'apex_and_wildcard' }
export interface Allocation { allocation_ref: string; domain: string; source: string; target: string; owner_project_uuid: string; can_manage_trust: boolean }
export interface Participant { allocation_ref: string; participant_ref: string; client_ref: string; domain: string; source: string; target: string; role: 'owner' | 'trusted'; trust_state: 'active' | 'revoked'; scope: string[]; can_publish: boolean; can_withdraw: boolean; revoked_at: string | null; consumer_project_uuid: string; consumer_label: string }
export interface Recipient { consumer_project_uuid: string; label: string; active: boolean }
export interface Page<T> { items: T[]; next_cursor: string | null }
const invalid = (): never => { throw new SharedValidationError('invalid'); };
export function record(value: unknown): Record<string, unknown> { return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid(); }
export function text(value: unknown, max = 200): string { return typeof value === 'string' && value.length <= max && !/[\x00-\x1f]|-----BEGIN|Bearer\s|:\/\//i.test(value) ? value : invalid(); }
export function positive(value: unknown): number { return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : invalid(); }
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : invalid();
const bool = (value: unknown): boolean => typeof value === 'boolean' ? value : invalid();
const nullable = <T>(value: unknown, parse: (v: unknown) => T): T | null => value === null ? null : parse(value);
const choice = <T extends string>(value: unknown, values: readonly T[]): T => values.includes(value as T) ? value as T : invalid();
export function hostname(value: unknown): string {
    const name = text(value, 253);
    return name === name.toLowerCase() && name.includes('.') && name.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ? name : invalid();
}
export function normalizeHostname(value: string): string { return hostname(value.trim().toLowerCase().replace(/\.+$/, '')); }
export function uuid(value: unknown): string { const v = text(value, 36); return /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(v) ? v : invalid(); }
const date = (v: unknown) => { const s = text(v, 40); return Number.isFinite(Date.parse(s)) ? s : invalid(); };
const token = (v: unknown) => { const s = text(v, 64); return /^[a-z0-9_.-]+$/.test(s) ? s : invalid(); };
function scope(v: unknown, domain: string): string[] { if (!Array.isArray(v) || v.length !== 2 || v[0] !== domain || v[1] !== `*.${domain}`) invalid(); return [domain, `*.${domain}`]; }
function names(v: unknown): string[] { if (!Array.isArray(v) || v.length < 1 || v.length > 100) return invalid(); return v.map((n) => typeof n === 'string' && n.startsWith('*.') ? `*.${hostname(n.slice(2))}` : hostname(n)); }
export function parseConnectionRequest(value: unknown): ConnectionRequest {
    const r = record(value);
    if (Object.keys(r).sort().join(',') !== 'allocation_ref,client_ref,consumer_project_uuid,domain,version' || r.version !== 1) invalid();
    return { version: 1, consumer_project_uuid: uuid(r.consumer_project_uuid), client_ref: uuid(r.client_ref), domain: hostname(r.domain), allocation_ref: hostname(r.allocation_ref) };
}
export const CONNECTION_REQUEST_MAX_BYTES = 2048;
export function parseConnectionRequestText(value: string): ConnectionRequest {
    if (!value || new TextEncoder().encode(value).byteLength > CONNECTION_REQUEST_MAX_BYTES) return invalid();
    try { return parseConnectionRequest(JSON.parse(value)); } catch { return invalid(); }
}
export function serializeConnectionRequest(value: ConnectionRequest): string {
    const result = JSON.stringify(parseConnectionRequest(value));
    parseConnectionRequestText(result);
    return result;
}
export function parseReadiness(value: unknown, target?: SetupTarget, allocation?: string): Readiness {
    const r = record(value); if (r.version !== 1) throw new SharedValidationError('unsupported');
    const d = record(r.domain), h = record(r.hub), t = record(r.trust), a = record(r.alias), n = record(r.renewal), c = record(r.capabilities), next = record(r.next_action), op = record(r.operation), p = record(r.profile);
    const domain = { id: nullable(d.id, positive), name: hostname(d.name), provider: nullable(d.provider, token), group: d.group === null ? null : { id: positive(record(d.group).id), name: text(record(d.group).name) } };
    if (target && ('domain' in target ? domain.id !== target.domain : domain.group?.id !== target.group || domain.name !== target.name)) invalid();
    const connection = r.connection === null ? null : (() => { const v = record(r.connection); return { id: positive(v.id), mode: choice(v.mode, ['shared', 'allocated'] as const), state: choice(v.state, ['pending', 'verified', 'broken', 'retired']), client_ref: uuid(v.client_ref), allocation_ref: nullable(v.allocation_ref, hostname), participant_ref: nullable(v.participant_ref, uuid), verified_at: nullable(v.verified_at, date) }; })();
    const result: Readiness = {
        version: 1, checked_at: date(r.checked_at), domain,
        profile: { name: choice(p.name, ['apex_wildcard']), names: scope(p.names, domain.name) },
        hub: { state: choice(h.state, ['unconfigured', 'misconfigured', 'unavailable', 'unauthorized', 'unsupported', 'ready']), protocol_version: nullable(h.protocol_version, positive), consumer_project_uuid: nullable(h.consumer_project_uuid, uuid) },
        connection, trust: { state: choice(t.state, ['unknown', 'not_requested', 'missing', 'active', 'revoked', 'identity_changed']), can_publish: bool(t.can_publish), can_withdraw: bool(t.can_withdraw) },
        alias: { state: choice(a.state, ['unknown', 'match', 'mismatch', 'lookup_failed']), source: text(a.source, 270), target: nullable(a.target, hostname), observed_target: nullable(a.observed_target, hostname), one_hop: nullable(a.one_hop, bool), checked_at: nullable(a.checked_at, date) },
        certificate: r.certificate === null ? null : (() => { const v = record(r.certificate); return { id: positive(v.id), state: choice(v.state, ['pending', 'issuing', 'active', 'failed', 'revoked', 'expired', 'unknown']), names: names(v.names), not_after: nullable(v.not_after, date), renew_after: nullable(v.renew_after, date), serving_valid: nullable(v.serving_valid, bool), material_state: choice(v.material_state, ['available', 'missing', 'unavailable']) }; })(),
        renewal: { state: choice(n.state, ['not_requested', 'scheduled', 'queued', 'issuing', 'retrying', 'blocked', 'failed', 'expired', 'unknown']), next_attempt_at: nullable(n.next_attempt_at, date), attempts: integer(n.attempts), error_code: nullable(n.error_code, token), cleanup_pending: bool(n.cleanup_pending), job: n.job === null ? null : { id: text(record(n.job).id, 128), state: choice(record(n.job).state, ['pending', 'running', 'completed', 'failed', 'canceled', 'expired', 'unknown']) }, worker_version: nullable(n.worker_version, (v) => text(v, 64)) },
        capabilities: { group_choices: bool(c.group_choices), can_connect: bool(c.can_connect), can_restart: bool(c.can_restart), can_check: bool(c.can_check), can_request: bool(c.can_request) },
        next_action: { code: choice(next.code, ['configure_hub', 'upgrade_hub', 'repair_hub_access', 'retry_hub', 'choose_allocation', 'prepare_connection', 'grant_trust', 'restart_connection', 'connect', 'repair_alias', 'check', 'request', 'wait_for_job', 'repair_worker', 'restore_custody', 'inspect_failure', 'unsupported_domain_scope', 'none']), actor: choice(next.actor, ['deployment_operator', 'allocation_controller', 'domain_owner', 'project_operator', 'none']) },
        connection_request: r.connection_request === null ? null : parseConnectionRequest(r.connection_request),
        operation: { action: choice(op.action, ['plan', 'connect', 'check', 'request']), outcome: choice(op.outcome, ['observed', 'awaiting_trust', 'connected', 'verified', 'queued', 'already_current', 'already_queued', 'custody_unavailable', 'job_held']), changed: bool(op.changed) },
    };
    if (result.alias.source !== `_acme-challenge.${domain.name}` || (allocation && result.alias.target !== allocation) || (connection?.allocation_ref && result.alias.target !== connection.allocation_ref)) invalid();
    if (result.certificate && [...result.certificate.names].sort().join(',') !== [...result.profile.names].sort().join(',')) invalid();
    if (result.trust.state === 'identity_changed' || result.hub.state !== 'ready' || !result.hub.consumer_project_uuid) result.connection_request = null;
    const descriptor = result.connection_request;
    if (descriptor && (descriptor.domain !== domain.name || descriptor.allocation_ref !== result.alias.target || descriptor.client_ref !== connection?.client_ref || (result.hub.consumer_project_uuid && descriptor.consumer_project_uuid !== result.hub.consumer_project_uuid))) invalid();
    if (!domain.group && (result.next_action.code !== 'unsupported_domain_scope' || Object.values(result.capabilities).some(Boolean) || descriptor)) invalid();
    if (result.capabilities.can_request && (result.hub.state !== 'ready' || !result.hub.consumer_project_uuid || connection?.mode !== 'shared' || connection.state !== 'verified' || result.trust.state !== 'active' || result.alias.state !== 'match' || !result.alias.one_hop)) invalid();
    return result;
}
export function parseHubCapabilities(value: unknown): HubCapabilities {
    const r = record(value); if (r.version !== 2) throw new SharedValidationError('unsupported');
    return { version: 2, shared_validation: bool(r.shared_validation), consumer_project_uuid: nullable(r.consumer_project_uuid, uuid), can_consume: bool(r.can_consume), can_manage_trust: bool(r.can_manage_trust), trust_scope: choice(r.trust_scope, ['apex_and_wildcard']) };
}
export function parseAllocation(value: unknown, domain: string): Allocation {
    const r = record(value); const out = { allocation_ref: hostname(r.allocation_ref), domain: hostname(r.domain), source: text(r.source, 270), target: hostname(r.target), owner_project_uuid: uuid(r.owner_project_uuid), can_manage_trust: bool(r.can_manage_trust) };
    if (out.domain !== domain || out.source !== `_acme-challenge.${domain}` || out.target !== out.allocation_ref) invalid(); return out;
}
export function parseParticipant(value: unknown, allocation: Allocation): Participant {
    const r = record(value); const base = parseAllocation({ ...r, owner_project_uuid: allocation.owner_project_uuid, can_manage_trust: allocation.can_manage_trust }, allocation.domain); const out: Participant = { allocation_ref: base.allocation_ref, domain: base.domain, source: base.source, target: base.target, participant_ref: uuid(r.participant_ref), client_ref: uuid(r.client_ref), role: choice(r.role, ['owner', 'trusted']), trust_state: choice(r.trust_state, ['active', 'revoked']), scope: scope(r.scope, allocation.domain), can_publish: bool(r.can_publish), can_withdraw: bool(r.can_withdraw), revoked_at: nullable(r.revoked_at, date), consumer_project_uuid: uuid(r.consumer_project_uuid), consumer_label: text(r.consumer_label) };
    if (out.allocation_ref !== allocation.allocation_ref || (out.trust_state === 'revoked') !== (out.revoked_at !== null)) invalid(); return out;
}
export function parsePage<T>(value: unknown, parse: (v: unknown) => T): Page<T> { const r = record(value); if (!Array.isArray(r.items) || r.items.length > 20) invalid(); return { items: (r.items as unknown[]).map(parse), next_cursor: nullable(r.next_cursor, (v) => { const s = text(v, 20); return /^[1-9]\d*$/.test(s) ? s : invalid(); }) }; }
export function parseRecipient(value: unknown, expected: string): Recipient { const r = record(value); const out = { consumer_project_uuid: uuid(r.consumer_project_uuid), label: text(r.label), active: bool(r.active) }; if (out.consumer_project_uuid !== expected || !out.active) invalid(); return out; }
export const pendingReadiness = (r: Readiness) => ['queued', 'issuing'].includes(r.renewal.state) || ['pending', 'issuing'].includes(r.certificate?.state ?? '');
