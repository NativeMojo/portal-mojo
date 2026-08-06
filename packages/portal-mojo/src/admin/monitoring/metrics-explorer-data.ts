/** Pure identifiers and wire-independent state for the recorded-metrics explorer. */

export const METRIC_ACCOUNT_MAX_LENGTH = 256;
export const METRIC_SEARCH_MAX_LENGTH = 128;
export const METRIC_DISCOVERY_PAGE_SIZE = 50;

export type MetricAccount =
    | { kind: 'public'; value: 'public' }
    | { kind: 'global'; value: 'global' }
    | { kind: 'group'; value: string; id: number }
    | { kind: 'user'; value: string; id: number }
    | { kind: 'custom'; value: string };

export interface MetricCategory {
    account: string;
    name: string;
}

export interface MetricSeriesSelection {
    account: string;
    category: string | null;
    slugs: string[];
}

export interface MetricPoint {
    slug: string;
    value: number;
    previous: number;
    delta: number;
    deltaPct?: number;
}

export interface MetricGaugeValue {
    account: string;
    slug: string;
    value: unknown;
}

export type MetricsDiscoveryResource = 'accounts' | 'categories' | 'slugs';

export interface MetricsDiscoveryFilters {
    account?: string;
    category?: string | null;
    search: string;
}

export interface MetricsDiscoveryRequest {
    resource: MetricsDiscoveryResource;
    account?: string;
    category?: string;
    search?: string;
    start?: number;
    size?: number;
}

export interface MetricsDiscoveryPage {
    resource: MetricsDiscoveryResource;
    filters: MetricsDiscoveryFilters;
    data: string[];
    start: number;
    size: number;
    count: number;
    pageCount: number;
    nextStart: number | null;
}

export interface MetricsFanoutSelection {
    mode: 'off' | 'sum' | 'breakdown';
    childKind: string;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Parse the public account grammar. Reserved prefixes fail closed instead of
 * becoming custom account names when their positive integer suffix is bad.
 */
export function parseMetricAccount(input: string): MetricAccount {
    const value = input.trim();
    if (!value) throw new Error('Metric account is required.');
    if (value.length > METRIC_ACCOUNT_MAX_LENGTH) {
        throw new Error(`Metric account must be ${METRIC_ACCOUNT_MAX_LENGTH} characters or fewer.`);
    }
    if (CONTROL_CHARS.test(value)) throw new Error('Metric account cannot contain control characters.');
    if (value === 'public') return { kind: 'public', value };
    if (value === 'global') return { kind: 'global', value };
    for (const kind of ['group', 'user'] as const) {
        const prefix = `${kind}-`;
        if (!value.startsWith(prefix)) continue;
        const suffix = value.slice(prefix.length);
        if (!/^[1-9]\d*$/.test(suffix) || !Number.isSafeInteger(Number(suffix))) {
            throw new Error(`${kind === 'group' ? 'Group' : 'User'} metric accounts require a positive integer id.`);
        }
        return { kind, value, id: Number(suffix) };
    }
    return { kind: 'custom', value };
}

/** Preserve first occurrence and exact spelling; empty selections are ignored. */
export function dedupeMetricSlugs(slugs: readonly string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of slugs) {
        const slug = raw;
        if (!slug || seen.has(slug)) continue;
        assertAddressableMetricSlug(slug);
        seen.add(slug);
        result.push(slug);
    }
    return result;
}

export function assertAddressableMetricSlug(slug: string): void {
    if (slug.includes(',')) {
        throw new Error(`Metric slug "${slug}" cannot be fetched because the backend uses comma-delimited slug lists.`);
    }
    if (CONTROL_CHARS.test(slug)) throw new Error('Metric slugs cannot contain control characters.');
}

export function metricSlugTail(slug: string): string {
    const tail = slug.split(':').at(-1) ?? '';
    if (!tail) throw new Error(`Metric slug "${slug}" has an empty final segment.`);
    return tail;
}

/**
 * The live history response loses everything before the last colon. Batch
 * only globally unique tails and isolate each member of a colliding group.
 */
export function planMetricHistoryRequests(slugs: readonly string[]): string[][] {
    const ordered = dedupeMetricSlugs(slugs);
    const counts = new Map<string, number>();
    for (const slug of ordered) {
        const tail = metricSlugTail(slug);
        counts.set(tail, (counts.get(tail) ?? 0) + 1);
    }
    const unique = ordered.filter((slug) => counts.get(metricSlugTail(slug)) === 1);
    return [
        ...(unique.length ? [unique] : []),
        ...ordered.filter((slug) => counts.get(metricSlugTail(slug))! > 1).map((slug) => [slug]),
    ];
}

export function metricsDiscoveryKey(callerId: number | string, request: MetricsDiscoveryRequest) {
    return [
        'metrics-discover', callerId, request.resource,
        request.account ?? null, request.category ?? null, request.search ?? '',
        request.start ?? 0, request.size ?? METRIC_DISCOVERY_PAGE_SIZE,
    ] as const;
}

/** Repeated URL parameters keep full slug boundaries; commas are never flattened. */
export function replaceMetricSlugParams(params: URLSearchParams, slugs: readonly string[]): URLSearchParams {
    const next = new URLSearchParams(params);
    next.delete('slug');
    for (const slug of dedupeMetricSlugs(slugs)) next.append('slug', slug);
    return next;
}
