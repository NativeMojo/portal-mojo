// ForgotPage — request a password reset on the A1 flow (forgotPassword):
// method 'code' emails a 6-digit code (→ the reset page's code step),
// method 'link' emails a `pr:` token link that lands on the reset page.
// View voice from web-mojo mountAuth's forgot view (method radio, back
// link); the server never discloses whether the account exists (verified
// in django-mojo on_forgot_password — the copy here mirrors that).
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { forgotPassword, usingMockTransport } from 'portal-mojo/client/runtime';
import { stashResetEmail } from './config';

export function ForgotPage() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [method, setMethod] = useState<'code' | 'link'>('code');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [linkSent, setLinkSent] = useState(false);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const addr = email.trim();
        if (!addr) {
            setError('Please enter your email address.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            await forgotPassword(addr, method);
            if (method === 'code') {
                stashResetEmail(addr);
                navigate('/auth/reset', { state: { email: addr } });
            } else {
                setLinkSent(true);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    if (linkSent) {
        return (
            <div className="auth-stack">
                <div>
                    <h2 className="auth-title">Check your email</h2>
                    <p className="auth-sub">
                        If an account exists for <b className="auth-email">{email.trim()}</b>, a reset
                        link is on its way. It signs you in and asks for a new password.
                    </p>
                </div>
                <div className="auth-links">
                    <Link className="auth-link" to="/auth/login"><i className="bi bi-arrow-left" /> Back to sign in</Link>
                    <button type="button" className="auth-link" onClick={() => setLinkSent(false)}>Use a different email</button>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-stack">
            <div>
                <h2 className="auth-title">Reset your password</h2>
                <p className="auth-sub">We&rsquo;ll email you reset instructions</p>
            </div>

            {error && <div className="form-alert" role="alert">{error}</div>}

            <form className="auth-stack" onSubmit={submit}>
                <label className="field">
                    <span className="field-label">Email address</span>
                    <input
                        className="input" type="email" value={email} autoFocus
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email" placeholder="you@example.com"
                    />
                </label>
                <fieldset className="auth-method">
                    <legend className="field-label">Reset method</legend>
                    <label className="auth-radio">
                        <input
                            type="radio" name="reset-method" value="code"
                            checked={method === 'code'} onChange={() => setMethod('code')}
                        />
                        <span>Email me a code</span>
                    </label>
                    <label className="auth-radio">
                        <input
                            type="radio" name="reset-method" value="link"
                            checked={method === 'link'} onChange={() => setMethod('link')}
                        />
                        <span>Email me a reset link</span>
                    </label>
                </fieldset>
                <button className="btn btn-primary auth-submit" disabled={busy}>
                    {busy ? <i className="bi bi-arrow-repeat spin" /> : <i className="bi bi-envelope" />}
                    Send reset
                </button>
            </form>

            <div className="auth-links">
                <Link className="auth-link" to="/auth/login"><i className="bi bi-arrow-left" /> Back to sign in</Link>
            </div>

            {usingMockTransport() && (
                <p className="auth-mock-hint">
                    Mock transport: the emailed code is always <code>123456</code>; reset links carry
                    tokens like <code>pr:mock-1</code> (open <code>#/auth/reset?token=pr:mock-1</code>).
                </p>
            )}
        </div>
    );
}
