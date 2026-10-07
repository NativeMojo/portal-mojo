// The AccountModal's six flat sections (brief #7184, approved shape):
// Profile · Passkeys · Security · Sessions · Notifications · API keys.
// Each takes the signed-in `me` row and renders on its own — an app can
// mount any of them outside the modal (e.g. a settings page).
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { forgotPassword, getDuid, isPasskeyRegistrationSupported, revokeOtherSessions, type Me } from '../client/runtime';
import { Badge, FormView, fmt, modal, toast, useAvatarUrl } from '../ui';
import type { Field } from '../client/runtime';
import { disableTotp, type NotificationKind } from './api';
import {
    LoginEventModel, UserDeviceModel, browserLabel, deviceIcon,
    type LoginEventRow, type UserDeviceRow,
} from '../admin/security/devices/models';
import {
    accountErrorMessage, openAddPasskeyDialog, openAvatarDialog, openChangePasswordDialog,
    openEmailChangeDialog, openPhoneChangeDialog, openRecoveryCodesView, openRegenerateRecoveryCodes,
    openTotpEnrolDialog, openVerifyDialog,
} from './dialogs';
import { MeSaveModel, OAuthConnectionModel, accountKeys, invalidateMe, useRecoveryCodeStatus } from './models';
import { NotificationPreferences } from './NotificationPreferences';
import { PasskeyList } from './PasskeyList';
import { ApiKeysSection } from './sections/ApiKeysSection';

export interface AccountSectionProps {
    me: Me;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

function Row({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
    return (
        <div className="acct-row">
            <div className="acct-row-text">
                <span className="acct-row-label">{label}</span>
                <span className="acct-row-value">{value}</span>
            </div>
            {children && <div className="acct-row-actions">{children}</div>}
        </div>
    );
}

function Card({ icon, title, meta, metaTone, chip, children }: {
    icon: string;
    title: string;
    meta: ReactNode;
    metaTone?: 'warn';
    chip?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <div className="acct-card">
            <span className="acct-card-icon" aria-hidden="true"><i className={`bi ${icon}`} /></span>
            <div className="acct-card-info">
                <span className="acct-card-title">{title}{chip}</span>
                <span className={`acct-card-meta${metaTone === 'warn' ? ' is-warn' : ''}`}>{meta}</span>
            </div>
            {children && <div className="acct-card-actions">{children}</div>}
        </div>
    );
}

// ── Profile ───────────────────────────────────────────────────────────

const PERSONAL_FIELDS: Field[] = [
    { name: 'display_name', type: 'text', label: 'Display name', columns: 6 },
    { name: 'metadata.timezone', type: 'timezone', label: 'Timezone', columns: 6 },
];

export function AccountProfileSection({ me }: AccountSectionProps) {
    const [avatarSrc, onAvatarError] = useAvatarUrl(me.avatar?.id ?? null);
    const name = str(me.display_name) ?? str(me.email) ?? 'You';
    const email = str(me.email);
    const phone = str(me.phone_number);
    const emailVerified = me.is_email_verified === true;
    const phoneVerified = me.is_phone_verified === true;
    return (
        <div className="acct-stack">
            <div className="acct-identity">
                <div className="acct-avatar-wrap">
                    <span className="acct-avatar acct-avatar-lg" aria-hidden="true">
                        {avatarSrc ? <img src={avatarSrc} alt="" referrerPolicy="no-referrer" onError={onAvatarError} /> : fmt.initials(name)}
                    </span>
                    <button type="button" className="acct-avatar-edit" aria-label="Change photo" title="Change photo" onClick={() => void openAvatarDialog()}>
                        <i className="bi bi-camera" aria-hidden="true" />
                    </button>
                </div>
                <div className="acct-identity-text">
                    <span className="acct-identity-name">{name}</span>
                    <span className="acct-identity-sub">{[email, me.is_superuser ? 'System admin' : null].filter(Boolean).join(' · ')}</span>
                </div>
            </div>

            <section className="acct-block" aria-label="Contact">
                <div className="acct-label">Contact</div>
                <Row
                    label="Email"
                    value={email
                        ? <>{email} <Badge tone={emailVerified ? 'success' : 'warning'}>{emailVerified ? 'Verified' : 'Unverified'}</Badge></>
                        : <span className="dim-italic">Not set</span>}
                >
                    {email && !emailVerified && <button type="button" className="btn btn-compact" onClick={() => void openVerifyDialog('email')}>Verify</button>}
                    <button type="button" className="btn btn-compact" onClick={() => void openEmailChangeDialog()}>Change</button>
                </Row>
                <Row
                    label="Phone"
                    value={phone
                        ? <>{phone} <Badge tone={phoneVerified ? 'success' : 'warning'}>{phoneVerified ? 'Verified' : 'Unverified'}</Badge></>
                        : <span className="dim-italic">Not set</span>}
                >
                    {phone && !phoneVerified && <button type="button" className="btn btn-compact" onClick={() => void openVerifyDialog('phone')}>Verify</button>}
                    <button type="button" className="btn btn-compact" onClick={() => void openPhoneChangeDialog()}>{phone ? 'Change' : 'Add'}</button>
                </Row>
            </section>

            <section className="acct-block" aria-label="Personal">
                <div className="acct-label-row">
                    <span className="acct-label">Personal</span>
                    <span className="acct-hint">Saves as you type</span>
                </div>
                <FormView model={MeSaveModel} row={me} fields={PERSONAL_FIELDS} className="acct-form" />
            </section>

            <LinkedSignIns userId={me.id} />
        </div>
    );
}

const PROVIDERS: Record<string, { label: string; icon: string }> = {
    google: { label: 'Google', icon: 'bi-google' },
    apple: { label: 'Apple', icon: 'bi-apple' },
    github: { label: 'GitHub', icon: 'bi-github' },
    microsoft: { label: 'Microsoft', icon: 'bi-microsoft' },
    facebook: { label: 'Facebook', icon: 'bi-facebook' },
};
const provider = (name: string) => PROVIDERS[name.toLowerCase()] ?? { label: name.charAt(0).toUpperCase() + name.slice(1), icon: 'bi-link-45deg' };

/** The linked Google/Apple/… sign-ins, one row each, with Unlink. */
export function LinkedSignIns({ userId }: { userId: number }) {
    const { data } = OAuthConnectionModel.useList({ user: userId, size: 10, sort: '-created' });
    const del = OAuthConnectionModel.useDelete();
    const rows = data?.rows ?? [];
    if (rows.length === 0) return null;

    const unlink = async (id: number, label: string) => {
        const ok = await modal.confirm({
            title: `Unlink ${label}?`,
            message: <>You won&rsquo;t be able to sign in with <b>{label}</b> until you sign in with it again from the sign-in page. Your {label} account itself is untouched.</>,
            confirmText: 'Unlink',
            danger: true,
        });
        if (!ok) return;
        try {
            await del.mutateAsync({ id });
            toast.success(`${label} unlinked`);
        } catch (err) {
            // e.g. 400 "Cannot unlink your only login method. Set a password first." — as written.
            toast.error(accountErrorMessage(err));
        }
    };

    return (
        <section className="acct-block acct-linked" aria-label="Linked sign-ins">
            {rows.map((row) => {
                const p = provider(row.provider);
                return (
                    <div key={row.id} className="acct-row">
                        <div className="acct-linked-text">
                            <span className="acct-linked-icon" aria-hidden="true"><i className={`bi ${p.icon}`} /></span>
                            <span>Signed in with {p.label}{row.email && <> · <span className="dim">{row.email}</span></>}</span>
                        </div>
                        <div className="acct-row-actions">
                            <button type="button" className="btn btn-compact" disabled={del.isPending} onClick={() => void unlink(row.id, p.label)}>Unlink</button>
                        </div>
                    </div>
                );
            })}
        </section>
    );
}

// ── Passkeys ──────────────────────────────────────────────────────────

export function AccountPasskeysSection({ me }: AccountSectionProps) {
    const supported = isPasskeyRegistrationSupported();
    return (
        <div className="acct-stack acct-fill">
            <p className="acct-intro">Sign in with Touch ID, Face ID, Windows Hello or a security key instead of a password. A passkey works on the site it was made on.</p>
            <PasskeyList userId={me.id} showDisable={false} emptyText="No passkeys yet." />
            {supported
                ? (
                    <button type="button" className="acct-add" onClick={() => void openAddPasskeyDialog()}>
                        <i className="bi bi-plus-lg" aria-hidden="true" /> Add a passkey on this device
                    </button>
                )
                : <p className="acct-note">This browser can&rsquo;t create passkeys. Try a current Chrome, Safari, Edge or Firefox.</p>}
            <p className="acct-foot">Removing a passkey signs out nothing. Keep at least one other way to sign in.</p>
        </div>
    );
}

// ── Security ──────────────────────────────────────────────────────────

export function AccountSecuritySection({ me }: AccountSectionProps) {
    const qc = useQueryClient();
    const status = useRecoveryCodeStatus(me.id);
    const enrolled = status.data?.enrolled === true;
    const remaining = status.data?.remaining ?? 0;
    const required = me.requires_mfa === true;
    const hasPassword = me.has_password !== false;
    const email = str(me.email);

    const turnOff = async () => {
        const ok = await modal.confirm({
            title: 'Turn off the authenticator app?',
            message: required
                ? <>Codes from the app stop working right away. <b>Two-step sign-in stays required on this account</b> — finish signing in with a passkey or a verified phone, or set up a new app. Only an administrator can remove the requirement.</>
                : <>Codes from the app stop working right away and sign-in no longer asks for them.</>,
            confirmText: 'Turn off',
            danger: true,
        });
        if (!ok) return;
        try {
            await disableTotp();
            toast.success('Authenticator app turned off');
        } catch (err) {
            toast.error(accountErrorMessage(err));
        } finally {
            void qc.invalidateQueries({ queryKey: accountKeys.recoveryStatus(me.id) });
            void invalidateMe(qc);
        }
    };

    const setPassword = async () => {
        if (!email) return;
        try {
            await forgotPassword(email, 'link');
            toast.success(`We sent a link to ${email} to set your password.`);
        } catch (err) {
            toast.error(accountErrorMessage(err));
        }
    };

    return (
        <div className="acct-stack">
            <p className="acct-intro">
                {required ? 'Two-step sign-in is required on this account.' : 'Add an authenticator app for two-step sign-in.'} Passkeys have their own section.
            </p>
            <Card
                icon="bi-shield-lock"
                title="Authenticator app"
                chip={status.data && <Badge tone={enrolled ? 'success' : 'muted'}>{enrolled ? 'On' : 'Off'}</Badge>}
                meta={status.isPending ? 'Checking…' : enrolled ? 'Sign-in asks for a code from your app' : 'Use 1Password, Google Authenticator or a similar app'}
            >
                <button type="button" className="btn btn-compact" disabled={status.isPending} onClick={() => void openTotpEnrolDialog({ replacing: enrolled })}>
                    {enrolled ? 'Set up a new app' : 'Set up'}
                </button>
                {enrolled && <button type="button" className="btn btn-compact acct-danger" onClick={() => void turnOff()}>Turn off</button>}
            </Card>
            <Card
                icon="bi-key"
                title="Recovery codes"
                meta={enrolled ? `${remaining} of 8 left · regenerate a fresh set any time` : 'Available once an authenticator app is on'}
                metaTone={enrolled && remaining <= 2 ? 'warn' : undefined}
            >
                {enrolled && <button type="button" className="btn btn-compact" onClick={() => void openRecoveryCodesView()}>View</button>}
                {enrolled && <button type="button" className="btn btn-compact" onClick={() => void openRegenerateRecoveryCodes()}>Regenerate</button>}
            </Card>
            <Card
                icon="bi-asterisk"
                title="Password"
                meta={hasPassword ? 'Change it any time with your current password' : 'Not set — you sign in with a passkey or a linked account'}
            >
                {hasPassword
                    ? <button type="button" className="btn btn-compact" onClick={() => void openChangePasswordDialog()}>Change</button>
                    : <button type="button" className="btn btn-compact" disabled={!email} onClick={() => void setPassword()}>Email me a link</button>}
            </Card>
        </div>
    );
}

// ── Sessions ──────────────────────────────────────────────────────────

const ACTIVE_WINDOW_SECONDS = 5 * 60;

function osFamily(row: UserDeviceRow): string {
    const family = row.device_info?.os?.family;
    if (!family || family === 'Other') return 'unknown OS';
    return family === 'Mac OS X' ? 'macOS' : family;
}

function place(login: LoginEventRow | undefined): string | null {
    if (!login) return null;
    const parts = [login.city, login.region_code || login.region, login.city || login.region ? null : login.country_code].filter(Boolean);
    return parts.length ? parts.join(', ') : login.country_code ?? null;
}

export function AccountSessionsSection({ me }: AccountSectionProps) {
    const devices = UserDeviceModel.useList({ user: me.id, sort: '-last_seen', size: 4 });
    const logins = LoginEventModel.useList({ user: me.id, sort: '-created', size: 50, graph: 'default' });
    const thisDuid = getDuid();
    const rows = devices.data?.rows ?? [];
    const more = Math.max(0, (devices.data?.count ?? 0) - rows.length);
    const latestLogin = (duid: string) => (logins.data?.rows ?? []).find((row) => row.device?.duid === duid);
    const now = Date.now() / 1000;

    const revoke = async () => {
        const ok = await modal.confirm({
            title: 'Sign out everywhere else?',
            message: 'Every other browser and app signed in to your account is signed out now. This device stays signed in.',
            confirmText: 'Sign out others',
            danger: true,
        });
        if (!ok) return;
        try {
            await revokeOtherSessions();
            toast.success('Signed out of every other session');
        } catch (err) {
            toast.error(accountErrorMessage(err));
        }
    };

    return (
        <div className="acct-stack acct-fill">
            <p className="acct-intro">Devices that have used your account recently.</p>
            {devices.isPending && <div className="acct-skel" aria-busy="true"><span className="skel skel-block" /></div>}
            {devices.isError && <p className="dim" role="alert">{accountErrorMessage(devices.error)}</p>}
            {!devices.isPending && !devices.isError && rows.length === 0 && <p className="dim">No devices recorded yet.</p>}
            <ul className="acct-cards" aria-label="Devices">
                {rows.map((row) => {
                    const login = latestLogin(row.duid);
                    const isThis = row.duid === thisDuid;
                    const active = isThis || now - row.last_seen < ACTIVE_WINDOW_SECONDS;
                    const where = place(login);
                    const browser = browserLabel(row.device_info).replace(/ \d.*$/, '');
                    return (
                        <li key={row.id} className="acct-card">
                            <span className="acct-card-icon" aria-hidden="true"><i className={`bi ${deviceIcon(row.device_info)}`} /></span>
                            <div className="acct-card-info">
                                <span className="acct-card-title">{browser} on {osFamily(row)}</span>
                                <span className="acct-card-meta">{[where, active ? 'active now' : fmt.relative(row.last_seen)].filter(Boolean).join(' · ')}</span>
                            </div>
                            <div className="acct-card-actions">
                                {isThis && <Badge tone="success">This device</Badge>}
                                {login && (login.is_new_country || login.is_new_region) && <Badge tone="warning">New location</Badge>}
                            </div>
                        </li>
                    );
                })}
            </ul>
            {more > 0 && <p className="acct-note">And {more} more device{more === 1 ? '' : 's'}.</p>}
            <div className="acct-signout-others">
                <span>Don&rsquo;t recognise one? Sign the others out. This device stays signed in.</span>
                <button type="button" className="btn btn-compact acct-danger" onClick={() => void revoke()}>Sign out everywhere else</button>
            </div>
        </div>
    );
}

// ── Notifications ─────────────────────────────────────────────────────

export function AccountNotificationsSection({ kinds }: AccountSectionProps & { kinds?: NotificationKind[] }) {
    return <NotificationPreferences kinds={kinds} />;
}

// ── API keys ──────────────────────────────────────────────────────────

export function AccountApiKeysSection({ me }: AccountSectionProps) {
    return <ApiKeysSection user={{ id: me.id, display_name: str(me.display_name), email: str(me.email) }} canManage isSelf />;
}
