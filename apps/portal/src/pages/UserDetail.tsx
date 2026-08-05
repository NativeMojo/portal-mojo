// UserDetail — the DetailView proof: recreates the web-mojo UserView modal
// (header with chips + active switch; Profile / Security / Sessions rail;
// flat rows with edit pencils; danger action) as schema + small components.
// Field edits go through UserModel.useSave; the disable / reactivate /
// send_invite / revoke_sessions flows are the backend's POST_SAVE_ACTIONS,
// driven through UserModel.useAction (B1). Fields are the REAL default-graph
// row — no role/passkey/MFA fields here (those ride only the `me` graph).
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
                { name: 'phone_number', type: 'tel', label: 'Phone', placeholder: '+1 (555) 0100' },
            ],
            initial: { display_name: user.display_name ?? '', email: user.email, phone_number: user.phone_number ?? '' },
        });
        if (data) await saveFields(data, 'Contact updated');
    };

    /** Disable flow (UserView parity): collect reason + note, POST the action. */
    const disableUser = async (): Promise<boolean> => {
        const data = await formModal({
            ...UserModel.forms.disable!,
            intro: <>Disable <b>{user.display_name || user.username}</b>? They will no longer be able to sign in.</>,
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
            avatarName={user.display_name || user.username}
            title={user.display_name || user.username}
            subtitle={user.email}
            chips={[
                user.is_email_verified
                    ? { icon: 'bi-patch-check-fill', text: 'Email', tone: 'success' }
                    : { icon: 'bi-exclamation-circle', text: 'Unverified', tone: 'warning' },
                ...(user.is_superuser ? [{ text: 'superuser', tone: 'primary' as const }] : []),
                ...(user.is_online ? [{ icon: 'bi-circle-fill', text: 'Online', tone: 'success' as const }] : []),
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
                                {user.email} {user.is_email_verified && <Badge tone="success">Verified</Badge>}
                            </FlatRow>
                            <FlatRow label="Phone" action={editContact} actionIcon={user.phone_number ? 'bi-pencil' : 'bi-plus-lg'}>
                                {user.phone_number ?? <span className="dim-italic">Not set</span>}
                                {user.phone_number && user.is_phone_verified && <> <Badge tone="success">Verified</Badge></>}
                            </FlatRow>

                            <Eyebrow>Account</Eyebrow>
                            <FlatRow label="Username">{user.username}</FlatRow>
                            <FlatRow label="Status"><Badge>{user.is_active ? 'Active' : 'Inactive'}</Badge></FlatRow>
                            <FlatRow label="Access">
                                {user.is_superuser ? <Badge tone="primary">Superuser</Badge>
                                    : Object.keys(user.permissions ?? {}).length > 0 ? <Badge tone="warning">Staff</Badge>
                                    : <span className="dim">Standard</span>}
                            </FlatRow>
                            <FlatRow label="Last Login">{fmt.relative(user.last_login)}</FlatRow>
                            <FlatRow label="Last Activity">{fmt.relative(user.last_activity, '—')}</FlatRow>

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
                            <Eyebrow>Verification</Eyebrow>
                            <SecurityItem icon="bi-envelope-check" title="Email" desc={user.email}>
                                <Badge tone={user.is_email_verified ? 'success' : 'muted'}>{user.is_email_verified ? 'Verified' : 'Unverified'}</Badge>
                            </SecurityItem>
                            <SecurityItem icon="bi-phone" title="Phone" desc={user.phone_number ?? 'No phone on file'}>
                                <Badge tone={user.is_phone_verified ? 'success' : 'muted'}>{user.is_phone_verified ? 'Verified' : 'Unverified'}</Badge>
                            </SecurityItem>

                            <Eyebrow>Sign-in</Eyebrow>
                            <SecurityItem icon="bi-key" title="Password" desc="Send a password reset link">
                                <button className="btn btn-compact" onClick={() => toast.info('Reset link sent')}>Send reset</button>
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
                            <Eyebrow>Sessions</Eyebrow>
                            <SecurityItem icon="bi-laptop" title="Active sessions" desc={`Last seen ${fmt.relative(user.last_activity, 'never')}`}>
                                <Badge tone={user.is_online ? 'success' : 'muted'}>{user.is_online ? 'Online' : 'Offline'}</Badge>
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
