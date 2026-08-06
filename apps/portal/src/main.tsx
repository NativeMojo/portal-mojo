import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as mojo from 'portal-mojo/client';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './theme.css';
import './menus';
import App from './App';
import { authRoutes, RequireAuth, handleAuthTokenLanding } from './pages/auth/routes';
import { adminRoutes } from './pages/admin-routes';

// Wire the auth gate + Authorization/DUID headers into the client and start
// session upkeep (single-flight refresh watcher) if a session exists.
mojo.initAuth();
// Returning from the hosted /auth pages: exchange ?auth_code= for a session
// (no-op when the param is absent — i.e. every normal load).
void mojo.handleAuthCodeFromURL();
// Reset/magic-link emails landing in the REAL search string
// (?flow=…&token=…): scrub + hash-route to the matching landing page.
// Synchronous, and MUST run before createHashRouter is constructed
// (replaceState fires no hashchange).
handleAuthTokenLanding();
// Dev console handle — e.g. __mojo.logout(), __mojo.requestFreshAuth().
if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__mojo = mojo;
}
import { ThemeProvider } from 'portal-mojo/ui';
import { DashboardPage } from './pages/DashboardPage';
import { UsersPage } from './pages/UsersPage';

// This artifact is the fleet-wide Admin, never a group-scoped product portal.
// Remove stale deep-link scope without erasing another portal's remembered
// active_group_id. Preserve every unrelated real-search parameter and hash.
const adminSearch = new URLSearchParams(window.location.search);
if (adminSearch.has('group')) {
    adminSearch.delete('group');
    const query = adminSearch.toString();
    window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
}

// Hash routing so the built dist works from any static mount (including
// served by django-mojo) with zero server rewrite config. The auth pages are
// SIBLINGS of the App route (full-screen, no Sidebar/TopNav chrome); the
// RequireAuth guard sends unauthenticated visits to in-app login or the
// hosted /auth pages per VITE_MOJO_AUTH.
const router = createHashRouter([
    {
        path: '/',
        element: <RequireAuth><App /></RequireAuth>,
        children: [
            { index: true, element: <DashboardPage /> },
            { path: 'users', element: <UsersPage /> },
            ...adminRoutes,
        ],
    },
    ...authRoutes,
]);

const mojoDefaults = mojo.mojoQueryDefaults();
const queryClient = new QueryClient({
    defaultOptions: { queries: { ...mojoDefaults.queries, staleTime: 30_000 } },
});
if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__qc = queryClient;
}

// Identity changed → every cached answer is suspect. Refetching here is what
// turns a sign-in into live tables without a manual Retry (and a sign-out
// into fresh 401 error states instead of stale rows).
mojo.onAuth('login', () => { void queryClient.invalidateQueries(); });
mojo.onAuth('logout', () => { void queryClient.invalidateQueries(); });

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <ThemeProvider>
                <RouterProvider router={router} />
            </ThemeProvider>
        </QueryClientProvider>
    </StrictMode>,
);
