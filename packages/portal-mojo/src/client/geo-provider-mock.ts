/** Fixture-only GeoLocation provider setup. No submitted credential is retained or observed. */
import type { GeoDraft, GeoLocationState, GeoVerdict, StoredGeoVerification } from '../admin/geolocation/data';
export const mockGeoProviderScenarios = ['ready', 'no-key', 'unknown-provider', 'empty-registry', 'unavailable', 'remote-error', 'rejected-key', 'missing-sync-permission', 'changed-origin', 'stale-revision', 'pending-restart', 'published-origin-pending', 'missing-delegation', 'old-api', 'malformed', 'fresh-auth', 'save-uncertain'] as const;
export type MockGeoProviderScenario = typeof mockGeoProviderScenarios[number];
const endpoint = '/api/account/admin/settings';
const keys = ['GEOIP_PRIMARY_PROVIDER', 'GEOIP_FALLBACK_PROVIDER', 'GEOIP_ADDITIONAL_PROVIDERS', 'GEOIP_MOJO_PROVIDER_URL', 'GEOIP_MOJO_SYNC_ENABLED'];
const defaults: GeoDraft = { GEOIP_PRIMARY_PROVIDER: 'mojo', GEOIP_FALLBACK_PROVIDER: 'ipinfo', GEOIP_ADDITIONAL_PROVIDERS: ['ip-api', 'maxmind'], GEOIP_MOJO_PROVIDER_URL: 'https://api.mojoverify.com', GEOIP_MOJO_SYNC_ENABLED: false };
const metadata = [
    ['Primary GeoIP provider', 'Provider queried first for IP intelligence.', 'string', 'Provider identifier'],
    ['Fallback GeoIP provider', 'Provider used when the primary cannot answer.', 'string', 'Provider identifier'],
    ['Additional GeoIP providers', 'Extra providers available after primary and fallback.', 'list', 'Unique provider identifiers'],
    ['Mojo GeoIP URL', 'Canonical HTTPS origin of the upstream django-mojo provider.', 'origin', 'One HTTPS origin'],
    ['Mojo GeoIP sync', 'Push observed abuse signals back to the upstream provider.', 'boolean', ''],
];
let scenario: MockGeoProviderScenario = 'ready', sequence = 1, publishedVersion = 1, usedFault = false;
let configurationRevision = '1'.repeat(32), publishedRevision = '1'.repeat(32), loadedRevision = '1'.repeat(32);
let values: GeoDraft = structuredClone(defaults), loadedOrigin = defaults.GEOIP_MOJO_PROVIDER_URL, loadedSync = false;
let keyConfigured = true, keyHint = '9f2c', stored: StoredGeoVerification | undefined;
const observations: { action: string; key_action: 'keep' | 'replace' | 'clear'; stored_test: boolean; expected_revision: string | null }[] = [];
export function setMockGeoProviderScenario(value: MockGeoProviderScenario): void {
    if (!mockGeoProviderScenarios.includes(value)) throw new Error('Unknown GeoLocation fixture');
    scenario = value; usedFault = false; sequence = 1; publishedVersion = 1; configurationRevision = publishedRevision = loadedRevision = '1'.repeat(32);
    values = structuredClone(defaults); loadedOrigin = defaults.GEOIP_MOJO_PROVIDER_URL; loadedSync = false; keyConfigured = true; keyHint = '9f2c'; observations.length = 0;
    stored = { ok: true, code: null, message: 'Connection verified', at: '2026-10-21T12:00:00Z' };
    if (value === 'no-key') { keyConfigured = false; keyHint = ''; stored = undefined; }
    if (value === 'unknown-provider') { values.GEOIP_PRIMARY_PROVIDER = 'custom_geo'; values.GEOIP_ADDITIONAL_PROVIDERS = ['custom_extra', 'maxmind']; }
    if (['pending-restart', 'published-origin-pending', 'changed-origin'].includes(value)) { publishedRevision = configurationRevision = '2'.repeat(32); }
    if (['published-origin-pending', 'changed-origin'].includes(value)) loadedOrigin = 'https://legacy-geo.example.invalid';
}
export const getMockGeoProviderScenario = (): MockGeoProviderScenario => scenario;
export const getMockGeoProviderObservations = () => observations.map(row => ({ ...row }));
export const clearMockGeoProviderObservations = () => { observations.length = 0; };
export function geoProviderSetupMock(): GeoLocationState {
    return { available: scenario !== 'unavailable', bucket_configured: scenario !== 'unavailable', restart_configured: true, object_key: 'fixture/config/django.override.json',
        delegated_keys: keys.filter(key => scenario !== 'missing-delegation' || key !== keys[2]), fleet_fields: keys.map((key, i) => ({ key, label: metadata[i]![0]!, description: metadata[i]![1]!, value_type: metadata[i]![2]!, constraints: metadata[i]![3]! })),
        loaded_revision: loadedRevision, published_revision: publishedRevision, configuration_revision: configurationRevision, published_version: `fixture-version-${publishedVersion}`, pending_restart: publishedRevision !== loadedRevision,
        remote_error: scenario === 'remote-error' ? 'FixtureRemoteReadError' : null, geoip: { ...structuredClone(values), GEOIP_API_KEY_MOJO_CONFIGURED: keyConfigured, GEOIP_API_KEY_MOJO_HINT: keyHint },
        geoip_providers: scenario === 'empty-registry' ? [] : ['maxmind', 'ipinfo', 'ipstack', 'ip-api', 'mojo'], verify_state: stored ? { geoip: { ...stored } } : {} };
}
const fail = (error: string, code = 400) => ({ status: false, code, error_code: code, error });
const provider = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(v);
function origin(v: unknown): v is string {
    if (typeof v !== 'string' || v.length > 512) return false;
    try { const u = new URL(v); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password && !u.search && !u.hash && ['', '/'].includes(u.pathname) && (!u.port || u.port === '443'); } catch { return false; }
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Undefined means another topic/route owns the request. The central mock supplies session gates. */
export function geoProviderMock(path: string, method: string, body: Record<string, unknown> | undefined, superuser: boolean): unknown {
    if (path !== endpoint) return undefined;
    if (method !== 'GET' && body?.topic !== 'geoip') return undefined;
    if (!superuser) return fail('Superuser required', 403);
    if (scenario === 'old-api') return fail('Not found', 404);
    if (method === 'GET') return { status: true, data: { schema_version: scenario === 'malformed' ? 999 : 1, provider_setup: geoProviderSetupMock() } };
    if (method !== 'POST' || !body || Object.keys(body).sort().join(',') !== 'action,providers,topic' || !['test_providers', 'configure_providers'].includes(String(body.action))) return fail('Provider setup accepts only action, topic, and providers');
    const p = body.providers;
    if (!record(p) || Object.keys(p).some(k => !['expected_revision', 'geoip'].includes(k)) || !record(p.geoip)) return fail('Provider setup accepts only geoip and expected_revision');
    const g = p.geoip;
    if (Object.keys(g).some(k => ![...keys, 'GEOIP_API_KEY_MOJO', 'clear_api_key'].includes(k))) return fail('GeoIP setup contains unsupported fields');
    const candidate = { ...defaults, GEOIP_ADDITIONAL_PROVIDERS: [], GEOIP_MOJO_PROVIDER_URL: 'https://api.mojoverify.com', ...g };
    if (!provider(candidate.GEOIP_PRIMARY_PROVIDER) || !provider(candidate.GEOIP_FALLBACK_PROVIDER) || !Array.isArray(candidate.GEOIP_ADDITIONAL_PROVIDERS) || candidate.GEOIP_ADDITIONAL_PROVIDERS.length > 16 || !candidate.GEOIP_ADDITIONAL_PROVIDERS.every(provider) || new Set(candidate.GEOIP_ADDITIONAL_PROVIDERS).size !== candidate.GEOIP_ADDITIONAL_PROVIDERS.length || !origin(candidate.GEOIP_MOJO_PROVIDER_URL) || typeof candidate.GEOIP_MOJO_SYNC_ENABLED !== 'boolean') return fail('Invalid GeoIP provider settings');
    if (p.expected_revision != null && (typeof p.expected_revision !== 'string' || !/^[a-f0-9]{32,64}$/.test(p.expected_revision))) return fail('Provider setup revision is invalid');
    if (g.GEOIP_API_KEY_MOJO != null && (typeof g.GEOIP_API_KEY_MOJO !== 'string' || g.GEOIP_API_KEY_MOJO.length > 4096)) return fail('GeoIP API key is invalid');
    if (scenario === 'missing-delegation' || body.action === 'configure_providers' && ['unavailable', 'remote-error'].includes(scenario)) return fail('Fleet publishing requires its exact object, all provider delegations, a KMS key, and config-sync restart');
    if (scenario === 'fresh-auth' && !usedFault) { usedFault = true; return fail('Fresh authentication required', 440); }
    const next: GeoDraft = { GEOIP_PRIMARY_PROVIDER: candidate.GEOIP_PRIMARY_PROVIDER, GEOIP_FALLBACK_PROVIDER: candidate.GEOIP_FALLBACK_PROVIDER, GEOIP_ADDITIONAL_PROVIDERS: [...candidate.GEOIP_ADDITIONAL_PROVIDERS], GEOIP_MOJO_PROVIDER_URL: candidate.GEOIP_MOJO_PROVIDER_URL.replace(/\/$/, ''), GEOIP_MOJO_SYNC_ENABLED: candidate.GEOIP_MOJO_SYNC_ENABLED };
    const clear = g.clear_api_key === true, typed = typeof g.GEOIP_API_KEY_MOJO === 'string' && g.GEOIP_API_KEY_MOJO !== '';
    // The real predicate ignores primary/fallback/additional differences and compares NODE-LOADED connection facts.
    const testedStored = !clear && !typed && next.GEOIP_MOJO_PROVIDER_URL === loadedOrigin && next.GEOIP_MOJO_SYNC_ENABLED === loadedSync;
    observations.push({ action: String(body.action), key_action: clear ? 'clear' : typed ? 'replace' : 'keep', stored_test: testedStored, expected_revision: p.expected_revision == null ? null : String(p.expected_revision) });
    const accepted = scenario !== 'rejected-key' && (typed ? !String(g.GEOIP_API_KEY_MOJO).startsWith('rejected') : keyConfigured && next.GEOIP_MOJO_PROVIDER_URL === loadedOrigin);
    const result: GeoVerdict = clear ? { success: true, code: 'clear_requested', message: 'GeoIP credential will be cleared' } : accepted && next.GEOIP_MOJO_SYNC_ENABLED && scenario === 'missing-sync-permission' ? { success: false, code: 'insufficient_permission', message: `${new URL(next.GEOIP_MOJO_PROVIDER_URL).hostname} accepted the key, but it is missing geoip_sync` } : accepted ? { success: true, code: null, message: 'Connection verified' } : { success: false, code: 'http_401', message: `${new URL(next.GEOIP_MOJO_PROVIDER_URL).hostname} rejected the API key` };
    const remember = () => { stored = { ok: result.success, code: result.code, message: result.message, at: new Date().toISOString() }; };
    if (body.action === 'test_providers') { if (testedStored) remember(); return { status: true, tested: true, topic: 'geoip', results: { geoip: result }, success: result.success }; }
    if (!result.success) return fail('Provider verification failed for geoip');
    if (p.expected_revision !== configurationRevision || scenario === 'stale-revision' && !usedFault) { usedFault = true; configurationRevision = '3'.repeat(32); return fail('Provider configuration changed; reload before publishing'); }
    const changed = JSON.stringify(next) !== JSON.stringify(values);
    if (clear) { keyConfigured = false; keyHint = ''; } else if (typed) { keyConfigured = true; keyHint = String(g.GEOIP_API_KEY_MOJO).length >= 8 ? String(g.GEOIP_API_KEY_MOJO).slice(-4) : ''; }
    values = next; configurationRevision = (++sequence).toString(16).padStart(32, '0'); if (changed) { publishedRevision = configurationRevision; publishedVersion++; } remember();
    if (scenario === 'save-uncertain' && !usedFault) { usedFault = true; return fail('Connection unavailable after persistence', 503); }
    return { status: true, published: changed, unchanged: !changed, topic: 'geoip', revision: configurationRevision, published_revision: publishedRevision, version_id: `fixture-version-${publishedVersion}`, pending_restart: publishedRevision !== loadedRevision, results: { geoip: result } };
}
setMockGeoProviderScenario('ready');
