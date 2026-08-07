import { mojoCall, type Envelope, type MetricsResponse } from '../../client/runtime';
import type { Params } from '../../client/runtime';
import type { MetricsFetchParams } from '../../charts';
import {
    METRIC_DISCOVERY_PAGE_SIZE,
    METRIC_SEARCH_MAX_LENGTH,
    assertAddressableMetricSlug,
    dedupeMetricSlugs,
    metricSlugTail,
    parseMetricAccount,
    planMetricHistoryRequests,
    type MetricGaugeValue,
    type MetricPoint,
    type MetricsDiscoveryFilters,
    type MetricsDiscoveryPage,
    type MetricsDiscoveryRequest,
    type MetricsDiscoveryResource,
} from './metrics-explorer-data';

type UnknownRecord = Record<string, unknown>;

export interface MetricsBreakdownResponse extends MetricsResponse {
    groups: Record<string, number>;
}

function record(value: unknown, label: string): UnknownRecord {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Malformed metrics response: ${label} must be an object.`);
    }
    return value as UnknownRecord;
}

function stringArray(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        throw new Error(`Malformed metrics response: ${label} must be a string array.`);
    }
    return value as string[];
}

function integer(value: unknown, label: string, minimum = 0): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
        throw new Error(`Malformed metrics response: ${label} must be an integer >= ${minimum}.`);
    }
    return value;
}

function finiteNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Malformed metrics response: ${label} must be a finite number.`);
    }
    return value;
}

function sameKeys(value: UnknownRecord, expected: readonly string[], label: string): void {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
        throw new Error(`Malformed metrics response: ${label} keys do not match the request.`);
    }
}

function validateDiscoveryRequest(request: MetricsDiscoveryRequest): Required<Pick<MetricsDiscoveryRequest, 'resource' | 'search' | 'start' | 'size'>> & Pick<MetricsDiscoveryRequest, 'account' | 'category'> {
    if (!['accounts', 'categories', 'slugs'].includes(request.resource)) throw new Error('Unknown metrics discovery resource.');
    const search = request.search ?? '';
    if (search.length > METRIC_SEARCH_MAX_LENGTH) throw new Error(`Metrics search must be ${METRIC_SEARCH_MAX_LENGTH} characters or fewer.`);
    const start = request.start ?? 0;
    const size = request.size ?? METRIC_DISCOVERY_PAGE_SIZE;
    if (!Number.isInteger(start) || start < 0) throw new Error('Metrics discovery start must be a non-negative integer.');
    if (!Number.isInteger(size) || size < 1 || size > 500) throw new Error('Metrics discovery size must be between 1 and 500.');
    if (request.resource === 'accounts') {
        if (request.account !== undefined || request.category !== undefined) throw new Error('Account discovery does not accept account or category.');
        return { resource: request.resource, search, start, size };
    }
    if (!request.account) throw new Error(`${request.resource === 'categories' ? 'Category' : 'Slug'} discovery requires an account.`);
    if (request.resource === 'categories' && request.category !== undefined) throw new Error('Category discovery does not accept category.');
    return { resource: request.resource, account: request.account, ...(request.category !== undefined ? { category: request.category } : {}), search, start, size };
}

function expectedFilters(resource: MetricsDiscoveryResource, request: ReturnType<typeof validateDiscoveryRequest>): MetricsDiscoveryFilters {
    if (resource === 'accounts') return { search: request.search };
    if (resource === 'categories') return { account: request.account, search: request.search };
    return { account: request.account, category: request.category ?? null, search: request.search };
}

/** Exact #1438 envelope. `mojoCall` is required because list normalization drops its metadata. */
export async function discoverMetrics(input: MetricsDiscoveryRequest): Promise<MetricsDiscoveryPage> {
    const request = validateDiscoveryRequest(input);
    const response = await mojoCall('/api/metrics/discover', { params: request as Params }) as Envelope & UnknownRecord;
    if (response.resource !== request.resource) throw new Error('Malformed metrics discovery response: resource echo mismatch.');
    const filters = record(response.filters, 'filters');
    const expected = expectedFilters(request.resource, request);
    sameKeys(filters, Object.keys(expected), 'filters');
    for (const [key, value] of Object.entries(expected)) {
        if (filters[key] !== value) throw new Error(`Malformed metrics discovery response: filters.${key} echo mismatch.`);
    }
    const data = stringArray(response.data, 'data');
    const start = integer(response.start, 'start');
    const size = integer(response.size, 'size', 1);
    const count = integer(response.count, 'count');
    const pageCount = integer(response.page_count, 'page_count');
    if (pageCount !== data.length || start !== request.start || size !== request.size || pageCount > size || count < pageCount) {
        throw new Error('Malformed metrics discovery response: paging metadata is inconsistent.');
    }
    const nextStart = response.next_start === null ? null : integer(response.next_start, 'next_start');
    if ((nextStart == null) !== (start + pageCount >= count)) {
        throw new Error('Malformed metrics discovery response: next_start is inconsistent.');
    }
    return { resource: request.resource, filters: expected, data, start, size, count, pageCount, nextStart };
}

function historyPayload(response: Envelope, expectedTails: readonly string[]): { labels: string[]; data: Record<string, number[]>; groups?: Record<string, number> } {
    const payload = record(response.data, 'data');
    const labels = stringArray(payload.labels, 'data.labels');
    const values = record(payload.data, 'data.data');
    sameKeys(values, expectedTails, 'data.data');
    const data: Record<string, number[]> = {};
    for (const tail of expectedTails) {
        if (!Array.isArray(values[tail])) throw new Error(`Malformed metrics response: series ${tail} must be an array.`);
        data[tail] = (values[tail] as unknown[]).map((entry, index) => finiteNumber(entry, `${tail}[${index}]`));
        if (data[tail]!.length !== labels.length) throw new Error(`Malformed metrics response: series ${tail} length does not match labels.`);
    }
    let groups: Record<string, number> | undefined;
    if (payload.groups !== undefined) {
        const rawGroups = record(payload.groups, 'data.groups');
        sameKeys(rawGroups, expectedTails, 'data.groups');
        groups = Object.fromEntries(Object.entries(rawGroups).map(([key, value]) => [key, integer(value, `groups.${key}`, 1)]));
    }
    return { labels, data, groups };
}

async function requestHistory(params: MetricsFetchParams, slugs: readonly string[]) {
    const wire: Params = { ...params, slugs: slugs.join(',') };
    const response = await mojoCall('/api/metrics/fetch', { params: wire });
    return historyPayload(response, slugs.map(metricSlugTail));
}

/**
 * Safe `MetricsChart.loadSeries` implementation. It uses the request as the
 * identity source, splits duplicate tails, and rejects every ambiguous echo.
 */
export async function loadExactMetricSeries(params: MetricsFetchParams): Promise<MetricsResponse> {
    const slugs = dedupeMetricSlugs(params.slugs.split(','));
    if (!slugs.length) throw new Error('Choose at least one metric slug.');
    if (params.child_kind) {
        if (parseMetricAccount(params.account).kind !== 'group') {
            throw new Error('Group fan-out requires account=group-<parent-id>.');
        }
        if (!params.child_kind.trim()) throw new Error('Group fan-out requires a child kind.');
    }
    if (params.breakdown) {
        if (slugs.length !== 1) throw new Error('Fan-out breakdown requires exactly one metric slug.');
        if (!params.child_kind) throw new Error('Fan-out breakdown requires a child kind.');
        const response = await mojoCall('/api/metrics/fetch', { params: { ...params, slugs: slugs[0] } });
        const payload = record(response.data, 'data');
        const childData = record(payload.data, 'data.data');
        const result = historyPayload(response, Object.keys(childData));
        if (!result.groups) throw new Error('Malformed fan-out breakdown: groups map is required.');
        return {
            labels: result.labels,
            datasets: Object.keys(result.data).map((label) => ({ label, data: result.data[label]! })),
            groups: result.groups,
        } as MetricsBreakdownResponse;
    }
    const plans = planMetricHistoryRequests(slugs);
    const bySlug = new Map<string, number[]>();
    let labels: string[] | null = null;
    for (const batch of plans) {
        const result = await requestHistory(params, batch);
        if (labels == null) labels = result.labels;
        else if (labels.length !== result.labels.length || labels.some((label, index) => label !== result.labels[index])) {
            throw new Error('Malformed metrics response: collision-split requests returned incompatible labels.');
        }
        for (const slug of batch) bySlug.set(slug, result.data[metricSlugTail(slug)]!);
    }
    if (bySlug.size !== slugs.length) throw new Error('Malformed metrics response: one or more requested series are missing.');
    return { labels: labels ?? [], datasets: slugs.map((label) => ({ label, data: bySlug.get(label)! })) };
}

export interface FetchMetricPointsInput {
    account: string;
    slugs: string[];
    when: number;
    granularity: string;
}

/** `/series?with_delta=true` preserves full keys, so validate them directly. */
export async function fetchMetricPoints(input: FetchMetricPointsInput): Promise<MetricPoint[]> {
    const slugs = dedupeMetricSlugs(input.slugs);
    if (!slugs.length) return [];
    const response = await mojoCall('/api/metrics/series', {
        params: { account: input.account, slugs: slugs.join(','), when: input.when, granularity: input.granularity, with_delta: true },
    }) as Envelope & UnknownRecord;
    const data = record(response.data, 'data');
    const previous = record(response.prev_data, 'prev_data');
    const deltas = record(response.deltas, 'deltas');
    sameKeys(data, slugs, 'data');
    sameKeys(previous, slugs, 'prev_data');
    sameKeys(deltas, slugs, 'deltas');
    return slugs.map((slug) => {
        const delta = record(deltas[slug], `deltas.${slug}`);
        const keys = Object.keys(delta);
        if (!keys.includes('delta') || keys.some((key) => key !== 'delta' && key !== 'delta_pct')) {
            throw new Error(`Malformed metrics response: delta keys for ${slug} are invalid.`);
        }
        return {
            slug,
            value: finiteNumber(data[slug], `data.${slug}`),
            previous: finiteNumber(previous[slug], `prev_data.${slug}`),
            delta: finiteNumber(delta.delta, `deltas.${slug}.delta`),
            ...(delta.delta_pct === undefined ? {} : { deltaPct: finiteNumber(delta.delta_pct, `deltas.${slug}.delta_pct`) }),
        };
    });
}

/** `/value/get` truncates keys, so one exact full slug is read per call. */
export async function readMetricValue(account: string, slug: string): Promise<MetricGaugeValue> {
    const exact = slug.trim();
    if (!exact) throw new Error('Scalar slug is required.');
    assertAddressableMetricSlug(exact);
    const response = await mojoCall('/api/metrics/value/get', { params: { account, slugs: exact } }) as Envelope & UnknownRecord;
    const data = record(response.data, 'data');
    const tail = metricSlugTail(exact);
    sameKeys(data, [tail], 'data');
    const echoedSlugs = stringArray(response.slugs, 'slugs');
    if (echoedSlugs.length !== 1 || echoedSlugs[0] !== exact || response.account !== account) {
        throw new Error('Malformed scalar response: request echo mismatch.');
    }
    return { account, slug: exact, value: data[tail] };
}
