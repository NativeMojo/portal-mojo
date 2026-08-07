import { useQuery } from '@tanstack/react-query';
import { mojoCall, mojoList, useAuthSnapshot, type Params } from '../../client/runtime';

export const DASHBOARD_METRIC_PERMISSIONS = ['sys.view_metrics', 'sys.metrics'];
export const DASHBOARD_SERIES = ['user_activity_day', 'group_activity_day', 'api_calls', 'api_errors'] as const;
export const DASHBOARD_SCALARS = ['total_users', 'total_groups'] as const;

export type DashboardScalar = typeof DASHBOARD_SCALARS[number];
export type DashboardScalars = Record<DashboardScalar, number>;

export function parseDashboardScalar(value: unknown, slug: string): number {
    if (typeof value !== 'string' && typeof value !== 'number') {
        throw new Error(`Metric ${slug} did not return a scalar string or number.`);
    }
    if (typeof value === 'string' && value.trim() === '') {
        throw new Error(`Metric ${slug} returned an empty value.`);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Metric ${slug} did not return a finite non-negative value.`);
    }
    return parsed;
}

export async function fetchDashboardScalars(): Promise<DashboardScalars> {
    const body = await mojoCall('/api/metrics/value/get', {
        params: { account: 'global', slugs: DASHBOARD_SCALARS.join(',') },
    });
    const data = body.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Dashboard scalar metrics returned a malformed payload.');
    }
    const values = data as Record<string, unknown>;
    return {
        total_users: parseDashboardScalar(values.total_users, 'total_users'),
        total_groups: parseDashboardScalar(values.total_groups, 'total_groups'),
    };
}

export function useDashboardScalars(enabled = true) {
    const auth = useAuthSnapshot();
    return useQuery({
        queryKey: ['admin-dashboard', 'scalars', auth.uid],
        queryFn: fetchDashboardScalars,
        enabled: enabled && auth.authenticated && Boolean(auth.uid),
    });
}

export function useDashboardCount(endpoint: string, params: Params, enabled = true) {
    const auth = useAuthSnapshot();
    return useQuery({
        queryKey: ['admin-dashboard', 'count', auth.uid, endpoint, params],
        queryFn: async () => (await mojoList(endpoint, { ...params, start: 0, size: 0 })).count,
        enabled: enabled && auth.authenticated && Boolean(auth.uid),
    });
}

export function dashboardLoginStart(now = Date.now()): string {
    return new Date(now - 30 * 86_400_000).toISOString().slice(0, 10);
}
