// Admin jobs — TanStack query hooks over the control plane and the job model
// endpoints.
//
// EVERY hook is `enabled`-gated on the matching `useCan`. A viewer-only
// operator must issue zero denied requests: a permission-disabled query never
// fires at all, rather than firing and catching a 403. `useCan` is fail-closed
// while `me` loads, so the first render of an admin page never races a gate.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mojoList, useCan, type Params } from '../../client';
import {
    fetchChannels,
    fetchJobStats,
    fetchJobsConfig,
    fetchQueueSizes,
    fetchRunnerSysinfo,
    fetchRunners,
} from './control';
import {
    JOBS_MANAGE_PERMS,
    JOBS_VIEW_PERMS,
    JobEventModel,
    JobLogModel,
    JobModel,
    type JobLogRow,
    type JobRow,
    type JobTimelineEntry,
} from './models';

/** One root (`['jobs']`) so a mutation can invalidate the whole domain. */
export const jobsKeys = {
    root: ['jobs'] as const,
    stats: () => ['jobs', 'stats'] as const,
    runners: (channel?: string) => ['jobs', 'runners', channel ?? null] as const,
    channels: () => ['jobs', 'channels'] as const,
    queueSizes: () => ['jobs', 'queue-sizes'] as const,
    config: () => ['jobs', 'config'] as const,
    sysinfo: (runnerId: string) => ['jobs', 'sysinfo', runnerId] as const,
    timeline: (jobId: string) => [JobEventModel.endpoint, 'timeline', jobId] as const,
    jobLogs: (jobId: string) => [JobLogModel.endpoint, 'job', jobId] as const,
    runnerLogs: (runnerId: string) => [JobLogModel.endpoint, 'runner', runnerId] as const,
};

/** Dashboard tick. Fast enough to be an alerting signal, slow enough to be free. */
const DASHBOARD_INTERVAL_MS = 60_000;

/**
 * `GET /api/jobs/stats` — the dashboard's single source of truth. It replaces
 * `/api/jobs/health`, which raises a KeyError server-side and is never called.
 */
export function useJobStats() {
    const { can } = useCan(JOBS_VIEW_PERMS);
    return useQuery({
        queryKey: jobsKeys.stats(),
        queryFn: fetchJobStats,
        enabled: can,
        refetchInterval: DASHBOARD_INTERVAL_MS,
    });
}

/**
 * `GET /api/jobs/runners` — the COMPLETE fleet list. The endpoint has no
 * paging/sort/search contract, so callers sort and filter client-side.
 */
export function useRunners(channel?: string) {
    const { can } = useCan(JOBS_VIEW_PERMS);
    return useQuery({
        queryKey: jobsKeys.runners(channel),
        queryFn: () => fetchRunners(channel),
        enabled: can,
        refetchInterval: DASHBOARD_INTERVAL_MS,
    });
}

/** `GET /api/jobs/control/channels` — channels discovered from Redis streams. */
export function useDiscoveredChannels() {
    const { can } = useCan(JOBS_VIEW_PERMS);
    return useQuery({
        queryKey: jobsKeys.channels(),
        queryFn: fetchChannels,
        enabled: can,
    });
}

export interface ChannelOptions {
    /** Deduped, sorted channel names. Empty means nothing is configured. */
    channels: string[];
    options: { value: string; label: string }[];
    isPending: boolean;
    /** True once both sources answered and neither offered a channel. */
    isEmpty: boolean;
}

/**
 * The union of the two channel sources, because neither is complete on its own:
 * `stats.channels` is keyed by `settings.JOBS_CHANNELS` (declared but maybe
 * never used), while `control/channels` scans Redis for streams that actually
 * exist (including ones nobody declared). An operation targeting a channel
 * should be offered for either.
 */
export function useChannelOptions(): ChannelOptions {
    const stats = useJobStats();
    const discovered = useDiscoveredChannels();
    const channels = useMemo(() => {
        const names = new Set<string>();
        for (const name of Object.keys(stats.data?.channels ?? {})) if (name) names.add(name);
        for (const name of discovered.data ?? []) if (name) names.add(name);
        return [...names].sort((a, b) => a.localeCompare(b));
    }, [stats.data, discovered.data]);
    const isPending = stats.isPending || discovered.isPending;
    return {
        channels,
        options: channels.map((value) => ({ value, label: value })),
        isPending,
        isEmpty: !isPending && channels.length === 0,
    };
}

/** `GET /api/jobs/control/queue-sizes` — Redis + DB counts per channel. */
export function useQueueSizes() {
    const { can } = useCan(JOBS_VIEW_PERMS);
    return useQuery({
        queryKey: jobsKeys.queueSizes(),
        queryFn: fetchQueueSizes,
        enabled: can,
    });
}

/**
 * `GET /api/jobs/control/config` — MANAGE-gated, unlike every other read in
 * this domain. A view-only operator never issues this request.
 */
export function useJobsConfig() {
    const { can } = useCan(JOBS_MANAGE_PERMS);
    return useQuery({
        queryKey: jobsKeys.config(),
        queryFn: fetchJobsConfig,
        enabled: can,
    });
}

/**
 * `GET /api/jobs/runners/sysinfo/<id>` — a redis broadcast-execute that blocks
 * the request thread for up to `timeout` seconds waiting for the runner to
 * answer. NEVER polled: it fetches once when the caller enables it, and again
 * only on an explicit refetch. Results stay fresh indefinitely so switching
 * sections does not re-broadcast.
 */
export function useRunnerSysinfo(runnerId: string | null, opts: { enabled?: boolean; timeout?: number } = {}) {
    const { can } = useCan(JOBS_VIEW_PERMS);
    return useQuery({
        queryKey: jobsKeys.sysinfo(runnerId ?? ''),
        queryFn: () => fetchRunnerSysinfo(runnerId!, opts.timeout ?? 5),
        enabled: can && runnerId != null && opts.enabled !== false,
        refetchInterval: false,
        refetchOnMount: false,
        staleTime: Infinity,
        // A runner that never answers is a 404 envelope; each retry costs
        // another full timeout window on the server.
        retry: false,
    });
}

const TIMELINE_SIZE = 200;

/**
 * `GET /api/jobs/event?job=<id>&graph=timeline` — the lifecycle trail.
 *
 * Job carries NO `recent_events` in any graph (only inside the `get_status`
 * action payload), so this endpoint IS the timeline. `job` is the relation
 * name; `job_id` would be silently dropped by `build_rest_filters` and return
 * every event in the system. Sorted ASCENDING because a lifecycle reads
 * forward, against the model's own `-at` default.
 */
export function useJobTimeline(jobId: string | null) {
    const { can } = useCan(JOBS_VIEW_PERMS);
    return useQuery({
        queryKey: jobsKeys.timeline(jobId ?? ''),
        queryFn: () => mojoList<JobTimelineEntry>(JobEventModel.endpoint, {
            job: jobId!,
            graph: 'timeline',
            sort: 'at',
            size: TIMELINE_SIZE,
        }),
        enabled: can && jobId != null,
    });
}

const LOG_SIZE = 200;

/**
 * `GET /api/jobs/logs?job=<id>` — one job's log lines, newest first.
 * `job=` (the relation) is the ONLY filter that works; `job_id=` is dropped.
 */
export function useJobLogs(jobId: string | null) {
    const { can } = useCan(JOBS_VIEW_PERMS);
    return useQuery({
        queryKey: jobsKeys.jobLogs(jobId ?? ''),
        queryFn: () => mojoList<JobLogRow>(JobLogModel.endpoint, {
            job: jobId!,
            sort: '-created',
            size: LOG_SIZE,
        }),
        enabled: can && jobId != null,
    });
}

/** How many of a runner's recent jobs feed the two-step log lookup. */
const RUNNER_LOG_JOB_WINDOW = 25;

/**
 * A runner's recent log lines, in TWO steps — because JobLog has no
 * `runner_id` field at all, and `build_rest_filters` silently drops unknown
 * keys, so `?runner_id=` returns the whole unfiltered log table (web-mojo
 * shipped exactly that and presented it as this runner's logs).
 *
 *   1. the runner's most recent jobs → `/api/jobs/job?runner_id=&sort=-created`
 *   2. their log lines            → `/api/jobs/logs?job__in=<ids>`
 *
 * No jobs means no logs, and the query resolves empty without a second call.
 */
export function useRunnerJobLogs(runnerId: string | null) {
    const { can } = useCan(JOBS_VIEW_PERMS);
    return useQuery({
        queryKey: jobsKeys.runnerLogs(runnerId ?? ''),
        queryFn: async () => {
            const jobParams: Params = {
                runner_id: runnerId!,
                sort: '-created',
                size: RUNNER_LOG_JOB_WINDOW,
            };
            const jobs = await mojoList<JobRow>(JobModel.endpoint, jobParams);
            const ids = jobs.rows.map((row) => row.id).filter(Boolean);
            if (ids.length === 0) return { rows: [] as JobLogRow[], count: 0, start: 0, size: 0 };
            return mojoList<JobLogRow>(JobLogModel.endpoint, {
                job__in: ids.join(','),
                sort: '-created',
                size: LOG_SIZE,
            });
        },
        enabled: can && runnerId != null,
    });
}
