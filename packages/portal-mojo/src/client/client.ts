// Mini @mojo/client — the typed django-mojo protocol layer.
//
// Contract (from the web-mojo port extraction):
//   - Envelope: {status, ...} — status:false carries error/message. Unwrapped
//     HERE, at exactly one boundary. A failed save REJECTS (MojoError); it is
//     never resolved as success. (web-mojo's Model.save() never-rejects trap
//     is deliberately not carried forward.)
//   - Lists: {status, data: T[], count, size, start} → MojoList<T>.
//   - Singles: {status, data: T} → T.
//   - Paging: start/size. Sort: 'field' | '-field'. Filters: Django lookups.
//   - Every request carries the X-Mojo-UID device header; when auth is
//     initialized (initAuth), a pre-request gate + Authorization header are
//     installed via installAuthHooks — the client core itself has zero auth
//     knowledge (web-mojo's Rest-interceptor shape).
//
// With VITE_MOJO_API unset the transport is the in-memory mock; set it to a
// django-mojo origin and the same code talks to the real backend.
import { mockFetch } from './mock';
import { MojoError } from './errors';
import { DUID_HEADER, getDuid } from './duid';
import type { MojoList, Params } from './types';

export { MojoError, AuthRequiredError } from './errors';

const API_BASE: string = import.meta.env.VITE_MOJO_API ?? '';

export function buildQuery(params: Params): string {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        qs.set(key, String(value));
    }
    const s = qs.toString();
    return s ? `?${s}` : '';
}

export interface FetchOpts {
    params?: Params;
    method?: 'GET' | 'POST' | 'DELETE';
    body?: Record<string, unknown>;
}

export interface Envelope {
    status: boolean;
    data?: unknown;
    error?: string;
    error_code?: number;
    message?: string;
    count?: number;
    size?: number;
    start?: number;
}

/** Installed by auth (initAuth). The transport stays auth-agnostic. */
export interface AuthHooks {
    /** Pre-request gate; may throw AuthRequiredError → synthetic-401 reject, no fetch. */
    preRequest(path: string): Promise<void>;
    /** Authorization header value, or null when no session exists. */
    authHeader(): string | null;
}

let authHooks: AuthHooks | null = null;

export function installAuthHooks(hooks: AuthHooks | null): void {
    authHooks = hooks;
}

async function transport(path: string, opts: FetchOpts): Promise<Envelope> {
    // Gate BEFORE headers are built: after a mid-gate token refresh the fresh
    // Authorization value is picked up below by construction (web-mojo had to
    // re-stamp a snapshotted header here).
    if (authHooks) await authHooks.preRequest(path);

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        [DUID_HEADER]: getDuid(),
    };
    const bearer = authHooks?.authHeader();
    if (bearer) headers['Authorization'] = bearer;

    if (!API_BASE) {
        return (await mockFetch(path, { ...opts, headers })) as Envelope;
    }
    const res = await fetch(`${API_BASE}${path}${buildQuery(opts.params ?? {})}`, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
        // django-mojo sends its envelope on error responses too — surface the
        // real message ("Invalid username or password"), not "HTTP 401".
        let detail = `HTTP ${res.status}`;
        try {
            const body = (await res.json()) as Envelope;
            detail = body.error ?? body.message ?? detail;
        } catch {
            // Non-JSON error body — keep the status text.
        }
        throw new MojoError(detail, res.status);
    }
    return (await res.json()) as Envelope;
}

/** The single envelope-unwrap boundary. */
async function unwrap(path: string, opts: FetchOpts): Promise<Envelope> {
    const body = await transport(path, opts);
    if (body.status === false) {
        throw new MojoError(body.error ?? body.message ?? 'Request failed', body.error_code ?? 0);
    }
    return body;
}

/**
 * Typed escape hatch over the unwrap boundary for protocol modules (auth) and
 * one-off endpoints. Still the same single boundary — never parse envelopes
 * anywhere else.
 */
export function mojoCall(path: string, opts: FetchOpts = {}): Promise<Envelope> {
    return unwrap(path, opts);
}

export async function mojoList<T>(endpoint: string, params: Params = {}): Promise<MojoList<T>> {
    const body = await unwrap(endpoint, { params });
    return {
        rows: (body.data ?? []) as T[],
        count: body.count ?? 0,
        start: body.start ?? 0,
        size: body.size ?? 0,
    };
}

export async function mojoGet<T>(endpoint: string, id: number | string): Promise<T> {
    const body = await unwrap(`${endpoint}/${id}`, {});
    return body.data as T;
}

export interface MetricsResponse {
    labels: string[];
    datasets: { label: string; data: number[] }[];
    granularity: string;
    range: string;
}

/** django-mojo metrics: bucketed multi-series time data. */
export async function mojoMetrics(params: Params): Promise<MetricsResponse> {
    const body = await unwrap('/api/metrics/fetch', { params });
    return body.data as MetricsResponse;
}

/** Create (no id) or update (with id). Rejects on any failure. */
export async function mojoSave<T>(endpoint: string, id: number | string | null, changes: Record<string, unknown>): Promise<T> {
    const path = id == null ? endpoint : `${endpoint}/${id}`;
    const body = await unwrap(path, { method: 'POST', body: changes });
    return body.data as T;
}
