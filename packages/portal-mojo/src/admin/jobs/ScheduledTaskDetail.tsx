// ScheduledTaskDetail — the scheduled-task inspector, opened as a
// `modal.detail` from the tasks table. Port of web-mojo ScheduledTaskView.js,
// rebuilt on DetailView.
//
// The source was never wired up (`ScheduledTaskTablePage` was imported but
// never `registerPage`d in web-mojo's `src/admin.js`), so its field list is a
// design reference whose wiring was never exercised — every row below is
// checked against `mojo/apps/jobs/models/scheduled_task.py`, `task_result.py`
// and the hourly dispatcher in `cronjobs.py`.
//
// Carried from the source: the schedule / notify / execution / last-error /
// configuration blocks and the recent-results list, plus the kebab's
// Edit · Enable|Disable · Delete.
//
// Changed, with reason:
//   · the results list shows STATUS AND OUTPUT. The source rendered only a
//     status word and a raw datetime, which is the one thing a scheduled task
//     produces that an operator actually needs to read. That requires the
//     `default` graph — TaskResult's `list` graph carries no `output`/`error`.
//   · type-specific configuration is rendered per task_type (llm prompts /
//     job func+payload / webhook url), not dumped as one JSON blob.
//   · delete is an ArmedButton in a danger zone rather than a confirm dialog
//     (house idiom: arming IS the confirmation).
//   · no "Run now": the capability exists only as the owner-scoped assistant
//     tool `_tool_run_scheduled_task_now`. There is no REST route and no
//     publish endpoint to synthesize one, so the control stays ABSENT rather
//     than shipping disabled (wave-7a precedent). Tracked as django-mojo #1309.
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mojoList, useCan } from '../../client/runtime';
import {
    ArmedButton,
    Badge,
    DetailView,
    Eyebrow,
    FlatRow,
    JsonBlock,
    StatusPanel,
    fmt,
    modal,
    toast,
    type Tone,
} from '../../ui';
import {
    SCHEDULED_TASK_MANAGE_PERMS,
    SCHEDULED_TASK_VIEW_PERMS,
    ScheduledTaskModel,
    TaskResultModel,
    formatRunDays,
    formatRunTimes,
    type ScheduledTaskRow,
    type ScheduledTaskType,
    type TaskResultRow,
} from './models';
import { openScheduledTaskEditor } from './scheduled-task-form';

/** How many recent executions the detail shows. */
const RESULT_WINDOW = 10;

/**
 * A task's most recent executions.
 *
 * `graph: 'default'` is explicit and deliberate: TaskResult's `list` graph is
 * `{id, task_id, status, created}` — no `output`, no `error` — and
 * `normalizeTaskResultListParams` strips a `graph` key precisely so a pasted
 * URL cannot widen a serialized field set. A hook that KNOWS which fields it
 * needs goes through `mojoList` directly, the same way `useJobTimeline` asks
 * for the timeline graph.
 *
 * `task=` is the relation name. `task_id=` is a Django FK attname, which
 * `build_rest_filters` accepts and then dereferences into an AttributeError —
 * a 500, not a filter.
 */
export function useTaskResults(taskId: string | null) {
    const { can } = useCan(SCHEDULED_TASK_VIEW_PERMS);
    return useQuery({
        queryKey: [TaskResultModel.endpoint, 'task', taskId ?? ''],
        queryFn: () => mojoList<TaskResultRow>(TaskResultModel.endpoint, {
            task: taskId!,
            graph: 'default',
            sort: '-created',
            size: RESULT_WINDOW,
        }),
        enabled: can && taskId != null,
    });
}

function Kpi({ label, value, tone }: { label: string; value: ReactNode; tone?: Tone | null }) {
    return (
        <div className={`jobs-kpi${tone ? ` jobs-kpi-${tone}` : ''}`}>
            <div className="jobs-kpi-label">{label}</div>
            <div className="jobs-kpi-value">{value}</div>
        </div>
    );
}

const TYPE_TONE: Record<ScheduledTaskType, Tone> = { llm: 'primary', job: 'info', webhook: 'warning' };

/** Unknown wire values fall back WITH a warn — never to nothing. */
export function taskTypeTone(type: string): Tone {
    const tone = TYPE_TONE[type as ScheduledTaskType];
    if (tone) return tone;
    console.warn(`[admin/jobs] unknown scheduled task type ${JSON.stringify(type)} — falling back to "muted". Valid: llm, job, webhook`);
    return 'muted';
}

/** `run_times · run_days` — the schedule as one readable line. */
export function formatSchedule(task: Pick<ScheduledTaskRow, 'run_times' | 'run_days'>): string {
    return `${formatRunTimes(task.run_times ?? [])} · ${formatRunDays(task.run_days ?? [])}`;
}

// ── Sections ──────────────────────────────────────────────────────────

function ConfigurationSection({ task }: { task: ScheduledTaskRow }) {
    const config = task.job_config ?? {};
    const text = (key: string): string => {
        const value = config[key];
        return typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
    };
    const blob = (key: string): Record<string, unknown> => {
        const value = config[key];
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    };

    return (
        <>
            <Eyebrow>{task.task_type} configuration</Eyebrow>
            {task.task_type === 'llm' && (
                <>
                    <FlatRow label="System prompt">
                        {text('system_prompt') ? <span className="jobs-task-prompt">{text('system_prompt')}</span> : <span className="dim">none</span>}
                    </FlatRow>
                    <FlatRow label="User prompt">
                        {text('user_prompt')
                            ? <span className="jobs-task-prompt">{text('user_prompt')}</span>
                            : <span className="jobs-text-danger">Missing — every run fails with “LLM task requires a user_prompt in job_config”.</span>}
                    </FlatRow>
                </>
            )}
            {task.task_type === 'job' && (
                <>
                    <FlatRow label="Function">
                        {text('func')
                            ? <code className="jobs-func">{text('func')}</code>
                            : <span className="jobs-text-danger">Missing — every run fails with “Job task requires a func in job_config”.</span>}
                    </FlatRow>
                    <FlatRow label="Payload"><JsonBlock value={blob('payload')} label="payload" /></FlatRow>
                </>
            )}
            {task.task_type === 'webhook' && (
                <>
                    <FlatRow label="URL">
                        {text('url')
                            ? <code className="jobs-func">{text('url')}</code>
                            : <span className="jobs-text-danger">Missing — every run fails with “Webhook task requires a url in job_config”.</span>}
                    </FlatRow>
                    <FlatRow label="Body"><JsonBlock value={blob('data')} label="data" /></FlatRow>
                </>
            )}

            <Eyebrow>Raw job_config</Eyebrow>
            <JsonBlock value={config} label="job_config" defaultOpen />
        </>
    );
}

function ResultsSection({ taskId }: { taskId: string }) {
    const results = useTaskResults(taskId);
    const rows = results.data?.rows ?? [];

    return (
        <>
            <Eyebrow>Last {RESULT_WINDOW} executions</Eyebrow>
            {results.isPending && <p className="dim">Loading results…</p>}
            {results.error != null && (
                <p className="jobs-text-danger">
                    {results.error instanceof Error ? results.error.message : 'Could not load results.'}
                </p>
            )}
            {!results.isPending && results.error == null && rows.length === 0 && (
                <p className="dim-italic">No results yet — this task has not produced an execution record.</p>
            )}
            <ul className="jobs-task-results">
                {rows.map((row) => {
                    const ok = row.status === 'success';
                    return (
                        <li key={row.id} className={`jobs-task-result${ok ? '' : ' jobs-task-result-bad'}`}>
                            <div className="jobs-task-result-head">
                                <Badge tone={ok ? 'success' : 'danger'}>
                                    <i className={`bi ${ok ? 'bi-check-circle-fill' : 'bi-x-circle-fill'}`} /> {row.status}
                                </Badge>
                                <span className="dim" title={fmt.datetime(row.created)}>{fmt.relative(row.created)}</span>
                                {row.job_id && <code className="jobs-id">job {fmt.truncateMiddle(row.job_id, 5)}</code>}
                            </div>
                            {ok
                                ? (row.output
                                    ? <pre className="jobs-task-output">{row.output}</pre>
                                    : <p className="dim-italic">No output recorded.</p>)
                                : <pre className="jobs-task-output jobs-text-danger">{row.error || 'No error text recorded.'}</pre>}
                        </li>
                    );
                })}
            </ul>
        </>
    );
}

// ── The inspector ─────────────────────────────────────────────────────

export function ScheduledTaskDetail({ id, onClose }: { id: string; onClose: () => void }) {
    const queryClient = useQueryClient();
    const query = ScheduledTaskModel.useOne(id);
    const save = ScheduledTaskModel.useSave();
    const remove = ScheduledTaskModel.useDelete();
    const { can: canManage } = useCan(SCHEDULED_TASK_MANAGE_PERMS);

    if (query.isPending) return <div className="modal-pad dim">Loading scheduled task…</div>;
    if (!query.data || query.error) {
        return <div className="modal-pad jobs-text-danger">{query.error?.message ?? 'Scheduled task not found'}</div>;
    }
    const task = query.data;

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ScheduledTaskModel.keys.root });

    const setEnabled = async (enabled: boolean) => {
        try {
            await save.mutateAsync({ id, changes: { enabled } });
            await invalidate();
            toast.success(enabled ? 'Task enabled' : 'Task disabled');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not change the task state');
        }
    };

    const edit = async () => {
        const saved = await openScheduledTaskEditor({
            task,
            submit: (changes) => save.mutateAsync({ id, changes }),
        });
        if (saved) {
            await invalidate();
            toast.success('Task updated');
        }
    };

    const destroy = async () => {
        try {
            await remove.mutateAsync({ id });
            await invalidate();
            toast.success(`Deleted ${task.name || 'scheduled task'}`);
            onClose();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Delete failed');
        }
    };

    const schedule = formatSchedule(task);
    const stateTone: Tone = task.enabled ? 'success' : 'muted';
    const headline = task.enabled
        ? `Runs ${schedule}`
        : `Disabled — ${schedule} is not dispatched`;

    return (
        <DetailView<ScheduledTaskRow>
            icon="bi-clock-history"
            title={task.name || 'Untitled task'}
            subtitle={task.description || `${task.task_type} task`}
            chips={[
                { text: task.task_type.toUpperCase(), tone: taskTypeTone(task.task_type) },
                { icon: task.enabled ? 'bi-play-circle' : 'bi-pause-circle', text: task.enabled ? 'Enabled' : 'Disabled', tone: stateTone },
                ...(task.run_once ? [{ icon: 'bi-1-circle', text: 'Run once', tone: 'info' as const }] : []),
                { icon: 'bi-broadcast', text: task.channel, tone: 'muted' },
            ]}
            badges={{ overview: task.last_error ? <Badge tone="danger">error</Badge> : null }}
            menuContext={task}
            contextMenu={[
                { label: 'Refresh', icon: 'bi-arrow-clockwise', onSelect: () => { void query.refetch(); } },
                {
                    label: 'Edit', icon: 'bi-pencil', permissions: SCHEDULED_TASK_MANAGE_PERMS,
                    onSelect: () => { void edit(); },
                },
                {
                    label: task.enabled ? 'Disable' : 'Enable',
                    icon: task.enabled ? 'bi-pause-circle' : 'bi-play-circle',
                    permissions: SCHEDULED_TASK_MANAGE_PERMS,
                    onSelect: () => { void setEnabled(!task.enabled); },
                },
            ]}
            sections={[
                {
                    key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => (
                        <>
                            <StatusPanel
                                tone={stateTone}
                                state={task.enabled ? 'ENABLED' : 'DISABLED'}
                                headline={headline}
                                meta={
                                    <>
                                        {fmt.number(task.run_count)} run{task.run_count === 1 ? '' : 's'}
                                        {' · last '}{task.last_run == null ? 'never' : fmt.relative(task.last_run)}
                                        {task.run_once && ' · disables itself after the next success'}
                                    </>
                                }
                            />

                            <div className="jobs-kpi-grid">
                                <Kpi label="Runs" value={fmt.number(task.run_count)} tone={task.run_count > 0 ? 'info' : null} />
                                <Kpi label="Last run" value={task.last_run == null ? 'Never' : fmt.relative(task.last_run)} />
                                <Kpi label="Max retries" value={fmt.number(task.max_retries)} />
                                <Kpi label="State" value={task.enabled ? 'Enabled' : 'Disabled'} tone={stateTone} />
                            </div>

                            <Eyebrow>Schedule</Eyebrow>
                            <FlatRow label="Run times">
                                {(task.run_times ?? []).length > 0
                                    ? (task.run_times ?? []).map((time) => <code key={time} className="jobs-channel-chip">{time}</code>)
                                    : <span className="jobs-text-warning">No times set — this task never matches an hour.</span>}
                            </FlatRow>
                            <FlatRow label="Run days">
                                {formatRunDays(task.run_days ?? [])}
                                {(task.run_days ?? []).length === 0 && <span className="dim"> (no days selected)</span>}
                            </FlatRow>
                            <FlatRow label="Run once">{task.run_once ? 'Yes — auto-disables after a success' : 'No'}</FlatRow>
                            <FlatRow label="Dispatch">
                                <span className="dim">
                                    Hourly cron converts each run time to the owner’s organization timezone and publishes a job.
                                </span>
                            </FlatRow>

                            <Eyebrow>Delivery</Eyebrow>
                            <FlatRow label="Channel"><code>{task.channel}</code></FlatRow>
                            <FlatRow label="Notify">
                                {(task.notify ?? []).length > 0
                                    ? (task.notify ?? []).map((channel) => <code key={channel} className="jobs-channel-chip">{channel}</code>)
                                    : <span className="dim">None — results are recorded but nobody is told.</span>}
                            </FlatRow>
                            <FlatRow label="Created">{fmt.datetime(task.created)}</FlatRow>
                            <FlatRow label="Modified">{fmt.datetime(task.modified)}</FlatRow>

                            {task.last_error && (
                                <>
                                    <Eyebrow>Last error</Eyebrow>
                                    <pre className="jobs-task-output jobs-text-danger">{task.last_error}</pre>
                                </>
                            )}
                        </>
                    ),
                },
                { key: 'config', label: 'Configuration', icon: 'bi-sliders', render: () => <ConfigurationSection task={task} /> },
                { key: 'results', label: 'Results', icon: 'bi-list-check', render: () => <ResultsSection taskId={id} /> },
                { divider: 'Manage' },
                {
                    key: 'manage', label: 'Manage', icon: 'bi-gear', permissions: SCHEDULED_TASK_MANAGE_PERMS, render: () => (
                        <>
                            <Eyebrow>Operates on {task.name || 'this task'}</Eyebrow>
                            <div className="jobs-op-row">
                                <div className="jobs-op-label">
                                    <i className={`bi ${task.enabled ? 'bi-pause-circle' : 'bi-play-circle'}`} />
                                    {task.enabled ? 'Disable' : 'Enable'}
                                </div>
                                <div className="jobs-op-desc">
                                    {task.enabled
                                        ? 'The hourly dispatcher skips disabled tasks. Nothing already published is affected.'
                                        : 'The hourly dispatcher will pick this task up again on its next matching hour.'}
                                </div>
                                <div className="jobs-op-action">
                                    <button
                                        type="button" className="btn btn-compact" disabled={!canManage || save.isPending}
                                        onClick={() => void setEnabled(!task.enabled)}
                                    >
                                        {task.enabled ? 'Disable' : 'Enable'}
                                    </button>
                                </div>
                            </div>

                            <div className="jobs-op-row">
                                <div className="jobs-op-label"><i className="bi bi-pencil" /> Edit</div>
                                <div className="jobs-op-desc">
                                    Change the schedule, notification channels and configuration. The task type is fixed
                                    after creation.
                                </div>
                                <div className="jobs-op-action">
                                    <button type="button" className="btn btn-compact" disabled={!canManage} onClick={() => void edit()}>
                                        Edit task…
                                    </button>
                                </div>
                            </div>

                            <div className="danger-zone">
                                <div className="jobs-op-row">
                                    <div className="jobs-op-label"><i className="bi bi-trash" /> Delete</div>
                                    <div className="jobs-op-desc">
                                        Removes the task and cascades to every one of its execution results. Jobs already
                                        published stay queued.
                                    </div>
                                    <div className="jobs-op-action">
                                        <ArmedButton
                                            className="btn-compact btn-danger-ghost"
                                            label="Delete task"
                                            armedLabel="Click again — the task and all its results are gone"
                                            icon="bi-trash"
                                            disabled={!canManage || remove.isPending}
                                            onConfirm={destroy}
                                        />
                                    </div>
                                </div>
                            </div>
                        </>
                    ),
                },
            ]}
            initialSection="overview"
            onClose={onClose}
        />
    );
}

/** Open the inspector as a KISS detail modal — no record-detail route. */
export function showScheduledTaskDetail(id: string): void {
    void modal.detail((close) => <ScheduledTaskDetail id={id} onClose={() => close(null)} />);
}
