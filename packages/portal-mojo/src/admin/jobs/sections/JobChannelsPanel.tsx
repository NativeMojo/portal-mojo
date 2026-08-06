// JobChannelsPanel — per-channel depth and health, plus the scheduler card.
// Rebuilt from web-mojo JobHealthView.js's channel logic, which is the one
// part of that view worth keeping: its severity thresholds. The view itself is
// not ported — it read `/api/jobs/health`, which raises server-side.
import { ArmedButton, Badge, fmt, toast } from '../../../ui';
import { useCan } from '../../../client';
import { forceSchedulerLead } from '../control';
import {
    JOBS_MANAGE_PERMS,
    channelSeverity,
    channelSeverityTone,
    type JobChannelState,
    type JobsStats,
} from '../models';

const SEVERITY_LABEL = { healthy: 'Healthy', warning: 'Backlog', critical: 'Critical' } as const;

export function JobChannelsPanel({ stats, isPending, onSelectChannel, onSchedulerChanged }: {
    stats: JobsStats | undefined;
    isPending: boolean;
    /** Row action — open the jobs table already filtered to this channel. */
    onSelectChannel?: (channel: string) => void;
    onSchedulerChanged?: () => void;
}) {
    const { can: canManage } = useCan(JOBS_MANAGE_PERMS);
    const channels: [string, JobChannelState][] = Object.entries(stats?.channels ?? {});
    const scheduler = stats?.scheduler;

    const releaseLock = async () => {
        try {
            const result = await forceSchedulerLead();
            toast.success(result.previous_holder
                ? `Scheduler lock released (was held by ${result.previous_holder})`
                : result.message);
            onSchedulerChanged?.();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not release the scheduler lock');
        }
    };

    return (
        <div className="jobs-channels-grid">
            <div className="panel jobs-channels-panel">
                <div className="toolbar">
                    <div className="toolbar-heading">
                        <div className="eyebrow">Queues</div>
                        <h2 className="panel-title">Channels</h2>
                    </div>
                </div>
                <div className="tbl-scroll">
                    <table className="tbl">
                        <thead>
                            <tr>
                                <th>Channel</th>
                                <th>Queued</th>
                                <th>In flight</th>
                                <th>Scheduled</th>
                                <th>DB running</th>
                                <th>Runners</th>
                                <th>State</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isPending && <tr><td colSpan={7}><div className="empty-state"><p>Loading channels…</p></div></td></tr>}
                            {!isPending && channels.length === 0 && (
                                <tr><td colSpan={7}>
                                    <div className="empty-state">
                                        <i className="bi bi-broadcast" />
                                        <h3>No channels configured</h3>
                                        <p>Nothing is declared in <code>JOBS_CHANNELS</code> and no stream has been registered.</p>
                                    </div>
                                </td></tr>
                            )}
                            {channels.map(([name, state]) => {
                                const severity = channelSeverity(state);
                                const tone = channelSeverityTone(severity);
                                return (
                                    <tr
                                        key={name}
                                        className={onSelectChannel ? 'row-click' : undefined}
                                        onClick={onSelectChannel ? () => onSelectChannel(name) : undefined}
                                    >
                                        <td><code>{name}</code></td>
                                        <td>{fmt.number(state.queued_count)}</td>
                                        <td>{fmt.number(state.inflight_count)}</td>
                                        <td>{fmt.number(state.scheduled_count)}</td>
                                        <td>{fmt.number(state.db_running)}</td>
                                        <td>
                                            {state.runners === 0
                                                ? <span className="jobs-text-danger">0</span>
                                                : fmt.number(state.runners)}
                                        </td>
                                        <td>
                                            <Badge tone={tone}>{SEVERITY_LABEL[severity]}</Badge>
                                            {state.runners === 0 && (
                                                <div className="dim jobs-channel-note">No alive runner will drain this channel.</div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="panel jobs-scheduler-card">
                <div className="toolbar">
                    <div className="toolbar-heading">
                        <div className="eyebrow">Dispatcher</div>
                        <h2 className="panel-title">Scheduler</h2>
                    </div>
                </div>
                <div className="jobs-scheduler-body">
                    <div className="jobs-scheduler-state">
                        <span className={`jobs-dot jobs-dot-${scheduler?.active ? 'success' : 'danger'}`} />
                        <strong>{isPending ? 'Loading…' : scheduler?.active ? 'Running' : 'Stopped'}</strong>
                    </div>
                    <div className="dim">
                        {scheduler?.lock_holder
                            ? <>Lock held by <code>{scheduler.lock_holder}</code></>
                            : 'No scheduler lock is held. Delayed and scheduled jobs will not be dispatched.'}
                    </div>
                    {/* Releasing the lock while a healthy leader holds it can
                        let two schedulers dispatch the same due jobs, so it is
                        armed even though it looks like a small button. */}
                    <ArmedButton
                        className="btn-compact"
                        icon="bi-key"
                        label="Force scheduler lead"
                        armedLabel="Click again to release the lock"
                        disabled={!canManage}
                        onConfirm={releaseLock}
                    />
                    <p className="dim jobs-scheduler-hint">
                        Deletes the Redis lock so another process can take leadership. Only safe when the current leader is stuck.
                    </p>
                </div>
            </div>
        </div>
    );
}
