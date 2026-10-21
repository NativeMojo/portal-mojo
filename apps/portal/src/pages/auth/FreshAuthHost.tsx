// FreshAuthHost — the UI answering django-mojo step-up challenges (HTTP
// 440 'reauth_required', account/services/fresh_auth.py). Mounted once by
// RequireAuth; registers itself as THE fresh-auth handler
// (setFreshAuthHandler), so `withFreshAuth(fn)` call sites anywhere in the
// app get this modal.
//
// Hosted mode reuses the deployment's configured sign-in page. The pending
// action ends before unloading; returning reloads the screen for a deliberate
// retry. In-app mode keeps the existing inline password/passkey/MFA flows.
// Refresh carries auth_time unchanged and cannot satisfy either mode's gate.
//
// For inline confirmation the identity is pinned: the email from the token is
// shown as a locked chip (step-up means "prove you are still YOU", not
// "switch accounts"). It falls back to an editable field only when the
// token carries no email claim.
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
    getAuthSnapshot, isPasskeySupported, login, loginWithPasskey,
    passkeyErrorMessage, redirectToHostedAuth, sessionIsPersistent, setFreshAuthHandler,
    type MfaChallenge,
} from 'portal-mojo/client/runtime';
import { authMode } from './config';

const MfaPanel = lazy(() => import('./MfaPanel').then(module => ({ default: module.MfaPanel })));

interface Pending {
    resolve: (ok: boolean) => void;
    email: string | null;
    /** Storage of the session being stepped up — the re-login keeps it. */
    persistent: boolean;
}

export function FreshAuthHost() {
    const [pending, setPending] = useState<Pending | null>(null);
    // Mirror for unmount: RequireAuth drops this host on logout — a prompt
    // still open then must resolve false, or withFreshAuth() hangs forever.
    const pendingRef = useRef<Pending | null>(null);

    useEffect(() => {
        setFreshAuthHandler(() => new Promise<boolean>((resolve) => {
            const next = {
                resolve,
                email: getAuthSnapshot().email,
                persistent: sessionIsPersistent(),
            };
            pendingRef.current = next;
            setPending(next);
        }));
        return () => {
            setFreshAuthHandler(null);
            pendingRef.current?.resolve(false);
            pendingRef.current = null;
        };
    }, []);

    const settle = useCallback((ok: boolean) => {
        const current = pendingRef.current;
        pendingRef.current = null;
        current?.resolve(ok);
        setPending(null);
    }, []);

    if (!pending) return null;
    return <FreshAuthDialog pending={pending} settle={settle} />;
}

function FreshAuthDialog({ pending, settle }: { pending: Pending; settle: (ok: boolean) => void }) {
    const ref = useRef<HTMLDialogElement>(null);
    const emailLocked = pending.email != null && pending.email !== '';
    const [username, setUsername] = useState(pending.email ?? '');
    const [password, setPassword] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [mfa, setMfa] = useState<MfaChallenge | null>(null);

    useEffect(() => {
        ref.current?.showModal();
    }, []);

    const remember = pending.persistent;
    const hosted = authMode() === 'hosted';

    const continueToSignIn = () => {
        if (!redirectToHostedAuth({ forceReauth: true, remember: pending.persistent })) {
            setError('Could not open sign-in. Allow session storage and try again.');
            return;
        }
        // End the challenge synchronously, before navigation unloads the page.
        // No mutation closure or confirmation is carried through sign-in.
        settle(false);
    };

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!username.trim() || !password) {
            setError('Please enter your password.');
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
                settle(true);
            }
        } catch (err) {
            setError(passkeyErrorMessage(err));
            setBusy(false);
        }
    };

    const passkey = async () => {
        setBusy(true);
        setError('');
        try {
            await loginWithPasskey(username.trim() || undefined, { remember });
            settle(true);
        } catch (err) {
            setError(passkeyErrorMessage(err));
            setBusy(false);
        }
    };

    return (
        <dialog
            ref={ref}
            className="mojo-modal mojo-modal-sm"
            data-testid="fresh-auth-dialog"
            onCancel={(e) => { e.preventDefault(); settle(false); }}
            onMouseDown={(e) => { if (e.target === ref.current) settle(false); }}
        >
            <div className="modal-pad">
                {mfa ? (
                    <Suspense fallback={<p className="auth-sub" role="status">Loading sign-in…</p>}>
                        <MfaPanel
                            challenge={mfa}
                            username={username.trim() || undefined}
                            remember={remember}
                            onSuccess={() => settle(true)}
                            onCancel={() => { setMfa(null); setPassword(''); }}
                        />
                    </Suspense>
                ) : (
                    <div className="auth-stack">
                        <div>
                            <span className="eyebrow">Security check</span>
                            <h2 className="modal-title">Confirm it&rsquo;s you</h2>
                            <p className="auth-sub">
                                {hosted
                                    ? 'Use this system’s sign-in page to confirm your identity. You’ll return to this screen, then retry the action.'
                                    : 'This action needs a recent sign-in. Re-enter your credentials to continue — you’ll stay right where you are.'}
                            </p>
                        </div>

                        {error && <div className="form-alert" role="alert">{error}</div>}

                        {hosted ? <>
                            {pending.email && <p className="auth-sub">Sign in as {pending.email} to continue with this account.</p>}
                            <div className="modal-actions">
                                <button type="button" className="btn" onClick={() => settle(false)}>Cancel</button>
                                <button type="button" className="btn btn-primary" onClick={continueToSignIn}>Continue to sign-in</button>
                            </div>
                        </> : <form className="auth-stack" onSubmit={submit}>
                            {emailLocked ? (
                                <div className="fresh-auth-id" title="Step-up re-authenticates the CURRENT account">
                                    <i className="bi bi-person-badge" />
                                    <span>{pending.email}</span>
                                    <i className="bi bi-lock-fill fresh-auth-lock" aria-label="Account locked for this check" />
                                </div>
                            ) : (
                                <label className="field">
                                    <span className="field-label">Email or username</span>
                                    <input
                                        className="input" value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        autoComplete="username"
                                    />
                                </label>
                            )}
                            <label className="field">
                                <span className="field-label">Password</span>
                                <span className="pw-input-row">
                                    <input
                                        className="input" type={showPw ? 'text' : 'password'}
                                        value={password} autoFocus
                                        onChange={(e) => setPassword(e.target.value)}
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
                            <div className="modal-actions">
                                {isPasskeySupported() && (
                                    <button type="button" className="btn" disabled={busy} onClick={() => void passkey()} style={{ marginRight: 'auto' }}>
                                        <i className="bi bi-fingerprint" /> Passkey
                                    </button>
                                )}
                                <button type="button" className="btn" disabled={busy} onClick={() => settle(false)}>Cancel</button>
                                <button className="btn btn-primary" disabled={busy}>
                                    {busy ? <i className="bi bi-arrow-repeat spin" /> : <i className="bi bi-shield-check" />}
                                    Confirm
                                </button>
                            </div>
                        </form>}
                    </div>
                )}
            </div>
        </dialog>
    );
}
