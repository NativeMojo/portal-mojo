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

/** True when the in-memory mock transport is active (VITE_MOJO_API unset). */
export function usingMockTransport(): boolean {
    return !API_BASE;
}

/** The configured django-mojo origin ('' under the mock transport). */
export function apiOrigin(): string {
    return API_BASE;
}

/**
 * TanStack Query defaults tuned for the mojo protocol — spread these into the
 * app's QueryClient:
 *   · 4xx MojoErrors never retry (a 404/401/403 is deterministic — retrying
 *     it only delays the error surfacing, e.g. the group-context fallback)
 *   · networkMode 'always' under the mock (an in-memory backend can't be
 *     offline; online-pausing would wedge failures forever), 'online' for
 *     real backends.
 */
export function mojoQueryDefaults() {
    return {
        queries: {
            networkMode: (usingMockTransport() ? 'always' : 'online') as 'always' | 'online',
            retry: (failureCount: number, error: unknown): boolean => {
                if (error instanceof MojoError && error.status >= 400 && error.status < 500) return false;
                return failureCount < 1;
            },
            // No refetch storm on window focus (web-mojo parity: freshness
            // comes from explicit refresh + the opt-in autoRefresh interval).
            // With it on, every hop back from devtools/another window refired
            // EVERY active query — read as phantom duplicate fetches.
            refetchOnWindowFocus: false,
        },
    };
}

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
}

/**
 * django-mojo metrics. The wire shape (verified live) is
 * `{data: {<slug>: number[]}, labels: string[]}` — a slug-keyed map with NO
 * granularity/range echo. Normalized HERE (the one boundary) into the
 * datasets array the chart components consume; display names for slugs are a
 * presentation concern (MetricsChart), not a wire fact.
 */
export async function mojoMetrics(params: Params): Promise<MetricsResponse> {
    const body = await unwrap('/api/metrics/fetch', { params });
    const raw = (body.data ?? {}) as { data?: Record<string, number[]>; labels?: string[] };
    return {
        labels: raw.labels ?? [],
        datasets: Object.entries(raw.data ?? {}).map(([slug, data]) => ({ label: slug, data: data ?? [] })),
    };
}

/** Create (no id) or update (with id). Rejects on any failure. */
export async function mojoSave<T>(endpoint: string, id: number | string | null, changes: Record<string, unknown>): Promise<T> {
    const path = id == null ? endpoint : `${endpoint}/${id}`;
    const body = await unwrap(path, { method: 'POST', body: changes });
    return body.data as T;
}

/**
 * Delete a record. django-mojo answers `{status: "deleted"}` (a string — the
 * envelope's only non-boolean status; it passes the unwrap's `=== false`
 * failure check by design). Failures reject like every other call.
 */
export async function mojoDelete(endpoint: string, id: number | string): Promise<void> {
    await unwrap(`${endpoint}/${id}`, { method: 'DELETE' });
}

/** Trigger a browser download of an in-memory file. Shared by safe client exports. */
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/**
 * Server-side export (mojo/models/rest.py on_rest_list_response): the list
 * endpoint with `download_format=csv|json` + `filename` streams a file built
 * from the model's graph fields under the CURRENT filters (paging params are
 * stripped here — an export is the whole result set). Under the mock the
 * same filter pipeline synthesizes the file content in-memory.
 */
export async function mojoDownload(endpoint: string, params: Params, format: 'csv' | 'json'): Promise<void> {
    const cleaned: Params = { ...params };
    delete cleaned.start;
    delete cleaned.size;
    const filename = `export-${endpoint.split('/').filter(Boolean).pop() ?? 'data'}.${format}`;
    const withFormat: Params = { ...cleaned, download_format: format, filename };

    if (authHooks) await authHooks.preRequest(endpoint);
    const headers: Record<string, string> = { [DUID_HEADER]: getDuid() };
    const bearer = authHooks?.authHeader();
    if (bearer) headers['Authorization'] = bearer;

    if (!API_BASE) {
        const body = (await mockFetch(endpoint, { params: withFormat, headers })) as Envelope;
        if (body.status === false) throw new MojoError(body.error ?? 'Export failed', body.error_code ?? 0);
        const file = body.data as { filename: string; content: string; mime: string };
        downloadBlob(new Blob([file.content], { type: file.mime }), file.filename);
        return;
    }
    const res = await fetch(`${API_BASE}${endpoint}${buildQuery(withFormat)}`, { headers });
    if (!res.ok) throw new MojoError(`Export failed (HTTP ${res.status})`, res.status);
    downloadBlob(await res.blob(), filename);
}
