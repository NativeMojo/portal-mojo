import type { AdminSection } from '../index';
import { LogsPage } from './LogsPage';
import { MetricsPermissionsPage } from './MetricsPermissionsPage';
import {
    LOGS_ADMIN_PERMISSIONS,
    METRICS_PERMISSIONS_ADMIN_PERMISSIONS,
} from './models';

export * from './models';
export * from './LogInspector';
export * from './LogsPage';
export * from './MetricsPermissionsPage';

/**
 * Reusable registry contribution. The section gate is the union needed to see
 * at least one child; each direct route then applies its exact backend gate.
 */
export const MONITORING_ADMIN_SECTION: AdminSection = {
    id: 'monitoring',
    basePath: '',
    title: 'Monitoring',
    icon: 'bi-activity',
    permissions: [
        ...LOGS_ADMIN_PERMISSIONS,
        ...METRICS_PERMISSIONS_ADMIN_PERMISSIONS,
    ],
    routes: [
        {
            path: 'logs',
            label: 'Logs',
            component: LogsPage,
            permissions: LOGS_ADMIN_PERMISSIONS,
        },
        {
            path: 'metrics/permissions',
            label: 'Metrics Permissions',
            component: MetricsPermissionsPage,
            permissions: METRICS_PERMISSIONS_ADMIN_PERMISSIONS,
        },
    ],
};
