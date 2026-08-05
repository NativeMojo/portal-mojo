// Auth routes fragment + route guard (board #1259). Three exports for the
// orchestrator to wire into main.tsx at merge — nothing here edits main.tsx.
//
// MERGE-WIRE: main.tsx routes — spread `authRoutes` as SIBLINGS of the App
// route (the auth pages are full-screen, no Sidebar/TopNav chrome):
//     createHashRouter([
//         { path: '/', element: <RequireAuth><App /></RequireAuth>, children: [...] },
//         ...authRoutes,
//     ])
// …wrapping <App /> in <RequireAuth> in the same motion (the guard), and
// calling `handleAuthTokenLanding()` at boot right AFTER
// mojo.handleAuthCodeFromURL() (the real-search reset/magic-link landing
// translator — synchronous, no network).
// Optional same-motion cleanup: TopNav's signed-out branch can send in-app
// deployments to '#/auth/login' instead of the console-login hint.
import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate, useLocation, type RouteObject } from 'react-router-dom';
import { redirectToHostedAuth, useAuthSnapshot } from 'portal-mojo/client';
import { AuthIndexRoute, AuthLayout } from './AuthLayout';
import { LoginPage } from './LoginPage';
import { ForgotPage } from './ForgotPage';
import { ResetPage } from './ResetPage';
import { MagicPage } from './MagicPage';
import { FreshAuthHost } from './FreshAuthHost';
import { authMode, stashReturnRoute } from './config';

/**
 * The in-app auth pages. Registered unconditionally — deep links (reset /
 * magic-link emails) must land even on hosted-mode deployments; the guard's
 * MODE decides only where an unauthenticated app visit gets SENT.
 */
export const authRoutes: RouteObject[] = [
    {
        path: '/auth',
        element: <AuthLayout />,
        children: [
            { index: true, element: <AuthIndexRoute /> },
            { path: 'login', element: <LoginPage /> },
            { path: 'forgot', element: <ForgotPage /> },
            { path: 'reset', element: <ResetPage /> },
            { path: 'magic', element: <MagicPage /> },
        ],
    },
];

/** Full-screen splash while the hosted-auth navigation happens. */
function HostedRedirect() {
    const fired = useRef(false);
    useEffect(() => {
        if (fired.current) return;
        fired.current = true;
        if (!redirectToHostedAuth()) {
            // Cannot happen when authMode() said 'hosted' (it requires a real
            // origin) — but if it ever does, say so instead of blanking.
            console.warn('redirectToHostedAuth() found no hosted auth URL — check VITE_MOJO_API / VITE_MOJO_AUTH');
        }
    }, []);
    return (
        <div className="auth-shell">
            <div className="auth-card auth-center">
                <i className="bi bi-arrow-repeat spin auth-spinner" aria-hidden="true" />
                <div>
                    <h2 className="auth-title">Redirecting to sign-in…</h2>
                    <p className="auth-sub">Taking you to this deployment&rsquo;s sign-in page.</p>
                </div>
            </div>
        </div>
    );
}

/**
 * Route guard: unauthenticated →
 *   · in-app mode → #/auth/login (the intended route is stashed and
 *     restored after sign-in),
 *   · hosted mode (the default when VITE_MOJO_API is configured) → the
 *     django-mojo hosted /auth pages via redirectToHostedAuth(), which keeps
 *     its own return-route stash and bot-check interstitial.
 * Authenticated → children, plus the fresh-auth (step-up) modal host, so a
 * mid-session 440 re-prompts credentials over the CURRENT screen.
 *
 * "Authenticated" is the A1 snapshot (valid access OR refresh token) — the
 * same judgement the transport's pre-request gate uses, live across tabs.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
    const auth = useAuthSnapshot();
    const location = useLocation();

    if (!auth.authenticated) {
        if (authMode() === 'inapp') {
            stashReturnRoute(location.pathname + location.search);
            return <Navigate to="/auth/login" replace />;
        }
        return <HostedRedirect />;
    }

    return (
        <>
            {children}
            <FreshAuthHost />
        </>
    );
}

/**
 * Boot-time translator for token landings that arrive in the REAL search
 * string — django-mojo's build_token_url appends `?flow=<flow>&token=<tok>`
 * to WEBAPP_AUTH_PATH, so a deployment pointing that at the portal root
 * lands on `/?flow=password_reset&token=pr:…` (no hash yet). This scrubs
 * flow/token from the real URL SYNCHRONOUSLY — before any network call, the
 * same discipline as the auth_code scrub — and hash-routes to the matching
 * landing page, which does the actual exchange with real UI.
 *
 * Hash-shaped landings (`/#/auth?flow=…&token=…`) never hit this: the /auth
 * index route dispatches those. No token/flow present → no-op (every normal
 * boot). Call it once at boot, after handleAuthCodeFromURL().
 */
export function handleAuthTokenLanding(): void {
    if (typeof window === 'undefined' || !window.location) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') ?? '';
    const flow = params.get('flow') ?? '';
    if (!token && !flow) return;

    let dest: string | null = null;
    if (token.startsWith('pr:') || flow === 'password_reset') dest = 'reset';
    else if (token.startsWith('ml:') || flow === 'magic_login') dest = 'magic';
    if (!dest) return; // unrelated ?token= (some other feature's param) — leave it alone

    params.delete('token');
    params.delete('flow');
    const remaining = params.toString();
    const clean = window.location.pathname + (remaining ? `?${remaining}` : '');
    const hashQuery = token ? `?${new URLSearchParams({ token }).toString()}` : '';
    // One replaceState carrying BOTH the scrub and the destination hash —
    // the token never gets its own history entry.
    window.history.replaceState({}, '', `${clean}#/auth/${dest}${hashQuery}`);
}
