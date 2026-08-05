// MagicPage — passwordless email sign-in on the A1 flows, two modes:
//   · request (default): email → sendMagicLink → "check your email".
//   · landing (`?token=ml:…` in this route's hash query): the emailed link
//     — auto-exchange via loginWithMagicToken, with progress and a real
//     error state (the boot-time handleMagicTokenFromURL() would log in
//     silently; a landing PAGE owes the user feedback).
// The token is captured once at mount, scrubbed from the hash query, and
// exchanged exactly once — the exchange effect is StrictMode-proof (a ref
// guard), because an `ml:` token is single-use server-side and a dev-mode
// double-effect would burn it on the second POST.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { loginWithMagicToken, sendMagicLink, usingMockTransport } from 'portal-mojo/client';
import { consumeReturnRoute } from './config';

type Landing =
    | { phase: 'exchanging' }
    | { phase: 'failed'; message: string };

export function MagicPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const [token] = useState(() => searchParams.get('token') ?? '');
    const [landing, setLanding] = useState<Landing | null>(token ? { phase: 'exchanging' } : null);
    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [sent, setSent] = useState(false);

    const started = useRef(false);
    useEffect(() => {
        if (!token || started.current) return;
        started.current = true; // single-use token — never POST it twice
        // Scrub before the network call goes out.
        const next = new URLSearchParams(searchParams);
        next.delete('token');
        next.delete('flow'); // ridden along from a hash-shaped landing
        setSearchParams(next, { replace: true });
        loginWithMagicToken(token)
            .then(() => navigate(consumeReturnRoute(), { replace: true }))
            .catch((err: unknown) => {
                setLanding({
                    phase: 'failed',
                    message: err instanceof Error ? err.message : 'This sign-in link is invalid or has expired.',
                });
            });
        // searchParams/setSearchParams identities change per render; the ref
        // guard makes the exchange once-only regardless.
    }, [token, navigate, searchParams, setSearchParams]);

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
            await sendMagicLink(addr);
            setSent(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    if (landing?.phase === 'exchanging') {
        return (
            <div className="auth-stack auth-center">
                <i className="bi bi-arrow-repeat spin auth-spinner" aria-hidden="true" />
                <div>
                    <h2 className="auth-title">Signing you in…</h2>
                    <p className="auth-sub">Checking your sign-in link.</p>
                </div>
            </div>
        );
    }

    if (landing?.phase === 'failed') {
        return (
            <div className="auth-stack">
                <div>
                    <h2 className="auth-title">That link didn&rsquo;t work</h2>
                    <p className="auth-sub">Sign-in links are single-use and expire quickly.</p>
                </div>
                <div className="form-alert" role="alert">{landing.message}</div>
                <button type="button" className="btn btn-primary auth-submit" onClick={() => setLanding(null)}>
                    <i className="bi bi-envelope" /> Request a new link
                </button>
                <div className="auth-links">
                    <Link className="auth-link" to="/auth/login"><i className="bi bi-arrow-left" /> Back to sign in</Link>
                </div>
            </div>
        );
    }

    if (sent) {
        return (
            <div className="auth-stack">
                <div>
                    <h2 className="auth-title">Check your email</h2>
                    <p className="auth-sub">
                        If an account exists for <b className="auth-email">{email.trim()}</b>, a
                        sign-in link is on its way. Click it on this device to finish signing in.
                    </p>
                </div>
                <div className="auth-links">
                    <Link className="auth-link" to="/auth/login"><i className="bi bi-arrow-left" /> Back to sign in</Link>
                    <button type="button" className="auth-link" onClick={() => setSent(false)}>Use a different email</button>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-stack">
            <div>
                <h2 className="auth-title">Email me a sign-in link</h2>
                <p className="auth-sub">No password needed — we&rsquo;ll send a one-time link.</p>
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
                <button className="btn btn-primary auth-submit" disabled={busy}>
                    {busy ? <i className="bi bi-arrow-repeat spin" /> : <i className="bi bi-magic" />}
                    Send sign-in link
                </button>
            </form>

            <div className="auth-links">
                <Link className="auth-link" to="/auth/login"><i className="bi bi-arrow-left" /> Back to sign in</Link>
            </div>

            {usingMockTransport() && (
                <p className="auth-mock-hint">
                    Mock transport: magic tokens look like <code>ml:mock-1</code> — open
                    <code> #/auth/magic?token=ml:mock-1</code> to exercise the landing.
                </p>
            )}
        </div>
    );
}
