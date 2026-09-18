// Mock-only executable Fleet Configuration contract. Never imported by packaged runtime.
import type { FleetEntry, FleetState, FleetOperation, FleetChanges } from '../admin/fleet-configuration/data';
const endpoint = '/api/account/admin/fleet';
const entries: FleetEntry[] = [
    { key: 'GEOIP_SMART_ENABLED', label: 'Smart IP lookup', section: 'Location', description: 'Enable registered IP lookup providers.', value_type: 'boolean', default: true, current: true, sensitive: false, restart_required: true, overridden: true },
    { key: 'EXAMPLE_WORKER_LIMIT', label: 'Worker limit', section: 'Application', description: 'Example application-owned setting.', value_type: 'integer', default: 4, current: 4, min_value: 1, max_value: 32, sensitive: false, restart_required: true, overridden: true },
    { key: 'EXAMPLE_SERVICE_TOKEN', label: 'Service token', section: 'Application', description: 'Write-only credential for the example service.', value_type: 'string', sensitive: true, configured: true, restart_required: true, overridden: true },
];
let sequence = 1;
let revision = sequence.toString(16).padStart(32, '0');
let values: Record<string, unknown> = { GEOIP_SMART_ENABLED: true, EXAMPLE_WORKER_LIMIT: 4, EXAMPLE_SERVICE_TOKEN: 'mock-private-value' };
const versions = [{ version_id: 'mock-version-1', revision, values: { ...values }, published_at: new Date().toISOString() }];
let operation: FleetOperation | null = null;
const nodes = (target: string, healthy = false) => ['node-a', 'node-b'].map((hostname, index) => ({ hostname, revision: target, published: true,
    installed: healthy || index === 0, restart_requested: healthy || index === 0, restarted: healthy,
    healthy, status: healthy ? 'healthy' : index === 0 ? 'pending' : 'unknown', error_code: healthy || index === 0 ? null : 'node_did_not_reply' }));
const ok = (data: unknown) => ({ status: true, data });
const fail = (error: string, error_code = 400) => ({ status: false, error, error_code });
export function fleetMock(path: string, method: string, body: Record<string, unknown> | undefined, superuser: boolean): unknown {
    if (!superuser) return fail('Superuser required', 403);
    if (method === 'GET' && path === endpoint) {
        const state: FleetState = { schema_version: 1, revision, version_id: versions[0].version_id, entries: entries.map(entry => ({ ...entry,
            overridden: entry.key in values, ...(entry.sensitive ? { configured: Boolean(values[entry.key]) } : { current: values[entry.key] ?? entry.default }) })),
            published: true, loaded_revision: null, pending_restart: true, publish_configured: true,
            fleet: { status: 'pending', nodes: nodes(revision), healthy_everywhere: false, observed_at: new Date().toISOString() } };
        return ok(state);
    }
    if (method === 'GET' && path === `${endpoint}/history`) return ok({ versions: versions.map((version, index) => ({ version_id: version.version_id, current: index === 0, published_at: version.published_at })), truncated: false });
    if (method === 'GET' && path === `${endpoint}/operation/${operation?.operation_id}`) return ok(operation);
    if (method !== 'POST' || path !== endpoint || !body) return fail('Not found', 404);
    if (body.expected_revision !== revision) return fail('Fleet configuration changed; reload before publishing', 409);
    if (body.action === 'apply') {
        operation = { operation_id: 'a'.repeat(32), revision, status: 'timed_out', job_status: 'completed', nodes: nodes(revision), healthy_everywhere: false };
        return ok(operation);
    }
    if (body.action === 'restore') {
        const prior = versions.find(version => version.version_id === body.version_id);
        if (!prior) return fail('Version not found');
        values = { ...prior.values };
    } else if (body.action === 'publish') {
        const changes = body.changes as FleetChanges;
        if (!changes || !Object.keys(changes).length) return fail('Changes are required');
        const next = { ...values };
        for (const [key, change] of Object.entries(changes)) {
            const entry = entries.find(item => item.key === key);
            if (!entry) return fail('Setting is not delegated');
            if (change.action === 'clear') delete next[key];
            else if (change.action === 'set') {
                if (entry.sensitive && change.value === '') continue;
                if (entry.value_type === 'integer' && (!Number.isSafeInteger(change.value) || Number(change.value) < 1 || Number(change.value) > 32)) return fail('Invalid setting value');
                if (entry.value_type === 'boolean' && typeof change.value !== 'boolean') return fail('Invalid setting value');
                next[key] = change.value;
            } else return fail('Invalid change');
        }
        values = next;
    } else return fail('Unsupported action');
    revision = (++sequence).toString(16).padStart(32, '0');
    versions.unshift({ version_id: `mock-version-${sequence}`, revision, values: { ...values }, published_at: new Date().toISOString() });
    return ok({ published: true, revision, version_id: versions[0].version_id, pending_restart: true, applied: false });
}
