// Admin jobs — the jobs table's segments, per-segment column sets, filters and
// its safe client export. Port of web-mojo sections/JobTableSection.js (its
// per-status `COLUMNS` map, `ALL_FILTERS` and the cancel batch action),
// re-wired to the fields django-mojo actually serves.
//
// Corrections carried from reading the backend rather than the source:
//   · web-mojo's `pending` column set rendered a `priority` badge. jobs.Job
//     has NO priority field in any graph — the column always read `undefined`
//     and rendered `0`. Replaced with the queue facts that exist: how long the
//     job has waited and when it expires.
//   · its `running` set labelled `created` "Started". `started_at` is a real
//     field and is what "started" means for a running job.
//   · the `all` set hand-rolled epoch-vs-ms coercion inside a formatter; `fmt`
//     already sniffs every django-mojo datetime shape.
//   · every cell was a trusted-HTML template string. These are ReactNode
//     renders — the escaping contract cannot be broken.
//
// The SEGMENTS are the other half of the port: web-mojo shipped one page per
// status (JobsTablePage, plus dashboard sections passing `status`), which meant
// five tables and five column configs to keep in step. Here one table carries
// preset param bundles and swaps its column set with the segment, because the
// segment IS the params — `status` (+ `run_at__isnull` to split Queued from
// Scheduled) and nothing else.
import { createSafeExporter } from '../../client/runtime';
import { Badge, fmt, type Column, type Preset } from '../../ui';
import {
    isOverdueJob,
    jobStatusIcon,
    jobStatusTone,
    JobModel,
    type JobRow,
} from './models';

// ── Segments ──────────────────────────────────────────────────────────

export type JobSegmentKey = 'running' | 'queued' | 'scheduled' | 'failed' | 'all';

/**
 * Queued vs Scheduled splits on `run_at__isnull`, NOT on comparing a datetime
 * on the wire: `__isnull` is an explicitly supported lookup that needs no date
 * coercion, and a pending job whose `run_at` has passed stays in Scheduled
 * flagged "overdue" — which is its true state, not a queue position.
 */
export const JOB_SEGMENTS: (Preset & { key: JobSegmentKey })[] = [
    { key: 'running', label: 'Running', params: { status: 'running' } },
    { key: 'queued', label: 'Queued', params: { status: 'pending', run_at__isnull: 'true' } },
    { key: 'scheduled', label: 'Scheduled', params: { status: 'pending', run_at__isnull: 'false' } },
    { key: 'failed', label: 'Failed', params: { status: 'failed' } },
    { key: 'all', label: 'All', params: {} },
];

/**
 * Which column set the current params ask for.
 *
 * Deliberately more forgiving than `presetActive`: the chip highlight requires
 * an EXACT filter match (adding a channel filter un-highlights the chip), but
 * the columns should keep following the status the operator is looking at.
 * "Running jobs on the email channel" still wants the Running columns.
 */
export function jobSegmentOf(status: string | null, runAtIsNull: string | null): JobSegmentKey {
    if (status === 'running') return 'running';
    if (status === 'failed') return 'failed';
    if (status === 'pending') return runAtIsNull === 'false' ? 'scheduled' : 'queued';
    return 'all';
}

// ── Shared cells ──────────────────────────────────────────────────────

/** "runs in 2h" / "3m ago" — `fmt.relative` only speaks the past tense. */
export function relativeWhen(value: number | null | undefined, fallback = '—'): string {
    if (value == null) return fallback;
    const diffSec = Math.round((value * 1000 - Date.now()) / 1000);
    const ago = diffSec <= 0;
    const magnitude = Math.abs(diffSec);
    const text = magnitude < 60 ? `${magnitude}s`
        : magnitude < 3600 ? `${Math.floor(magnitude / 60)}m`
            : magnitude < 86400 ? `${Math.floor(magnitude / 3600)}h`
                : `${Math.floor(magnitude / 86400)}d`;
    return ago ? `${text} ago` : `in ${text}`;
}

/** Job identity: the id kept recognizable at both ends, channel + func under it. */
export function JobIdentity({ job }: { job: JobRow }) {
    return (
        <>
            <div className="jobs-cell-id"><code>{fmt.truncateMiddle(job.id, 12)}</code></div>
            <div className="jobs-cell-sub">
                {job.channel} · {job.func ? fmt.truncateMiddle(job.func, 34, '…') : 'no function'}
            </div>
        </>
    );
}

export function JobStatusBadge({ status }: { status: string }) {
    return (
        <Badge tone={jobStatusTone(status)}>
            <i className={`bi ${jobStatusIcon(status)}`} /> {status.toUpperCase()}
        </Badge>
    );
}

function RunnerCell({ runnerId }: { runnerId: string | null }) {
    return runnerId
        ? <code className="jobs-id">{fmt.truncateMiddle(runnerId, 18)}</code>
        : <span className="dim">—</span>;
}

function AttemptCell({ job }: { job: JobRow }) {
    return <span className="jobs-nums">{job.attempt} / {job.max_retries || '∞'}</span>;
}

// ── Column sets ───────────────────────────────────────────────────────

const IDENTITY: Column<JobRow> = {
    key: 'id', label: 'Job', sortable: false, hideable: false,
    render: (row) => <JobIdentity job={row} />,
};

const STATUS: Column<JobRow> = {
    key: 'status', label: 'Status', sortable: true,
    render: (row) => <JobStatusBadge status={row.status} />,
};

const CHANNEL: Column<JobRow> = {
    key: 'channel', label: 'Channel', sortable: true,
    render: (row) => <Badge tone="muted">{row.channel}</Badge>,
};

const RUNNER: Column<JobRow> = {
    key: 'runner_id', label: 'Runner', sortable: true,
    render: (row) => <RunnerCell runnerId={row.runner_id} />,
};

const ATTEMPT: Column<JobRow> = {
    key: 'attempt', label: 'Attempt', sortable: true, align: 'center',
    render: (row) => <AttemptCell job={row} />,
};

const CREATED: Column<JobRow> = {
    key: 'created', label: 'Created', sortable: true,
    render: (row) => <span title={fmt.datetime(row.created)}>{fmt.relative(row.created)}</span>,
};

/** `duration_ms` is a serializer EXTRA, not a column the server can sort on. */
const DURATION: Column<JobRow> = {
    key: 'duration_ms', label: 'Duration', sortable: false, align: 'end',
    render: (row) => (row.duration_ms > 0 ? fmt.duration(row.duration_ms) : <span className="dim">—</span>),
};

const COLUMNS: Record<JobSegmentKey, Column<JobRow>[]> = {
    running: [
        IDENTITY,
        RUNNER,
        STATUS,
        {
            key: 'started_at', label: 'Started', sortable: true,
            render: (row) => (row.started_at == null
                ? <span className="dim">not yet claimed</span>
                : <span title={fmt.datetime(row.started_at)}>{fmt.relative(row.started_at)}</span>),
        },
        ATTEMPT,
        {
            key: 'cancel_requested', label: 'Cancel', sortable: false, align: 'center',
            render: (row) => (row.cancel_requested
                ? <Badge tone="warning">requested</Badge>
                : <span className="dim">—</span>),
        },
    ],

    // web-mojo's `pending` set led with a `priority` badge. There is no such
    // field — what a queued job actually has is an age and an expiry.
    queued: [
        IDENTITY,
        CHANNEL,
        {
            key: 'created', label: 'Waiting', sortable: true,
            render: (row) => <span title={fmt.datetime(row.created)}>{fmt.relative(row.created)}</span>,
        },
        {
            key: 'expires_at', label: 'Expires', sortable: true,
            render: (row) => (row.expires_at == null
                ? <span className="dim">never</span>
                : <span title={fmt.datetime(row.expires_at)}>{relativeWhen(row.expires_at)}</span>),
        },
        ATTEMPT,
    ],

    scheduled: [
        IDENTITY,
        {
            key: 'run_at', label: 'Runs at', sortable: true,
            render: (row) => (
                <div className="jobs-cell-stack">
                    <span>{fmt.datetime(row.run_at)}</span>
                    <span className="jobs-cell-sub">{relativeWhen(row.run_at)}</span>
                </div>
            ),
        },
        {
            // A pending job whose run_at has passed is not "late by a little" —
            // nothing has picked it up, which is the point of showing it.
            key: 'overdue', label: 'State', sortable: false, align: 'center',
            render: (row) => (isOverdueJob(row)
                ? <Badge tone="warning"><i className="bi bi-exclamation-triangle" /> OVERDUE</Badge>
                : <Badge tone="info">WAITING</Badge>),
        },
        CHANNEL,
        CREATED,
    ],

    failed: [
        IDENTITY,
        {
            key: 'last_error', label: 'Error', sortable: false,
            render: (row) => {
                // Only the FIRST line: a traceback in a table cell is noise,
                // and the full text is one click away in the detail modal.
                const firstLine = (row.last_error || '').split('\n')[0] ?? '';
                return (
                    <div className="jobs-cell-error" title={row.last_error || undefined}>
                        {firstLine ? fmt.truncate(firstLine, 90, '…') : 'Unknown error'}
                    </div>
                );
            },
        },
        ATTEMPT,
        {
            key: 'finished_at', label: 'Failed', sortable: true,
            render: (row) => <span title={fmt.datetime(row.finished_at ?? row.modified)}>{fmt.relative(row.finished_at ?? row.modified)}</span>,
        },
        RUNNER,
    ],

    all: [
        IDENTITY,
        CHANNEL,
        STATUS,
        {
            key: 'run_at', label: 'Scheduled', sortable: true,
            render: (row) => (row.run_at == null
                ? <span className="dim">—</span>
                : (
                    <span className={isOverdueJob(row) ? 'jobs-text-warning' : undefined} title={fmt.datetime(row.run_at)}>
                        <i className={`bi ${isOverdueJob(row) ? 'bi-clock-history' : 'bi-clock'}`} /> {relativeWhen(row.run_at)}
                    </span>
                )),
        },
        CREATED,
        {
            key: 'finished_at', label: 'Finished', sortable: true,
            render: (row) => (row.finished_at == null
                ? <span className="dim">—</span>
                : <span title={fmt.datetime(row.finished_at)}>{fmt.relative(row.finished_at)}</span>),
        },
        DURATION,
    ],
};

export function jobColumns(segment: JobSegmentKey): Column<JobRow>[] {
    return COLUMNS[segment] ?? COLUMNS.all;
}

// ── Safe client export ────────────────────────────────────────────────

/**
 * Job payloads carry whatever the caller published (recipients, file paths,
 * credentials someone put in a dict), metadata is equally open-ended, and
 * `last_error` is a raw exception string. None of them belong in a file that
 * leaves the browser, so the export is a CLIENT projection over the same
 * filtered set rather than the server's `download_format`, which would ship
 * every graph field.
 */
export function sanitizeJobRowForExport(row: JobRow): JobRow {
    return { ...row, payload: {}, metadata: {}, last_error: '' };
}

export const JOB_EXPORTER = createSafeExporter<JobRow>({
    endpoint: JobModel.endpoint,
    filename: 'jobs',
    sanitizeRow: sanitizeJobRowForExport,
    fields: [
        { key: 'id' },
        { key: 'channel' },
        { key: 'func' },
        { key: 'status' },
        { key: 'runner_id' },
        { key: 'attempt' },
        { key: 'max_retries' },
        { key: 'cancel_requested' },
        { key: 'created' },
        { key: 'run_at' },
        { key: 'started_at' },
        { key: 'finished_at' },
        { key: 'expires_at' },
        { key: 'duration_ms' },
    ],
});
