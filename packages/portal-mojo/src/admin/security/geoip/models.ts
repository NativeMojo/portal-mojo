// GeoIP model layer — the CANONICAL definition of `/api/system/geoip` for the
// whole admin toolkit. #1287 (network security: Blocked IPs, firewall log, IP
// sets, geofencing) imports `GeoLocatedIPModel`, `GEOIP_VIEW_PERMS`,
// `GEOIP_MANAGE_PERMS`, the enforcement helpers and the dossier from here
// rather than redefining any of them — one endpoint, one defineModel, one
// cache key.
//
// Ported from web-mojo `src/core/models/System.js` (GeoLocatedIP +
// GeoLocatedIPList + GeoIPForms) and `admin/account/devices/GeoIPView.js`
// (1255 lines, read in full 2026-08-06), reconciled against the authoritative
// backend `django-mojo/mojo/apps/account/models/geolocated_ip.py` +
// `rest/device.py`.
//
// Backend-forced corrections carried here (see docs/admin-devices-geoip.md):
//   · `reverse_dns` and `ip_version` DO NOT EXIST on GeoLocatedIP — the source
//     rendered two permanently blank Network rows and a subtitle fragment
//     that never appeared.
//   · `provider` is EXCLUDED from the `default` graph, so the source's
//     Provider row was blank on every normal read. It rides `detailed` only.
//   · There is no `metadata` field — `KnownFieldsCard` is fed the record.
//   · `block_active` / `whitelist_active` are Python properties that are only
//     serialized on the `basic` graph. The default graph carries the raw
//     booleans, so expiry has to be evaluated client-side: `blockActive()` /
//     `whitelistActive()` mirror the model properties exactly.
//   · `CAN_DELETE` is unset ⇒ `rest.py` defaults it to False. There is no
//     delete path; the source's "Delete record" kebab item could never work.
import { useQuery, type QueryClient } from '@tanstack/react-query';
import {
    createSafeExporter, defineModel, mojoCall, mojoList,
    type Params,
} from '../../../client';
import { boundedSecurityText, sanitizeSecurityValue } from '../../incidents/sanitize';

// ── Permissions (backend-derived, `sys.`-pinned, fail-closed) ─────────

/** `GeoLocatedIP.RestMeta.VIEW_PERMS`, system-pinned. */
export const GEOIP_VIEW_PERMS = [
    'sys.manage_users',
    'sys.view_security',
    'sys.manage_security',
    'sys.security',
    'sys.users',
];

/** `GeoLocatedIP.RestMeta.SAVE_PERMS`, system-pinned. Gates every mutation. */
export const GEOIP_MANAGE_PERMS = [
    'sys.manage_users',
    'sys.manage_security',
    'sys.security',
];

// ── Row shapes ────────────────────────────────────────────────────────

export type ThreatLevel = 'low' | 'medium' | 'high' | 'critical';

/** THREAT_LEVEL_ORDER from the model, with `null` at index 0. */
export const THREAT_LEVEL_ORDER: readonly (ThreatLevel | null)[] = [null, 'low', 'medium', 'high', 'critical'];

export const THREAT_LEVEL_OPTIONS: readonly { value: string; label: string }[] = [
    { value: '', label: 'None' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'critical', label: 'Critical' },
];

/**
 * The `default` graph: every model field EXCEPT `data` and `provider`, plus
 * the three `extra` properties. Datetimes are epoch SECONDS.
 */
export interface GeoLocatedIPRow {
    id: number;
    created: number;
    modified: number;
    last_seen: number;

    ip_address: string;
    subnet: string | null;

    country_code: string | null;
    country_name: string | null;
    region: string | null;
    region_code: string | null;
    city: string | null;
    postal_code: string | null;
    latitude: number | null;
    longitude: number | null;
    timezone: string | null;

    is_tor: boolean;
    is_vpn: boolean;
    is_proxy: boolean;
    is_cloud: boolean;
    is_datacenter: boolean;
    is_mobile: boolean;
    is_known_attacker: boolean;
    is_known_abuser: boolean;

    threat_level: string | null;
    asn: string | null;
    asn_org: string | null;
    isp: string | null;
    mobile_carrier: string | null;
    connection_type: string | null;

    is_blocked: boolean;
    blocked_at: number | null;
    blocked_until: number | null;
    blocked_reason: string | null;
    block_count: number;

    is_whitelisted: boolean;
    whitelisted_reason: string | null;
    whitelisted_until: number | null;

    expires_at: number | null;

    /** `extra` on every graph — computed Python properties. */
    is_threat: boolean;
    is_suspicious: boolean;
    risk_score: number;
}

/**
 * The `detailed` graph adds the two fields the default graph excludes. It is
 * read ONLY through `useGeoIpRawRecord` — an explicit, manage-gated,
 * `gcTime: 0` fetch — so the raw provider blob never lands in the persistent
 * Query cache.
 */
export interface GeoLocatedIPDetailedRow extends GeoLocatedIPRow {
    provider: string | null;
    data: Record<string, unknown> | null;
}

// ── Scrubbing ─────────────────────────────────────────────────────────

/**
 * `data` is the raw provider blob. It can carry firewall hints (the backend's
 * own federation graph excludes it for exactly that reason) and arbitrary
 * third-party text, so it is deleted before the row reaches any cache; the
 * rest goes through the shared security scrubber.
 */
export function sanitizeGeoIpRow<T>(row: T): T {
    const safe = { ...(row as unknown as Record<string, unknown>) };
    delete safe.data;
    return sanitizeSecurityValue(safe) as unknown as T;
}

// ── Enforcement state (the model's Python properties, verbatim) ───────

const nowSec = (): number => Math.floor(Date.now() / 1000);

/**
 * `GeoLocatedIP.whitelist_active`: whitelisted AND not expired. Every
 * consumer of whitelist state must use this, never the raw `is_whitelisted`.
 */
export function whitelistActive(row: Pick<GeoLocatedIPRow, 'is_whitelisted' | 'whitelisted_until'> | null | undefined): boolean {
    if (!row?.is_whitelisted) return false;
    if (row.whitelisted_until != null && nowSec() > row.whitelisted_until) return false;
    return true;
}

/**
 * `GeoLocatedIP.block_active`: blocked, not whitelisted, and not expired.
 * web-mojo rendered raw `is_blocked`, so an expired block still read
 * "Blocked" and a whitelisted-but-flagged IP read blocked when it was not.
 */
export function blockActive(row: Pick<GeoLocatedIPRow, 'is_blocked' | 'blocked_until' | 'is_whitelisted' | 'whitelisted_until'> | null | undefined): boolean {
    if (!row?.is_blocked) return false;
    if (whitelistActive(row)) return false;
    if (row.blocked_until != null && nowSec() > row.blocked_until) return false;
    return true;
}

/** True when `is_blocked` is set but the block has lapsed — a real UI state. */
export function blockExpired(row: Pick<GeoLocatedIPRow, 'is_blocked' | 'blocked_until'> | null | undefined): boolean {
    return Boolean(row?.is_blocked && row.blocked_until != null && nowSec() > row.blocked_until);
}

/** True when `is_whitelisted` is set but the whitelist has lapsed. */
export function whitelistExpired(row: Pick<GeoLocatedIPRow, 'is_whitelisted' | 'whitelisted_until'> | null | undefined): boolean {
    return Boolean(row?.is_whitelisted && row.whitelisted_until != null && nowSec() > row.whitelisted_until);
}

export type GeoTone = 'success' | 'warning' | 'danger' | 'muted' | 'info' | 'primary';

/** THREAT_TONE from GeoIPView.js:46-52, mapped onto portal-mojo's Tone. */
export function threatTone(level: string | null | undefined): GeoTone {
    switch (String(level ?? '').toLowerCase()) {
        case 'none':
        case 'low':
            return 'success';
        case 'medium':
            return 'warning';
        case 'high':
        case 'critical':
            return 'danger';
        default:
            return 'muted';
    }
}

/** `risk_score` rides the default graph; this is the null-safe read. */
export function riskScoreOf(row: Pick<GeoLocatedIPRow, 'risk_score'> | null | undefined): number | null {
    return typeof row?.risk_score === 'number' ? row.risk_score : null;
}

/**
 * ISO-3166 alpha-2 → the regional-indicator pair (GeoIPView.js COUNTRY_FLAG).
 * Anything that is not exactly two ASCII letters returns '' — the backend's
 * `country_code` is `max_length=3` and can legitimately hold a 3-letter code.
 */
export function countryFlag(code: string | null | undefined): string {
    if (!code || typeof code !== 'string' || code.length !== 2) return '';
    const upper = code.toUpperCase();
    if (!/^[A-Z]{2}$/.test(upper)) return '';
    const BASE = 0x1F1E6;
    const A = 0x41;
    return String.fromCodePoint(BASE + (upper.charCodeAt(0) - A))
        + String.fromCodePoint(BASE + (upper.charCodeAt(1) - A));
}

// ── Model ─────────────────────────────────────────────────────────────

const COMMON_PARAMS = new Set(['start', 'size', 'sort', 'search', 'dr_field', 'dr_start', 'dr_end']);

/** Filterable fields. An unlisted key never reaches the wire — and neither
 *  can a crafted `graph`, which is pinned to `default`. */
const GEOIP_FILTERS = new Set([
    'id', 'id__in', 'ip_address', 'ip_address__icontains', 'subnet',
    'country_code', 'country_code__in', 'region', 'region__icontains', 'region_code',
    'city', 'city__icontains', 'postal_code',
    'threat_level', 'threat_level__in', 'asn', 'asn_org__icontains',
    'isp', 'isp__icontains', 'connection_type', 'mobile_carrier',
    'is_tor', 'is_vpn', 'is_proxy', 'is_cloud', 'is_datacenter', 'is_mobile',
    'is_known_attacker', 'is_known_abuser', 'is_threat',
    'is_blocked', 'is_whitelisted', 'block_count__gte',
    'last_seen__gte', 'last_seen__lte', 'created__gte', 'created__lte',
]);

export function normalizeGeoIpListParams(params: Params): Params {
    const out: Params = { graph: 'default' };
    for (const [key, value] of Object.entries(params)) {
        if ((COMMON_PARAMS.has(key) || GEOIP_FILTERS.has(key)) && value != null && value !== '') out[key] = value;
    }
    out.sort = String(out.sort ?? '-last_seen');
    if (out.dr_start != null || out.dr_end != null) out.dr_field = String(out.dr_field ?? 'last_seen');
    return out;
}

/**
 * Every action is a declared `POST_SAVE_ACTIONS` key on the backend RestMeta.
 * All six handlers return nothing, so `on_rest_save` answers with the
 * refreshed record — `response: 'row'` (the default) is correct for all of
 * them and the UI re-reads state rather than optimistically toggling.
 */
export const GeoLocatedIPModel = defineModel<GeoLocatedIPRow>({
    name: 'geoip',
    endpoint: '/api/system/geoip',
    permissions: { view: GEOIP_VIEW_PERMS, manage: GEOIP_MANAGE_PERMS },
    actions: {
        refresh: { permissions: GEOIP_MANAGE_PERMS },
        threat_analysis: { permissions: GEOIP_MANAGE_PERMS },
        block: { permissions: GEOIP_MANAGE_PERMS },
        unblock: { permissions: GEOIP_MANAGE_PERMS },
        whitelist: { permissions: GEOIP_MANAGE_PERMS },
        unwhitelist: { permissions: GEOIP_MANAGE_PERMS },
    },
    normalizeListParams: normalizeGeoIpListParams,
    sanitizeRow: sanitizeGeoIpRow,
});

// ── Reading a dossier from an IP ──────────────────────────────────────

/**
 * The DEFAULT path for "show me what we know about this IP": a filtered read
 * of the cache table. Read-only, no provider cost, no rate limit.
 *
 * `/system/geoip/lookup` is NOT this — it CREATES and REFRESHES records and
 * is rate-limited to 30/ip server-side, so it runs only on the explicit
 * operator action below and never as a background query.
 */
export function useGeoIpByAddress(ip: string | null | undefined, enabled = true) {
    const address = ip ?? '';
    return useQuery({
        queryKey: [GeoLocatedIPModel.endpoint, { ip_address: address, size: 1, graph: 'default' }] as const,
        queryFn: async () => {
            const page = await mojoList<GeoLocatedIPRow>(GeoLocatedIPModel.endpoint, {
                ip_address: address, size: 1, graph: 'default',
            });
            const row = page.rows[0];
            return row ? sanitizeGeoIpRow(row) : null;
        },
        enabled: enabled && address.length > 0,
    });
}

export interface GeoIpLookupOptions {
    /** Server default is true; `false` skips the provider refresh entirely. */
    autoRefresh?: boolean;
}

/**
 * Explicit operator lookup. `GET /api/system/geoip/lookup?ip=` creates the
 * record when it is absent and refreshes it when it is expired, behind a
 * 30-per-IP rate limit — a 429 must surface, never be swallowed.
 *
 * `auto_refresh` is sent as `1`/`0`: the backend's `_param_is_true` coerces
 * the STRING "false" correctly, but "0"/"1" is unambiguous either way.
 */
export async function lookupGeoIp(
    qc: QueryClient,
    ip: string,
    opts: GeoIpLookupOptions = {},
): Promise<GeoLocatedIPRow> {
    const body = await mojoCall(`${GeoLocatedIPModel.endpoint}/lookup`, {
        params: { ip, auto_refresh: opts.autoRefresh === false ? '0' : '1' },
    });
    const row = sanitizeGeoIpRow(body.data as GeoLocatedIPRow);
    await GeoLocatedIPModel.invalidate(qc);
    return row;
}

/** Graph is part of the key so a sparse default row cannot satisfy detail. */
export function geoIpRawKey(id: number) {
    return [GeoLocatedIPModel.endpoint, 'one', id, { graph: 'detailed' }] as const;
}

export interface GeoIpRawRecord {
    provider: string | null;
    /** Already sanitized AND length-bounded — safe to render in a <pre>. */
    text: string;
}

/**
 * The ONLY reader of `graph=detailed`, and therefore the only path that ever
 * sees `data`/`provider`. Deliberately:
 *   · `enabled` is folded with the caller's GEOIP_MANAGE_PERMS check;
 *   · `gcTime: 0` + `staleTime: 0` so the blob never persists in the cache;
 *   · the payload is scrubbed and bounded before it is returned.
 */
export function useGeoIpRawRecord(id: number | null, enabled: boolean) {
    return useQuery({
        queryKey: id == null
            ? [GeoLocatedIPModel.endpoint, 'one', null, { graph: 'detailed' }] as const
            : geoIpRawKey(id),
        queryFn: async (): Promise<GeoIpRawRecord> => {
            const body = await mojoCall(`${GeoLocatedIPModel.endpoint}/${id!}`, { params: { graph: 'detailed' } });
            const raw = sanitizeSecurityValue(body.data) as GeoLocatedIPDetailedRow;
            return {
                provider: raw?.provider ?? null,
                text: boundedSecurityText(raw?.data ?? {}),
            };
        },
        enabled: enabled && id != null,
        gcTime: 0,
        staleTime: 0,
    });
}

// ── Export ────────────────────────────────────────────────────────────

/**
 * Declared projection only. The server-side `download_format` path would
 * serialize whatever graph the params asked for; this cannot — `data` and
 * `provider` are not in the field list, and every row is sanitized before it
 * is projected.
 */
export const geoIpSafeExporter = createSafeExporter<GeoLocatedIPRow>({
    endpoint: GeoLocatedIPModel.endpoint,
    filename: 'geoip-cache',
    sanitizeRow: sanitizeGeoIpRow,
    fields: [
        { key: 'id' }, { key: 'ip_address' }, { key: 'subnet' },
        { key: 'country_code' }, { key: 'country_name' }, { key: 'region' },
        { key: 'region_code' }, { key: 'city' }, { key: 'postal_code' },
        { key: 'latitude' }, { key: 'longitude' }, { key: 'timezone' },
        { key: 'asn' }, { key: 'asn_org' }, { key: 'isp' },
        { key: 'connection_type' }, { key: 'mobile_carrier' },
        { key: 'threat_level' }, { key: 'risk_score' },
        { key: 'is_threat' }, { key: 'is_suspicious' },
        { key: 'is_tor' }, { key: 'is_vpn' }, { key: 'is_proxy' },
        { key: 'is_cloud' }, { key: 'is_datacenter' }, { key: 'is_mobile' },
        { key: 'is_known_attacker' }, { key: 'is_known_abuser' },
        { key: 'is_blocked' }, { key: 'blocked_at' }, { key: 'blocked_until' },
        { key: 'blocked_reason' }, { key: 'block_count' },
        { key: 'is_whitelisted' }, { key: 'whitelisted_reason' }, { key: 'whitelisted_until' },
        { key: 'block_active', label: 'block_active', value: (row) => blockActive(row) },
        { key: 'whitelist_active', label: 'whitelist_active', value: (row) => whitelistActive(row) },
        { key: 'last_seen' }, { key: 'created' }, { key: 'modified' }, { key: 'expires_at' },
    ],
});
