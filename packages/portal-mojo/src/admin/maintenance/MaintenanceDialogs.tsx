import { useEffect, useRef, useState } from 'react';
import { frameworkActionLabel, type Finding, type Framework } from './data';
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
