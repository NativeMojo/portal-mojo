import { useQuery, type QueryClient } from '@tanstack/react-query';
import { apiOrigin, defineModel, mojoCall, mojoDelete, mojoGet, mojoList, mojoSave, type Params } from '../../client';

export const SHORTLINK_MANAGE_PERMISSIONS = ['sys.manage_shortlinks'];
export const SHORTLINK_ENDPOINT = '/api/shortlink/link';
export const SHORTLINK_HISTORY_ENDPOINT = '/api/shortlink/history';

export interface ShortlinkRelation { id: number; name?: string; display_name?: string; email?: string }
export interface ShortlinkRow {
    id: number;
    code: string;
    source: string;
    hit_count: number;
    expires_at: number | string | null;
    is_active: boolean;
    is_protected: boolean;
    track_clicks: boolean;
    bot_passthrough: boolean;
    created: number | string;
    modified: number | string | null;
    user: ShortlinkRelation | number | null;
    group: ShortlinkRelation | number | null;
}

export interface ShortlinkHistoryRow {
    id: number;
    shortlink_id: number | null;
    code: string;
    is_bot: boolean;
    created: number | string;
    agent_summary: string;
    referer_origin: string | null;
}

const FORBIDDEN_KEYS = /^(url|destination|ip|ip_address|user_agent|referer|metadata)$/i;

/** Defense in depth: fail a verifier if a future projection accidentally retains a raw sensitive key. */
export function assertSafeShortlinkProjection(value: unknown): void {
    const visit = (candidate: unknown): void => {
        if (Array.isArray(candidate)) { candidate.forEach(visit); return; }
        if (!candidate || typeof candidate !== 'object') return;
        for (const [key, child] of Object.entries(candidate as Record<string, unknown>)) {
            if (FORBIDDEN_KEYS.test(key)) throw new Error(`Unsafe shortlink projection retained ${key}`);
            visit(child);
        }
    };
    visit(value);
}

function relation(value: unknown): ShortlinkRelation | number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    if (!Number.isFinite(Number(raw.id))) return null;
    return {
        id: Number(raw.id),
        ...(typeof raw.name === 'string' ? { name: raw.name.slice(0, 120) } : {}),
        ...(typeof raw.display_name === 'string' ? { display_name: raw.display_name.slice(0, 120) } : {}),
        ...(typeof raw.email === 'string' ? { email: raw.email.slice(0, 254) } : {}),
    };
}

function temporal(value: unknown): number | string | null {
    return typeof value === 'number' && Number.isFinite(value) ? value
        : typeof value === 'string' && value.length <= 40 ? value : null;
}

/** Positive projection. The backend's graph=list includes url; it never crosses this boundary. */
export function sanitizeShortlinkRow(input: unknown): ShortlinkRow {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const row: ShortlinkRow = {
        id: Number(raw.id), code: String(raw.code ?? '').slice(0, 10), source: String(raw.source ?? '').slice(0, 50),
        hit_count: Math.max(0, Number(raw.hit_count ?? 0) || 0), expires_at: temporal(raw.expires_at),
        is_active: Boolean(raw.is_active), is_protected: Boolean(raw.is_protected),
        track_clicks: Boolean(raw.track_clicks), bot_passthrough: Boolean(raw.bot_passthrough),
        created: temporal(raw.created) ?? 0, modified: temporal(raw.modified), user: relation(raw.user), group: relation(raw.group),
    };
    assertSafeShortlinkProjection(row);
    return row;
}

function boundedAgentSummary(userAgent: unknown, isBot: boolean): string {
    const ua = typeof userAgent === 'string' ? userAgent : '';
    const bot = ua.match(/(Googlebot|Bingbot|Slackbot|Discordbot|Twitterbot|facebookexternalhit|bot|crawler|spider)/i)?.[1];
    if (isBot) return `${bot ? bot.replace(/externalhit/i, '') : 'Bot'} · automated`.slice(0, 60);
    const browser = ua.match(/Edg\/[\d.]+/i) ? 'Edge'
        : ua.match(/Firefox\/[\d.]+/i) ? 'Firefox'
            : ua.match(/(?:Chrome|CriOS)\/[\d.]+/i) ? 'Chrome'
                : ua.match(/Version\/[\d.]+.*Safari/i) ? 'Safari' : 'Browser';
    const platform = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS'
        : /Windows/i.test(ua) ? 'Windows' : /Macintosh|Mac OS/i.test(ua) ? 'macOS'
            : /Linux/i.test(ua) ? 'Linux' : 'unknown platform';
    return `${browser} · ${platform}`.slice(0, 60);
}

function refererOrigin(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 4096) return null;
    try {
        const parsed = new URL(value);
        return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.origin.slice(0, 255) : null;
    } catch { return null; }
}

/** Positive projection for click evidence: no IP, raw UA, path/query/fragment, metadata, or nested destination. */
export function sanitizeShortlinkHistoryRow(input: unknown): ShortlinkHistoryRow {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const nested = raw.shortlink && typeof raw.shortlink === 'object' && !Array.isArray(raw.shortlink)
        ? raw.shortlink as Record<string, unknown> : {};
    const isBot = Boolean(raw.is_bot);
    const row: ShortlinkHistoryRow = {
        id: Number(raw.id), shortlink_id: Number.isFinite(Number(nested.id)) ? Number(nested.id) : null,
        code: String(nested.code ?? '').slice(0, 10), is_bot: isBot, created: temporal(raw.created) ?? 0,
        agent_summary: boundedAgentSummary(raw.user_agent, isBot), referer_origin: refererOrigin(raw.referer),
    };
    assertSafeShortlinkProjection(row);
    return row;
}

const LINK_FILTERS = new Set(['id', 'id__in', 'code', 'source', 'source__in', 'is_active', 'created__gte', 'created__lte']);
const LINK_SORTS = new Set(['id', 'code', 'source', 'hit_count', 'expires_at', 'is_active', 'created']);
const HISTORY_FILTERS = new Set(['id', 'shortlink', 'is_bot', 'created__gte', 'created__lte']);
const HISTORY_SORTS = new Set(['id', 'is_bot', 'created']);
function allow(params: Params, graph: 'list' | 'default', filters: Set<string>, sorts: Set<string>): Params {
    const out: Params = { graph, start: params.start ?? 0, size: params.size ?? 25 };
    for (const [key, value] of Object.entries(params)) {
        if ((filters.has(key) || ['start', 'size', 'sort', 'dr_start', 'dr_end'].includes(key)) && value != null && value !== '') out[key] = value;
    }
    if (out.dr_start != null || out.dr_end != null) out.dr_field = 'created';
    const sort = typeof out.sort === 'string' ? out.sort : '-created';
    out.sort = sorts.has(sort.replace(/^-/, '')) ? sort : '-created';
    return out;
}

export const ShortlinkModel = defineModel<ShortlinkRow>({
    name: 'shortlink', endpoint: SHORTLINK_ENDPOINT,
    permissions: { view: SHORTLINK_MANAGE_PERMISSIONS, manage: SHORTLINK_MANAGE_PERMISSIONS, create: SHORTLINK_MANAGE_PERMISSIONS, delete: SHORTLINK_MANAGE_PERMISSIONS },
    normalizeListParams: (params) => allow(params, 'list', LINK_FILTERS, LINK_SORTS), sanitizeRow: sanitizeShortlinkRow,
});

export const ShortlinkHistoryModel = defineModel<ShortlinkHistoryRow>({
    name: 'shortlink-history', endpoint: SHORTLINK_HISTORY_ENDPOINT,
    permissions: { view: SHORTLINK_MANAGE_PERMISSIONS },
    normalizeListParams: (params) => allow(params, 'default', HISTORY_FILTERS, HISTORY_SORTS), sanitizeRow: sanitizeShortlinkHistoryRow,
});

export function functionalShortlinkUrl(code: string): string {
    const origin = apiOrigin().replace(/\/$/, '');
    return `${origin}/s/${encodeURIComponent(code)}`;
}

export class ShortlinkReconciliationError extends Error {
    readonly retryBlocked = true;
    constructor(cause: unknown) {
        super('The change may have persisted, but authoritative reconciliation failed. Refresh successfully before retrying.', { cause });
        this.name = 'ShortlinkReconciliationError';
    }
}

async function authoritativeList(params: Params): Promise<ShortlinkRow[]> {
    const result = await mojoList<unknown>(SHORTLINK_ENDPOINT, ShortlinkModel.normalizeListParams?.(params) ?? params);
    return result.rows.map(sanitizeShortlinkRow);
}

async function reconcile(queryClient: QueryClient, id?: number, code?: string): Promise<ShortlinkRow | null> {
    let row: ShortlinkRow | null = null;
    if (id != null) {
        try { row = sanitizeShortlinkRow(await mojoGet<unknown>(SHORTLINK_ENDPOINT, id)); }
        catch (error) {
            if (!(error && typeof error === 'object' && 'status' in error && Number((error as { status: unknown }).status) === 404)) throw error;
        }
    } else if (code) row = (await authoritativeList({ code, size: 2 }))[0] ?? null;
    await queryClient.invalidateQueries({ queryKey: ShortlinkModel.keys.root, refetchType: 'none' });
    if (row) queryClient.setQueryData(ShortlinkModel.keys.one(row.id), row);
    else if (id != null) queryClient.removeQueries({ queryKey: ShortlinkModel.keys.one(id) });
    await queryClient.refetchQueries({ queryKey: ShortlinkModel.keys.root, type: 'active' });
    return row;
}

async function runReconciled<T>(mutation: () => Promise<T>, reconcileNow: (result: T | null) => Promise<ShortlinkRow | null>): Promise<ShortlinkRow | null> {
    let result: T | null = null;
    let mutationError: unknown;
    let authoritative: ShortlinkRow | null = null;
    let reconciliationError: unknown;
    try { result = await mutation(); }
    catch (error) { mutationError = error; }
    finally {
        try { authoritative = await reconcileNow(result); }
        catch (error) { reconciliationError = error; }
    }
    if (reconciliationError) throw new ShortlinkReconciliationError(reconciliationError);
    if (mutationError) throw mutationError;
    return authoritative;
}

export async function createShortlink(queryClient: QueryClient, changes: { url: string; source?: string; expire_days?: number; expire_hours?: number; track_clicks?: boolean; bot_passthrough?: boolean; is_protected?: boolean }): Promise<ShortlinkRow> {
    const result = await runReconciled(
        () => mojoCall(`${SHORTLINK_ENDPOINT}/create`, { method: 'POST', body: changes }),
        async (body) => {
            const raw = body?.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : {};
            const short = typeof raw.short_link === 'string' ? raw.short_link : '';
            const code = decodeURIComponent(short.split('/').filter(Boolean).at(-1) ?? '');
            if (!code) {
                await authoritativeList({ size: 1 });
                await queryClient.invalidateQueries({ queryKey: ShortlinkModel.keys.root });
                return null;
            }
            const listed = (await authoritativeList({ code, size: 2 }))[0] ?? null;
            return listed ? reconcile(queryClient, listed.id) : null;
        },
    );
    if (!result) throw new ShortlinkReconciliationError(new Error('Created row was not visible after create'));
    return result;
}

export function setShortlinkActive(queryClient: QueryClient, row: ShortlinkRow, isActive: boolean): Promise<ShortlinkRow | null> {
    return runReconciled(() => mojoSave(SHORTLINK_ENDPOINT, row.id, { is_active: isActive }), () => reconcile(queryClient, row.id));
}

export function deleteShortlink(queryClient: QueryClient, row: ShortlinkRow): Promise<ShortlinkRow | null> {
    return runReconciled(() => mojoDelete(SHORTLINK_ENDPOINT, row.id), () => reconcile(queryClient, row.id));
}

export async function refreshShortlinks(queryClient: QueryClient): Promise<void> {
    await authoritativeList({ size: 1 });
    await queryClient.invalidateQueries({ queryKey: ShortlinkModel.keys.root });
}

export interface TrackedCounts { human: number; bot: number; tracked: number; remainder: number }
export async function fetchTrackedCounts(shortlink: ShortlinkRow): Promise<TrackedCounts> {
    const fetchCount = async (isBot: boolean) => {
        const result = await mojoList<unknown>(SHORTLINK_HISTORY_ENDPOINT,
            ShortlinkHistoryModel.normalizeListParams?.({ shortlink: shortlink.id, is_bot: isBot, size: 1 }) ?? {});
        result.rows.forEach(sanitizeShortlinkHistoryRow);
        return result.count;
    };
    const [human, bot] = await Promise.all([fetchCount(false), fetchCount(true)]);
    const tracked = human + bot;
    return { human, bot, tracked, remainder: Math.max(0, shortlink.hit_count - tracked) };
}

export function useTrackedCounts(shortlink: ShortlinkRow | null) {
    return useQuery({
        queryKey: ['shortlink-tracked-counts', shortlink?.id, shortlink?.hit_count],
        queryFn: () => fetchTrackedCounts(shortlink!), enabled: shortlink != null,
    });
}
