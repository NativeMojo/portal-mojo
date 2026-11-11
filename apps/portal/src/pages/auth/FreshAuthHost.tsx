// FreshAuthHost — the UI answering django-mojo step-up challenges (HTTP
// 440 'reauth_required', account/services/fresh_auth.py). Mounted once by
// RequireAuth; registers itself as THE fresh-auth handler
// (setFreshAuthHandler), so `withFreshAuth(fn)` call sites anywhere in the
// app get this modal.
//
// The check always happens over the current screen (#10670): the page never
// navigates, so open dialogs and drafts survive and the pending action can
// finish. The dialog itself (FreshAuthDialog) loads only when challenged.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { getAuthSnapshot, sessionIsPersistent, setFreshAuthHandler } from 'portal-mojo/client/runtime';
import type { FreshAuthPending } from './FreshAuthDialog';

const FreshAuthDialog = lazy(() => import('./FreshAuthDialog').then(module => ({ default: module.FreshAuthDialog })));

export function FreshAuthHost() {
    const [pending, setPending] = useState<FreshAuthPending | null>(null);
    // Mirror for unmount: RequireAuth drops this host on logout — a prompt
    // still open then must resolve false, or withFreshAuth() hangs forever.
    const pendingRef = useRef<FreshAuthPending | null>(null);

    useEffect(() => {
        setFreshAuthHandler(() => new Promise<boolean>((resolve) => {
            const next = {
                resolve,
                email: getAuthSnapshot().email,
                persistent: sessionIsPersistent(),
            };
            pendingRef.current = next;
            setPending(next);
        }));
        return () => {
            setFreshAuthHandler(null);
            pendingRef.current?.resolve(false);
            pendingRef.current = null;
        };
    }, []);

    const settle = useCallback((ok: boolean) => {
        const current = pendingRef.current;
        pendingRef.current = null;
        current?.resolve(ok);
        setPending(null);
    }, []);

    if (!pending) return null;
    return <Suspense fallback={null}><FreshAuthDialog pending={pending} settle={settle} /></Suspense>;
}
