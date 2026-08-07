import type { AdminSection } from '../core';
import { JOBS_VIEW_PERMS, SCHEDULED_TASK_VIEW_PERMS } from '../jobs/models';
import { SETTINGS_PERMISSIONS } from '../settings/model';

export const SETTINGS_ADMIN_SECTION: AdminSection = {
    id: 'settings', title: 'Settings', icon: 'bi-gear', navigationGroup: 'operations', permissions: SETTINGS_PERMISSIONS,
    routes: [{ path: '', loadComponent: () => import('../settings/SettingsPage').then(({ SettingsPage }) => ({ default: SettingsPage })), permissions: SETTINGS_PERMISSIONS }],
};
export const JOBS_ADMIN_SECTION: AdminSection = {
    id: 'jobs', title: 'Jobs', icon: 'bi-cpu', navigationGroup: 'operations', permissions: [...new Set([...JOBS_VIEW_PERMS, ...SCHEDULED_TASK_VIEW_PERMS])],
    routes: [
        { path: '', label: 'Dashboard', loadComponent: () => import('../jobs/JobDashboardPage').then(({ JobDashboardPage }) => ({ default: JobDashboardPage })), permissions: JOBS_VIEW_PERMS },
        { path: 'runners', label: 'Runners', loadComponent: () => import('../jobs/JobRunnersPage').then(({ JobRunnersPage }) => ({ default: JobRunnersPage })), permissions: JOBS_VIEW_PERMS },
        { path: 'list', label: 'Jobs', loadComponent: () => import('../jobs/JobsTablePage').then(({ JobsTablePage }) => ({ default: JobsTablePage })), permissions: JOBS_VIEW_PERMS },
        { path: 'scheduled-tasks', label: 'Scheduled Tasks', loadComponent: () => import('../jobs/ScheduledTasksPage').then(({ ScheduledTasksPage }) => ({ default: ScheduledTasksPage })), permissions: SCHEDULED_TASK_VIEW_PERMS },
    ],
};
export const OPERATIONS_ADMIN_SECTIONS = [SETTINGS_ADMIN_SECTION, JOBS_ADMIN_SECTION] as const;

