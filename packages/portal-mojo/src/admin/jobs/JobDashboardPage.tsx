// JobDashboardPage — the jobs engine at a glance. Port of web-mojo
// JobDashboardPage.js, reading top to bottom the way an operator triages:
// is the fleet alive → which channel is backed up → what is the throughput →
// what can I do about it.
//
// EVERY number comes from `GET /api/jobs/stats`. `GET /api/jobs/health` raises
// server-side (get_channel_health reads a key get_queue_state stopped
// returning), and web-mojo's JobHealthView — the only consumer — was never
// mounted. Stats already carries channels, runners, totals and the scheduler.
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { KPITile } from '../../charts';
import { JobChannelsPanel } from './sections/JobChannelsPanel';
import { JobOperationsSection } from './sections/JobOperationsSection';
import { JobRunnersStrip } from './sections/JobRunnersStrip';
import { JobThroughputSection } from './sections/JobThroughputSection';
import { jobsKeys, useChannelOptions, useJobStats } from './queries';

export function JobDashboardPage() {
    const queryClient = useQueryClient();
    const stats = useJobStats();
    const channelOptions = useChannelOptions();
    const navigate = useNavigate();
    const location = useLocation();

    const totals = stats.data?.totals;
    const refreshAll = () => { void queryClient.invalidateQueries({ queryKey: jobsKeys.root }); };

    /**
     * Open the jobs table already filtered to a channel. The path is derived
     * from the CURRENT location rather than hardcoded, because an admin
     * section never knows whether it is mounted at the root or under /system.
     */
    const openChannel = (channel: string) => {
        const base = location.pathname.replace(/\/+$/, '');
        navigate({ pathname: `${base}/list`, search: `?channel=${encodeURIComponent(channel)}` });
    };

    const loading = stats.isPending;
    const tile = (label: string, value: number | undefined, severity: 'critical' | 'warn' | 'info' | 'good' | null, hint?: string) => (
        <KPITile
            label={label}
            value={value ?? null}
            severity={severity}
            hint={hint}
            loading={loading}
            formatter={(v) => v.toLocaleString()}
        />
    );

    return (
        <div className="jobs-dashboard">
            <header className="jobs-page-head">
                <div>
                    <div className="eyebrow">Jobs</div>
                    <h1>Job engine</h1>
                    <p>Runner fleet, queue depth and the operations that unstick them.</p>
                </div>
                <button
                    type="button"
                    className="btn btn-compact"
                    disabled={stats.isFetching}
                    onClick={refreshAll}
                >
                    <i className={`bi bi-arrow-clockwise${stats.isFetching ? ' spin' : ''}`} /> Refresh
                </button>
            </header>

            {stats.isError && (
                <div className="panel jobs-note jobs-note-bad">
                    <i className="bi bi-exclamation-triangle" />
                    {stats.error instanceof Error ? stats.error.message : 'Could not load job statistics.'}
                    <button type="button" className="btn btn-compact" onClick={() => void stats.refetch()}>Retry</button>
                </div>
            )}

            <JobRunnersStrip />

            <div className="jobs-kpi-strip">
                {tile('Queued', totals?.queued, (totals?.queued ?? 0) > 100 ? 'critical' : (totals?.queued ?? 0) > 50 ? 'warn' : null)}
                {tile('In flight', totals?.inflight, null)}
                {/* Running splits active from stale: a "running" job whose
                    runner is no longer alive is not running at all. */}
                {tile(
                    'Running',
                    totals?.running,
                    (totals?.running_stale ?? 0) > 0 ? 'warn' : null,
                    totals ? `${totals.running_active} active · ${totals.running_stale} stale` : undefined,
                )}
                {tile('Scheduled', totals?.scheduled, null)}
                {tile('Completed', totals?.completed, 'good')}
                {tile('Failed', totals?.failed, (totals?.failed ?? 0) > 0 ? 'critical' : null)}
            </div>

            <JobChannelsPanel
                stats={stats.data}
                isPending={stats.isPending}
                onSelectChannel={openChannel}
                onSchedulerChanged={refreshAll}
            />

            <JobThroughputSection channels={channelOptions.channels} />

            <JobOperationsSection
                channels={channelOptions.channels}
                channelsPending={channelOptions.isPending}
                onChanged={refreshAll}
            />
        </div>
    );
}
