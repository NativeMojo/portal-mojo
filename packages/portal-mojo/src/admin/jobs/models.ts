// Admin jobs — typed row shapes, model definitions and the derived helpers
// every jobs surface shares. Wire facts here come from django-mojo
// `mojo/apps/jobs/` (models/job.py, models/scheduled_task.py,
// models/task_result.py, rest/jobs.py, rest/control.py, manager.py,
// job_engine.py), which is authoritative wherever web-mojo disagreed.
//
// Two asymmetries are load-bearing and deliberately preserved in the types:
//   · MODEL rows carry epoch-SECOND datetimes (the mojo serializer), while
//     runner heartbeats and sysinfo replies carry ISO strings (they are raw
//     Redis/JSON payloads that never pass through the serializer);
//   · `GET /api/jobs/runners` stamps `id = runner_id` on every row
//     (rest/jobs.py on_list_runners) but `GET /api/jobs/stats` does NOT —
//     its `runners` array is manager.get_runners() verbatim. Hence
//     `RunnerHeartbeat` (stats) vs `RunnerRow` (the runners endpoint).
import { defineModel, type Params } from '../../client/runtime';
import type { Tone } from '../../ui';

// ── Permission constants ──────────────────────────────────────────────
// Exact backend lists, `sys.`-pinned so a similarly named ACTIVE-GROUP
// permission can never light an operator-global surface. `owner` is
// deliberately dropped from the scheduled-task gates: ScheduledTask and
// TaskResult declare `owner` in VIEW_PERMS, so an ungated page would return
// HTTP 200 with only the caller's OWN rows and render a personal task list as
// if it were the system's. Gating on the global grant is fail-closed.

/** jobs.Job / JobEvent / JobLog VIEW_PERMS + the control plane's read gate. */
export const JOBS_VIEW_PERMS = ['sys.manage_jobs', 'sys.view_jobs', 'sys.jobs'];
/** jobs.Job SAVE/DELETE_PERMS + every `requires_global_perms` write control. */
export const JOBS_MANAGE_PERMS = ['sys.manage_jobs', 'sys.jobs'];
/** ScheduledTask/TaskResult VIEW_PERMS minus `owner` (see note above). */
export const SCHEDULED_TASK_VIEW_PERMS = ['sys.jobs', 'sys.view_scheduled_tasks'];
/** ScheduledTask SAVE/DELETE_PERMS minus `owner`. */
export const SCHEDULED_TASK_MANAGE_PERMS = ['sys.jobs', 'sys.manage_scheduled_tasks'];

// ── Row types ─────────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled' | 'expired';

export const JOB_STATUSES: readonly JobStatus[] = [
    'pending', 'running', 'completed', 'failed', 'canceled', 'expired',
];

export const JOB_STATUS_OPTIONS = JOB_STATUSES.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
}));

/** jobs.Job `default`/`detail` graph + the `duration_ms` extra. */
export interface JobRow {
    id: string;
    channel: string;
    func: string;
    payload: Record<string, unknown>;
    status: JobStatus;
    run_at: number | null;
    expires_at: number | null;
    attempt: number;
    max_retries: number;
    broadcast: boolean;
    cancel_requested: boolean;
    max_exec_seconds: number | null;
    runner_id: string | null;
    last_error: string;
    metadata: Record<string, unknown>;
    created: number;
    modified: number;
    started_at: number | null;
    finished_at: number | null;
    duration_ms: number;
}

export type JobEventKind =
    | 'created' | 'queued' | 'scheduled' | 'running' | 'retry'
    | 'canceled' | 'completed' | 'failed' | 'expired' | 'claimed' | 'released';

export const JOB_EVENT_KINDS: readonly JobEventKind[] = [
    'created', 'queued', 'scheduled', 'running', 'retry',
    'canceled', 'completed', 'failed', 'expired', 'claimed', 'released',
];

/** jobs.JobEvent `default` graph (`detail` additionally carries job_id/channel). */
export interface JobEventRow {
    id: number;
    event: JobEventKind;
    at: number;
    runner_id: string | null;
    attempt: number;
    details: Record<string, unknown>;
    job_id?: string;
    channel?: string;
}

/**
 * jobs.JobEvent `timeline` graph — {event, at, runner_id, details}. It has NO
 * `id`, which is exactly why it is a separate type: a timeline entry cannot be
 * fed to anything that keys on a row id.
 */
export interface JobTimelineEntry {
    event: JobEventKind;
    at: number;
    runner_id: string | null;
    details: Record<string, unknown>;
}

export type JobLogKind = 'debug' | 'info' | 'warn' | 'error';

export const JOB_LOG_KIND_OPTIONS: { value: JobLogKind; label: string }[] = [
    { value: 'debug', label: 'Debug' },
    { value: 'info', label: 'Info' },
    { value: 'warn', label: 'Warn' },
    { value: 'error', label: 'Error' },
];

/** jobs.JobLog `default` graph (`detail` adds channel + meta). */
export interface JobLogRow {
    id: number;
    job_id: string;
    created: number;
    kind: JobLogKind;
    message: string;
    channel?: string;
    meta?: Record<string, unknown>;
}

/**
 * A runner heartbeat as JobEngine._heartbeat_loop writes it into Redis, plus
 * the `alive` flag manager.get_runners() derives from the heartbeat age. ISO
 * strings, not epoch seconds — this payload never touches the serializer.
 * There is no `version` field (web-mojo rendered a chip for one anyway).
 */
export interface RunnerHeartbeat {
    runner_id: string;
    hostname: string;
    channels: string[];
    jobs_processed: number;
    jobs_failed: number;
    started: string | null;
    last_heartbeat: string | null;
    alive: boolean;
}

/** `GET /api/jobs/runners` rows — the heartbeat with `id` stamped on. */
export interface RunnerRow extends RunnerHeartbeat {
    id: string;
}

/** `mojo/helpers/sysinfo.get_host_info()` — every key optional; psutil may be absent. */
export interface RunnerHostInfo {
    time?: number;
    datetime?: string;
    os?: {
        system?: string;
        version?: string;
        hostname?: string;
        release?: string;
        processor?: string;
        machine?: string;
    };
    boot_time?: number;
    cpu_load?: number;
    cpus_load?: number[];
    memory?: { total?: number; used?: number; available?: number; percent?: number };
    disk?: { total?: number; used?: number; free?: number; percent?: number };
    cpu?: { count?: number; freq?: { current?: number; min?: number; max?: number } | null };
    network?: {
        tcp_cons?: number;
        bytes_sent?: number;
        bytes_recv?: number;
        packets_sent?: number;
        packets_recv?: number;
        errin?: number;
        errout?: number;
        dropin?: number;
        dropout?: number;
    };
    users?: unknown[];
}

/**
 * One runner's reply to the sysinfo broadcast-execute. The INNER `status` is
 * the runner's own success/failure — a reply with `status: 'error'` arrives
 * inside a successful HTTP envelope, so it must be handled as a distinct
 * state rather than as a request failure.
 */
export interface RunnerSysinfo {
    runner_id: string;
    func?: string;
    status: 'success' | 'error';
    timestamp?: string;
    result?: RunnerHostInfo;
    error?: string;
}

/** One channel's slice of `GET /api/jobs/stats` (manager.get_queue_state + db_running). */
export interface JobChannelState {
    channel: string;
    queued_count: number;
    inflight_count: number;
    scheduled_count: number;
    /** ALIVE runners serving this channel. */
    runners: number;
    db_running: number;
    metrics?: {
        jobs_per_minute?: number;
        success_rate?: number;
        avg_duration_ms?: number;
    };
}

export interface JobsStatsTotals {
    /** Backwards-compatible alias the backend keeps for `queued`. */
    pending: number;
    queued: number;
    inflight: number;
    running: number;
    running_active: number;
    running_stale: number;
    completed: number;
    failed: number;
    scheduled: number;
    runners_active: number;
}

/** `GET /api/jobs/stats` — the whole dashboard reads from this one call. */
export interface JobsStats {
    channels: Record<string, JobChannelState>;
    runners: RunnerHeartbeat[];
    totals: JobsStatsTotals;
    scheduler: { active: boolean; lock_holder: string | null };
}

/** `GET /api/jobs/control/queue-sizes` — per-channel Redis + DB status counts. */
export interface JobQueueSize {
    stream: number;
    scheduled: number;
    db_pending: number;
    db_running: number;
    db_completed: number;
    db_failed: number;
    db_canceled: number;
    db_expired: number;
}

/** `GET /api/jobs/control/config` (manage-gated) — the engine's runtime settings. */
export interface JobsConfig {
    redis_url: string;
    redis_prefix: string;
    engine: Record<string, number>;
    defaults: Record<string, string | number>;
    limits: Record<string, number>;
    timeouts: Record<string, number>;
    channels: string[];
    allowed_channels: string[];
}

export type ScheduledTaskType = 'job' | 'webhook' | 'llm';

export const SCHEDULED_TASK_TYPE_OPTIONS: { value: ScheduledTaskType; label: string }[] = [
    { value: 'job', label: 'Job' },
    { value: 'webhook', label: 'Webhook' },
    { value: 'llm', label: 'LLM' },
];

/** Mon=0 — ScheduledTask.run_days uses Python's weekday(), not Django's. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** ScheduledTask._validate's exact notify allowlist. */
export const NOTIFY_CHANNELS = ['email', 'in_app', 'sms', 'push'] as const;

/** jobs.ScheduledTask `default` graph (`list` is a narrower subset of it). */
export interface ScheduledTaskRow {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    run_once: boolean;
    task_type: ScheduledTaskType;
    run_times: string[];
    run_days: number[];
    job_config: Record<string, unknown>;
    notify: string[];
    channel: string;
    max_retries: number;
    last_run: number | null;
    run_count: number;
    last_error: string;
    created: number;
    modified: number;
}

/** jobs.TaskResult `default` graph. Read-only over REST (SAVE_PERMS is empty). */
export interface TaskResultRow {
    id: string;
    task_id: string;
    job_id: string | null;
    status: 'success' | 'error';
    output: string;
    error: string;
    created: number;
}

// ── List-param normalization ──────────────────────────────────────────
// Two jobs invariants live here:
//   1. Every list ALWAYS sends an explicit `sort`. The backend's default is
//      `-id`, and Job/ScheduledTask ids are uuid hex — an unsorted job list is
//      lexicographic noise, not "newest first".
//   2. `graph` and `download_format` never survive from the URL. A graph
//      override could widen the serialized field set past what a surface is
//      meant to show; export format is chosen by the export path, not by a
//      link someone pasted.

const COMMON_PARAMS = new Set(['start', 'size', 'sort', 'search', 'dr_field', 'dr_start', 'dr_end']);

const JOB_FILTERS = new Set([
    'id', 'id__in', 'channel', 'channel__in', 'func', 'func__icontains', 'func__startswith',
    'status', 'status__in', 'status__not', 'runner_id', 'runner_id__in', 'runner_id__isnull',
    'run_at__isnull', 'run_at__gte', 'run_at__lte', 'broadcast', 'cancel_requested',
    'attempt', 'attempt__gte', 'created__gte', 'created__lte',
    'started_at__gte', 'started_at__lte', 'finished_at__gte', 'finished_at__lte',
]);

const JOB_EVENT_FILTERS = new Set([
    'id', 'job', 'job__in', 'channel', 'event', 'event__in', 'event__not',
    'runner_id', 'attempt', 'at__gte', 'at__lte',
]);

// JobLog has NO `runner_id` field, and `build_rest_filters` SILENTLY DROPS
// unknown keys (`hasattr(cls, field_name)`) — `?job_id=…` and `?runner_id=…`
// return the UNFILTERED list rather than an error. Only the relation name
// works, so only the relation name is allowed through.
const JOB_LOG_FILTERS = new Set([
    'id', 'job', 'job__in', 'channel', 'kind', 'kind__in', 'created__gte', 'created__lte',
]);

const SCHEDULED_TASK_FILTERS = new Set([
    'id', 'name__icontains', 'enabled', 'run_once', 'task_type', 'task_type__in',
    'channel', 'run_count__gte', 'last_run__gte', 'last_run__isnull', 'created__gte', 'created__lte',
]);

const TASK_RESULT_FILTERS = new Set([
    'id', 'task', 'task__in', 'job', 'status', 'status__in', 'created__gte', 'created__lte',
]);

function normalizeJobsParams(params: Params, allowed: Set<string>, fallbackSort: string): Params {
    const out: Params = {};
    for (const [key, value] of Object.entries(params)) {
        if (key === 'graph' || key === 'download_format') continue;
        if (!COMMON_PARAMS.has(key) && !allowed.has(key)) continue;
        if (value == null || value === '') continue;
        out[key] = value;
    }
    out.sort = String(out.sort ?? fallbackSort);
    return out;
}

export const normalizeJobListParams = (params: Params): Params =>
    normalizeJobsParams(params, JOB_FILTERS, '-created');
export const normalizeJobEventListParams = (params: Params): Params =>
    normalizeJobsParams(params, JOB_EVENT_FILTERS, '-at');
export const normalizeJobLogListParams = (params: Params): Params =>
    normalizeJobsParams(params, JOB_LOG_FILTERS, '-created');
export const normalizeScheduledTaskListParams = (params: Params): Params =>
    normalizeJobsParams(params, SCHEDULED_TASK_FILTERS, '-created');
export const normalizeTaskResultListParams = (params: Params): Params =>
    normalizeJobsParams(params, TASK_RESULT_FILTERS, '-created');

// ── Model definitions ─────────────────────────────────────────────────

/**
 * `cancel_request` and `retry_request` are POST_SAVE_ACTIONS, and django-mojo
 * returns a handler's dict VERBATIM as the response body (rest.py
 * on_rest_save_and_respond → `JsonResponse(resp)`) — not the row, not nested
 * under `data`, and at HTTP 200 even when the handler failed. The client's
 * `status === false` unwrap is what turns a refusal into a rejection, so both
 * actions declare `response: 'payload'`.
 */
export const JobModel = defineModel<JobRow>({
    name: 'job',
    endpoint: '/api/jobs/job',
    permissions: {
        view: JOBS_VIEW_PERMS,
        manage: JOBS_MANAGE_PERMS,
        delete: JOBS_MANAGE_PERMS,
    },
    actions: {
        // Python treats `{}` as falsy, so an argument-less call would fail with
        // "cancel_request must be true" — callers MUST pass `payload: true`.
        cancel_request: { response: 'payload', permissions: JOBS_MANAGE_PERMS },
        // `true`, or `{retry: true, delay: N}`. ALWAYS republishes a new job.
        retry_request: { response: 'payload', permissions: JOBS_MANAGE_PERMS },
    },
    normalizeListParams: normalizeJobListParams,
});

export const JobEventModel = defineModel<JobEventRow>({
    name: 'job_event',
    endpoint: '/api/jobs/event',
    // SAVE_PERMS is empty on the backend — events are system-created only.
    permissions: { view: JOBS_VIEW_PERMS, delete: JOBS_MANAGE_PERMS },
    normalizeListParams: normalizeJobEventListParams,
});

export const JobLogModel = defineModel<JobLogRow>({
    name: 'job_log',
    endpoint: '/api/jobs/logs',
    // SAVE_PERMS is empty — logs are written via Job.add_log.
    permissions: { view: JOBS_VIEW_PERMS, delete: JOBS_MANAGE_PERMS },
    normalizeListParams: normalizeJobLogListParams,
});

export const ScheduledTaskModel = defineModel<ScheduledTaskRow>({
    name: 'scheduled_task',
    endpoint: '/api/jobs/scheduled_task',
    permissions: {
        view: SCHEDULED_TASK_VIEW_PERMS,
        manage: SCHEDULED_TASK_MANAGE_PERMS,
        delete: SCHEDULED_TASK_MANAGE_PERMS,
    },
    normalizeListParams: normalizeScheduledTaskListParams,
});

export const TaskResultModel = defineModel<TaskResultRow>({
    name: 'task_result',
    endpoint: '/api/jobs/task_result',
    permissions: { view: SCHEDULED_TASK_VIEW_PERMS, delete: SCHEDULED_TASK_MANAGE_PERMS },
    normalizeListParams: normalizeTaskResultListParams,
});

// ── Derived helpers ───────────────────────────────────────────────────

const JOB_STATUS_TONE: Record<JobStatus, Tone> = {
    pending: 'info',
    running: 'primary',
    completed: 'success',
    failed: 'danger',
    canceled: 'muted',
    expired: 'warning',
};

const JOB_STATUS_ICON: Record<JobStatus, string> = {
    pending: 'bi-hourglass',
    running: 'bi-play-circle',
    completed: 'bi-check-circle',
    failed: 'bi-x-octagon',
    canceled: 'bi-slash-circle',
    expired: 'bi-clock-history',
};

/** Unknown wire values fall back to muted WITH a warn — never to nothing. */
export function jobStatusTone(status: string): Tone {
    const tone = JOB_STATUS_TONE[status as JobStatus];
    if (tone) return tone;
    console.warn(`[admin/jobs] unknown job status ${JSON.stringify(status)} — falling back to "muted". Valid: ${JOB_STATUSES.join(', ')}`);
    return 'muted';
}

export function jobStatusIcon(status: string): string {
    const icon = JOB_STATUS_ICON[status as JobStatus];
    if (icon) return icon;
    console.warn(`[admin/jobs] unknown job status ${JSON.stringify(status)} — falling back to the generic icon.`);
    return 'bi-question-circle';
}

/** Terminal states, per `Job.is_terminal`. */
export function isTerminalJob(job: Pick<JobRow, 'status'>): boolean {
    return job.status === 'completed' || job.status === 'failed'
        || job.status === 'canceled' || job.status === 'expired';
}

/** Pending WITH a run_at — the Scheduled segment, not the Queued one. */
export function isScheduledJob(job: Pick<JobRow, 'status' | 'run_at'>): boolean {
    return job.status === 'pending' && job.run_at != null;
}

/** A scheduled job whose run_at has passed and which still has not run. */
export function isOverdueJob(job: Pick<JobRow, 'status' | 'run_at'>, now = Date.now()): boolean {
    return isScheduledJob(job) && job.run_at! * 1000 < now;
}

/**
 * JobActionsService.cancel_job refuses a terminal job, so the control is not
 * offered for one. It is NOT `!cancel_requested` — re-requesting a cancel on a
 * running job is legal and is how a cooperative cancel gets nudged again.
 */
export function canCancelJob(job: Pick<JobRow, 'status'>): boolean {
    return !isTerminalJob(job);
}

/**
 * The SERVICE rule (`status not in ('failed','canceled','expired')` → refuse),
 * which is broader than the model's `is_retriable` property (failed AND
 * attempt < max_retries). The service is what the endpoint runs.
 */
export function canRetryJob(job: Pick<JobRow, 'status'>): boolean {
    return job.status === 'failed' || job.status === 'canceled' || job.status === 'expired';
}

export type RunnerHealthKey = 'healthy' | 'stale' | 'down';

export interface RunnerHealth {
    key: RunnerHealthKey;
    label: string;
    tone: Tone;
}

/** Seconds since an ISO heartbeat, or null when there has never been one. */
export function heartbeatAgeSeconds(iso: string | null | undefined, now = Date.now()): number | null {
    if (!iso) return null;
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) return null;
    return (now - parsed) / 1000;
}

export function formatHeartbeatAge(ageSec: number | null): string {
    if (ageSec == null) return 'never';
    if (ageSec < 60) return `${Math.round(ageSec)}s ago`;
    if (ageSec < 3600) return `${Math.round(ageSec / 60)}m ago`;
    return `${Math.round(ageSec / 3600)}h ago`;
}

/**
 * Fleet health tiers, carried from web-mojo RunnerDetailsView: the backend's
 * own `alive` flag first (heartbeat within 3× the interval), then a slow
 * (≥30s) / stale (≥120s) split so a fading runner reads as a warning before
 * Redis expires its key.
 */
export function runnerHealth(runner: Pick<RunnerHeartbeat, 'alive' | 'last_heartbeat'>, now = Date.now()): RunnerHealth {
    if (!runner.alive) return { key: 'down', label: 'Down', tone: 'danger' };
    const ageSec = heartbeatAgeSeconds(runner.last_heartbeat, now);
    if (ageSec == null) return { key: 'stale', label: 'No heartbeat', tone: 'warning' };
    if (ageSec >= 120) return { key: 'stale', label: 'Stale heartbeat', tone: 'warning' };
    if (ageSec >= 30) return { key: 'stale', label: 'Slow heartbeat', tone: 'warning' };
    return { key: 'healthy', label: 'Healthy', tone: 'success' };
}

export function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

export function formatUptimeShort(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    if (d > 0) return `${d}d`;
    if (h > 0) return `${h}h`;
    return `${Math.floor((seconds % 3600) / 60)}m`;
}

/** Seconds since the runner's ISO `started`, or null when it is unknown. */
export function runnerUptimeSeconds(runner: Pick<RunnerHeartbeat, 'started'>, now = Date.now()): number | null {
    if (!runner.started) return null;
    const parsed = Date.parse(runner.started);
    if (!Number.isFinite(parsed)) return null;
    const seconds = (now - parsed) / 1000;
    return seconds >= 0 ? seconds : null;
}

/** `failed / processed` as a percentage; null when nothing has been processed. */
export function runnerFailureRate(runner: Pick<RunnerHeartbeat, 'jobs_processed' | 'jobs_failed'>): number | null {
    const processed = runner.jobs_processed || 0;
    if (processed <= 0) return null;
    return ((runner.jobs_failed || 0) / processed) * 100;
}

export type ChannelSeverity = 'healthy' | 'warning' | 'critical';

/**
 * Backlog thresholds carried verbatim from web-mojo JobHealthView: >50 queued
 * plus in-flight warns, >100 is critical — and ZERO alive runners is critical
 * regardless of depth, because nothing will drain it.
 */
export function channelSeverity(state: Pick<JobChannelState, 'queued_count' | 'inflight_count' | 'runners'>): ChannelSeverity {
    const backlog = (state.queued_count || 0) + (state.inflight_count || 0);
    if (backlog > 100 || state.runners === 0) return 'critical';
    if (backlog > 50) return 'warning';
    return 'healthy';
}

export function channelSeverityTone(severity: ChannelSeverity): Tone {
    return severity === 'critical' ? 'danger' : severity === 'warning' ? 'warning' : 'success';
}

/** Mon=0 weekday ints → "Mon · Wed · Fri", or "Every day" when empty. */
export function formatRunDays(days: readonly number[]): string {
    if (!days.length) return 'Every day';
    return [...days]
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        .sort((a, b) => a - b)
        .map((day) => WEEKDAY_LABELS[day])
        .join(' · ') || 'Every day';
}

export function formatRunTimes(times: readonly string[]): string {
    return times.length ? times.join(' · ') : 'No times set';
}
