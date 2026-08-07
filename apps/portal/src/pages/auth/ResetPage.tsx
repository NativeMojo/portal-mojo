// ResetPage — set a new password, in two modes on the two A1 flows:
//   · code mode (default): email + the 6-digit emailed code
//     → resetPasswordWithCode. Email prefills from the forgot step (router
//     state, then the sessionStorage stash — email links survive reloads).
//   · token mode (`?token=pr:…` in this route's hash query, from a reset
//     link) → resetPasswordWithToken.
// Both log the user straight in on success (server behavior — the response
// is a full TokenGrant, adopted by auth.ts).
//
// The `pr:` token is captured ONCE at mount and scrubbed from the hash
// query immediately — it never reaches history/bookmarks beyond the landing
// entry. (Real-search landings are scrubbed synchronously at boot by
// handleAuthTokenLanding() BEFORE any network, preserving the auth-code
// scrub discipline; a hash query is never sent in Referer headers.)
//
// New-password UX (the C3 password piece): live PasswordStrengthMeter +
// a generator affordance that fills both fields and reveals the value.
// Strength is ADVISORY — the server owns password policy; a weak-but-
// accepted password is the server's call, so submission is never blocked
// on the meter.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPasswordWithCode, resetPasswordWithToken, usingMockTransport } from 'portal-mojo/client/runtime';
import { generatePassword, PasswordStrengthMeter, toast } from 'portal-mojo/ui/shell';
import { clearResetEmail, consumeReturnRoute, peekResetEmail } from './config';

export function ResetPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();

    // Capture once; scrub below. A malformed token (wrong prefix) is kept —
    // the server answers with its real "invalid or expired" message.
    const [token] = useState(() => searchParams.get('token') ?? '');
    const tokenScrubbed = useRef(false);
    useEffect(() => {
        if (tokenScrubbed.current || (!searchParams.has('token') && !searchParams.has('flow'))) return;
        tokenScrubbed.current = true;
        const next = new URLSearchParams(searchParams);
        next.delete('token');
        next.delete('flow'); // ridden along from a hash-shaped landing
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    const stateEmail = (location.state as { email?: string } | null)?.email ?? '';
    const [email, setEmail] = useState(() => stateEmail || peekResetEmail());
    const [code, setCode] = useState('');
    const [pw, setPw] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const tokenMode = token !== '';

    const generate = () => {
        const generated = generatePassword({ length: 16, excludeAmbiguous: true });
        setPw(generated);
        setConfirm(generated);
        setShowPw(true); // the user must be able to read what to remember
    };

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!pw) {
            setError('Please enter a new password.');
            return;
        }
        if (pw !== confirm) {
            setError('Passwords do not match.');
            return;
        }
        if (!tokenMode && (!email.trim() || !code.trim())) {
            setError('Please fill in all fields.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            if (tokenMode) await resetPasswordWithToken(token, pw);
            else await resetPasswordWithCode(email.trim(), code.trim(), pw);
            clearResetEmail();
            toast.success('Password updated — you are signed in');
            navigate(consumeReturnRoute(), { replace: true });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
            setBusy(false);
        }
    };

    return (
        <div className="auth-stack">
            <div>
                <h2 className="auth-title">{tokenMode ? 'Set your new password' : 'Enter your reset code'}</h2>
                <p className="auth-sub">
                    {tokenMode
                        ? 'Choose a new password to finish signing in.'
                        : email
                            ? <>We sent a code to <b className="auth-email">{email}</b></>
                            : 'Enter the code from your email.'}
                </p>
            </div>

            {error && <div className="form-alert" role="alert">{error}</div>}

            <form className="auth-stack" onSubmit={submit}>
                {!tokenMode && (
                    <>
                        <label className="field">
                            <span className="field-label">Email address</span>
                            <input
                                className="input" type="email" value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                autoComplete="email" placeholder="you@example.com"
                            />
                        </label>
                        <label className="field">
                            <span className="field-label">Reset code</span>
                            <input
                                className="input auth-code-input" value={code} autoFocus={!!email}
                                onChange={(e) => setCode(e.target.value)}
                                inputMode="numeric" autoComplete="one-time-code"
                                placeholder="123456" maxLength={8}
                            />
                        </label>
                    </>
                )}
                <label className="field">
                    <span className="field-label">New password</span>
                    <span className="pw-input-row">
                        <input
                            className="input" type={showPw ? 'text' : 'password'}
                            value={pw} autoFocus={tokenMode}
                            onChange={(e) => setPw(e.target.value)}
                            autoComplete="new-password" placeholder="New password"
                        />
                        <button
                            type="button" className="btn-icon" tabIndex={-1}
                            title={showPw ? 'Hide password' : 'Show password'}
                            aria-label={showPw ? 'Hide password' : 'Show password'}
                            onClick={() => setShowPw((v) => !v)}
                        >
                            <i className={`bi ${showPw ? 'bi-eye-slash' : 'bi-eye'}`} />
                        </button>
                        <button type="button" className="btn btn-compact" title="Generate a strong password" onClick={generate}>
                            <i className="bi bi-stars" /> Generate
                        </button>
                    </span>
                </label>
                <PasswordStrengthMeter password={pw} />
                <label className="field">
                    <span className="field-label">Confirm password</span>
                    <input
                        className={`input${confirm && confirm !== pw ? ' input-invalid' : ''}`}
                        type={showPw ? 'text' : 'password'} value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        autoComplete="new-password" placeholder="Confirm password"
                    />
                    {confirm !== '' && confirm !== pw && <span className="field-error">Passwords do not match.</span>}
                </label>
                <button className="btn btn-primary auth-submit" disabled={busy}>
                    {busy ? <i className="bi bi-arrow-repeat spin" /> : <i className="bi bi-key" />}
                    {tokenMode ? 'Set password' : 'Reset password'}
                </button>
            </form>

            <div className="auth-links">
                <Link className="auth-link" to="/auth/forgot"><i className="bi bi-arrow-left" /> Request a new code</Link>
                <Link className="auth-link" to="/auth/login">Back to sign in</Link>
            </div>

            {usingMockTransport() && !tokenMode && (
                <p className="auth-mock-hint">Mock transport: request a code on the previous page first — it is always <code>123456</code>.</p>
            )}
        </div>
    );
}
