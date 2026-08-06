// Admin jobs — the control plane. One typed function per django-mojo route
// (`mojo/apps/jobs/rest/jobs.py` + `rest/control.py`), each documenting the
// exact request params and response shape it speaks.
//
// Three wire facts shape this whole module:
//
//   1. RESULT KEYS ARE NOT UNIFORM. Some handlers nest under `data`
//      (clear-stuck, purge, clear-queue, cleanup-consumers, queue-sizes,
//      channels, config, stats), others answer with TOP-LEVEL fields
//      (ping, broadcast, reset-failed, force-scheduler-lead, control/test).
//      `mojoCall` returns the unwrapped envelope, so each function reads from
//      whichever level its endpoint actually uses — never a `data ?? body`
//      heuristic.
//   2. SOME OPERATIONS HAVE NO ALL-CHANNEL FORM. `clear-stuck` and
//      `manual-reclaim` are `@requires_params('channel')`; sending
//      `channel: null` (as web-mojo did) is an instant HTTP 400. "All
//      channels" is a CLIENT fan-out — see `forEachChannel`.
//   3. `GET /api/jobs/health` AND `health/<channel>` ARE DEAD.
//      `JobManager.get_channel_health` reads `state['stream_length']` and
//      `state['pending_count']`, which the Plan-B `get_queue_state` no longer
//      returns → KeyError → HTTP 400 `{status:false,error:"'stream_length'"}`.
//      Nothing here calls them; every dashboard number comes from
//      `GET /api/jobs/stats`, which uses `.get()` fallbacks throughout.
//
// `POST /api/jobs/publish` does not exist either — web-mojo's `Job.publish`
// was dead code. Republishing happens through the `retry_request` action.
import { mojoCall } from '../../client';
import type {
    JobQueueSize,
    JobsConfig,
    JobsStats,
    RunnerRow,
    RunnerSysinfo,
} from './models';

const JOBS_API = '/api/jobs';

// ── Reads ─────────────────────────────────────────────────────────────

/**
 * `GET /api/jobs/stats` → `{status, data: JobsStats}`.
 * Gate: `view_jobs | manage_jobs | jobs`. The dashboard's single source.
 */
export async function fetchJobStats(): Promise<JobsStats> {
    const body = await mojoCall(`${JOBS_API}/stats`);
    return body.data as JobsStats;
}

/**
 * `GET /api/jobs/runners` → `{status, count, data: RunnerRow[]}`.
 *
 * NOT a paged model endpoint: `on_list_runners` reads exactly one param
 * (`channel`) and returns the COMPLETE list, ignoring `start`/`size`/`sort`/
 * `search`. Rows are heartbeats with `id = runner_id` stamped on, sorted by
 * runner_id. Any paging or ordering is therefore a client concern.
 */
export async function fetchRunners(channel?: string): Promise<RunnerRow[]> {
    const body = await mojoCall(`${JOBS_API}/runners`, {
        params: channel ? { channel } : {},
    });
    return (body.data ?? []) as RunnerRow[];
}

/**
 * `GET /api/jobs/runners/sysinfo?timeout=` → `{status, count, data: RunnerSysinfo[]}`.
 * A redis broadcast-execute that BLOCKS for up to `timeout` seconds — on
 * demand only, never polled.
 */
export async function fetchAllRunnerSysinfo(timeout = 5): Promise<RunnerSysinfo[]> {
    const body = await mojoCall(`${JOBS_API}/runners/sysinfo`, { params: { timeout } });
    return (body.data ?? []) as RunnerSysinfo[];
}

/**
 * `GET /api/jobs/runners/sysinfo/<runner_id>?timeout=` → `{status, data: RunnerSysinfo}`.
 *
 * A runner that never answers is an HTTP 404 envelope (`"Runner … did not
 * respond"`) and REJECTS here. A runner that answers with an internal failure
 * resolves with `status: 'error'` inside the payload — a different state, and
 * the caller must render it as such.
 */
export async function fetchRunnerSysinfo(runnerId: string, timeout = 5): Promise<RunnerSysinfo> {
    const body = await mojoCall(`${JOBS_API}/runners/sysinfo/${encodeURIComponent(runnerId)}`, {
        params: { timeout },
    });
    return body.data as RunnerSysinfo;
}

/**
 * `GET /api/jobs/control/channels` → `{status, data: string[]}`.
 * Channels DISCOVERED by scanning Redis for registered streams — a channel
 * declared in settings but never published to will not appear here.
 */
export async function fetchChannels(): Promise<string[]> {
    const body = await mojoCall(`${JOBS_API}/control/channels`);
    return (body.data ?? []) as string[];
}

/**
 * `GET /api/jobs/control/queue-sizes` → `{status, data: {<channel>: JobQueueSize}}`.
 * Redis stream/scheduled counts plus the per-status DB tallies.
 */
export async function fetchQueueSizes(): Promise<Record<string, JobQueueSize>> {
    const body = await mojoCall(`${JOBS_API}/control/queue-sizes`);
    return (body.data ?? {}) as Record<string, JobQueueSize>;
}

/**
 * `GET /api/jobs/control/config` → `{status, data: JobsConfig}`.
 * MANAGE-gated (`manage_jobs | jobs`) — unlike every other read here, a
 * view-only operator gets a 403.
 */
export async function fetchJobsConfig(): Promise<JobsConfig> {
    const body = await mojoCall(`${JOBS_API}/control/config`);
    return body.data as JobsConfig;
}

// ── Runner control ────────────────────────────────────────────────────

export interface PingResult {
    runner_id: string;
    /** False = the runner did not answer within `timeout`. Not an error. */
    responsive: boolean;
}

/**
 * `POST /api/jobs/runners/ping` `{runner_id, timeout}` → TOP-LEVEL
 * `{status, runner_id, responsive}`.
 */
export async function pingRunner(runnerId: string, timeout = 2): Promise<PingResult> {
    const body = await mojoCall(`${JOBS_API}/runners/ping`, {
        method: 'POST',
        body: { runner_id: runnerId, timeout },
    }) as { runner_id?: string; responsive?: boolean };
    return { runner_id: body.runner_id ?? runnerId, responsive: Boolean(body.responsive) };
}

/**
 * `POST /api/jobs/runners/shutdown` `{runner_id, graceful}` → `{status, message}`.
 * Fire-and-forget: the command is pushed onto the runner's control channel and
 * the response says nothing about whether the runner obeyed.
 */
export async function shutdownRunner(runnerId: string, graceful = true): Promise<string> {
    const body = await mojoCall(`${JOBS_API}/runners/shutdown`, {
        method: 'POST',
        body: { runner_id: runnerId, graceful },
    });
    return body.message ?? `Shutdown command sent to runner ${runnerId}`;
}

/** The only commands `on_broadcast_command` accepts; anything else is a 400. */
export const BROADCAST_COMMANDS = ['status', 'shutdown', 'pause', 'resume', 'reload'] as const;
export type BroadcastCommand = (typeof BROADCAST_COMMANDS)[number];

export interface BroadcastResult {
    command: string;
    responses_count: number;
    responses: unknown[];
}

/**
 * `POST /api/jobs/runners/broadcast` `{command, data, timeout}` → TOP-LEVEL
 * `{status, command, responses_count, responses}`. Hits EVERY runner.
 */
export async function broadcastCommand(
    command: BroadcastCommand,
    opts: { data?: Record<string, unknown>; timeout?: number } = {},
): Promise<BroadcastResult> {
    const body = await mojoCall(`${JOBS_API}/runners/broadcast`, {
        method: 'POST',
        body: { command, data: opts.data ?? {}, timeout: opts.timeout ?? 2 },
    }) as { command?: string; responses_count?: number; responses?: unknown[] };
    return {
        command: body.command ?? command,
        responses_count: body.responses_count ?? 0,
        responses: body.responses ?? [],
    };
}

// ── Queue control ─────────────────────────────────────────────────────

export interface ClearStuckResult {
    channel: string;
    /** How many in-flight entries were moved back onto the queue. */
    cleared: number;
    details: { job_id?: string; requeued?: boolean }[];
    errors: string[];
    message?: string;
}

/**
 * `POST /api/jobs/control/clear-stuck` `{channel, idle_threshold_ms}` →
 * `{status, message, data: ClearStuckResult}`.
 *
 * `channel` is REQUIRED (`@requires_params`). The result key is `cleared` —
 * web-mojo read `data.count`, which never existed and always rendered 0.
 */
export async function clearStuck(channel: string, idleThresholdMs = 60000): Promise<ClearStuckResult> {
    const body = await mojoCall(`${JOBS_API}/control/clear-stuck`, {
        method: 'POST',
        body: { channel, idle_threshold_ms: idleThresholdMs },
    });
    return body.data as ClearStuckResult;
}

/**
 * `POST /api/jobs/control/manual-reclaim` `{channel}` →
 * `{status, message, data: ClearStuckResult}`.
 *
 * The same handler as clear-stuck with `idle_threshold_ms: 0` — it reclaims
 * EVERY in-flight entry, not only the idle ones. `channel` is required.
 */
export async function manualReclaim(channel: string): Promise<ClearStuckResult> {
    const body = await mojoCall(`${JOBS_API}/control/manual-reclaim`, {
        method: 'POST',
        body: { channel },
    });
    return body.data as ClearStuckResult;
}

export interface PurgeDryRunResult {
    dry_run: true;
    /** Rows that WOULD be deleted. Only a dry run reports `count`. */
    count: number;
    cutoff: string;
    status_filter: string | null;
}

export interface PurgeRunResult {
    dry_run?: false;
    /** Rows actually deleted (jobs + cascaded events/logs). */
    deleted: number;
    details: Record<string, number>;
    cutoff: string;
    status_filter: string | null;
}

export type PurgeResult = PurgeDryRunResult | PurgeRunResult;

export function isPurgeDryRun(result: PurgeResult): result is PurgeDryRunResult {
    return result.dry_run === true;
}

/**
 * `POST /api/jobs/control/purge` `{days_old, status?, dry_run?}` →
 * `{status, data: PurgeResult}`.
 *
 * `days_old` is REQUIRED. The two runs report DIFFERENT keys: a dry run
 * answers `{dry_run: true, count, …}` and a real run answers
 * `{deleted, details, …}`. Reading `count` off a real run (web-mojo's bug)
 * always shows 0 deletions after a successful purge.
 */
export async function purgeJobs(opts: {
    daysOld: number;
    status?: string | null;
    dryRun?: boolean;
}): Promise<PurgeResult> {
    const body = await mojoCall(`${JOBS_API}/control/purge`, {
        method: 'POST',
        body: {
            days_old: opts.daysOld,
            ...(opts.status ? { status: opts.status } : {}),
            ...(opts.dryRun ? { dry_run: true } : {}),
        },
    });
    return body.data as PurgeResult;
}

export interface ResetFailedResult {
    reset_count: number;
    requeue: { status: boolean; requeued?: number; channel?: string; error?: string }[];
    message?: string;
}

/**
 * `POST /api/jobs/control/reset-failed` `{channel?, since?, limit?}` →
 * TOP-LEVEL `{status, message, reset_count, requeue[]}`.
 *
 * Unlike clear-stuck this one DOES have an all-channel form: omitting
 * `channel` resets across every channel that has failures. `since` is an ISO
 * datetime string (`datetime.fromisoformat`), not an epoch.
 */
export async function resetFailed(opts: {
    channel?: string | null;
    since?: string | null;
    limit?: number;
} = {}): Promise<ResetFailedResult> {
    const body = await mojoCall(`${JOBS_API}/control/reset-failed`, {
        method: 'POST',
        body: {
            ...(opts.channel ? { channel: opts.channel } : {}),
            ...(opts.since ? { since: opts.since } : {}),
            limit: opts.limit ?? 100,
        },
    }) as { reset_count?: number; requeue?: ResetFailedResult['requeue']; message?: string };
    return {
        reset_count: body.reset_count ?? 0,
        requeue: body.requeue ?? [],
        message: body.message,
    };
}

export interface ClearQueueResult {
    channel: string;
    deleted: Record<string, boolean>;
    db_pending_canceled: number;
    status: boolean;
    errors: string[];
}

/**
 * `POST /api/jobs/control/clear-queue` `{channel, confirm:"yes"}` →
 * `{status, message, data: ClearQueueResult}`.
 *
 * DESTRUCTIVE: it deletes the channel's Redis keys and marks every DB-pending
 * job `canceled`. Both `channel` and `confirm === "yes"` are enforced
 * server-side; the confirm token is injected here only at the call site, i.e.
 * only AFTER the caller's armed confirmation has fired.
 */
export async function clearQueue(channel: string): Promise<ClearQueueResult> {
    const body = await mojoCall(`${JOBS_API}/control/clear-queue`, {
        method: 'POST',
        body: { channel, confirm: 'yes' },
    });
    return body.data as ClearQueueResult;
}

export interface CleanupConsumersResult {
    status?: boolean;
    errors?: string[];
    [key: string]: unknown;
}

/**
 * `POST /api/jobs/control/cleanup-consumers` `{channel?, destroy_empty_groups?}`
 * → `{status, data}`. Omitting `channel` cleans every channel.
 */
export async function cleanupConsumers(opts: {
    channel?: string | null;
    destroyEmptyGroups?: boolean;
} = {}): Promise<CleanupConsumersResult> {
    const body = await mojoCall(`${JOBS_API}/control/cleanup-consumers`, {
        method: 'POST',
        body: {
            ...(opts.channel ? { channel: opts.channel } : {}),
            destroy_empty_groups: opts.destroyEmptyGroups ?? true,
        },
    });
    return (body.data ?? {}) as CleanupConsumersResult;
}

export interface RebuildScheduledResult {
    status?: boolean;
    errors?: string[];
    [key: string]: unknown;
}

/**
 * `POST /api/jobs/control/rebuild-scheduled` `{channel?, limit?}` →
 * `{status, data}`. Rebuilds the Redis scheduled ZSETs from DB truth.
 */
export async function rebuildScheduled(opts: {
    channel?: string | null;
    limit?: number | null;
} = {}): Promise<RebuildScheduledResult> {
    const body = await mojoCall(`${JOBS_API}/control/rebuild-scheduled`, {
        method: 'POST',
        body: {
            ...(opts.channel ? { channel: opts.channel } : {}),
            ...(opts.limit != null ? { limit: opts.limit } : {}),
        },
    });
    return (body.data ?? {}) as RebuildScheduledResult;
}

export interface ForceSchedulerLeadResult {
    message: string;
    /** The lock value that was released, or null when no lock existed. */
    previous_holder: string | null;
}

/**
 * `POST /api/jobs/control/force-scheduler-lead` → TOP-LEVEL
 * `{status, message, previous_holder}`.
 *
 * Deletes the scheduler lock so another process can take leadership. Safe only
 * when the current leader is genuinely stuck — otherwise two schedulers can
 * briefly dispatch the same due jobs.
 */
export async function forceSchedulerLead(): Promise<ForceSchedulerLeadResult> {
    const body = await mojoCall(`${JOBS_API}/control/force-scheduler-lead`, {
        method: 'POST',
        body: {},
    }) as { message?: string; previous_holder?: string | null };
    return {
        message: body.message ?? 'Scheduler lock released',
        previous_holder: body.previous_holder ?? null,
    };
}

export interface TestJobResult {
    job_id: string;
    channel: string;
    delayed: boolean;
    message: string;
}

/**
 * `POST /api/jobs/control/test` `{channel?, delay?}` → TOP-LEVEL
 * `{status, message, job_id, channel, delayed}`.
 *
 * Publishes ONE sample job (`examples.sample_jobs.generate_report`) and hands
 * back its id, so the operator can follow it into the jobs table. This is the
 * parameterized superset of the older fixed `POST /api/jobs/test` smoke test,
 * which is deliberately not wired.
 */
export async function publishTestJob(opts: {
    channel?: string;
    delay?: number | null;
} = {}): Promise<TestJobResult> {
    const body = await mojoCall(`${JOBS_API}/control/test`, {
        method: 'POST',
        body: {
            channel: opts.channel ?? 'default',
            ...(opts.delay != null ? { delay: opts.delay } : {}),
        },
    }) as { job_id?: string; channel?: string; delayed?: boolean; message?: string };
    return {
        job_id: body.job_id ?? '',
        channel: body.channel ?? opts.channel ?? 'default',
        delayed: Boolean(body.delayed),
        message: body.message ?? 'Test job published',
    };
}

/**
 * `POST /api/jobs/tests` → `{status, message}`.
 *
 * Publishes a whole sample SUITE — one job per configured channel, ten delayed
 * jobs and fifty immediate ones. It returns no ids; the operator watches the
 * dashboard. Load-generating: it is offered behind an armed confirmation.
 */
export async function publishTestSuite(): Promise<string> {
    const body = await mojoCall(`${JOBS_API}/tests`, { method: 'POST', body: {} });
    return body.message ?? 'Test suite published';
}

// ── Client-side fan-out ───────────────────────────────────────────────

export interface ChannelOutcome<T> {
    channel: string;
    ok: boolean;
    value?: T;
    error?: string;
}

/**
 * Run a per-channel operation across many channels and report EVERY outcome.
 *
 * `clear-stuck` and `manual-reclaim` have no all-channel form on the backend,
 * so "All channels" is this: `Promise.allSettled` over the channel list, with
 * partial failures surfaced per channel. Never a blanket success — a fan-out
 * where three channels cleared and one 400'd must read as exactly that.
 */
export async function forEachChannel<T>(
    channels: readonly string[],
    run: (channel: string) => Promise<T>,
): Promise<ChannelOutcome<T>[]> {
    const settled = await Promise.allSettled(channels.map((channel) => run(channel)));
    return settled.map((outcome, index) => {
        const channel = channels[index]!;
        if (outcome.status === 'fulfilled') return { channel, ok: true, value: outcome.value };
        const reason = outcome.reason as unknown;
        return {
            channel,
            ok: false,
            error: reason instanceof Error ? reason.message : String(reason),
        };
    });
}

/** "3 of 4 channels cleared · email failed" — the fan-out's one-line readout. */
export function summarizeChannelOutcomes<T>(outcomes: readonly ChannelOutcome<T>[], verb: string): string {
    const ok = outcomes.filter((outcome) => outcome.ok);
    const failed = outcomes.filter((outcome) => !outcome.ok);
    if (failed.length === 0) return `${ok.length} of ${outcomes.length} channels ${verb}`;
    return `${ok.length} of ${outcomes.length} channels ${verb} · failed: ${failed.map((outcome) => outcome.channel).join(', ')}`;
}
