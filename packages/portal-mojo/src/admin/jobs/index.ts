// portal-mojo/admin — jobs engine.
//
// Queue operations for a django-mojo deployment: is the runner fleet alive,
// which channel is backed up, why did this job fail, retry or cancel it, clear
// stuck work, purge history — plus the (cron-style) scheduled tasks the old
// portal's backend supported but never wired up.
import type { AdminSection } from '../index';
import { JobDashboardPage } from './JobDashboardPage';
import { JobRunnersPage } from './JobRunnersPage';
import { JobsTablePage } from './JobsTablePage';
import { ScheduledTasksPage } from './ScheduledTasksPage';
import { JOBS_VIEW_PERMS, SCHEDULED_TASK_VIEW_PERMS } from './models';

export * from './models';
export * from './control';
export * from './queries';
export * from './JobDashboardPage';
export * from './JobRunnersPage';
export * from './RunnerDetail';
export * from './sections/JobRunnersStrip';
export * from './sections/JobChannelsPanel';
export * from './sections/JobThroughputSection';
export * from './sections/JobOperationsSection';
// Stage C — scheduled tasks (plan step 10).
export * from './ScheduledTasksPage';
export * from './ScheduledTaskDetail';
export * from './scheduled-task-form';
// Stage B — the jobs table and the job inspector.
export * from './columns';
export * from './JobsTablePage';
export * from './JobDetail';

/**
 * Registry contribution. The section gate is the ANY-OF UNION needed to see at
 * least one child; each route then applies its own exact backend gate, and
 * those gates are NOT uniform:
 *
 *   · the dashboard, runners and the jobs table read Job/JobEvent/JobLog and
 *     the control plane, all of which answer to `view_jobs|manage_jobs|jobs`;
 *   · `ScheduledTask.VIEW_PERMS` is `["jobs","view_scheduled_tasks","owner"]`
 *     — it contains NEITHER manage grant and not `view_jobs`. A `view_jobs`
 *     operator therefore cannot read the system task list at all (the backend
 *     falls through to the `owner` branch and answers HTTP 200 with their own
 *     rows, which is exactly the hole SCHEDULED_TASK_VIEW_PERMS closes).
 *
 * Gating the scheduled-tasks route on SCHEDULED_TASK_VIEW_PERMS keeps the
 * sidenav entry and the page's own gate in agreement: a `jobs.viewer` never
 * sees a menu item that renders a permission notice.
 *
 * Routes and the sidebar entry are generated from this object — a mounting app
 * edits nothing.
 */
export const JOBS_ADMIN_SECTION: AdminSection = {
    id: 'jobs',
    title: 'Jobs',
    icon: 'bi-cpu',
    navigationGroup: 'operations',
    permissions: [...new Set([...JOBS_VIEW_PERMS, ...SCHEDULED_TASK_VIEW_PERMS])],
    routes: [
        {
            path: '',
            label: 'Dashboard',
            component: JobDashboardPage,
            permissions: JOBS_VIEW_PERMS,
        },
        {
            path: 'runners',
            label: 'Runners',
            component: JobRunnersPage,
            permissions: JOBS_VIEW_PERMS,
        },
        {
            path: 'list',
            label: 'Jobs',
            component: JobsTablePage,
            permissions: JOBS_VIEW_PERMS,
        },
        {
            path: 'scheduled-tasks',
            label: 'Scheduled Tasks',
            component: ScheduledTasksPage,
            permissions: SCHEDULED_TASK_VIEW_PERMS,
        },
    ],
};
