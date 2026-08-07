// user-sections/actions — the canonical UserView action handlers, one per
// action across every surface that offers it (kebab + Profile identity cards
// + Security rows), the source's Phase 4 dedup carried over.
//
// Send-flow endpoints are the django-mojo routes verified in source
// (account/rest/user.py, read 2026-08-05): auth/magic/send + auth/forgot
// accept {email|phone_number} with method/channel switches, ALWAYS answer
// success (anti-enumeration) and strict-rate-limit at 5/IP/5min — a 429
// surfaces via the error toast like any failure. auth/email/verify/send is
// the public, admin-targetable verification sender (NOT the JWT-scoped
// auth/verify/email/send).
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { mojoCall, withFreshAuth, type Field } from '../../../../client/runtime';
import {
    Badge, ImageField, PasswordStrengthMeter, fmt, formModal, modal, toast,
    type FileFieldOwnerResult,
} from '../../../../ui';
import { PasskeyModel, UserModel, type UserRow } from '../models';
import { openGroupDetail, useAdminCaller } from './shared';
import { OAuthConnectionList } from './OAuthSection';

/** One-field prompt modal (the source's Modal.prompt pencils). */
async function promptField(title: string, field: Field, initial: string): Promise<string | null> {
    const data = await formModal({ title, fields: [{ ...field, required: true }], initial: { [field.name]: initial } });
    const value = data?.[field.name];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export interface UserAdminActions {
    sendMagicLink: () => Promise<void>;
    sendPasswordReset: () => Promise<void>;
    sendVerificationEmail: () => Promise<void>;
    setVerification: (field: 'is_email_verified' | 'is_phone_verified', value: boolean, label: string) => Promise<void>;
    editDisplayName: () => Promise<void>;
    editUsername: () => Promise<void>;
    editEmail: () => Promise<void>;
    editPhone: () => Promise<void>;
    setPhone: () => Promise<void>;
    clearPhone: () => Promise<void>;
    editUser: () => Promise<void>;
    editAccount: () => Promise<void>;
    changePassword: () => Promise<void>;
    resetMfa: () => Promise<void>;
    toggleMfaRequirement: () => Promise<void>;
    disableTotp: () => Promise<void>;
    clearRateLimit: () => Promise<void>;
    revokeAllSessions: () => Promise<void>;
    resendInvite: () => Promise<void>;
    disableUser: () => Promise<void>;
    reactivateUser: () => Promise<void>;
    openAvatarModal: () => void;
    openPasskeysModal: () => void;
    openLinkedAccountsModal: () => void;
    openOrg: () => Promise<void>;
}

export function useUserAdminActions(
    user: UserRow,
    opts: { throttleRetry?: number; refetchThrottle?: () => void; onOpenGroup?: (groupId: number) => void } = {},
): UserAdminActions {
    const qc = useQueryClient();
    const save = UserModel.useSave();
    const disable = UserModel.useAction('disable');
    const reactivate = UserModel.useAction('reactivate');
    const sendInvite = UserModel.useAction('send_invite');
    const revokeSessions = UserModel.useAction('revoke_sessions');
    const changeUsername = UserModel.useAction('change_username');

    const fail = (err: unknown, fallback: string) =>
        toast.error(err instanceof Error ? err.message : fallback);

    /** model.save + toast + fallthrough (the source's _savePersonalField). */
    const saveFields = async (changes: Record<string, unknown>, label: string) => {
        try {
            await save.mutateAsync({ id: user.id, changes });
            toast.success(`${label} updated`);
        } catch (err) {
            fail(err, `Failed to update ${label.toLowerCase()}`);
        }
    };

    // ── Send flows ────────────────────────────────────────────────────

    const sendMagicLink = async () => {
        const email = user.email || null;
        const phone = user.phone_number || null;
        if (!email && !phone) {
            toast.error('User has no email or phone on file');
            return;
        }
        // Both channels on file → let the admin choose; one channel → plain
        // confirm (no fake choice).
        let channel = email ? 'email' : 'sms';
        if (email && phone) {
            const data = await formModal({
                title: 'Send magic login link',
                submitText: 'Send',
                fields: [{
                    name: 'channel', type: 'select', label: 'Send via', required: true,
                    options: [
                        { value: 'email', label: `Email link to ${email}` },
                        { value: 'sms', label: `Text link to ${phone}` },
                    ],
                }],
                initial: { channel: 'email' },
            });
            if (!data) return;
            channel = String(data.channel || 'email');
        } else {
            const ok = await modal.confirm({
                title: 'Send magic login link',
                message: <>Send a magic login link to <b>{email ?? phone}</b>?</>,
                confirmText: 'Send',
            });
            if (!ok) return;
        }
        // Identifier: email when present, else phone — the backend looks the
        // account up from either; method:'sms' routes delivery.
        const body: Record<string, unknown> = email ? { email } : { phone_number: phone };
        if (channel === 'sms') body.method = 'sms';
        try {
            await mojoCall('/api/auth/magic/send', { method: 'POST', body });
            toast.success('Magic login link sent');
        } catch (err) {
            fail(err, 'Failed to send magic link');
        }
    };

    const sendPasswordReset = async () => {
        const email = user.email || null;
        const phone = user.phone_number || null;
        if (!email && !phone) {
            toast.error('User has no email or phone on file');
            return;
        }
        // Backend delivery variants: email link, email code, SMS code. There
        // is NO SMS-link variant (link mode is email-only).
        const options: { value: string; label: string }[] = [];
        if (email) {
            options.push({ value: 'link', label: `Email a reset link to ${email}` });
            options.push({ value: 'code', label: `Email a 6-digit code to ${email}` });
        }
        if (phone) {
            options.push({ value: 'sms-code', label: `Text a 6-digit code to ${phone}` });
        }
        let delivery = options[0]!.value;
        if (options.length > 1) {
            const data = await formModal({
                title: 'Send password reset',
                submitText: 'Send',
                fields: [{ name: 'delivery', type: 'select', label: 'Delivery', required: true, options }],
                initial: { delivery },
            });
            if (!data) return;
            delivery = String(data.delivery || delivery);
        } else {
            const ok = await modal.confirm({
                title: 'Send password reset',
                message: <>{options[0]!.label}?</>,
                confirmText: 'Send',
            });
            if (!ok) return;
        }
        const body: Record<string, unknown> = email ? { email } : { phone_number: phone };
        if (delivery === 'link') {
            body.method = 'link';
        } else {
            body.method = 'code';
            if (delivery === 'sms-code') body.channel = 'sms';
        }
        try {
            await mojoCall('/api/auth/forgot', { method: 'POST', body });
            toast.success('Password reset sent');
        } catch (err) {
            fail(err, 'Failed to send password reset');
        }
    };

    const sendVerificationEmail = async () => {
        if (!user.email) {
            toast.error('User has no email on file');
            return;
        }
        const ok = await modal.confirm({
            title: 'Send verification email',
            message: <>Send a verification link to <b>{user.email}</b>?</>,
            confirmText: 'Send',
        });
        if (!ok) return;
        try {
            await mojoCall('/api/auth/email/verify/send', { method: 'POST', body: { email: user.email } });
            toast.success('Verification email sent');
        } catch (err) {
            fail(err, 'Failed to send verification email');
        }
    };

    // ── Verification overrides (admin force-verify / unverify) ────────

    const setVerification = async (field: 'is_email_verified' | 'is_phone_verified', value: boolean, label: string) => {
        const target = field === 'is_email_verified' ? user.email : user.phone_number;
        if (!target) {
            toast.error(`User has no ${label.toLowerCase()} on file`);
            return;
        }
        const verb = value ? 'Mark as verified' : 'Mark as unverified';
        const ok = await modal.confirm({
            title: `${verb} — ${label}`,
            message: <>{verb.toLowerCase().replace(/^m/, 'M')}: <b>{target}</b>?</>,
            confirmText: value ? 'Verify' : 'Unverify',
        });
        if (!ok) return;
        try {
            await save.mutateAsync({ id: user.id, changes: { [field]: value } });
            toast.success(`${label} ${value ? 'marked verified' : 'marked unverified'}`);
        } catch (err) {
            fail(err, 'Failed to update verification');
        }
    };

    // ── Identity pencils ──────────────────────────────────────────────

    const editDisplayName = async () => {
        const v = await promptField('Edit display name', { name: 'display_name', type: 'text', label: 'Display name' }, user.display_name ?? '');
        if (v != null) await saveFields({ display_name: v }, 'Display name');
    };
    const editUsername = async () => {
        const v = await promptField('Edit username', { name: 'username', type: 'text', label: 'Username' }, user.username ?? '');
        if (v == null) return;
        try {
            await changeUsername.mutateAsync({ id: user.id, payload: { username: v } });
            toast.success('Username updated');
        } catch (err) {
            fail(err, 'Failed to update username');
        }
    };
    const editEmail = async () => {
        const v = await promptField('Change email', { name: 'email', type: 'email', label: 'Email address' }, user.email ?? '');
        if (v != null) await saveFields({ email: v }, 'Email');
    };
    const editPhone = async () => {
        const v = await promptField('Change phone', {
            name: 'phone_number', type: 'tel', label: 'Phone number',
            placeholder: '+15555550142', help: 'E.164 — the server rejects pretty formats',
        }, user.phone_number ?? '');
        if (v != null) await saveFields({ phone_number: v }, 'Phone number');
    };
    const setPhone = async () => {
        const v = await promptField('Set phone', {
            name: 'phone_number', type: 'tel', label: 'Phone number',
            placeholder: '+15555550142', help: 'E.164 — the server rejects pretty formats',
        }, '');
        if (v != null) await saveFields({ phone_number: v }, 'Phone number');
    };
    const clearPhone = async () => {
        const ok = await modal.confirm({
            title: 'Clear phone',
            message: "Clear this user's phone number?",
            confirmText: 'Clear',
            danger: true,
        });
        if (!ok) return;
        await saveFields({ phone_number: null }, 'Phone number');
    };

    // ── Record modals ─────────────────────────────────────────────────

    const editUser = async () => {
        // User.EDIT_FORM port: email / display name / phone / org picker.
        const orgId = typeof user.org === 'object' && user.org ? user.org.id : typeof user.org === 'number' ? user.org : null;
        const data = await formModal({
            title: 'Edit user',
            submitText: 'Save',
            fields: [
                { name: 'email', type: 'email', label: 'Email' },
                { name: 'display_name', type: 'text', label: 'Display name' },
                {
                    name: 'phone_number', type: 'tel', label: 'Phone number',
                    placeholder: '+15555550142', help: 'E.164 — the server rejects pretty formats',
                },
                {
                    name: 'org', type: 'collection', label: 'Organization',
                    endpoint: '/api/group', labelField: 'name', valueField: 'id',
                    placeholder: 'None', help: 'Search groups by name.',
                },
            ],
            initial: {
                email: user.email ?? '',
                display_name: user.display_name ?? '',
                phone_number: user.phone_number ?? '',
                org: orgId,
            },
        });
        if (!data) return;
        const changes: Record<string, unknown> = {
            email: data.email,
            display_name: data.display_name,
            phone_number: data.phone_number === '' ? null : data.phone_number,
            org: data.org ?? null,
        };
        await saveFields(changes, 'User');
    };

    const editAccount = async () => {
        // Source modal carried is_active + is_staff too. Deliberate portal
        // deviations, both backend-grounded: is_active flips go through the
        // header toggle's disable/reactivate actions (services/disable.py is
        // the single source of truth — a bare is_active save bypasses the
        // lifecycle); is_staff is serialized by NO user graph, so a switch
        // here could only lie (and would clear the flag it cannot read).
        const meta = (user.metadata ?? {}) as Record<string, unknown>;
        const data = await formModal({
            title: 'Edit account',
            submitText: 'Save',
            fields: [
                {
                    name: 'requires_mfa', type: 'switch', label: 'Requires MFA',
                    help: 'User must complete a second factor at sign-in.',
                },
                { name: 'metadata.timezone', type: 'timezone', label: 'Timezone' },
            ],
            initial: {
                requires_mfa: user.requires_mfa === true,
                'metadata.timezone': typeof meta.timezone === 'string' ? meta.timezone : '',
            },
        });
        if (!data) return;
        const changes: Record<string, unknown> = { requires_mfa: data.requires_mfa === true };
        const tz = data['metadata.timezone'];
        changes.metadata = { timezone: typeof tz === 'string' ? tz : '' };
        await saveFields(changes, 'Account');
    };

    const changePassword = async () => {
        await modal.open((close) => <ChangePasswordModal user={user} onClose={() => close(null)} />);
    };

    // ── MFA ───────────────────────────────────────────────────────────

    const resetMfa = async () => {
        // disable_totp POST_SAVE_ACTION (admin-capable; no-ops gracefully
        // when nothing is enrolled). Default KEEPS requiring MFA: login with
        // requires_mfa and no enrolled methods proceeds without a challenge,
        // so the user is never locked out — they re-enroll or fall back to
        // verified-SMS / passkey MFA.
        const data = await formModal({
            title: 'Reset MFA',
            submitText: 'Reset MFA',
            fields: [{
                name: 'clear_requirement', type: 'switch',
                label: 'Also stop requiring MFA for this account',
                help: 'Leave off to keep MFA required — the user re-enrolls an authenticator at next login, or falls back to verified-SMS / passkey MFA.',
            }],
            initial: { clear_requirement: false },
        });
        if (!data) return;
        // One POST carries the action + the optional field, exactly like the
        // source (fields save before action handlers run server-side).
        const body: Record<string, unknown> = { disable_totp: true };
        if (data.clear_requirement === true) body.requires_mfa = false;
        try {
            await withFreshAuth(() => mojoCall(`/api/user/${user.id}`, { method: 'POST', body }));
            toast.success('MFA reset — authenticator enrollment cleared');
            await UserModel.invalidate(qc);
        } catch (err) {
            fail(err, 'Failed to reset MFA');
        }
    };

    const toggleMfaRequirement = async () => {
        const current = user.requires_mfa === true;
        const ok = await modal.confirm({
            title: `${current ? 'Disable' : 'Enable'} MFA requirement`,
            message: `${current ? 'Disable' : 'Enable'} the MFA requirement for this user?`,
            confirmText: current ? 'Disable' : 'Enable',
        });
        if (!ok) return;
        await saveFields({ requires_mfa: !current }, 'MFA requirement');
    };

    const disableTotp = async () => {
        const ok = await modal.confirm({
            title: 'Disable authenticator',
            message: 'Disable the authenticator app for this user? Their existing TOTP enrollment will be removed and they will need to re-enroll to use one again.',
            confirmText: 'Disable',
            danger: true,
        });
        if (!ok) return;
        try {
            await withFreshAuth(() => mojoCall(`/api/user/${user.id}`, { method: 'POST', body: { disable_totp: true } }));
            toast.success('Authenticator disabled');
            await UserModel.invalidate(qc);
        } catch (err) {
            fail(err, 'Failed to disable authenticator');
        }
    };

    // ── Rate limit / sessions / invite ────────────────────────────────

    const clearRateLimit = async () => {
        if (!opts.throttleRetry) {
            toast.info('No active rate limit to clear');
            return;
        }
        const ok = await modal.confirm({
            title: 'Clear rate limit',
            message: 'Clear the login rate-limit on this user? They will be able to attempt sign-in immediately.',
            confirmText: 'Clear',
        });
        if (!ok) return;
        try {
            await mojoCall('/api/auth/manage/clear_rate_limit', { method: 'POST', body: { key: 'login', user_id: user.id } });
            toast.success('Rate limit cleared');
            opts.refetchThrottle?.();
        } catch (err) {
            fail(err, 'Failed to clear rate limit');
        }
    };

    const revokeAllSessions = async () => {
        try {
            // A `response:'payload'` action — the toast text IS the server's
            // action response, not client copy.
            const outcome = await revokeSessions.mutateAsync({ id: user.id });
            toast.success(String(outcome.body.message ?? 'Sessions revoked'));
        } catch (err) {
            fail(err, 'Failed to revoke sessions');
        }
    };

    const resendInvite = async () => {
        if (!user.email) {
            toast.error('User has no email on file');
            return;
        }
        const ok = await modal.confirm({
            title: 'Resend invite',
            message: <>Resend the invite email to <b>{user.email}</b>?</>,
            confirmText: 'Send',
        });
        if (!ok) return;
        try {
            await sendInvite.mutateAsync({ id: user.id, payload: true });
            toast.success('Invite sent');
        } catch (err) {
            fail(err, 'Failed to send invite');
        }
    };

    // ── Disable lifecycle ─────────────────────────────────────────────

    const disableUser = async () => {
        // Reason is REQUIRED server-side (services/disable.py
        // USER_REST_REASONS = admin | abuse); note is the audit trail.
        const data = await formModal({
            ...UserModel.forms.disable!,
            intro: <>Disable <b>{user.display_name || user.username}</b>? They will no longer be able to sign in.</>,
        });
        if (!data) return;
        const payload: Record<string, unknown> = { reason: data.reason };
        if (data.note) payload.note = data.note;
        try {
            await disable.mutateAsync({ id: user.id, payload });
            toast.success('User disabled');
        } catch (err) {
            fail(err, 'Disable failed');
        }
    };

    const reactivateUser = async () => {
        // No prompt — reactivate is not destructive (source parity).
        try {
            await reactivate.mutateAsync({ id: user.id });
            toast.success('User reactivated');
        } catch (err) {
            fail(err, 'Reactivate failed');
        }
    };

    // ── Avatar / passkeys / linked accounts / org ─────────────────────

    const openAvatarModal = () => {
        let pending = false;
        void modal.open((close) => <AvatarModal user={user} onClose={() => close(null)} onPendingChange={(next) => { pending = next; }} />, { canDismiss: () => !pending });
    };

    const openPasskeysModal = () => {
        void modal.open((close) => <PasskeysModal userId={user.id} onClose={() => close(null)} />);
    };

    const openLinkedAccountsModal = () => {
        void modal.open((close) => (
            <div className="modal-pad">
                <h2 className="modal-title">Linked accounts</h2>
                <OAuthConnectionList userId={user.id} />
                <div className="modal-actions">
                    <button className="btn" onClick={() => close(null)}>Close</button>
                </div>
            </div>
        ));
    };

    const openOrg = async () => {
        const orgId = typeof user.org === 'object' && user.org ? user.org.id : typeof user.org === 'number' ? user.org : null;
        if (orgId == null) return;
        openGroupDetail(orgId, opts.onOpenGroup);
    };

    return {
        sendMagicLink, sendPasswordReset, sendVerificationEmail, setVerification,
        editDisplayName, editUsername, editEmail, editPhone, setPhone, clearPhone,
        editUser, editAccount, changePassword,
        resetMfa, toggleMfaRequirement, disableTotp,
        clearRateLimit, revokeAllSessions, resendInvite,
        disableUser, reactivateUser,
        openAvatarModal, openPasskeysModal, openLinkedAccountsModal, openOrg,
    };
}

// ── Modal bodies (proper components so hooks are legal) ───────────────

/**
 * Admin direct password set — `model.save({new_password})`; django-mojo lets
 * the users/manage_users tier set it without current_password. Built by hand
 * (not formModal) so the inputs are real type="password" controls with the
 * house strength meter.
 */
function ChangePasswordModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
    const save = UserModel.useSave();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!password) return setError('Password is required.');
        if (password !== confirm) return setError('Passwords do not match');
        setBusy(true);
        setError(null);
        try {
            await save.mutateAsync({ id: user.id, changes: { new_password: password } });
            toast.success('Password updated');
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to set password');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="modal-pad">
            <h2 className="modal-title">Set password</h2>
            <p className="dim" style={{ margin: '0 0 12px' }}>
                Set a new password for <b>{user.display_name || user.username}</b> directly.
            </p>
            <label className="field">
                <span className="field-label">New password</span>
                <input
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                />
            </label>
            <PasswordStrengthMeter password={password} />
            <label className="field" style={{ marginTop: 10 }}>
                <span className="field-label">Confirm password</span>
                <input
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                />
            </label>
            {error && <div className="field-error" role="alert">{error}</div>}
            <div className="modal-actions">
                <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
                    {busy ? 'Saving…' : 'Set password'}
                </button>
            </div>
        </div>
    );
}

/** Personal-scope upload followed by strict backend #1488 id/null attachment. */
function AvatarModal({ user, onClose, onPendingChange }: { user: UserRow; onClose: () => void; onPendingChange: (pending: boolean) => void }) {
    const save = UserModel.useSave();
    const [busy, setBusy] = useState(false);
    const [uploadPending, setUploadPending] = useState(false);
    const canManage = useAdminCaller();
    const [ownerResult, setOwnerResult] = useState<FileFieldOwnerResult>();
    const relationId = user.avatar?.id ?? null;
    const resultGeneration = useState(() => ({ current: 0 }))[0];

    useEffect(() => {
        onPendingChange(uploadPending || busy);
    }, [busy, onPendingChange, uploadPending]);
    useEffect(() => {
        if (!canManage) onClose();
    }, [canManage, onClose]);

    const attach = async (avatar: number | null) => {
        setBusy(true);
        try {
            const saved = await save.mutateAsync({ id: user.id, changes: { avatar } });
            setOwnerResult({ generation: ++resultGeneration.current, status: 'success', requestedValue: avatar, authoritativeValue: saved.avatar });
            const authoritative = saved.avatar?.id ?? null;
            if (authoritative !== avatar) throw new Error('The saved user did not confirm the requested avatar relation');
            toast.success(avatar == null ? 'Avatar cleared' : 'Avatar updated');
        } catch (err) {
            setOwnerResult({ generation: ++resultGeneration.current, status: 'failed', requestedValue: avatar });
            toast.error(err instanceof Error ? err.message : 'Failed to update avatar');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="modal-pad">
            <h2 className="modal-title">Avatar</h2>
            <p className="dim">Upload an image in your personal File scope, then attach its completed numeric File id to this user.</p>
            <ImageField
                value={relationId}
                onChange={(value) => { void attach(value); }}
                disabled={busy || !canManage}
                accept="image/*"
                edit={{
                    title: 'Edit avatar',
                    startMode: 'crop',
                    crop: { aspectRatio: 1, cropAndScale: { width: 200, height: 200 } },
                }}
                requireEdit
                ownerResult={ownerResult}
                onPendingChange={setUploadPending}
                onOrphan={(fileId) => toast.warning(`File #${fileId} remains uploaded but is not attached to this user.`)}
            />
            <div className="modal-actions">
                <button className="btn" onClick={onClose} disabled={busy || uploadPending}>Close</button>
            </div>
        </div>
    );
}

/**
 * Manage passkeys — list / rename / enable-disable / delete over
 * /api/account/passkeys (?user=<id>): the two REST-editable fields are
 * friendly_name and is_enabled; delete is real (CAN_DELETE).
 */
function PasskeysModal({ userId, onClose }: { userId: number; onClose: () => void }) {
    const { data, isPending } = PasskeyModel.useList({ user: userId, size: 25, sort: '-created' });
    const save = PasskeyModel.useSave();
    const del = PasskeyModel.useDelete();
    const rows = data?.rows ?? [];

    const rename = async (id: number, current: string | null) => {
        const data = await formModal({
            title: 'Edit passkey',
            submitText: 'Save',
            fields: [{
                name: 'friendly_name', type: 'text', label: 'Name', required: true,
                placeholder: 'My iPhone', help: 'A friendly name to identify this passkey',
            }],
            initial: { friendly_name: current ?? '' },
        });
        const name = data?.friendly_name;
        if (typeof name !== 'string' || !name.trim()) return;
        try {
            await save.mutateAsync({ id, changes: { friendly_name: name.trim() } });
            toast.success('Passkey updated');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update passkey');
        }
    };

    const toggleEnabled = async (id: number, next: boolean) => {
        try {
            await save.mutateAsync({ id, changes: { is_enabled: next } });
            toast.success(next ? 'Passkey enabled' : 'Passkey disabled');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update passkey');
        }
    };

    const remove = async (id: number) => {
        const ok = await modal.confirm({
            title: 'Delete passkey',
            message: 'Delete this passkey?',
            confirmText: 'Delete',
            danger: true,
        });
        if (!ok) return;
        try {
            await del.mutateAsync({ id });
            toast.success('Passkey deleted');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete passkey');
        }
    };

    return (
        <div className="modal-pad">
            <h2 className="modal-title">Passkeys</h2>
            {isPending && <p className="dim">Loading…</p>}
            {!isPending && rows.length === 0 && (
                <div className="us-empty">
                    <i className="bi bi-fingerprint" />
                    <div>No passkeys registered</div>
                </div>
            )}
            {rows.map((p) => (
                <div key={p.id} className="us-passkey-row">
                    <div className="us-row-icon"><i className="bi bi-fingerprint" /></div>
                    <div className="us-row-info">
                        <div className="us-row-title">
                            {p.friendly_name || 'Unnamed passkey'}
                            {!p.is_enabled && <Badge tone="muted">Disabled</Badge>}
                        </div>
                        <div className="us-row-meta">
                            Created {fmt.date(p.created)} · Last used {fmt.relative(p.last_used, 'never')} · {p.sign_count} uses
                        </div>
                    </div>
                    <div className="us-row-actions">
                        <button className="btn-icon btn-icon-sm" title="Rename" aria-label={`Rename ${p.friendly_name ?? 'passkey'}`} onClick={() => void rename(p.id, p.friendly_name)}>
                            <i className="bi bi-pencil" />
                        </button>
                        <button
                            className="btn-icon btn-icon-sm"
                            title={p.is_enabled ? 'Disable' : 'Enable'}
                            aria-label={p.is_enabled ? 'Disable passkey' : 'Enable passkey'}
                            onClick={() => void toggleEnabled(p.id, !p.is_enabled)}
                        >
                            <i className={`bi ${p.is_enabled ? 'bi-toggle-on' : 'bi-toggle-off'}`} />
                        </button>
                        <button className="btn-icon btn-icon-sm us-danger" title="Delete" aria-label="Delete passkey" onClick={() => void remove(p.id)}>
                            <i className="bi bi-trash" />
                        </button>
                    </div>
                </div>
            ))}
            <div className="modal-actions">
                <button className="btn" onClick={onClose}>Close</button>
            </div>
        </div>
    );
}
