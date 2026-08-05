// UserDetail — the DetailView proof: recreates the web-mojo UserView modal
// (header with chips + active switch; Profile / Security / Sessions rail;
// flat rows with edit pencils; danger action) as schema + small components.
import { useModel, useSaveModel, type User } from 'portal-mojo/client';
import { Badge, DetailView, Eyebrow, FlatRow, SecurityItem, fmt, formModal, modal, toast } from 'portal-mojo/ui';

const ENDPOINT = '/api/account/user';

export function UserDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const { data: user, isPending } = useModel<User>(ENDPOINT, id);
    const save = useSaveModel<User>(ENDPOINT);

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

    const deactivate = async () => {
        const ok = await modal.confirm({
            title: 'Deactivate account',
            message: <>Deactivate <b>{user.display_name}</b>? They will no longer be able to sign in.</>,
            confirmText: 'Deactivate',
            danger: true,
        });
        if (ok) await saveFields({ is_active: false }, 'Account deactivated');
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
            active={{ value: user.is_active, onChange: (next) => saveFields({ is_active: next }, next ? 'Activated' : 'Deactivated') }}
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
                                    <button className="danger-link" onClick={deactivate}>
                                        <i className="bi bi-exclamation-triangle" /> Deactivate Account
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
                                <button className="btn btn-compact" onClick={() => toast.success('Session revoked')}>Revoke</button>
                            </SecurityItem>
                        </>
                    ),
                },
            ]}
        />
    );
}
