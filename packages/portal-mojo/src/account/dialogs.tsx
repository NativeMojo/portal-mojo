// account/dialogs — the AccountModal's focused flows, each a `modal.open`
// body stacked over the modal: add passkey, authenticator (TOTP) enrolment,
// recovery codes (view / regenerate / shown-once), change password,
// email change, phone add/change, verification code, avatar.
//
// Invariants (brief #7184):
//   · one-time values — TOTP secret/uri/QR, recovery codes, the phone
//     change session_token — live in THIS dialog's component state only;
//     none of these flows uses useMutation/useQuery, so no TanStack cache
//     ever observes them, and they die with the dialog
//   · the QR renders only from a `data:image/(png|svg+xml);base64,` value
//   · every server-gated call runs under withFreshAuth (in account/api or
//     client/auth); a dismissed step-up reads "For your security, sign in
//     again to make this change."
//   · server messages are shown as written
//   · a shown-once code set cannot be dismissed until "I saved these" is
//     ticked; pending writes block Escape/backdrop dismissal
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
    downloadBlob, isReauthRequired, useMe, type Me,
} from '../client/runtime';
import {
    ImageField, PasswordStrengthMeter, copyText, modal, toast,
    type FileFieldOwnerResult,
} from '../ui';
import {
    changePassword, confirmEmailChange, confirmPhoneChange, confirmTotp, confirmVerificationCode,
    getMaskedRecoveryCodes, passkeyErrorMessage, registerPasskey, regenerateRecoveryCodes,
    requestEmailChange, requestPhoneChange, safeQrDataUrl, sendVerificationCode, startTotpSetup,
    suggestPasskeyName,
} from './api';
import { MeSaveModel, PasskeyModel, accountKeys, invalidateMe } from './models';

export const FRESH_AUTH_COPY = 'For your security, sign in again to make this change.';

/** One error voice for every account flow: step-up, authenticator, server text as written. */
export function accountErrorMessage(error: unknown): string {
    if (isReauthRequired(error)) return FRESH_AUTH_COPY;
    return passkeyErrorMessage(error);
}

/** Mutable dismissal lock shared between a dialog body and its modal.open. */
interface DismissLock { locked: boolean }

const newLock = (): DismissLock => ({ locked: false });

function useLock(lock: DismissLock, locked: boolean) {
    useEffect(() => {
        lock.locked = locked;
        return () => { lock.locked = false; };
    }, [lock, locked]);
}

function CodeInput({ value, onChange, label = 'Code', autoFocus = true }: {
    value: string; onChange: (value: string) => void; label?: string; autoFocus?: boolean;
}) {
    const id = useId();
    return (
        <label className="field" htmlFor={id}>
            <span className="field-label">{label}</span>
            <input
                id={id}
                className="input acct-code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={value}
                autoFocus={autoFocus}
                onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
        </label>
    );
}

function Alert({ children }: { children: ReactNode }) {
    return children ? <div className="form-alert" role="alert">{children}</div> : null;
}

// ── Add passkey ───────────────────────────────────────────────────────

export function openAddPasskeyDialog(): Promise<boolean> {
    const lock = newLock();
    return modal.open<boolean | null>((close) => <AddPasskeyDialog lock={lock} close={close} />, { size: 'sm', canDismiss: () => !lock.locked })
        .then((v) => v === true);
}

function AddPasskeyDialog({ lock, close }: { lock: DismissLock; close: (value: boolean | null) => void }) {
    const qc = useQueryClient();
    const [name, setName] = useState(() => suggestPasskeyName());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const nameId = useId();
    useLock(lock, busy);
    const host = typeof window !== 'undefined' ? window.location.hostname : '';

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            await registerPasskey(name);
            await Promise.all([qc.invalidateQueries({ queryKey: PasskeyModel.keys.root }), invalidateMe(qc)]);
            toast.success('Passkey added');
            close(true);
        } catch (err) {
            setError(accountErrorMessage(err));
            setBusy(false);
        }
    };

    return (
        <form className="modal-pad acct-dialog" onSubmit={submit}>
            <span className="eyebrow">Add a passkey</span>
            <div className="acct-dialog-lead">
                <span className="acct-card-icon" aria-hidden="true"><i className="bi bi-fingerprint" /></span>
                <div>
                    <h2 className="modal-title">Use this device to sign in</h2>
                    <p className="acct-muted">Your browser will ask for Touch ID, Face ID, Windows Hello or a security key.</p>
                </div>
            </div>
            <Alert>{error}</Alert>
            <label className="field" htmlFor={nameId}>
                <span className="field-label">Name this passkey</span>
                <input id={nameId} className="input" value={name} maxLength={100} autoFocus onChange={(e) => setName(e.target.value)} />
                <span className="field-help">Suggested from this device. It only has to make sense to you.</span>
            </label>
            {host && <p className="acct-note">A passkey works only on the site it was made on — this one will work on <b>{host}</b>.</p>}
            <div className="modal-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => close(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy && <i className="bi bi-arrow-repeat spin" aria-hidden="true" />} Continue
                </button>
            </div>
        </form>
    );
}

// ── Recovery codes — the shown-once panel ─────────────────────────────

export function RecoveryCodesPanel({ codes, step, onDone }: { codes: string[]; step?: string; onDone: () => void }) {
    const [saved, setSaved] = useState(false);
    const [copied, setCopied] = useState(false);
    const savedId = useId();
    const text = codes.join('\n');
    const download = () => {
        // downloadBlob revokes its object URL right after the click.
        downloadBlob(new Blob([`Recovery codes — each signs you in once.\n\n${text}\n`], { type: 'text/plain' }), 'recovery-codes.txt');
    };
    return (
        <div className="acct-dialog">
            {step && <span className="eyebrow">{step}</span>}
            <h2 className="modal-title">Save your recovery codes</h2>
            <p className="acct-muted">Each signs you in once if you lose your phone.</p>
            <div className="acct-warning" role="alert">
                <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" />
                <span>Save these codes now. They will not be shown again. Old codes no longer work.</span>
            </div>
            <ul className="acct-codes" aria-label="Recovery codes">
                {codes.map((code) => <li key={code}><code>{code}</code></li>)}
            </ul>
            <div className="acct-codes-actions">
                <button
                    type="button"
                    className="btn btn-compact"
                    onClick={() => void copyText(text).then((ok) => {
                        if (!ok) { toast.error('Copy failed — select the codes and copy them by hand'); return; }
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1600);
                    })}
                >
                    <i className={`bi ${copied ? 'bi-check-lg' : 'bi-clipboard'}`} aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}
                </button>
                <button type="button" className="btn btn-compact" onClick={download}>
                    <i className="bi bi-download" aria-hidden="true" /> Download .txt
                </button>
            </div>
            <label className="acct-check" htmlFor={savedId}>
                <input id={savedId} type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
                I saved these somewhere safe
            </label>
            <div className="modal-actions">
                <button type="button" className="btn btn-primary" disabled={!saved} onClick={onDone}>Done</button>
            </div>
        </div>
    );
}

// ── Authenticator app (TOTP) enrolment ────────────────────────────────

export function openTotpEnrolDialog(opts: { replacing: boolean }): Promise<boolean> {
    const lock = newLock();
    return modal.open<boolean | null>((close) => <TotpEnrolDialog replacing={opts.replacing} lock={lock} close={close} />, { size: 'md', canDismiss: () => !lock.locked })
        .then((v) => v === true);
}

type TotpStep =
    | { kind: 'loading' }
    | { kind: 'failed'; error: string }
    | { kind: 'scan'; secret: string; uri: string; qr: string | null }
    | { kind: 'codes'; codes: string[] };

function TotpEnrolDialog({ replacing, lock, close }: { replacing: boolean; lock: DismissLock; close: (value: boolean | null) => void }) {
    const qc = useQueryClient();
    const uid = useMe().data?.id ?? null;
    const [step, setStep] = useState<TotpStep>({ kind: 'loading' });
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [phase, setPhase] = useState<'scan' | 'code'>('scan');
    const started = useRef(false);
    useLock(lock, busy || step.kind === 'codes' || step.kind === 'loading');

    const refresh = () => Promise.all([
        qc.invalidateQueries({ queryKey: accountKeys.recoveryStatus(uid) }),
        invalidateMe(qc),
    ]);

    const begin = async () => {
        setStep({ kind: 'loading' });
        setPhase('scan');
        try {
            const setup = await startTotpSetup();
            setStep({ kind: 'scan', secret: setup.secret, uri: setup.uri, qr: setup.qrCode });
        } catch (err) {
            setStep({ kind: 'failed', error: accountErrorMessage(err) });
        } finally {
            // Setup disables an active authenticator until confirmed.
            void refresh();
        }
    };

    useEffect(() => {
        // Guard StrictMode's double effect: setup REPLACES the secret, so it
        // must run once per dialog.
        if (started.current) return;
        started.current = true;
        void begin();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const confirm = async (e: FormEvent) => {
        e.preventDefault();
        if (code.length !== 6) { setError('Enter the 6-digit code from your app.'); return; }
        setBusy(true);
        setError('');
        try {
            const codes = await confirmTotp(code);
            setStep({ kind: 'codes', codes });
            void refresh();
        } catch (err) {
            setError(accountErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    if (step.kind === 'codes') {
        return (
            <div className="modal-pad">
                <RecoveryCodesPanel codes={step.codes} step="Authenticator app · step 3 of 3" onDone={() => { toast.success('Authenticator app is on'); close(true); }} />
            </div>
        );
    }

    const onCodeStep = step.kind === 'scan' && phase === 'code';
    return (
        <form className="modal-pad acct-dialog" onSubmit={confirm}>
            <span className="eyebrow">Authenticator app · step {onCodeStep ? 2 : 1} of 3</span>
            <h2 className="modal-title">{onCodeStep ? 'Enter the code from your app' : 'Scan with your authenticator app'}</h2>
            {replacing && !onCodeStep && (
                <p className="acct-note acct-note-warn">
                    <i className="bi bi-info-circle" aria-hidden="true" /> Your current app has stopped working and stays off until you finish here.
                </p>
            )}
            {step.kind === 'loading' && <div className="acct-qr acct-qr-loading" aria-busy="true"><span className="skel skel-block" /></div>}
            {step.kind === 'failed' && (
                <>
                    <Alert>{step.error}</Alert>
                    <div className="modal-actions">
                        <button type="button" className="btn" onClick={() => close(null)}>Close</button>
                        <button type="button" className="btn btn-primary" onClick={() => void begin()}>Try again</button>
                    </div>
                </>
            )}
            {step.kind === 'scan' && !onCodeStep && (
                <>
                    <div className="acct-scan">
                        <div className="acct-qr">
                            {/* Re-checked at the sink: only a base64 PNG/SVG data URL renders. */}
                            {safeQrDataUrl(step.qr)
                                ? <img src={safeQrDataUrl(step.qr)!} alt="QR code for your authenticator app" width={168} height={168} />
                                : <span className="acct-muted">QR unavailable — enter the key instead.</span>}
                        </div>
                        <div className="acct-scan-help">
                            <p className="acct-muted">Open 1Password, Google Authenticator or a similar app, add an account and scan this code.</p>
                            <p className="acct-muted">
                                Can&rsquo;t scan?{' '}
                                <button type="button" className="acct-link" aria-expanded={showKey} onClick={() => setShowKey((v) => !v)}>
                                    {showKey ? 'Hide the key' : 'Enter a key instead'}
                                </button>
                            </p>
                            {showKey && <code className="acct-secret" aria-label="Setup key">{step.secret.replace(/(.{4})/g, '$1 ').trim()}</code>}
                        </div>
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn" onClick={() => close(null)}>Cancel</button>
                        <button type="button" className="btn btn-primary" onClick={() => setPhase('code')}>Next</button>
                    </div>
                </>
            )}
            {onCodeStep && (
                <>
                    <p className="acct-muted">Type the 6-digit code your app shows for this account.</p>
                    <Alert>{error}</Alert>
                    <CodeInput value={code} onChange={setCode} label="Code from the app" />
                    <div className="modal-actions">
                        <button type="button" className="btn acct-push-left" disabled={busy} onClick={() => { setError(''); setPhase('scan'); }}>Back</button>
                        <button type="button" className="btn" disabled={busy} onClick={() => close(null)}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
                            {busy && <i className="bi bi-arrow-repeat spin" aria-hidden="true" />} Turn on
                        </button>
                    </div>
                </>
            )}
        </form>
    );
}

// ── Recovery codes: view (masked) + regenerate ────────────────────────

export function openRecoveryCodesView(): Promise<unknown> {
    return modal.open((close) => <RecoveryCodesView close={() => close(null)} />, { size: 'sm' });
}

function RecoveryCodesView({ close }: { close: () => void }) {
    // Masked hints live in this dialog only — the cached status is just a count.
    const [state, setState] = useState<{ remaining: number; codes: string[] } | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let live = true;
        getMaskedRecoveryCodes().then((value) => { if (live) setState(value); }, (err) => { if (live) setError(accountErrorMessage(err)); });
        return () => { live = false; };
    }, []);
    return (
        <div className="modal-pad acct-dialog">
            <h2 className="modal-title">Recovery codes</h2>
            <Alert>{error}</Alert>
            {!state && !error && <span className="skel skel-block" aria-busy="true" />}
            {state && (
                <>
                    <p className="acct-muted">
                        <b>{state.remaining} of 8</b> left. Only the first four characters are shown — the full codes were shown once, when they were made.
                    </p>
                    <ul className="acct-codes acct-codes-masked" aria-label="Remaining recovery codes">
                        {state.codes.map((code, i) => <li key={`${code}-${i}`}><code>{code}</code></li>)}
                    </ul>
                </>
            )}
            <div className="modal-actions">
                <button type="button" className="btn" onClick={close}>Close</button>
                <button type="button" className="btn btn-primary" onClick={() => { close(); void openRegenerateRecoveryCodes(); }}>Regenerate…</button>
            </div>
        </div>
    );
}

export function openRegenerateRecoveryCodes(): Promise<boolean> {
    const lock = newLock();
    return modal.open<boolean | null>((close) => <RegenerateRecoveryCodes lock={lock} close={close} />, { size: 'md', canDismiss: () => !lock.locked })
        .then((v) => v === true);
}

function RegenerateRecoveryCodes({ lock, close }: { lock: DismissLock; close: (value: boolean | null) => void }) {
    const qc = useQueryClient();
    const uid = useMe().data?.id ?? null;
    const [code, setCode] = useState('');
    const [codes, setCodes] = useState<string[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useLock(lock, busy || codes != null);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            setCodes(await regenerateRecoveryCodes(code));
            void qc.invalidateQueries({ queryKey: accountKeys.recoveryStatus(uid) });
        } catch (err) {
            setError(accountErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    if (codes) {
        return <div className="modal-pad"><RecoveryCodesPanel codes={codes} onDone={() => { toast.success('New recovery codes saved'); close(true); }} /></div>;
    }
    return (
        <form className="modal-pad acct-dialog" onSubmit={submit}>
            <h2 className="modal-title">Regenerate recovery codes</h2>
            <p className="acct-muted">A fresh set of 8 replaces every code you have now. Enter a code from your authenticator app to continue.</p>
            <Alert>{error}</Alert>
            <CodeInput value={code} onChange={setCode} label="Code from the app" />
            <div className="modal-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => close(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
                    {busy && <i className="bi bi-arrow-repeat spin" aria-hidden="true" />} Regenerate
                </button>
            </div>
        </form>
    );
}

// ── Password ──────────────────────────────────────────────────────────

export function openChangePasswordDialog(): Promise<boolean> {
    const lock = newLock();
    return modal.open<boolean | null>((close) => <ChangePasswordDialog lock={lock} close={close} />, { size: 'sm', canDismiss: () => !lock.locked })
        .then((v) => v === true);
}

function ChangePasswordDialog({ lock, close }: { lock: DismissLock; close: (value: boolean | null) => void }) {
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const ids = { current: useId(), next: useId(), confirm: useId() };
    useLock(lock, busy);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!current) return setError('Enter your current password.');
        if (!next) return setError('Enter a new password.');
        if (next !== confirm) return setError('The new passwords do not match.');
        setBusy(true);
        setError('');
        try {
            await changePassword(current, next);
            toast.success('Password changed');
            close(true);
        } catch (err) {
            setError(accountErrorMessage(err));
            setBusy(false);
        }
    };

    return (
        <form className="modal-pad acct-dialog" onSubmit={submit}>
            <h2 className="modal-title">Change password</h2>
            <Alert>{error}</Alert>
            <label className="field" htmlFor={ids.current}>
                <span className="field-label">Current password</span>
                <input id={ids.current} className="input" type="password" autoComplete="current-password" value={current} autoFocus onChange={(e) => setCurrent(e.target.value)} />
            </label>
            <label className="field" htmlFor={ids.next}>
                <span className="field-label">New password</span>
                <input id={ids.next} className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </label>
            <PasswordStrengthMeter password={next} />
            <label className="field" htmlFor={ids.confirm}>
                <span className="field-label">Confirm new password</span>
                <input id={ids.confirm} className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <div className="modal-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => close(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy && <i className="bi bi-arrow-repeat spin" aria-hidden="true" />} Change password
                </button>
            </div>
        </form>
    );
}

// ── Email change ──────────────────────────────────────────────────────

export function openEmailChangeDialog(): Promise<boolean> {
    const lock = newLock();
    return modal.open<boolean | null>((close) => <EmailChangeDialog lock={lock} close={close} />, { size: 'sm', canDismiss: () => !lock.locked })
        .then((v) => v === true);
}

function EmailChangeDialog({ lock, close }: { lock: DismissLock; close: (value: boolean | null) => void }) {
    const qc = useQueryClient();
    const me = useMe().data;
    const [email, setEmail] = useState('');
    const [sentTo, setSentTo] = useState<string | null>(null);
    const [notice, setNotice] = useState('');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const emailId = useId();
    useLock(lock, busy);

    const request = async (e?: FormEvent) => {
        e?.preventDefault();
        const target = email.trim();
        if (!target) return setError('Enter the new email address.');
        setBusy(true);
        setError('');
        try {
            setNotice(await requestEmailChange(target));
            setSentTo(target);
        } catch (err) {
            setError(accountErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const confirm = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            await confirmEmailChange(code);
            await invalidateMe(qc);
            toast.success('Email changed');
            close(true);
        } catch (err) {
            setError(accountErrorMessage(err));
            setBusy(false);
        }
    };

    if (sentTo) {
        return (
            <form className="modal-pad acct-dialog" onSubmit={confirm}>
                <span className="eyebrow">Change email · step 2 of 2</span>
                <h2 className="modal-title">Check your inbox</h2>
                <p className="acct-muted">{notice} Enter the 6-digit code sent to <b>{sentTo}</b>.</p>
                <Alert>{error}</Alert>
                <CodeInput value={code} onChange={setCode} />
                <p className="acct-note">You stay signed in here. Every other session is signed out when the change completes.</p>
                <div className="modal-actions">
                    <button type="button" className="btn acct-push-left" disabled={busy} onClick={() => void request()}>Resend code</button>
                    <button type="button" className="btn" disabled={busy} onClick={() => close(null)}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
                        {busy && <i className="bi bi-arrow-repeat spin" aria-hidden="true" />} Change email
                    </button>
                </div>
            </form>
        );
    }
    return (
        <form className="modal-pad acct-dialog" onSubmit={request}>
            <span className="eyebrow">Change email · step 1 of 2</span>
            <h2 className="modal-title">Change your email</h2>
            {me?.email && <p className="acct-muted">Currently <b>{String(me.email)}</b>. We&rsquo;ll send a code to the new address; nothing changes until you enter it.</p>}
            <Alert>{error}</Alert>
            <label className="field" htmlFor={emailId}>
                <span className="field-label">New email</span>
                <input id={emailId} className="input" type="email" autoComplete="email" value={email} autoFocus onChange={(e) => setEmail(e.target.value)} />
            </label>
            <div className="modal-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => close(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
                    {busy && <i className="bi bi-arrow-repeat spin" aria-hidden="true" />} Send code
                </button>
            </div>
        </form>
    );
}

// ── Phone add / change ────────────────────────────────────────────────

export function openPhoneChangeDialog(): Promise<boolean> {
    const lock = newLock();
    return modal.open<boolean | null>((close) => <PhoneChangeDialog lock={lock} close={close} />, { size: 'sm', canDismiss: () => !lock.locked })
        .then((v) => v === true);
}

function PhoneChangeDialog({ lock, close }: { lock: DismissLock; close: (value: boolean | null) => void }) {
    const qc = useQueryClient();
    const me = useMe().data;
    const current = typeof me?.phone_number === 'string' && me.phone_number ? me.phone_number : null;
    const [phone, setPhone] = useState('');
    // The session_token is a one-time pairing value: dialog state only.
    const [ticket, setTicket] = useState<{ token: string; to: string; message: string } | null>(null);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const phoneId = useId();
    useLock(lock, busy);
    const verb = current ? 'Change' : 'Add';

    const request = async (e?: FormEvent) => {
        e?.preventDefault();
        const target = phone.trim();
        if (!target) return setError('Enter a phone number.');
        setBusy(true);
        setError('');
        try {
            const result = await requestPhoneChange(target);
            setTicket({ token: result.sessionToken, to: target, message: result.message });
            setCode('');
        } catch (err) {
            setError(accountErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const confirm = async (e: FormEvent) => {
        e.preventDefault();
        if (!ticket) return;
        setBusy(true);
        setError('');
        try {
            await confirmPhoneChange(ticket.token, code);
            await invalidateMe(qc);
            toast.success(current ? 'Phone number changed' : 'Phone number added');
            close(true);
        } catch (err) {
            setError(accountErrorMessage(err));
            setBusy(false);
        }
    };

    if (ticket) {
        return (
            <form className="modal-pad acct-dialog" onSubmit={confirm}>
                <span className="eyebrow">{verb} phone · step 2 of 2</span>
                <h2 className="modal-title">Enter the code</h2>
                <p className="acct-muted">{ticket.message} We texted <b>{ticket.to}</b>.</p>
                <Alert>{error}</Alert>
                <CodeInput value={code} onChange={setCode} />
                <div className="modal-actions">
                    <button type="button" className="btn acct-push-left" disabled={busy} onClick={() => void request()}>Resend code</button>
                    <button type="button" className="btn" disabled={busy} onClick={() => close(null)}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
                        {busy && <i className="bi bi-arrow-repeat spin" aria-hidden="true" />} {verb} phone
                    </button>
                </div>
            </form>
        );
    }
    return (
        <form className="modal-pad acct-dialog" onSubmit={request}>
            <span className="eyebrow">{verb} phone · step 1 of 2</span>
            <h2 className="modal-title">{current ? 'Change your phone number' : 'Add a phone number'}</h2>
            <p className="acct-muted">
                {current ? <>Currently <b>{current}</b>. </> : null}
                We&rsquo;ll text a code to the new number; nothing changes until you enter it.
            </p>
            <Alert>{error}</Alert>
            <label className="field" htmlFor={phoneId}>
                <span className="field-label">Phone number</span>
                <input id={phoneId} className="input" type="tel" autoComplete="tel" placeholder="+1 555 555 0100" value={phone} autoFocus onChange={(e) => setPhone(e.target.value)} />
            </label>
            <div className="modal-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => close(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy || !phone.trim()}>
                    {busy && <i className="bi bi-arrow-repeat spin" aria-hidden="true" />} Send code
                </button>
            </div>
        </form>
    );
}

// ── Verify email / phone ──────────────────────────────────────────────

export function openVerifyDialog(channel: 'email' | 'phone'): Promise<boolean> {
    const lock = newLock();
    return modal.open<boolean | null>((close) => <VerifyDialog channel={channel} lock={lock} close={close} />, { size: 'sm', canDismiss: () => !lock.locked })
        .then((v) => v === true);
}

function VerifyDialog({ channel, lock, close }: { channel: 'email' | 'phone'; lock: DismissLock; close: (value: boolean | null) => void }) {
    const qc = useQueryClient();
    const me = useMe().data;
    const target = String((channel === 'email' ? me?.email : me?.phone_number) ?? '');
    const [sent, setSent] = useState('');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useLock(lock, busy);
    const noun = channel === 'email' ? 'email' : 'phone number';

    const send = async () => {
        setBusy(true);
        setError('');
        try {
            setSent(await sendVerificationCode(channel));
        } catch (err) {
            setError(accountErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const confirm = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            const message = await confirmVerificationCode(channel, code);
            await invalidateMe(qc);
            toast.success(message);
            close(true);
        } catch (err) {
            setError(accountErrorMessage(err));
            setBusy(false);
        }
    };

    return (
        <form className="modal-pad acct-dialog" onSubmit={confirm}>
            <h2 className="modal-title">Verify your {noun}</h2>
            <p className="acct-muted">
                {sent ? <>{sent}. Enter the 6-digit code sent to <b>{target}</b>.</> : <>We&rsquo;ll send a 6-digit code to <b>{target}</b>.</>}
            </p>
            <Alert>{error}</Alert>
            {sent && <CodeInput value={code} onChange={setCode} />}
            <div className="modal-actions">
                {sent && <button type="button" className="btn acct-push-left" disabled={busy} onClick={() => void send()}>Resend code</button>}
                <button type="button" className="btn" disabled={busy} onClick={() => close(null)}>Cancel</button>
                {sent
                    ? <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>Verify</button>
                    : <button type="button" className="btn btn-primary" disabled={busy || !target} onClick={() => void send()}>
                        {busy && <i className="bi bi-arrow-repeat spin" aria-hidden="true" />} Send code
                    </button>}
            </div>
        </form>
    );
}

// ── Avatar ────────────────────────────────────────────────────────────

export function openAvatarDialog(): Promise<unknown> {
    const lock = newLock();
    return modal.open((close) => <AvatarDialog lock={lock} close={() => close(null)} />, { size: 'md', canDismiss: () => !lock.locked });
}

/** Personal-scope upload → `POST /api/user/me {avatar: <File id> | null}` (MeSaveModel). */
function AvatarDialog({ lock, close }: { lock: DismissLock; close: () => void }) {
    const me = useMe().data as Me | undefined;
    const save = MeSaveModel.useSave();
    const [busy, setBusy] = useState(false);
    const [uploadPending, setUploadPending] = useState(false);
    const [ownerResult, setOwnerResult] = useState<FileFieldOwnerResult>();
    const generation = useRef(0);
    useLock(lock, busy || uploadPending);
    const relationId = me?.avatar?.id ?? null;

    const attach = async (avatar: number | null) => {
        setBusy(true);
        try {
            const saved = await save.mutateAsync({ id: me?.id ?? null, changes: { avatar } });
            setOwnerResult({ generation: ++generation.current, status: 'success', requestedValue: avatar, authoritativeValue: saved.avatar ?? null });
            if ((saved.avatar?.id ?? null) !== avatar) throw new Error('The server did not confirm the new photo');
            toast.success(avatar == null ? 'Photo removed' : 'Photo updated');
        } catch (err) {
            setOwnerResult({ generation: ++generation.current, status: 'failed', requestedValue: avatar });
            toast.error(accountErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="modal-pad acct-dialog">
            <h2 className="modal-title">Profile photo</h2>
            <p className="acct-muted">Choose an image, crop it, and it becomes your photo everywhere you appear.</p>
            <ImageField
                value={relationId}
                onChange={(value) => { void attach(value); }}
                disabled={busy}
                accept="image/*"
                edit={{ title: 'Crop photo', startMode: 'crop', crop: { aspectRatio: 1, cropAndScale: { width: 200, height: 200 } } }}
                requireEdit
                ownerResult={ownerResult}
                onPendingChange={setUploadPending}
                onOrphan={(fileId) => toast.warning(`File #${fileId} was uploaded but is not your photo.`)}
            />
            <div className="modal-actions">
                <button type="button" className="btn" disabled={busy || uploadPending} onClick={close}>Done</button>
            </div>
        </div>
    );
}
