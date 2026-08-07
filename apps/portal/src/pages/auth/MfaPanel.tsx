// MfaPanel — the second-factor step shared by LoginPage and the fresh-auth
// modal. Wire (django-mojo account/rest/totp.py + sms.py, read in full):
//   totp    POST /api/auth/totp/verify  {mfa_token, code}          → TokenGrant
//   totp    POST /api/auth/totp/recover {mfa_token, recovery_code} → TokenGrant
//   sms     POST /api/auth/sms/send     {mfa_token} → CONSUMES the token and
//           re-issues a fresh one — this panel REPLACES its token state on
//           every send, or the verify step would fail
//   sms     POST /api/auth/sms/verify   {mfa_token, code}          → TokenGrant
//   passkey no mfa_token endpoint — a full passkey ceremony IS the second
//           factor (django-mojo's passkey login never routes through the MFA
//           gate), so the button simply runs loginWithPasskey().
// Unknown methods in the challenge are dropped WITH a console.warn (house
// rule 4) — a deployment ahead of this client degrades, never blanks.
import { useEffect, useState } from 'react';
import {
    completeMfaRecovery, completeMfaSms, completeMfaTotp, loginWithPasskey,
    isPasskeySupported, sendMfaSms,
    type AuthUser, type MfaChallenge,
} from 'portal-mojo/client/runtime';

type KnownMethod = 'totp' | 'sms' | 'passkey';
const KNOWN: KnownMethod[] = ['totp', 'sms', 'passkey'];
const METHOD_LABEL: Record<KnownMethod, string> = { totp: 'Authenticator', sms: 'Text message', passkey: 'Passkey' };
const METHOD_ICON: Record<KnownMethod, string> = { totp: 'bi-shield-lock', sms: 'bi-chat-dots', passkey: 'bi-fingerprint' };

function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        if (error.name === 'NotAllowedError') return 'Passkey prompt was dismissed';
        return error.message;
    }
    return 'Something went wrong. Please try again.';
}

export interface MfaPanelProps {
    challenge: MfaChallenge;
    /** The username the password step used — passed to the passkey ceremony. */
    username?: string;
    /** Remember-me carried from the password step (storage choice). */
    remember: boolean;
    onSuccess: (user: AuthUser) => void;
    onCancel: () => void;
}

export function MfaPanel({ challenge, username, remember, onSuccess, onCancel }: MfaPanelProps) {
    const methods = challenge.methods.filter((m): m is KnownMethod => {
        const known = (KNOWN as string[]).includes(m);
        if (!known) console.warn(`MfaPanel: unknown MFA method ${JSON.stringify(m)} from the server — not offering it`);
        if (m === 'passkey' && !isPasskeySupported()) return false;
        return known;
    });

    const [active, setActive] = useState<KnownMethod | null>(methods[0] ?? null);
    // sms/send consumes + re-issues the token; totp keeps the original.
    const [token, setToken] = useState(challenge.mfaToken);
    const [expiresAt, setExpiresAt] = useState(() => Date.now() + challenge.expiresIn * 1000);
    const [now, setNow] = useState(() => Date.now());
    const [code, setCode] = useState('');
    const [recovery, setRecovery] = useState('');
    const [useRecovery, setUseRecovery] = useState(false);
    const [smsSent, setSmsSent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);
    const secondsLeft = Math.max(0, Math.ceil((expiresAt - now) / 1000));
    const expired = secondsLeft === 0;

    const run = async (fn: () => Promise<AuthUser>) => {
        setBusy(true);
        setError('');
        try {
            onSuccess(await fn());
        } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
        }
    };

    const verifyTotp = (e: React.FormEvent) => {
        e.preventDefault();
        if (useRecovery) {
            if (!recovery.trim()) return;
            void run(() => completeMfaRecovery(token, recovery.trim(), { remember }));
        } else {
            if (!code.trim()) return;
            void run(() => completeMfaTotp(token, code.trim(), { remember }));
        }
    };

    const sendSms = async () => {
        setBusy(true);
        setError('');
        try {
            const next = await sendMfaSms(token);
            setToken(next.mfaToken); // the old token is burned server-side
            setExpiresAt(Date.now() + next.expiresIn * 1000);
            setSmsSent(true);
            setCode('');
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const verifySms = (e: React.FormEvent) => {
        e.preventDefault();
        if (!code.trim()) return;
        void run(() => completeMfaSms(token, code.trim(), { remember }));
    };

    if (methods.length === 0) {
        return (
            <div className="auth-stack">
                <div className="form-alert">
                    Your account requires a second factor this app cannot offer
                    ({challenge.methods.join(', ') || 'none listed'}).
                </div>
                <button type="button" className="btn" onClick={onCancel}>Back to sign in</button>
            </div>
        );
    }

    return (
        <div className="auth-stack" data-testid="mfa-panel">
            <div>
                <h2 className="auth-title">Two-factor check</h2>
                <p className="auth-sub">Confirm this sign-in with a second factor.</p>
            </div>

            {methods.length > 1 && (
                <div className="seg mfa-methods">
                    {methods.map((m) => (
                        <button
                            key={m} type="button"
                            className={`seg-btn${active === m ? ' seg-active' : ''}`}
                            onClick={() => { setActive(m); setError(''); setCode(''); }}
                        >
                            <i className={`bi ${METHOD_ICON[m]}`} /> {METHOD_LABEL[m]}
                        </button>
                    ))}
                </div>
            )}

            {error && <div className="form-alert" role="alert">{error}</div>}

            {active === 'totp' && (
                <form className="auth-stack" onSubmit={verifyTotp}>
                    {useRecovery ? (
                        <label className="field">
                            <span className="field-label">Recovery code</span>
                            <input
                                className="input" value={recovery} autoFocus
                                onChange={(e) => setRecovery(e.target.value)}
                                autoComplete="one-time-code" placeholder="xxxx-xxxx-xxxx"
                            />
                        </label>
                    ) : (
                        <label className="field">
                            <span className="field-label">Code from your authenticator app</span>
                            <input
                                className="input auth-code-input" value={code} autoFocus
                                onChange={(e) => setCode(e.target.value)}
                                inputMode="numeric" autoComplete="one-time-code"
                                placeholder="123456" maxLength={8}
                            />
                        </label>
                    )}
                    <button className="btn btn-primary" disabled={busy || expired}>
                        {busy ? <i className="bi bi-arrow-repeat spin" /> : <i className="bi bi-shield-check" />}
                        Verify
                    </button>
                    <button
                        type="button" className="auth-link"
                        onClick={() => { setUseRecovery((v) => !v); setError(''); }}
                    >
                        {useRecovery ? 'Use your authenticator app instead' : 'Use a recovery code instead'}
                    </button>
                </form>
            )}

            {active === 'sms' && (
                <form className="auth-stack" onSubmit={verifySms}>
                    {smsSent ? (
                        <>
                            <label className="field">
                                <span className="field-label">Code we texted you</span>
                                <input
                                    className="input auth-code-input" value={code} autoFocus
                                    onChange={(e) => setCode(e.target.value)}
                                    inputMode="numeric" autoComplete="one-time-code"
                                    placeholder="123456" maxLength={8}
                                />
                            </label>
                            <button className="btn btn-primary" disabled={busy || expired}>
                                {busy ? <i className="bi bi-arrow-repeat spin" /> : <i className="bi bi-shield-check" />}
                                Verify
                            </button>
                            <button type="button" className="auth-link" disabled={busy} onClick={() => void sendSms()}>
                                Resend code
                            </button>
                        </>
                    ) : (
                        <button type="button" className="btn btn-primary" disabled={busy || expired} onClick={() => void sendSms()}>
                            {busy ? <i className="bi bi-arrow-repeat spin" /> : <i className="bi bi-chat-dots" />}
                            Text a code to my phone
                        </button>
                    )}
                </form>
            )}

            {active === 'passkey' && (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => loginWithPasskey(username, { remember }))}>
                    {busy ? <i className="bi bi-arrow-repeat spin" /> : <i className="bi bi-fingerprint" />}
                    Use your passkey
                </button>
            )}

            <div className="auth-links">
                <span className={`mfa-expiry${expired ? ' mfa-expired' : ''}`}>
                    {expired ? 'Challenge expired — sign in again' : `Expires in ${secondsLeft}s`}
                </span>
                <button type="button" className="auth-link" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
}
