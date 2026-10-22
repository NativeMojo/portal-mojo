import { useCallback, useEffect, useMemo, useRef, useLayoutEffect, useState } from 'react';
import { getAuthSessionRevision, useAuthSnapshot, useMe } from '../../client/runtime';
import { backendGlobalCan } from '../fleet/access';
import { assertOwner, deploymentOwner, ownerKey, type DeploymentOwner } from './permissions';
export function useDeploymentOwner() { const auth = useAuthSnapshot(), me = useMe(), revision = getAuthSessionRevision(); const base = useMemo(() => deploymentOwner(), [auth.uid, auth.authenticated, revision]); const authority = ['view_platform', 'manage_platform', 'admin', 'view_dns', 'manage_dns', 'security', 'manage_webapp', 'view_admin', 'manage_users', 'manage_settings'].map(p => backendGlobalCan(me.data, p)).join(':'); const key = `${ownerKey(base)}:${authority}`; const [epoch, setEpoch] = useState(0); const controller = useMemo(() => new AbortController(), [key, epoch]); useLayoutEffect(() => { if (controller.signal.aborted)
    setEpoch(n => n + 1); return () => controller.abort(); }, [controller]); const owner = useMemo(() => ({ ...base, signal: controller.signal }), [base, controller]); return {
    owner, signal: controller.signal, key
}; }
export interface Observation<T> {
    value: T | null;
    state: 'idle' | 'observing' | 'stopped' | 'terminal' | 'error';
    observedAt: number | null;
    refresh: () => void;
}
/** Known identity only; bounded, owner-fenced, hidden/blur aware; refresh only reads. */
export function useDeploymentObservation<T>(owner: DeploymentOwner, identity: string | null, read: (signal: AbortSignal) => Promise<T>, terminal: (value: T) => boolean, pollable: (value: T) => boolean = () => true, budgetMs = 60000, intervalMs = 2000): Observation<T> {
    const [generation, setGeneration] = useState(0), [value, setValue] = useState<T | null>(null), [state, setState] = useState<Observation<T>['state']>('idle'), [observedAt, setObservedAt] = useState<number | null>(null);
    const current = useRef({
        read, terminal, pollable
    });
    current.current = {
        read, terminal, pollable
    };
    const key = ownerKey(owner), slot = `${key}:${identity}:${generation}`;
    const seen = useRef('');
    useEffect(() => {
        seen.current = slot;
        if (!identity) {
            setValue(null);
            setState('idle');
            return;
        }
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cancelled = false;
        const started = Date.now();
        setValue(null);
        setObservedAt(null);
        setState('observing');
        const tick = async () => { if (cancelled)
            return; if (Date.now() - started >= budgetMs) {
            setState('stopped');
            return;
        } if (typeof document !== 'undefined' && (document.visibilityState === 'hidden' || !document.hasFocus())) {
            timer = setTimeout(tick, intervalMs);
            return;
        } try {
            assertOwner(owner, controller.signal);
            const next = await current.current.read(controller.signal);
            assertOwner(owner, controller.signal);
            if (cancelled)
                return;
            setValue(next);
            setObservedAt(Date.now());
            if (current.current.terminal(next)) {
                setState('terminal');
                return;
            }
            if (!current.current.pollable(next)) {
                setState('stopped');
                return;
            }
            timer = setTimeout(tick, intervalMs);
        }
        catch {
            if (!cancelled)
                setState('error');
        } };
        void tick();
        return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
    }, [key, owner.signal, identity, generation, budgetMs, intervalMs]);
    const matching = seen.current === slot;
    return {
        value: matching ? value : null, state: matching ? state : identity ? 'observing' : 'idle', observedAt: matching ? observedAt : null, refresh: useCallback(() => setGeneration(n => n + 1), [])
    };
}
