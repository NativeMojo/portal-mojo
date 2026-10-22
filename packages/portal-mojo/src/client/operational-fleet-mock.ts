/** Mock-only dashboard/capacity contract. Runtime modules never import this file. */
import { backendGlobalCan, FLEET_DASHBOARD_GRANTS, type BackendGlobalUser } from '../admin/fleet/access';
import type { CapacityAction, CapacityBatch, CapacityPlan, CapacityReport, CapacityStep, FleetDashboard, FleetFacts } from '../admin/fleet/types';
export const mockOperationalFleetScenarios = ['healthy', 'down', 'external', 'partial', 'restricted', 'missing-evidence', 'aged-observations', 'inventory-unavailable', 'transitional', 'drained', 'unknown-price', 'stale-plan', 'expired-plan', 'duplicate', 'failed', 'stalled', 'uncertain-apply', 'status-unavailable', 'reauth'] as const;
export type MockOperationalFleetScenario = typeof mockOperationalFleetScenarios[number];
export interface MockFleetActor extends BackendGlobalUser {
    id: number;
    credential_kind?: string;
}
let scenario: MockOperationalFleetScenario = 'healthy', sequence = 0, version = 0;
const plans = new Map<string, {
    plan: CapacityPlan;
    version: number;
}>(), batches = new Map<string, {
    batch: CapacityBatch;
    reads: number;
    applied: boolean;
}>(), claimed = new Map<string, string>();
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const timestamp = () => new Date().toISOString();
const fail = (error_code: string, code: number, error = error_code, data?: unknown) => ({ status: false, code, error_code, error, ...(data ? { data } : {}) });
const ok = (data: unknown) => ({ status: true, data: copy(data) });
let state: CapacityReport;
export function setMockOperationalFleetScenario(value: MockOperationalFleetScenario) { if (!mockOperationalFleetScenarios.includes(value))
    throw new Error('Unknown operational fleet scenario.'); scenario = value; version++; plans.clear(); batches.clear(); claimed.clear(); state = fixture(); }
export const getMockOperationalFleetScenario = () => scenario;
function fixture(): CapacityReport {
    const instances = ['i-mocka', 'i-mockb', 'i-mockc'].map((id, i) => ({ id, name: `app-${i + 1}`, state: 'healthy', instance_state: 'running', lifecycle_state: 'available', instance_type: 'm6i.large', zone: 'us-east-1a', subnet_id: 'subnet-0abc', public_ip: `203.0.113.${10 + i}`, healthy: true, registered: true, can_drain: true, self: i === 0, primary: i === 0, added_by_capacity: i !== 0, stable_ip: true, groups: ['targetgroup/mock-api'] }));
    if (scenario === 'drained') {
        Object.assign(instances[2]!, { healthy: false, registered: false, can_drain: false, state: 'unregistered', groups: [] });
    }
    if (scenario === 'transitional') {
        Object.assign(instances[2]!, { healthy: false, can_drain: false, state: 'draining', lifecycle_state: 'deleting' });
    }
    const classes = { 'db-reader-a': 'db.t4g.medium', 'db-reader-b': 'db.r6g.xlarge' };
    const database = { identifier: 'mock-database', kind: 'aurora' as const, engine: 'aurora-postgresql', status: 'available', writer: 'db-writer', readers: ['db-reader-a', 'db-reader-b'], instance_class: null, writer_instance_class: 'db.r6g.large', reader_instance_classes: classes, blocked_reason: scenario === 'transitional' ? 'resource_transitioning' : null, members: [{ id: 'db-writer', role: 'writer', status: 'available', lifecycle_state: 'available', instance_class: 'db.r6g.large', can_resize: true, can_remove: false }, ...Object.entries(classes).map(([id, instance_class], i) => ({ id, instance_class, role: 'reader', status: scenario === 'transitional' && i === 1 ? 'creating' : 'available', lifecycle_state: scenario === 'transitional' && i === 1 ? 'creating' : 'available', can_resize: scenario !== 'transitional', can_remove: scenario !== 'transitional' }))] };
    const actions = Object.fromEntries(['add_node', 'drain_node', 'terminate_node', 'add_reader', 'remove_reader', 'set_cache_replicas', 'resize_cache', 'resize_database'].map(a => [a, { offered: scenario !== 'external' && scenario !== 'partial', blocked_reason: scenario === 'external' ? 'infrastructure_external' : scenario === 'partial' ? 'identity_unavailable' : null }]));
    return { schema_version: 2, mode: scenario === 'external' ? 'external' : 'managed', region: 'us-east-1', generated_at: timestamp(), identity_available: scenario !== 'partial', identity: scenario === 'partial' ? null : { project: 'mock', environment: 'production' }, node_id_pinned: false, nodes: { self: 'i-mocka', self_check: 'matched', serving_available: true, inventory_available: scenario !== 'partial', instances }, databases_available: scenario !== 'partial', caches_available: true, databases: scenario === 'partial' ? [] : [database], caches: [{ identifier: 'mock-redis', status: 'available', node_type: 'cache.t4g.micro', replica_count: 1, min_replicas: 1, resize_impact: 'rolling', blocked_reason: null, members: [{ id: 'redis-primary', role: 'primary', status: 'available', lifecycle_state: 'available' }, { id: 'redis-replica', role: 'replica', status: 'available', lifecycle_state: 'available' }] }], sizes: { database: [{ size: 'small', label: 'Small', type: 'db.t4g.medium', monthly_usd: 50 }, { size: 'medium', label: 'Medium', type: 'db.r6g.large', monthly_usd: 175 }, { size: 'large', label: 'Large', type: 'db.r6g.xlarge', monthly_usd: 350 }], cache: [{ size: 'small', label: 'Small', type: 'cache.t4g.micro', monthly_usd: 12 }, { size: 'medium', label: 'Medium', type: 'cache.t4g.medium', monthly_usd: scenario === 'unknown-price' ? null : 50 }, { size: 'large', label: 'Large', type: 'cache.r7g.large', monthly_usd: 120 }] }, actions, warnings: scenario === 'partial' ? [{ code: 'databases', iam_action: 'rds:DescribeDBClusters', message: 'Database inventory unavailable; do not infer an empty estate.' }] : [], reader_routing: { database: { active: true, host: 'mock-reader.example', skip_reason: null, matches_reader_endpoint: true }, redis: { active: false } }, egress: { available: scenario !== 'partial', fleet_available: true, addresses_available: scenario !== 'partial', policy_available: scenario !== 'partial', enabled: true, addresses: scenario === 'partial' ? [] : ['203.0.113.10', '203.0.113.11'], attached: scenario === 'partial' ? [] : [{ instance: 'i-mocka', public_ip: '203.0.113.10', managed: true }], fallback_attached: [], reserved: [{ public_ip: '203.0.113.20' }], pending_nodes: [] } };
}
setMockOperationalFleetScenario('healthy');
function dashboard(actor: MockFleetActor): FleetDashboard {
    const observed_at = timestamp();
    const source = (data: FleetFacts, status = 'healthy') => ({ status, observed_at, stale_after: new Date(Date.now() + 120000).toISOString(), reason: null, data });
    const sources: FleetDashboard['sources'] = { load_balancer: source({ configured: true, registered: state.nodes.instances.filter(n=>n.registered).length, healthy: scenario === 'down' ? 0 : state.nodes.instances.filter(n=>n.healthy).length, balancer: { name: 'mock-api-nlb', type: 'network', scheme: 'internet-facing', state: 'active', elastic_ips: ['198.51.100.10'], addresses: [{ ip: '198.51.100.10' }] }, elastic_ip_missing: false }, scenario === 'down' ? 'unhealthy' : 'healthy'), compute: source({ total: state.nodes.instances.length, up: state.nodes.instances.filter(n=>n.healthy).length, source: 'target_group', instances: state.nodes.instances.map(n => ({ id: n.id, name: n.name, healthy: n.healthy })) }), database: source({ reachable: true, engine: 'PostgreSQL', version: '16.4', vendor: 'postgresql', drift: null }), cache: source({ reachable: true, engine: 'Redis', version: '7.1', memory_used: '42M' }), certificates: source({ total: 4, active: 4, failing: 0, expiring_within_30_days: 1, soonest_renew: observed_at, soonest_expiry: new Date(Date.now() + 25 * 86400000).toISOString() }), public_api: source({ configured: true, node_version: '2026.10.21', probe: { ok: true, http_status: 200, version: '2026.10.21' } }), framework: source({ installed: '1.2.100', latest: '1.2.101', update_available: true, pin: { mode: 'automatic' } }), last_deployment: source({ items: [{ id: 'mock-deployment', sha: '6bc254abcdef0123456789', status: 'converged', created: observed_at, finished: observed_at, actor: 'github-actions' }] }), jobs: source(scenario === 'missing-evidence' ? {} : { scheduler_active: true, jobs: { pending: 2, running: 1, failed: 3 }, failed_recent: 1 }, 'degraded'), sanity: source(scenario === 'missing-evidence' ? {} : { checks: [{ name: 'Database', ok: true }, { name: 'Redis', ok: true }] }), incidents: source({ open: 2, oldest_created: observed_at, oldest_age_days: 2 }, 'degraded'), tickets: source({ open: 0, oldest_created: null, oldest_age_days: null }), sms: source({ configured: false }, 'unconfigured'), email: source({ configured: true, domains: 2, sendable_domains: 2, default_sender: 'hello@example.com' }) };
    for (const [key, row] of Object.entries(sources)) {
        const grants = key === 'email' ? ['manage_aws', 'comms', 'admin'] : ['incidents', 'tickets'].includes(key) ? ['view_security', 'manage_security', 'security', 'admin'] : ['view_platform', 'manage_platform', 'admin'];
        if (scenario === 'restricted' || !backendGlobalCan(actor, grants))
            sources[key] = { ...row, status: 'permission_denied', observed_at: null, stale_after: null, reason: 'permission_required', data: {} };
    }
    if (scenario === 'partial')
        sources.compute = { ...sources.compute!, status: 'unknown', reason: 'provider_denied', data: {} };
    if (scenario === 'aged-observations')
        for (const row of Object.values(sources)) {
            if (row.observed_at) row.observed_at = new Date(Date.now() - 15 * 60_000).toISOString();
            if (row.stale_after) row.stale_after = new Date(Date.now() - 13 * 60_000).toISOString();
        }
    return { schema_version: 2, observed_at, availability: { state: scenario === 'down' ? 'down' : scenario === 'restricted' || scenario === 'partial' ? 'unknown' : 'ok', message: scenario === 'down' ? 'Load balancer has no healthy targets' : scenario === 'restricted' || scenario === 'partial' ? 'Availability cannot be confirmed' : 'The serving fleet is available', down: scenario === 'down' ? ['load_balancer'] : [] }, attention: { message: 'Recent job failures and open incidents need review.' }, sources };
}
function validateSteps(steps: unknown): CapacityStep[] {
    if (!Array.isArray(steps) || !steps.length || steps.length > 20)
        throw new Error('A plan requires 1–20 steps.');
    const normalized: CapacityStep[] = [];
    const healthy = state.nodes.instances.filter(n => n.healthy);
    const drained = new Set<string>();
    for (const raw of steps) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw new Error('Invalid step.');
        const s = raw as CapacityStep;
        if (!state.actions[s.action]?.offered)
            throw new Error('Action not offered.');
        if (s.action !== 'add_node' && (typeof s.resource !== 'string' || !s.resource))
            throw new Error('Resource required.');
        if (s.action !== 'add_node' && (s.source_instance != null || s.subnet_id != null))
            throw new Error('Placement only belongs to Add Node.');
        if (s.action === 'add_node') {
            if (s.source_instance && !state.nodes.instances.some(n => n.id === s.source_instance && n.healthy))
                throw new Error('Source must be healthy.');
            if (s.subnet_id && !/^subnet-[A-Za-z0-9]+$/.test(s.subnet_id))
                throw new Error('Subnet identifier invalid.');
        }
        if (s.action === 'drain_node' || s.action === 'terminate_node') {
            const n = state.nodes.instances.find(n => n.id === s.resource);
            if (!n || n.self)
                throw new Error('Node cannot be removed.');
            if (s.action === 'drain_node') {
                if (!n.can_drain)
                    throw new Error('Node cannot drain.');
                drained.add(n.id);
                if (healthy.filter(n => !drained.has(n.id)).length < 1)
                    throw new Error('Keep one healthy target.');
            }
            else if (!drained.has(n.id) && (n.registered || n.healthy || n.state !== 'unregistered'))
                throw new Error('Drain completion required.');
        }
        if (s.action === 'resize_database' || s.action === 'resize_cache') {
            const ladder = state.sizes[s.action === 'resize_cache' ? 'cache' : 'database'];
            if (s.apply_immediately !== true || !ladder.some(r => r.size === s.size))
                throw new Error('Curated size and apply_immediately required.');
            if (s.action === 'resize_database' && !state.databases.some(d => !d.blocked_reason && d.members.some(m => m.id === s.resource && m.can_resize)))
                throw new Error('Database member cannot resize.');
        }
        if (s.action === 'set_cache_replicas') {
            const c = state.caches.find(c => c.identifier === s.resource);
            if (!c || !Number.isSafeInteger(s.count) || s.count! < c.min_replicas || s.apply_immediately !== true)
                throw new Error('Invalid replica count.');
        }
        if (s.action === 'add_reader' && !state.databases.some(d => d.identifier === s.resource && !d.blocked_reason))
            throw new Error('Reader source unavailable.');
        if (s.action === 'remove_reader' && !state.databases.some(d => !d.blocked_reason && d.members.some(m => m.id === s.resource && m.role === 'reader' && m.can_remove)))
            throw new Error('Reader removal unavailable.');
        if (normalized.some(p => p.action === s.action && p.resource === s.resource) && !['add_node', 'add_reader'].includes(s.action))
            throw new Error('Duplicate step.');
        normalized.push(copy(s));
    }
    return normalized;
}
function serverPlan(actor: MockFleetActor, raw: unknown): CapacityPlan {
    const submitted = validateSteps(raw);
    const rank: Record<CapacityAction, number> = { add_node: 0, add_reader: 1, set_cache_replicas: 2, resize_cache: 3, resize_database: 4, drain_node: 7, terminate_node: 8, remove_reader: 6 };
    const steps = submitted.map(s => { const { action, resource = '', ...params } = s; return { index: 0, action, resource, params, kind: ['drain_node', 'terminate_node', 'remove_reader'].includes(action) || (action === 'set_cache_replicas' && Number(params.count) < (state.caches.find(c => c.identifier === resource)?.replica_count ?? 0)) ? 'remove' : 'add', description: action === 'add_node' ? 'Add and prove a new app node' : `${action.replaceAll('_', ' ')} ${resource}`, warnings: action === 'resize_database' ? ['Writer resize can cause minutes offline; reader resize pauses that reader.'] : action === 'add_reader' ? ['New readers inherit the current source class; refresh concrete IDs before resizing.'] : action === 'resize_cache' ? ['Group-wide resize interrupts the primary briefly; downsizing may evict data.'] : action === 'terminate_node' ? ['Node termination cannot be undone.'] : [], monthly_delta_usd: scenario === 'unknown-price' ? null : action === 'add_node' ? 70 : action === 'add_reader' ? 175 : action === 'terminate_node' ? -70 : 10 }; }).sort((a, b) => (a.action === 'set_cache_replicas' && a.kind === 'remove' ? 5 : rank[a.action]) - (b.action === 'set_cache_replicas' && b.kind === 'remove' ? 5 : rank[b.action]));
    // Keep each termination immediately after its own drain, as the service does.
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i]!;
        if (s.action !== 'drain_node')
            continue;
        const pos = steps.findIndex(t => t.action === 'terminate_node' && t.resource === s.resource);
        if (pos >= 0) {
            const [term] = steps.splice(pos, 1);
            steps.splice(i + 1, 0, term!);
            i++;
        }
    }
    steps.forEach((s, i) => s.index = i);
    return { schema_version: 2, id: `mock-plan-${++sequence}`, actor: actor.id, created: timestamp(), expires_at: new Date(Date.now() + (scenario === 'expired-plan' ? -1 : 300000)).toISOString(), expires_in: 300, steps, total_monthly_delta_usd: scenario === 'unknown-price' ? null : steps.reduce((n, s) => n + (s.monthly_delta_usd ?? 0), 0), estimate_complete: scenario !== 'unknown-price', order_note: 'Add and prove capacity before removing it; each node drains before termination.' };
}
function applyInventory(batch: CapacityBatch) { for (const s of batch.steps.filter(s => s.state === 'done')) {
    const p = plans.get(batch.plan_id)?.plan.steps.find(p => p.index === s.index)?.params ?? {};
    if (s.action === 'drain_node') {
        const n = state.nodes.instances.find(n => n.id === s.resource);
        if (n)
            Object.assign(n, { state: 'unregistered', healthy: false, registered: false, can_drain: false, groups: [] });
    }
    if (s.action === 'terminate_node')
        state.nodes.instances = state.nodes.instances.filter(n => n.id !== s.resource);
    if (s.action === 'add_node') {
        const source = state.nodes.instances.find(n => n.id === p.source_instance) ?? state.nodes.instances[0];
        if (source)
            state.nodes.instances.push({ ...copy(source), id: `i-added-${++sequence}`, name: 'New app node', self: false, primary: false, added_by_capacity: true });
    }
    if (s.action === 'add_reader') {
        const d = state.databases.find(d => d.identifier === s.resource);
        if (d) {
            const id = `db-added-${++sequence}`, instance_class = d.writer_instance_class ?? d.instance_class ?? 'unknown';
            d.readers.push(id);
            d.reader_instance_classes[id] = instance_class;
            d.members.push({ id, role: 'reader', status: 'available', lifecycle_state: 'available', instance_class, can_remove: true, can_resize: true });
        }
    }
    if (s.action === 'remove_reader') {
        for (const d of state.databases) {
            d.readers = d.readers.filter(id => id !== s.resource);
            d.members = d.members.filter(m => m.id !== s.resource);
            delete d.reader_instance_classes[s.resource];
        }
    }
    if (s.action === 'resize_database') {
        const size = state.sizes.database.find(r => r.size === p.size);
        if (size)
            for (const d of state.databases) {
                const m = d.members.find(m => m.id === s.resource);
                if (m) {
                    m.instance_class = size.type;
                    if (m.role === 'writer')
                        d.writer_instance_class = size.type;
                    else
                        d.reader_instance_classes[m.id] = size.type;
                }
            }
    }
    if (s.action === 'resize_cache' || s.action === 'set_cache_replicas') {
        const c = state.caches.find(c => c.identifier === s.resource);
        if (c) {
            if (s.action === 'set_cache_replicas')
                c.replica_count = Number(p.count);
            else
                c.node_type = state.sizes.cache.find(r => r.size === p.size)?.type ?? c.node_type;
        }
    }
} state.generated_at = timestamp(); version++; }
/** Return undefined for unowned paths. Actor and auth_time must come from the central mock's validated bearer. */
export function handleOperationalFleetMock(path: string, method: string, body: Record<string, unknown> | undefined, params: Record<string, unknown> | undefined, actor: MockFleetActor | null | undefined, authTime?: number): unknown | undefined {
    if (path !== '/api/account/admin/dashboard' && !path.startsWith('/api/aws/capacity'))
        return undefined;
    if (!actor)
        return fail('authentication_required', 401);
    if (actor.credential_kind && ['api_key', 'group_scoped_token'].includes(actor.credential_kind))
        return fail('permission_denied', 403);
    if (path === '/api/account/admin/dashboard')
        return method === 'GET' ? (backendGlobalCan(actor, FLEET_DASHBOARD_GRANTS) ? ok(dashboard(actor)) : fail('permission_denied', 403)) : fail('not_found', 404);
    if (!backendGlobalCan(actor, 'manage_aws'))
        return fail('permission_denied', 403, 'Global manage_aws required.');
    if (method === 'GET' && path === '/api/aws/capacity') {
        if (scenario === 'inventory-unavailable')
            return fail('provider_unavailable', 503, 'Capacity inventory is temporarily unavailable.');
        state.generated_at = timestamp();
        return ok(state);
    }
    if (method === 'GET' && path === '/api/aws/capacity/status') {
        if (scenario === 'status-unavailable')
            return fail('provider_unavailable', 503);
        const row = batches.get(String(params?.batch ?? ''));
        if (!row)
            return fail('batch_not_found', 404);
        if (row.batch.actor !== actor.id)
            return fail('permission_denied', 403);
        row.reads++;
        if (scenario === 'stalled') {
            row.batch.stalled = true;
            row.batch.message = 'Batch stalled: inspect the jobs runner and cleanup channel.';
        }
        else if (row.reads >= 3 && !row.applied) {
            row.batch.state = scenario === 'failed' ? 'failed' : 'done';
            row.batch.message = scenario === 'failed' ? 'A step failed; completed changes remain applied.' : 'Every capacity step completed and was observed.';
            row.batch.error_code = scenario === 'failed' ? 'terminate_failed' : null;
            row.batch.steps.forEach((s, i) => { s.state = scenario === 'failed' ? (i === 0 ? 'done' : i === 1 ? 'failed' : 'not_attempted') : 'done'; s.phase = s.state === 'done' ? 'observed' : null; s.error_code = s.state === 'failed' ? 'terminate_failed' : null; s.operation = `mock-operation-${row.batch.id}-${i}`; });
            applyInventory(row.batch);
            row.applied = true;
        }
        else if (row.batch.state === 'running') {
            row.batch.steps[0]!.state = 'running';
            row.batch.steps[0]!.phase = 'settling';
            row.batch.steps[0]!.operation = `mock-operation-${row.batch.id}-0`;
        }
        return ok(row.batch);
    }
    if (method !== 'POST')
        return fail('not_found', 404);
    if (state.mode === 'external')
        return fail('infrastructure_external', 403);
    if (actor.is_superuser !== true)
        return fail('superuser_required', 403);
    if (scenario === 'reauth' || typeof authTime !== 'number' || Date.now() / 1000 - authTime > 600)
        return fail('reauth_required', 440, 'reauth_required');
    if (path === '/api/aws/capacity/plan') {
        try {
            const plan = serverPlan(actor, body?.steps);
            plans.set(plan.id, { plan, version });
            return ok(plan);
        }
        catch (e) {
            return fail('invalid_request', 400, e instanceof Error ? e.message : 'Invalid plan.');
        }
    }
    if (path === '/api/aws/capacity/plan/apply') {
        if (!body || Object.keys(body).length !== 1 || typeof body.plan_id !== 'string')
            return fail('invalid_request', 400, 'Submit only plan_id.');
        const stored = plans.get(body.plan_id);
        if (!stored || Date.parse(stored.plan.expires_at) <= Date.now())
            return fail('plan_not_found', 404);
        if (stored.plan.actor !== actor.id)
            return fail('permission_denied', 403);
        if (scenario === 'stale-plan' || stored.version !== version)
            return fail('plan_stale', 409);
        const prior = claimed.get(body.plan_id);
        if (prior)
            return fail('plan_already_applied', 409, 'Plan already applied.', { batch: prior });
        const batch: CapacityBatch = { schema_version: 2, id: `mock-batch-${++sequence}`, plan_id: body.plan_id, actor: actor.id, state: 'running', started: timestamp(), current_index: 0, message: 'Requested; waiting for provider observation.', error_code: null, stalled: false, steps: stored.plan.steps.map(s => ({ index: s.index, action: s.action, resource: s.resource, description: s.description, state: 'pending', operation: null, phase: null, message: null, error_code: null })) };
        claimed.set(body.plan_id, batch.id);
        batches.set(batch.id, { batch, reads: 0, applied: false });
        if (scenario === 'duplicate')
            return fail('plan_already_applied', 409, 'Plan already applied.', { batch: batch.id });
        if (scenario === 'uncertain-apply')
            throw new TypeError('Mock response lost after batch submission. Inspect mock server batch records.');
        return ok(batch);
    }
    return fail('not_found', 404);
}
/** Test/debug observation only: IDs, never an alternate apply path. */
export const getMockOperationalFleetBatchIds = () => [...batches.keys()];
