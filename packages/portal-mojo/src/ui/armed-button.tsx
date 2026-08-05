// ArmedButton — two-step confirm for destructive, NO-UNDO actions, ported
// from maestro workspaces/js/dom.js `armedButton()` (lines 238-264).
//
// The first click ARMS the button — danger styling plus a label that names
// the blast radius ("Click again to revoke") — and only the second click
// fires. It auto-disarms after `disarmMs` (source: 6s), so a stray click can
// never leave a live trigger sitting on screen; unmount disarms for free
// (React state dies with the node — the source's "re-render drops the node"
// fail-safe, same cost: one extra click, never an unintended destroy).
//
// This is the house idiom for IRREVERSIBLE actions. Reach for it instead of
// `modal.confirm` when the action needs no input and the confirm dialog
// would be pure friction (inline row actions, danger zones). Actions that
// collect input (a disable reason) keep their form modal; actions that can
// be UNDONE act immediately and offer `toast.undo` instead.
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface ArmedButtonProps {
    /** Resting label ("Revoke key"). */
    label: ReactNode;
    /** Armed label — MUST name the blast radius ("Click again to revoke"). */
    armedLabel: ReactNode;
    /** Fires on the second click only. Await-ed; re-clicks ignored while pending. */
    onConfirm: () => void | Promise<void>;
    title?: string;
    /** Extra classes on top of `btn armed-btn` (e.g. 'btn-compact'). */
    className?: string;
    /** Auto-disarm window in ms. Source parity: 6000. */
    disarmMs?: number;
    disabled?: boolean;
    /** Optional bootstrap-icon shown before the resting label. */
    icon?: string;
}

export function ArmedButton({
    label, armedLabel, onConfirm, title, className, disarmMs = 6000, disabled = false, icon,
}: ArmedButtonProps) {
    const [armed, setArmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const disarm = () => {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        setArmed(false);
    };

    // Unmount clears the timer; the armed state itself dies with the node.
    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

    // Escape disarms — a keyboard user who armed by accident needs an exit
    // that isn't "wait 6 seconds" or "click the thing you fear".
    useEffect(() => {
        if (!armed) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') disarm(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [armed]);

    const click = async (e: React.MouseEvent) => {
        // Armed buttons live inside clickable rows — the arm/fire click must
        // never double as a row open (source parity: e.stopPropagation()).
        e.stopPropagation();
        if (busy) return;
        if (!armed) {
            setArmed(true);
            timerRef.current = setTimeout(() => { timerRef.current = null; setArmed(false); }, disarmMs);
            return;
        }
        disarm();
        try {
            setBusy(true);
            await onConfirm();
        } finally {
            setBusy(false);
        }
    };

    return (
        <button
            type="button"
            className={`btn armed-btn${armed ? ' is-armed' : ''}${className ? ` ${className}` : ''}`}
            title={title ?? (typeof label === 'string' ? label : undefined)}
            disabled={disabled || busy}
            onClick={(e) => { void click(e); }}
        >
            {armed
                ? <><i className="bi bi-exclamation-triangle-fill" /> {armedLabel}</>
                : <>{icon && <i className={`bi ${icon}`} />} {label}</>}
        </button>
    );
}
