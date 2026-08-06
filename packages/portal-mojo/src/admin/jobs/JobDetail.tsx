// JobDetail — the job inspector, opened as a `modal.detail` from the jobs
// table (and from the runner inspector's job lists). Port of web-mojo
// JobDetailsView.js (912 lines) onto portal-mojo's DetailView + the detail
// primitives.
//
// Carried from the source: the StatusPanel-led Overview with its per-state
// narrative, the four KPIs (attempt / runtime / retries left / next), the
// Execution flat rows with an error block, the Lifecycle timeline, and the
// Payload · Events · Logs · Retry history · Similar sections behind the
// Activity/Related dividers, plus the header chips and the state-conditional
// kebab.
//
// Re-wired, because the backend does not serve what the source assumed:
//   · `recent_events` exists in NO graph — only inside the `get_status` action
//     payload. The lifecycle timeline is `/api/jobs/event?job=&graph=timeline`
//     (useJobTimeline), and those entries carry no `id` by design.
//   · logs filter by the RELATION name (`job=`). The source sent `job_id=`,
//     which django-mojo accepts as an FK attname and then dies on — HTTP 500,
//     not an unfiltered list.
//   · `retry_request` ALWAYS republishes a NEW job. The source toasted "Retry
//     scheduled" and left the operator looking at a row that did not resume;
//     here the new id is named and offered.
//   · `cancel_request` must be sent as `true` — `{}` is falsy in Python.
//   · there is no `stack_trace` and no `is_retriable` in any graph.
//     Retriability is the SERVICE rule (canRetryJob), computed client-side.
//   · every trusted-HTML slot (`meta`, `detail`, `auxFn`) is a ReactNode.
import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCan } from '../../client';
import {
    ArmedButton,
    Badge,
    DetailView,
    Eyebrow,
    FlatRow,
    JsonBlock,
    StatusPanel,
    Timeline,
    fmt,
    modal,
    toast,
    type DetailMenuEntry,
    type TimelineItem,
    type Tone,
} from '../../ui';
import { JobIdentity, JobStatusBadge, relativeWhen } from './columns';
import {
    canCancelJob,
    canRetryJob,
    isScheduledJob,
    isOverdueJob,
    jobStatusIcon,
    jobStatusTone,
    JOBS_MANAGE_PERMS,
    JOBS_VIEW_PERMS,
    JobEventModel,
    JobLogModel,
    JobModel,
    type JobEventKind,
    type JobRow,
    type JobTimelineEntry,
} from './models';
import { jobsKeys, useJobLogs, useJobTimeline } from './queries';

// ── Event vocabulary ──────────────────────────────────────────────────
// JobEvent.event is a fixed choice list on the backend; an unknown value still
// falls back WITH a warn rather than rendering nothing.

const EVENT_TONE: Record<JobEventKind, Tone> = {
    created: 'muted',
    queued: 'info',
    scheduled: 'warning',
    running: 'primary',
    claimed: 'primary',
    released: 'warning',
    retry: 'warning',
    canceled: 'muted',
    completed: 'success',
    failed: 'danger',
    expired: 'warning',
};

const EVENT_ICON: Record<JobEventKind, string> = {
    created: 'bi-plus-circle',
    queued: 'bi-inbox',
    scheduled: 'bi-clock',
    running: 'bi-play-fill',
    claimed: 'bi-hand-index',
    released: 'bi-hand-index-thumb',
    retry: 'bi-arrow-repeat',
    canceled: 'bi-x-circle',
    completed: 'bi-check-circle',
    failed: 'bi-x-octagon',
    expired: 'bi-clock-history',
};

function eventTone(event: string): Tone {
    const tone = EVENT_TONE[event as JobEventKind];
    if (tone) return tone;
    console.warn(`[admin/jobs] unknown job event ${JSON.stringify(event)} — falling back to "muted".`);
    return 'muted';
}

function eventIcon(event: string): string {
    return EVENT_ICON[event as JobEventKind] ?? 'bi-dot';
}

/** One event row (timeline graph or default graph) → a Timeline item. */
function toTimelineItem(entry: Pick<JobTimelineEntry, 'event' | 'at' | 'runner_id' | 'details'>): TimelineItem {
    const detailKeys = Object.keys(entry.details ?? {});
    return {
        tone: eventTone(entry.event),
        title: entry.event,
        meta: fmt.relative(entry.at),
        body: (
            <>
                {entry.runner_id && <>runner <code>{entry.runner_id}</code>{detailKeys.length > 0 && ' · '}</>}
                {detailKeys.length > 0 && <code className="jobs-json-inline">{JSON.stringify(entry.details)}</code>}
            </>
        ),
    };
}

// ── Small presentational pieces ───────────────────────────────────────

function Kpi({ label, value, tone }: { label: string; value: ReactNode; tone?: Tone | null }) {
    return (
        <div className={`jobs-kpi${tone ? ` jobs-kpi-${tone}` : ''}`}>
            <div className="jobs-kpi-label">{label}</div>
            <div className="jobs-kpi-value">{value}</div>
        </div>
    );
}

function TablePane({ pending, error, empty, children }: {
    pending: boolean;
    error: unknown;
    empty: boolean;
    children: ReactNode;
}) {
    if (pending) return <p className="dim">Loading…</p>;
    if (error) return <p className="jobs-text-danger">{error instanceof Error ? error.message : 'Request failed'}</p>;
    if (empty) return <p className="dim-italic">Nothing to show.</p>;
    return <div className="jobs-pane-scroll">{children}</div>;
}

/**
 * `last_error` is an unbounded exception string — a 200KB traceback must not
 * be pasted into the DOM just because it exists. The first 2000 characters
 * render immediately and the rest is one click away. There is no stack trace
 * to offer beside it: no graph carries `stack_trace`, and implying otherwise
 * would send the operator looking for something that is not on the wire.
 */
const ERROR_PREVIEW_CHARS = 2000;

function ErrorBlock({ text }: { text: string }) {
    const [full, setFull] = useState(false);
    const long = text.length > ERROR_PREVIEW_CHARS;
    return (
        <>
            <pre className="jobs-error-block">{full || !long ? text : `${text.slice(0, ERROR_PREVIEW_CHARS)}…`}</pre>
            {long && (
                <button type="button" className="btn btn-compact jobs-error-more" onClick={() => setFull((v) => !v)}>
                    {full ? 'Show less' : `Show the full error (${fmt.number(text.length)} characters)`}
                </button>
            )}
        </>
    );
}

// ── Cancel + retry dialogs ────────────────────────────────────────────

/**
 * Cancel is irreversible and its effect depends on whether the runner is still
 * alive, so it is ARMED rather than a plain confirm — and the dialog says which
 * of the two outcomes to expect before the second click.
 */
function CancelJobDialog({ job, onConfirm, onClose }: {
    job: JobRow;
    onConfirm: () => Promise<void>;
    onClose: () => void;
}) {
    return (
        <div className="modal-pad">
            <h2 className="modal-title">Cancel job</h2>
            <p className="dim">
                <code>{fmt.truncateMiddle(job.id, 16)}</code> · <code>{job.func || 'unknown function'}</code>
            </p>
            <p className="jobs-note jobs-note-warn">
                <i className="bi bi-exclamation-triangle" />
                {job.status === 'running'
                    ? <>A running job is canceled <strong>cooperatively</strong>: the flag is set and the runner stops at its next check. If its runner is not alive the backend force-cancels instead and the job ends immediately.</>
                    : <>The job is canceled outright and will never run.</>}
            </p>
            <div className="modal-actions">
                <button type="button" className="btn" onClick={onClose}>Keep job</button>
                <ArmedButton
                    label="Cancel job"
                    armedLabel="Click again to cancel this job"
                    icon="bi-x-circle"
                    className="btn-danger-ghost"
                    onConfirm={onConfirm}
                />
            </div>
        </div>
    );
}

/**
 * Retry ALWAYS republishes a new job (`{original_job_id, new_job_id, delayed}`)
 * — the row on screen does not resume. The dialog says so before the run and
 * hands back the new id afterwards, because "Retry scheduled" (the source's
 * toast) left an operator watching a job that was never going to move.
 */
function RetryJobDialog({ job, onRun, onOpenNewJob, onClose }: {
    job: JobRow;
    onRun: (delay: number | null) => Promise<{ newJobId: string; delayed: boolean }>;
    onOpenNewJob: (newJobId: string) => void;
    onClose: () => void;
}) {
    const [delay, setDelay] = useState(0);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<{ newJobId: string; delayed: boolean } | null>(null);

    const run = async () => {
        setBusy(true);
        try {
            setResult(await onRun(delay > 0 ? delay : null));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Retry failed');
        } finally {
            setBusy(false);
        }
    };

    if (result) {
        return (
            <div className="modal-pad">
                <h2 className="modal-title">Retry published</h2>
                <div className="jobs-result-note">
                    <p className="jobs-note jobs-note-info">
                        <i className="bi bi-info-circle" />
                        A <strong>new</strong> job was published{result.delayed ? ` and runs in ${delay}s` : ''}. The original
                        job keeps its own history — it did not resume.
                    </p>
                    <FlatRow label="Original"><code>{fmt.truncateMiddle(job.id, 16)}</code></FlatRow>
                    <FlatRow label="New job"><code>{fmt.truncateMiddle(result.newJobId, 16)}</code></FlatRow>
                </div>
                <div className="modal-actions">
                    <button type="button" className="btn" onClick={onClose}>Close</button>
                    <button type="button" className="btn btn-primary" onClick={() => onOpenNewJob(result.newJobId)}>
                        <i className="bi bi-box-arrow-up-right" /> Open new job
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="modal-pad">
            <h2 className="modal-title">Retry job</h2>
            <p className="dim">
                <code>{fmt.truncateMiddle(job.id, 16)}</code> · <code>{job.func || 'unknown function'}</code>
            </p>
            <p className="jobs-note jobs-note-info">
                <i className="bi bi-info-circle" /> Retrying republishes the payload as a <strong>new job</strong>. This
                one stays {job.status} until it is purged.
            </p>
            <label className="jobs-field">
                <span>Delay before it runs (seconds, 0 = immediately)</span>
                <input
                    type="number" className="input input-compact" min={0} step={5}
                    value={delay}
                    onChange={(event) => setDelay(Math.max(0, Number(event.target.value) || 0))}
                />
            </label>
            <div className="modal-actions">
                <button type="button" className="btn" onClick={onClose}>Cancel</button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run()}>
                    {busy ? 'Publishing…' : 'Retry'}
                </button>
            </div>
        </div>
    );
}

// ── Narrative ─────────────────────────────────────────────────────────

interface JobNarrative {
    tone: Tone;
    state: string;
    headline: string;
    meta: ReactNode;
}

/** The StatusPanel copy per lifecycle state — web-mojo's `_narrative` port. */
function jobNarrative(job: JobRow): JobNarrative {
    const duration = job.duration_ms > 0 ? fmt.duration(job.duration_ms) : null;
    const attempts = <>Attempt <strong>{job.attempt}</strong> of <strong>{job.max_retries || '∞'}</strong></>;

    if (isScheduledJob(job)) {
        const overdue = isOverdueJob(job);
        return {
            tone: overdue ? 'warning' : 'info',
            state: overdue ? 'OVERDUE' : 'SCHEDULED',
            headline: overdue
                ? `Was due ${relativeWhen(job.run_at)} and has not run`
                : `Runs ${relativeWhen(job.run_at)}`,
            meta: <><code>{job.func || 'unknown'}</code> on channel <code>{job.channel}</code> · queued {fmt.relative(job.created)}</>,
        };
    }
    if (job.status === 'running') {
        return {
            tone: 'primary',
            state: job.cancel_requested ? 'CANCELING' : 'RUNNING',
            headline: job.runner_id
                ? `Running on ${job.runner_id} · started ${fmt.relative(job.started_at)}`
                : `Running · started ${fmt.relative(job.started_at)}`,
            meta: job.cancel_requested
                ? <>{attempts} · a cancel has been requested; the runner stops at its next check</>
                : attempts,
        };
    }
    if (job.status === 'completed') {
        return {
            tone: 'success',
            state: 'COMPLETED',
            headline: duration ? `Completed in ${duration}` : 'Completed',
            meta: <>Finished {fmt.relative(job.finished_at)}{job.runner_id ? <> on <code>{job.runner_id}</code></> : null}</>,
        };
    }
    if (job.status === 'failed') {
        const firstLine = (job.last_error || '').split('\n')[0] || 'Failed';
        return {
            tone: 'danger',
            state: 'FAILED',
            headline: duration ? `Failed after ${duration}` : 'Failed',
            meta: <>{attempts}{canRetryJob(job) ? ' · retry available' : ''}<br /><code className="jobs-text-danger">{firstLine}</code></>,
        };
    }
    if (job.status === 'canceled') {
        return {
            tone: 'muted',
            state: 'CANCELED',
            headline: 'Canceled',
            meta: <>Canceled {fmt.relative(job.finished_at ?? job.modified)} · retry is still allowed</>,
        };
    }
    if (job.status === 'expired') {
        return {
            tone: 'warning',
            state: 'EXPIRED',
            headline: 'Expired before it ran',
            meta: <>Created {fmt.relative(job.created)}{job.expires_at ? <> · expiry {fmt.datetime(job.expires_at)}</> : null}</>,
        };
    }
    return {
        tone: jobStatusTone(job.status),
        state: 'PENDING',
        headline: 'Waiting for a runner',
        meta: <>Queued on channel <code>{job.channel}</code> · {fmt.relative(job.created)}</>,
    };
}

// ── The inspector ─────────────────────────────────────────────────────

const EVENT_PAGE = 50;
const SIMILAR_PAGE = 15;

export function JobDetail({ jobId, onClose }: { jobId: string; onClose: () => void }) {
    const queryClient = useQueryClient();
    const { can: canView } = useCan(JOBS_VIEW_PERMS);
    const { can: canManage } = useCan(JOBS_MANAGE_PERMS);

    // Every query is view-gated: a caller without the grant issues no request
    // at all rather than firing one and catching a 403.
    const query = JobModel.useOne(canView ? jobId : null);
    const job = query.data ?? null;
    const timeline = useJobTimeline(canView ? jobId : null);
    const logs = useJobLogs(canView ? jobId : null);
    const events = JobEventModel.useList(
        { job: jobId, sort: '-at', size: EVENT_PAGE },
        { enabled: canView },
    );
    const retries = JobEventModel.useList(
        { job: jobId, event: 'retry', sort: '-at', size: EVENT_PAGE },
        { enabled: canView },
    );
    const similar = JobModel.useList(
        { func: job?.func ?? '', sort: '-created', size: SIMILAR_PAGE },
        { enabled: canView && !!job?.func },
    );

    const cancelAction = JobModel.useAction('cancel_request');
    const retryAction = JobModel.useAction('retry_request');

    /**
     * One refresh for the whole record: the job, its events (timeline + the
     * events/retry lists share the endpoint root), its logs, and the jobs
     * domain root so the dashboard totals follow a cancel or a retry.
     */
    const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: JobModel.keys.root });
        void queryClient.invalidateQueries({ queryKey: JobEventModel.keys.root });
        void queryClient.invalidateQueries({ queryKey: JobLogModel.keys.root });
        void queryClient.invalidateQueries({ queryKey: jobsKeys.root });
    };

    if (query.isPending) return <div className="modal-pad dim">Loading job…</div>;
    if (!job || query.error) {
        return <div className="modal-pad text-bad">{query.error?.message ?? 'Job not found'}</div>;
    }

    const narrative = jobNarrative(job);
    const shortId = fmt.truncateMiddle(job.id, 16);
    const retriesLeft = Math.max(0, (job.max_retries ?? 0) - (job.attempt ?? 0));
    const similarRows = (similar.data?.rows ?? []).filter((row) => row.id !== job.id);

    const nextLabel = isScheduledJob(job) ? relativeWhen(job.run_at)
        : job.status === 'running' ? 'In flight'
            : canRetryJob(job) ? 'Retry available'
                : '—';
    const nextTone: Tone | null = isScheduledJob(job) ? (isOverdueJob(job) ? 'warning' : 'info')
        : job.status === 'running' ? 'primary'
            : canRetryJob(job) ? 'info'
                : null;

    const runCancel = async () => {
        try {
            const outcome = await cancelAction.mutateAsync({ id: job.id, payload: true });
            const body = outcome.body as { message?: string; forced?: boolean };
            // A running job on a DEAD runner is force-canceled server-side and
            // is already over — saying "cancellation requested" would be a lie.
            toast.success(body.forced
                ? `Job ${shortId} canceled — its runner was not alive, so the cancel was forced.`
                : body.message ?? 'Cancellation requested');
            refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Cancel failed');
        }
    };

    const openCancel = () => {
        void modal.open((close) => (
            <CancelJobDialog
                job={job}
                onClose={() => close(null)}
                // The dialog stays up while the request is in flight and closes
                // on its outcome — a cancel that 400s must not vanish silently.
                onConfirm={async () => { await runCancel(); close(null); }}
            />
        ), { size: 'sm' });
    };

    const openRetry = () => {
        void modal.open((close) => (
            <RetryJobDialog
                job={job}
                onClose={() => close(null)}
                onRun={async (delay) => {
                    const outcome = await retryAction.mutateAsync({
                        id: job.id,
                        payload: delay == null ? { retry: true } : { retry: true, delay },
                    });
                    const body = outcome.body as { new_job_id?: string; delayed?: boolean };
                    const newJobId = body.new_job_id ?? '';
                    toast.success(`Retry published as job ${fmt.truncateMiddle(newJobId, 16)}`);
                    refresh();
                    return { newJobId, delayed: Boolean(body.delayed) };
                }}
                onOpenNewJob={(newJobId) => {
                    // Follow the retry: close both this dialog and the original
                    // job's inspector, then open the job that actually runs.
                    close(null);
                    onClose();
                    showJobDetail(newJobId);
                }}
            />
        ), { size: 'sm' });
    };

    const contextMenu: DetailMenuEntry<JobRow>[] = [
        { label: 'Refresh', icon: 'bi-arrow-clockwise', onSelect: refresh },
        { divider: true },
        {
            label: 'Retry job…', icon: 'bi-arrow-repeat',
            permissions: JOBS_MANAGE_PERMS,
            when: (row) => (row ? canRetryJob(row) : false),
            onSelect: openRetry,
        },
        {
            label: 'Cancel job…', icon: 'bi-x-circle', danger: true,
            permissions: JOBS_MANAGE_PERMS,
            when: (row) => (row ? canCancelJob(row) : false),
            onSelect: openCancel,
        },
    ];

    return (
        <DetailView<JobRow>
            icon={isScheduledJob(job) ? 'bi-clock-fill' : jobStatusIcon(job.status)}
            title={job.func || 'unknown.task'}
            subtitle={narrative.headline}
            chips={[
                { icon: 'bi-broadcast', text: job.channel, tone: 'info' },
                { text: `#${job.id.slice(-8)}`, tone: 'muted' },
                ...(job.runner_id ? [{ icon: 'bi-cpu', text: job.runner_id, tone: 'muted' as const }] : []),
                ...(job.attempt > 0 || job.max_retries > 0
                    ? [{ text: `attempt ${job.attempt}/${job.max_retries || '∞'}`, tone: 'muted' as const }]
                    : []),
                ...(job.duration_ms > 0 ? [{ text: fmt.duration(job.duration_ms), tone: 'muted' as const }] : []),
                ...(job.cancel_requested
                    ? [{ icon: 'bi-exclamation-triangle', text: 'cancel requested', tone: 'warning' as const }]
                    : []),
            ]}
            menuContext={job}
            contextMenu={contextMenu}
            // Keyed by section key — and `similar` only exists when `func` does,
            // so the key is omitted with the section rather than left dangling
            // (DetailView warns about a badge key that names no section).
            badges={{
                events: events.data?.count || null,
                logs: logs.data?.count || null,
                retries: retries.data?.count || null,
                ...(job.func ? { similar: similarRows.length || null } : {}),
            }}
            sections={[
                {
                    key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => (
                        <>
                            <StatusPanel
                                tone={narrative.tone}
                                state={narrative.state}
                                headline={narrative.headline}
                                meta={narrative.meta}
                                actions={canManage ? (
                                    <div className="jobs-detail-actions">
                                        {canRetryJob(job) && (
                                            <button type="button" className="btn btn-compact btn-primary" onClick={openRetry}>
                                                <i className="bi bi-arrow-repeat" /> Retry…
                                            </button>
                                        )}
                                        {canCancelJob(job) && (
                                            <button type="button" className="btn btn-compact btn-danger-ghost" onClick={openCancel}>
                                                <i className="bi bi-x-circle" /> Cancel…
                                            </button>
                                        )}
                                    </div>
                                ) : null}
                            />

                            <div className="jobs-kpi-grid">
                                <Kpi
                                    label="Attempt"
                                    value={`${job.attempt} / ${job.max_retries || '∞'}`}
                                    tone={job.attempt > 0 && job.status === 'failed' ? 'warning' : null}
                                />
                                <Kpi label="Runtime" value={job.duration_ms > 0 ? fmt.duration(job.duration_ms) : '—'} />
                                <Kpi label="Retries left" value={retriesLeft} tone={retriesLeft === 0 && job.status === 'failed' ? 'danger' : null} />
                                <Kpi label={isScheduledJob(job) ? 'Scheduled' : 'Next'} value={nextLabel} tone={nextTone} />
                            </div>

                            <Eyebrow>Execution</Eyebrow>
                            <FlatRow label="Function"><code>{job.func || '—'}</code></FlatRow>
                            <FlatRow label="Channel"><code>{job.channel}</code></FlatRow>
                            <FlatRow label="Status"><JobStatusBadge status={job.status} /></FlatRow>
                            <FlatRow label="Runner">
                                {job.runner_id ? <code>{job.runner_id}</code> : <span className="dim">not claimed</span>}
                            </FlatRow>
                            <FlatRow label="Created">{fmt.datetime(job.created)}</FlatRow>
                            <FlatRow label="Started">
                                {job.started_at == null ? <span className="dim">—</span> : fmt.datetime(job.started_at)}
                            </FlatRow>
                            <FlatRow label="Finished">
                                {job.finished_at == null ? <span className="dim">—</span> : fmt.datetime(job.finished_at)}
                            </FlatRow>
                            {job.run_at != null && (
                                <FlatRow label="Runs at">{fmt.datetime(job.run_at)} · {relativeWhen(job.run_at)}</FlatRow>
                            )}
                            {job.expires_at != null && (
                                <FlatRow label="Expires">{fmt.datetime(job.expires_at)}</FlatRow>
                            )}
                            {job.broadcast && <FlatRow label="Broadcast"><Badge tone="info">every runner</Badge></FlatRow>}
                            {job.max_exec_seconds != null && (
                                <FlatRow label="Max execution">{fmt.duration(job.max_exec_seconds, 's')}</FlatRow>
                            )}
                            {job.cancel_requested && (
                                <FlatRow label="Cancel"><Badge tone="warning">requested</Badge></FlatRow>
                            )}
                            {job.last_error && <ErrorBlock text={job.last_error} />}

                            <Eyebrow>Lifecycle</Eyebrow>
                            {timeline.isPending
                                ? <p className="dim">Loading lifecycle…</p>
                                : timeline.error
                                    ? <p className="jobs-text-danger">{timeline.error instanceof Error ? timeline.error.message : 'Could not load the lifecycle.'}</p>
                                    : (
                                        <Timeline
                                            items={(timeline.data?.rows ?? []).map(toTimelineItem)}
                                            emptyText="No events recorded yet. Lifecycle entries appear as the runner claims the job and emits events."
                                        />
                                    )}
                        </>
                    ),
                },
                {
                    key: 'payload', label: 'Payload', icon: 'bi-braces', render: () => (
                        <>
                            <JsonBlock value={job.payload} label="Payload" defaultOpen />
                            {Object.keys(job.metadata ?? {}).length > 0 && (
                                <JsonBlock value={job.metadata} label="Metadata" />
                            )}
                        </>
                    ),
                },
                { divider: 'Activity' },
                {
                    key: 'events', label: 'Events', icon: 'bi-list-ul', render: () => (
                        <TablePane pending={events.isPending} error={events.error} empty={(events.data?.rows.length ?? 0) === 0}>
                            <table className="jobs-table">
                                <thead><tr><th>When</th><th>Event</th><th>Runner</th><th>Attempt</th><th>Details</th></tr></thead>
                                <tbody>
                                    {(events.data?.rows ?? []).map((event) => (
                                        <tr key={event.id}>
                                            <td title={fmt.datetime(event.at)}>{fmt.relative(event.at)}</td>
                                            <td>
                                                <Badge tone={eventTone(event.event)}>
                                                    <i className={`bi ${eventIcon(event.event)}`} /> {event.event}
                                                </Badge>
                                            </td>
                                            <td>{event.runner_id ? <code className="jobs-id">{fmt.truncateMiddle(event.runner_id, 14)}</code> : <span className="dim">—</span>}</td>
                                            <td>{event.attempt}</td>
                                            <td>
                                                {Object.keys(event.details ?? {}).length > 0
                                                    ? <code className="jobs-json-inline">{JSON.stringify(event.details)}</code>
                                                    : <span className="dim">—</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TablePane>
                    ),
                },
                {
                    key: 'logs', label: 'Logs', icon: 'bi-code-square', render: () => (
                        <TablePane pending={logs.isPending} error={logs.error} empty={(logs.data?.rows.length ?? 0) === 0}>
                            <table className="jobs-table">
                                <thead><tr><th>When</th><th>Kind</th><th>Message</th></tr></thead>
                                <tbody>
                                    {(logs.data?.rows ?? []).map((log) => (
                                        <tr key={log.id}>
                                            <td title={fmt.datetime(log.created)}>{fmt.relative(log.created)}</td>
                                            <td>
                                                <Badge tone={log.kind === 'error' ? 'danger' : log.kind === 'warn' ? 'warning' : 'muted'}>
                                                    {log.kind}
                                                </Badge>
                                            </td>
                                            <td>{log.message}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TablePane>
                    ),
                },
                {
                    key: 'retries', label: 'Retry history', icon: 'bi-arrow-repeat', render: () => (
                        <>
                            <p className="jobs-note jobs-note-info">
                                <i className="bi bi-info-circle" /> Each retry republished the payload as a NEW job; the
                                <code>new_job_id</code> in an entry’s details is the job that actually ran.
                            </p>
                            {retries.isPending
                                ? <p className="dim">Loading retries…</p>
                                : (
                                    <Timeline
                                        items={(retries.data?.rows ?? []).map(toTimelineItem)}
                                        emptyText="This job has never been retried."
                                    />
                                )}
                        </>
                    ),
                },
                ...(job.func
                    ? [{
                        divider: 'Related' as const,
                    }, {
                        key: 'similar', label: 'Similar', icon: 'bi-files', render: () => (
                            <>
                                <Eyebrow>Recent jobs running <code>{job.func}</code></Eyebrow>
                                <TablePane pending={similar.isPending} error={similar.error} empty={similarRows.length === 0}>
                                    <table className="jobs-table">
                                        <thead><tr><th>Job</th><th>Status</th><th>Created</th><th>Duration</th></tr></thead>
                                        <tbody>
                                            {similarRows.map((row) => (
                                                <tr key={row.id} className="row-click" onClick={() => showJobDetail(row.id)}>
                                                    <td><JobIdentity job={row} /></td>
                                                    <td><JobStatusBadge status={row.status} /></td>
                                                    <td title={fmt.datetime(row.created)}>{fmt.relative(row.created)}</td>
                                                    <td>{row.duration_ms > 0 ? fmt.duration(row.duration_ms) : '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TablePane>
                            </>
                        ),
                    }]
                    : []),
            ]}
            initialSection="overview"
            onClose={onClose}
        />
    );
}

/** Open the inspector as a KISS detail modal — no record-detail route. */
export function showJobDetail(jobId: string): void {
    void modal.detail((close) => <JobDetail jobId={jobId} onClose={() => close(null)} />);
}
