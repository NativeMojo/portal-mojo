// Mock-only executable Fleet Configuration contract. Never imported by packaged runtime.
import type { FleetEntry, FleetState, FleetOperation, FleetChanges } from '../admin/fleet-configuration/data';
const health_scope = 'request_service_jobs_and_dependencies';
const endpoint = '/api/account/admin/fleet';
const entries: FleetEntry[] = [
    { key: 'GEOIP_SMART_ENABLED', label: 'Smart IP lookup', section: 'Location', description: 'Enable registered IP lookup providers.', value_type: 'boolean', default: true, current: true, sensitive: false, restart_required: true, overridden: true },
    { key: 'EXAMPLE_WORKER_LIMIT', label: 'Worker limit', section: 'Application', description: 'Example application-owned setting.', value_type: 'integer', default: 4, current: 4, min_value: 1, max_value: 32, sensitive: false, restart_required: true, overridden: true },
    { key: 'EXAMPLE_SERVICE_TOKEN', label: 'Service token', section: 'Application', description: 'Write-only credential for the example service.', value_type: 'string', sensitive: true, configured: true, restart_required: true, overridden: true },
];
for (const [key, label] of [['DNSMAN_ACME_HUB_PROFILE_ID', 'Approved hub profile'], ['DNSMAN_ACME_HUB_URL', 'Approved hub origin'], ['DNSMAN_ACME_HUB_API_KEY', 'Protected recipient credential']]) entries.push({ key, label, section: 'Shared validation', description: 'Managed connection; use its protected topic.', value_type: 'string', sensitive: key.endsWith('API_KEY'), configured: true, restart_required: true, overridden: false });
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
    if (path === `${endpoint}/shared-validation/hub`) return hubMock(method, body);
    if (path === `${endpoint}/shared-validation`) return connectionMock(method, body);
    if (method === 'GET' && path === endpoint) {
        const state: FleetState = { schema_version: 1, revision, version_id: versions[0].version_id, entries: entries.map(entry => ({ ...entry,
            overridden: entry.key in values, ...(entry.sensitive ? { configured: Boolean(values[entry.key]) } : { current: values[entry.key] ?? entry.default }) })),
            published: true, loaded_revision: null, pending_restart: true, publish_configured: true,
            fleet: { status: 'pending', health_scope, nodes: nodes(revision), healthy_everywhere: false, observed_at: new Date().toISOString() } };
        return ok(state);
    }
    if (method === 'GET' && path === `${endpoint}/history`) return ok({ versions: versions.map((version, index) => ({ version_id: version.version_id, current: index === 0, published_at: version.published_at })), truncated: false });
    if (method === 'GET' && path === `${endpoint}/operation/${operation?.operation_id}`) {
        if (connectionApplied && operation) { operation = { ...operation, status: ++applyReads >= 3 && scenario !== 'offline' ? 'healthy' : 'pending', nodes: connectionNodes(applyReads >= 3), healthy_everywhere: applyReads >= 3 && !['offline', 'stale-proof', 'draining'].includes(scenario) }; }
        return ok(operation);
    }
    if (method !== 'POST' || path !== endpoint || !body) return fail('Not found', 404);
    if (body.expected_revision !== revision) return fail('Fleet configuration changed; reload before publishing', 409);
    if (body.action === 'apply') {
        operation = { health_scope, operation_id: 'a'.repeat(32), revision, status: 'timed_out', job_status: 'completed', nodes: nodes(revision), healthy_everywhere: false };
        if (connectionPublished) { connectionApplied = true; applyReads = 0; operation = { ...operation, status: 'pending', nodes: connectionNodes(false) }; }
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
            if (key.startsWith('DNSMAN_ACME_HUB_')) return connectionFail('hub_identity_migration_required', 409);
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

export const mockConnectionScenarios = ['ready', 'old-api', 'unavailable', 'dnsman-absent', 'empty-catalog', 'sharing-disabled', 'identity-mismatch', 'busy', 'catalog-conflict', 'revision-conflict', 'publication-uncertain', 'offline', 'draining', 'stale-proof', 'malformed', 'recipient-denied', 'recipient-renamed', 'issue-uncertain', 'reauth', 'disable-ineligible', 'hub-ready', 'hub-unconfigured', 'hub-no-deployment', 'hub-upgrade-required', 'hub-incomplete', 'hub-conflict', 'hub-reauth', 'hub-uncertain'] as const;
export type MockConnectionScenario = typeof mockConnectionScenarios[number];
let scenario: MockConnectionScenario = 'ready', faultUsed = false, connectionPublished = false, connectionApplied = false, applyReads = 0;
let profile = { id: 'approved_hub', label: 'Approved existing validation hub', origin: 'https://hub.example', consumer_project_uuid: '1'.repeat(32), consumer_label: 'Original recipient' };
let catalogRevision = 'a'.repeat(64), credential = 'mock_protected_consumer', disabled = false;
let hubEnabled = true;
const hubDeployment = '99999999-9999-4999-8999-999999999999';
const keyIdentities = new Map<string, string>();
export function setMockConnectionScenario(value: MockConnectionScenario) {
    if (!mockConnectionScenarios.includes(value)) throw new Error('Unknown mock connection scenario');
    scenario = value; faultUsed = false; connectionPublished = false; connectionApplied = false; applyReads = 0; disabled = false; credential = 'mock_protected_consumer'; catalogRevision = 'a'.repeat(64); operation = null;
    hubEnabled = value !== 'sharing-disabled' && value !== 'empty-catalog' && !value.startsWith('hub-');
}
export const getMockConnectionScenario = () => scenario;
export function configureMockHubRecipient(consumer_project_uuid: string, consumer_label: string) { profile = { ...profile, consumer_project_uuid, consumer_label }; }
export function registerMockConsumerKey(secret: string, consumer: string) { keyIdentities.set(secret, consumer); }
export const consumeMockConnectionFault = (value: MockConnectionScenario) => { if (scenario !== value || faultUsed) return false; faultUsed = true; return true; };
export const connectionFail = (code: string, status: number) => ({ status: false, code: status, error_code: code, error: code });
const observed = (includeProfile = true) => ({ state: disabled ? 'disabled' : 'verified', ...(includeProfile ? { profile_id: disabled ? null : profile.id } : {}), observed_project_uuid: disabled ? null : profile.consumer_project_uuid, checked_at: new Date().toISOString(), error_code: null, sharing_ready: !disabled && hubEnabled });
function hubMock(method: string, body?: Record<string, unknown>) {
    if (scenario === 'old-api') return connectionFail('not_found', 404);
    const configured = scenario !== 'hub-unconfigured';
    const reason = !configured ? 'hub_unconfigured' : scenario === 'hub-no-deployment' ? 'deployment_required' : scenario === 'hub-upgrade-required' ? 'framework_upgrade_required' : scenario === 'hub-incomplete' ? 'deployment_proof_unavailable' : null;
    if (method === 'POST') {
        if (!body || Object.keys(body).length !== 1 || typeof body.deployment_uuid !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.deployment_uuid)) return connectionFail('invalid_request', 400);
        if (consumeMockConnectionFault('hub-reauth')) return connectionFail('fresh_auth_required', 440);
        if (body.deployment_uuid !== hubDeployment || consumeMockConnectionFault('hub-conflict')) return connectionFail('deployment_changed', 409);
        if (reason) return connectionFail(reason, 409);
        hubEnabled = true;
        if (consumeMockConnectionFault('hub-uncertain')) return connectionFail('hub_unavailable', 503);
    } else if (method !== 'GET') return connectionFail('not_found', 404);
    return ok({ version: 1, enabled: hubEnabled, configured, deployment_uuid: scenario === 'hub-no-deployment' ? null : hubDeployment, can_enable: !hubEnabled && !reason, reason: hubEnabled ? null : reason });
}
function connectionNodes(healthy: boolean) {
    return nodes(revision, healthy).map((n, index) => ({ ...n, ...(scenario === 'offline' && index === 1 ? { installed: false, restarted: false, healthy: false, status: 'unknown', error_code: 'node_did_not_reply' } : {}), ...(scenario === 'draining' ? { healthy: false, status: 'draining', error_code: 'engine_draining' } : {}), shared_validation: n.installed ? { ...observed(), ...(scenario === 'stale-proof' ? { observed_project_uuid: '0'.repeat(32) } : {}) } : null }));
}
function connectionMock(method: string, body?: Record<string, unknown>) {
    if (scenario === 'old-api') return connectionFail('not_found', 404);
    if (method === 'GET') {
        const unavailable = ['unavailable', 'dnsman-absent', 'empty-catalog'].includes(scenario);
        const report = { status: connectionApplied ? (applyReads >= 3 ? 'healthy' : 'pending') : 'pending', nodes: connectionNodes(connectionApplied && applyReads >= 3), healthy_everywhere: connectionApplied && applyReads >= 3 && !['offline', 'draining', 'stale-proof'].includes(scenario), health_scope, observed_at: new Date().toISOString() };
        return ok({ schema_version: scenario === 'malformed' ? 99 : 1, available: !unavailable, unavailable_reasons: unavailable ? [scenario === 'dnsman-absent' ? 'dnsman_unavailable' : scenario === 'empty-catalog' ? 'profile_catalog_unavailable' : 'publisher_unavailable'] : [], catalog_revision: catalogRevision, profiles: scenario === 'empty-catalog' ? [] : [profile], selected_profile_id: disabled || scenario === 'empty-catalog' ? null : profile.id, expected_identity: disabled || scenario === 'empty-catalog' ? null : { consumer_project_uuid: profile.consumer_project_uuid, consumer_label: profile.consumer_label }, loaded_identity: observed(), credential: { configured: !!credential, source: connectionPublished ? 'published' : 'static', overridden: connectionPublished }, revision, loaded_revision: connectionApplied && applyReads >= 3 ? revision : null, pending_restart: !connectionApplied || applyReads < 3, fleet: report, setup_destination: { route: 'setup', section: 'aws', capacity_route: 'capacity', actor: 'deployment_operator', adoption_item: 8903 } });
    }
    if (method !== 'POST' || !body || Object.keys(body).some((key) => !['action', 'expected_revision', 'expected_catalog_revision', 'profile_id', 'key_action', 'replacement_key'].includes(key)) || !['preview', 'publish'].includes(String(body.action)) || !['keep', 'replace', 'clear'].includes(String(body.key_action)) || 'replacement_key' in body && body.key_action !== 'replace') return connectionFail('invalid_request', 400);
    if (consumeMockConnectionFault('reauth')) return connectionFail('fresh_auth_required', 440);
    if (consumeMockConnectionFault('busy')) return connectionFail('configuration_busy', 409);
    if (consumeMockConnectionFault('catalog-conflict')) { catalogRevision = 'b'.repeat(64); return connectionFail('profile_catalog_changed', 409); }
    if (consumeMockConnectionFault('revision-conflict')) { revision = (++sequence).toString(16).padStart(32, '0'); return connectionFail('fleet_revision_changed', 409); }
    if (body.expected_revision !== revision) return connectionFail('fleet_revision_changed', 409);
    if (body.expected_catalog_revision !== catalogRevision) return connectionFail('profile_catalog_changed', 409);
    if (body.profile_id !== profile.id) return connectionFail('profile_not_approved', 400);
    if (['unavailable', 'dnsman-absent', 'empty-catalog'].includes(scenario)) return connectionFail('publisher_unavailable', 503);
    if (body.key_action === 'clear' && scenario === 'disable-ineligible') return connectionFail('connection_disable_ineligible', 409);
    const replacement = body.key_action === 'replace' ? String(body.replacement_key ?? '') : '';
    if (scenario === 'identity-mismatch' || replacement && (replacement === 'wrong-project-key' || keyIdentities.has(replacement) && keyIdentities.get(replacement) !== profile.consumer_project_uuid)) return connectionFail('hub_identity_mismatch', 400);
    const wasDisabled = disabled; disabled = body.key_action === 'clear';
    const result = { can_publish: true, revision, catalog_revision: catalogRevision, profile_id: disabled ? null : profile.id, expected_identity: disabled ? null : { consumer_project_uuid: profile.consumer_project_uuid, consumer_label: profile.consumer_label }, identity: observed(false), credential_changed: disabled ? !!credential : !!replacement && replacement !== credential, consequences: [disabled ? 'connection_disabled' : 'restart_required', 'apply_and_verify_every_expected_node', 'old_key_retirement_is_separate'] };
    if (body.action === 'preview') { disabled = wasDisabled; return ok(result); }
    credential = disabled ? '' : replacement || credential; connectionPublished = true; connectionApplied = false; revision = (++sequence).toString(16).padStart(32, '0');
    versions.unshift({ version_id: `mock-version-${sequence}`, revision, values: { ...values }, published_at: new Date().toISOString() });
    if (consumeMockConnectionFault('publication-uncertain')) return connectionFail('publication_uncertain', 503);
    return ok({ published: true, revision, version_id: versions[0].version_id, pending_restart: true, applied: false });
}
