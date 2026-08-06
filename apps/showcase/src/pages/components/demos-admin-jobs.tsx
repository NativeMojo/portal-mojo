// MERGE-WIRE: rail — ComponentsPage.tsx, 'Admin' group, after 'admin-rules'
// (plus the import line):
//   import { AdminJobsDemo } from './demos-admin-jobs';
//   { key: 'admin-jobs', title: 'Jobs engine', icon: 'bi-cpu', … }
// MERGE-WIRE: theme.css — @import "./theme/admin-jobs.css";
//
// Jobs engine demos (board #1288). Every surface the item ships is reachable
// from here, INCLUDING the states a happy-path click-through never reaches:
// the dead runner, a channel with zero alive runners, an empty fleet, the two
// sysinfo failure modes, a failed job with its multi-line error, a purge dry
// run, and the scheduled-task editor.
//
// Everything runs against the mock, which is the wire contract's executable
// spec — no fixture is faked here except the two hand-built `JobsStats`
// objects in "Fleet edge cases", and those exist precisely because the seeded
// mock is a HEALTHY-ish deployment: it always has three registered runners and
// four configured channels, so "no runners registered at all" and "nothing in
// JOBS_CHANNELS" cannot be produced by calling it.
import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    JOBS_VIEW_PERMS,
    JobChannelsPanel,
    JobDashboardPage,
    JobModel,
    JobOperationsSection,
    JobRunnersPage,
    JobRunnersStrip,
    JobsTablePage,
    ScheduledTaskModel,
    ScheduledTasksPage,
    isOverdueJob,
    jobsKeys,
    showJobDetail,
    showRunnerDetail,
    showScheduledTaskDetail,
    useChannelOptions,
    useRunners,
    type JobRow,
    type JobsStats,
    type RunnerRow,
    type ScheduledTaskRow,
} from 'portal-mojo/admin';
import { Guarded } from 'portal-mojo/ui';

type Surface =
    | 'dashboard' | 'runners' | 'list' | 'operations' | 'tasks'
    | 'inspectors' | 'fleet-edges' | 'denied';

const TABS: { key: Surface; label: string; icon: string }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: 'bi-speedometer2' },
    { key: 'runners', label: 'Runners', icon: 'bi-cpu' },
    { key: 'list', label: 'Jobs table', icon: 'bi-list-task' },
    { key: 'operations', label: 'Operations', icon: 'bi-tools' },
    { key: 'tasks', label: 'Scheduled tasks', icon: 'bi-calendar-week' },
    { key: 'inspectors', label: 'Inspectors', icon: 'bi-window-stack' },
    { key: 'fleet-edges', label: 'Fleet edge cases', icon: 'bi-exclamation-octagon' },
    { key: 'denied', label: 'Permission gates', icon: 'bi-shield-lock' },
];

// ── Dashboard ─────────────────────────────────────────────────────────

function DashboardDemo() {
    return (
        <div className="flex flex-col gap-3">
            <p className="dim">
                Every number comes from <code>GET /api/jobs/stats</code>.
                <code>/api/jobs/health</code> raises server-side (<code>get_channel_health</code>
                {' '}reads a key <code>get_queue_state</code> stopped returning) and is never called.
                The seeded fleet is deliberately unhealthy, so this page already shows the two
                states an operator triages on: <strong>a down runner</strong> in the strip
                (<code>runner-mojo-batch-01-engine</code>, last heartbeat ~30 min ago) and
                {' '}<strong>a channel with zero alive runners</strong> (<code>webhooks</code>,
                queued work and nothing to drain it → Critical). <code>email</code> sits over the
                &gt;50 backlog threshold → Backlog.
            </p>
            <p className="dim">
                Clicking a channel row navigates to <code>&lt;mount&gt;/list?channel=…</code>.
                In the portal that is the jobs table; here in the showcase the demo is not routed,
                so use the <strong>Jobs table</strong> tab instead.
            </p>
            <JobDashboardPage />
        </div>
    );
}

// ── Inspectors: every KISS detail modal, by fixture ───────────────────

/** Pick the seeded job that matches a state, without hardcoding a uuid. */
function useJobFixtures() {
    const query = JobModel.useList({ sort: '-created', size: 200 });
    const rows = query.data?.rows ?? [];
    const failedMultiline = rows.find((row) => row.status === 'failed' && row.last_error.includes('\n'));
    const runningLive = rows.find((row) => row.status === 'running' && row.runner_id === 'runner-mojo-web-01-engine');
    const runningDead = rows.find((row) => row.status === 'running' && row.runner_id === 'runner-mojo-batch-01-engine');
    const overdue = rows.find((row) => isOverdueJob(row));
    const scheduled = rows.find((row) => row.status === 'pending' && row.run_at != null && !isOverdueJob(row));
    const canceled = rows.find((row) => row.status === 'canceled');
    const expired = rows.find((row) => row.status === 'expired');
    return { query, failedMultiline, runningLive, runningDead, overdue, scheduled, canceled, expired };
}

function JobButton({ job, icon, children }: { job: JobRow | undefined; icon: string; children: ReactNode }) {
    return (
        <button className="btn" disabled={!job} onClick={() => job && showJobDetail(job.id)}>
            <i className={`bi ${icon}`} /> {children}
        </button>
    );
}

function RunnerButton({ runner, icon, children }: { runner: RunnerRow | undefined; icon: string; children: ReactNode }) {
    return (
        <button className="btn" disabled={!runner} onClick={() => runner && showRunnerDetail(runner)}>
            <i className={`bi ${icon}`} /> {children}
        </button>
    );
}

function TaskButton({ task, icon, children }: { task: ScheduledTaskRow | undefined; icon: string; children: ReactNode }) {
    return (
        <button className="btn" disabled={!task} onClick={() => task && showScheduledTaskDetail(task.id)}>
            <i className={`bi ${icon}`} /> {children}
        </button>
    );
}

function InspectorsDemo() {
    const jobs = useJobFixtures();
    const runners = useRunners();
    const tasks = ScheduledTaskModel.useList({ sort: '-created', size: 50 });
    const runnerBy = (id: string) => (runners.data ?? []).find((row) => row.runner_id === id);
    const taskBy = (type: string, enabled: boolean) =>
        (tasks.data?.rows ?? []).find((row) => row.task_type === type && row.enabled === enabled);

    return (
        <div className="flex flex-col gap-3">
            <p className="dim">
                Job, runner, scheduled-task and task-result inspection are all
                {' '}<code>modal.detail</code> (#1425) — no right panel, no record-detail route.
                Every button below resolves its fixture from the mock rather than hardcoding a
                uuid, so it keeps working when the fixtures move.
            </p>

            <div className="panel panel-pad flex flex-col gap-2">
                <div className="eyebrow">Job inspector · <code>/api/jobs/job/&lt;id&gt;</code></div>
                <div className="flex flex-wrap gap-2">
                    <JobButton job={jobs.failedMultiline} icon="bi-x-octagon">
                        Failed — multi-line error, retries exhausted
                    </JobButton>
                    <JobButton job={jobs.runningDead} icon="bi-plug">
                        Running on a DEAD runner (cancel force-cancels)
                    </JobButton>
                    <JobButton job={jobs.runningLive} icon="bi-play-circle">
                        Running on a live runner (cooperative cancel)
                    </JobButton>
                    <JobButton job={jobs.overdue} icon="bi-alarm">
                        Scheduled &amp; OVERDUE
                    </JobButton>
                    <JobButton job={jobs.scheduled} icon="bi-clock">
                        Scheduled for the future
                    </JobButton>
                    <JobButton job={jobs.canceled} icon="bi-slash-circle">
                        Canceled (retriable — the service rule, not <code>is_retriable</code>)
                    </JobButton>
                    <JobButton job={jobs.expired} icon="bi-clock-history">
                        Expired
                    </JobButton>
                </div>
                <p className="dim">
                    On the failed job: <strong>Retry</strong> always republishes — the toast names
                    a <em>new</em> job id and offers to open it, because
                    {' '}<code>retry_request</code> returns <code>{'{original_job_id, new_job_id, delayed}'}</code>
                    {' '}and the original row does not resume. <strong>Cancel</strong> sends
                    {' '}<code>payload: true</code>; <code>{'{}'}</code> is falsy in Python and the
                    handler answers &quot;cancel_request must be true&quot; at HTTP&nbsp;200.
                    Lifecycle comes from <code>/api/jobs/event?job=&lt;id&gt;&amp;graph=timeline</code> —
                    Job carries no <code>recent_events</code> in any graph.
                </p>
            </div>

            <div className="panel panel-pad flex flex-col gap-2">
                <div className="eyebrow">Runner inspector · sysinfo has THREE distinct states</div>
                <div className="flex flex-wrap gap-2">
                    <RunnerButton runner={runnerBy('runner-mojo-web-01-engine')} icon="bi-check-circle">
                        Healthy — full sysinfo (CPU, memory, disk, network)
                    </RunnerButton>
                    <RunnerButton runner={runnerBy('runner-mojo-web-02-engine')} icon="bi-exclamation-triangle">
                        Stale — sysinfo replies <code>status:&apos;error&apos;</code> (psutil missing)
                    </RunnerButton>
                    <RunnerButton runner={runnerBy('runner-mojo-batch-01-engine')} icon="bi-plug">
                        Down — sysinfo never answers (404 envelope)
                    </RunnerButton>
                </div>
                <p className="dim">
                    Open <strong>System</strong> in each and press Refresh: a successful envelope with an
                    inner failure, a 404, and a healthy host must read as three different things —
                    never as a blank panel. Sysinfo is a Redis broadcast with a 5s server-side
                    timeout, so it is fetched on demand and <strong>never</strong> polled.
                    <strong> Logs</strong> is a two-step lookup (recent jobs → <code>job__in=</code>)
                    because JobLog has no <code>runner_id</code> field at all.
                </p>
            </div>

            <div className="panel panel-pad flex flex-col gap-2">
                <div className="eyebrow">Scheduled-task inspector · <code>/api/jobs/scheduled_task/&lt;id&gt;</code></div>
                <div className="flex flex-wrap gap-2">
                    <TaskButton task={taskBy('llm', true)} icon="bi-stars">
                        LLM task — prompts + task results (incl. one error)
                    </TaskButton>
                    <TaskButton task={taskBy('job', true)} icon="bi-gear">
                        Job task — func + payload, two run times
                    </TaskButton>
                    <TaskButton task={taskBy('webhook', false)} icon="bi-slash-circle">
                        Webhook task — DISABLED, with a last_error
                    </TaskButton>
                </div>
                <p className="dim">
                    The editor dialog is reached from the detail&apos;s Edit action, or from
                    {' '}<strong>New task</strong> on the Scheduled tasks tab. Client validation mirrors the
                    model&apos;s <code>_validate</code> (≤2 <code>HH:MM</code> times, weekday ints 0–6 with
                    Mon=0, notify ∈ email|in_app|sms|push) so the common failures never reach a
                    server-side <code>ValueError</code> — and a malformed value that slips past is still
                    surfaced verbatim, because a failed save REJECTS.
                </p>
            </div>
        </div>
    );
}

// ── Fleet edge cases ──────────────────────────────────────────────────

const now = () => new Date().toISOString();

/** A fleet that registered nothing at all: the strip's critical empty state. */
const EMPTY_FLEET_STATS: JobsStats = {
    channels: {
        default: { channel: 'default', queued_count: 41, inflight_count: 0, scheduled_count: 2, runners: 0, db_running: 0 },
        email: { channel: 'email', queued_count: 62, inflight_count: 0, scheduled_count: 0, runners: 0, db_running: 0 },
        priority: { channel: 'priority', queued_count: 3, inflight_count: 0, scheduled_count: 0, runners: 0, db_running: 0 },
        webhooks: { channel: 'webhooks', queued_count: 118, inflight_count: 0, scheduled_count: 1, runners: 0, db_running: 0 },
    },
    runners: [],
    totals: {
        pending: 224, queued: 224, inflight: 0, running: 0, running_active: 0, running_stale: 0,
        completed: 0, failed: 0, scheduled: 3, runners_active: 0,
    },
    scheduler: { active: false, lock_holder: null },
};

/** Nothing declared in JOBS_CHANNELS and no stream registered. */
const NO_CHANNEL_STATS: JobsStats = {
    channels: {},
    runners: [{
        runner_id: 'runner-idle-01-engine', hostname: 'idle-01.internal', channels: [],
        jobs_processed: 0, jobs_failed: 0, started: now(), last_heartbeat: now(), alive: true,
    }],
    totals: {
        pending: 0, queued: 0, inflight: 0, running: 0, running_active: 0, running_stale: 0,
        completed: 0, failed: 0, scheduled: 0, runners_active: 1,
    },
    scheduler: { active: true, lock_holder: 'runner-idle-01-engine' },
};

/**
 * Demo-only harness. `JobRunnersStrip` owns its own `useRunners()` query
 * (60s tick) and the seeded mock ALWAYS answers with three runners, so the
 * only honest way to show "no runners registered" is to give the strip its own
 * QueryClient and pin the runners entry to an empty fleet. Nothing in the
 * package is mocked or branched — the component is the shipped one.
 */
function EmptyFleetHarness({ children }: { children: ReactNode }) {
    const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    useEffect(() => {
        const key = jobsKeys.runners(undefined);
        client.setQueryData(key, []);
        // The hook's own refetchInterval will land a real answer eventually;
        // re-pin it rather than let the demo silently heal.
        const unsubscribe = client.getQueryCache().subscribe(() => {
            const data = client.getQueryData(key);
            if (Array.isArray(data) && data.length > 0) client.setQueryData(key, []);
        });
        return () => { unsubscribe(); client.clear(); };
    }, [client]);
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function FleetEdgesDemo() {
    return (
        <div className="flex flex-col gap-3">
            <p className="dim">
                Runners are the primary alert signal: if none are alive, nothing moves no matter how
                healthy the channel numbers look. The seeded mock always registers three runners and
                four channels, so these two states are driven from hand-built
                {' '}<code>JobsStats</code> objects and a pinned query — the components are the
                shipped ones, unmodified.
            </p>

            <div className="panel panel-pad flex flex-col gap-2">
                <div className="eyebrow">Zero runners registered — the strip&apos;s critical state</div>
                <EmptyFleetHarness>
                    <JobRunnersStrip />
                </EmptyFleetHarness>
                <p className="dim">
                    Header tone goes danger and the list says
                    {' '}<em>&quot;No runners registered — jobs will not be processed.&quot;</em>
                </p>
            </div>

            <div className="panel panel-pad flex flex-col gap-2">
                <div className="eyebrow">Zero runners, four backed-up channels — every row Critical</div>
                <JobChannelsPanel stats={EMPTY_FLEET_STATS} isPending={false} />
                <p className="dim">
                    Severity is the source&apos;s: &gt;50 queued warns, &gt;100 queued <em>or</em> zero runners is
                    critical. Zero runners also adds the explicit note, because a shallow queue with
                    nobody serving it is still stuck. The scheduler card reports Stopped with no lock
                    holder — delayed and scheduled jobs are not being dispatched.
                </p>
            </div>

            <div className="panel panel-pad flex flex-col gap-2">
                <div className="eyebrow">No channels configured — an empty select would be worse</div>
                <JobChannelsPanel stats={NO_CHANNEL_STATS} isPending={false} />
                <JobOperationsSection channels={[]} channelsPending={false} />
                <p className="dim">
                    With nothing in <code>JOBS_CHANNELS</code> and no registered stream, the operations that
                    require a channel are disabled with an explanation rather than offering a select that
                    can only ever write a filter nothing matches.
                </p>
            </div>

            <div className="panel panel-pad flex flex-col gap-2">
                <div className="eyebrow">Loading skeletons</div>
                <JobChannelsPanel stats={undefined} isPending />
                <p className="dim">The same panel while <code>/api/jobs/stats</code> is in flight.</p>
            </div>
        </div>
    );
}

// ── Operations ────────────────────────────────────────────────────────

function OperationsDemo() {
    const channels = useChannelOptions();
    return (
        <div className="flex flex-col gap-3">
            <p className="dim">
                The control plane, standalone (it also rides the dashboard). Everything here is
                {' '}<code>requires_global_perms</code> — member grants never satisfy it — and every
                destructive control is armed.
            </p>
            <ul className="dim" style={{ listStyle: 'disc', paddingLeft: '1.25rem' }}>
                <li>
                    <strong>Purge is dry-run first.</strong> The dialog runs <code>dry_run:true</code> and
                    reports <code>data.count</code> (&quot;N jobs would be deleted before &lt;cutoff&gt;&quot;);
                    only the armed confirm performs the real run, which reports a different key,
                    {' '}<code>data.deleted</code>. web-mojo read <code>count</code> for both and always said 0.
                </li>
                <li>
                    <strong>Clear stuck / manual reclaim have no all-channel form</strong>
                    {' '}(<code>@requires_params(&apos;channel&apos;)</code>). &quot;All channels&quot; fans out with
                    {' '}<code>Promise.allSettled</code> and reports partial results per channel — never a
                    blanket success.
                </li>
                <li>
                    <strong>Clear queue sends <code>confirm:&quot;yes&quot;</code> only after arming.</strong> The token
                    is a server-side safety gate; pre-satisfying it (as the source did) removes the safety
                    rather than honoring it.
                </li>
                <li>
                    Result keys are the backend&apos;s: <code>clear-stuck → {'{cleared, details, errors}'}</code>,
                    {' '}<code>reset-failed → top-level {'{reset_count, requeue}'}</code>,
                    {' '}<code>ping → top-level {'{runner_id, responsive}'}</code>.
                </li>
            </ul>
            <JobOperationsSection channels={channels.channels} channelsPending={channels.isPending} />
        </div>
    );
}

// ── Permission gates ──────────────────────────────────────────────────

function DeniedDemo() {
    return (
        <div className="flex flex-col gap-3">
            <p className="dim">
                Gates are <code>sys.</code>-pinned and fail-closed, and they are <strong>not uniform</strong>
                {' '}across the section. The dashboard, runners and the jobs table gate on
                {' '}<code>JOBS_VIEW_PERMS</code>; the scheduled-tasks route gates on
                {' '}<code>SCHEDULED_TASK_VIEW_PERMS</code>, because
                {' '}<code>ScheduledTask.VIEW_PERMS</code> is
                {' '}<code>[&quot;jobs&quot;, &quot;view_scheduled_tasks&quot;, &quot;owner&quot;]</code> — neither manage
                grant, and not <code>view_jobs</code>. Sharing one gate would hand a
                {' '}<code>jobs.viewer</code> a menu entry that renders a permission notice.
            </p>
            <p className="dim">
                The <code>owner</code> clause is why this matters: a caller with no global jobs grant still
                gets HTTP 200 from <code>/api/jobs/scheduled_task</code> — with only their <em>own</em> rows. An
                ungated admin page would render a personal task list as if it were the system&apos;s.
                Every permission-disabled query is <code>enabled:false</code>, so a viewer issues zero
                denied requests.
            </p>
            <Guarded
                permission={['sys.this_grant_does_not_exist']}
                fallback={
                    <div className="panel panel-pad">
                        <div className="empty">
                            <i className="bi bi-shield-lock" />
                            <h2>Access denied</h2>
                            <p className="dim">
                                What an operator without any clause sees — the section is absent from the
                                rail, the route is unroutable, and nothing was fetched.
                            </p>
                        </div>
                    </div>
                }
            >
                <JobDashboardPage />
            </Guarded>
            <div className="panel panel-pad">
                <div className="eyebrow">Live check against the signed-in identity</div>
                <Guarded
                    permission={JOBS_VIEW_PERMS}
                    fallback={<p className="dim">This identity cannot read the jobs engine.</p>}
                >
                    <p className="dim">
                        <code>showcase.operator</code> holds the <code>jobs</code> catch-all grant, which satisfies
                        view <em>and</em> manage on both the jobs control plane and scheduled tasks — so every
                        mutation above is live. The mock also ships <code>jobs.viewer</code> (view_jobs only) and
                        {' '}<code>jobs.operator</code> for the read-only pass in the portal app.
                    </p>
                </Guarded>
            </div>
        </div>
    );
}

// ── Tabs ──────────────────────────────────────────────────────────────

export function AdminJobsDemo() {
    const [surface, setSurface] = useState<Surface>('dashboard');
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Jobs admin surface">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        className={`btn btn-compact${surface === tab.key ? ' btn-primary' : ''}`}
                        onClick={() => setSurface(tab.key)}
                    >
                        <i className={`bi ${tab.icon}`} /> {tab.label}
                    </button>
                ))}
            </div>
            {surface === 'dashboard' && <DashboardDemo />}
            {surface === 'runners' && <JobRunnersPage />}
            {surface === 'list' && (
                <div className="flex flex-col gap-3">
                    <p className="dim">
                        Five segments over ONE table, driven by the params store:
                        {' '}<strong>Running</strong> (<code>status=running</code>) ·
                        {' '}<strong>Queued</strong> (<code>status=pending&amp;run_at__isnull=true</code>) ·
                        {' '}<strong>Scheduled</strong> (<code>run_at__isnull=false</code>, with the overdue flag) ·
                        {' '}<strong>Failed</strong> (error column) · <strong>All</strong>. Columns follow the
                        segment. <code>sort=-created</code> always reaches the wire: the model&apos;s own default is
                        {' '}<code>-id</code> over 32-char uuid hex, which is lexicographic noise. The export is a
                        bounded CLIENT projection — payload, metadata and last_error are excluded.
                    </p>
                    <JobsTablePage />
                </div>
            )}
            {surface === 'operations' && <OperationsDemo />}
            {surface === 'tasks' && <ScheduledTasksPage />}
            {surface === 'inspectors' && <InspectorsDemo />}
            {surface === 'fleet-edges' && <FleetEdgesDemo />}
            {surface === 'denied' && <DeniedDemo />}
        </div>
    );
}
