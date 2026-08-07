import { defineModel, mojoCall, mojoList, type Envelope } from '../../client/runtime';

/** Exact system-pinned gates from logit.Log.RestMeta.VIEW_PERMS. */
export const LOGS_ADMIN_PERMISSIONS = [
    'sys.manage_logs',
    'sys.view_logs',
    'sys.security',
];

/** Exact system-pinned gate on /api/metrics/permissions. */
export const METRICS_PERMISSIONS_ADMIN_PERMISSIONS = [
    'sys.manage_incidents',
    'sys.metrics',
    'sys.manage_metrics',
];

/** Exact global read clause used by metrics account discovery/history. */
export const METRICS_EXPLORER_PERMISSIONS = [
    'sys.view_metrics',
    'sys.metrics',
];

/** /api/logs default graph. Stored request, response, and message rows share it. */
export interface LogRow {
    id: number;
    created: number;
    level: string;
    kind: string | null;
    method: string | null;
    path: string | null;
    payload: string | null;
    ip: string | null;
    duid: string | null;
    uid: number;
    gid: number;
    username: string | null;
    user_agent: string | null;
    log: string | null;
    model_name: string | null;
    model_id: number;
}

export const LogModel = defineModel<LogRow>({
    name: 'log',
    endpoint: '/api/logs',
    // This package exposes no save/delete controls. RestMeta's save gate is
    // security|admin; the admin wildcard is handled by hasPermission.
    permissions: {
        view: LOGS_ADMIN_PERMISSIONS,
    },
});

export const LOG_LEVEL_OPTIONS = [
    { value: 'info', label: 'Info' },
    { value: 'warning', label: 'Warning' },
    { value: 'error', label: 'Error' },
    { value: 'critical', label: 'Critical' },
];

export interface MetricsPermissionRow {
    id: string;
    account: string;
    view_permissions: string[];
    write_permissions: string[];
}

interface RawMetricsPermissionRow {
    id?: unknown;
    account?: unknown;
    view_permissions?: unknown;
    write_permissions?: unknown;
}

type MetricsMutationEnvelope = Envelope & RawMetricsPermissionRow & {
    action?: unknown;
};

export const METRICS_PERMISSIONS_ENDPOINT = '/api/metrics/permissions';
export const metricsPermissionKeys = {
    all: [METRICS_PERMISSIONS_ENDPOINT] as const,
};

/** Redis returns a string for one slug, a list for many, and null for none. */
export function normalizeMetricPermissions(value: unknown): string[] {
    const raw = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];
    return [...new Set(raw.map((entry) => String(entry).trim()).filter(Boolean))];
}

export function normalizeMetricsPermissionRow(raw: RawMetricsPermissionRow): MetricsPermissionRow {
    const account = typeof raw.account === 'string'
        ? raw.account
        : typeof raw.id === 'string'
            ? raw.id
            : '';
    return {
        id: account,
        account,
        view_permissions: normalizeMetricPermissions(raw.view_permissions),
        write_permissions: normalizeMetricPermissions(raw.write_permissions),
    };
}

/**
 * The list endpoint is a normal `{data, count}` envelope, but Redis account
 * order is undefined. This page deliberately client-sorts the complete list;
 * the endpoint has no real paging/search contract.
 */
export async function listMetricsPermissions(): Promise<MetricsPermissionRow[]> {
    const result = await mojoList<RawMetricsPermissionRow>(METRICS_PERMISSIONS_ENDPOINT);
    return result.rows
        .map(normalizeMetricsPermissionRow)
        .filter((row) => row.account !== '')
        .sort((a, b) => a.account.localeCompare(b.account));
}

export interface SaveMetricsPermissions {
    account: string;
    view_permissions: string[];
    write_permissions: string[];
}

/**
 * Mutations are intentionally read from TOP-LEVEL response fields. Unlike the
 * list route, django-mojo does not put this result under `data`.
 */
export async function saveMetricsPermissions(input: SaveMetricsPermissions): Promise<MetricsPermissionRow> {
    const response = await mojoCall(
        `${METRICS_PERMISSIONS_ENDPOINT}/${encodeURIComponent(input.account)}`,
        {
            method: 'POST',
            body: {
                view_permissions: normalizeMetricPermissions(input.view_permissions).join(','),
                write_permissions: normalizeMetricPermissions(input.write_permissions).join(','),
            },
        },
    ) as MetricsMutationEnvelope;
    return normalizeMetricsPermissionRow({
        id: response.id ?? input.account,
        account: response.account ?? input.account,
        view_permissions: response.view_permissions,
        write_permissions: response.write_permissions,
    });
}

/** DELETE clears both Redis permission keys but deliberately retains account. */
export async function clearMetricsPermissions(account: string): Promise<MetricsPermissionRow> {
    await mojoCall(`${METRICS_PERMISSIONS_ENDPOINT}/${encodeURIComponent(account)}`, {
        method: 'DELETE',
    });
    return { id: account, account, view_permissions: [], write_permissions: [] };
}
