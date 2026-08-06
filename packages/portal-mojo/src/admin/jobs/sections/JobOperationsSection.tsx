// JobOperationsSection — the queue control plane. Port of web-mojo
// sections/JobOperationsSection.js, re-wired to what django-mojo serves.
//
// Corrections to the source, all of them consequences of reading the backend:
//   · "All Channels" no longer sends `channel: null` (an instant HTTP 400 —
//     clear-stuck and manual-reclaim are @requires_params('channel')). It is a
//     CLIENT fan-out with per-channel results.
//   · results are read from the keys the handlers actually return (`cleared`,
//     `deleted`, `reset_count`) instead of the `data.count` the source read,
//     which never existed and always reported zero.
//   · purge is dry-run-first: the dialog previews "N jobs would be deleted
//     before <cutoff>" and only then offers the armed real run.
//   · clear-queue's `confirm:"yes"` is sent only AFTER the armed confirmation.
//     Pre-satisfying a server-side safety gate removes it.
//   · every destructive control is an ArmedButton, not a plain button.
import { useState, type ReactNode } from 'react';
import { ArmedButton, JsonBlock, modal, toast } from '../../../ui';
import { useCan } from '../../../client';
import {
    cleanupConsumers,
    clearQueue,
    clearStuck,
    forEachChannel,
    isPurgeDryRun,
    manualReclaim,
    publishTestJob,
    publishTestSuite,
    purgeJobs,
    rebuildScheduled,
    resetFailed,
    summarizeChannelOutcomes,
    type PurgeResult,
} from '../control';
import { JOBS_MANAGE_PERMS, JOB_STATUS_OPTIONS } from '../models';

const ALL_CHANNELS = '';

function OperationRow({ label, icon, description, children, note }: {
    label: string;
    icon: string;
    description: ReactNode;
    children: ReactNode;
    note?: ReactNode;
}) {
    return (
        <div className="jobs-op-row">
            <div className="jobs-op-label"><i className={`bi ${icon}`} /> {label}</div>
            <div className="jobs-op-desc">
                {description}
                {note && <div className="jobs-op-note">{note}</div>}
            </div>
            <div className="jobs-op-action">{children}</div>
        </div>
    );
}

// ── Purge dialog: preview, then arm ───────────────────────────────────

function PurgeDialog({ onClose }: { onClose: () => void }) {
    const [days, setDays] = useState(30);
    const [status, setStatus] = useState('');
    const [preview, setPreview] = useState<PurgeResult | null>(null);
    const [busy, setBusy] = useState(false);

    const runPreview = async () => {
        setBusy(true);
        setPreview(null);
        try {
            const result = await purgeJobs({ daysOld: days, status: status || null, dryRun: true });
            setPreview(result);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Purge preview failed');
        } finally {
            setBusy(false);
        }
    };

    const runPurge = async () => {
        setBusy(true);
        try {
            const result = await purgeJobs({ daysOld: days, status: status || null });
            // A REAL run reports `deleted`; only the dry run has `count`.
            const deleted = isPurgeDryRun(result) ? result.count : result.deleted;
            toast.success(`Purged ${deleted} record(s) older than ${days} day(s)`);
            onClose();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Purge failed');
        } finally {
            setBusy(false);
        }
    };

    const previewCount = preview && isPurgeDryRun(preview) ? preview.count : null;

    return (
        <div className="modal-pad">
            <h2 className="modal-title">Purge old jobs</h2>
            <p className="dim">
                Deletes job rows older than the cutoff, and their events and logs with them. Preview first — the
                count is the only way to know what the cutoff actually covers.
            </p>
            <label className="jobs-field">
                <span>Older than (days)</span>
                <input
                    type="number" className="input input-compact" min={0} step={1}
                    value={days}
                    onChange={(event) => { setDays(Math.max(0, Number(event.target.value) || 0)); setPreview(null); }}
                />
            </label>
            <label className="jobs-field">
                <span>Status filter</span>
                <select
                    className="input input-compact"
                    value={status}
                    onChange={(event) => { setStatus(event.target.value); setPreview(null); }}
                >
                    <option value="">Every status</option>
                    {JOB_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
            </label>

            {preview && previewCount != null && (
                <p className={`jobs-note ${previewCount > 0 ? 'jobs-note-warn' : 'jobs-note-info'}`}>
                    <i className="bi bi-info-circle" />
                    {previewCount > 0
                        ? <> <strong>{previewCount}</strong> job(s) would be deleted, created before {new Date(preview.cutoff).toLocaleString()}.</>
                        : <> Nothing matches — no job is older than that cutoff.</>}
                </p>
            )}

            <div className="modal-actions">
                <button type="button" className="btn" onClick={onClose}>Cancel</button>
                <button type="button" className="btn" disabled={busy} onClick={() => void runPreview()}>
                    {busy && !preview ? 'Previewing…' : 'Preview'}
                </button>
                <ArmedButton
                    label="Purge"
                    armedLabel={previewCount != null ? `Click again to delete ${previewCount} job(s)` : 'Click again to purge'}
                    className="btn-danger-ghost"
                    // Arming before a preview would be arming a number nobody
                    // has seen.
                    disabled={busy || previewCount == null || previewCount === 0}
                    onConfirm={runPurge}
                />
            </div>
        </div>
    );
}

// ── Test-job dialog ───────────────────────────────────────────────────

function TestJobDialog({ channels, defaultChannel, onClose }: {
    channels: string[];
    defaultChannel: string;
    onClose: () => void;
}) {
    const [channel, setChannel] = useState(defaultChannel || channels[0] || 'default');
    const [delay, setDelay] = useState(0);
    const [busy, setBusy] = useState(false);

    const run = async () => {
        setBusy(true);
        try {
            const result = await publishTestJob({ channel, delay: delay > 0 ? delay : null });
            toast.success(`Test job ${result.job_id.slice(0, 12)}… published to ${result.channel}${result.delayed ? ` (in ${delay}s)` : ''}`);
            onClose();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not publish the test job');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="modal-pad">
            <h2 className="modal-title">Publish a test job</h2>
            <p className="dim">Publishes one sample job and hands back its id so it can be followed in the jobs table.</p>
            <label className="jobs-field">
                <span>Channel</span>
                <select className="input input-compact" value={channel} onChange={(event) => setChannel(event.target.value)}>
                    {(channels.length > 0 ? channels : ['default']).map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
            </label>
            <label className="jobs-field">
                <span>Delay (seconds, 0 = immediate)</span>
                <input
                    type="number" className="input input-compact" min={0} step={5}
                    value={delay}
                    onChange={(event) => setDelay(Math.max(0, Number(event.target.value) || 0))}
                />
            </label>
            <div className="modal-actions">
                <button type="button" className="btn" onClick={onClose}>Cancel</button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run()}>
                    {busy ? 'Publishing…' : 'Publish'}
                </button>
            </div>
        </div>
    );
}

// ── The section ───────────────────────────────────────────────────────

export function JobOperationsSection({ channels, channelsPending, onChanged }: {
    channels: string[];
    channelsPending: boolean;
    /** Refresh the dashboard after a control mutates queue state. */
    onChanged?: () => void;
}) {
    const { can: canManage } = useCan(JOBS_MANAGE_PERMS);
    const [channel, setChannel] = useState(ALL_CHANNELS);
    const noChannels = !channelsPending && channels.length === 0;
    // A stale selection must never become a request for a channel that no
    // longer exists.
    const target = channel && channels.includes(channel) ? channel : ALL_CHANNELS;
    const targets = target ? [target] : channels;
    const disabled = !canManage || noChannels;

    const after = (message: string) => { toast.success(message); onChanged?.(); };
    const failed = (error: unknown, fallback: string) =>
        toast.error(error instanceof Error ? error.message : fallback);

    /** clear-stuck / manual-reclaim have no all-channel form — fan out. */
    const runFanOut = async (verb: string, run: (name: string) => Promise<{ cleared: number }>) => {
        try {
            const outcomes = await forEachChannel(targets, run);
            const cleared = outcomes.reduce((sum, outcome) => sum + (outcome.value?.cleared ?? 0), 0);
            const anyFailed = outcomes.some((outcome) => !outcome.ok);
            const line = `${cleared} job(s) requeued · ${summarizeChannelOutcomes(outcomes, verb)}`;
            // A partial fan-out is reported as partial, never as success.
            if (anyFailed) toast.warning(line); else toast.success(line);
            onChanged?.();
        } catch (error) {
            failed(error, `${verb} failed`);
        }
    };

    return (
        <div className="panel jobs-operations">
            <div className="toolbar">
                <div className="toolbar-heading">
                    <div className="eyebrow">Control</div>
                    <h2 className="panel-title">Operations</h2>
                </div>
                <div className="toolbar-controls">
                    <label className="jobs-inline-field">
                        <span className="dim">Target</span>
                        <select
                            className="input input-compact"
                            value={target}
                            disabled={noChannels}
                            onChange={(event) => setChannel(event.target.value)}
                            aria-label="Target channel"
                        >
                            <option value={ALL_CHANNELS}>All channels</option>
                            {channels.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                    </label>
                </div>
            </div>

            {noChannels && (
                <p className="jobs-note jobs-note-warn">
                    <i className="bi bi-exclamation-triangle" /> No channels are configured or registered. Every
                    channel-scoped operation is unavailable until a channel exists.
                </p>
            )}
            {!canManage && (
                <p className="jobs-note jobs-note-info">
                    <i className="bi bi-info-circle" /> These controls require a global <code>manage_jobs</code> or <code>jobs</code> grant.
                </p>
            )}

            <OperationRow
                label="Test job" icon="bi-play-circle"
                description="Publish one sample job to verify the pipeline end to end."
            >
                <button
                    type="button" className="btn btn-compact" disabled={disabled}
                    onClick={() => void modal.open((close) => (
                        <TestJobDialog channels={channels} defaultChannel={target} onClose={() => { close(null); onChanged?.(); }} />
                    ), { size: 'sm' })}
                >
                    Publish…
                </button>
            </OperationRow>

            <OperationRow
                label="Test suite" icon="bi-robot"
                description="Publishes a whole sample suite — one job per channel plus dozens of immediate and delayed jobs."
                note="Load-generating. It returns no ids; watch the dashboard."
            >
                <ArmedButton
                    className="btn-compact" label="Run suite" armedLabel="Click again to flood the queues"
                    disabled={!canManage}
                    onConfirm={async () => {
                        try { after(await publishTestSuite()); } catch (error) { failed(error, 'Test suite failed'); }
                    }}
                />
            </OperationRow>

            <OperationRow
                label="Clear stuck" icon="bi-wrench"
                description="Requeue in-flight jobs that have been claimed for longer than the idle threshold."
                note={target ? <>Targets <code>{target}</code>.</> : <>No all-channel form exists server-side — this runs once per channel and reports each result.</>}
            >
                <ArmedButton
                    className="btn-compact" label="Clear stuck" armedLabel={`Click again to requeue in ${target || `${channels.length} channels`}`}
                    disabled={disabled}
                    onConfirm={() => runFanOut('cleared', (name) => clearStuck(name))}
                />
            </OperationRow>

            <OperationRow
                label="Reclaim all" icon="bi-arrow-counterclockwise"
                description="Requeue EVERY in-flight job, not only the idle ones (idle threshold 0)."
                note={target ? <>Targets <code>{target}</code>.</> : <>Runs once per channel.</>}
            >
                <ArmedButton
                    className="btn-compact" label="Reclaim" armedLabel={`Click again to reclaim in ${target || `${channels.length} channels`}`}
                    disabled={disabled}
                    onConfirm={() => runFanOut('reclaimed', (name) => manualReclaim(name))}
                />
            </OperationRow>

            <OperationRow
                label="Reset failed" icon="bi-arrow-repeat"
                description="Move failed jobs back to pending and requeue them, up to 100 at a time."
                note={target ? <>Targets <code>{target}</code>.</> : <>The backend handles the all-channel form itself.</>}
            >
                <ArmedButton
                    className="btn-compact" label="Reset failed" armedLabel="Click again to requeue failed jobs"
                    disabled={!canManage}
                    onConfirm={async () => {
                        try {
                            const result = await resetFailed({ channel: target || null });
                            after(`${result.reset_count} failed job(s) reset to pending`);
                        } catch (error) { failed(error, 'Reset failed'); }
                    }}
                />
            </OperationRow>

            <OperationRow
                label="Clear queue" icon="bi-eraser"
                description="Deletes the channel's Redis keys and cancels every DB-pending job on it."
                note={target
                    ? <>Targets <code>{target}</code>. Queued work is <strong>lost</strong>.</>
                    : <>Pick a single channel — clearing every queue at once is not offered.</>}
            >
                <ArmedButton
                    className="btn-compact btn-danger-ghost" label="Clear queue"
                    armedLabel={`Click again to wipe ${target}`}
                    disabled={disabled || !target}
                    onConfirm={async () => {
                        try {
                            const result = await clearQueue(target);
                            after(`Queue ${target} cleared · ${result.db_pending_canceled} pending job(s) canceled`);
                        } catch (error) { failed(error, 'Clear queue failed'); }
                    }}
                />
            </OperationRow>

            <OperationRow
                label="Purge history" icon="bi-trash"
                description="Delete job rows older than a cutoff, with their events and logs."
                note="Runs a dry-run preview before anything is deleted."
            >
                <button
                    type="button" className="btn btn-compact btn-danger-ghost" disabled={!canManage}
                    onClick={() => void modal.open((close) => (
                        <PurgeDialog onClose={() => { close(null); onChanged?.(); }} />
                    ), { size: 'sm' })}
                >
                    Purge…
                </button>
            </OperationRow>

            <OperationRow
                label="Cleanup consumers" icon="bi-people"
                description="Remove stale Redis stream consumers and, when empty, their groups."
                note={target ? <>Targets <code>{target}</code>.</> : <>Cleans every channel.</>}
            >
                <ArmedButton
                    className="btn-compact" label="Cleanup" armedLabel="Click again to clean up consumers"
                    disabled={!canManage}
                    onConfirm={async () => {
                        try {
                            const result = await cleanupConsumers({ channel: target || null });
                            void modal.open((close) => (
                                <div className="modal-pad">
                                    <h2 className="modal-title">Consumer cleanup</h2>
                                    <JsonBlock value={result} label="Result" defaultOpen />
                                    <div className="modal-actions">
                                        <button type="button" className="btn btn-primary" onClick={() => close(null)}>Close</button>
                                    </div>
                                </div>
                            ), { size: 'md' });
                            onChanged?.();
                        } catch (error) { failed(error, 'Cleanup failed'); }
                    }}
                />
            </OperationRow>

            <OperationRow
                label="Rebuild scheduled" icon="bi-calendar-check"
                description="Rebuild the Redis scheduled sets from the database's pending future jobs."
                note={target ? <>Targets <code>{target}</code>.</> : <>Rebuilds every channel.</>}
            >
                <button
                    type="button" className="btn btn-compact" disabled={!canManage}
                    onClick={async () => {
                        try {
                            await rebuildScheduled({ channel: target || null });
                            after('Scheduled sets rebuilt from the database');
                        } catch (error) { failed(error, 'Rebuild failed'); }
                    }}
                >
                    Rebuild
                </button>
            </OperationRow>
        </div>
    );
}
