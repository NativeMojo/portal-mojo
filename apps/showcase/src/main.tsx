import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    RealtimeProvider, initAuth, login, mojoQueryDefaults, onAuth, usingMockTransport,
} from 'portal-mojo/client/runtime';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './theme.css';
import { ThemeProvider } from 'portal-mojo/ui/shell';
import App from './App';

// This app has no VITE_MOJO_API on purpose — it's a standalone showcase
// meant to be published as a static site (maestro sites), so it only ever
// talks to the in-memory mock. initAuth() wires headers/refresh the same way
// the admin app does; the mock 401s without a bearer (like the real
// backend), so — since there is no login page here — sign in as the mock's
// fixed demo identity once at boot, silently, so every data-backed demo
// (tables, filters, search…) works for a first-time visitor out of the box.
initAuth();
if (!usingMockTransport()) {
    throw new Error('apps/showcase is mock-only — do not point it at a real VITE_MOJO_API');
}
const queryClient = new QueryClient({
    defaultOptions: { queries: { ...mojoQueryDefaults().queries, staleTime: 30_000 } },
});
onAuth('login', () => { void queryClient.invalidateQueries(); });
const root = createRoot(document.getElementById('root')!);

async function bootstrap() {
    // The mock's /api/login looks callers up by EMAIL even though the field is
    // named `username` on the wire. Do not mount data demos until this settles:
    // an anonymous first query can otherwise outlive login invalidation and
    // replace the authenticated result with its late 401 response.
    try {
        const [{ createRealtimeMock }] = await Promise.all([
            import('portal-mojo/client'),
            login('showcase.operator@nativemojo.com', 'mojo'),
        ]);
        const realtimeMock = createRealtimeMock();
        root.render(
            <StrictMode>
                <QueryClientProvider client={queryClient}>
                    <RealtimeProvider socketFactory={realtimeMock.factory}>
                        <ThemeProvider>
                            <HashRouter>
                                <App />
                            </HashRouter>
                        </ThemeProvider>
                    </RealtimeProvider>
                </QueryClientProvider>
            </StrictMode>,
        );
    } catch (error) {
        console.error('Showcase auto-login failed:', error);
        root.render(
            <StrictMode>
                <ThemeProvider>
                    <main className="showcase-shell"><div className="panel panel-pad" role="alert"><h1>Showcase unavailable</h1><p>The local demo identity could not sign in. Reload to retry.</p></div></main>
                </ThemeProvider>
            </StrictMode>,
        );
        return;
    }
}

void bootstrap();
