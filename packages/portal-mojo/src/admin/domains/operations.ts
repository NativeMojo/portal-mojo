import { namedPage } from './lazy-page';
import type { AdminSection } from '../core';
import { JOBS_VIEW_PERMS, SCHEDULED_TASK_VIEW_PERMS } from '../jobs/models';
import { SETTINGS_PERMISSIONS } from '../settings/model';

const navigationGroup = 'operations';

export const SETTINGS_ADMIN_SECTION: AdminSection = {
    id: 'settings', title: 'Settings', icon: 'bi-gear', navigationGroup: 'configuration', permissions: SETTINGS_PERMISSIONS,
    routes: [{ path: '', loadComponent: () => import('../settings/SettingsPage').then(namedPage('SettingsPage')), permissions: SETTINGS_PERMISSIONS }],
};
// Empty any-of permissions admit only the existing literal-superuser bypass.
// A global admin permission alone must not expose this configuration surface.
export const FLEET_CONFIGURATION_ADMIN_SECTION: AdminSection = {
    id: 'fleet-configuration', title: 'Fleet Configuration', icon: 'bi-hdd-network',
    navigationGroup, permissions: [],
    routes: ['', 'shared-validation'].map((path) => ({ path, ...(path === '' ? { label: 'Fleet Configuration', searchOnly: true } : {}), requireSuperuser: true, loadComponent: () => import('../fleet-configuration/FleetConfigurationPage').then(namedPage('FleetConfigurationPage')) })),
};
export const JOBS_ADMIN_SECTION: AdminSection = {
    id: 'jobs', title: 'Jobs', icon: 'bi-cpu', navigationGroup, permissions: [...new Set([...JOBS_VIEW_PERMS, ...SCHEDULED_TASK_VIEW_PERMS])],
    routes: [
        { path: '', label: 'Jobs Dashboard', loadComponent: () => import('../jobs/JobDashboardPage').then(namedPage('JobDashboardPage')), permissions: JOBS_VIEW_PERMS },
        { path: 'runners', label: 'Job Runners', searchOnly: true, loadComponent: () => import('../jobs/JobRunnersPage').then(namedPage('JobRunnersPage')), permissions: JOBS_VIEW_PERMS },
        { path: 'list', label: 'Jobs', searchOnly: true, loadComponent: () => import('../jobs/JobsTablePage').then(namedPage('JobsTablePage')), permissions: JOBS_VIEW_PERMS },
        { path: 'scheduled-tasks', label: 'Scheduled Tasks', loadComponent: () => import('../jobs/ScheduledTasksPage').then(namedPage('ScheduledTasksPage')), permissions: SCHEDULED_TASK_VIEW_PERMS },
    ],
};
export const DEPLOYMENTS_ADMIN_SECTION: AdminSection = {
    id: 'deployments', title: 'Deployments', icon: 'bi-rocket', navigationGroup,
    permissions: ['sys.view_platform', 'sys.manage_platform', 'sys.admin', 'sys.view_dns', 'sys.manage_dns', 'sys.security'],
    routes: [{ path: '', label: 'Deployments', loadComponent: () => import('../deployments/DeploymentsPage').then(namedPage('DeploymentsPage')) }],
};
export const MAINTENANCE_ADMIN_SECTION: AdminSection = {
    id: 'maintenance', title: 'Maintenance', icon: 'bi-tools', navigationGroup,
    permissions: ['sys.manage_aws', 'sys.view_platform', 'sys.manage_platform', 'sys.admin'],
    routes: [{ path: '', label: 'Maintenance', loadComponent: () => import('../maintenance/MaintenancePage').then(namedPage('MaintenancePage')) }],
};
export const GEOLOCATION_ADMIN_SECTION: AdminSection = {
    id: 'geolocation', title: 'GeoLocation', icon: 'bi-geo-alt', navigationGroup: 'configuration', permissions: [],
    routes: [{ path: '', label: 'GeoLocation', requireSuperuser: true, loadComponent: () => import('../geolocation/GeoLocationPage').then(namedPage('GeoLocationPage')) }],
};
export const OPERATIONS_ADMIN_SECTIONS = [SETTINGS_ADMIN_SECTION, FLEET_CONFIGURATION_ADMIN_SECTION, JOBS_ADMIN_SECTION, MAINTENANCE_ADMIN_SECTION, DEPLOYMENTS_ADMIN_SECTION, GEOLOCATION_ADMIN_SECTION] as const;
