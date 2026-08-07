import type { AdminSection } from '../index';
import { CloudWatchDashboardPage } from './CloudWatchDashboardPage';
import { CLOUDWATCH_PERMISSIONS } from './data';

export * from './data';
export * from './CloudWatchChart';
export * from './CloudWatchDashboardPage';

export const CLOUDWATCH_ADMIN_SECTION: AdminSection = {
    id: 'cloudwatch',
    title: 'CloudWatch',
    icon: 'bi-clouds',
    navigationGroup: 'observability',
    permissions: CLOUDWATCH_PERMISSIONS,
    routes: [{ path: '', label: 'CloudWatch', component: CloudWatchDashboardPage, permissions: CLOUDWATCH_PERMISSIONS }],
};
