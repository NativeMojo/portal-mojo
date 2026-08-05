// UserDetail — the DetailView proof: recreates the web-mojo UserView modal
// (header with chips + active switch; Profile / Security / Sessions rail;
// flat rows with edit pencils; danger action) as schema + small components.
// Field edits go through UserModel.useSave; the disable / reactivate /
// send_invite / revoke_sessions flows are the backend's POST_SAVE_ACTIONS,
// driven through UserModel.useAction (B1).
import { Badge, DetailView, Eyebrow, FlatRow, SecurityItem, fmt, formModal, modal, toast } from 'portal-mojo/ui';
import { UserModel } from '../models';

export function UserDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const { data: user, isPending } = UserModel.useOne(id);
    const save = UserModel.useSave();
    const disable = UserModel.useAction('disable');
    const reactivate = UserModel.useAction('reactivate');
    const sendInvite = UserModel.useAction('send_invite');
    const revokeSessions = UserModel.useAction('revoke_sessions');

    if (isPending || !user) {
        return <div className="detail-loading"><span className="skel skel-block" /></div>;
    }

    const saveFields = async (changes: Record<string, unknown>, message = 'Saved') => {
        try {
            await save.mutateAsync({ id: user.id, changes });
            toast.success(message);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Save failed');
        }
    };

    const editContact = async () => {
        const data = await formModal({
            title: 'Edit contact',
            fields: [
                { name: 'display_name', type: 'text', label: 'Display name', required: true },
                { name: 'email', type: 'email', label: 'Email', required: true },
                { name: 'phone', type: 'tel', label: 'Phone', placeholder: '+1 (555) 0100' },
            ],
            initial: { display_name: user.display_name, email: user.email, phone: user.phone ?? '' },
        });
        if (data) await saveFields(data, 'Contact updated');
    };

    /** Disable flow (UserView parity): collect reason + note, POST the action. */
    const disableUser = async (): Promise<boolean> => {
        const data = await formModal({
            ...UserModel.forms.disable!,
            intro: <>Disable <b>{user.display_name}</b>? They will no longer be able to sign in.</>,
        });
        if (!data) return false;
        const payload: Record<string, unknown> = { reason: data.reason };
        if (data.note) payload.note = data.note;
        try {
            await disable.mutateAsync({ id: user.id, payload });
            toast.success('User disabled');
            return true;
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Disable failed');
            return false;
        }
    };

    const reactivateUser = async () => {
        try {
            await reactivate.mutateAsync({ id: user.id });
            toast.success('User reactivated');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Reactivate failed');
        }
    };

    const resendInvite = async () => {
        const ok = await modal.confirm({
            title: 'Resend invite',
            message: <>Resend the invite email to <b>{user.email}</b>?</>,
            confirmText: 'Send',
        });
        if (!ok) return;
        try {
            await sendInvite.mutateAsync({ id: user.id });
            toast.success('Invite sent');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to send invite');
        }
    };

    const revokeAllSessions = async () => {
        const ok = await modal.confirm({
            title: 'Revoke all sessions',
            message: 'Revoke all sessions? The user will be signed out of all devices immediately.',
            confirmText: 'Revoke',
            danger: true,
        });
        if (!ok) return;
        try {
            // A `response: 'payload'` action — the toast text IS the server's
            // action response, not client copy.
            const outcome = await revokeSessions.mutateAsync({ id: user.id });
            toast.success(String(outcome.body.message ?? 'Sessions revoked'));
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to revoke sessions');
        }
    };

    return (
        <DetailView
            avatarName={user.display_name}
            title={user.display_name}
            subtitle={user.email}
            chips={[
                user.email_verified
                    ? { icon: 'bi-patch-check-fill', text: 'Email', tone: 'success' }
                    : { icon: 'bi-exclamation-circle', text: 'Unverified', tone: 'warning' },
                ...(user.role !== 'user' ? [{ text: user.role, tone: fmt.inferTone(user.role) }] : []),
            ]}
            // Off → disable action (cancel leaves the switch on); on → reactivate.
            active={{ value: user.is_active, onChange: (next) => { void (next ? reactivateUser() : disableUser()); } }}
            onClose={onClose}
            sections={[
                {
                    key: 'profile', label: 'Profile', icon: 'bi-person', render: () => (
                        <>
                            <Eyebrow>Contact</Eyebrow>
                            <FlatRow label="Email" action={editContact}>
                                {user.email} {user.email_verified && <Badge tone="success">Verified</Badge>}
                            </FlatRow>
                            <FlatRow label="Phone" action={editContact} actionIcon={user.phone ? 'bi-pencil' : 'bi-plus-lg'}>
                                {user.phone ?? <span className="dim-italic">Not set</span>}
                            </FlatRow>

                            <Eyebrow>Account</Eyebrow>
                            <FlatRow label="Username">{user.email}</FlatRow>
                            <FlatRow label="Status"><Badge>{user.is_active ? 'Active' : 'Inactive'}</Badge></FlatRow>
                            <FlatRow label="Role"><span className="cap">{user.role}</span></FlatRow>
                            <FlatRow label="MFA">
                                {user.mfa_enabled ? <Badge tone="success">Enabled</Badge> : <Badge tone="muted">Not required</Badge>}
                            </FlatRow>
                            <FlatRow label="Member Since">{fmt.date(user.created)}</FlatRow>
                            <FlatRow label="Last Login">{fmt.relative(user.last_login)}</FlatRow>

                            {user.is_active && (
                                <div className="danger-zone">
                                    <button className="danger-link" onClick={() => void disableUser()}>
                                        <i className="bi bi-exclamation-triangle" /> Disable Account
                                    </button>
                                </div>
                            )}
                        </>
                    ),
                },
                { divider: 'Security' },
                {
                    key: 'security', label: 'Security', icon: 'bi-shield-check', render: () => (
                        <>
                            <Eyebrow>Sign-in methods</Eyebrow>
                            <SecurityItem icon="bi-key" title="Password" desc="Last changed over a year ago">
                                <button className="btn btn-compact" onClick={() => toast.info('Reset link sent')}>Send reset</button>
                            </SecurityItem>
                            <SecurityItem icon="bi-phone" title="Two-factor authentication" desc={user.mfa_enabled ? 'TOTP app configured' : 'Not configured'}>
                                <Badge tone={user.mfa_enabled ? 'success' : 'muted'}>{user.mfa_enabled ? 'On' : 'Off'}</Badge>
                            </SecurityItem>
                            <SecurityItem icon="bi-fingerprint" title="Passkeys" desc={user.passkeys > 0 ? `${user.passkeys} registered` : 'None registered'}>
                                <Badge tone={user.passkeys > 0 ? 'success' : 'muted'}>{user.passkeys}</Badge>
                            </SecurityItem>
                            {user.last_login == null && (
                                // `when` gate (UserView parity): only a user who has
                                // never signed in gets the resend-invite affordance.
                                <SecurityItem icon="bi-envelope-paper" title="Invite" desc="Never signed in">
                                    <button className="btn btn-compact" onClick={() => void resendInvite()}>Resend invite</button>
                                </SecurityItem>
                            )}
                        </>
                    ),
                },
                { divider: 'Activity' },
                {
                    key: 'sessions', label: 'Sessions', icon: 'bi-clock-history', render: () => (
                        <>
                            <Eyebrow>Recent sessions</Eyebrow>
                            <SecurityItem icon="bi-laptop" title="MacBook Pro · Safari" desc={`San Francisco, US · ${fmt.relative(user.last_login)}`}>
                                <Badge tone="success">Current</Badge>
                            </SecurityItem>
                            <SecurityItem icon="bi-phone" title="iPhone · Mojo App" desc="San Francisco, US · 2 months ago">
                                <Badge tone="muted">2 mo</Badge>
                            </SecurityItem>
                            <div className="danger-zone">
                                <button className="danger-link" onClick={() => void revokeAllSessions()}>
                                    <i className="bi bi-x-octagon" /> Revoke All Sessions
                                </button>
                            </div>
                        </>
                    ),
                },
            ]}
        />
    );
}
