import type { AdminSection } from '../core';
import { CLOUDWATCH_PERMISSIONS } from '../cloudwatch/data';
import { DASHBOARD_METRIC_PERMISSIONS } from '../dashboard/data';
import { EMAIL_ADMIN_PERMISSIONS } from '../messaging/models';
import { LOGS_ADMIN_PERMISSIONS, METRICS_EXPLORER_PERMISSIONS, METRICS_PERMISSIONS_ADMIN_PERMISSIONS } from '../monitoring/models';
import { JOBS_VIEW_PERMS } from '../jobs/models';
import { LOGIN_SUMMARY_PERMS } from '../security/devices/models';
import { SECURITY_VIEW_PERMS } from '../security-permissions';

export const ADMIN_DASHBOARD_PERMISSIONS = [...new Set([...DASHBOARD_METRIC_PERMISSIONS, ...SECURITY_VIEW_PERMS, ...JOBS_VIEW_PERMS, ...EMAIL_ADMIN_PERMISSIONS, ...LOGIN_SUMMARY_PERMS])];
export const DASHBOARD_ADMIN_SECTION: AdminSection = {
    id: 'dashboard', basePath: '', title: 'Overview', icon: 'bi-grid-1x2', navigationGroup: 'overview', permissions: ADMIN_DASHBOARD_PERMISSIONS,
    routes: [{ path: '', label: 'Dashboard', loadComponent: () => import('../dashboard/AdminDashboardPage').then(({ AdminDashboardPage }) => ({ default: AdminDashboardPage })), permissions: ADMIN_DASHBOARD_PERMISSIONS, fallbackToFirstVisible: true }],
};
export const MONITORING_ADMIN_SECTION: AdminSection = {
    id: 'monitoring', basePath: '', title: 'Monitoring', icon: 'bi-activity', navigationGroup: 'observability',
    permissions: [...new Set([...LOGS_ADMIN_PERMISSIONS, ...METRICS_EXPLORER_PERMISSIONS, ...METRICS_PERMISSIONS_ADMIN_PERMISSIONS])],
    routes: [
        { path: 'logs', label: 'Logs', loadComponent: () => import('../monitoring/LogsPage').then(({ LogsPage }) => ({ default: LogsPage })), permissions: LOGS_ADMIN_PERMISSIONS },
        { path: 'metrics/explorer', label: 'Metrics Explorer', loadComponent: () => import('../monitoring/MetricsExplorerPage').then(({ MetricsExplorerPage }) => ({ default: MetricsExplorerPage })), permissions: METRICS_EXPLORER_PERMISSIONS },
        { path: 'metrics/permissions', label: 'Metrics Permissions', loadComponent: () => import('../monitoring/MetricsPermissionsPage').then(({ MetricsPermissionsPage }) => ({ default: MetricsPermissionsPage })), permissions: METRICS_PERMISSIONS_ADMIN_PERMISSIONS },
    ],
};
export const CLOUDWATCH_ADMIN_SECTION: AdminSection = {
    id: 'cloudwatch', title: 'CloudWatch', icon: 'bi-clouds', navigationGroup: 'observability', permissions: CLOUDWATCH_PERMISSIONS,
    routes: [{ path: '', label: 'CloudWatch', loadComponent: () => import('../cloudwatch/CloudWatchDashboardPage').then(({ CloudWatchDashboardPage }) => ({ default: CloudWatchDashboardPage })), permissions: CLOUDWATCH_PERMISSIONS }],
};
export const OBSERVABILITY_ADMIN_SECTIONS = [DASHBOARD_ADMIN_SECTION, MONITORING_ADMIN_SECTION, CLOUDWATCH_ADMIN_SECTION] as const;

