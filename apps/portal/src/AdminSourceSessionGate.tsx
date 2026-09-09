import { useSyncExternalStore, type ReactNode } from 'react';
import { redirectToHostedAuth } from 'portal-mojo/client/runtime';
import { getAdminSourceSnapshot, revokeAdminSourceSession, subscribeAdminSourceSession } from './admin-source-session';

/** Eager recovery: no router, private lazy module, or automatic navigation/reload. */
export function AdminSourceSessionGate({ children, onRetry }: { children?: ReactNode; onRetry(): void }) {
    const state = useSyncExternalStore(subscribeAdminSourceSession, getAdminSourceSnapshot);
    if (state.status === 'ready' && children) return children;
    const pending = state.status === 'checking' || state.status === 'revoking';
    return <main className="auth-shell"><section className="auth-card" role={pending ? 'status' : 'alert'}>
        <h1>{pending ? 'Checking Admin access…' : state.status === 'denied' ? 'Access denied' : 'Admin access required'}</h1>
        <p>{state.message || 'Establishing private access to this deployment.'}</p>
        {!pending && <>
            <button className="btn btn-primary" onClick={onRetry}>Retry</button>{' '}
            <button className="btn" onClick={() => redirectToHostedAuth()}>Sign in</button>{' '}
            <button className="btn" onClick={() => { void revokeAdminSourceSession().catch(() => {}); }}>Sign out</button>
        </>}
    </section></main>;
}
