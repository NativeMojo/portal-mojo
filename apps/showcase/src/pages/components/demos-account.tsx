// AccountModal demos — portal-mojo/account's self-service "My account"
// modal against the showcase's real mock session (the signed-in operator,
// showcase.operator@nativemojo.com). Everything you change here is a mock
// write: photo, passkeys, authenticator, preferences, API keys.
//
// The showcase has no auth pages, so it has no FreshAuthHost. This demo
// registers a small stand-in step-up handler while mounted (locked email +
// password, mock password `mojo`) so an armed 440 shows the whole
// withFreshAuth loop: prompt over the screen → re-login → the call retries
// once. Real apps mount apps/portal's FreshAuthHost instead.
import { useEffect, useId, useState, type FormEvent } from 'react';
import { armMockReauth } from 'portal-mojo/client';
import { getAuthSnapshot, login, sessionIsPersistent, setFreshAuthHandler } from 'portal-mojo/client/runtime';
import { openAccountModal, type AccountSectionKey, type NotificationKind } from 'portal-mojo/account';
import { modal, toast } from 'portal-mojo/ui';

/** CamActive's kinds (alarms / security / controllers / digest) — the digest is email-only. */
const CAMACTIVE_KINDS: NotificationKind[] = [
    { kind: 'alarms', label: 'Alarms', description: 'Held-open and forced-open doors' },
    { kind: 'security', label: 'Security', description: 'New sign-ins, passkey and password changes' },
    { kind: 'controllers', label: 'Controllers', description: 'A door goes offline or comes back' },
    { kind: 'digest', label: 'Daily digest', description: 'Yesterday’s access summary, each morning', channels: ['email'] },
];

/** Fresh-auth gated calls the modal makes, and where each one lives. */
const GATED: { label: string; method: string; path: string; section: AccountSectionKey; how: string }[] = [
    { label: 'Sign out everywhere else', method: 'POST', path: '/api/auth/sessions/revoke', section: 'sessions', how: 'Sessions → Sign out everywhere else' },
    { label: 'Set up an authenticator', method: 'POST', path: '/api/account/totp/setup', section: 'security', how: 'Security → Set up' },
    { label: 'Save display name', method: 'POST', path: '/api/user/me', section: 'profile', how: 'Profile → type in Display name' },
    { label: 'Change email (send code)', method: 'POST', path: '/api/auth/email/change/request', section: 'profile', how: 'Profile → Email → Change → Send code' },
    { label: 'Generate an API key', method: 'POST', path: '/api/auth/generate_api_key', section: 'api-keys', how: 'API keys → Generate key' },
];

/** The demo's stand-in for FreshAuthHost: "prove you are still you". */
function StepUpDialog({ close }: { close: (ok: boolean) => void }) {
    const email = getAuthSnapshot().email ?? '';
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const pwId = useId();
    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!password) { setError('Please enter your password.'); return; }
        setBusy(true);
        setError('');
        try {
            const result = await login(email, password, { remember: sessionIsPersistent() });
            if (result.kind === 'mfa') { setError('This demo stand-in has no MFA step — use the operator account.'); setBusy(false); return; }
            close(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Sign in failed');
            setBusy(false);
        }
    };
    return (
        <form className="modal-pad acct-dialog" onSubmit={submit}>
            <span className="eyebrow">Step-up · demo stand-in for FreshAuthHost</span>
            <h2 className="modal-title">Confirm it&rsquo;s you</h2>
            <p className="acct-muted">For your security, sign in again to make this change. Signed in as <b>{email}</b>.</p>
            {error && <div className="form-alert" role="alert">{error}</div>}
            <label className="field" htmlFor={pwId}>
                <span className="field-label">Password</span>
                <input id={pwId} className="input" type="password" autoComplete="current-password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} />
                <span className="field-help">Mock password: <code>mojo</code></span>
            </label>
            <div className="modal-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => close(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy && <i className="bi bi-arrow-repeat spin" aria-hidden="true" />} Continue
                </button>
            </div>
        </form>
    );
}

/** Sign out is simulated: the modal closes, the showcase session is kept. */
const demoSignOut = async () => { toast.success('Signed out (demo — the showcase session is kept)'); };

function useDemoStepUp() {
    useEffect(() => {
        setFreshAuthHandler(() => modal.open<boolean>((close) => <StepUpDialog close={close} />, { size: 'sm' }).then((ok) => ok === true));
        return () => setFreshAuthHandler(null);
    }, []);
}

export function AccountDemo() {
    useDemoStepUp();
    const [gated, setGated] = useState(0);
    const [armed, setArmed] = useState<string | null>(null);
    const target = GATED[gated]!;

    const arm = () => {
        armMockReauth(target.method, target.path);
        setArmed(`${target.method} ${target.path}`);
        toast.info(`440 armed on ${target.method} ${target.path}`);
        void openAccountModal({ initialSection: target.section, onSignOut: demoSignOut });
    };

    return (
        <>
            <div className="panel panel-pad">
                <div className="eyebrow">My account · signed-in mock user</div>
                <p className="dim" style={{ margin: '0 0 12px' }}>
                    The same call the avatar menu&rsquo;s <b>My account</b> item makes. Six flat sections on a rail; under
                    720px a full-screen sheet with tabs across the top. Every code in the mock is <code>123456</code>.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button type="button" className="btn btn-primary" onClick={() => void openAccountModal({ onSignOut: demoSignOut })}>
                        <i className="bi bi-person-circle" aria-hidden="true" /> Open My account
                    </button>
                    <button
                        type="button"
                        className="btn"
                        onClick={() => void openAccountModal({ initialSection: 'notifications', notificationKinds: CAMACTIVE_KINDS, onSignOut: demoSignOut })}
                    >
                        <i className="bi bi-bell" aria-hidden="true" /> Notifications with CamActive kinds
                    </button>
                </div>
                <p className="dim" style={{ margin: '12px 0 0' }}>
                    The second button passes <code>notificationKinds</code> (Alarms, Security, Controllers, Daily digest —
                    email only) and opens on Notifications: three master channel cards writing the reserved
                    <code> "*"</code> kind, then the per-kind grid.
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">Fresh auth · arm a 440 before the next gated call</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <select
                        className="input"
                        style={{ width: 'auto', maxWidth: '100%' }}
                        aria-label="Gated call to challenge"
                        value={gated}
                        onChange={(e) => setGated(Number(e.target.value))}
                    >
                        {GATED.map((g, i) => <option key={g.path} value={i}>{g.label}</option>)}
                    </select>
                    <button type="button" className="btn" onClick={arm}>
                        <i className="bi bi-shield-exclamation" aria-hidden="true" /> Arm 440 &amp; open
                    </button>
                </div>
                <p className="dim" style={{ margin: '12px 0 0' }}>
                    <code>armMockReauth('{target.method}', '{target.path}')</code> makes the next matching call answer HTTP
                    440 once. Then: {target.how}. The step-up opens over the modal (password <code>mojo</code>); Continue
                    re-signs in and the call retries once, Cancel shows &ldquo;For your security, sign in again to make this
                    change.&rdquo; {armed && <>Last armed: <b>{armed}</b>.</>}
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">Signed out</div>
                <ul className="dim" style={{ margin: 0, paddingLeft: 18 }}>
                    <li>The modal closes itself the moment the session ends (sign-out elsewhere, refresh failure) — there is no account to show.</li>
                    <li>Opening it while signed out closes at once; <code>UserMenu</code> shows its signed-out matrix instead, so <b>My account</b> isn&rsquo;t reachable.</li>
                    <li>The rail&rsquo;s Sign out runs the app&rsquo;s <code>onSignOut</code> (pass the same handler as <code>UserMenu</code>). Here it is simulated: the modal closes and the showcase session is kept.</li>
                </ul>
            </div>
        </>
    );
}
