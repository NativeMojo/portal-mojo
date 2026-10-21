import { useCallback, useEffect, useRef, useState } from 'react';
import { type QueryClient } from '@tanstack/react-query';
import { getAuthSessionRevision, getAuthSnapshot, hasPermission, mojoCall, MojoError, useAuthSnapshot, useMe, type Params } from '../../client/runtime';
import { CertificateModel, DNS_MANAGE_PERMISSIONS, DomainModel, type DnsGroupChoice } from './models';
import { dnsKeys } from './api';
import { CERTIFICATE_POLL_INTERVAL_MS, CERTIFICATE_POLL_MAX_TICKS } from './CertificateLifecyclePoller';
import { parseAllocation, parseConnectionRequest, parseHubCapabilities, parsePage, parseParticipant, parseReadiness, parseRecipient, pendingReadiness, positive, record, SharedValidationError, text, type Allocation, type ConnectionRequest, type SetupTarget } from './shared-validation-data';

export const SETUP_GROUP_ENDPOINT = '/api/dnsman/delegation/group-choice';
const expectedCodes = new Set(['trust_missing', 'trust_revoked', 'hub_identity_changed', 'allocation_conflict', 'alias_mismatch', 'alias_lookup_failed', 'connection_not_verified', 'certificate_busy', 'cleanup_pending', 'profile_conflict', 'stale_connection', 'unsupported_domain_scope']);
export interface CallScope { signal?: AbortSignal; beforeSend?: () => void }
async function call(path: string, body: Record<string, unknown> | null, scope: CallScope = {}, params?: Params): Promise<unknown> {
    try { return (await mojoCall(`/api/dnsman/${path}`, { ...(body === null ? { params } : { method: 'POST', body }), ...scope })).data; }
    catch (error) {
        if (error instanceof SharedValidationError) throw error;
        if (scope.signal?.aborted) throw new SharedValidationError('access');
        if (error instanceof MojoError) {
            if (error.status === 440) throw new SharedValidationError('reauth');
            if (error.status === 401 || error.status === 403) throw new SharedValidationError('access');
            if (error.status === 404 || error.status === 405) throw new SharedValidationError('unsupported');
            if (typeof error.errorCode === 'string' && expectedCodes.has(error.errorCode)) {
                let readiness = null; try { readiness = parseReadiness(error.data); } catch { /* Only valid public evidence survives. */ }
                throw new SharedValidationError('prerequisite', readiness, error.errorCode);
            }
        }
        throw new SharedValidationError('unavailable');
    }
}
export const getValidationPlan = async (target: SetupTarget, allocation?: string, scope?: CallScope) => parseReadiness(await call('delegation/plan', null, scope, { ...target, ...(allocation ? { allocation_ref: allocation } : {}) }), target, allocation);
export const connectValidation = async (target: SetupTarget, allocation: string, restart: boolean, scope?: CallScope) => parseReadiness(await call('delegation/connect', { ...target, allocation_ref: allocation, ...(restart ? { restart: true } : {}) }, scope), target, allocation);
export const checkValidation = async (delegation: number, target: SetupTarget, allocation: string, scope?: CallScope) => parseReadiness(await call('delegation/check', { delegation: positive(delegation) }, scope), target, allocation);
export const requestWildcard = async (delegation: number, target: SetupTarget, allocation: string, scope?: CallScope) => parseReadiness(await call('delegation/request', { delegation: positive(delegation) }, scope), target, allocation);
export const getHubCapabilities = async (scope?: CallScope) => parseHubCapabilities(await call('acme/capabilities', {}, scope));
export const getAllocations = async (domain: string, cursor?: string, scope?: CallScope) => parsePage(await call('acme/allocation/list', { domain, ...(cursor ? { cursor } : {}) }, scope), (r) => parseAllocation(r, domain));
export const getParticipants = async (allocation: Allocation, cursor?: string, scope?: CallScope) => parsePage(await call('acme/trust/list', { allocation_ref: allocation.allocation_ref, ...(cursor ? { cursor } : {}) }, scope), (r) => parseParticipant(r, allocation));
export const getRecipient = async (allocation: Allocation, consumer: string, scope?: CallScope) => parseRecipient(await call('acme/trust/recipient', { allocation_ref: allocation.allocation_ref, consumer_project_uuid: consumer }, scope), consumer);
export const grantValidation = async (allocation: Allocation, descriptor: ConnectionRequest, scope?: CallScope) => {
    const result = parseParticipant(await call('acme/trust/grant', { connection_request: parseConnectionRequest(descriptor) }, scope), allocation);
    if (result.client_ref !== descriptor.client_ref || result.consumer_project_uuid !== descriptor.consumer_project_uuid || result.role !== 'trusted' || result.trust_state !== 'active') throw new SharedValidationError('invalid');
    return result;
};
export const revokeValidation = async (allocation: Allocation, participant: string, scope?: CallScope) => {
    const result = parseParticipant(await call('acme/trust/revoke', { allocation_ref: allocation.allocation_ref, participant_ref: participant }, scope), allocation);
    if (result.participant_ref !== participant || result.trust_state !== 'revoked') throw new SharedValidationError('invalid'); return result;
};
/** CollectionSelect hydration must use ?id, never invent /<id>. */
export const sanitizeSetupGroup = (v: unknown): DnsGroupChoice => ({ id: positive(record(v).id), name: text(record(v).name) });
export async function getSetupGroup(id: number, scope?: CallScope) {
    const value = await call('delegation/group-choice', null, scope, { id: positive(id) });
    if (!Array.isArray(value) || value.length !== 1) throw new SharedValidationError('access');
    const group = sanitizeSetupGroup(value[0]); if (group.id !== id) throw new SharedValidationError('invalid'); return group;
}
export async function invalidateValidation(qc: QueryClient) {
    await Promise.all([DomainModel.invalidate(qc), CertificateModel.invalidate(qc), qc.invalidateQueries({ queryKey: dnsKeys.root })]);
}
export function useValidationPlan(target: SetupTarget | null, allocation?: string, enabled = true, intervalMs = CERTIFICATE_POLL_INTERVAL_MS, maxTicks = CERTIFICATE_POLL_MAX_TICKS) {
    const auth = useAuthSnapshot(); const { data: me } = useMe();
    const revision = getAuthSessionRevision();
    const key = JSON.stringify([target, allocation ?? '', auth.uid, revision, hasPermission(me ?? null, DNS_MANAGE_PERMISSIONS, null)]);
    const current = useRef(key); current.current = key;
    const generation = useRef(0);
    const [state, setState] = useState<{ key: string; data: Awaited<ReturnType<typeof getValidationPlan>> | null; error: SharedValidationError | null; loading: boolean }>({ key, data: null, error: null, loading: false });
    const controller = useRef<AbortController | null>(null);
    const refresh = useCallback(async () => {
        if (!target || !enabled || !auth.authenticated) return null;
        const run = ++generation.current; controller.current?.abort();
        const abort = new AbortController(); controller.current = abort;
        const valid = () => current.current === key && generation.current === run && !abort.signal.aborted && getAuthSnapshot().uid === auth.uid && getAuthSessionRevision() === revision;
        setState((s) => ({ key, data: s.key === key ? s.data : null, error: null, loading: true }));
        try {
            const data = await getValidationPlan(target, allocation, { signal: abort.signal, beforeSend: () => { if (!valid()) throw new SharedValidationError('access'); } });
            if (!valid()) return null;
            setState({ key, data, error: null, loading: false }); return data;
        } catch (error) {
            if (valid()) setState((s) => ({ key, data: s.key === key ? s.data : null, error: error instanceof SharedValidationError ? error : new SharedValidationError('unavailable'), loading: false }));
            return null;
        }
    // key owns target/allocation/permission/auth identity and is deliberately the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, enabled, auth.authenticated]);
    useEffect(() => { void refresh(); return () => { generation.current++; controller.current?.abort(); }; }, [refresh]);
    const ticks = useRef(0);
    useEffect(() => { ticks.current = 0; }, [key]);
    useEffect(() => {
        if (!enabled || !auth.authenticated || state.key !== key || state.loading || state.error || !state.data || !pendingReadiness(state.data) || ticks.current >= maxTicks) return;
        const timer = setTimeout(() => { ticks.current++; void refresh(); }, intervalMs);
        return () => clearTimeout(timer);
    }, [enabled, auth.authenticated, key, state, intervalMs, maxTicks, refresh]);
    return { data: state.key === key && auth.authenticated ? state.data : null, error: state.key === key ? state.error : null, loading: state.key !== key || state.loading, refresh, timedOut: ticks.current >= maxTicks };
}
