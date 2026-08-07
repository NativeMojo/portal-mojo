// Network security model layer — IP sets, the geofence config plane, the
// geofence evidence projection, and the firewall-log payload contract.
//
// Ported from web-mojo `admin/models/IPSet.js` + `admin/security/IPSetView.js`
// + the five `admin/security/geofence/*` views (all read in full 2026-08-06),
// reconciled against the authoritative django-mojo sources:
//   · `mojo/apps/incident/models/ipset.py` + `rest/ipset.py`
//   · `mojo/apps/account/rest/geofence.py`
//   · `mojo/apps/account/services/geofence/{engine,evidence}.py`
//   · `mojo/apps/account/models/geolocated_ip.py` (firewall Log rows)
//   · `mojo/apps/metrics/rest/{categories,helpers}.py`
//
// `/api/system/geoip` is NOT defined here. #1291 owns it
// (`admin/security/geoip/models.ts`) — one endpoint, one defineModel, one
// cache key. Blocked IPs is a projection over that model.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    MojoError, defineModel, mojoCall, mojoList, mojoMetrics, useCan,
    type Envelope, type Params,
} from '../../client/runtime';
import { sanitizeEventRow } from '../incidents/sanitize';
import type { EventRow } from '../incidents/models';
import { GEOFENCE_VIEW_PERMS, SECURITY_EVENTS_PERMS } from './geofence/geofence-data';
import { IPSET_DELETE_PERMS, IPSET_MANAGE_PERMS, IPSET_VIEW_PERMS } from './permissions';
import type {
    AllowlistPayload, BypassHoldersPayload, GeoDecision, GeoRulesConfig, GeofenceRule,
} from './geofence/geofence-data';

// ── Permissions (backend-derived, `sys.`-pinned, fail-closed) ─────────

export { IPSET_DELETE_PERMS, IPSET_MANAGE_PERMS, IPSET_VIEW_PERMS } from './permissions';

/**
 * `metrics/rest/helpers.check_view_permissions`: for `account == "global"` the
 * required any-of list is exactly `["view_metrics","metrics"]`, checked against
 * the caller's GLOBAL permissions. Every geofence metrics read is gated on this
 * so a geofence-only operator issues no denied request.
 */
export const METRICS_GLOBAL_VIEW_PERMS = ['sys.view_metrics', 'sys.metrics'];

// ── IPSet ─────────────────────────────────────────────────────────────

/**
 * The `default` graph: `{"exclude": ["data", "source_key"]}`.
 * `source_key` (the AbuseIPDB API key) is excluded from BOTH graphs and an
 * unknown graph name falls back to `default`, so it can never be read back —
 * it is deliberately absent from this type.
 */
export interface IPSetRow {
    id: number;
    created: number;
    modified: number;
    name: string;
    kind: string;
    description: string | null;
    source: string;
    source_url: string | null;
    is_enabled: boolean;
    cidr_count: number;
    last_synced: number | null;
    sync_error: string | null;
}

/** The `detailed` graph adds `data`: the CIDR list, one entry per line. */
export interface IPSetDetailedRow extends IPSetRow {
    data: string;
}

/** `IPSet.KIND_CHOICES`, with the source's explanatory create-form labels. */
export const IPSET_KIND_OPTIONS = [
    { value: 'country', label: 'Country — block all traffic from a country' },
    { value: 'abuse', label: 'Abuse feed — import known attacker IPs' },
    { value: 'datacenter', label: 'Datacenter — block datacenter/hosting ranges' },
    { value: 'custom', label: 'Custom — define your own CIDR list' },
];

/** The same four values with short labels, for badges and filters. */
export const IPSET_KIND_BADGE_OPTIONS = [
    { value: 'country', label: 'Country' },
    { value: 'abuse', label: 'Abuse feed' },
    { value: 'datacenter', label: 'Datacenter' },
    { value: 'custom', label: 'Custom' },
];

/**
 * BACKEND CORRECTION. `IPSet.SOURCE_CHOICES` has FIVE members; web-mojo listed
 * three, so `tor` and `blocklist_de` rows — the two cache-only threat lists —
 * rendered a raw slug in the Source column and could not be filtered at all.
 */
export const IPSET_SOURCE_OPTIONS = [
    { value: 'ipdeny', label: 'IPDeny (country zones)' },
    { value: 'abuseipdb', label: 'AbuseIPDB' },
    { value: 'tor', label: 'Tor exit list' },
    { value: 'blocklist_de', label: 'blocklist.de' },
    { value: 'manual', label: 'Manual' },
];

/**
 * `IPSet.THREAT_CACHE_SETS` — sets that exist to feed geoip THREAT DETECTION,
 * not the kernel firewall. `on_action_enable` refuses them outright, and
 * `sync()` silently no-ops for them.
 */
export const IPSET_CACHE_ONLY_NAMES: readonly string[] = ['tor_exits', 'blocklist_de'];

/** The model's own words for why enabling a cache-only set is refused. */
export const IPSET_CACHE_ONLY_HELP =
    'geoip detection cache — enabling would kernel-block every listed IP fleet-wide';

export function isCacheOnlyIPSet(row: Pick<IPSetRow, 'name'> | null | undefined): boolean {
    return row != null && IPSET_CACHE_ONLY_NAMES.includes(row.name);
}

/**
 * web-mojo's `CommonBlockCountries` — pinned to the top of the country picker
 * so the twenty codes an operator actually reaches for are one scroll away.
 * The FULL ISO2 list follows (from #1426's centroid table); the source offered
 * only these twenty, so no other country could be blocked from the UI at all.
 */
export const IPSET_COMMON_BLOCK_COUNTRIES: readonly string[] = [
    'CN', 'RU', 'KP', 'IR', 'NG', 'RO', 'BR', 'IN', 'PK', 'ID',
    'VN', 'UA', 'TH', 'PH', 'BD', 'EG', 'TR', 'MX', 'AR', 'CO',
];

const COMMON_PARAMS = new Set(['start', 'size', 'sort', 'search', 'dr_field', 'dr_start', 'dr_end']);

/** Filterable fields. `graph` is pinned to `default`, so `data` can never
 *  ride a list response into the persistent query cache. */
const IPSET_FILTERS = new Set([
    'id', 'id__in', 'name', 'name__icontains', 'description__icontains',
    'kind', 'kind__in', 'source', 'source__in', 'is_enabled',
    'cidr_count__gte', 'cidr_count__lte',
    'last_synced__gte', 'last_synced__lte', 'sync_error__isnull',
]);

export function normalizeIPSetListParams(params: Params): Params {
    const out: Params = { graph: 'default' };
    for (const [key, value] of Object.entries(params)) {
        if ((COMMON_PARAMS.has(key) || IPSET_FILTERS.has(key)) && value != null && value !== '') out[key] = value;
    }
    out.sort = String(out.sort ?? 'name');
    if (out.dr_start != null || out.dr_end != null) out.dr_field = String(out.dr_field ?? 'last_synced');
    return out;
}

/**
 * `IPSet.RestMeta.POST_SAVE_ACTIONS = ["sync","enable","disable","refresh_source"]`.
 * All four handlers return nothing, so `on_rest_save` answers with the
 * refreshed record — `response: 'row'` (the default) is correct for all of
 * them and the UI re-reads state rather than optimistically toggling.
 *
 * `enable` is the ONLY path that runs the cache-only rejection
 * (`on_action_enable` raises a 400 naming the set). `is_enabled` is therefore
 * NEVER written as a plain field anywhere in this module — web-mojo's create
 * default and edit switch both did, producing a row that reads "Enabled" and
 * silently never syncs. Direct #1097 lineage.
 */
export const IPSetModel = defineModel<IPSetRow>({
    name: 'ipset',
    endpoint: '/api/incident/ipset',
    permissions: {
        view: IPSET_VIEW_PERMS,
        manage: IPSET_MANAGE_PERMS,
        delete: IPSET_DELETE_PERMS,
    },
    actions: {
        sync: { permissions: IPSET_MANAGE_PERMS },
        enable: { permissions: IPSET_MANAGE_PERMS },
        disable: { permissions: IPSET_MANAGE_PERMS },
        refresh_source: { permissions: IPSET_MANAGE_PERMS },
    },
    normalizeListParams: normalizeIPSetListParams,
});

/** Graph is part of the key so a sparse `default` row cannot satisfy detail. */
export function ipSetCidrKey(id: number) {
    return [IPSetModel.endpoint, 'one', id, { graph: 'detailed' }] as const;
}

export interface IPSetCidrData {
    /** The stored blob, verbatim. */
    text: string;
    /** Lines that are neither blank nor comments — the HONEST count. */
    lines: string[];
}

/**
 * The only reader of `graph=detailed`, i.e. the only path that sees `data`.
 * `gcTime: 0` keeps a multi-megabyte country zone out of the persistent cache.
 */
export function useIPSetCidrData(id: number | null, enabled: boolean) {
    return useQuery({
        queryKey: id == null
            ? [IPSetModel.endpoint, 'one', null, { graph: 'detailed' }] as const
            : ipSetCidrKey(id),
        queryFn: async (): Promise<IPSetCidrData> => {
            const body = await mojoCall(`${IPSetModel.endpoint}/${id!}`, { params: { graph: 'detailed' } });
            const raw = body.data as IPSetDetailedRow | null;
            const text = typeof raw?.data === 'string' ? raw.data : '';
            return { text, lines: parseCidrLines(text) };
        },
        enabled: enabled && id != null,
        gcTime: 0,
        staleTime: 0,
    });
}

/**
 * Split a textarea blob into the CIDR list the backend expects.
 *
 * BACKEND TRAP. `data` has a `set_data()` setter, and `on_rest_save_field`
 * prefers `set_<key>` over a plain assignment — so a posted `data` runs
 * `"\n".join(value)`. Posting a STRING therefore interleaves a newline between
 * every CHARACTER and sets `cidr_count` to the character count. The value must
 * be posted as a JSON LIST. web-mojo posted the raw textarea string.
 *
 * Blank lines and `#` comments are dropped (the source's own help text says
 * they are ignored — but the backend does not drop them, so we do).
 */
export function parseCidrLines(text: string | null | undefined): string[] {
    return String(text ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'));
}

// ── Geofence evidence projection ──────────────────────────────────────

/**
 * A SECOND `defineModel` on `/api/incident/event`, deliberately.
 *
 * The shared `EventModel` (admin/incidents) allowlists a filter set built for
 * the security-events page; `metadata__reason`, `metadata__geofence_scope` and
 * `metadata__region_code` are not in it and would be silently DROPPED, which
 * is the worst possible failure for a filter (the table would answer with
 * everything and look correct). A local definition keeps
 * `admin/incidents/models.ts` untouched.
 *
 * The two models share `endpoint`, and `defineModel`'s invalidation root is
 * `[endpoint]` — so an invalidation from either reaches both, and their query
 * keys never collide because their params never overlap.
 */
const GEOFENCE_EVENT_FILTERS = new Set([
    'id', 'category', 'category__in', 'level', 'level__gte', 'level__lte',
    'source_ip', 'source_ip__icontains', 'scope',
    // The INDEXED top-level column. `Event.sync_metadata` fills it from the
    // geolocated source IP, so it is populated for geofence blocks and is the
    // right thing to filter on — the metadata copy is not indexed.
    'country_code', 'country_code__in',
    'created__gte', 'created__lte',
    // Written by services/geofence/evidence.py. `geofence_scope` — NOT
    // `scope`: the reporter never passes the reporter's `scope=` argument, so
    // the top-level Event column stays "global" for every geofence row.
    // web-mojo read `metadata.scope` and the column was always "—".
    'metadata__reason', 'metadata__geofence_scope', 'metadata__region_code',
    'metadata__rule_level', 'metadata__allowlist_source', 'metadata__username',
]);

export function normalizeGeofenceEventListParams(params: Params): Params {
    const out: Params = { graph: 'default' };
    for (const [key, value] of Object.entries(params)) {
        if ((COMMON_PARAMS.has(key) || GEOFENCE_EVENT_FILTERS.has(key)) && value != null && value !== '') out[key] = value;
    }
    // Day grouping requires chronological contiguity.
    const sort = String(out.sort ?? '-created');
    out.sort = sort === 'created' || sort === '-created' ? sort : '-created';
    if (out.dr_start != null || out.dr_end != null) out.dr_field = String(out.dr_field ?? 'created');
    return out;
}

export const GeofenceEventModel = defineModel<EventRow>({
    name: 'geofence-event',
    endpoint: '/api/incident/event',
    permissions: { view: SECURITY_EVENTS_PERMS },
    normalizeListParams: normalizeGeofenceEventListParams,
    sanitizeRow: sanitizeEventRow,
});

export const GEOFENCE_EVENT_CATEGORIES = {
    block: 'geofence_block',
    exempt: 'geofence_exempt',
    config: 'geofence_config',
} as const;

/**
 * `evidence._block_level` (evidence.py:150-158), labelled from the module's
 * own docstring. These are the only four levels a geofence block can carry.
 */
export const GEOFENCE_LEVEL_OPTIONS = [
    { value: '3', label: 'Jurisdiction block (3)' },
    { value: '5', label: 'Abuse / fail-closed / strict (5)' },
    { value: '6', label: 'Fail-open pass-through (6)' },
    { value: '7', label: 'Rule error (7)' },
];

/**
 * The "who" on a `geofence_config` event.
 *
 * BACKEND CORRECTION. `evidence.report_config_change` writes `changed_by` (a
 * username). `reporter._create_event_dict` separately writes `user_name` (the
 * display name) for any authenticated request. web-mojo read
 * `metadata.username`, which NEITHER writes — so the Last-change chip and the
 * change-history "Who" column always rendered blank.
 */
export function configChangedBy(metadata: Record<string, unknown> | null | undefined): string {
    const changedBy = metadata?.changed_by;
    if (typeof changedBy === 'string' && changedBy) return changedBy;
    const userName = metadata?.user_name;
    if (typeof userName === 'string' && userName) return userName;
    return '';
}

// ── Firewall log ──────────────────────────────────────────────────────

/** The exact `kind` values `GeoLocatedIP` writes. */
export const FIREWALL_LOG_KINDS = {
    block: 'firewall:block',
    unblock: 'firewall:unblock',
    whitelist: 'firewall:whitelist',
    unwhitelist: 'firewall:unwhitelist',
} as const;

/**
 * The parsed firewall payload.
 *
 * COLUMN HONESTY. `Log.path` is the ADMIN's HTTP request path and `Log.ip` is
 * the ADMIN's IP — both come from the ambient request, not from the record
 * being blocked. The blocked address lives only in `payload.ip`. web-mojo
 * labelled `path` as "IP / Path", which was never either.
 *
 * The payload shape is NOT uniform across the four kinds:
 *   block       {ip, reason, ttl, blocked_until, block_count, trigger}
 *   unblock     {ip, reason, trigger}
 *   whitelist   {ip, reason, until, was_blocked, trigger}
 *   unwhitelist {ip, trigger}
 */
export interface FirewallPayload {
    ip?: string;
    reason?: string;
    ttl?: number | null;
    blocked_until?: string | null;
    block_count?: number;
    until?: string | null;
    was_blocked?: boolean;
    trigger?: string;
}

export function firewallPayloadOf(raw: string | null | undefined): FirewallPayload | null {
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as FirewallPayload
            : null;
    } catch {
        return null;
    }
}

// ── Geofence config plane ─────────────────────────────────────────────

export const GEO_RULES_ENDPOINT = '/api/geo/rules';
export const GEO_SIMULATE_ENDPOINT = '/api/geo/simulate';
export const GEO_ALLOWLIST_ENDPOINT = '/api/geo/allowlist';
export const GEO_BYPASS_ENDPOINT = '/api/geo/bypass_holders';

export const geoKeys = {
    rules: (groupUuid?: string | null) => [GEO_RULES_ENDPOINT, groupUuid ?? null] as const,
    allowlist: () => [GEO_ALLOWLIST_ENDPOINT] as const,
    bypass: () => [GEO_BYPASS_ENDPOINT] as const,
};

/**
 * `/api/geo/*` is simply NOT REGISTERED on a backend older than the config
 * plane, so the wire answer is a 404 — not an error envelope. Every geofence
 * surface branches on this and explains; any other status shows the server's
 * own message.
 */
export function isGeofenceApiMissing(error: unknown): boolean {
    return error instanceof MojoError && error.status === 404;
}

export const GEOFENCE_API_MISSING_MESSAGE =
    'This server does not expose the geofence administration API. It was added to django-mojo in v1.2.42; older deployments simply do not register the /api/geo routes.';

/** GET /api/geo/rules. One query feeds the posture header and all four tabs. */
export function useGeoConfig(groupUuid?: string | null) {
    const { can } = useCan(GEOFENCE_VIEW_PERMS);
    return useQuery({
        queryKey: geoKeys.rules(groupUuid),
        queryFn: async (): Promise<GeoRulesConfig> => {
            const body = await mojoCall(GEO_RULES_ENDPOINT, {
                params: groupUuid ? { group_uuid: groupUuid } : {},
            });
            return (body.data ?? {}) as GeoRulesConfig;
        },
        enabled: can,
    });
}

export function useGeoAllowlist() {
    const { can } = useCan(GEOFENCE_VIEW_PERMS);
    return useQuery({
        queryKey: geoKeys.allowlist(),
        queryFn: async (): Promise<AllowlistPayload> => {
            const body = await mojoCall(GEO_ALLOWLIST_ENDPOINT);
            return (body.data ?? {}) as AllowlistPayload;
        },
        enabled: can,
    });
}

export function useBypassHolders() {
    const { can } = useCan(GEOFENCE_VIEW_PERMS);
    return useQuery({
        queryKey: geoKeys.bypass(),
        queryFn: async (): Promise<BypassHoldersPayload> => {
            const body = await mojoCall(GEO_BYPASS_ENDPOINT);
            return (body.data ?? {}) as BypassHoldersPayload;
        },
        enabled: can,
    });
}

/**
 * `POST /api/geo/rules {rule}` — a FULL REPLACE that takes effect fleet-wide
 * immediately and invalidates cached decisions. Never a merge, never the
 * generic Settings editor (which would bypass `validate_rule` entirely).
 * A DSL failure comes back as the validator's own human-readable message.
 */
export function useSaveGeoRules() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (rule: GeofenceRule) => {
            const body = await mojoCall(GEO_RULES_ENDPOINT, { method: 'POST', body: { rule } });
            return (body.data ?? {}) as { rule?: GeofenceRule; source?: string; modified?: string };
        },
        onSuccess: () => { void qc.invalidateQueries({ queryKey: [GEO_RULES_ENDPOINT] }); },
    });
}

/** `DELETE /api/geo/rules` — drop the portal override; the deploy file (or
 *  nothing) becomes effective again. */
export function useRemoveGeoRulesOverride() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            const body = await mojoCall(GEO_RULES_ENDPOINT, { method: 'DELETE' });
            return (body.data ?? {}) as { removed?: boolean };
        },
        onSuccess: () => { void qc.invalidateQueries({ queryKey: [GEO_RULES_ENDPOINT] }); },
    });
}

/** `POST /api/geo/simulate` — never cached, never logged, never enforced. */
export function useGeoSimulate() {
    return useMutation({
        mutationFn: async (body: Record<string, unknown>): Promise<GeoDecision> => {
            const response = await mojoCall(GEO_SIMULATE_ENDPOINT, { method: 'POST', body });
            return (response.data ?? {}) as GeoDecision;
        },
    });
}

export class AllowlistRaceError extends Error {
    constructor() {
        super('The exemption list changed on the server while this form was open. Nothing was saved — reopen the list and try again.');
        this.name = 'AllowlistRaceError';
    }
}

/** The wire shape a `POST /api/geo/allowlist` entry may carry: keys are
 *  validated against `{cidr, ip, reason, until}` server-side. */
export interface AllowlistWriteEntry {
    cidr: string;
    reason?: string;
    until?: string;
}

export interface SaveAllowlistVars {
    /** The full replacement list. */
    entries: AllowlistWriteEntry[];
    /**
     * The `setting` array exactly as it was read when the form opened. The
     * server is refetched and compared against this before the POST.
     */
    baseline: unknown;
}

/**
 * `POST /api/geo/allowlist {entries}` is a FULL REPLACE of the
 * GEOFENCE_ALLOWLIST setting, so a stale local copy silently deletes another
 * operator's concurrent entry. Every write therefore refetches first and
 * ABORTS when the server list has moved. web-mojo posted from possibly-stale
 * local state with no guard at all.
 *
 * An empty list is a legitimate CLEAR, not "no change" — the caller confirms
 * it explicitly.
 */
export function useSaveGeoAllowlist() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ entries, baseline }: SaveAllowlistVars) => {
            const current = await mojoCall(GEO_ALLOWLIST_ENDPOINT);
            const currentSetting = ((current.data ?? {}) as AllowlistPayload).setting ?? [];
            if (JSON.stringify(currentSetting) !== JSON.stringify(baseline)) throw new AllowlistRaceError();
            const body = await mojoCall(GEO_ALLOWLIST_ENDPOINT, { method: 'POST', body: { entries } });
            return (body.data ?? {}) as { entries?: unknown[] };
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: [GEO_ALLOWLIST_ENDPOINT] });
            void qc.invalidateQueries({ queryKey: [GEO_RULES_ENDPOINT] });
        },
    });
}

// ── Geofence country totals (server-derived, no client row work) ──────

const CATEGORY_SLUGS_ENDPOINT = '/api/metrics/category_slugs';
const COUNTRY_SLUG_PREFIX = 'geofence:blocks:country:';

type CategorySlugsEnvelope = Envelope & { slugs?: unknown };

export interface CountryTotal {
    country_code: string;
    total: number;
}

/**
 * "Top blocked countries", derived entirely server-side:
 *   1. `GET /api/metrics/category_slugs?category=geofence&account=global`
 *      — a FLAT envelope (`{slugs, category, account, status}`); this route
 *      returns a raw JsonResponse and does NOT nest under `data`;
 *   2. filter to the `geofence:blocks:country:*` family;
 *   3. ONE `/api/metrics/fetch` over that family, summed per slug.
 *
 * This is never computed from the visible page of events — that would lie
 * about totals whenever the page did not cover the window. It is also exactly
 * the dataset a choropleth would consume, which is why it ships as the
 * geographic answer here (the map itself is #1426's, reserved).
 *
 * `get_category_slugs` returns a SET, so the wire order is nondeterministic;
 * the sort below is the client's, over server-computed totals.
 */
export function useGeofenceCountryTotals(days = 30, enabled = true) {
    const { can } = useCan(METRICS_GLOBAL_VIEW_PERMS);
    return useQuery({
        queryKey: ['geofence-country-totals', days] as const,
        queryFn: async (): Promise<CountryTotal[]> => {
            const body = await mojoCall(CATEGORY_SLUGS_ENDPOINT, {
                params: { category: 'geofence', account: 'global' },
            }) as CategorySlugsEnvelope;
            const slugs = Array.isArray(body.slugs) ? body.slugs.map(String) : [];
            const countrySlugs = slugs.filter((slug) => slug.startsWith(COUNTRY_SLUG_PREFIX)).sort();
            if (countrySlugs.length === 0) return [];
            const metrics = await mojoMetrics({
                slugs: countrySlugs.join(','),
                account: 'global',
                granularity: 'days',
                range: days > 7 ? '30d' : '7d',
            });
            return metrics.datasets
                .map((series) => ({
                    country_code: series.label.slice(COUNTRY_SLUG_PREFIX.length).toUpperCase(),
                    total: series.data.reduce((sum, value) => sum + (Number(value) || 0), 0),
                }))
                .filter((row) => row.total > 0)
                .sort((a, b) => b.total - a.total || a.country_code.localeCompare(b.country_code));
        },
        enabled: can && enabled,
    });
}

// ── Convenience: the geoip whitelist leg of the Exemptions tab ────────

/**
 * Resolve an address to its GeoLocatedIP id so the `whitelist` action can be
 * addressed. `/api/system/geoip/lookup` CREATES the record when it is absent
 * and refreshes it when expired, behind a 30-per-IP server rate limit — which
 * is exactly right here (an operator is whitelisting an address that may never
 * have been seen), and is why this is an explicit action and never a query.
 */
export async function resolveGeoIpIdForAddress(endpoint: string, ip: string): Promise<number> {
    const body = await mojoCall(`${endpoint}/lookup`, { params: { ip, auto_refresh: '1' } });
    const row = body.data as { id?: unknown } | null;
    if (row == null || typeof row.id !== 'number') {
        throw new MojoError(`Could not resolve ${ip} to a GeoIP record`, 400);
    }
    return row.id;
}

/**
 * The CHEAP direction: a filtered read of the cache table. Used when the row
 * is known to exist (removing a whitelist), so removal never costs a provider
 * call and never consumes the `/lookup` rate limit.
 */
export async function findGeoIpIdByAddress(endpoint: string, ip: string): Promise<number> {
    const page = await mojoList<{ id: number }>(endpoint, { ip_address: ip, size: 1, graph: 'default' });
    const id = page.rows[0]?.id;
    if (typeof id !== 'number') throw new MojoError(`No GeoIP record cached for ${ip}`, 404);
    return id;
}
