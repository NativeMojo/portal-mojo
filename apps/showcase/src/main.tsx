import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as mojo from 'portal-mojo/client';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './theme.css';
import { ThemeProvider } from 'portal-mojo/ui';
import App from './App';

// This app has no VITE_MOJO_API on purpose — it's a standalone showcase
// meant to be published as a static site (maestro sites), so it only ever
// talks to the in-memory mock. initAuth() wires headers/refresh the same way
// the admin app does; the mock 401s without a bearer (like the real
// backend), so — since there is no login page here — sign in as the mock's
// fixed demo identity once at boot, silently, so every data-backed demo
// (tables, filters, search…) works for a first-time visitor out of the box.
mojo.initAuth();
if (!mojo.usingMockTransport()) {
    throw new Error('apps/showcase is mock-only — do not point it at a real VITE_MOJO_API');
}
// The mock's /api/login looks callers up by EMAIL even though the field is
// named `username` on the wire (mock.ts authFetch) — 'ian' the username
// 401s, 'ian@mojoverify.com' the email succeeds.
if (!mojo.getAccessToken()) {
    mojo.login('ian@mojoverify.com', 'mojo').catch((err: unknown) => {
        console.error('Showcase auto-login failed — demos will run signed out:', err);
    });
}

const queryClient = new QueryClient({
    defaultOptions: { queries: { ...mojo.mojoQueryDefaults().queries, staleTime: 30_000 } },
});
mojo.onAuth('login', () => { void queryClient.invalidateQueries(); });

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <ThemeProvider>
                <HashRouter>
                    <App />
                </HashRouter>
            </ThemeProvider>
        </QueryClientProvider>
    </StrictMode>,
);
