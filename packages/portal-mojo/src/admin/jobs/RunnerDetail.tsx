// RunnerDetail — the runner inspector, opened as a `modal.detail` from the
// fleet strip and the runners page. Port of web-mojo RunnerDetailsView.js
// (1181 lines), rebuilt on portal-mojo's DetailView + detail primitives.
//
// Carried from the source: the StatusPanel-led Overview with four KPIs
// (uptime / processed / failure rate / active jobs), the sysinfo flat-row
// groups with meters and error highlighting, the per-channel active counts,
// the active-jobs / history / logs tables, the control section, and the 15s
// live poll for everything EXCEPT sysinfo.
//
// NOT carried, because the backend cannot support them:
//   · Drain and Restart — the source's buttons only ever toasted "backend
//     integration pending"; there is no per-runner endpoint. An unsupported
//     operation stays ABSENT rather than shipping disabled.
//   · the `version` chip — the heartbeat payload has no version field.
//   · trusted-HTML interpolation throughout — every slot here is a ReactNode.
import { useState, type ReactNode } from 'react';
import {
    Badge,
    DetailView,
    Eyebrow,
    FlatRow,
    JsonBlock,
    KnownFieldsCard,
    StatusPanel,
    ArmedButton,
    fmt,
    modal,
    toast,
    type Tone,
} from '../../ui';
import { downloadBlob } from '../../client';
import {
    BROADCAST_COMMANDS,
    broadcastCommand,
    pingRunner,
    shutdownRunner,
    type BroadcastCommand,
} from './control';
import {
    JOBS_MANAGE_PERMS,
    formatHeartbeatAge,
    formatUptime,
    heartbeatAgeSeconds,
    jobStatusTone,
    runnerFailureRate,
    runnerHealth,
    runnerUptimeSeconds,
    type JobRow,
    type RunnerHostInfo,
    type RunnerRow,
} from './models';
import {
    useRunnerActiveJobs,
    useRunnerJobHistory,
    useRunnerJobLogs,
    useRunnerSysinfo,
} from './queries';
import { useCan } from '../../client';

// ── Small presentational pieces ───────────────────────────────────────

function Kpi({ label, value, tone }: { label: string; value: ReactNode; tone?: Tone | null }) {
    return (
        <div className={`jobs-kpi${tone ? ` jobs-kpi-${tone}` : ''}`}>
            <div className="jobs-kpi-label">{label}</div>
            <div className="jobs-kpi-value">{value}</div>
        </div>
    );
}

/** Utilization bar. Null percent renders an explicit unknown, never a blank. */
function Meter({ percent, caption }: { percent: number | null | undefined; caption?: ReactNode }) {
    const pct = typeof percent === 'number' && Number.isFinite(percent)
        ? Math.max(0, Math.min(100, percent))
        : null;
    const tone = pct == null ? 'muted' : pct >= 80 ? 'danger' : pct >= 60 ? 'warning' : 'success';
    return (
        <div className="jobs-meter">
            <div className="jobs-meter-head">
                <span className="dim">{caption}</span>
                <strong>{pct == null ? '—' : `${pct.toFixed(0)}%`}</strong>
            </div>
            <div className="jobs-meter-track" role="presentation">
                <div className={`jobs-meter-fill jobs-meter-${tone}`} style={{ width: `${pct ?? 0}%` }} />
            </div>
        </div>
    );
}

function JobIdCell({ job }: { job: JobRow }) {
    return (
        <>
            <code className="jobs-id">{fmt.truncateMiddle(job.id, 6)}</code>
            <div className="dim jobs-func">{job.func || '—'}</div>
        </>
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

// ── System section ────────────────────────────────────────────────────

function SystemSection({ runnerId }: { runnerId: string }) {
    // Enabled on first activation only — DetailView lazily mounts a section
    // and keeps it alive afterwards, so this fires exactly one broadcast.
    const query = useRunnerSysinfo(runnerId);
    const reply = query.data;
    const host: RunnerHostInfo | undefined = reply?.status === 'success' ? reply.result : undefined;
    const replyError = reply?.status === 'error' ? (reply.error || 'The runner reported an error collecting system info.') : null;
    const requestError = query.error instanceof Error ? query.error.message : query.error ? 'Could not load system info.' : null;

    return (
        <>
            <div className="jobs-section-head">
                <Eyebrow>{host?.datetime ? `Collected ${fmt.datetime(host.datetime)}` : 'System info'}</Eyebrow>
                <button
                    type="button"
                    className="btn btn-compact"
                    disabled={query.isFetching}
                    onClick={() => void query.refetch()}
                >
                    <i className={`bi bi-arrow-clockwise${query.isFetching ? ' spin' : ''}`} /> Refresh
                </button>
            </div>

            {query.isFetching && !reply && <p className="dim">Broadcasting to the runner…</p>}
            {/* Three DISTINCT failures, never one blank pane: the request
                failed (a runner that never answered 404s), the runner answered
                with an error (psutil missing, permissions), or nothing has been
                collected yet. */}
            {requestError && <p className="jobs-note jobs-note-bad"><i className="bi bi-exclamation-triangle" /> {requestError}</p>}
            {replyError && <p className="jobs-note jobs-note-warn"><i className="bi bi-exclamation-triangle" /> {replyError}</p>}
            {!query.isFetching && !reply && !requestError && <p className="dim">No system info collected yet.</p>}

            {host && (
                <>
                    <Eyebrow>Operating system</Eyebrow>
                    <FlatRow label="Hostname"><code>{host.os?.hostname ?? '—'}</code></FlatRow>
                    <FlatRow label="System">{host.os?.system ?? '—'}</FlatRow>
                    <FlatRow label="Release"><code>{host.os?.release ?? '—'}</code></FlatRow>
                    <FlatRow label="Machine"><code>{host.os?.machine ?? '—'}</code></FlatRow>
                    {host.boot_time != null && <FlatRow label="Boot time">{fmt.datetime(host.boot_time)}</FlatRow>}

                    <Eyebrow>CPU</Eyebrow>
                    <FlatRow label="Load"><Meter percent={host.cpu_load} caption={`${host.cpus_load?.length ?? host.cpu?.count ?? '—'} cores reporting`} /></FlatRow>
                    <FlatRow label="Cores">{host.cpu?.count ?? '—'}</FlatRow>
                    {host.cpu?.freq && (
                        <FlatRow label="Frequency">
                            {fmt.number(host.cpu.freq.current)} MHz current · {fmt.number(host.cpu.freq.max)} MHz max
                        </FlatRow>
                    )}

                    {host.memory && (
                        <>
                            <Eyebrow>Memory</Eyebrow>
                            <FlatRow label="Usage">
                                <Meter percent={host.memory.percent} caption={`${fmt.filesize(host.memory.used)} / ${fmt.filesize(host.memory.total)}`} />
                            </FlatRow>
                            <FlatRow label="Available"><code className="jobs-text-success">{fmt.filesize(host.memory.available)}</code></FlatRow>
                        </>
                    )}

                    {host.disk && (
                        <>
                            <Eyebrow>Disk (root)</Eyebrow>
                            <FlatRow label="Usage">
                                <Meter percent={host.disk.percent} caption={`${fmt.filesize(host.disk.used)} / ${fmt.filesize(host.disk.total)}`} />
                            </FlatRow>
                            <FlatRow label="Free"><code className="jobs-text-success">{fmt.filesize(host.disk.free)}</code></FlatRow>
                        </>
                    )}

                    {host.network && (
                        <>
                            <Eyebrow>Network</Eyebrow>
                            <FlatRow label="Bytes recv"><code>{fmt.filesize(host.network.bytes_recv)}</code></FlatRow>
                            <FlatRow label="Bytes sent"><code>{fmt.filesize(host.network.bytes_sent)}</code></FlatRow>
                            <FlatRow label="Packets in/out">
                                <code>{fmt.number(host.network.packets_recv)}</code> / <code>{fmt.number(host.network.packets_sent)}</code>
                            </FlatRow>
                            <FlatRow label="Errors in/out">
                                {/* Non-zero interface errors are the one number
                                    in this block worth shouting about. */}
                                <code className={(host.network.errin ?? 0) > 0 || (host.network.errout ?? 0) > 0 ? 'jobs-text-danger' : undefined}>
                                    {host.network.errin ?? 0}
                                </code>
                                {' / '}
                                <code className={(host.network.errin ?? 0) > 0 || (host.network.errout ?? 0) > 0 ? 'jobs-text-danger' : undefined}>
                                    {host.network.errout ?? 0}
                                </code>
                            </FlatRow>
                            <FlatRow label="TCP connections">{fmt.number(host.network.tcp_cons)}</FlatRow>
                        </>
                    )}

                    <Eyebrow>Raw sysinfo</Eyebrow>
                    <KnownFieldsCard data={host as unknown as Record<string, unknown>} known={[]} rawLabel="Raw sysinfo" />
                </>
            )}
        </>
    );
}

// ── Control section ───────────────────────────────────────────────────

function ControlSection({ runner, onClose }: { runner: RunnerRow; onClose: () => void }) {
    const { can: canManage } = useCan(JOBS_MANAGE_PERMS);
    const [ping, setPing] = useState<ReactNode>(null);
    const [pinging, setPinging] = useState(false);
    const [graceful, setGraceful] = useState(true);

    const runPing = async () => {
        setPinging(true);
        try {
            const result = await pingRunner(runner.runner_id);
            setPing(result.responsive
                ? <span className="jobs-text-success"><i className="bi bi-check-circle-fill" /> Runner is responsive</span>
                : <span className="jobs-text-warning"><i className="bi bi-exclamation-triangle-fill" /> No reply within the timeout</span>);
        } catch (error) {
            setPing(<span className="jobs-text-danger"><i className="bi bi-x-circle-fill" /> {error instanceof Error ? error.message : 'Ping failed'}</span>);
        } finally {
            setPinging(false);
        }
    };

    const runShutdown = async () => {
        try {
            const message = await shutdownRunner(runner.runner_id, graceful);
            toast.success(message);
            // Fire-and-forget on the wire: the response confirms the command
            // was sent, never that the runner obeyed. Close so the operator
            // re-reads the fleet rather than a stale row.
            onClose();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Shutdown failed');
        }
    };

    const openBroadcast = async () => {
        const picked = await modal.open<{ command: BroadcastCommand; timeout: number } | null>((close) => (
            <BroadcastForm onCancel={() => close(null)} onSubmit={(value) => close(value)} />
        ), { size: 'sm' });
        if (!picked) return;
        try {
            const result = await broadcastCommand(picked.command, { timeout: picked.timeout });
            void modal.open((close) => (
                <div className="modal-pad">
                    <h2 className="modal-title">Broadcast response — {result.command}</h2>
                    <p className="dim">{result.responses_count} runner(s) replied.</p>
                    <JsonBlock value={result.responses} label="Responses" defaultOpen />
                    <div className="modal-actions">
                        <button type="button" className="btn btn-primary" onClick={() => close(null)}>Close</button>
                    </div>
                </div>
            ), { size: 'lg' });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Broadcast failed');
        }
    };

    const exportSnapshot = () => {
        const snapshot = { runner, exported_at: new Date().toISOString() };
        downloadBlob(
            new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
            `runner-${runner.runner_id}-${Date.now()}.json`,
        );
        toast.success('Runner snapshot exported');
    };

    return (
        <>
            <Eyebrow>Operates on {runner.runner_id}</Eyebrow>
            <div className="jobs-op-row">
                <div className="jobs-op-label"><i className="bi bi-broadcast-pin" /> Ping</div>
                <div className="jobs-op-desc">
                    Ask the runner to answer on its control channel. Read-only.
                    {ping && <div className="jobs-op-result">{ping}</div>}
                </div>
                <div className="jobs-op-action">
                    <button type="button" className="btn btn-compact" disabled={!canManage || pinging} onClick={() => void runPing()}>
                        {pinging ? 'Pinging…' : 'Ping now'}
                    </button>
                </div>
            </div>

            <div className="jobs-op-row">
                <div className="jobs-op-label"><i className="bi bi-power" /> Shutdown</div>
                <div className="jobs-op-desc">
                    Sends a shutdown command. Fire-and-forget — the response confirms the command was queued, not that the runner exited.
                    <label className="jobs-op-toggle">
                        <input type="checkbox" checked={graceful} disabled={!canManage} onChange={(event) => setGraceful(event.target.checked)} />
                        <span>Graceful (finish the current job first)</span>
                    </label>
                </div>
                <div className="jobs-op-action">
                    <ArmedButton
                        className="btn-compact btn-danger-ghost"
                        label="Shutdown"
                        armedLabel={`Click again to shut down ${runner.runner_id}`}
                        icon="bi-power"
                        disabled={!canManage}
                        onConfirm={runShutdown}
                    />
                </div>
            </div>

            <div className="jobs-op-row">
                <div className="jobs-op-label"><i className="bi bi-megaphone" /> Broadcast</div>
                <div className="jobs-op-desc">
                    Sends a command to <strong>every</strong> runner, not just this one, and collects replies within the timeout.
                </div>
                <div className="jobs-op-action">
                    <button type="button" className="btn btn-compact" disabled={!canManage} onClick={() => void openBroadcast()}>
                        Broadcast…
                    </button>
                </div>
            </div>

            <div className="jobs-op-row">
                <div className="jobs-op-label"><i className="bi bi-download" /> Export</div>
                <div className="jobs-op-desc">Download this runner’s heartbeat record as JSON.</div>
                <div className="jobs-op-action">
                    <button type="button" className="btn btn-compact" onClick={exportSnapshot}>Export snapshot</button>
                </div>
            </div>

            {!canManage && (
                <p className="jobs-note jobs-note-info">
                    <i className="bi bi-info-circle" /> Runner control requires a global <code>manage_jobs</code> or <code>jobs</code> grant.
                </p>
            )}
        </>
    );
}

/**
 * The broadcast picker. `shutdown` is the one command that stops the whole
 * fleet, so it is armed separately from the plain submit.
 */
function BroadcastForm({ onCancel, onSubmit }: {
    onCancel: () => void;
    onSubmit: (value: { command: BroadcastCommand; timeout: number }) => void;
}) {
    const [command, setCommand] = useState<BroadcastCommand>('status');
    const [timeout, setTimeoutValue] = useState(2);
    const destructive = command === 'shutdown';
    return (
        <div className="modal-pad">
            <h2 className="modal-title">Broadcast to all runners</h2>
            <label className="jobs-field">
                <span>Command</span>
                <select
                    className="input input-compact"
                    value={command}
                    onChange={(event) => setCommand(event.target.value as BroadcastCommand)}
                >
                    {BROADCAST_COMMANDS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
            </label>
            <label className="jobs-field">
                <span>Timeout (seconds)</span>
                <input
                    type="number" className="input input-compact" min={0.5} step={0.5}
                    value={timeout}
                    onChange={(event) => setTimeoutValue(Number(event.target.value) || 2)}
                />
            </label>
            {destructive && (
                <p className="jobs-note jobs-note-bad">
                    <i className="bi bi-exclamation-octagon" /> <code>shutdown</code> stops every runner in the fleet. Nothing will process jobs afterwards.
                </p>
            )}
            <div className="modal-actions">
                <button type="button" className="btn" onClick={onCancel}>Cancel</button>
                {destructive
                    ? (
                        <ArmedButton
                            label="Broadcast shutdown"
                            armedLabel="Click again to stop every runner"
                            className="btn-danger-ghost"
                            onConfirm={() => onSubmit({ command, timeout })}
                        />
                    )
                    : (
                        <button type="button" className="btn btn-primary" onClick={() => onSubmit({ command, timeout })}>
                            Broadcast
                        </button>
                    )}
            </div>
        </div>
    );
}

// ── The inspector ─────────────────────────────────────────────────────

export function RunnerDetail({ runner, onClose }: { runner: RunnerRow; onClose: () => void }) {
    const health = runnerHealth(runner);
    const active = useRunnerActiveJobs(runner.runner_id);
    const history = useRunnerJobHistory(runner.runner_id);
    const logs = useRunnerJobLogs(runner.runner_id);

    const activeRows = active.data?.rows ?? [];
    const uptimeSec = runnerUptimeSeconds(runner);
    const heartbeatAge = heartbeatAgeSeconds(runner.last_heartbeat);
    const failureRate = runnerFailureRate(runner);
    const failureTone: Tone | null = failureRate == null ? null
        : failureRate >= 5 ? 'danger' : failureRate >= 1 ? 'warning' : 'success';

    const headline = health.key === 'down'
        ? `Down · last heartbeat ${formatHeartbeatAge(heartbeatAge)}`
        : health.key === 'stale'
            ? `${health.label} · last heartbeat ${formatHeartbeatAge(heartbeatAge)}`
            : `Up ${uptimeSec == null ? 'unknown' : formatUptime(uptimeSec)} · heartbeat ${formatHeartbeatAge(heartbeatAge)}`;

    return (
        <DetailView
            icon="bi-cpu"
            title={runner.runner_id}
            subtitle={runner.hostname}
            chips={[
                { icon: 'bi-broadcast-pin', text: health.label, tone: health.tone },
                ...(runner.channels.length > 0
                    ? [{ icon: 'bi-broadcast', text: runner.channels.join(' · '), tone: 'info' as const }]
                    : []),
            ]}
            badges={{
                channels: runner.channels.length || null,
                active: activeRows.length || null,
                history: history.data?.count || null,
            }}
            sections={[
                {
                    key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => (
                        <>
                            <StatusPanel
                                tone={health.tone}
                                state={health.label.toUpperCase()}
                                headline={headline}
                                meta={
                                    <>
                                        Channels: {runner.channels.length > 0
                                            ? runner.channels.map((channel, index) => (
                                                <span key={channel}>{index > 0 && ', '}<code>{channel}</code></span>
                                            ))
                                            : <span className="dim">none</span>}
                                        {' · '}{fmt.number(runner.jobs_processed)} processed
                                        {runner.jobs_failed > 0 && <> · {fmt.number(runner.jobs_failed)} failed</>}
                                    </>
                                }
                            />
                            <div className="jobs-kpi-grid">
                                <Kpi label="Uptime" value={uptimeSec == null ? 'unknown' : formatUptime(uptimeSec)} />
                                <Kpi label="Jobs processed" value={fmt.number(runner.jobs_processed)} tone={runner.jobs_processed > 0 ? 'success' : null} />
                                <Kpi label="Failure rate" value={failureRate == null ? '—' : `${failureRate.toFixed(2)}%`} tone={failureTone} />
                                <Kpi label="Active jobs" value={fmt.number(activeRows.length)} tone={activeRows.length > 0 ? 'info' : null} />
                            </div>
                            <Eyebrow>Heartbeat</Eyebrow>
                            <FlatRow label="Last heartbeat">{fmt.datetime(runner.last_heartbeat)}</FlatRow>
                            <FlatRow label="Started">{fmt.datetime(runner.started)}</FlatRow>
                            <FlatRow label="Host"><code>{runner.hostname}</code></FlatRow>
                        </>
                    ),
                },
                { key: 'system', label: 'System', icon: 'bi-cpu', render: () => <SystemSection runnerId={runner.runner_id} /> },
                {
                    key: 'channels', label: 'Channels', icon: 'bi-broadcast', render: () => (
                        runner.channels.length === 0
                            ? <p className="dim-italic">This runner serves no channels — it will never receive a job.</p>
                            : (
                                <>
                                    <Eyebrow>{runner.channels.length} channel{runner.channels.length === 1 ? '' : 's'}</Eyebrow>
                                    {runner.channels.map((channel) => {
                                        const count = activeRows.filter((job) => job.channel === channel).length;
                                        return (
                                            <FlatRow key={channel} label="Channel">
                                                <code>{channel}</code>
                                                <Badge tone={count > 0 ? 'info' : 'muted'}>{count} active</Badge>
                                            </FlatRow>
                                        );
                                    })}
                                </>
                            )
                    ),
                },
                {
                    key: 'active', label: 'Active jobs', icon: 'bi-hourglass-split', render: () => (
                        <TablePane pending={active.isPending} error={active.error} empty={activeRows.length === 0}>
                            <table className="jobs-table">
                                <thead><tr><th>Job</th><th>Channel</th><th>Started</th><th>Attempt</th></tr></thead>
                                <tbody>
                                    {activeRows.map((job) => (
                                        <tr key={job.id}>
                                            <td><JobIdCell job={job} /></td>
                                            <td><Badge tone="muted">{job.channel}</Badge></td>
                                            <td>{fmt.relative(job.started_at)}</td>
                                            <td>{job.attempt}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TablePane>
                    ),
                },
                { divider: 'History' },
                {
                    key: 'history', label: 'Job history', icon: 'bi-clock-history', render: () => (
                        <TablePane pending={history.isPending} error={history.error} empty={(history.data?.rows.length ?? 0) === 0}>
                            <table className="jobs-table">
                                <thead><tr><th>Job</th><th>Channel</th><th>Status</th><th>Finished</th><th>Duration</th></tr></thead>
                                <tbody>
                                    {(history.data?.rows ?? []).map((job) => (
                                        <tr key={job.id}>
                                            <td><JobIdCell job={job} /></td>
                                            <td><Badge tone="muted">{job.channel}</Badge></td>
                                            <td><Badge tone={jobStatusTone(job.status)}>{job.status}</Badge></td>
                                            <td>{fmt.relative(job.finished_at ?? job.created)}</td>
                                            <td>{job.duration_ms > 0 ? fmt.duration(job.duration_ms) : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TablePane>
                    ),
                },
                {
                    key: 'logs', label: 'Logs', icon: 'bi-code-square', render: () => (
                        <>
                            <p className="jobs-note jobs-note-info">
                                <i className="bi bi-info-circle" /> JobLog has no runner field. These are the log lines of this
                                runner’s most recent jobs, resolved by job id.
                            </p>
                            <TablePane pending={logs.isPending} error={logs.error} empty={(logs.data?.rows.length ?? 0) === 0}>
                                <table className="jobs-table">
                                    <thead><tr><th>Time</th><th>Kind</th><th>Job</th><th>Message</th></tr></thead>
                                    <tbody>
                                        {(logs.data?.rows ?? []).map((log) => (
                                            <tr key={log.id}>
                                                <td title={fmt.datetime(log.created)}>{fmt.relative(log.created)}</td>
                                                <td><Badge tone={log.kind === 'error' ? 'danger' : log.kind === 'warn' ? 'warning' : 'muted'}>{log.kind}</Badge></td>
                                                <td><code className="jobs-id">{fmt.truncateMiddle(log.job_id, 5)}</code></td>
                                                <td>{log.message}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TablePane>
                        </>
                    ),
                },
                { divider: 'Control' },
                {
                    key: 'control', label: 'Control', icon: 'bi-power',
                    render: () => <ControlSection runner={runner} onClose={onClose} />,
                },
            ]}
            initialSection="overview"
            onClose={onClose}
        />
    );
}

/** Open the inspector as a KISS detail modal — no record-detail route. */
export function showRunnerDetail(runner: RunnerRow): void {
    void modal.detail((close) => <RunnerDetail runner={runner} onClose={() => close(null)} />);
}
