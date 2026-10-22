/** Contract fixture only. No live calls, request-body/header history or retained token/URL. */
import { backendGlobalCan, type BackendGlobalUser } from '../admin/fleet/access';
export type DeploymentMockScenario = 'failed-newer' | 'partial' | 'reported-only' | 'converged' | 'unknown' | 'stale' | 'mixed-webapp' | 'rolled-back' | 'missing-destination' | 'missing-bucket' | 'missing-apps-domain' | 'revision-conflict' | 'lease-conflict' | 'unknown-create' | 'key-replay' | 'upload-failure' | 'timeout' | 'read-failure' | 'ownership-refusal' | 'superseded-webapp' | 'new-workspace-domain-ready' | 'collector-unavailable' | 'active-webapp' | 'many-releases';
let scenario: DeploymentMockScenario = 'failed-newer';
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', shaA = 'a'.repeat(40), shaB = 'b'.repeat(40);
const stamp = '2026-10-21T12:00:00Z';
interface MockUser extends BackendGlobalUser {
    id: number;
    is_active?: boolean;
}
export interface DeploymentMockContext {
    user: MockUser | null;
    keyBacked: boolean;
    authTime: number | null;
    group?: number | null; /** False models an origin/interactive refusal. */
    interactive?: boolean;
}
interface Opts {
    method?: string;
    body?: Record<string, unknown>;
    params?: Record<string, unknown>;
    headers?: Record<string, string>;
}
const operations = new Map<string, {
    actor: number;
    group: number;
    origin?: string;
    profile: Record<string, unknown>;
    revision: number;
    cursor: string;
    status: string;
    app: number;
    address?: Record<string, unknown>;
}>();
const keyReceipts = new Set<string>();
const profiles = new Map<number, Record<string, string>>();
let activeReads = 0;
const apiReceipts = new Map<string, string>();
let deployment = 303, releaseId = 103, appId = 2;
const linkedKeys = new Set<number>([1]);
const releases = [{
        id: 102, webapp: 1, version: '2.0.0', status: 'pending', source: 'github', created: stamp
    }, {
        id: 101, webapp: 1, version: '1.0.0', status: 'live', source: 'github', created: stamp
    }, {
        id: 100, webapp: 1, version: '0.9.0', status: 'superseded', source: 'upload', created: stamp
    }];
const attempts = [{
        id: 302, webapp: 1, release: releases[0]!, status: 'failed', created: stamp, finished: stamp
    }, {
        id: 301, webapp: 1, release: releases[1]!, status: 'live', created: stamp, finished: stamp
    }];
const uploadManifests = new Map<number, {
    app: number;
    version: string;
    manifest: {
        path: string;
        sha256: string;
        size: number;
    }[];
    complete: boolean;
    deployment?: number;
}>();
const uploadedPaths = new Set<string>();
const currentReleases = new Map<number, number>([[1,101]]);
export function setDeploymentMockScenario(value: DeploymentMockScenario) {
    scenario = value;
    if (value === 'many-releases' && !releases.some(r => r.id === 99)) for (let id = 99; id >= 60; id--) releases.push({ id, webapp: 1, version: `0.8.${id}`, status: 'superseded', source: 'github', created: stamp });
    if (value === 'active-webapp' && attempts[0]) { attempts[0].status = 'deploying'; attempts[0].finished = ''; activeReads = 0; }
}
export function resetDeploymentMock() { scenario = 'failed-newer'; operations.clear(); profiles.clear(); activeReads = 0; keyReceipts.clear(); apiReceipts.clear(); uploadManifests.clear(); uploadedPaths.clear(); linkedKeys.clear(); linkedKeys.add(1); currentReleases.clear(); currentReleases.set(1,101); releases.splice(0, releases.length, {
    id: 102, webapp: 1, version: '2.0.0', status: 'pending', source: 'github', created: stamp
}, {
    id: 101, webapp: 1, version: '1.0.0', status: 'live', source: 'github', created: stamp
}, {
    id: 100, webapp: 1, version: '0.9.0', status: 'superseded', source: 'upload', created: stamp
}); attempts.splice(0, attempts.length, {
    id: 302, webapp: 1, release: releases[0]!, status: 'failed', created: stamp, finished: stamp
}, {
    id: 301, webapp: 1, release: releases[1]!, status: 'live', created: stamp, finished: stamp
}); }
export function readDeploymentBootstrapFacts(caller: MockUser) { const manage = backendGlobalCan(caller, ['security']) || (backendGlobalCan(caller, ['manage_webapp']) && backendGlobalCan(caller, ['manage_dns'])); return {
    capabilities: { manage_webapps: manage }, features: { webapps: { enabled: true } }, webapp_groups: manage ? [{
            id: 1, name: 'Example workspace', can_manage_dns: true
        }] : [], can_create_webapp_group: manage && backendGlobalCan(caller, ['manage_groups', 'groups'])
}; }
const ok = (data: unknown) => ({ status: true, data });
const no = (message = 'Permission denied', code = 403) => ({
    status: false, code, error: message
});
function platformAttempt(id = B) { let status = scenario === 'partial' ? 'partial' : scenario === 'converged' ? 'converged' : scenario === 'reported-only' ? 'verified' : scenario === 'unknown' ? 'unknown' : 'failed'; if (id !== B && id !== A)
    status = scenario === 'timeout' ? 'requested' : 'converged'; if (id === A)
    status = 'converged'; return {
    id, sha: id === A ? shaA : shaB, framework_version: '5.0.0', status, source: 'admin_retry', actor: 'fixture operator', retry_of: id !== B && id !== A ? B : null, created: stamp, finished: ['converged', 'failed', 'superseded'].includes(status) ? stamp : null, frozen_roster: ['node-a', 'node-b'], node_summary: {
        expected: 2, proven: status === 'converged' ? 2 : status === 'partial' ? 1 : 0, reported: scenario === 'reported-only' ? 2 : 0, failed: status === 'failed' ? 1 : 0, dispatched: 2, other: 0
    }, node_evidence: [{
            runner: 'node-a', status: status === 'converged' ? 'proven' : 'reported', proof: status === 'converged' ? { platform_sha: id === A ? shaA : shaB, platform_deployment: id } : {}
        }], diagnosis: status === 'failed' ? [{
            runner: 'node-b', status: 'failed', detail: 'Process failed before restart proof; last convergence remains unchanged.'
        }] : [], detail: { message: 'Bounded mock observation' }, current_commits: [shaA], desired_commit: shaB
}; }
function summary(id = 1, full = false) {
    const created = [...operations.values()].find(entry => entry.app === id);
    if (created) return {
        schema_version: 1,
        webapp: { id, slug: String(created.profile.slug ?? `app-${id}`), display_name: String(created.profile.display_name ?? ''), environment: String(created.profile.environment ?? 'production'), deployment_ref: String(created.profile.deployment_ref ?? 'main'), repository: String(created.profile.github_repository ?? ''), build_output: String(created.profile.build_output ?? 'dist'), ...profiles.get(id) },
        address: { hostname: `${created.profile.slug ?? `app-${id}`}.apps.example.test`, certificate: { status: created.status === 'succeeded' ? 'active' : 'pending', not_after: '' }, aliases: [] },
        current_release: releases.find(row => row.webapp === id && row.id === currentReleases.get(id)) ?? null, latest_deployment: attempts.find(row => row.webapp === id) ?? null,
        onboarding: { status: created.status, cursor: created.cursor }, deployment_key: { linked: linkedKeys.has(id), active: linkedKeys.has(id) }
    };
    const current = releases.find(r => r.webapp === id && r.id === currentReleases.get(id)) ?? releases[1]!; return {
    schema_version: 1, webapp: {
        id, slug: id === 1 ? 'example-app' : `app-${id}`, display_name: id === 1 ? 'Example WebApp' : `New WebApp ${id}`, environment: 'production', deployment_ref: 'main', repository: 'NativeMojo/example', build_output: 'dist', ...profiles.get(id)
    }, address: {
        hostname: 'example.apps.example.test', certificate: { status: 'active', not_after: '2027-01-01T00:00:00Z' }, aliases: []
    }, current_release: current, latest_deployment: {
        ...attempts.find(row => row.webapp === id)!, status: scenario === 'rolled-back' ? 'rolled_back' : scenario === 'mixed-webapp' ? 'failed' : attempts.find(row => row.webapp === id)?.status, ...(full ? { release: undefined } : {})
    }, onboarding: { status: 'succeeded', cursor: 'verify' }, deployment_key: { linked: linkedKeys.has(id), active: linkedKeys.has(id) }
}; }
function operation(id: string, entry: NonNullable<ReturnType<typeof operations.get>>) { return {
    schema_version: 1, operation_id: id, id: 1, group: { id: entry.group, name: entry.group===1?'Example workspace':String(entry.profile.display_name??'New workspace') }, status: entry.status, cursor: entry.cursor, revision: entry.revision, profile: entry.profile, evidence: {
        app: { status: 'ready' }, address: { status: entry.cursor === 'address' ? 'waiting' : 'ready', hostname: 'example.apps.example.test' }, github: { status: 'unavailable', reason: 'Repository verification has not been attested' }, verify: { status: entry.status === 'succeeded' ? 'ready' : 'unknown' }
    }, activity: [{
            message: `Observed ${entry.cursor} at revision ${entry.revision}`, kind: 'info', at: stamp
        }], resources: { webapp: entry.app }, next_attempt_at: null, last_error: '', modified: stamp
}; }
export function deploymentsMock(path: string, opts: Opts, context: DeploymentMockContext): unknown | undefined {
    const method = opts.method ?? 'GET', b = opts.body ?? {}, p = opts.params ?? {}, u = context.user;
    const owned = path === '/api/account/admin/platform' && p.sections === 'deployments,api' || path.startsWith('/api/account/admin/platform/deploy/') || path.startsWith('/api/edge/webapp/onboarding/') || ['/api/edge/webapp/summaries', '/api/edge/webapp/summary', '/api/edge/webapp/key_status', '/api/edge/webapp/link_key', '/api/edge/webapp/revoke_key', '/api/edge/webapp/rollback', '/api/edge/webapp/health'].includes(path) || /^\/api\/edge\/webapp\/\d+$/.test(path) || /^\/api\/edge\/release\/deployment\/\d+$/.test(path) || (path === '/api/edge/release' && (method === 'POST' || p.webapp !== undefined)) || path === '/api/edge/release/complete' || (path === '/api/edge/deployment' && p.webapp !== undefined);
    if (!owned)
        return undefined;
    if (!u || u.is_active === false)
        return no('Authentication required', 401);
    const api = path.startsWith('/api/account/admin/platform');
    if (context.keyBacked || context.interactive === false)
        return no('Interactive user session required');
    if (api && !backendGlobalCan(u, method === 'GET' ? ['view_platform', 'manage_platform', 'admin'] : ['manage_platform', 'admin']))
        return no();
    const view = backendGlobalCan(u, ['view_dns', 'manage_dns', 'security']), save = backendGlobalCan(u, ['manage_dns', 'security']), custom = save && backendGlobalCan(u, ['manage_webapp']), workflow = backendGlobalCan(u, ['security']) || (backendGlobalCan(u, ['manage_webapp']) && backendGlobalCan(u, ['manage_dns']));
    if (!api && !view)
        return no();
    if (scenario === 'read-failure' && method === 'GET')
        return no('Observation unavailable', 503);
    if (method === 'POST' && !/^\/api\/edge\/webapp\/\d+$/.test(path) && !['/api/edge/release', '/api/edge/release/complete', '/api/edge/webapp/onboarding/create'].includes(path)) {
        const seconds = path.endsWith('/revoke_key') ? 300 : 600;
        if (context.authTime === null || Date.now() / 1000 - context.authTime > seconds)
            return no('Fresh authentication required', 440);
    }
    if (path === '/api/account/admin/platform' && method === 'GET')
        return ok({ schema_version: 1, sections: { deployments: {
                    status: scenario === 'collector-unavailable' ? 'unavailable' : scenario === 'stale' ? 'stale' : 'healthy', observed_at: stamp, reason: scenario === 'collector-unavailable' ? 'The deployment collector is unavailable.' : '', data: scenario === 'collector-unavailable' ? null : {
                        items: [...apiReceipts.values()].reverse().map(x => platformAttempt(x)).concat([platformAttempt(), platformAttempt(A)]), limit: 50, desired_commit: shaB, desired_deployment: B, currently_serving: {
                            deployment: A, sha: shaA, framework_version: '5.0.0', converged_at: stamp
                        }, coordination: {
                            state: 'idle', deployment: B, sha: shaB, at: stamp
                        }, framework_pin: { mode: 'latest', resolved: '5.0.0' }
                    }
                }, api: { status: 'healthy', data: { version: '5.0.0', commit: shaA } } } });
    if (path.startsWith('/api/account/admin/platform/deploy/') && method === 'POST') {
        const action = path.split('/').pop();
        if (typeof b.deployment !== 'string' || ![A, B, ...apiReceipts.values()].includes(b.deployment))
            return no('Unknown deployment', 404);
        if (action === 'retry') {
            const key = opts.headers?.['Idempotency-Key'];
            if (!key)
                return no('Idempotency receipt required', 400);
            let id = apiReceipts.get(key);
            if (!id) {
                id = crypto.randomUUID();
                apiReceipts.set(key, id);
            }
            return ok({
                schema_version: 1, queued: true, deployment: platformAttempt(id)
            });
        }
        return ok({ schema_version: 1, deployment: platformAttempt(b.deployment) });
    }
    if (path === '/api/edge/webapp/summaries' && method === 'GET')
        return ok({
            schema_version: 1, items: [summary(), ...[...operations.values()].filter(entry => entry.actor === u.id).map(entry => summary(entry.app))], count: 1 + [...operations.values()].filter(entry => entry.actor === u.id).length, limit: 50, truncated: false, fleet: { live: 1 }
        });
    if (path === '/api/edge/webapp/summary' && method === 'GET') {
        const id = Number(p.webapp);
        if (id !== 1 && ![...operations.values()].some(x => x.app === id))
            return no('Unknown app', 404);
        return ok(summary(id, true));
    }
    if (/^\/api\/edge\/webapp\/\d+$/.test(path) && method === 'GET') {
        const id = Number(path.split('/').pop());
        if (id !== 1 && ![...operations.values()].some(x => x.app === id))
            return no('Unknown app', 404);
        return ok({
            ...summary(id).webapp, group: { id: [...operations.values()].find(entry => entry.app === id)?.group ?? 1, name: 'Example workspace' }, bucket: 'must-be-stripped', prefix: 'must-be-stripped'
        });
    }
    if (/^\/api\/edge\/webapp\/\d+$/.test(path) && method === 'POST') {
        const id = Number(path.split('/').pop());
        if (!save || scenario === 'ownership-refusal') return no();
        if (id !== 1 && ![...operations.values()].some(x => x.app === id)) return no('Unknown app', 404);
        const allowed = ['display_name', 'environment', 'github_repository', 'deployment_ref', 'build_output'];
        if (Object.keys(b).some(key => !allowed.includes(key)) || Object.values(b).some(value => typeof value !== 'string')) return no('Unsupported profile fields', 400);
        const current = profiles.get(id) ?? {};
        profiles.set(id, { ...current, ...Object.fromEntries(Object.entries(b).map(([key, value]) => [key === 'github_repository' ? 'repository' : key, String(value)])) });
        return ok({ ...summary(id).webapp, group: { id: [...operations.values()].find(entry => entry.app === id)?.group ?? 1, name: 'Example workspace' } });
    }
    if (path === '/api/edge/release' && method === 'GET') {
        const items = releases.filter(r => r.webapp === Number(p.webapp) && (p.id === undefined || r.id === Number(p.id)));
        return {
            status: true, data: items.slice(Number(p.start) || 0, (Number(p.start) || 0) + (Number(p.size) || 25)).map(r => ({id:r.id,version:r.version,status:r.status,source:r.source,created:r.created})), count: items.length
        };
    }
    if (path === '/api/edge/deployment' && method === 'GET') {
        if (scenario === 'active-webapp' && p.id && ++activeReads >= 2 && attempts[0]?.status === 'deploying') { attempts[0].status = 'live'; attempts[0].finished = stamp; currentReleases.set(attempts[0].webapp, attempts[0].release.id); }
        const items = attempts.filter(r => r.webapp === Number(p.webapp) && (p.id === undefined || r.id === Number(p.id)));
        return { status: true, data: items.slice(Number(p.start) || 0, (Number(p.start) || 0) + (Number(p.size) || 15)).map(r => ({ id: r.id, release: r.release, status: r.status, created: r.created, finished: r.finished, ...(p.graph === 'default' ? { detail: r.status === 'failed' ? 'The deployment failed; the desired version is separate.' : 'Observed CI deployment' } : {}) })), count: items.length };
    }
    if (path === '/api/edge/webapp/health' && method === 'GET')
        return ok({
            webapp: Number(p.webapp), status: 'healthy', detail: 'HTTP 200 (separate from version proof)', checked: stamp
        });
    if (path === '/api/edge/webapp/rollback' && method === 'POST') {
        if (!custom || scenario === 'ownership-refusal' || Number(b.webapp) !== 1 || Number(b.group) !== 1)
            return no();
        const target = releases.find(r => r.id === b.release && r.webapp === b.webapp && ['uploaded', 'live', 'superseded'].includes(r.status));
        if (!target)
            return no('Release not verified', 400);
        const a = {
            id: ++deployment, webapp: 1, release: target, status: scenario === 'rolled-back'?'rolled_back':scenario === 'mixed-webapp' ? 'failed' : scenario==='superseded-webapp'?'superseded':'deploying', created: stamp, finished: ''
        };
        attempts.unshift(a);
        return ok(statusPayload(a));
    }
    if (/^\/api\/edge\/release\/deployment\/\d+$/.test(path) && method === 'GET') {
        if (!save) return no('Unknown deployment', 404);
        const a = attempts.find(a => a.id === Number(path.split('/').pop()));
        if (!a)
            return no('Unknown deployment', 404);
        if (scenario !== 'timeout' && a.status === 'deploying') {
            a.status = 'live';
            currentReleases.set(a.webapp, a.release.id);
        }
        return ok(statusPayload(a));
    }
    if (path.startsWith('/api/edge/webapp/onboarding/')) {
        if (!workflow)
            return no();
        const action = path.split('/').pop();
        if (action === 'options' && method === 'GET')
            return ok({
                schema_version: 1, buckets: scenario === 'missing-bucket' ? [] : ['approved-releases'], environments: ['production', 'staging', 'preview', 'development'], destination: scenario === 'missing-destination' ? null : { type: 'cname', value: 'serving.example.test' }, destination_error: scenario === 'missing-destination' ? 'Complete the serving destination in Setup' : null, apps_domain: scenario==='missing-apps-domain'||p.group_intent==='new'||(Number(p.group)>=1000&&scenario!=='new-workspace-domain-ready')?null:{id:10,name:'apps.example.test'}, apps_domain_error: p.group_intent==='new'||Number(p.group)>=1000||scenario==='missing-apps-domain'?'This workspace has no domain managed here yet.':null, github_connected: false
            });
        if (action === 'precheck' && method === 'GET') {
            const host = String(p.url ?? '').replace(/^https?:\/\//, '');
            return ok({
                schema_version: 1, verdict: p.group_intent==='new'||(Number(p.group)>=1000&&scenario!=='new-workspace-domain-ready')?'domain_unknown':host.endsWith('.apps.example.test')?'ready':'domain_unknown', normalized: { hostname: host, label: host.split('.')[0] }, domain: { id: 10, name: 'apps.example.test' }
            });
        }
        if (action === 'create' && method === 'POST') {
            const id = String(b.operation_id);
            let e = operations.get(id);
            if (e && JSON.stringify(e.profile) !== JSON.stringify(b))
                return no('Receipt profile changed', 409);
            if (!e) {
                e = {
                    actor: u.id, group: b.group_intent==='new'?1000+appId:Number(b.group), profile: { ...b }, revision: 1, cursor: b.group_intent==='new'?'address':'app', status: 'waiting', app: ++appId
                };
                operations.set(id, e);
            }
            if (scenario === 'unknown-create')
                return no('Delivery uncertain; operation persisted', 503);
            return ok({ created: true, operation: operation(id, e) });
        }
        if (action === 'workflow' && method === 'POST')
            return ok({
                schema_version: 1, repository: 'NativeMojo/example', filename: '.github/workflows/deploy-webapp.yml', yaml: `name: Deploy WebApp\non: [push]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: NativeMojo/django-mojo/examples/github/actions/deploy-webapp@main\n        with:\n          webapp-id: '${Number(b.webapp)}'\n          artifact-dir: dist\n        env:\n          MOJO_DEPLOY_KEY: \u0024{{ secrets.MOJO_DEPLOY_KEY }}\n`
            });
        const id = String(p.operation ?? b.operation ?? ''), entry = operations.get(id);
        if (!entry || entry.actor !== u.id)
            return no('Unknown operation', 404);
        if (action === 'detail' && method === 'GET')
            return ok(operation(id, entry));
        if (action === 'choose' && method === 'POST') {
            if (scenario === 'revision-conflict' || scenario === 'lease-conflict' || b.revision !== entry.revision || b.step !== entry.cursor)
                return no('Revision changed or lease active; reload', 409);
            const steps = ['app', 'address', 'github', 'verify'];
            const index = steps.indexOf(entry.cursor);
            entry.revision++;
            entry.cursor = steps[Math.min(index + 1, 3)]!;
            entry.status = index === 3 ? 'succeeded' : 'waiting';
            return ok(operation(id, entry));
        }
        if (action === 'cancel' && method === 'POST') {
            entry.status = 'cancelled';
            entry.revision++;
            return ok(operation(id, entry));
        }
    }
    if (path === '/api/edge/webapp/key_status' && method === 'GET')
        return ok({
            webapp: Number(p.webapp), secret_name: 'MOJO_DEPLOY_KEY', status: { linked: linkedKeys.has(Number(p.webapp)), active: linkedKeys.has(Number(p.webapp)) }
        });
    if (['/api/edge/webapp/link_key', '/api/edge/webapp/revoke_key'].includes(path) && method === 'POST') {
        if (!custom || scenario === 'ownership-refusal' || Number(b.group) !== 1)
            return no();
        const receipt = `${u.id}:${b.webapp}:${b.operation_id}`, replayed = keyReceipts.has(receipt) || scenario === 'key-replay';
        keyReceipts.add(receipt);
        if (path.endsWith('/revoke_key')) linkedKeys.delete(Number(b.webapp)); else linkedKeys.add(Number(b.webapp));
        return ok({
            webapp: Number(b.webapp), secret_name: 'MOJO_DEPLOY_KEY', replayed, token: linkedKeys.has(Number(b.webapp)) && !replayed ? crypto.randomUUID() + crypto.randomUUID() : null
        });
    }
    if (path === '/api/edge/release' && method === 'POST') {
        if (!save) return no();
        const manifest = b.manifest as {
            path: string;
            sha256: string;
            size: number;
        }[];
        if (!Array.isArray(manifest) || !manifest.length)
            return no('Manifest required', 400);
        let entry = [...uploadManifests.entries()].find(([, r]) => r.app === Number(b.webapp) && r.version === b.version);
        if (entry && JSON.stringify(entry[1].manifest) !== JSON.stringify(manifest))
            return no('Manifest differs', 400);
        if (!entry) {
            const r = {
                app: Number(b.webapp), version: String(b.version), manifest, complete: false
            };
            entry = [++releaseId, r];
            uploadManifests.set(entry[0], r);
        }
        return ok({
            release: entry[0], version: entry[1].version, status: releases.find(x=>x.id===entry![0])?.status??(entry[1].complete?'uploaded':'pending'), uploads: entry[1].complete ? [] : manifest.map(e => ({
                path: e.path, url: `https://deployment-storage.invalid/${entry![0]}/${encodeURIComponent(e.path)}`, headers: { 'x-amz-checksum-sha256': btoa(String.fromCharCode(...Uint8Array.from(e.sha256.match(/../g) ?? [], x => parseInt(x, 16)))) }
            }))
        });
    }
    if (path === '/api/edge/release/complete' && method === 'POST') {
        if (!save) return no();
        const r = uploadManifests.get(Number(b.release));
        if (!r || r.manifest.some(m => !uploadedPaths.has(`${b.release}/${m.path}`)))
            return no('Missing uploaded files', 400);
        const active=attempts.find(a=>a.webapp===r.app&&a.release.id===Number(b.release)&&['queued','deploying','rolling_back','live'].includes(a.status));
        if (currentReleases.get(r.app)===Number(b.release)&&active)
            return ok({
                release: Number(b.release), version: r.version, status: 'uploaded', promoted: true, deployment: active.id, deployment_status: active.status, webapp: r.app
            });
        r.complete = true;
        const release = {
            id: Number(b.release), webapp: r.app, version: r.version, status: 'live', source: 'upload', created: stamp
        };
        const a = {
            id: ++deployment, webapp: r.app, release, status: scenario==='rolled-back'?'rolled_back':scenario==='mixed-webapp'?'failed':scenario==='superseded-webapp'?'superseded':'deploying', created: new Date().toISOString(), finished: ''
        };
        if(!['rolled_back','superseded'].includes(a.status))currentReleases.set(r.app,release.id);
        attempts.unshift(a);
        if(!releases.some(x=>x.id===release.id))releases.unshift(release);
        r.deployment = a.id;
        return ok({
            release: release.id, version: r.version, status: 'uploaded', promoted: true, deployment: a.id, deployment_status: a.status, webapp: r.app
        });
    }
    return no('Unsupported deployment method', 405);
}
function statusPayload(a: typeof attempts[number]) { const status = a.status; return {
    deployment: a.id, webapp: a.webapp, release: a.release.id, version: a.release.version, status, terminal: ['live', 'failed', 'rolled_back', 'superseded'].includes(status), success: status === 'live', detail: status === 'rolled_back' ? 'Attempted release failed; rollback observed' : scenario === 'mixed-webapp' ? 'Partial node proof; mixed fleet possible' : 'Fixture observation', created: a.created, finished: a.finished, targets: [{ runner: 'node-a', status: status === 'live' ? 'succeeded' : 'unknown' }], rollback_targets: []
}; }
/** Secondary storage simulator receives the exact anonymous PUT contract, never an API token. */
export async function deploymentMockStorageFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> { const url = new URL(String(input)); if (url.origin !== 'https://deployment-storage.invalid')
    throw new Error('Unowned mock storage destination'); if (init?.method !== 'PUT' || init.credentials !== 'omit' || new Headers(init.headers).has('Authorization'))
    return new Response('', { status: 403 }); if (scenario === 'upload-failure')
    throw new TypeError('Storage CORS refused'); const [, id, path] = url.pathname.split('/'); const manifest = uploadManifests.get(Number(id)); if (!manifest || !path)
    return new Response('', { status: 404 }); const target = manifest.manifest.find(e => e.path === decodeURIComponent(path)); if (!target)
    return new Response('', { status: 400 }); const body = init.body; if (!(body instanceof Blob) || body.size !== target.size)
    return new Response('', { status: 400 }); const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await body.arrayBuffer()))).map(x => x.toString(16).padStart(2, '0')).join(''); const expected = btoa(String.fromCharCode(...Uint8Array.from(target.sha256.match(/../g) ?? [], x => parseInt(x, 16)))); if (hash !== target.sha256 || new Headers(init.headers).get('x-amz-checksum-sha256') !== expected)
    return new Response('', { status: 400 }); uploadedPaths.add(`${id}/${target.path}`); return new Response('', { status: 200 }); }
