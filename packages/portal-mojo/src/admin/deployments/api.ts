import { mojoCall, isReauthRequired, requestFreshAuth } from '../../client/runtime';
import { MojoError } from '../../client/errors';
import { appActionsRefused, refuseAppActions } from './authority-state';
import type { FetchOpts } from '../../client/client';
import { projectAttempt, projectBootstrap, projectDeployment, projectOperation, projectOptions, projectPlatform, projectPlatformAttempt, projectPrecheck, projectRelease, projectSummaries, projectSummary, projectWebAppObject, record, text, positiveId, list, uuid } from './sanitize';
import { assertOwner, webAppAuthority, type DeploymentOwner } from './permissions';
import { appUnsettled, saveReceipt, singleFlight, type ActionReceipt } from './receipts';
import type { BackendGlobalUser } from '../fleet/access';
import type { WebAppObject } from './types';
import type { ApiAction, CreateProfile, ManifestEntry, OnboardingOperation } from './types';
const ROOT = '/api/edge';
function privateError(error: unknown): Error { if (error instanceof DOMException && error.name === 'AbortError')
    return new DOMException('Deployment owner changed', 'AbortError'); const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 0; return new MojoError(status === 440 ? 'Fresh authentication required' : status === 403 ? 'Deployment observation or action denied' : 'Deployment request unavailable; outcome may be unknown', status); }
export async function safeCall<T>(owner: DeploymentOwner, path: string, project: (v: unknown) => T, opts: FetchOpts = {}): Promise<T> { assertOwner(owner, opts.signal); try {
    const body = await mojoCall(path, {
        ...opts, unscoped: true, beforeSend: () => { assertOwner(owner, opts.signal); opts.beforeSend?.(); }
    });
    assertOwner(owner, opts.signal);
    return project(body.data);
}
catch (error) {
    throw privateError(error);
} }
export const getBootstrap = (o: DeploymentOwner, signal?: AbortSignal) => safeCall(o, '/api/account/admin/bootstrap', projectBootstrap, { signal });
export const getPlatform = (o: DeploymentOwner, signal?: AbortSignal) => safeCall(o, '/api/account/admin/platform', projectPlatform, { params: { sections: 'deployments,api' }, signal });
export const getWebApps = (o: DeploymentOwner, signal?: AbortSignal) => safeCall(o, `${ROOT}/webapp/summaries`, projectSummaries, { signal });
export const getSummary = (o: DeploymentOwner, id: number, signal?: AbortSignal) => safeCall(o, `${ROOT}/webapp/summary`, v => { const s = projectSummary(v); if (s.webapp.id !== id)
    throw new Error('App identity changed'); return s; }, { params: { webapp: id }, signal });
export const getWebApp = (o: DeploymentOwner, id: number, signal?: AbortSignal) => safeCall(o, `${ROOT}/webapp/${id}`, v => { const s = projectWebAppObject(v); if (s.id !== id || !s.group.id)
    throw new Error('App ownership unavailable'); return s; }, { params: { graph: 'default' }, signal });
export const getMember = (o: DeploymentOwner, group: number, signal?: AbortSignal) => safeCall(o, `/api/group/${group}/member`, v => { const r = record(v), p = record(r.permissions); return { permissions: Object.fromEntries(['view_dns', 'manage_dns', 'security', 'manage_webapp'].filter(k => Object.hasOwn(p, k)).map(k => [k, p[k]])) }; }, { signal });
export async function resolveAppAuthority(o: DeploymentOwner, user: BackendGlobalUser | undefined, app: WebAppObject, kind: 'custom' | 'workflow' | 'release', signal?: AbortSignal) { const base = webAppAuthority(user, app); return base[kind] ? base : webAppAuthority(user, app, await getMember(o, app.group.id, signal)); }
export async function getHistory(o: DeploymentOwner, app: number, kind: 'release' | 'deployment', start = 0, signal?: AbortSignal, size = kind === 'release' ? 25 : 15) { const body = await mojoCall(`${ROOT}/${kind}`, {
    unscoped: true, signal, params: {
        webapp: app, graph: 'list', sort: '-created', start, size: Math.max(1, Math.min(100, Math.floor(size)))
    }, beforeSend: () => assertOwner(o, signal)
}).catch(error => { throw privateError(error); }); assertOwner(o, signal); return { items: list(body.data, Math.max(1, Math.min(100, Math.floor(size)))).map(v => kind === 'release' ? projectRelease(v) : projectAttempt(v)), count: typeof body.count === 'number' ? body.count : 0 }; }
export const getDeployment = (o: DeploymentOwner, id: number, app: number, release: number, signal?: AbortSignal) => safeCall(o, `${ROOT}/release/deployment/${id}`, v => { const d = projectDeployment(v); if (d.deployment !== id || d.webapp !== app || d.release !== release)
    throw new Error('Deployment identity mismatch'); return d; }, { signal });
export async function write<T>(o: DeploymentOwner, r: ActionReceipt, path: string, body: Record<string, unknown>, project: (v: unknown) => T, signal?: AbortSignal): Promise<T> { assertOwner(o, signal); if (appActionsRefused(o, r.app))
    throw new Error('App actions were refused. Refresh safe state and establish a new session before another mutation.'); if (appUnsettled(o, r.app, r.key))
    throw new Error('Another app operation has an unknown outcome. Refresh its exact status before continuing.'); if (r.kind === 'rollback' && r.submitted && !r.settled)
    throw new Error('Rollback delivery is unknown. Observe summary/history; no rollback was replayed.'); saveReceipt({
    ...r, submitted: true, submittedAt: r.submittedAt ?? Date.now()
}); return singleFlight(`${o.actor}:${r.app || r.key}`, async () => { try {
    return await safeCall(o, path, project, {
        method: 'POST', body, signal, ...(r.kind === 'api' ? { idempotencyKey: r.operation } : {})
    });
}
catch (error) {
    if (isReauthRequired(error)) {
        saveReceipt({ ...r, submitted: false });
        await requestFreshAuth();
        throw new Error('Authentication renewed or cancelled. Refresh authoritative state and explicitly confirm again; nothing was replayed.');
    }
    if (error instanceof MojoError && error.status === 403 && r.app)
        refuseAppActions(o, r.app);
    if (error && typeof error === 'object' && 'status' in error && [400, 401, 403, 404, 409, 440].includes(Number(error.status)))
        saveReceipt({ ...r, settled: true });
    throw new Error(error instanceof DOMException && error.name === 'AbortError' ? 'Session or view changed. The submitted operation may persist. Resume to reconcile.' : 'The operation was refused or delivery is uncertain. Refresh authoritative state before retrying.');
} }); }
export async function recoverApi(o: DeploymentOwner, r: ActionReceipt, id: string, action: ApiAction, signal?: AbortSignal) { if (!uuid(id))
    throw new Error('Invalid deployment ID'); return write(o, r, `/api/account/admin/platform/deploy/${action}`, { deployment: id }, v => { const d = projectPlatformAttempt(record(v).deployment); if (!d.id || (action !== 'retry' && d.id !== id))
    throw new Error('Deployment identity mismatch'); return d; }, signal); }
export const rollback = (o: DeploymentOwner, r: ActionReceipt, app: number, release: number, group: number, signal?: AbortSignal) => write(o, r, `${ROOT}/webapp/rollback`, {
    webapp: app, release, group
}, v => { const d = projectDeployment(v); if (!d.deployment || d.webapp !== app || d.release !== release)
    throw new Error('Rollback identity mismatch'); return d; }, signal);
export const getOptions = (o: DeploymentOwner, intent: {
    group: number;
} | {
    group_intent: 'new';
}, signal?: AbortSignal) => safeCall(o, `${ROOT}/webapp/onboarding/options`, projectOptions, { params: intent, signal });
export const precheckAddress = (o: DeploymentOwner, intent: {
    group: number;
} | {
    group_intent: 'new';
}, url: string, signal?: AbortSignal) => safeCall(o, `${ROOT}/webapp/onboarding/precheck`, projectPrecheck, { params: { ...intent, url }, signal });
export const getOperation = (o: DeploymentOwner, id: string, signal?: AbortSignal) => safeCall(o, `${ROOT}/webapp/onboarding/detail`, v => { const p = projectOperation(v); if (p.operation_id !== id)
    throw new Error('Operation identity mismatch'); return p; }, { params: { operation: id }, signal });
export const createApp = (o: DeploymentOwner, r: ActionReceipt, p: CreateProfile, signal?: AbortSignal) => write(o, r, `${ROOT}/webapp/onboarding/create`, { ...p }, v => { const operation = projectOperation(record(v).operation); if (operation.operation_id !== p.operation_id)
    throw new Error('Operation identity mismatch'); return operation; }, signal);
export const chooseOnboarding = (o: DeploymentOwner, r: ActionReceipt, p: OnboardingOperation, choice: Record<string, unknown>, signal?: AbortSignal) => write(o, r, `${ROOT}/webapp/onboarding/choose`, {
    operation: p.operation_id, revision: p.revision, step: p.cursor, choice
}, v => { const next = projectOperation(v); if (next.operation_id !== p.operation_id)
    throw new Error('Operation identity mismatch'); return next; }, signal);
export const cancelOnboarding = (o: DeploymentOwner, r: ActionReceipt, id: string, signal?: AbortSignal) => write(o, r, `${ROOT}/webapp/onboarding/cancel`, { operation: id }, projectOperation, signal);
export const getWorkflow = (o: DeploymentOwner, app: number, group: number, signal?: AbortSignal) => safeCall(o, `${ROOT}/webapp/onboarding/workflow`, v => { const r = record(v); return {
    filename: '.github/workflows/deploy-webapp.yml', repository: text(r.repository), yaml: text(r.yaml, 32000)
}; }, {
    method: 'POST', body: { webapp: app, group }, signal
}).catch(async (error) => { if (isReauthRequired(error)) {
    await requestFreshAuth();
    throw new Error('Authentication prompted. Review and explicitly generate the workflow again; nothing was replayed.');
} throw error; });
/** Secret never crosses a Query/Mutation cache or error object. */
export const changeKey = (o: DeploymentOwner, r: ActionReceipt, app: number, group: number, action: 'mint' | 'rotate' | 'revoke', signal?: AbortSignal) => write(o, r, `${ROOT}/webapp/${action === 'revoke' ? 'revoke_key' : 'link_key'}`, {
    webapp: app, group, operation_id: r.operation, ...(action === 'revoke' ? {} : { action })
}, v => { const x = record(v); if (positiveId(x.webapp) !== app)
    throw new Error('Key receipt identity mismatch'); return { token: typeof x.token === 'string' ? x.token.slice(0, 8192) : null, replayed: x.replayed === true }; }, signal);
export const getKeyStatus = (o: DeploymentOwner, app: number, group: number, signal?: AbortSignal) => safeCall(o, `${ROOT}/webapp/key_status`, v => { const r = record(v), s = record(r.status); if (positiveId(r.webapp) !== app)
    throw new Error('Key identity mismatch'); return { linked: s.linked === true, active: s.active === true }; }, { params: { webapp: app, group }, signal });
export const getHealth = (o: DeploymentOwner, app: number, group: number, signal?: AbortSignal) => safeCall(o, `${ROOT}/webapp/health`, v => { const r = record(v); if (positiveId(r.webapp) !== app)
    throw new Error('Health identity mismatch'); return {
    status: text(r.status) || 'unknown', detail: text(r.detail, 500), checked: text(r.checked)
}; }, { params: { webapp: app, group }, signal });
export async function registerUpload(o: DeploymentOwner, r: ActionReceipt, app: number, group: number, version: string, manifest: ManifestEntry[], signal?: AbortSignal) { return write(o, r, `${ROOT}/release`, {
    webapp: app, group, version, manifest
}, v => { const d = record(v); if (!positiveId(d.release) || text(d.version) !== version)
    throw new Error('Release identity mismatch'); return {
    release: positiveId(d.release), status: text(d.status), uploads: list(d.uploads, 5000).map(v => { const u = record(v), h = record(u.headers); return {
        path: text(u.path, 1024), url: text(u.url, 8192), headers: { 'x-amz-checksum-sha256': text(h['x-amz-checksum-sha256'], 64) }
    }; })
}; }, signal); }
export const completeUpload = (o: DeploymentOwner, r: ActionReceipt, release: number, app: number, group: number, signal?: AbortSignal) => write(o, r, `${ROOT}/release/complete`, { release, group }, v => { const d = record(v); if (positiveId(d.release) !== release || positiveId(d.webapp) !== app || !positiveId(d.deployment))
    throw new Error('Completion identity mismatch'); return {
    deployment: positiveId(d.deployment), release, app
}; }, signal);
