/** Private GeoLocation protocol. Raw credentials never enter Query/Mutation state. */
import { mojoCall, MojoError } from '../../client/runtime';
import { OperatorError, operatorOrigin, type PrivateScope } from '../fleet-configuration/shared-validation-data';

export const GEOLOCATION_ENDPOINT = '/api/account/admin/settings';
export const GEOLOCATION_KEYS = ['GEOIP_PRIMARY_PROVIDER', 'GEOIP_FALLBACK_PROVIDER', 'GEOIP_ADDITIONAL_PROVIDERS', 'GEOIP_MOJO_PROVIDER_URL', 'GEOIP_MOJO_SYNC_ENABLED'] as const;
export interface GeoDraft {
    GEOIP_PRIMARY_PROVIDER: string;
    GEOIP_FALLBACK_PROVIDER: string;
    GEOIP_ADDITIONAL_PROVIDERS: string[];
    GEOIP_MOJO_PROVIDER_URL: string;
    GEOIP_MOJO_SYNC_ENABLED: boolean;
}
export interface GeoVerdict { success: boolean; code: string | null; message: string }
export interface StoredGeoVerification { ok: boolean; code: string | null; message: string; at: string }
export interface GeoField { key: string; label: string; description: string; value_type: string; constraints: string }
export interface GeoLocationState {
    available: boolean; bucket_configured: boolean; restart_configured: boolean; pending_restart: boolean;
    object_key: string; delegated_keys: string[]; geoip_providers: string[]; fleet_fields: GeoField[];
    loaded_revision: string | null; published_revision: string | null; configuration_revision: string | null;
    published_version: string | null; remote_error: string | null;
    geoip: GeoDraft & { GEOIP_API_KEY_MOJO_CONFIGURED: boolean; GEOIP_API_KEY_MOJO_HINT: string };
    verify_state: { geoip?: StoredGeoVerification };
}
export interface GeoPublication { published: boolean; unchanged: boolean; topic: 'geoip'; revision: string; published_revision: string | null; version_id: string | null; pending_restart: boolean; results: { geoip: GeoVerdict } }
export type GeoKeyEdit = { mode: 'untouched' } | { mode: 'replace'; value: string } | { mode: 'clear'; confirmed: true };
export class GeoLocationError extends Error {
    constructor(public kind: 'invalid' | 'validation' | 'unsupported' | 'denied' | 'fresh' | 'conflict' | 'unavailable' | 'uncertain', message?: string) {
        super(message ?? ({ invalid: 'GeoLocation returned an incompatible response. Refresh before continuing.', validation: 'Check the provider settings and try again.', unsupported: 'This backend does not support GeoLocation provider setup.', denied: 'GeoLocation requires a current interactive superuser session.', fresh: 'Authenticate again, then Refresh and deliberately retry. The action was not replayed.', conflict: 'Provider configuration changed; reload before publishing. Refresh and review the configuration.', unavailable: 'GeoLocation could not be read. Refresh before continuing.', uncertain: 'The save may have persisted. Refresh authoritative configuration before another attempt.' }[kind]));
    }
}
const invalid = (): never => { throw new GeoLocationError('invalid'); };
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
const text = (v: unknown, max = 512): string => typeof v === 'string' && v.length <= max && !/[\x00-\x1f\x7f]/.test(v) ? v : invalid();
const flag = (v: unknown): boolean => typeof v === 'boolean' ? v : invalid();
const list = (v: unknown, max = 128): unknown[] => Array.isArray(v) && v.length <= max ? v : invalid();
const nullable = <T>(v: unknown, parse: (v: unknown) => T): T | null => v === null ? null : parse(v);
export const geoRevision = (v: unknown): string => typeof v === 'string' && /^[a-f0-9]{32,64}$/.test(v) ? v : invalid();
export const geoProvider = (v: unknown): string => typeof v === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(v) ? v : invalid();
export function geoOrigin(v: unknown): string {
    const value = text(v);
    try {
        const u = new URL(value);
        if (value.trim() !== value || /[?#]/.test(value) || u.protocol !== 'https:' || !u.hostname || u.username || u.password || u.search || u.hash || !['', '/'].includes(u.pathname) || u.port && u.port !== '443') invalid();
        // Match backend normalization: retain an explicitly supplied :443, remove only slash.
        return value.replace(/\/$/, '');
    } catch { return invalid(); }
}
export function geoDraft(value: GeoDraft): GeoDraft {
    const additional = list(value.GEOIP_ADDITIONAL_PROVIDERS, 16).map(geoProvider);
    if (new Set(additional).size !== additional.length) invalid();
    return { GEOIP_PRIMARY_PROVIDER: geoProvider(value.GEOIP_PRIMARY_PROVIDER), GEOIP_FALLBACK_PROVIDER: geoProvider(value.GEOIP_FALLBACK_PROVIDER), GEOIP_ADDITIONAL_PROVIDERS: [...additional], GEOIP_MOJO_PROVIDER_URL: geoOrigin(value.GEOIP_MOJO_PROVIDER_URL), GEOIP_MOJO_SYNC_ENABLED: flag(value.GEOIP_MOJO_SYNC_ENABLED) };
}
/** Positive projection discards the catalog, SMS, credentials, and every unknown field. */
export function parseGeoLocation(value: unknown): GeoLocationState {
    const root = object(value); if (root.schema_version !== 1 || root.provider_setup == null) throw new GeoLocationError('unsupported');
    const r = object(root.provider_setup), g = object(r.geoip), verify = object(r.verify_state);
    const fields = list(r.fleet_fields).map(value => { const f = object(value); return { key: text(f.key, 80), label: text(f.label, 200), description: text(f.description, 2000), value_type: text(f.value_type, 32), constraints: text(f.constraints, 500) }; });
    if (new Set(fields.map(f => f.key)).size !== fields.length) invalid();
    const hint = text(g.GEOIP_API_KEY_MOJO_HINT, 4); if (hint !== '' && hint.length !== 4) invalid();
    const stored = verify.geoip == null ? undefined : object(verify.geoip);
    return { available: flag(r.available), bucket_configured: flag(r.bucket_configured), restart_configured: flag(r.restart_configured), pending_restart: flag(r.pending_restart),
        object_key: text(r.object_key, 1024), delegated_keys: list(r.delegated_keys, 1024).map(v => text(v, 100)), geoip_providers: list(r.geoip_providers).map(geoProvider), fleet_fields: fields,
        loaded_revision: nullable(r.loaded_revision, geoRevision), published_revision: nullable(r.published_revision, geoRevision), configuration_revision: nullable(r.configuration_revision, geoRevision),
        published_version: nullable(r.published_version, v => text(v, 1024)), remote_error: nullable(r.remote_error, v => text(v, 200)),
        geoip: { ...geoDraft(g as unknown as GeoDraft), GEOIP_API_KEY_MOJO_CONFIGURED: flag(g.GEOIP_API_KEY_MOJO_CONFIGURED), GEOIP_API_KEY_MOJO_HINT: hint },
        verify_state: stored ? { geoip: { ok: flag(stored.ok), code: nullable(stored.code, v => text(v, 64)), message: text(stored.message, 200), at: text(stored.at, 40) } } : {},
    };
}
/** Credential diagnostics need the provider schema, independently of Fleet publishing. */
export function geoTestBlock(state: GeoLocationState): string | null {
    const types = ['string', 'string', 'list', 'origin', 'boolean'];
    if (!GEOLOCATION_KEYS.every((key, i) => state.delegated_keys.includes(key) && state.fleet_fields.some(f => f.key === key && f.value_type === types[i]))) return 'All five GeoIP fields must be registered and delegated before provider setup can change.';
    return null;
}
export function geoWriteBlock(state: GeoLocationState): string | null {
    if (state.remote_error) return 'The published configuration could not be read. Resolve the remote read failure and Refresh.';
    const schema = geoTestBlock(state); if (schema) return schema;
    if (!state.available || !state.bucket_configured || !state.restart_configured || !state.object_key) return 'Fleet publishing is unavailable. Configure its exact bucket and object, all provider delegations, KMS encryption and config-sync restart in deployment settings.';
    return null;
}
const providerLabels: Record<string, string> = { mojo: 'MojoVerify', ipinfo: 'IPinfo', ipstack: 'IPstack', 'ip-api': 'IP-API', maxmind: 'MaxMind' };
export const geoProviderLabel = (provider: string): string => providerLabels[provider] ?? provider;
export function geoProviderOptions(state: GeoLocationState, draft: GeoDraft): string[] {
    return [...new Set([...state.geoip_providers, draft.GEOIP_PRIMARY_PROVIDER, draft.GEOIP_FALLBACK_PROVIDER, ...draft.GEOIP_ADDITIONAL_PROVIDERS])];
}
export function buildGeoPayload(action: 'test_providers' | 'configure_providers', revision: string | null, draft: GeoDraft, edit: GeoKeyEdit = { mode: 'untouched' }): Record<string, unknown> {
    nullable(revision, geoRevision);
    let geoip: GeoDraft & { GEOIP_API_KEY_MOJO?: string; clear_api_key?: true };
    try { geoip = geoDraft(draft); } catch { throw new GeoLocationError('validation', 'Use valid provider identifiers, up to 16 unique additional providers, and one HTTPS origin without a path, query, fragment or alternate port.'); }
    if (edit.mode === 'replace') {
        if (typeof edit.value !== 'string' || edit.value.length > 4096) throw new GeoLocationError('validation', 'The replacement key must be at most 4096 characters.');
        if (edit.value !== '') geoip.GEOIP_API_KEY_MOJO = edit.value;
    } else if (edit.mode === 'clear') {
        if (edit.confirmed !== true) throw new GeoLocationError('validation', 'Confirm key removal first.');
        geoip.clear_api_key = true;
    }
    return { action, topic: 'geoip', providers: { expected_revision: revision, geoip } };
}
export function parseGeoVerdict(value: unknown): GeoVerdict { const r = object(value); return { success: flag(r.success), code: nullable(r.code, v => text(v, 64)), message: text(r.message, 200) }; }
export function parseGeoTest(value: unknown): GeoVerdict {
    const r = object(value); if (r.tested !== true || r.topic !== 'geoip') invalid();
    const result = parseGeoVerdict(object(r.results).geoip); if (flag(r.success) !== result.success) invalid(); return result;
}
export function parseGeoPublication(value: unknown): GeoPublication {
    const r = object(value); if (r.topic !== 'geoip') invalid();
    const out: GeoPublication = { published: flag(r.published), unchanged: flag(r.unchanged), topic: 'geoip', revision: geoRevision(r.revision), published_revision: nullable(r.published_revision, geoRevision), version_id: nullable(r.version_id, v => text(v, 1024)), pending_restart: flag(r.pending_restart), results: { geoip: parseGeoVerdict(object(r.results).geoip) } };
    if (out.published === out.unchanged || !out.results.geoip.success || out.published && (!out.pending_restart || out.published_revision !== out.revision)) invalid();
    return out;
}
async function geoCall(body: Record<string, unknown> | null, scope: PrivateScope = {}): Promise<unknown> {
    try {
        if (body) operatorOrigin();
        const reply = await mojoCall(GEOLOCATION_ENDPOINT, { ...(body ? { method: 'POST', body, refusal: 'return' } as const : {}), signal: scope.signal, beforeSend: () => { if (body) operatorOrigin(); scope.beforeSend?.(); } });
        scope.beforeSend?.();
        return reply.data ?? reply;
    } catch (reason) {
        if (reason instanceof GeoLocationError) throw reason;
        if (reason instanceof OperatorError && reason.kind === 'denied') throw new GeoLocationError('denied');
        if (scope.signal?.aborted) throw new GeoLocationError('denied');
        if (reason instanceof MojoError) {
            if (reason.status === 440) throw new GeoLocationError('fresh');
            if ([401, 403].includes(reason.status)) throw new GeoLocationError('denied');
            if ([404, 405].includes(reason.status)) throw new GeoLocationError('unsupported');
            if (reason.status === 409 || reason.status === 400 && /changed; reload before publishing/i.test(reason.message)) throw new GeoLocationError('conflict');
            if (reason.status === 400) throw new GeoLocationError('validation', 'The server rejected the provider settings or credential. Check the MojoVerify key. Pending service configuration may need Fleet Configuration applied first, or a replacement key.');
        }
        throw new GeoLocationError(body?.action === 'configure_providers' ? 'uncertain' : 'unavailable');
    } finally {
        // The only raw-bearing object has a deliberately short lifetime, including rejected calls.
        if (body) delete ((body.providers as { geoip: Record<string, unknown> }).geoip).GEOIP_API_KEY_MOJO;
    }
}
export const readGeoLocation = async (scope?: PrivateScope): Promise<GeoLocationState> => parseGeoLocation(await geoCall(null, scope));
export const testGeoLocation = async (revision: string | null, draft: GeoDraft, edit?: GeoKeyEdit, scope?: PrivateScope): Promise<GeoVerdict> => parseGeoTest(await geoCall(buildGeoPayload('test_providers', revision, draft, edit), scope));
export const saveGeoLocation = async (revision: string | null, draft: GeoDraft, edit?: GeoKeyEdit, scope?: PrivateScope): Promise<GeoPublication> => parseGeoPublication(await geoCall(buildGeoPayload('configure_providers', revision, draft, edit), scope));
/** Mount-relative sibling destination, including an embedded Admin prefix. */
export const geoFleetRoute = (pathname: string): string => pathname.replace(/\/geolocation\/?$/, '/fleet-configuration');
