/** Private operator boundary. Credential-bearing requests never use Query/Mutation or replay. */
import { useEffect, useRef } from 'react';
import { apiOrigin, usingMockTransport } from '../../client/client';
import { getAuthSessionRevision, getAuthSnapshot, mojoCall, MojoError, useAuthSnapshot, useMe, type Params } from '../../client/runtime';
import { FLEET_ENDPOINT, FLEET_HEALTH_SCOPE } from './data';

export const CONNECTION_ENDPOINT = `${FLEET_ENDPOINT}/shared-validation`;
export { MANAGED_CONNECTION_KEYS, isManagedConnectionKey } from './data';
export interface PrivateScope { signal?: AbortSignal; beforeSend?: () => void }
export class OperatorError extends Error {
    constructor(public kind: 'invalid' | 'recipient' | 'unsupported' | 'denied' | 'fresh' | 'conflict' | 'busy' | 'unavailable' | 'uncertain', public code: string | null = null) {
        super({ recipient: 'The original hub recipient Group is unavailable or inactive. Resolve the current Group before continuing.', invalid: 'The operator service returned an incompatible response. Refresh before continuing.', unsupported: 'This backend does not support shared-validation configuration. Existing settings remain available.', denied: 'This action requires a current interactive deployment operator.', fresh: 'Authenticate again, Refresh and deliberately repeat the action. Nothing is replayed.', conflict: 'The profile, recipient or publication changed. Refresh and review again before continuing.', busy: 'Configuration is busy. Refresh and deliberately retry after the other operation finishes.', unavailable: 'The operator service is unavailable. Refresh to check its current prerequisites.', uncertain: 'The operation may have persisted. Refresh authoritative status or key inventory before another attempt.' }[kind]);
    }
}
const invalid = (): never => { throw new OperatorError('invalid'); };
export const object = (v: unknown): Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
export const label = (v: unknown, max = 200): string => typeof v === 'string' && v.length <= max && !/[\x00-\x1f\x7f]/.test(v) ? v : invalid();
export const flag = (v: unknown): boolean => typeof v === 'boolean' ? v : invalid();
export const nullable = <T>(v: unknown, parse: (x: unknown) => T): T | null => v === null ? null : parse(v);
export const choice = <T extends string>(v: unknown, values: readonly T[]): T => values.includes(v as T) ? v as T : invalid();
export const uuid = (v: unknown): string => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v) ? v : invalid();
const profileId = (v: unknown): string => typeof v === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(v) ? v : invalid();
export const token = (v: unknown): string => typeof v === 'string' && /^[a-z0-9_.-]{1,80}$/.test(v) ? v : invalid();
const catalog = (v: unknown): string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : invalid();
export const timestamp = (v: unknown): string => { const s = label(v, 40); return /^\d{4}-\d\d-\d\dT/.test(s) && Number.isFinite(Date.parse(s)) ? s : invalid(); };
export const positive = (v: unknown): number => Number.isSafeInteger(v) && Number(v) > 0 ? Number(v) : invalid();
const bounded = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : invalid();
function origin(v: unknown): string { const s = label(v, 512); try { const u = new URL(s); return !u.username && !u.password && u.origin === s && (u.protocol === 'https:' || u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) ? s : invalid(); } catch { return invalid(); } }
export interface Identity { consumer_project_uuid: string; consumer_label: string }
export interface HubProfile extends Identity { id: string; label: string; origin: string }
export interface Observation { state: 'disabled' | 'verified' | 'unavailable'; profile_id: string | null; observed_project_uuid: string | null; checked_at: string | null; error_code: string | null; sharing_ready: boolean }
export interface ConnectionNode { hostname: string; revision: string; published: boolean; installed: boolean; restart_requested: boolean; restarted: boolean; healthy: boolean; status: string; error_code: string | null; shared_validation: Observation | null }
export interface ConnectionReport { status: string; nodes: ConnectionNode[]; healthy_everywhere: boolean; health_scope?: string; observed_at?: string; error_code?: string }
export interface ConnectionState { schema_version: 1; available: boolean; unavailable_reasons: string[]; catalog_revision: string | null; profiles: HubProfile[]; selected_profile_id: string | null; expected_identity: Identity | null; loaded_identity: Observation | null; credential: { configured: boolean; source: 'published' | 'static' | 'none' | 'unknown'; overridden: boolean }; revision: string | null; loaded_revision: string | null; pending_restart: boolean; fleet: ConnectionReport }
export interface ConnectionInput { expected_revision: string | null; expected_catalog_revision: string; profile_id: string; key_action: 'keep' | 'replace' | 'clear'; replacement_key?: string }
export interface Preview { can_publish: boolean; revision: string | null; catalog_revision: string; profile_id: string | null; expected_identity: Identity | null; identity: Observation; credential_changed: boolean; consequences: string[] }
export interface Publication { published: true; revision: string; version_id: string | null; pending_restart: true; applied: false }
export interface ConnectionOperation extends ConnectionReport { operation_id: string; revision: string; job_status?: string }
export interface SafeHistory { versions: { version_id: string; current: boolean; published_at: string | null }[]; truncated: boolean }
const identity = (v: unknown): Identity => { const r = object(v); return { consumer_project_uuid: uuid(r.consumer_project_uuid), consumer_label: label(r.consumer_label) }; };
export function parseObservation(v: unknown): Observation {
    const r = object(v); const out: Observation = { state: choice(r.state, ['disabled', 'verified', 'unavailable']), profile_id: r.profile_id == null ? null : profileId(r.profile_id), observed_project_uuid: nullable(r.observed_project_uuid, uuid), checked_at: r.checked_at == null ? null : timestamp(r.checked_at), error_code: r.error_code == null ? null : token(r.error_code), sharing_ready: flag(r.sharing_ready) };
    if (out.state === 'verified' && (!out.observed_project_uuid || !out.checked_at || out.error_code) || out.state === 'disabled' && (out.observed_project_uuid || out.sharing_ready)) invalid();
    return out;
}
export function parseReport(v: unknown): ConnectionReport {
    const r = object(v); const nodes = bounded(r.nodes, 128).map((value): ConnectionNode => {
        const n = object(value), hostname = label(n.hostname, 253); if (!/^[a-z0-9][a-z0-9_.-]*$/.test(hostname)) invalid();
        return { hostname, revision: uuid(n.revision), published: flag(n.published), installed: flag(n.installed), restart_requested: flag(n.restart_requested), restarted: flag(n.restarted), healthy: flag(n.healthy), status: token(n.status), error_code: n.error_code == null ? null : token(n.error_code), shared_validation: n.shared_validation == null ? null : parseObservation(n.shared_validation) };
    });
    if (new Set(nodes.map((n) => n.hostname)).size !== nodes.length) invalid();
    return { status: token(r.status), nodes, healthy_everywhere: flag(r.healthy_everywhere), health_scope: r.health_scope == null ? undefined : token(r.health_scope), observed_at: r.observed_at == null ? undefined : timestamp(r.observed_at), error_code: r.error_code == null ? undefined : token(r.error_code) };
}
export function parseConnectionState(v: unknown): ConnectionState {
    const r = object(v); if (r.schema_version !== 1) throw new OperatorError('unsupported');
    const c = object(r.credential), destination = object(r.setup_destination);
    if (destination.route !== 'setup' || destination.section !== 'aws' || destination.capacity_route !== 'capacity' || destination.actor !== 'deployment_operator' || destination.adoption_item !== 8903) invalid();
    const profiles = bounded(r.profiles, 64).map((value) => { const p = object(value); return { id: profileId(p.id), label: label(p.label), origin: origin(p.origin), ...identity(p) }; });
    if (new Set(profiles.map((p) => p.id)).size !== profiles.length) invalid();
    const out: ConnectionState = { schema_version: 1, available: flag(r.available), unavailable_reasons: bounded(r.unavailable_reasons, 20).map(token), catalog_revision: nullable(r.catalog_revision, catalog), profiles, selected_profile_id: nullable(r.selected_profile_id, profileId), expected_identity: nullable(r.expected_identity, identity), loaded_identity: nullable(r.loaded_identity, parseObservation), credential: { configured: flag(c.configured), source: choice(c.source, ['published', 'static', 'none', 'unknown']), overridden: flag(c.overridden) }, revision: nullable(r.revision, uuid), loaded_revision: nullable(r.loaded_revision, uuid), pending_restart: flag(r.pending_restart), fleet: parseReport(r.fleet) };
    const selected = profiles.find((p) => p.id === out.selected_profile_id);
    if (out.selected_profile_id && (!selected || selected.consumer_project_uuid !== out.expected_identity?.consumer_project_uuid) || out.available && (!out.catalog_revision || !profiles.length || out.unavailable_reasons.length)) invalid();
    return out;
}
export function validateInput(v: ConnectionInput): void {
    nullable(v.expected_revision, uuid); catalog(v.expected_catalog_revision); profileId(v.profile_id); choice(v.key_action, ['keep', 'replace', 'clear']);
    if (Object.keys(v).some((k) => !['expected_revision', 'expected_catalog_revision', 'profile_id', 'key_action', 'replacement_key'].includes(k)) || v.replacement_key !== undefined && (v.key_action !== 'replace' || typeof v.replacement_key !== 'string' || v.replacement_key.length > 4096 || /\s/.test(v.replacement_key))) invalid();
}
export function parsePreview(v: unknown, input: ConnectionInput, expected: Identity | null): Preview {
    const r = object(v); const out: Preview = { can_publish: flag(r.can_publish), revision: nullable(r.revision, uuid), catalog_revision: catalog(r.catalog_revision), profile_id: nullable(r.profile_id, profileId), expected_identity: nullable(r.expected_identity, identity), identity: parseObservation(r.identity), credential_changed: flag(r.credential_changed), consequences: bounded(r.consequences, 8).map((c) => choice(c, ['connection_disabled', 'restart_required', 'apply_and_verify_every_expected_node', 'old_key_retirement_is_separate'])) };
    if (out.revision !== input.expected_revision || out.catalog_revision !== input.expected_catalog_revision || (input.key_action === 'clear' ? out.profile_id !== null || out.identity.state !== 'disabled' : out.profile_id !== input.profile_id || out.expected_identity?.consumer_project_uuid !== expected?.consumer_project_uuid || out.identity.state !== 'verified' || out.identity.observed_project_uuid !== expected?.consumer_project_uuid)) invalid();
    return out;
}
export function nodeVerified(n: ConnectionNode, report: ConnectionReport, revision: string | null, profile: HubProfile | undefined): boolean {
    return report.health_scope === FLEET_HEALTH_SCOPE && !!revision && n.revision === revision && n.published && n.installed && n.restarted && n.healthy && !n.error_code && !!profile && n.shared_validation?.state === 'verified' && n.shared_validation.profile_id === profile.id && n.shared_validation.observed_project_uuid === profile.consumer_project_uuid;
}
export const connectionVerified = (s: ConnectionState, r = s.fleet) => r.healthy_everywhere && r.nodes.length > 0 && r.nodes.every((n) => nodeVerified(n, r, s.revision, s.profiles.find((p) => p.id === s.selected_profile_id)));
export function operatorOrigin(): void { if (!usingMockTransport() && new URL(apiOrigin(), window.location.origin).origin !== window.location.origin) throw new OperatorError('denied'); }
export async function privateCall(path: string, body: Record<string, unknown> | null, scope: PrivateScope = {}, params?: Params): Promise<unknown> {
    try {
        if (body) operatorOrigin();
        return (await mojoCall(path, { ...(body ? { method: 'POST', body } : { params }), signal: scope.signal, beforeSend: () => { if (body) operatorOrigin(); scope.beforeSend?.(); } })).data;
    } catch (e) {
        if (e instanceof OperatorError) throw e;
        if (scope.signal?.aborted) throw new OperatorError('denied');
        if (e instanceof MojoError) {
            if (e.status === 440) throw new OperatorError('fresh');
            if ([401, 403].includes(e.status)) throw new OperatorError('denied');
            if (e.status === 404 && e.errorCode === 'recipient_unavailable') throw new OperatorError('recipient');
            if ([404, 405].includes(e.status)) throw new OperatorError('unsupported');
            if (e.errorCode === 'configuration_busy') throw new OperatorError('busy', 'configuration_busy');
            if (e.errorCode === 'publication_uncertain') throw new OperatorError('uncertain');
            if (e.status === 409) throw new OperatorError('conflict');
            if (e.status === 400) throw new OperatorError('invalid');
            if (e.status === 503) throw new OperatorError('unavailable');
        }
        throw new OperatorError(body ? 'uncertain' : 'unavailable');
    }
}
export const readConnection = async (scope?: PrivateScope) => parseConnectionState(await privateCall(CONNECTION_ENDPOINT, null, scope));
export const previewConnection = async (input: ConnectionInput, expected: Identity | null, scope?: PrivateScope) => { validateInput(input); return parsePreview(await privateCall(CONNECTION_ENDPOINT, { action: 'preview', ...input }, scope), input, expected); };
export async function publishConnection(input: ConnectionInput, scope?: PrivateScope): Promise<Publication> {
    validateInput(input); const r = object(await privateCall(CONNECTION_ENDPOINT, { action: 'publish', ...input }, scope));
    if (r.published !== true || r.applied !== false || r.pending_restart !== true) invalid();
    return { published: true, revision: uuid(r.revision), version_id: nullable(r.version_id, (v) => label(v, 1024)), pending_restart: true, applied: false };
}
export function parseOperation(v: unknown): ConnectionOperation { const r = object(v); return { ...parseReport(r), operation_id: label(r.operation_id, 128), revision: uuid(r.revision), job_status: r.job_status == null ? undefined : token(r.job_status) }; }
export const applyConnection = async (revision: string, scope?: PrivateScope) => parseOperation(await privateCall(FLEET_ENDPOINT, { action: 'apply', expected_revision: uuid(revision) }, scope));
export const readConnectionOperation = async (id: string, scope?: PrivateScope) => parseOperation(await privateCall(`${FLEET_ENDPOINT}/operation/${encodeURIComponent(label(id, 128))}`, null, scope));
export async function readConnectionHistory(scope?: PrivateScope): Promise<SafeHistory> { const r = object(await privateCall(`${FLEET_ENDPOINT}/history`, null, scope)); return { versions: bounded(r.versions, 100).map((v) => { const row = object(v); return { version_id: label(row.version_id, 1024), current: flag(row.current), published_at: nullable(row.published_at, timestamp) }; }), truncated: flag(r.truncated) }; }

/** Local owner fence shared only by the two private operator forms. */
export function usePrivateOperator() {
    const auth = useAuthSnapshot(), { data: me } = useMe(); const revision = getAuthSessionRevision();
    const allowed = auth.authenticated && me?.is_superuser === true;
    const key = `${auth.uid}:${revision}:${allowed}`; const latest = useRef(key); latest.current = key;
    const owner = useRef(new AbortController());
    useEffect(() => { const current = new AbortController(); owner.current = current; return () => current.abort(); }, [key]);
    const fence = (): PrivateScope & { beforeSend: () => void } => { const current = owner.current; return { signal: current.signal, beforeSend: () => { if (!allowed || current.signal.aborted || latest.current !== key || getAuthSnapshot().uid !== auth.uid || getAuthSessionRevision() !== revision) throw new OperatorError('denied'); } }; };
    return { allowed, key, fence };
}
