/** Installation + actor receipt registry deliberately outlives every page/dialog. */
import { apiOrigin } from '../../client/client';
import { getAuthSnapshot } from '../../client/runtime';
import {
    applyMaintenance,
    updateFramework,
    readMaintenanceStatus,
    MaintenanceError,
    type ApplyInput,
    type ResourceStatus,
    type Scope,
} from './data';
export type AttemptState =
    | 'sending'
    | 'waiting'
    | 'uncertain'
    | 'refused'
    | 'complete'
    | 'accepted'
    | 'timeout';
export interface MaintenanceAttempt {
    key: string;
    actor: string;
    input: Readonly<ApplyInput> | { version: string };
    state: AttemptState;
    message: string;
    observations: number;
    observation?: ResourceStatus;
    deployment?: { id: string; sha: string; status: string };
    generation: number;
}
const attempts = new Map<string, MaintenanceAttempt>();
const listeners = new Set<() => void>();
let revision = 0;
const changed = () => {
    revision++;
    for (const cb of listeners) cb();
};
export const subscribeMaintenanceAttempts = (cb: () => void) => {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
};
export const maintenanceAttemptsRevision = () => revision;
export const maintenanceActor = () => `${apiOrigin()}|${getAuthSnapshot().uid ?? 'anonymous'}`;
export const resourceKey = (input: Pick<ApplyInput, 'kind' | 'resource'>) =>
    `${input.kind}:${input.resource}`;
const scopedKey = (key: string, actor = maintenanceActor()) => `${actor}|${key}`;
export const getMaintenanceAttempts = () =>
    [...attempts.values()].filter((a) => a.actor === maintenanceActor());
export const getMaintenanceAttempt = (key: string) => attempts.get(scopedKey(key));
export const maintenanceCompleted = (r: ResourceStatus) =>
    r.found === true && r.settled === true && r.upgraded === true;
function claim(key: string, input: MaintenanceAttempt['input']): MaintenanceAttempt {
    const id = scopedKey(key);
    if (attempts.has(id)) throw new MaintenanceError('attempt_requires_reconciliation');
    const attempt: MaintenanceAttempt = {
        key,
        actor: maintenanceActor(),
        input: Object.freeze({ ...input }),
        state: 'sending',
        message: 'Requesting operation…',
        observations: 0,
        generation: 0,
    };
    attempts.set(id, attempt);
    changed();
    return attempt;
}
function failed(a: MaintenanceAttempt, e: unknown) {
    a.state = e instanceof MaintenanceError && e.mutationState === 'none' ? 'refused' : 'uncertain';
    a.message =
        e instanceof MaintenanceError
            ? e.message
            : 'The response is unknown. Reconcile provider operations before another request.';
    changed();
}
export async function requestMaintenance(input: ApplyInput, scope?: Scope) {
    const a = claim(resourceKey(input), input);
    try {
        await applyMaintenance(input, scope);
        a.state = 'waiting';
        a.message = 'Requested — waiting for AWS evidence.';
        changed();
        return a;
    } catch (e) {
        failed(a, e);
        throw e;
    }
}
export async function requestFramework(version: string, scope?: Scope) {
    const a = claim('framework', { version });
    try {
        const result = await updateFramework(version, scope);
        a.state = 'accepted';
        a.deployment = result.deployment;
        a.message =
            'Deployment requested. Follow its node evidence in Deployments; fleet completion is unconfirmed.';
        changed();
        return a;
    } catch (e) {
        failed(a, e);
        if (a.state === 'uncertain')
            a.message =
                'The pin may already be cleared while deployment acceptance is unknown. Refresh Framework and reconcile Deployments before any further update.';
        changed();
        throw e;
    }
}
/** Only a proven pre-provider refusal is releasable by explicit successful refresh. */
export function refreshRefusedMaintenanceAttempt(key: string) {
    const a = getMaintenanceAttempt(key);
    if (a?.state === 'refused') {
        attempts.delete(scopedKey(key));
        changed();
    }
}
export async function observeMaintenance(a: MaintenanceAttempt, scope: Scope = {}) {
    if (!('kind' in a.input) || a.state === 'complete' || a.state === 'sending' || a.state === 'refused')
        return;
    const generation = ++a.generation;
    const actor = maintenanceActor();
    try {
        const result = await readMaintenanceStatus(a.input, scope);
        scope.beforeSend?.();
        if (
            scope.signal?.aborted ||
            actor !== maintenanceActor() ||
            a.actor !== actor ||
            generation !== a.generation
        )
            return;
        a.observation = result;
        a.observations++;
        a.state = maintenanceCompleted(result)
            ? 'complete'
            : a.state === 'uncertain'
              ? 'uncertain'
              : 'waiting';
        a.message =
            a.state === 'complete'
                ? `Upgraded to ${a.input.target_version}; AWS reports every member settled.`
                : `${result.status ?? 'Status unknown'} — waiting/unconfirmed. A version or available state alone does not prove completion.`;
        changed();
    } catch (e) {
        if (scope.signal?.aborted || actor !== maintenanceActor() || generation !== a.generation) return;
        a.observations++;
        a.message =
            e instanceof MaintenanceError
                ? e.message
                : 'Status unavailable; the original request remains guarded.';
        changed();
    }
}
export function maintenanceObservationLimit(a: MaintenanceAttempt) {
    if (a.state === 'waiting' || a.state === 'uncertain') {
        a.state = 'timeout';
        a.message =
            'Automatic observations reached their limit. The attempt remains guarded. Refresh status or reconcile the provider operation and maintenance window.';
        changed();
    }
}
