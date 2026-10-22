import { apiOrigin, getAuthSessionRevision, getAuthSnapshot, isReauthRequired, MojoError, requestFreshAuth } from '../../client/runtime';
import { applyCapacityPlan, readCapacityBatch } from './api';
import type { CapacityBatch, CapacityPlan } from './types';

export interface FleetOperationState {
    status: 'idle' | 'submitting' | 'running' | 'unknown' | 'done' | 'failed';
    planId: string | null;
    batchId: string | null;
    batch: CapacityBatch | null;
    message: string;
    since: number;
}
interface OperationRecord {
    value: FleetOperationState;
    listeners: Set<() => void>;
    busy: boolean;
    reading: boolean;
    deadline: number;
    actor: number | null;
    timerScope: string | null;
    timer: ReturnType<typeof setTimeout> | null;
}
export function fleetSessionScope(): string | null {
    const auth = getAuthSnapshot();
    return auth.authenticated && auth.uid ? `${auth.uid}:${getAuthSessionRevision()}` : null;
}
export function batchOutcome(batch: CapacityBatch): 'running' | 'unknown' | 'done' | 'failed' {
    const uncertain = (code: string | null) => code === 'mutation_state_unknown' || code === 'operation_failed';
    if (uncertain(batch.error_code) || batch.steps.some(step => uncertain(step.error_code))) return 'unknown';
    if (batch.state === 'done' && !batch.error_code && batch.steps.every(step => step.state === 'done' && !step.error_code)) return 'done';
    if (batch.state === 'failed') return 'failed';
    return batch.state === 'running' ? 'running' : 'unknown';
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Capacity outcome could not be confirmed.';

/** Safe unresolved IDs survive same-actor reauthentication; exact sessions fence every send/reply.
 * Lives outside dialog/route components. Stores no credentials and never replays a mutation. */
export function createFleetOperationCoordinator(deps: {
    apply?: typeof applyCapacityPlan;
    read?: typeof readCapacityBatch;
    scope?: () => string | null;
    now?: () => number;
    interval?: number;
} = {}) {
    const apply = deps.apply ?? applyCapacityPlan;
    const read = deps.read ?? readCapacityBatch;
    const current = deps.scope ?? fleetSessionScope;
    const now = deps.now ?? Date.now;
    const records = new Map<string, OperationRecord>();
    function record(scope: string): OperationRecord {
        const actorKey = scope.slice(0, scope.lastIndexOf(':'));
        const key = `${apiOrigin() || 'same-origin'}:${actorKey}`;
        let entry = records.get(key);
        if (!entry) {
            entry = {
                value: { status: 'idle', planId: null, batchId: null, batch: null, message: '', since: 0 },
                listeners: new Set(), busy: false, reading: false, deadline: 0, actor: null, timerScope: null, timer: null,
            };
            records.set(key, entry);
        }
        return entry;
    }
    function update(scope: string, patch: Partial<FleetOperationState>): void {
        const entry = record(scope);
        entry.value = { ...entry.value, ...patch };
        entry.listeners.forEach(listener => listener());
    }
    function active(scope: string): void {
        if (current() !== scope) throw new Error('The signed-in session changed. Review again.');
    }
    function schedule(scope: string): void {
        const entry = record(scope);
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.value.status !== 'running') return;
        entry.timerScope = scope;
        entry.timer = setTimeout(() => {
            entry.timer = null;
            if (current() !== scope) return;
            if (now() > entry.deadline) {
                update(scope, { status: 'unknown', message: 'Automatic observation reached its budget. Progress is unknown; refresh this exact batch, never replay it.' });
                return;
            }
            void observe(scope);
        }, deps.interval ?? 10_000);
    }
    function accept(scope: string, batch: CapacityBatch): void {
        const entry = record(scope);
        if (batch.actor !== entry.actor || batch.plan_id !== entry.value.planId || entry.value.batchId && batch.id !== entry.value.batchId) {
            throw new Error('Batch identity does not match the submitted plan.');
        }
        const status = batchOutcome(batch);
        update(scope, { batchId: batch.id, batch, status, message: batch.stalled
            ? 'Progress stalled. Check the jobs runner and cleanup channel, then refresh observation.' : batch.message ?? status });
        schedule(scope);
    }
    async function observe(scope: string, batchId?: string): Promise<void> {
        const entry = record(scope);
        if (entry.reading || entry.busy) return;
        const id = batchId?.trim() || entry.value.batchId;
        if (!id || !entry.value.planId) return;
        entry.reading = true;
        try {
            active(scope);
            const batch = await read(id, { beforeSend: () => active(scope) });
            active(scope);
            accept(scope, batch);
        } catch (error) {
            if (current() === scope) update(scope, { status: 'unknown', message: `Observation unavailable: ${errorMessage(error)}. Keep the plan and batch IDs; no new change is safe yet.` });
        } finally {
            entry.reading = false;
        }
    }
    return {
        get: (scope: string) => record(scope).value,
        subscribe(scope: string, listener: () => void) {
            const entry = record(scope);
            entry.listeners.add(listener);
            // Resubscriptions on render must not keep postponing the next observation.
            if (current() === scope && entry.value.status === 'running' && (!entry.timer || entry.timerScope !== scope)) schedule(scope);
            return () => entry.listeners.delete(listener);
        },
        blocked: (scope: string) => ['submitting', 'running', 'unknown'].includes(record(scope).value.status),
        observe,
        async submit(scope: string, plan: CapacityPlan): Promise<void> {
            const entry = record(scope);
            if (entry.busy || ['submitting', 'running', 'unknown'].includes(entry.value.status)) return;
            active(scope);
            if (Date.parse(plan.expires_at) <= now()) throw new Error('This plan expired. Review a new plan.');
            entry.busy = true;
            entry.actor = plan.actor;
            entry.deadline = now() + Math.max(1, plan.steps.length) * 90 * 60_000;
            update(scope, { status: 'submitting', planId: plan.id, batchId: null, batch: null, message: 'Submitting the reviewed stored plan…', since: now() });
            try {
                const batch = await apply(plan.id, { beforeSend: () => {
                    active(scope);
                    if (Date.parse(plan.expires_at) <= now()) throw new Error('Plan expired before submission.');
                } });
                if (current() !== scope) {
                    update(scope, { batchId: batch.id, status: 'unknown', message: 'The session changed during submission. Its batch ID is retained for reconciliation; observe it deliberately from your current session.' });
                    return;
                }
                accept(scope, batch);
            } catch (error) {
                const duplicate = error instanceof MojoError && error.errorCode === 'plan_already_applied';
                const duplicateBatch = duplicate && error.data && typeof error.data === 'object'
                    ? (error.data as { batch?: unknown }).batch : null;
                if (typeof duplicateBatch === 'string' && duplicateBatch.trim()) {
                    update(scope, { batchId: duplicateBatch, status: 'running', message: 'Already submitted. Observing the existing batch.' });
                    schedule(scope);
                } else if (isReauthRequired(error)) {
                    update(scope, { status: 'idle', message: 'Authenticate again, refresh the fleet, and deliberately review a new plan.' });
                    await requestFreshAuth();
                    throw error;
                } else if (!duplicate && error instanceof MojoError && [400, 401, 403, 404, 405, 409, 422].includes(error.status)) {
                    update(scope, { status: 'idle', message: errorMessage(error) });
                    throw error;
                } else {
                    update(scope, { status: 'unknown', message: `Apply outcome unknown: ${errorMessage(error)}. Inspect server capacity logs for plan ${plan.id}; enter its batch ID below. Inventory refresh or closing this dialog cannot resolve an unacknowledged submission. Do not replay it.` });
                }
            } finally {
                entry.busy = false;
            }
        },
        dispose() {
            records.forEach(entry => { if (entry.timer) clearTimeout(entry.timer); });
        },
    };
}
export const fleetOperations = createFleetOperationCoordinator();
