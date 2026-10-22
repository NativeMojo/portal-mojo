/** Installation + actor receipt registry deliberately outlives every page/dialog. */
import { apiOrigin } from '../../client/client';
import { getAuthSnapshot } from '../../client/runtime';
import {
    applyMaintenance,
    updateFramework,
    readMaintenanceStatus,
    readFrameworkDeployment, saveFrameworkPolicy, policyMatches, normalizePolicy,
    MaintenanceError,
    type ApplyInput,
    type ResourceStatus,
    type Scope,
    type Framework, type FrameworkObservation,
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
    input: Readonly<ApplyInput> | { version: string } | { policy: string };
    state: AttemptState;
    message: string;
    observations: number;
    observation?: ResourceStatus;
    deployment?: { id: string; sha: string; status: string };
    generation: number;
    observedAt?: number;
    frameworkObservation?: FrameworkObservation;
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
    if (!canRequestMaintenance(key, input)) throw new MaintenanceError('attempt_requires_reconciliation');
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
export function canRequestMaintenance(key: string, input?: MaintenanceAttempt['input']) {
    const a = getMaintenanceAttempt(key);
    if ((key === 'framework' || key === 'framework-policy') && getMaintenanceAttempts().some(x => (x.key === 'framework' || x.key === 'framework-policy') && x.key !== key && !['complete','refused'].includes(x.state))) return false;
    if (!a) return true;
    if (a.state !== 'complete') return false;
    if (!input) return true;
    return 'kind' in a.input && 'kind' in input ? a.input.target_version !== input.target_version : 'version' in a.input && 'version' in input ? a.input.version !== input.version : 'policy' in a.input && 'policy' in input && a.input.policy !== input.policy;
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
export async function requestPolicy(policy: string, scope?: Scope) {
    policy = normalizePolicy(policy);
    const a = claim('framework-policy', { policy });
    try { await saveFrameworkPolicy(policy, scope); a.state = 'waiting'; a.message = 'Policy saved. Reading back current policy; no deployment requested.'; changed(); return a; }
    catch (error) { failed(a, error); throw error; }
}
export function reconcilePolicy(f: Framework) {
    const a = getMaintenanceAttempt('framework-policy');
    if (!a || !('policy' in a.input) || a.state === 'sending' || a.state === 'refused' || a.state === 'complete') return;
    a.observedAt = Date.now();
    if (policyMatches(f.pin, a.input.policy)) {
        if (a.state === 'uncertain' || a.state === 'timeout') a.message = 'Requested policy is now observed, but the original save outcome remains unknown. Readback cannot prove that request finished. Reconcile the server audit before any further policy write.';
        else { a.state = 'complete'; a.message = 'Saved policy is now observed. No deployment was requested; node activation is separate.'; }
    }
    else a.message = 'Current policy differs from the submitted choice. Its outcome is unresolved; refresh and reconcile before another write.';
    changed();
}
export async function observeFramework(a: MaintenanceAttempt, scope: Scope = {}) {
    if (!('version' in a.input) || !a.deployment || ['sending','refused','complete'].includes(a.state)) return;
    const generation = ++a.generation, actor = maintenanceActor();
    try {
        const result = await readFrameworkDeployment(a.deployment, a.input.version, scope); scope.beforeSend?.();
        if (scope.signal?.aborted || actor !== maintenanceActor() || a.actor !== actor || generation !== a.generation) return;
        a.frameworkObservation = result; a.observedAt = Date.now(); a.observations++;
        a.state = result.terminal ? 'complete' : 'accepted';
        a.message = `Deployment ${result.status}. ${result.versionProven ? 'Requested framework version observed on every deployment target.' : 'Requested framework version remains unverified.'}`;
        changed();
    } catch (error) {
        if (scope.signal?.aborted || actor !== maintenanceActor() || generation !== a.generation) return;
        a.observations++; a.message = error instanceof MaintenanceError ? error.message : 'Deployment evidence unavailable; the original update remains guarded.'; changed();
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
        a.observedAt = Date.now();
        a.observations++;
        a.state = maintenanceCompleted(result)
            ? 'complete'
            : a.state === 'uncertain'
              ? 'uncertain'
              : 'waiting';
        a.message =
            a.state === 'complete'
                ? `Upgraded to ${a.input.target_version}; AWS reports ${a.input.kind === 'rds-cluster' ? 'the cluster' : 'every member'} settled.`
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
    if (a.state === 'waiting' || a.state === 'uncertain' || a.state === 'accepted') {
        a.state = 'timeout';
        a.message =
            'Automatic observations reached their limit. The attempt remains guarded. Refresh status or reconcile the provider operation and maintenance window.';
        changed();
    }
}
