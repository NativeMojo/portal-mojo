import { useEffect, useRef, useState } from 'react';
import { frameworkActionLabel, type Finding, type Framework } from './data';
import { datetime } from '../../ui/format';
import { FleetHelp as MaintenanceHelp } from '../fleet/FleetHelp';
import type { MaintenanceAttempt } from './operations';
export function MaintenanceDialog({
    finding,
    framework,
    busy,
    onConfirm,
    onClose,
}: {
    finding?: Finding;
    framework?: Framework;
    busy: boolean;
    onConfirm: (immediate: boolean) => void;
    onClose: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [typed, setTyped] = useState(''),
        [windowChoice, setWindowChoice] = useState<'now' | 'window' | ''>('');
    const expected = finding?.resource_id ?? framework?.latest ?? '';
    useEffect(() => {
        const d = dialog.current;
        d?.showModal();
        return () => d?.close();
    }, []);
    return (
        <dialog
            ref={dialog}
            className="maintenance-dialog"
            aria-labelledby="maintenance-confirm-title"
            onCancel={(e) => {
                e.preventDefault();
                if (!busy) onClose();
            }}
        >
            <div className="maintenance-dialog-body">
                <h2 id="maintenance-confirm-title">
                    {finding
                        ? `Upgrade ${finding.resource_id}?`
                        : framework
                          ? frameworkActionLabel(framework)
                          : 'Review update'}
                </h2>
                <div className="maintenance-dialog-scroll">
                <p>
                    {finding
                        ? `${finding.engine}: ${finding.current_version} → ${finding.available_major}`
                        : `Installed ${framework?.installed ?? 'unknown'} → ${framework?.latest ?? 'unknown'}`}
                </p>
                <p className="maintenance-warning">
                    {finding
                        ? finding.kind === 'elasticache'
                            ? 'This restarts cache nodes. Clients reconnect and cached data may be lost. A major upgrade cannot be undone; recovery means restoring a snapshot.'
                            : 'The database goes offline during the engine upgrade. Multi-AZ may fail over; a single instance is unavailable. A major upgrade cannot be undone; recovery means restoring a snapshot.'
                        : 'This clears the current pin, restores automatic latest-version updates, and redeploys the last converged application SHA. Services restart as the canary migrates and the fleet rolls. Acceptance does not prove fleet completion.'}
                </p>
                {finding && (
                    <fieldset disabled={busy}>
                        <legend>Choose the outage window</legend>
                        <label>
                            <input
                                type="radio"
                                name="maintenance-window"
                                checked={windowChoice === 'window'}
                                onChange={() => setWindowChoice('window')}
                            />{' '}
                            Next maintenance window
                        </label>
                        <label>
                            <input
                                type="radio"
                                name="maintenance-window"
                                checked={windowChoice === 'now'}
                                onChange={() => setWindowChoice('now')}
                            />{' '}
                            Immediately
                        </label>
                    </fieldset>
                )}
                <label className="maintenance-confirm-label">
                    Type {expected} to confirm
                    <input
                        autoFocus
                        autoComplete="off"
                        value={typed}
                        disabled={busy}
                        onChange={(e) => setTyped(e.target.value)}
                    />
                </label>
                </div>
                <div className="maintenance-actions">
                    <button className="btn" disabled={busy} onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className="btn btn-danger"
                        disabled={busy || typed !== expected || !expected || (!!finding && !windowChoice)}
                        onClick={() => onConfirm(windowChoice === 'now')}
                    >
                        {busy ? 'Requesting…' : finding ? 'Apply upgrade' : 'Confirm framework update'}
                    </button>
                </div>
            </div>
        </dialog>
    );
}

export function MaintenancePolicyDialog({ framework, busy, error, onSave, onClose }: {
    framework: Framework; busy: boolean; error: string; onSave: (value: string) => void; onClose: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [mode, setMode] = useState(framework.pin.mode);
    const [version, setVersion] = useState(framework.pin.mode === 'pinned' ? framework.pin.value ?? '' : framework.installed ?? '');
    const value = mode === 'latest' ? '' : mode === 'hold' ? 'hold' : version.trim().toLowerCase();
    const valid = mode !== 'pinned' || /^[0-9][a-z0-9._!+-]{0,63}$/.test(value);
    const unchanged = mode === framework.pin.mode && (mode !== 'pinned' || value === framework.pin.value);
    useEffect(() => { const d = dialog.current; d?.showModal(); return () => d?.close(); }, []);
    return <dialog ref={dialog} className="maintenance-dialog" aria-labelledby="maintenance-policy-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
        <div className="maintenance-dialog-body"><h2 id="maintenance-policy-title">Framework update policy</h2>
            <div className="maintenance-dialog-scroll">
                <p>This saves policy only. Nodes change on a later deployment.</p>
                <fieldset disabled={busy}><legend>Version policy</legend>
                    <label><input type="radio" name="framework-policy" checked={mode === 'latest'} onChange={() => setMode('latest')} /> Automatic</label>
                    <label><input type="radio" name="framework-policy" checked={mode === 'hold'} onChange={() => setMode('hold')} /> Hold</label>
                    <label><input type="radio" name="framework-policy" checked={mode === 'pinned'} onChange={() => setMode('pinned')} /> Exact version</label>
                </fieldset>
                {mode === 'pinned' && <label className="field"><span className="field-label">Version</span><input className="input" disabled={busy} value={version} onChange={e => setVersion(e.target.value)} autoComplete="off" placeholder="1.39.6" /></label>}
                <p className="dim">{mode === 'latest' ? 'Each deployment installs the newest published release.' : mode === 'hold' ? 'Keep the framework version from the last converged deployment.' : 'Each deployment installs this exact version.'} <MaintenanceHelp label="framework policy"><p>Hold requires a last converged framework version. Exact version checks syntax here; release availability is checked during deployment.</p><p>The separate framework Update action clears Hold or Exact and deploys the latest published version.</p></MaintenanceHelp></p>
                {error && <p role="alert" className="form-alert">{error}</p>}
            </div>
            <div className="maintenance-actions"><button className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !valid || unchanged} onClick={() => onSave(value)}>{busy ? 'Saving…' : 'Save policy'}</button></div>
        </div>
    </dialog>;
}
export function MaintenanceProgressDialog({ attempt, busy, onObserve, onClose, deploymentsHref }: {
    attempt: MaintenanceAttempt; busy: boolean; onObserve: () => void; onClose: () => void; deploymentsHref?: string;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => { const d = dialog.current; d?.showModal(); return () => d?.close(); }, []);
    const resource = 'kind' in attempt.input ? attempt.input : null;
    const target = resource?.target_version ?? ('version' in attempt.input ? attempt.input.version : 'policy' in attempt.input ? attempt.input.policy || 'Automatic' : '');
    const observation = attempt.observation;
    return <dialog ref={dialog} className="maintenance-dialog" aria-labelledby="maintenance-progress-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
        <div className="maintenance-dialog-body"><h2 id="maintenance-progress-title">Update progress</h2>
            <div className="maintenance-dialog-scroll">
                <strong>{resource?.resource ?? ('policy' in attempt.input ? 'Framework policy' : 'Django-MOJO')}</strong>
                <p role="status">{attempt.message}</p>
                <dl className="maintenance-progress-facts"><dt>Target</dt><dd>{target}</dd>{resource && <><dt>When</dt><dd>{resource.apply_immediately ? 'Immediately' : 'Next configured AWS window'}</dd></>}<dt>Last observation</dt><dd>{attempt.observedAt ? datetime(attempt.observedAt) : 'Not observed yet'}</dd></dl>
                {observation && <><p>{observation.found ? `${observation.status ?? 'Status unknown'} · ${observation.engine_version ?? 'Version unknown'}` : 'Resource not found — outcome remains unconfirmed.'}</p>{observation.pending_version && <p>Pending version: {observation.pending_version}</p>}<p className="dim">Observed versions: {observation.engine_versions.join(', ') || 'Unknown'} · {observation.settled ? 'Provider settled' : 'Still changing'}</p></>}
                {attempt.deployment && <p className="dim">Deployment {attempt.deployment.id}</p>}
                {attempt.frameworkObservation?.nodes.map(node => <p key={node.runner}>{node.runner} · {node.state} · {node.version ?? 'Version unreported'}</p>)}
                {'version' in attempt.input && !attempt.deployment && <p className="maintenance-warning">Deployment acceptance is unknown. Reconcile server deployment logs; a matching version or latest deployment cannot identify this request.</p>}
                <p className="dim">Closing this dialog does not cancel submitted work. <MaintenanceHelp label="update recovery"><p>Unknown outcomes stay guarded. Refresh only reads evidence and never resends a write. Receipts survive navigation in this document, but a full browser reload loses them.</p>{resource?.kind === 'rds-cluster' && <p>Aurora reports cluster-level settlement; individual database member proof is unavailable here.</p>}</MaintenanceHelp></p>
                {deploymentsHref && 'version' in attempt.input && <a href={deploymentsHref}>Open Deployments</a>}
            </div>
            <div className="maintenance-actions"><button className="btn" disabled={busy} onClick={onClose}>Close</button>{attempt.state !== 'complete' && attempt.state !== 'refused' && (!('version' in attempt.input) || !!attempt.deployment) && <button className="btn btn-primary" disabled={busy || attempt.state === 'sending'} onClick={onObserve}>{busy ? 'Observing…' : 'Refresh status'}</button>}</div>
        </div>
    </dialog>;
}
