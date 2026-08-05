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
//
// With VITE_MOJO_API unset the transport is the in-memory mock; set it to a
// django-mojo origin and the same code talks to the real backend.
import { mockFetch } from './mock';
import type { MojoList, Params } from './types';

const API_BASE: string = import.meta.env.VITE_MOJO_API ?? '';

export class MojoError extends Error {
    status: number;
    constructor(message: string, status = 0) {
        super(message);
        this.name = 'MojoError';
        this.status = status;
    }
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

interface FetchOpts {
    params?: Params;
    method?: 'GET' | 'POST' | 'DELETE';
    body?: Record<string, unknown>;
}

interface Envelope {
    status: boolean;
    data?: unknown;
    error?: string;
    message?: string;
    count?: number;
    size?: number;
    start?: number;
}

async function transport(path: string, opts: FetchOpts): Promise<Envelope> {
    if (!API_BASE) {
        return (await mockFetch(path, opts)) as Envelope;
    }
    const res = await fetch(`${API_BASE}${path}${buildQuery(opts.params ?? {})}`, {
        method: opts.method ?? 'GET',
        headers: {
            'Content-Type': 'application/json',
            // Real deployments add: Authorization: Bearer <token>, X-Mojo-UID
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) throw new MojoError(`HTTP ${res.status}`, res.status);
    return (await res.json()) as Envelope;
}

/** The single envelope-unwrap boundary. */
async function unwrap(path: string, opts: FetchOpts): Promise<Envelope> {
    const body = await transport(path, opts);
    if (body.status === false) {
        throw new MojoError(body.error ?? body.message ?? 'Request failed');
    }
    return body;
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
