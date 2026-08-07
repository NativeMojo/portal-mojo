import { useQuery } from '@tanstack/react-query';
import { mojoCall, useAuthSnapshot, type MetricsResponse, type Params } from '../../client';
import type { MetricsFetchParams } from '../../charts';

export const CLOUDWATCH_PERMISSIONS = ['sys.manage_aws'];
export const CLOUDWATCH_ACCOUNTS = ['ec2', 'rds', 'redis'] as const;
export const CLOUDWATCH_GRANULARITIES = ['minutes', 'hours', 'days'] as const;

export type CloudWatchAccount = typeof CLOUDWATCH_ACCOUNTS[number];
export type CloudWatchUnit = 'percent' | 'bytes' | 'seconds' | 'count';

export interface CloudWatchChartDefinition {
    account: CloudWatchAccount;
    category: string;
    title: string;
    unit: CloudWatchUnit;
}

export const CLOUDWATCH_DASHBOARD_CHARTS: readonly CloudWatchChartDefinition[] = [
    { account: 'ec2', category: 'cpu', title: 'EC2 CPU', unit: 'percent' },
    { account: 'ec2', category: 'net_out', title: 'EC2 Network Out', unit: 'bytes' },
    { account: 'ec2', category: 'memory', title: 'EC2 Memory', unit: 'percent' },
    { account: 'ec2', category: 'disk', title: 'EC2 Disk', unit: 'percent' },
    { account: 'rds', category: 'cpu', title: 'RDS CPU', unit: 'percent' },
    { account: 'rds', category: 'conns', title: 'RDS Connections', unit: 'count' },
    { account: 'rds', category: 'read_latency', title: 'RDS Read Latency', unit: 'seconds' },
    { account: 'rds', category: 'write_latency', title: 'RDS Write Latency', unit: 'seconds' },
    { account: 'redis', category: 'cpu', title: 'Redis CPU', unit: 'percent' },
    { account: 'redis', category: 'conns', title: 'Redis Connections', unit: 'count' },
    { account: 'redis', category: 'cache_misses', title: 'Redis Cache Misses', unit: 'count' },
    { account: 'redis', category: 'cache_hits', title: 'Redis Cache Hits', unit: 'count' },
] as const;

export const CLOUDWATCH_RESOURCE_CHARTS: Readonly<Record<CloudWatchAccount, readonly Omit<CloudWatchChartDefinition, 'account'>[]>> = {
    ec2: [
        { category: 'cpu', title: 'CPU Utilization', unit: 'percent' },
        { category: 'memory', title: 'Memory Usage', unit: 'percent' },
        { category: 'disk', title: 'Disk Usage', unit: 'percent' },
        { category: 'net_in', title: 'Network In', unit: 'bytes' },
        { category: 'net_out', title: 'Network Out', unit: 'bytes' },
        { category: 'disk_read', title: 'Disk Read Ops', unit: 'count' },
        { category: 'disk_write', title: 'Disk Write Ops', unit: 'count' },
        { category: 'status_check', title: 'Status Check', unit: 'count' },
    ],
    rds: [
        { category: 'cpu', title: 'CPU Utilization', unit: 'percent' },
        { category: 'conns', title: 'Active Connections', unit: 'count' },
        { category: 'free_storage', title: 'Free Storage', unit: 'bytes' },
        { category: 'free_memory', title: 'Freeable Memory', unit: 'bytes' },
        { category: 'read_iops', title: 'Read IOPS', unit: 'count' },
        { category: 'write_iops', title: 'Write IOPS', unit: 'count' },
        { category: 'read_latency', title: 'Read Latency', unit: 'seconds' },
        { category: 'write_latency', title: 'Write Latency', unit: 'seconds' },
        { category: 'net_in', title: 'Network In', unit: 'bytes' },
        { category: 'net_out', title: 'Network Out', unit: 'bytes' },
    ],
    redis: [
        { category: 'cpu', title: 'CPU Utilization', unit: 'percent' },
        { category: 'conns', title: 'Current Connections', unit: 'count' },
        { category: 'cache_memory', title: 'Cache Memory Used', unit: 'bytes' },
        { category: 'cache_hits', title: 'Cache Hits', unit: 'count' },
        { category: 'cache_misses', title: 'Cache Misses', unit: 'count' },
        { category: 'replication_lag', title: 'Replication Lag', unit: 'seconds' },
        { category: 'net_in', title: 'Network In', unit: 'bytes' },
        { category: 'net_out', title: 'Network Out', unit: 'bytes' },
    ],
};

interface ResourceBase { id: string; slug: string; status: string }
export interface Ec2Resource extends ResourceBase { kind: 'ec2'; name: string; state: string; instance_type: string; private_ip: string; public_ip: string }
export interface RdsResource extends ResourceBase { kind: 'rds'; engine: string; instance_class: string; endpoint: string }
export interface RedisResource extends ResourceBase { kind: 'redis'; engine: string; node_type: string; num_nodes: number }
export type CloudWatchResource = Ec2Resource | RdsResource | RedisResource;
export type CloudWatchResources = Record<CloudWatchAccount, CloudWatchResource[]>;

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`CloudWatch ${label} returned a malformed object.`);
    return value as Record<string, unknown>;
}

function text(value: unknown, label: string, allowEmpty = true): string {
    if (typeof value !== 'string') throw new Error(`CloudWatch ${label} returned a non-string value.`);
    const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 1000);
    if (!allowEmpty && !clean) throw new Error(`CloudWatch ${label} returned an empty value.`);
    return clean;
}

function positiveInteger(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error(`CloudWatch ${label} must be a positive integer.`);
    return value;
}

export function sanitizeCloudWatchError(error: unknown): Error {
    const source = error instanceof Error ? error.message : typeof error === 'string' ? error : 'CloudWatch request failed';
    const clean = source
        .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted]')
        .replace(/\b(authorization|x-amz-security-token)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, '$1: [redacted]')
        .replace(/\b(?:aws_secret_access_key|secret_access_key|session_token)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
        .slice(0, 1000);
    return new Error(clean || 'CloudWatch request failed');
}

function sanitizeResource(kind: CloudWatchAccount, value: unknown): CloudWatchResource {
    const raw = object(value, `${kind} resource`);
    const base = { id: text(raw.id, `${kind}.id`, false), slug: text(raw.slug, `${kind}.slug`, false), status: text(raw.status ?? raw.state ?? 'unknown', `${kind}.status`, false) };
    if (kind === 'ec2') return { ...base, kind, name: text(raw.name ?? '', 'ec2.name'), state: text(raw.state ?? 'unknown', 'ec2.state', false), instance_type: text(raw.instance_type ?? '', 'ec2.instance_type'), private_ip: text(raw.private_ip ?? '', 'ec2.private_ip'), public_ip: text(raw.public_ip ?? '', 'ec2.public_ip') };
    if (kind === 'rds') return { ...base, kind, engine: text(raw.engine ?? '', 'rds.engine'), instance_class: text(raw.instance_class ?? '', 'rds.instance_class'), endpoint: text(raw.endpoint ?? '', 'rds.endpoint') };
    return { ...base, kind, engine: text(raw.engine ?? '', 'redis.engine'), node_type: text(raw.node_type ?? '', 'redis.node_type'), num_nodes: positiveInteger(raw.num_nodes, 'redis.num_nodes') };
}

export function sanitizeCloudWatchResources(value: unknown): CloudWatchResources {
    const raw = object(value, 'resources');
    return Object.fromEntries(CLOUDWATCH_ACCOUNTS.map((kind) => {
        if (!Array.isArray(raw[kind])) throw new Error(`CloudWatch resources omitted the top-level ${kind} list.`);
        return [kind, raw[kind].map((row) => sanitizeResource(kind, row))];
    })) as CloudWatchResources;
}

export async function fetchCloudWatchResources(): Promise<CloudWatchResources> {
    try {
        const body = await mojoCall('/api/aws/cloudwatch/resources');
        return sanitizeCloudWatchResources(body);
    } catch (error) {
        throw sanitizeCloudWatchError(error);
    }
}

export function useCloudWatchResources() {
    const auth = useAuthSnapshot();
    return useQuery({
        queryKey: ['admin-cloudwatch', 'resources', auth.uid],
        queryFn: fetchCloudWatchResources,
        enabled: auth.authenticated && Boolean(auth.uid),
        staleTime: 5 * 60_000,
    });
}

function metricValues(value: unknown, slug: string): number[] {
    if (!Array.isArray(value)) throw new Error(`CloudWatch series ${slug} is not an array.`);
    return value.map((item) => {
        if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) throw new Error(`CloudWatch series ${slug} contains an invalid value.`);
        return item;
    });
}

export async function loadCloudWatchSeries(params: MetricsFetchParams): Promise<MetricsResponse> {
    try {
        const account = text(params.account, 'fetch.account', false) as CloudWatchAccount;
        if (!CLOUDWATCH_ACCOUNTS.includes(account)) throw new Error(`Unsupported CloudWatch account: ${account}`);
        const category = text(params.category, 'fetch.category', false);
        const granularity = text(params.granularity, 'fetch.granularity', false);
        if (!CLOUDWATCH_GRANULARITIES.includes(granularity as typeof CLOUDWATCH_GRANULARITIES[number])) throw new Error(`Unsupported CloudWatch granularity: ${granularity}`);
        const wire: Params = { account, category, granularity, stat: params.stat ?? 'avg', dt_start: params.dt_start, dt_end: params.dt_end };
        if (typeof params.slugs === 'string' && params.slugs.trim()) wire.slugs = params.slugs;
        const body = await mojoCall('/api/aws/cloudwatch/fetch', { params: wire });
        const raw = object(body.data, 'fetch payload');
        const labels = Array.isArray(raw.labels) ? raw.labels.map((label) => text(label, 'fetch label')) : (() => { throw new Error('CloudWatch fetch omitted labels.'); })();
        const data = object(raw.data, 'fetch data');
        return { labels, datasets: Object.entries(data).map(([slug, values]) => ({ label: text(slug, 'response slug', false), data: metricValues(values, slug) })) };
    } catch (error) {
        throw sanitizeCloudWatchError(error);
    }
}
