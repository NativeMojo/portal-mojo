// Local browser fixture only; uses the real host/bridge and a simulated provider page.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { getAccessToken, getAuthSnapshot, handleAuthCodeFromURL, initAuth, relayHostedStepUp, requestFreshAuth, sessionIsPersistent, setTokens } from '../../packages/portal-mojo/src/client/auth';
import { FreshAuthHost } from '../../apps/portal/src/pages/auth/FreshAuthHost';
import '../../apps/portal/src/theme.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

const jwt = () => `e30.${btoa(JSON.stringify({ uid: 4, email: 'operator@example.test', exp: Date.now() / 1000 + 7200, auth_time: 1 }))}.sig`;
const MIXES = { both: 'Passkey + password', password: 'Password only', google: 'Google only' } as const;
type Mix = keyof typeof MIXES;
const readMix = (): Mix => (/fixture_mix=(\w+)/.exec(document.cookie)?.[1] as Mix) ?? 'google';

function Fixture() {
    const [result, setResult] = React.useState('No pending action');
    const [draft, setDraft] = React.useState('');
    const [mix, setMix] = React.useState<Mix>(readMix);
    const choose = (next: Mix) => { document.cookie = `fixture_mix=${next}; path=/`; setMix(next); };
    return <main className="auth-shell"><div className="auth-card auth-stack">
        <span className="eyebrow">Local test fixture</span><h1 className="auth-title">Protected Portal screen</h1>
        <p>Account {getAuthSnapshot().uid} · {sessionIsPersistent() ? 'persistent' : 'session-only'} storage</p>
        <label className="field"><span className="field-label">Unsaved draft (must survive the check)</span>
            <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
        <div className="seg">{(Object.keys(MIXES) as Mix[]).map((key) => (
            <button key={key} type="button" className={`btn btn-compact${mix === key ? ' btn-primary' : ''}`} onClick={() => choose(key)}>{MIXES[key]}</button>
        ))}</div>
        <p role="status">{result}</p>
        <button className="btn btn-primary" onClick={() => { setResult('Waiting…'); void requestFreshAuth().then(ok => setResult(ok ? 'Confirmed in place' : 'Not confirmed — nothing was changed.')); }}>Confirm identity</button>
        <button className="btn" onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; }}>Toggle theme</button>
        <FreshAuthHost />
    </div></main>;
}

const root = createRoot(document.getElementById('root')!);
if (relayHostedStepUp()) {
    root.render(<main className="auth-shell"><section className="auth-card" role="status"><p>Signed in. You can close this window.</p></section></main>);
} else {
    initAuth();
    if (!getAccessToken()) setTokens(jwt(), jwt(), false);
    await handleAuthCodeFromURL();
    root.render(<React.StrictMode><Fixture /></React.StrictMode>);
}
