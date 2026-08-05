// Security — AdminSecuritySection port (read in full 2026-08-05):
// Authentication rows (send reset / magic link / admin set-password), MFA
// rows (requirement toggle, authenticator state, SMS eligibility, passkeys),
// Sessions (revoke all — the ArmedButton treatment kept from the earlier
// port). Every action routes through the canonical handlers in actions.tsx
// (the source's Phase 4 dedup: one handler per action across kebab + cards +
// this section).
//
// Deviations, backend-grounded (django-mojo read 2026-08-05):
//   · TOTP enrollment state: NO user graph serializes has_totp — the source
//     getter fell back to "Not enrolled" against this backend and we keep
//     that exact degrade (fields stay optional; a future graph extra lights
//     it up). The disable affordance appears only when the state IS known.
//   · Recovery codes: the source's GET /api/user/<id>/totp/recovery-codes
//     route does not exist (codes are self-only at /api/account/totp/…) —
//     row omitted rather than shipped against a phantom endpoint.
import { Badge, Eyebrow, SecurityItem, ArmedButton, fmt } from 'portal-mojo/ui';
import { PasskeyModel, type UserRow } from '../../models';
import type { UserAdminActions } from './actions';
import { useAdminCaller } from './shared';

/** has_totp / totp_enabled ride no current graph — optional by design. */
type UserSecurityRow = UserRow & { has_totp?: boolean; totp_enabled?: boolean };

export function SecuritySection({ user, actions }: { user: UserRow; actions: UserAdminActions }) {
    const isAdmin = useAdminCaller();
    const su = user as UserSecurityRow;
    const totpEnabled = Boolean(su.has_totp || su.totp_enabled);
    const smsEligible = Boolean(user.phone_number && user.is_phone_verified);
    const { data: passkeys } = PasskeyModel.useList({ user: user.id, size: 25, sort: '-created' });
    const passkeyCount = passkeys?.count ?? 0;
    const hasPasskey = user.has_passkey === true || passkeyCount > 0;

    return (
        <>
            <Eyebrow>Authentication</Eyebrow>

            <SecurityItem icon="bi-envelope" title="Send password reset" desc={`Send a reset link or code to ${user.email || user.phone_number || 'this user'}`}>
                <button className="btn btn-compact" onClick={() => void actions.sendPasswordReset()}>Send…</button>
            </SecurityItem>

            <SecurityItem icon="bi-link-45deg" title="Send magic login link" desc={`Send a one-click login link to ${user.email || user.phone_number || 'this user'}`}>
                <button className="btn btn-compact" onClick={() => void actions.sendMagicLink()}>Send…</button>
            </SecurityItem>

            {isAdmin && (
                <SecurityItem icon="bi-key" title="Set password" desc="Set a new password directly for this user">
                    <button className="btn btn-compact" onClick={() => void actions.changePassword()}>Set…</button>
                </SecurityItem>
            )}

            <Eyebrow>Multi-factor authentication</Eyebrow>

            {isAdmin && (
                <SecurityItem
                    icon="bi-shield-lock"
                    title="MFA requirement"
                    desc={user.requires_mfa ? 'User is required to use MFA' : 'MFA is not required for this user'}
                >
                    <Badge tone={user.requires_mfa ? 'success' : 'muted'}>{user.requires_mfa ? 'Required' : 'Not required'}</Badge>
                    <button className="btn btn-compact" onClick={() => void actions.toggleMfaRequirement()}>
                        {user.requires_mfa ? 'Disable' : 'Enable'}
                    </button>
                </SecurityItem>
            )}

            <SecurityItem
                icon="bi-key"
                title="Authenticator (TOTP)"
                desc={totpEnabled
                    ? 'User has an authenticator app enrolled'
                    : 'No enrolled authenticator on record'}
            >
                <Badge tone={totpEnabled ? 'success' : 'muted'}>{totpEnabled ? 'Enrolled' : 'Not enrolled'}</Badge>
                {isAdmin && totpEnabled && (
                    <button className="btn btn-compact" onClick={() => void actions.disableTotp()}>Disable</button>
                )}
            </SecurityItem>

            <SecurityItem
                icon="bi-phone"
                title="SMS verification"
                desc={smsEligible
                    ? 'Verified phone available — SMS-based MFA can be used'
                    : 'No verified phone on file — SMS-based MFA unavailable'}
            >
                <Badge tone={smsEligible ? 'success' : 'muted'}>{smsEligible ? 'Eligible' : 'Unavailable'}</Badge>
            </SecurityItem>

            <SecurityItem icon="bi-fingerprint" title="Passkeys" desc="View and manage registered passkeys">
                {hasPasskey && <Badge tone="success">{passkeyCount > 0 ? `${passkeyCount} registered` : 'Registered'}</Badge>}
                <button className="btn btn-compact" onClick={() => actions.openPasskeysModal()}>
                    Manage <i className="bi bi-chevron-right" />
                </button>
            </SecurityItem>

            {isAdmin && (
                <>
                    <Eyebrow>Sessions</Eyebrow>
                    <SecurityItem
                        icon="bi-box-arrow-right"
                        title="Revoke all sessions"
                        desc={`Force sign-out from all devices · last seen ${fmt.relative(user.last_activity, 'never')}`}
                    >
                        {/* Irreversible + no input → the armed-button idiom. */}
                        <ArmedButton
                            label="Revoke all sessions"
                            armedLabel="Click again — signs out every device"
                            icon="bi-x-octagon"
                            onConfirm={actions.revokeAllSessions}
                        />
                    </SecurityItem>
                </>
            )}
        </>
    );
}
