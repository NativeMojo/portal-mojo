// FreshAuthHost — the UI answering django-mojo step-up challenges (HTTP
// 440 'reauth_required', account/services/fresh_auth.py). Mounted once by
// RequireAuth; registers itself as THE fresh-auth handler
// (setFreshAuthHandler), so `withFreshAuth(fn)` call sites anywhere in the
// app get this modal.
//
// The whole point (per the workspec): a mid-session challenge re-prompts
// credentials WITHOUT losing page state — a native <dialog> OVER the
// current screen, never a redirect. Only a genuine re-login can satisfy the
// gate (a refresh carries auth_time forward unchanged), so the modal runs
// the real login()/loginWithPasskey() flows — including the MFA step — and
// keeps the session in the storage the user originally chose
// (sessionIsPersistent() → remember).
//
// The identity is pinned: the email from the current session's token is
// shown as a locked chip (step-up means "prove you are still YOU", not
// "switch accounts"). It falls back to an editable field only when the
// token carries no email claim.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
    getAuthSnapshot, isPasskeySupported, login, loginWithPasskey,
    sessionIsPersistent, setFreshAuthHandler,
    type MfaChallenge,
} from 'portal-mojo/client';
import { MfaPanel } from './MfaPanel';

function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        if (error.name === 'NotAllowedError') return 'Passkey prompt was dismissed';
        return error.message;
    }
    return 'Something went wrong. Please try again.';
}

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
    pendingRef.current = pending;

    useEffect(() => {
        setFreshAuthHandler(() => new Promise<boolean>((resolve) => {
            setPending({
                resolve,
                email: getAuthSnapshot().email,
                persistent: sessionIsPersistent(),
            });
        }));
        return () => {
            setFreshAuthHandler(null);
            pendingRef.current?.resolve(false);
            pendingRef.current = null;
        };
    }, []);

    const settle = useCallback((ok: boolean) => {
        setPending((current) => {
            current?.resolve(ok);
            return null;
        });
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
            setError(errorMessage(err));
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
            setError(errorMessage(err));
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
                    <MfaPanel
                        challenge={mfa}
                        username={username.trim() || undefined}
                        remember={remember}
                        onSuccess={() => settle(true)}
                        onCancel={() => { setMfa(null); setPassword(''); }}
                    />
                ) : (
                    <div className="auth-stack">
                        <div>
                            <span className="eyebrow">Security check</span>
                            <h2 className="modal-title">Confirm it&rsquo;s you</h2>
                            <p className="auth-sub">
                                This action needs a recent sign-in. Re-enter your credentials to
                                continue — you&rsquo;ll stay right where you are.
                            </p>
                        </div>

                        {error && <div className="form-alert" role="alert">{error}</div>}

                        <form className="auth-stack" onSubmit={submit}>
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
                        </form>
                    </div>
                )}
            </div>
        </dialog>
    );
}
