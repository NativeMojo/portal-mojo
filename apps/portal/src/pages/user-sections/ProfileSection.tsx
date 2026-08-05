// Profile — UserProfileSection port (read in full 2026-08-05): identity
// cards with the admin credential actions, the Account summary rows (edit
// pencil → Edit Account modal), and Linked accounts (SSO providers + manage
// passkeys). Non-admin viewers see read-only cards + the send flows —
// contact-keyed actions stay ungated (the backend trusts the email/SMS
// recipient, not the JWT).
import { Badge, Eyebrow, FlatRow, SecurityItem, fmt } from 'portal-mojo/ui';
import { OAuthConnectionModel, type UserRow } from '../../models';
import type { UserAdminActions } from './actions';
import { accountType, providerIcon, useAdminCaller } from './shared';

export function ProfileSection({ user, actions }: { user: UserRow; actions: UserAdminActions }) {
    const isAdmin = useAdminCaller();
    const { data: connections } = OAuthConnectionModel.useList({ user: user.id, size: 25, sort: '-created' });
    const meta = (user.metadata ?? {}) as Record<string, unknown>;
    const timezone = typeof meta.timezone === 'string' ? meta.timezone : null;
    const hasEmail = Boolean(user.email);
    const hasPhone = Boolean(user.phone_number);
    const resetContact = user.email || user.phone_number || null;

    return (
        <>
            <Eyebrow>Personal</Eyebrow>
            <FlatRow
                label="Display name"
                action={isAdmin ? () => void actions.editDisplayName() : undefined}
            >
                {user.display_name ?? <span className="dim">—</span>}
            </FlatRow>

            <Eyebrow>Identity</Eyebrow>

            {/* Username card */}
            <SecurityItem icon="bi-at" title="Username" desc="">
                <code className="us-id-value">{user.username || '—'}</code>
                {isAdmin ? (
                    <button className="btn-icon btn-icon-sm" title="Edit username" aria-label="Edit username" onClick={() => void actions.editUsername()}>
                        <i className="bi bi-pencil" />
                    </button>
                ) : (
                    <button className="btn btn-compact" onClick={() => void actions.sendMagicLink()}>
                        <i className="bi bi-link-45deg" /> Send magic link
                    </button>
                )}
            </SecurityItem>

            {/* Email card — verify state + admin verification overrides */}
            <SecurityItem
                icon="bi-envelope"
                title="Email"
                desc={user.email ?? ''}
            >
                {hasEmail
                    ? <Badge tone={user.is_email_verified ? 'success' : 'warning'}>{user.is_email_verified ? 'Verified' : 'Unverified'}</Badge>
                    : <span className="dim-italic">Not set</span>}
                {isAdmin && hasEmail && user.is_email_verified && (
                    <button className="btn-icon btn-icon-sm" title="Mark as unverified" aria-label="Mark email as unverified" onClick={() => void actions.setVerification('is_email_verified', false, 'Email')}>
                        <i className="bi bi-x-circle" />
                    </button>
                )}
                {isAdmin && hasEmail && !user.is_email_verified && (
                    <>
                        <button className="btn-icon btn-icon-sm" title="Send verification email" aria-label="Send verification email" onClick={() => void actions.sendVerificationEmail()}>
                            <i className="bi bi-envelope-arrow-up" />
                        </button>
                        <button className="btn-icon btn-icon-sm" title="Force verify" aria-label="Force verify email" onClick={() => void actions.setVerification('is_email_verified', true, 'Email')}>
                            <i className="bi bi-patch-check" />
                        </button>
                    </>
                )}
                {isAdmin && (
                    <button className="btn-icon btn-icon-sm" title="Edit email" aria-label="Edit email" onClick={() => void actions.editEmail()}>
                        <i className="bi bi-pencil" />
                    </button>
                )}
                {!isAdmin && hasEmail && (
                    <button className="btn btn-compact" onClick={() => void actions.sendMagicLink()}>
                        <i className="bi bi-link-45deg" /> Send magic link
                    </button>
                )}
            </SecurityItem>

            {/* Phone card — set / clear / verify overrides */}
            <SecurityItem
                icon="bi-telephone"
                title="Phone"
                desc={user.phone_number ?? ''}
            >
                {hasPhone
                    ? <Badge tone={user.is_phone_verified ? 'success' : 'warning'}>{user.is_phone_verified ? 'Verified' : 'Unverified'}</Badge>
                    : <span className="dim-italic">Not set</span>}
                {isAdmin && hasPhone && (
                    <>
                        {user.is_phone_verified ? (
                            <button className="btn-icon btn-icon-sm" title="Mark as unverified" aria-label="Mark phone as unverified" onClick={() => void actions.setVerification('is_phone_verified', false, 'Phone')}>
                                <i className="bi bi-x-circle" />
                            </button>
                        ) : (
                            <button className="btn-icon btn-icon-sm" title="Force verify" aria-label="Force verify phone" onClick={() => void actions.setVerification('is_phone_verified', true, 'Phone')}>
                                <i className="bi bi-patch-check" />
                            </button>
                        )}
                        <button className="btn-icon btn-icon-sm" title="Clear phone" aria-label="Clear phone" onClick={() => void actions.clearPhone()}>
                            <i className="bi bi-x-lg" />
                        </button>
                        <button className="btn-icon btn-icon-sm" title="Edit phone" aria-label="Edit phone" onClick={() => void actions.editPhone()}>
                            <i className="bi bi-pencil" />
                        </button>
                    </>
                )}
                {isAdmin && !hasPhone && (
                    <button className="btn-icon btn-icon-sm" title="Set phone" aria-label="Set phone" onClick={() => void actions.setPhone()}>
                        <i className="bi bi-plus-lg" />
                    </button>
                )}
            </SecurityItem>

            {/* Password card — send-reset flow (email OR SMS code) */}
            <SecurityItem
                icon="bi-key"
                title="Password"
                desc={resetContact ? `Send a password reset link or code to ${resetContact}` : 'No email or phone on file'}
            >
                {resetContact && (
                    <button className="btn btn-compact" onClick={() => void actions.sendPasswordReset()}>
                        <i className="bi bi-envelope" /> Send reset…
                    </button>
                )}
            </SecurityItem>

            <Eyebrow>
                Account
                {isAdmin && (
                    <button className="btn-icon btn-icon-sm us-eyebrow-action" title="Edit account" aria-label="Edit account" onClick={() => void actions.editAccount()}>
                        <i className="bi bi-pencil" />
                    </button>
                )}
            </Eyebrow>
            <FlatRow label="Account type">{accountType(user)}</FlatRow>
            <FlatRow label="Status">
                <Badge tone={user.is_active ? 'success' : 'muted'}>{user.is_active ? 'Active' : 'Inactive'}</Badge>
            </FlatRow>
            <FlatRow label="MFA">
                <Badge tone={user.requires_mfa ? 'success' : 'muted'}>{user.requires_mfa ? 'Required' : 'Not required'}</Badge>
            </FlatRow>
            <FlatRow label="Last login">{fmt.relative(user.last_login, '—')}</FlatRow>
            <FlatRow label="Last seen">{fmt.relative(user.last_activity, '—')}</FlatRow>
            <FlatRow label="Timezone">
                {timezone ?? <span className="dim">—</span>}
            </FlatRow>

            <Eyebrow>
                Linked accounts
                <button className="btn-icon btn-icon-sm us-eyebrow-action" title="Manage linked accounts" aria-label="Manage linked accounts" onClick={() => actions.openLinkedAccountsModal()}>
                    <i className="bi bi-pencil" />
                </button>
            </Eyebrow>
            <FlatRow label="SSO providers">
                {(connections?.rows.length ?? 0) === 0
                    ? <span className="dim-italic">No linked accounts</span>
                    : (
                        <span className="chip-row">
                            {connections!.rows.map((c) => (
                                <span key={c.id} className="chip chip-muted">
                                    <i className={`bi ${providerIcon(c.provider)}`} /> {c.provider}{c.email ? ` · ${c.email}` : ''}
                                </span>
                            ))}
                        </span>
                    )}
            </FlatRow>
            <FlatRow label="2-factor">
                <Badge tone={user.requires_mfa ? 'success' : 'muted'}>{user.requires_mfa ? 'Required' : 'Not required'}</Badge>
                <a href="#" className="us-inline-link" onClick={(e) => { e.preventDefault(); actions.openPasskeysModal(); }}>Manage passkeys</a>
            </FlatRow>
        </>
    );
}
