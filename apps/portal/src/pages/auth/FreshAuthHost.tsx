// FreshAuthHost — the UI answering django-mojo step-up challenges (HTTP
// 440 'reauth_required', account/services/fresh_auth.py). Mounted once by
// RequireAuth; registers itself as THE fresh-auth handler
// (setFreshAuthHandler), so `withFreshAuth(fn)` call sites anywhere in the
// app get this modal.
//
// The check always happens over the current screen (#10670): the page never
// navigates, so open dialogs and drafts survive and the pending action can
// finish. It offers only what the account has — passkey, password, and its
// linked providers — and providers (plus "Use the sign-in page") run the
// deployment's normal sign-in in a pop-up (openHostedStepUp). Refresh carries
// auth_time unchanged and cannot satisfy the gate.
//
// The identity is pinned: the email from the token is shown as a locked chip
// (step-up means "prove you are still YOU", not "switch accounts"). It falls
// back to an editable field only when the token carries no email claim.
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
    freshAuthMethods, getAuthSnapshot, hostedAuthUrl, isPasskeySupported, login, loginWithPasskey,
    openHostedStepUp, passkeyErrorMessage, sessionIsPersistent, setFreshAuthHandler,
    type FreshAuthMethods, type HostedStepUp, type MfaChallenge,
} from 'portal-mojo/client/runtime';

const MfaPanel = lazy(() => import('./MfaPanel').then(module => ({ default: module.MfaPanel })));

const PROVIDERS: Record<string, { label: string; icon: string }> = {
    google: { label: 'Google', icon: 'bi-google' },
    apple: { label: 'Apple', icon: 'bi-apple' },
    github: { label: 'GitHub', icon: 'bi-github' },
};

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
    const [methods, setMethods] = useState<FreshAuthMethods | null>(null);
    const [popup, setPopup] = useState<HostedStepUp | null>(null);
    const [popupClosed, setPopupClosed] = useState(false);
    const popupRef = useRef<HostedStepUp | null>(null);

    const remember = pending.persistent;
    const hosted = hostedAuthUrl() != null;

    useEffect(() => {
        ref.current?.showModal();
    }, []);

    useEffect(() => {
        let alive = true;
        void freshAuthMethods()
            .catch((): FreshAuthMethods => ({ password: true, passkey: true, providers: [] }))
            .then((next) => { if (alive) setMethods(next); });
        return () => { alive = false; };
    }, []);

    // The pop-up reports completion itself; this only notices it was closed early.
    useEffect(() => {
        if (!popup) return;
        const timer = setInterval(() => setPopupClosed(popup.closed()), 500);
        return () => clearInterval(timer);
    }, [popup]);
    useEffect(() => () => { popupRef.current?.cancel(); popupRef.current = null; }, []);

    const openSignIn = () => {
        setError('');
        const step = openHostedStepUp({ remember });
        if (!step) {
            setError('Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.');
            return;
        }
        popupRef.current = step;
        setPopup(step);
        setPopupClosed(false);
        void step.result.then((outcome) => {
            if (popupRef.current !== step) return;
            popupRef.current = null;
            if (outcome === 'confirmed') {
                settle(true);
                return;
            }
            setPopup(null);
            setError(outcome === 'other-account'
                ? `That sign-in was for a different account, so nothing was changed. Sign in as ${pending.email ?? 'this account'} to continue.`
                : 'Sign-in did not finish. Try again.');
        });
    };

    const cancel = () => {
        popupRef.current?.cancel();
        popupRef.current = null;
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

    const offerPasskey = Boolean(methods?.passkey) && isPasskeySupported();
    const providers = hosted ? (methods?.providers ?? []).filter((p) => PROVIDERS[p]) : [];
    // Never an empty prompt: with nothing listed and no sign-in page, try a password.
    const offerPassword = Boolean(methods?.password) || (methods != null && !offerPasskey && providers.length === 0 && !hosted);
    const primary = offerPasskey ? 'passkey' : offerPassword ? 'password' : providers[0] ?? 'signin';

    return (
        <dialog
            ref={ref}
            className="mojo-modal mojo-modal-sm"
            data-testid="fresh-auth-dialog"
            onCancel={(e) => { e.preventDefault(); cancel(); }}
            onMouseDown={(e) => { if (e.target === ref.current && !popup && !busy) cancel(); }}
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
                ) : popup ? (
                    <div className="auth-stack">
                        <div>
                            <span className="eyebrow">Security check</span>
                            <h2 className="modal-title">Finish in the sign-in window</h2>
                        </div>
                        <div className="fresh-auth-wait" role="status">
                            {popupClosed ? <i className="bi bi-window-x" /> : <i className="bi bi-arrow-repeat spin" />}
                            <span>
                                {popupClosed
                                    ? 'The sign-in window was closed before you finished.'
                                    : <>Waiting for you to sign in{pending.email ? <> as <b>{pending.email}</b></> : null}. This page stays open behind it.</>}
                            </span>
                        </div>
                        <div className="modal-actions fresh-auth-actions">
                            <button type="button" className="auth-link fresh-auth-aside" onClick={() => { if (popup.focus()) setPopupClosed(false); }}>
                                <i className="bi bi-window-stack" /> Reopen window
                            </button>
                            <button type="button" className="btn" onClick={cancel}>Cancel</button>
                        </div>
                    </div>
                ) : (
                    <div className="auth-stack">
                        <div>
                            <span className="eyebrow">Security check</span>
                            <h2 className="modal-title">Confirm it&rsquo;s you</h2>
                            <p className="auth-sub">This action needs a recent sign-in. You&rsquo;ll stay right here, and it finishes as soon as you&rsquo;re confirmed.</p>
                        </div>

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

                        {error && <div className="form-alert" role="alert">{error}</div>}

                        {!methods ? (
                            <p className="auth-sub" role="status"><i className="bi bi-arrow-repeat spin" /> Checking your sign-in options…</p>
                        ) : <>
                            {offerPasskey && (
                                <button type="button" className="btn btn-primary auth-submit" disabled={busy} onClick={() => void passkey()}>
                                    <i className="bi bi-fingerprint" /> Use passkey
                                </button>
                            )}
                            {offerPasskey && offerPassword && <div className="auth-divider">or</div>}
                            {offerPassword && (
                                <form className="auth-stack fresh-auth-form" onSubmit={submit}>
                                    <label className="field">
                                        <span className="field-label">Password</span>
                                        <span className="pw-input-row">
                                            <input
                                                className="input" type={showPw ? 'text' : 'password'}
                                                value={password} autoFocus={primary === 'password'}
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
                                    <button className={`btn auth-submit${primary === 'password' ? ' btn-primary' : ''}`} disabled={busy}>
                                        {busy ? <i className="bi bi-arrow-repeat spin" /> : <i className="bi bi-shield-check" />}
                                        Confirm with password
                                    </button>
                                </form>
                            )}
                            {providers.length > 0 && (offerPasskey || offerPassword) && <div className="auth-divider">or</div>}
                            {providers.map((provider) => (
                                <button
                                    key={provider} type="button" disabled={busy}
                                    className={`btn auth-submit${primary === provider ? ' btn-primary' : ''}`}
                                    onClick={openSignIn}
                                >
                                    <i className={`bi ${PROVIDERS[provider].icon}`} /> Continue with {PROVIDERS[provider].label}
                                </button>
                            ))}
                            {providers.length > 0 && <p className="fresh-auth-help">Opens your usual sign-in in a small window.</p>}
                            {primary === 'signin' && hosted && (
                                <button type="button" className="btn btn-primary auth-submit" disabled={busy} onClick={openSignIn}>
                                    <i className="bi bi-window-stack" /> Continue to sign-in
                                </button>
                            )}
                        </>}

                        <div className="modal-actions fresh-auth-actions">
                            {hosted && primary !== 'signin' && (
                                <button type="button" className="auth-link fresh-auth-aside" disabled={busy} onClick={openSignIn}>
                                    <i className="bi bi-window-stack" /> Use the sign-in page
                                </button>
                            )}
                            <button type="button" className="btn" disabled={busy} onClick={cancel}>Cancel</button>
                        </div>
                    </div>
                )}
            </div>
        </dialog>
    );
}
