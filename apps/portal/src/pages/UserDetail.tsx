// UserDetail — the UserView.js port (web-mojo admin/account/users/UserView.js,
// read in full 2026-08-05): DetailView modal with the Overview / Profile /
// Permissions / API Keys / Security / Sessions / Audit rail, header chips +
// active switch + kebab context menu, KPI cards, and the recent-activity
// timeline fed by /api/logs?uid=<id>.
//
// Fidelity notes vs the source:
//   · Profile is a FormView AUTOSAVE surface (no save buttons) — the C4 AC.
//     web-mojo's pencil-prompt-per-row flow collapses into inline editing.
//   · Permissions is the UserPermissionsSection port: switches over dotted
//     `permissions.<name>` fields; each flip batches into ONE save that the
//     backend dict-MERGES (JSONField semantics, proven in B3).
//   · The kebab carries the send-flows verified in django-mojo source:
//     /api/auth/magic/send + /api/auth/forgot (both always answer success —
//     anti-enumeration — and rate-limit at 5/5min per IP), plus the
//     when-gated Resend Invite and the destructive Revoke All Sessions.
//   · Sections web-mojo had but this backend doesn't serve (devices, login
//     locations, push, OAuth links) are NOT recreated against phantom
//     endpoints — they join with the admin program (#1260) as their REST
//     surfaces land.
import { mojoCall } from 'portal-mojo/client';
import {
    Badge, DetailView, Eyebrow, FlatRow, FormView, MetricCard, SecurityItem, Timeline,
    fmt, formModal, modal, toast,
    ArmedButton,
    type DetailMenuEntry, type Field, type TimelineItem, type Tone,
} from 'portal-mojo/ui';
import { ApiKeyModel, LogModel, UserModel } from '../models';
import type { User } from 'portal-mojo/client';

// ── Shared bits ───────────────────────────────────────────────────────

const LOG_TONE: Record<string, Tone> = {
    error: 'danger',
    critical: 'danger',
    warning: 'warning',
    info: 'info',
};

/** Loose-truthy permission read (backend stores true AND 1). */
const permCount = (u: User) =>
    Object.values(u.permissions ?? {}).filter((v) => v === true || v === 1).length;

const accountType = (u: User) =>
    u.is_superuser ? 'Superuser' : permCount(u) > 0 ? 'Staff' : 'User';

// ── Sections (components so hooks are legal per section) ──────────────

function OverviewSection({ user }: { user: User }) {
    const { data: logs } = LogModel.useList({ uid: user.id, size: 5, sort: '-id' });
    const items: TimelineItem[] = (logs?.rows ?? []).map((l) => ({
        tone: LOG_TONE[l.level] ?? 'muted',
        title: l.kind ?? l.level,
        body: l.log ? <span className="dim">{fmt.truncate(l.log, 90)}</span> : l.path ? <code>{l.path}</code> : undefined,
        meta: fmt.relative(l.created),
    }));
    return (
        <>
            <Eyebrow>Account snapshot</Eyebrow>
            <div className="grid gap-3 grid-cols-2 xl:grid-cols-4" style={{ marginBottom: 14 }}>
                <MetricCard label="Last login" value={fmt.relative(user.last_login)} />
                <MetricCard label="Last activity" value={fmt.relative(user.last_activity, '—')} />
                <MetricCard label="Status" value={user.is_active ? 'Active' : 'Inactive'} />
                <MetricCard label="Access" value={accountType(user)} />
            </div>

            <Eyebrow>Identity</Eyebrow>
            <FlatRow label="Display name">{user.display_name ?? <span className="dim">—</span>}</FlatRow>
            <FlatRow label="Email">
                {user.email} {user.is_email_verified && <Badge tone="success">Verified</Badge>}
            </FlatRow>
            <FlatRow label="Phone">
                {user.phone_number ? <code>{user.phone_number}</code> : <span className="dim">—</span>}
            </FlatRow>
            <FlatRow label="Username"><code>{user.username}</code></FlatRow>
            <FlatRow label="Account type">{accountType(user)}</FlatRow>

            <Eyebrow>Recent activity</Eyebrow>
            <Timeline items={items} emptyText="No recent activity yet." />
        </>
    );
}

/** Profile — inline autosave over the row's editable identity fields. */
const PROFILE_FIELDS: Field[] = [
    { name: 'display_name', type: 'text', label: 'Display name', columns: 6 },
    { name: 'username', type: 'text', label: 'Username', columns: 6 },
    { name: 'email', type: 'email', label: 'Email', columns: 6 },
    {
        name: 'phone_number', type: 'tel', label: 'Phone', columns: 6,
        placeholder: '+15555550142', help: 'E.164 — the server rejects pretty formats',
    },
];

function ProfileSection({ user }: { user: User }) {
    return (
        <>
            <Eyebrow>Contact</Eyebrow>
            <p className="dim" style={{ margin: '0 0 12px' }}>Edits save on commit — no save button.</p>
            <FormView model={UserModel} row={user} fields={PROFILE_FIELDS} />

            <Eyebrow>Account</Eyebrow>
            <FlatRow label="Status"><Badge>{user.is_active ? 'Active' : 'Inactive'}</Badge></FlatRow>
            <FlatRow label="Access">
                {user.is_superuser ? <Badge tone="primary">Superuser</Badge>
                    : permCount(user) > 0 ? <Badge tone="warning">Staff</Badge>
                    : <span className="dim">Standard</span>}
            </FlatRow>
            <FlatRow label="Last login">{fmt.relative(user.last_login)}</FlatRow>
            <FlatRow label="Last seen">{fmt.relative(user.last_activity, '—')}</FlatRow>
        </>
    );
}

/**
 * Permissions — UserPermissionsSection port. Dotted names → partial dicts →
 * the backend's JSONField merge; absent keys keep their grants. The mock
 * stores loose `1` grants on purpose — the switch pipeline must read them.
 */
const PERMISSION_FIELDS: Field[] = [
    { name: 'permissions.admin', type: 'switch', label: 'admin — full portal access', columns: 6 },
    { name: 'permissions.security', type: 'switch', label: 'security — incident tooling', columns: 6 },
    { name: 'permissions.users', type: 'switch', label: 'users — manage all users', columns: 6 },
    { name: 'permissions.groups', type: 'switch', label: 'groups — manage all groups', columns: 6 },
    { name: 'permissions.view_admin', type: 'switch', label: 'view_admin — see the System area', columns: 6 },
    { name: 'permissions.view_logs', type: 'switch', label: 'view_logs — read audit logs', columns: 6 },
    { name: 'permissions.manage_users', type: 'switch', label: 'manage_users — granular', columns: 6 },
    { name: 'permissions.manage_groups', type: 'switch', label: 'manage_groups — granular', columns: 6 },
];

function PermissionsSection({ user }: { user: User }) {
    return (
        <>
            <Eyebrow>System permissions</Eyebrow>
            <p className="dim" style={{ margin: '0 0 12px' }}>Toggles autosave as soon as you flip them.</p>
            <FormView model={UserModel} row={user} fields={PERMISSION_FIELDS} />
        </>
    );
}

function ApiKeysSection({ user }: { user: User }) {
    const { data } = ApiKeyModel.useList({ user: user.id, size: 25, sort: '-id' });
    const keys = data?.rows ?? [];
    return (
        <>
            <Eyebrow>API keys</Eyebrow>
            {keys.length === 0 && <p className="dim-italic">No API keys for this user.</p>}
            {keys.map((k) => (
                <SecurityItem
                    key={k.id}
                    icon="bi-key"
                    title={k.label || 'Unlabeled key'}
                    desc={`Created ${fmt.date(k.created)} · Expires ${fmt.date(k.expires)} · Last used ${fmt.relative(k.last_used, 'never')}`}
                >
                    <Badge tone={k.is_active ? 'success' : 'muted'}>{k.is_active ? 'Active' : 'Inactive'}</Badge>
                </SecurityItem>
            ))}
            <p className="dim" style={{ margin: '0 0 12px' }}>Keys are managed on the API Keys page — this is the per-user view.</p>
        </>
    );
}

function SecuritySection({ user, onVerifyFlip }: { user: User; onVerifyFlip: (field: string, next: boolean, label: string) => void }) {
    const sendReset = async () => {
        // Delivery variants the backend supports: email link or email code
        // (SMS-code only when a phone is on file; link mode is email-only).
        const options = [
            { value: 'link', label: `Email a reset link to ${user.email}` },
            { value: 'code', label: `Email a 6-digit code to ${user.email}` },
        ];
        const data = await formModal({
            title: 'Send password reset',
            submitText: 'Send',
            fields: [{ name: 'method', type: 'select', label: 'Delivery', required: true, options }],
        });
        if (!data) return;
        try {
            await mojoCall('/api/auth/forgot', { method: 'POST', body: { email: user.email, method: data.method } });
            toast.success('Password reset sent');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to send reset');
        }
    };
    return (
        <>
            <Eyebrow>Verification</Eyebrow>
            <SecurityItem icon="bi-envelope-check" title="Email" desc={user.email}>
                <Badge tone={user.is_email_verified ? 'success' : 'muted'}>{user.is_email_verified ? 'Verified' : 'Unverified'}</Badge>
                <button
                    className="btn btn-compact"
                    onClick={() => onVerifyFlip('is_email_verified', !user.is_email_verified, 'Email')}
                >
                    {user.is_email_verified ? 'Unverify' : 'Force verify'}
                </button>
            </SecurityItem>
            <SecurityItem icon="bi-phone" title="Phone" desc={user.phone_number ?? 'No phone on file'}>
                <Badge tone={user.is_phone_verified ? 'success' : 'muted'}>{user.is_phone_verified ? 'Verified' : 'Unverified'}</Badge>
                {user.phone_number && (
                    <button
                        className="btn btn-compact"
                        onClick={() => onVerifyFlip('is_phone_verified', !user.is_phone_verified, 'Phone')}
                    >
                        {user.is_phone_verified ? 'Unverify' : 'Force verify'}
                    </button>
                )}
            </SecurityItem>

            <Eyebrow>Sign-in</Eyebrow>
            <SecurityItem icon="bi-key" title="Password" desc="Send a reset link or code — the backend never enumerates accounts">
                <button className="btn btn-compact" onClick={() => void sendReset()}>Send reset…</button>
            </SecurityItem>
        </>
    );
}

function SessionsSection({ user, onRevoke }: { user: User; onRevoke: () => Promise<void> }) {
    return (
        <>
            <Eyebrow>Sessions</Eyebrow>
            <SecurityItem icon="bi-laptop" title="Active sessions" desc={`Last seen ${fmt.relative(user.last_activity, 'never')}`}>
                <Badge tone={user.is_online ? 'success' : 'muted'}>{user.is_online ? 'Online' : 'Offline'}</Badge>
            </SecurityItem>
            <div className="danger-zone">
                {/* Irreversible + no input → the armed-button idiom, not a confirm dialog. */}
                <ArmedButton
                    label="Revoke all sessions"
                    armedLabel="Click again — signs out every device"
                    icon="bi-x-octagon"
                    onConfirm={onRevoke}
                />
            </div>
        </>
    );
}

function AuditSection({ user }: { user: User }) {
    const { data } = LogModel.useList({ uid: user.id, size: 15, sort: '-id' });
    const items: TimelineItem[] = (data?.rows ?? []).map((l) => ({
        tone: LOG_TONE[l.level] ?? 'muted',
        title: l.kind ?? l.level,
        body: (
            <span className="dim">
                {l.log ? fmt.truncate(l.log, 110) : ''}
                {l.path && <> · <code>{l.path}</code></>}
            </span>
        ),
        meta: fmt.relative(l.created),
    }));
    return (
        <>
            <Eyebrow>Audit</Eyebrow>
            <Timeline items={items} emptyText="No activity recorded yet." />
        </>
    );
}

// ── The assembled detail modal ────────────────────────────────────────

export function UserDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const { data: user, isPending } = UserModel.useOne(id);
    const save = UserModel.useSave();
    const disable = UserModel.useAction('disable');
    const reactivate = UserModel.useAction('reactivate');
    const sendInvite = UserModel.useAction('send_invite');
    const revokeSessions = UserModel.useAction('revoke_sessions');
    const { data: keyList } = ApiKeyModel.useList({ user: id, size: 1 });

    if (isPending || !user) {
        return <div className="detail-loading"><span className="skel skel-block" /></div>;
    }

    /** Disable flow (UserView parity): collect reason + note, POST the action. */
    const disableUser = async (): Promise<void> => {
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
            toast.error(err instanceof Error ? err.message : 'Disable failed');
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
        try {
            // A `response: 'payload'` action — the toast text IS the server's
            // action response, not client copy.
            const outcome = await revokeSessions.mutateAsync({ id: user.id });
            toast.success(String(outcome.body.message ?? 'Sessions revoked'));
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to revoke sessions');
        }
    };

    const sendMagicLink = async () => {
        const ok = await modal.confirm({
            title: 'Send magic login link',
            message: <>Send a magic login link to <b>{user.email}</b>?</>,
            confirmText: 'Send',
        });
        if (!ok) return;
        try {
            await mojoCall('/api/auth/magic/send', { method: 'POST', body: { email: user.email } });
            toast.success('Magic login link sent');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to send magic link');
        }
    };

    /** Force-verify / unverify — a plain field save (admin-tier backend rule). */
    const flipVerification = (field: string, next: boolean, label: string) => {
        void (async () => {
            const ok = await modal.confirm({
                title: `${next ? 'Mark' : 'Unmark'} ${label.toLowerCase()} as verified`,
                message: <>Mark this user's {label.toLowerCase()} as <b>{next ? 'verified' : 'unverified'}</b>?</>,
                confirmText: next ? 'Verify' : 'Unverify',
            });
            if (!ok) return;
            try {
                await save.mutateAsync({ id: user.id, changes: { [field]: next } });
                toast.success(`${label} ${next ? 'marked verified' : 'marked unverified'}`);
            } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Save failed');
            }
        })();
    };

    // Kebab — UserView contextItems at ported scope. Contact-keyed send flows
    // stay ungated (the backend trusts the email recipient, not the JWT);
    // admin-tier items carry permissions; Resend Invite is `when`-gated.
    const MENU: DetailMenuEntry<User>[] = [
        { label: 'Send magic login link', icon: 'bi-link-45deg', onSelect: () => void sendMagicLink() },
        { divider: true },
        {
            label: 'Resend invite', icon: 'bi-envelope-plus', permissions: ['users', 'manage_users'],
            when: (u) => Boolean(u?.email) && u?.last_login == null,
            onSelect: () => void resendInvite(),
        },
        {
            label: 'Revoke all sessions', icon: 'bi-box-arrow-right', danger: true,
            permissions: ['users', 'manage_users'],
            onSelect: () => {
                void modal.confirm({
                    title: 'Revoke all sessions',
                    message: 'Revoke all sessions? The user will be signed out of all devices immediately.',
                    confirmText: 'Revoke',
                    danger: true,
                }).then((ok) => { if (ok) void revokeAllSessions(); });
            },
        },
    ];

    const keyCount = keyList?.count ?? 0;

    return (
        <DetailView<User>
            avatarName={user.display_name || user.username}
            title={user.display_name || user.username}
            subtitle={[user.email, user.phone_number].filter(Boolean).join(' · ')}
            chips={[
                ...(user.is_superuser ? [{ text: 'Superuser', tone: 'primary' as const }]
                    : permCount(user) > 0 ? [{ text: 'Staff', tone: 'info' as const }] : []),
                user.is_email_verified
                    ? { icon: 'bi-patch-check-fill', text: 'Email verified', tone: 'success' as const }
                    : { icon: 'bi-exclamation-circle', text: 'Unverified', tone: 'warning' as const },
                ...(user.is_phone_verified && user.phone_number
                    ? [{ icon: 'bi-patch-check-fill', text: 'Phone verified', tone: 'success' as const }] : []),
                ...(user.is_online ? [{ icon: 'bi-circle-fill', text: 'Online', tone: 'success' as const }] : []),
            ]}
            // Off → disable action (cancel leaves the switch on); on → reactivate.
            active={{ value: user.is_active, onChange: (next) => { void (next ? reactivateUser() : disableUser()); } }}
            contextMenu={MENU}
            menuContext={user}
            badges={{ ApiKeys: keyCount > 0 ? keyCount : null }}
            onClose={onClose}
            sections={[
                { key: 'Overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => <OverviewSection user={user} /> },
                { key: 'Profile', label: 'Profile', icon: 'bi-person', render: () => <ProfileSection user={user} /> },
                { divider: 'Access' },
                {
                    key: 'Permissions', label: 'Permissions', icon: 'bi-shield-check',
                    permissions: ['users', 'manage_users'],
                    render: () => <PermissionsSection user={user} />,
                },
                { key: 'ApiKeys', label: 'API Keys', icon: 'bi-key', render: () => <ApiKeysSection user={user} /> },
                { divider: 'Activity' },
                {
                    key: 'Security', label: 'Security', icon: 'bi-shield-lock',
                    render: () => <SecuritySection user={user} onVerifyFlip={flipVerification} />,
                },
                {
                    key: 'Sessions', label: 'Sessions', icon: 'bi-clock-history',
                    render: () => <SessionsSection user={user} onRevoke={revokeAllSessions} />,
                },
                {
                    key: 'Audit', label: 'Audit', icon: 'bi-journal-text',
                    permissions: ['view_logs', 'manage_logs', 'security'],
                    render: () => <AuditSection user={user} />,
                },
            ]}
        />
    );
}
