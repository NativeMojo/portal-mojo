import { mojoCall, type FetchOpts } from '../../client/runtime';
import type { FleetDashboard, CapacityReport, CapacityPlan, CapacityBatch, CapacityAction, FleetFacts } from './types';
export const FLEET_DASHBOARD_ENDPOINT = '/api/account/admin/dashboard';
export const CAPACITY_ENDPOINT = '/api/aws/capacity';
const actions = new Set(['add_node', 'drain_node', 'terminate_node', 'add_reader', 'remove_reader', 'set_cache_replicas', 'resize_cache', 'resize_database']);
export function object(value: unknown): FleetFacts { if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Fleet response is not an object.'); return value as FleetFacts; }
const text = (v: unknown): string => { if (typeof v !== 'string' || !v.trim())
    throw new Error('Fleet response is missing required text.'); return v; };
const nullable = (v: unknown): string | null => typeof v === 'string' ? v : null;
const bool = (v: unknown) => v === true;
const number = (v: unknown): number => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
    throw new Error('Fleet response has an invalid number.'); return v; };
const price = (v: unknown): number | null => v === null ? null : typeof v === 'number' && Number.isFinite(v) ? v : (() => { throw new Error('Fleet response has an invalid price.'); })();
const array = (v: unknown): unknown[] => { if (!Array.isArray(v))
    throw new Error('Fleet response is missing a list.'); return v; };
const strings = (v: unknown) => array(v).map(text);
function schema(v: unknown): FleetFacts { const o = object(v); if (o.schema_version !== 2)
    throw new Error('This fleet API requires schema version 2. Upgrade the backend and refresh.'); return o; }
function action(v: unknown): CapacityAction { const a = text(v); if (!actions.has(a))
    throw new Error('Fleet response contains an unsupported action.'); return a as CapacityAction; }
const dashboardFields: Record<string, readonly string[]> = { load_balancer: ['configured', 'registered', 'healthy', 'balancer', 'elastic_ip_missing'], compute: ['total', 'up', 'source', 'instances'], database: ['reachable', 'vendor', 'engine', 'version', 'drift'], cache: ['reachable', 'engine', 'version', 'memory_used'], certificates: ['total', 'active', 'failing', 'expiring_within_30_days', 'soonest_renew', 'soonest_expiry'], public_api: ['configured', 'node_version', 'probe'], framework: ['installed', 'latest', 'update_available', 'pin'], last_deployment: ['items'], jobs: ['scheduler_active', 'jobs', 'failed_recent'], sanity: ['checks'], incidents: ['open', 'oldest_created', 'oldest_age_days'], tickets: ['open', 'oldest_created', 'oldest_age_days'], sms: ['configured', 'provider', 'test_mode', 'verified'], email: ['configured', 'domains', 'sendable_domains', 'default_sender', 'problems'] };
const nestedFields = new Set(['name', 'type', 'scheme', 'state', 'elastic_ips', 'addresses', 'ip', 'address', 'zone', 'id', 'healthy', 'available_major', 'deadline', 'note', 'ok', 'status', 'http_status', 'version', 'mode', 'sha', 'created', 'finished', 'actor', 'pending', 'running', 'failed', 'checked_at', 'message']);
function projectFacts(raw: FleetFacts, fields: readonly string[]): FleetFacts {
    const safe = (v: unknown, depth: number): unknown => { if (v == null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v))
        return v; if (depth > 4)
        return null; if (Array.isArray(v))
        return v.slice(0, 200).map(x => safe(x, depth + 1)); if (v && typeof v === 'object')
        return Object.fromEntries(Object.entries(v).filter(([k]) => nestedFields.has(k)).map(([k, x]) => [k, safe(x, depth + 1)])); return null; };
    return Object.fromEntries(Object.entries(raw).filter(([key]) => fields.includes(key)).map(([key, value]) => [key, safe(value, 0)]));
}
export function parseFleetDashboard(v: unknown): FleetDashboard {
    const o = schema(v), availability = object(o.availability), sources = { ...object(o.sources) };
    for (const name of Object.keys(dashboardFields))
        if (!Object.hasOwn(sources, name))
            sources[name] = { status: 'unknown', observed_at: null, stale_after: null, reason: 'source_missing', data: {} };
    if (!['ok', 'down', 'unknown'].includes(String(availability.state)))
        throw new Error('Fleet availability is unknown to this client.');
    return { schema_version: 2, observed_at: text(o.observed_at), availability: { state: availability.state as 'ok' | 'down' | 'unknown', message: text(availability.message), down: strings(availability.down) }, attention: { message: nullable(object(o.attention).message) }, sources: Object.fromEntries(Object.entries(sources).map(([key, value]) => { const row = object(value); return [key, { status: text(row.status), observed_at: nullable(row.observed_at), stale_after: nullable(row.stale_after), reason: nullable(row.reason), data: projectFacts(object(row.data), dashboardFields[key] ?? []) }]; })) };
}
export function parseCapacity(v: unknown): CapacityReport {
    const o = schema(v), n = object(o.nodes), sizes = object(o.sizes), e = object(o.egress), routing = object(o.reader_routing), dbRouting = object(routing.database), cacheRouting = object(routing.redis);
    const ladder = (v: unknown) => array(v).map(value => { const r = object(value); return { size: text(r.size), label: text(r.label), type: text(r.type), monthly_usd: price(r.monthly_usd) }; });
    const addresses = (v: unknown) => array(v).map(value => { const r = object(value); return { instance: text(r.instance), public_ip: text(r.public_ip), managed: bool(r.managed) }; });
    return { schema_version: 2, mode: text(o.mode), region: text(o.region), generated_at: text(o.generated_at), identity_available: bool(o.identity_available), identity: o.identity == null ? null : { project: text(object(o.identity).project), environment: text(object(o.identity).environment) }, node_id_pinned: bool(o.node_id_pinned),
        nodes: { self: nullable(n.self), self_check: text(n.self_check), serving_available: bool(n.serving_available), inventory_available: bool(n.inventory_available), instances: array(n.instances).map(value => { const r = object(value); return { id: text(r.id), name: text(r.name), state: text(r.state), instance_state: nullable(r.instance_state), lifecycle_state: text(r.lifecycle_state), instance_type: nullable(r.instance_type), zone: nullable(r.zone), subnet_id: nullable(r.subnet_id), public_ip: nullable(r.public_ip), healthy: bool(r.healthy), registered: bool(r.registered), can_drain: bool(r.can_drain), self: bool(r.self), primary: bool(r.primary), added_by_capacity: bool(r.added_by_capacity), stable_ip: bool(r.stable_ip), groups: strings(r.groups) }; }) },
        databases_available: bool(o.databases_available), caches_available: bool(o.caches_available),
        databases: array(o.databases).map(value => { const r = object(value); if (!['aurora', 'standalone'].includes(String(r.kind)))
            throw new Error('Unsupported database kind.'); return { identifier: text(r.identifier), kind: r.kind as 'aurora' | 'standalone', engine: text(r.engine), status: text(r.status), writer: nullable(r.writer), readers: strings(r.readers), instance_class: nullable(r.instance_class), writer_instance_class: nullable(r.writer_instance_class), reader_instance_classes: Object.fromEntries(Object.entries(object(r.reader_instance_classes)).map(([k, v]) => [k, text(v)])), blocked_reason: nullable(r.blocked_reason), members: array(r.members).map(value => { const m = object(value); return { id: text(m.id), role: text(m.role), status: text(m.status), lifecycle_state: text(m.lifecycle_state), instance_class: nullable(m.instance_class), can_resize: bool(m.can_resize), can_remove: bool(m.can_remove) }; }) }; }),
        caches: array(o.caches).map(value => { const r = object(value); if (!['rolling', 'downtime'].includes(String(r.resize_impact)))
            throw new Error('Cache resize impact is unavailable.'); return { identifier: text(r.identifier), status: text(r.status), node_type: text(r.node_type), replica_count: number(r.replica_count), min_replicas: number(r.min_replicas), resize_impact: r.resize_impact as 'rolling' | 'downtime', blocked_reason: nullable(r.blocked_reason), members: array(r.members).map(value => { const m = object(value); return { id: text(m.id), role: text(m.role), status: text(m.status), lifecycle_state: text(m.lifecycle_state) }; }) }; }),
        sizes: { database: ladder(sizes.database), cache: ladder(sizes.cache) }, actions: Object.fromEntries(Object.entries(object(o.actions)).map(([key, value]) => { const r = object(value); return [key, { offered: bool(r.offered), blocked_reason: nullable(r.blocked_reason) }]; })), warnings: array(o.warnings).map(value => { const r = object(value); return { code: text(r.code), message: text(r.message), iam_action: nullable(r.iam_action) }; }),
        reader_routing: { database: { active: bool(dbRouting.active), host: nullable(dbRouting.host), skip_reason: nullable(dbRouting.skip_reason), matches_reader_endpoint: typeof dbRouting.matches_reader_endpoint === 'boolean' ? dbRouting.matches_reader_endpoint : null }, redis: { active: bool(cacheRouting.active) } },
        egress: { available: bool(e.available), fleet_available: bool(e.fleet_available), addresses_available: bool(e.addresses_available), policy_available: bool(e.policy_available), enabled: bool(e.enabled), addresses: strings(e.addresses), attached: addresses(e.attached), fallback_attached: addresses(e.fallback_attached), reserved: array(e.reserved).map(value => ({ public_ip: text(object(value).public_ip) })), pending_nodes: strings(e.pending_nodes) } };
}
export function parseCapacityPlan(v: unknown): CapacityPlan {
    const o = schema(v);
    const expires_at = text(o.expires_at);
    if (!Number.isFinite(Date.parse(expires_at)))
        throw new Error('Plan expiry is unavailable.');
    const steps = array(o.steps).map(value => { const r = object(value); return { index: number(r.index), action: action(r.action), resource: typeof r.resource === 'string' ? r.resource : '', description: text(r.description), kind: text(r.kind), params: object(r.params), warnings: strings(r.warnings), monthly_delta_usd: price(r.monthly_delta_usd) }; });
    if (!steps.length || steps.length > 20)
        throw new Error('Plan exceeds the supported 20 steps.');
    return { schema_version: 2, id: text(o.id), actor: number(o.actor), created: typeof o.created === 'number' ? o.created : text(o.created), expires_at, expires_in: number(o.expires_in), steps, total_monthly_delta_usd: price(o.total_monthly_delta_usd), estimate_complete: bool(o.estimate_complete), order_note: text(o.order_note) };
}
export function parseCapacityBatch(v: unknown): CapacityBatch {
    const o = schema(v);
    const steps = array(o.steps).map(value => { const r = object(value); return { index: number(r.index), action: action(r.action), resource: typeof r.resource === 'string' ? r.resource : '', description: text(r.description), state: text(r.state), operation: nullable(r.operation), phase: nullable(r.phase), message: nullable(r.message), error_code: nullable(r.error_code) }; });
    if (!steps.length || steps.length > 20)
        throw new Error('Batch step count is invalid.');
    return { schema_version: 2, id: text(o.id), plan_id: text(o.plan_id), actor: number(o.actor), state: text(o.state), started: typeof o.started === 'number' ? o.started : text(o.started), current_index: number(o.current_index), message: nullable(o.message), error_code: nullable(o.error_code), stalled: bool(o.stalled), steps };
}
export async function readFleetDashboard(refresh = false, opts: FetchOpts = {}) { return parseFleetDashboard((await mojoCall(FLEET_DASHBOARD_ENDPOINT, { ...opts, params: { refresh: refresh ? 1 : undefined } })).data); }
export async function readCapacity(refresh = false, opts: FetchOpts = {}) { return parseCapacity((await mojoCall(CAPACITY_ENDPOINT, { ...opts, params: { refresh: refresh ? 1 : undefined } })).data); }
export async function requestCapacityPlan(steps: unknown[], opts: FetchOpts = {}) { return parseCapacityPlan((await mojoCall(`${CAPACITY_ENDPOINT}/plan`, { ...opts, method: 'POST', body: { steps } })).data); }
export async function applyCapacityPlan(planId: string, opts: FetchOpts = {}) { return parseCapacityBatch((await mojoCall(`${CAPACITY_ENDPOINT}/plan/apply`, { ...opts, method: 'POST', body: { plan_id: planId } })).data); }
export async function readCapacityBatch(id: string, opts: FetchOpts = {}) { return parseCapacityBatch((await mojoCall(`${CAPACITY_ENDPOINT}/status`, { ...opts, params: { batch: id } })).data); }
