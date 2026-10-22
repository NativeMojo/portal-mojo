import { useCallback, useEffect, useMemo, useRef, useLayoutEffect, useState } from 'react';
import { getAuthSessionRevision, useAuthSnapshot, useMe } from '../../client/runtime';
import { backendGlobalCan } from '../fleet/access';
import { assertOwner, deploymentOwner, ownerKey, type DeploymentOwner } from './permissions';
/** One identity/scope lifetime, including React's development-only effect replay. */
export function useDeploymentOwner() {
    const auth = useAuthSnapshot(), me = useMe(), revision = getAuthSessionRevision();
    const base = useMemo(() => deploymentOwner(), [auth.uid, auth.authenticated, revision]);
    const authority = [me.data?.is_active !== false, ...[
        'view_platform', 'manage_platform', 'admin', 'view_dns', 'manage_dns',
        'security', 'manage_webapp', 'view_admin', 'manage_users', 'manage_settings',
    ].map(permission => backendGlobalCan(me.data, permission))].join(':');
    const key = `${ownerKey(base)}:${authority}`;
    const lifetime = useMemo(() => ({ controller: new AbortController() }), [key]);
    const [, renderLiveSignal] = useState(0);
    useLayoutEffect(() => {
        // StrictMode replays setup after cleanup without replacing query keys.
        // Renew this same scope before its read effects resume, and publish the
        // new signal to consumers that capture a concrete signal during render.
        if (lifetime.controller.signal.aborted) {
            lifetime.controller = new AbortController();
            renderLiveSignal(generation => generation + 1);
        }
        const mountedController = lifetime.controller;
        return () => mountedController.abort();
    }, [lifetime]);
    // Query callbacks from the first render must see the controller belonging
    // to the current setup, rather than a permanently aborted render snapshot.
    // A genuine unmount has no following setup; its lifetime remains aborted.
    // A different actor/session/authority receives a separate lifetime object.
    const owner = useMemo<DeploymentOwner>(() => ({
        ...base,
        get signal() { return lifetime.controller.signal; },
    }), [base, lifetime]);
    return { owner, signal: lifetime.controller.signal, key };
}
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
