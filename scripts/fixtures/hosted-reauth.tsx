// Local browser fixture only; uses the real host/bridge and a simulated provider page.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { getAccessToken, getAuthSnapshot, handleAuthCodeFromURL, initAuth, requestFreshAuth, sessionIsPersistent, setTokens } from '../../packages/portal-mojo/src/client/auth';
import { FreshAuthHost } from '../../apps/portal/src/pages/auth/FreshAuthHost';
import '../../apps/portal/src/theme.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

const jwt = () => `e30.${btoa(JSON.stringify({ uid: 4, email: 'operator@example.test', exp: Date.now() / 1000 + 7200, auth_time: 1 }))}.sig`;
initAuth();
if (!getAccessToken()) setTokens(jwt(), jwt(), false);
await handleAuthCodeFromURL();
function Fixture() {
    const [result, setResult] = React.useState('No pending action');
    return <main className="auth-shell"><div className="auth-card auth-stack">
        <span className="eyebrow">Local test fixture</span><h1 className="auth-title">Protected Portal screen</h1>
        <p>Account {getAuthSnapshot().uid} · {sessionIsPersistent() ? 'persistent' : 'session-only'} storage</p>
        <p>{result}</p>
        <button className="btn btn-primary" onClick={() => { void requestFreshAuth().then(ok => setResult(ok ? 'Inline confirmation' : 'Action ended; retry deliberately')); }}>Confirm identity</button>
        <button className="btn" onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; }}>Toggle theme</button>
        <FreshAuthHost />
    </div></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
