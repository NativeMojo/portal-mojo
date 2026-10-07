import { defineModel, type Params } from '../../client/runtime';
import { DNS_MANAGE_PERMISSIONS, DNS_VIEW_PERMISSIONS } from '../dns/models';
import { EDGE_BLOCKLIST_MANAGE_PERMS, EDGE_BLOCKLIST_VIEW_PERMS } from './permissions';

// Consumer contract: django-mojo `mojo/apps/edge/{models,rest}/` and
// `mojo/apps/edge/validators.py`. Every validator below mirrors a server rule
// so the form can refuse early; the server stays the authority and its message
// is what a failed save shows.

/** Vhost, route and upstream clauses are the server's DNS clauses, verbatim. */
export { DNS_MANAGE_PERMISSIONS as EDGE_MANAGE_PERMS, DNS_VIEW_PERMISSIONS as EDGE_VIEW_PERMS } from '../dns/models';

export type VhostKind = 'api' | 'site' | 'site_api' | 'redirect';
export const VHOST_KINDS: readonly VhostKind[] = ['api', 'site', 'site_api', 'redirect'];

export interface VhostKindCard { value: VhostKind; title: string; description: string; icon: string }
/** The wizard's first step: a product shape in plain words, never a raw enum. */
export const VHOST_KIND_CARDS: readonly VhostKindCard[] = [
    { value: 'api', title: 'API host', description: 'Every request on this name goes to one declared upstream.', icon: 'bi-hdd-rack' },
    { value: 'site', title: 'Static site or SPA', description: 'Serves a published site. Nothing is proxied.', icon: 'bi-window' },
    { value: 'site_api', title: 'Site + API paths', description: 'Serves a site, and sends chosen path prefixes to upstreams.', icon: 'bi-diagram-3' },
    { value: 'redirect', title: 'Redirect', description: 'Sends every request to another host, permanently.', icon: 'bi-arrow-return-right' },
];

export function vhostKindTitle(kind: string): string {
    return VHOST_KIND_CARDS.find((card) => card.value === kind)?.title ?? kind;
}

export interface EdgeDomainBasic { id: number; name: string; provider: string; status: string; expires: number | null }
export interface EdgeUpstreamBasic { id: number; name: string; kind: string }
export interface EdgeCertificateBasic { id: number; common_name: string; status: string; not_after: number | null }
export interface EdgeGroupBasic { id: number; name: string }
export interface EdgeVhostBasic { id: number; kind: string; is_enabled: boolean; server_name: string | null }

export interface EdgeVhostRow {
    id: number;
    created: number;
    kind: string;
    pool: string;
    is_enabled: boolean;
    server_name: string | null;
    domain: EdgeDomainBasic | null;
    // `default` graph only.
    modified?: number;
    label?: string;
    spa?: boolean;
    body_size_mb?: number;
    quiet_paths?: string[];
    serve_static?: boolean;
    /** Read-only here: shown, never sent. */
    mojosec_policy?: Record<string, unknown>;
    redirect_to?: string | null;
    upstream?: EdgeUpstreamBasic | null;
    certificate?: EdgeCertificateBasic | null;
}

export interface EdgeRouteRow {
    id: number;
    created: number;
    modified: number;
    path_prefix: string;
    vhost: EdgeVhostBasic | null;
    upstream: EdgeUpstreamBasic | null;
}

export interface EdgeUpstreamRow {
    id: number;
    created: number;
    modified: number;
    name: string;
    kind: string;
    host: string | null;
    port: number | null;
    socket_path: string | null;
    is_enabled: boolean;
    group: EdgeGroupBasic | null;
}

export interface EdgeBlocklistRow {
    id: number;
    created: number;
    modified: number;
    kind: string;
    value: string;
    mode: string;
    note: string;
}

function rowObject(value: unknown): Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function projectDomain(value: unknown): EdgeDomainBasic | null {
    if (value == null || typeof value !== 'object') return null;
    const raw = rowObject(value);
    return { id: raw.id as number, name: raw.name as string, provider: raw.provider as string, status: raw.status as string, expires: (raw.expires ?? null) as number | null };
}

function projectUpstream(value: unknown): EdgeUpstreamBasic | null {
    if (value == null || typeof value !== 'object') return null;
    const raw = rowObject(value);
    return { id: raw.id as number, name: raw.name as string, kind: raw.kind as string };
}

function projectCertificate(value: unknown): EdgeCertificateBasic | null {
    if (value == null || typeof value !== 'object') return null;
    const raw = rowObject(value);
    return { id: raw.id as number, common_name: raw.common_name as string, status: raw.status as string, not_after: (raw.not_after ?? null) as number | null };
}

function projectVhostBasic(value: unknown): EdgeVhostBasic | null {
    if (value == null || typeof value !== 'object') return null;
    const raw = rowObject(value);
    return { id: raw.id as number, kind: raw.kind as string, is_enabled: raw.is_enabled === true, server_name: (raw.server_name ?? null) as string | null };
}

function projectGroup(value: unknown): EdgeGroupBasic | null {
    if (value == null || typeof value !== 'object') return null;
    const raw = rowObject(value);
    return { id: raw.id as number, name: raw.name as string };
}

/** Positive projection: a key the graph does not name never reaches a row. */
export function sanitizeEdgeVhostRow(row: unknown): EdgeVhostRow {
    const raw = rowObject(row);
    return {
        id: raw.id as number, created: raw.created as number, kind: raw.kind as string,
        pool: raw.pool as string, is_enabled: raw.is_enabled === true,
        server_name: (raw.server_name ?? null) as string | null,
        domain: projectDomain(raw.domain),
        ...('modified' in raw ? { modified: raw.modified as number } : {}),
        ...('label' in raw ? { label: raw.label as string } : {}),
        ...('spa' in raw ? { spa: raw.spa === true } : {}),
        ...('body_size_mb' in raw ? { body_size_mb: raw.body_size_mb as number } : {}),
        ...('quiet_paths' in raw ? { quiet_paths: Array.isArray(raw.quiet_paths) ? raw.quiet_paths.filter((path): path is string => typeof path === 'string') : [] } : {}),
        ...('serve_static' in raw ? { serve_static: raw.serve_static === true } : {}),
        ...('mojosec_policy' in raw ? { mojosec_policy: { ...rowObject(raw.mojosec_policy) } } : {}),
        ...('redirect_to' in raw ? { redirect_to: (raw.redirect_to ?? null) as string | null } : {}),
        ...('upstream' in raw ? { upstream: projectUpstream(raw.upstream) } : {}),
        ...('certificate' in raw ? { certificate: projectCertificate(raw.certificate) } : {}),
    };
}

export function sanitizeEdgeRouteRow(row: unknown): EdgeRouteRow {
    const raw = rowObject(row);
    return {
        id: raw.id as number, created: raw.created as number, modified: raw.modified as number,
        path_prefix: raw.path_prefix as string,
        vhost: projectVhostBasic(raw.vhost), upstream: projectUpstream(raw.upstream),
    };
}

export function sanitizeEdgeUpstreamRow(row: unknown): EdgeUpstreamRow {
    const raw = rowObject(row);
    return {
        id: raw.id as number, created: raw.created as number, modified: raw.modified as number,
        name: raw.name as string, kind: raw.kind as string,
        host: (raw.host ?? null) as string | null, port: (raw.port ?? null) as number | null,
        socket_path: (raw.socket_path ?? null) as string | null,
        is_enabled: raw.is_enabled === true, group: projectGroup(raw.group),
    };
}

export function sanitizeEdgeBlocklistRow(row: unknown): EdgeBlocklistRow {
    const raw = rowObject(row);
    return {
        id: raw.id as number, created: raw.created as number, modified: raw.modified as number,
        kind: raw.kind as string, value: raw.value as string, mode: raw.mode as string,
        note: typeof raw.note === 'string' ? raw.note : '',
    };
}

const COMMON = new Set(['start', 'size', 'search']);

function normalizeListParams(params: Params, filters: ReadonlySet<string>, sorts: ReadonlySet<string>, graph: string): Params {
    const safe: Params = { graph };
    for (const [key, value] of Object.entries(params)) {
        if (value == null || value === '') continue;
        if (COMMON.has(key) || filters.has(key)) safe[key] = value;
    }
    if (typeof params.sort === 'string' && sorts.has(params.sort.replace(/^-/, ''))) safe.sort = params.sort;
    return safe;
}

export function normalizeVhostListParams(params: Params): Params {
    return normalizeListParams(
        params,
        new Set(['kind', 'pool', 'is_enabled', 'domain', 'domain__group']),
        new Set(['label', 'kind', 'pool', 'created', 'is_enabled']),
        params.graph === 'default' ? 'default' : 'list',
    );
}

export function normalizeRouteListParams(params: Params): Params {
    return normalizeListParams(params, new Set(['vhost']), new Set(['path_prefix', 'created']), 'default');
}

export function normalizeUpstreamListParams(params: Params): Params {
    return normalizeListParams(params, new Set(['is_enabled', 'kind']), new Set(['name', 'kind', 'created', 'is_enabled']), 'default');
}

export function normalizeBlocklistListParams(params: Params): Params {
    return normalizeListParams(params, new Set(['kind', 'mode', 'mode__in']), new Set(['created', 'kind', 'value', 'mode']), 'default');
}

export const EdgeVhostModel = defineModel<EdgeVhostRow>({
    name: 'edge_vhost', endpoint: '/api/edge/vhost',
    permissions: { view: DNS_VIEW_PERMISSIONS, manage: DNS_MANAGE_PERMISSIONS, delete: DNS_MANAGE_PERMISSIONS },
    normalizeListParams: normalizeVhostListParams,
    sanitizeRow: sanitizeEdgeVhostRow,
});

export const EdgeRouteModel = defineModel<EdgeRouteRow>({
    name: 'edge_route', endpoint: '/api/edge/route',
    permissions: { view: DNS_VIEW_PERMISSIONS, manage: DNS_MANAGE_PERMISSIONS, delete: DNS_MANAGE_PERMISSIONS },
    normalizeListParams: normalizeRouteListParams,
    sanitizeRow: sanitizeEdgeRouteRow,
});

export const EdgeUpstreamModel = defineModel<EdgeUpstreamRow>({
    name: 'edge_upstream', endpoint: '/api/edge/upstream',
    permissions: { view: DNS_VIEW_PERMISSIONS, manage: DNS_MANAGE_PERMISSIONS },
    normalizeListParams: normalizeUpstreamListParams,
    sanitizeRow: sanitizeEdgeUpstreamRow,
});

export const EdgeBlocklistModel = defineModel<EdgeBlocklistRow>({
    name: 'edge_blocklist', endpoint: '/api/edge/blocklist',
    permissions: { view: EDGE_BLOCKLIST_VIEW_PERMS, manage: EDGE_BLOCKLIST_MANAGE_PERMS, delete: EDGE_BLOCKLIST_MANAGE_PERMS },
    normalizeListParams: normalizeBlocklistListParams,
    sanitizeRow: sanitizeEdgeBlocklistRow,
});

// ── Client mirrors of the server validators ───────────────────────────

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const REQUEST_PATH_RE = /^\/[A-Za-z0-9._/-]{0,127}$/;
const UA_PATTERN_RE = /^[A-Za-z0-9()[\]|?^.*+\\/_-]{1,256}$/;
const POOL_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** `validators.server_name_for`: the name is derived, never typed. */
export function deriveServerName(domainName: string, label: string): string {
    return label === '' ? domainName : `${label}.${domainName}`;
}

/** Returns the refusal, or null when the value is acceptable. */
export function validateVhostLabel(label: string): string | null {
    if (label === '' || label === '*') return null;
    return LABEL_RE.test(label) ? null : "Leave empty for the apex, use '*' for the wildcard, or enter one DNS label of lowercase letters, digits and hyphens.";
}

function validateServerName(name: string): string | null {
    if (!name) return 'Enter a host name.';
    if (name.length > 253) return 'The host name is too long.';
    const parts = (name.startsWith('*.') ? name.slice(2) : name).split('.');
    if (parts.length < 2) return `${name} is not a fully qualified domain name.`;
    return parts.every((part) => LABEL_RE.test(part)) ? null : `${name} is not a valid host name.`;
}

/** A redirect target is a host: no scheme, path, port or wildcard. */
export function validateRedirectTarget(target: string): string | null {
    if (!target) return 'A redirect needs a target host.';
    if (target.startsWith('*.')) return 'A redirect target cannot be a wildcard.';
    return validateServerName(target);
}

/** Shared by quiet paths and route prefixes (`_validate_request_path`). */
export function validateRequestPath(path: string, what = 'A path'): string | null {
    if (!REQUEST_PATH_RE.test(path)) return `${what} must start with '/' and use only letters, digits, '.', '_', '-' and '/' (max 128 characters).`;
    if (path.includes('//')) return `${what} may not contain '//'.`;
    if (path.split('/').some((part) => part === '..')) return `${what} may not contain a '..' segment.`;
    return null;
}

export function validateRoutePrefix(prefix: string): string | null {
    const refusal = validateRequestPath(prefix, 'A route prefix');
    if (refusal) return refusal;
    return prefix === '/' ? "A route prefix cannot be '/'. Use an API host for a whole-host proxy." : null;
}

export function validateBodySizeMb(value: unknown): string | null {
    if (typeof value !== 'number' || !Number.isInteger(value)) return 'Body size must be a whole number of megabytes.';
    return value >= 1 && value <= 4096 ? null : 'Body size must be between 1 and 4096 megabytes.';
}

export function validatePoolName(pool: string): string | null {
    return POOL_RE.test(pool) ? null : "A pool is lowercase letters, digits, '-' or '_'.";
}

/** Port of `validators.certificate_covers`, both wildcard rules included. */
export function certificateCovers(certificate: { common_name?: string | null; sans?: readonly unknown[] | null }, serverName: string): boolean {
    const names: string[] = [];
    if (certificate.common_name) names.push(certificate.common_name);
    for (const san of certificate.sans ?? []) if (typeof san === 'string') names.push(san);
    const target = serverName.toLowerCase();
    for (const name of names) {
        const candidate = name.toLowerCase();
        if (candidate === target) return true;
        if (candidate.startsWith('*.')) {
            const suffix = candidate.slice(1);
            if (target.endsWith(suffix)) {
                const remainder = target.slice(0, -suffix.length);
                if (remainder && !remainder.includes('.')) return true;
            }
        }
    }
    return false;
}

/** The server stores `ip` rows normalized; this only refuses what cannot parse. */
export function validateBlocklistValue(kind: string, value: string): string | null {
    if (!value) return 'Enter a value.';
    if (kind === 'ip') {
        const [address = '', prefix, ...rest] = value.split('/');
        if (rest.length) return `${value} is not an IP address or CIDR network.`;
        const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
        const isV4 = !!v4 && v4.slice(1).every((octet) => Number(octet) <= 255);
        const isV6 = !isV4 && address.includes(':') && /^[0-9A-Fa-f:.]{2,45}$/.test(address);
        if (!isV4 && !isV6) return `${value} is not an IP address or CIDR network.`;
        if (prefix !== undefined && (!/^\d{1,3}$/.test(prefix) || Number(prefix) > (isV4 ? 32 : 128))) return `${value} is not an IP address or CIDR network.`;
        return null;
    }
    if (!UA_PATTERN_RE.test(value)) return 'A user-agent pattern may use letters, digits and the regex characters ()[]|?^.*+-/_\\ only (max 256 characters, no spaces, quotes or braces).';
    if ((value.length - value.replace(/\\+$/, '').length) % 2 === 1) return 'A user-agent pattern cannot end with an unescaped backslash.';
    try { new RegExp(value); } catch { return 'The user-agent pattern does not compile.'; }
    return null;
}

export interface VhostDraft {
    kind: VhostKind;
    domain?: number | null;
    label: string;
    certificate: number | null;
    pool: string;
    is_enabled: boolean;
    upstream?: number | null;
    serve_static?: boolean;
    quiet_paths?: string[];
    body_size_mb?: number;
    spa?: boolean;
    redirect_to?: string;
}

/**
 * Kind-discriminated allowlist. A knob the chosen kind does not carry is sent
 * as its empty value, so a draft that visited another shape cannot leak that
 * shape's fields and an edit that changes kind clears what the old kind held.
 */
export function buildVhostPayload(draft: VhostDraft, opts: { create: boolean }): Record<string, unknown> {
    const kind = draft.kind;
    const proxies = kind === 'api' || kind === 'site_api';
    const payload: Record<string, unknown> = {
        ...(opts.create ? { domain: draft.domain } : {}),
        label: draft.label, kind, certificate: draft.certificate, pool: draft.pool, is_enabled: draft.is_enabled,
        upstream: kind === 'api' ? draft.upstream ?? null : null,
        redirect_to: kind === 'redirect' ? draft.redirect_to ?? '' : null,
        spa: kind === 'site' || kind === 'site_api' ? draft.spa === true : false,
        serve_static: proxies ? draft.serve_static === true : false,
        quiet_paths: proxies ? [...(draft.quiet_paths ?? [])] : [],
    };
    // A redirect serves no body; the server default stands.
    if (kind !== 'redirect' && draft.body_size_mb != null) payload.body_size_mb = draft.body_size_mb;
    return payload;
}

export interface RouteDraft { path_prefix: string; upstream: number | null }

/** The gate both the knobs step and the review step apply to a site_api draft. */
export function validateRouteDrafts(rows: readonly RouteDraft[]): string | null {
    if (!rows.length) return 'Add at least one route. A site with API paths needs a path prefix to proxy.';
    const seen = new Set<string>();
    for (const row of rows) {
        const refusal = validateRoutePrefix(row.path_prefix);
        if (refusal) return refusal;
        if (row.upstream == null) return `Choose an upstream for ${row.path_prefix}.`;
        if (seen.has(row.path_prefix)) return `${row.path_prefix} is listed twice.`;
        seen.add(row.path_prefix);
    }
    return null;
}

/** site_api only: a quiet path must sit under a declared route prefix. */
export function quietPathUncovered(paths: readonly string[], prefixes: readonly string[]): string | null {
    return paths.find((path) => !prefixes.some((prefix) => path.startsWith(prefix))) ?? null;
}

export function upstreamTarget(row: Pick<EdgeUpstreamRow, 'kind' | 'host' | 'port' | 'socket_path'>): string {
    return row.kind === 'unix' ? `unix:${row.socket_path ?? ''}` : `${row.host ?? ''}:${row.port ?? ''}`;
}
