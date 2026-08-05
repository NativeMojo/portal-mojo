// LoginPage — in-app password sign-in on the A1 auth client (login()), with
// the passkey ceremony, the MFA step (MfaPanel), and links into the forgot /
// magic-link flows. Flow voice from web-mojo mountAuth's signin view +
// AuthApp's messages; every wire behavior is auth.ts's.
//
// Auth-guard parity (web-mojo AuthApp.setupAuthGuards): an ALREADY
// authenticated visitor is bounced off this page — checked once at mount so
// our own successful login races nothing (we navigate explicitly).
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
    getAuthSnapshot, isPasskeySupported, login, loginWithPasskey,
    usingMockTransport,
    type AuthUser, type MfaChallenge,
} from 'portal-mojo/client';
import { MfaPanel } from './MfaPanel';
import { consumeReturnRoute } from './config';

function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        if (error.name === 'NotAllowedError') return 'Passkey prompt was dismissed';
        return error.message;
    }
    return 'Something went wrong. Please try again.';
}

export function LoginPage() {
    const navigate = useNavigate();
    // Mount-time check only — see header.
    const [alreadyAuthed] = useState(() => getAuthSnapshot().authenticated);

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [remember, setRemember] = useState(true);
    const [showPw, setShowPw] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [mfa, setMfa] = useState<MfaChallenge | null>(null);

    if (alreadyAuthed) return <Navigate to="/" replace />;

    const done = (_user: AuthUser) => {
        navigate(consumeReturnRoute(), { replace: true });
    };

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!username.trim() || !password) {
            setError('Please enter both username and password.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const result = await login(username.trim(), password, { remember });
            if (result.kind === 'mfa') {
                setMfa(result);
                setBusy(false);
            } else {
                done(result.user);
            }
        } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
        }
    };

    const passkey = async () => {
        setBusy(true);
        setError('');
        try {
            done(await loginWithPasskey(username.trim() || undefined));
        } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
        }
    };

    if (mfa) {
        return (
            <MfaPanel
                challenge={mfa}
                username={username.trim() || undefined}
                remember={remember}
                onSuccess={done}
                onCancel={() => { setMfa(null); setPassword(''); }}
            />
        );
    }

    return (
        <div className="auth-stack">
            <div>
                <h2 className="auth-title">Welcome back</h2>
                <p className="auth-sub">Sign in to your account</p>
            </div>

            {error && <div className="form-alert" role="alert">{error}</div>}

            <form className="auth-stack" onSubmit={submit}>
                <label className="field">
                    <span className="field-label">Email or username</span>
                    <input
                        className="input" value={username} autoFocus
                        onChange={(e) => setUsername(e.target.value)}
                        autoComplete="username" placeholder="you@example.com"
                    />
                </label>
                <label className="field">
                    <span className="field-label">Password</span>
                    <span className="pw-input-row">
                        <input
                            className="input" type={showPw ? 'text' : 'password'}
                            value={password} onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password" placeholder="Password"
                        />
                        <button
                            type="button" className="btn-icon" tabIndex={-1}
                            title={showPw ? 'Hide password' : 'Show password'}
                            aria-label={showPw ? 'Hide password' : 'Show password'}
                            onClick={() => setShowPw((v) => !v)}
                        >
                            <i className={`bi ${showPw ? 'bi-eye-slash' : 'bi-eye'}`} />
                        </button>
                    </span>
                </label>
                <label className="auth-remember">
                    <input
                        type="checkbox" className="tbl-check" checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                    />
                    <span>Remember me on this device</span>
                </label>
                <button className="btn btn-primary auth-submit" disabled={busy}>
                    {busy ? <i className="bi bi-arrow-repeat spin" /> : <i className="bi bi-box-arrow-in-right" />}
                    Sign in
                </button>
            </form>

            {isPasskeySupported() && (
                <>
                    <div className="auth-divider"><span>or</span></div>
                    <button type="button" className="btn auth-submit" disabled={busy} onClick={() => void passkey()}>
                        <i className="bi bi-fingerprint" /> Sign in with a passkey
                    </button>
                </>
            )}

            <div className="auth-links">
                <Link className="auth-link" to="/auth/forgot">Forgot password?</Link>
                <Link className="auth-link" to="/auth/magic">Email me a sign-in link</Link>
            </div>

            {usingMockTransport() && (
                <p className="auth-mock-hint">
                    Mock transport: any seeded user (e.g. <code>ian@mojoverify.com</code>) with password <code>mojo</code>.
                </p>
            )}
        </div>
    );
}
