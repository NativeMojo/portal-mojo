import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as mojo from 'portal-mojo/client';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './theme.css';
import App from './App';

// Wire the auth gate + Authorization/DUID headers into the client and start
// session upkeep (single-flight refresh watcher) if a session exists.
mojo.initAuth();
// Dev console handle: drive auth flows before the C3 login pages exist —
// e.g. __mojo.login('ian@mojoverify.com', 'mojo'), __mojo.logout().
if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__mojo = mojo;
}
import { ThemeProvider } from 'portal-mojo/ui';
import { DashboardPage } from './pages/DashboardPage';
import { UsersPage } from './pages/UsersPage';
import { SettingsPage } from './pages/SettingsPage';

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
        ],
    },
]);

const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <ThemeProvider>
                <RouterProvider router={router} />
            </ThemeProvider>
        </QueryClientProvider>
    </StrictMode>,
);
