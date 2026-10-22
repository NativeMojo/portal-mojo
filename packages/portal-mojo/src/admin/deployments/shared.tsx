import { useEffect, useRef, useState, type ReactNode } from 'react';
import { deploymentTone } from './deployment-state';
import type { DeploymentOwner } from './permissions';
import { assertOwner } from './permissions';
export { FleetHelp as DeploymentHelp } from '../fleet/FleetHelp';
export function Status({ value }: {
    value: string;
}) { return <span className={`deployment-status text-${deploymentTone(value)}`}>{value || 'unknown'}</span>; }
export function Facts({ rows }: {
    rows: [
        string,
        ReactNode
    ][];
}) { return <dl className="deployment-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Unknown'}</dd></div>)}</dl>; }
export function ErrorNotice({ children }: {
    children: ReactNode;
}) { return <p role="alert" className="text-bad">{children}</p>; }
/** A ref locks the initiating event before React's next render. */
export function useWrite(owner: DeploymentOwner, signal: AbortSignal, onBusy?: (busy: boolean) => void) { const lock = useRef(false), alive = useRef(true); const [busy, setBusy] = useState(false), [error, setError] = useState(''); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []); return {
    busy, error, run: async (fn: () => Promise<void>) => { if (lock.current)
        return; lock.current = true; setBusy(true); setError(''); onBusy?.(true); try {
        assertOwner(owner, signal);
        await fn();
        assertOwner(owner, signal);
    }
    catch (e) {
        if (alive.current && !signal.aborted)
            setError(e instanceof Error ? e.message : 'Operation outcome unknown. Refresh to reconcile.');
    }
    finally {
        lock.current = false;
        if (alive.current) {
            setBusy(false);
            onBusy?.(false);
        }
    } }
}; }
export function useCloseOnOwnerChange(key: string, onClose: () => void) { const previous = useRef(key); useEffect(() => { if (previous.current !== key)
    onClose(); previous.current = key; }, [key, onClose]); }
