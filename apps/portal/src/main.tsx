import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as mojo from 'portal-mojo/client';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './theme.css';
import './menus';
import App from './App';

// Wire the auth gate + Authorization/DUID headers into the client and start
// session upkeep (single-flight refresh watcher) if a session exists.
mojo.initAuth();
// Returning from the hosted /auth pages: exchange ?auth_code= for a session
// (no-op when the param is absent — i.e. every normal load).
void mojo.handleAuthCodeFromURL();
// Dev console handle: drive auth flows before the C3 login pages exist —
// e.g. __mojo.login('ian@mojoverify.com', 'mojo'), __mojo.logout().
if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__mojo = mojo;
}
import { ThemeProvider } from 'portal-mojo/ui';
import { DashboardPage } from './pages/DashboardPage';
import { UsersPage } from './pages/UsersPage';
import { SettingsPage } from './pages/SettingsPage';
import { GroupOverviewPage } from './pages/GroupOverviewPage';

// Hash routing so the built dist works from any static mount (including
// served by django-mojo) with zero server rewrite config.
const router = createHashRouter([
    {
        path: '/',
        element: <App />,
        children: [
            { index: true, element: <DashboardPage /> },
            { path: 'users', element: <UsersPage /> },
            { path: 'settings', element: <SettingsPage /> },
            { path: 'group', element: <GroupOverviewPage /> },
        ],
    },
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
                <mojo.GroupProvider>
                    <RouterProvider router={router} />
                </mojo.GroupProvider>
            </ThemeProvider>
        </QueryClientProvider>
    </StrictMode>,
);
