// portal-mojo/admin — jobs engine.
//
// STAGE A surface: the spine (models, control plane, query hooks, mock) plus
// the dashboard and the runner fleet. The jobs table, job detail and scheduled
// tasks land in later stages, and `JOBS_ADMIN_SECTION` is registered with them
// — nothing here is wired into ADMIN_SECTIONS yet, by design.
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
