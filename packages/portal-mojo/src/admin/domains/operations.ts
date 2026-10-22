import type { AdminSection } from '../core';
import { JOBS_VIEW_PERMS, SCHEDULED_TASK_VIEW_PERMS } from '../jobs/models';
import { SETTINGS_PERMISSIONS } from '../settings/model';

const navigationGroup = 'operations';

export const SETTINGS_ADMIN_SECTION: AdminSection = {
    id: 'settings', title: 'Settings', icon: 'bi-gear', navigationGroup, permissions: SETTINGS_PERMISSIONS,
    routes: [{ path: '', loadComponent: () => import('../settings/SettingsPage').then(({ SettingsPage }) => ({ default: SettingsPage })), permissions: SETTINGS_PERMISSIONS }],
};
// Empty any-of permissions admit only the existing literal-superuser bypass.
// A global admin permission alone must not expose this configuration surface.
export const FLEET_CONFIGURATION_ADMIN_SECTION: AdminSection = {
    id: 'fleet-configuration', title: 'Fleet Configuration', icon: 'bi-hdd-network',
    navigationGroup, permissions: [],
    routes: ['', 'shared-validation'].map((path) => ({ path, requireSuperuser: true, loadComponent: () => import('../fleet-configuration/FleetConfigurationPage').then(({ FleetConfigurationPage }) => ({ default: FleetConfigurationPage })) })),
};
export const JOBS_ADMIN_SECTION: AdminSection = {
    id: 'jobs', title: 'Jobs', icon: 'bi-cpu', navigationGroup, permissions: [...new Set([...JOBS_VIEW_PERMS, ...SCHEDULED_TASK_VIEW_PERMS])],
    routes: [
        { path: '', label: 'Dashboard', loadComponent: () => import('../jobs/JobDashboardPage').then(({ JobDashboardPage }) => ({ default: JobDashboardPage })), permissions: JOBS_VIEW_PERMS },
        { path: 'runners', label: 'Runners', loadComponent: () => import('../jobs/JobRunnersPage').then(({ JobRunnersPage }) => ({ default: JobRunnersPage })), permissions: JOBS_VIEW_PERMS },
        { path: 'list', label: 'Jobs', loadComponent: () => import('../jobs/JobsTablePage').then(({ JobsTablePage }) => ({ default: JobsTablePage })), permissions: JOBS_VIEW_PERMS },
        { path: 'scheduled-tasks', label: 'Scheduled Tasks', loadComponent: () => import('../jobs/ScheduledTasksPage').then(({ ScheduledTasksPage }) => ({ default: ScheduledTasksPage })), permissions: SCHEDULED_TASK_VIEW_PERMS },
    ],
};
export const GEOLOCATION_ADMIN_SECTION: AdminSection = {
    id: 'geolocation', title: 'GeoLocation', icon: 'bi-geo-alt', navigationGroup, permissions: [],
    routes: [{ path: '', label: 'GeoLocation', requireSuperuser: true, loadComponent: () => import('../geolocation/GeoLocationPage').then(({ GeoLocationPage }) => ({ default: GeoLocationPage })) }],
};
export const OPERATIONS_ADMIN_SECTIONS = [SETTINGS_ADMIN_SECTION, FLEET_CONFIGURATION_ADMIN_SECTION, JOBS_ADMIN_SECTION, GEOLOCATION_ADMIN_SECTION] as const;
