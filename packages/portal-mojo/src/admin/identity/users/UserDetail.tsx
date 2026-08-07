// UserDetail — the FULL UserView.js port (web-mojo admin/account/users/
// UserView.js, 2511 lines + its five admin sections, ALL read in full
// 2026-08-05): DetailView modal with the complete section map
//
//   Identity: Overview · Profile · Personal · Security · OAuth
//   Access:   Groups · Sys Perms · App Perms(when registered) · API Keys
//   Activity: Devices · Logins · Audit
//   Settings: Notifications · Metadata
//
// plus header parity (presence, reason-keyed status badge, throttle chip,
// inactivity warning, verified/2FA/role chips, active toggle → disable-flow
// modal) and the full kebab. Sections live in ./sections/* — one file
// per section; ./sections/actions.tsx holds the canonical handler per
// action (kebab + Profile cards + Security rows share them, the source's
// Phase 4 dedup).
//
// Header deviations forced by DetailView's prop surface (read-only this
// wave — MERGE-WIRE notes filed): chips are not clickable, so the org chip's
// click-through lives in the kebab ("Open organization") and as an Overview
// row link; the avatar slot renders initials (no image/click slot), so the
// shared ImageField avatar manager hangs off the kebab;
// presence/status/locked/warning render as chips instead of a two-row aux.
import { useSyncExternalStore } from 'react';
import { useCan, useMe } from '../../../client';
import {
    DetailView, getFormTabs, subscribeFormTabs, fmt, modal,
    type Chip, type DetailMenuEntry,
} from '../../../ui';
import {
    USER_DEVICE_PERMISSIONS, USER_EVENT_PERMISSIONS, USER_LOGIN_PERMISSIONS,
    USER_LOG_PERMISSIONS, USER_MANAGE_PERMISSIONS, USER_PUSH_DEVICE_PERMISSIONS,
    UserModel, type UserRow,
} from './models';
import { MEMBER_READ_PERMISSIONS } from '../members';
import { useUserAdminActions } from './sections/actions';
import { useSharedUserQueries } from './sections/queries';
import {
    accountType, inactivityWarning, isAnonymized, isOnline, statusBadge, useAdminCaller,
} from './sections/shared';
import { USER_APP_PERMS_TABSET } from './sections/permission-catalog';
import { OverviewSection } from './sections/OverviewSection';
import { ProfileSection } from './sections/ProfileSection';
import { PersonalSection } from './sections/PersonalSection';
import { SecuritySection } from './sections/SecuritySection';
import { OAuthSection } from './sections/OAuthSection';
import { GroupsSection } from './sections/GroupsSection';
import { AppPermsSection, SysPermsSection } from './sections/PermissionsSection';
import { ApiKeysSection } from './sections/ApiKeysSection';
import { DevicesSection } from './sections/DevicesSection';
import { LoginsSection } from './sections/LoginsSection';
import { AuditSection } from './sections/AuditSection';
import { NotificationsSection } from './sections/NotificationsSection';
import { UserMetadataSection } from './sections/MetadataPanel';

export interface UserDetailProps {
    id: number;
    onClose: () => void;
    onOpenGroup?: (groupId: number) => void;
}

export function UserDetail({ id, onClose, onOpenGroup }: UserDetailProps) {
    const { data: user, isPending } = UserModel.useOne(id);
    const isAdmin = useAdminCaller();
    // App Perms renders only when an app registered tabs — the portal's
    // `User.APP_PERMISSION_FIELDS.length > 0` gate, live via the registry
    // subscription (late registration adds the section without a remount).
    const appPermsCount = useSyncExternalStore(
        subscribeFormTabs,
        () => getFormTabs(USER_APP_PERMS_TABSET).length,
        () => 0,
    );

    if (isPending || !user) {
        return <div className="detail-loading"><span className="skel skel-block" /></div>;
    }
    return <UserDetailLoaded user={user} isAdmin={isAdmin} hasAppPerms={appPermsCount > 0} onClose={onClose} onOpenGroup={onOpenGroup} />;
}

function UserDetailLoaded({ user, isAdmin, hasAppPerms, onClose, onOpenGroup }: {
    user: UserRow;
    isAdmin: boolean;
    hasAppPerms: boolean;
    onClose: () => void;
    onOpenGroup?: (groupId: number) => void;
}) {
    const { data: me } = useMe();
    const isSelf = me?.id === user.id;
    const canMembers = useCan(MEMBER_READ_PERMISSIONS).can;
    const canDevices = useCan(USER_DEVICE_PERMISSIONS).can;
    const canPushDevices = useCan(USER_PUSH_DEVICE_PERMISSIONS).can;
    const canLogins = useCan(USER_LOGIN_PERMISSIONS).can;
    const canLogs = useCan(USER_LOG_PERMISSIONS).can;
    const canEvents = useCan(USER_EVENT_PERMISSIONS).can;
    const canCredentials = isSelf || isAdmin;
    const shared = useSharedUserQueries(user.id, {
        devices: canDevices,
        pushDevices: canPushDevices,
        members: canMembers,
        logins: canLogins,
        events: canEvents,
        logs: canLogs,
        apiKeys: canCredentials,
        throttle: isAdmin,
    });
    const throttleRetry = Math.max(0, Math.floor(Number(shared.throttle.data?.retry_after_seconds ?? 0))) || 0;
    const actions = useUserAdminActions(user, {
        throttleRetry,
        refetchThrottle: () => void shared.throttle.refetch(),
        onOpenGroup,
    });

    // ── Header chips ──────────────────────────────────────────────────
    const online = isOnline(user);
    const lastSeen = user.last_activity ?? user.last_login;
    const status = statusBadge(user);
    const warning = inactivityWarning(user);
    const org = typeof user.org === 'object' && user.org ? user.org : null;
    const chips: Chip[] = [
        // Presence — the header-aux dot as a chip (DetailView has no aux slot).
        {
            icon: 'bi-circle-fill',
            text: online ? 'Online' : lastSeen ? `Offline · last active ${fmt.relative(lastSeen)}` : 'No activity',
            tone: online ? 'success' : 'muted',
        },
        ...(user.is_superuser ? [{ text: 'Superuser', tone: 'info' as const }]
            : accountType(user) === 'Staff' ? [{ text: 'Staff', tone: 'info' as const }] : []),
        ...(user.is_email_verified ? [{ icon: 'bi-shield-check', text: 'Email verified', tone: 'success' as const }] : []),
        ...(user.is_phone_verified && user.phone_number ? [{ icon: 'bi-shield-check', text: 'Phone verified', tone: 'success' as const }] : []),
        ...(user.requires_mfa ? [{ text: '2FA enabled', tone: 'primary' as const }] : []),
        // Org chip. Chips can't click (MERGE-WIRE) — the open lives in the
        // kebab + the Overview row link.
        ...(org ? [{ icon: 'bi-buildings', text: org.name, tone: 'muted' as const }] : []),
        // Reason-keyed status badge (Blocked / Banned / Auto-disabled /
        // Anonymized / Self-deactivated) — only while disabled.
        ...(status ? [{ text: status.label, tone: status.tone }] : []),
        // Login-throttle badge — independent of is_active; admin-only fetch,
        // absent while the GET hasn't settled (non-fatal).
        ...(throttleRetry > 0 ? [{ icon: 'bi-clock-history', text: `Login locked ${throttleRetry}s`, tone: 'danger' as const }] : []),
        // Inactivity-warning surface is read-only until the backend exposes a
        // supported clear action for active users.
        ...(warning ? [{ icon: 'bi-exclamation-triangle', text: `Inactivity warning — ${warning.days ?? '?'}d to auto-disable`, tone: 'warning' as const }] : []),
    ];

    // ── Kebab (UserView contextItems at full scope) ───────────────────
    const ADMIN = USER_MANAGE_PERMISSIONS;
    const MENU: DetailMenuEntry<UserRow>[] = [
        { label: 'Edit user', icon: 'bi-pencil', permissions: ADMIN, onSelect: () => void actions.editUser() },
        {
            label: 'Manage avatar…', icon: 'bi-image', permissions: ADMIN,
            onSelect: () => actions.openAvatarModal(),
        },
        {
            label: 'Open organization', icon: 'bi-buildings',
            when: (u) => Boolean(onOpenGroup && (typeof u?.org === 'object' ? u.org?.id : u?.org)),
            onSelect: () => void actions.openOrg(),
        },
        { divider: true },
        { label: 'Change password', icon: 'bi-key', permissions: ADMIN, onSelect: () => void actions.changePassword() },
        { label: 'Send password reset', icon: 'bi-envelope', permissions: ADMIN, onSelect: () => void actions.sendPasswordReset() },
        { label: 'Send magic login link', icon: 'bi-link-45deg', permissions: ADMIN, onSelect: () => void actions.sendMagicLink() },
        {
            label: 'Resend invite', icon: 'bi-envelope-plus', permissions: ADMIN,
            when: (u) => Boolean(u?.email) && u?.last_login == null,
            onSelect: () => void actions.resendInvite(),
        },
        { divider: true },
        {
            label: 'Reset MFA', icon: 'bi-shield-x', permissions: ADMIN,
            when: (u) => u?.requires_mfa === true,
            onSelect: () => void actions.resetMfa(),
        },
        { label: 'Clear rate limit', icon: 'bi-shield-slash', permissions: ADMIN, onSelect: () => void actions.clearRateLimit() },
        {
            label: 'Revoke all sessions', icon: 'bi-box-arrow-right', danger: true, permissions: ADMIN,
            onSelect: () => {
                // Kebab entry confirms; the Security row uses ArmedButton.
                void modal.confirm({
                    title: 'Revoke all sessions',
                    message: 'Revoke all sessions? The user will be signed out of all devices immediately.',
                    confirmText: 'Revoke',
                    danger: true,
                }).then((ok) => { if (ok) void actions.revokeAllSessions(); });
            },
        },
    ];

    // ── Rail badges (source setBadge set: ApiKeys/Groups/Devices/Audit) ──
    const deviceTotal = (shared.devices.data?.count ?? 0) + (shared.pushDevices.data?.count ?? 0);
    const auditTotal = (shared.events.data?.count ?? 0) + (shared.activity.data?.count ?? 0) + (shared.objectLogs.data?.count ?? 0);
    const badges: Record<string, number | null> = {
        ApiKeys: (shared.apiKeys.data?.count ?? 0) > 0 ? shared.apiKeys.data!.count : null,
        Groups: (shared.members.data?.count ?? 0) > 0 ? shared.members.data!.count : null,
        Devices: deviceTotal > 0 ? deviceTotal : null,
        Audit: auditTotal > 0 ? auditTotal : null,
    };

    // Active toggle — hidden for anonymized users (irreversible) AND for
    // non-admin callers. Off → disable flow (reason + note modal; cancel
    // leaves the switch on); on → reactivate, no prompt.
    const activeToggle = !isAnonymized(user) && isAdmin
        ? { value: user.is_active, onChange: (next: boolean) => { void (next ? actions.reactivateUser() : actions.disableUser()); } }
        : undefined;

    return (
        <DetailView<UserRow>
            avatarName={user.display_name || user.username}
            title={user.display_name || user.username || user.email || `User #${user.id}`}
            subtitle={[user.email, user.phone_number].filter(Boolean).join(' · ')}
            chips={chips}
            active={activeToggle}
            contextMenu={MENU}
            menuContext={user}
            badges={badges}
            onClose={onClose}
            sections={[
                { key: 'Overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => <OverviewSection user={user} shared={shared} onOpenGroup={onOpenGroup} /> },
                { key: 'Profile', label: 'Profile', icon: 'bi-person', render: () => <ProfileSection user={user} actions={actions} canManage={isAdmin} canCredentials={canCredentials} /> },
                { key: 'Personal', label: 'Personal', icon: 'bi-card-text', permissions: ADMIN, render: () => <PersonalSection user={user} /> },
                { key: 'Security', label: 'Security', icon: 'bi-shield-lock', render: () => <SecuritySection user={user} actions={actions} canManage={isAdmin} canPasskeys={canCredentials} /> },
                ...(canCredentials ? [{ key: 'OAuth', label: 'OAuth', icon: 'bi-link-45deg', render: () => <OAuthSection user={user} canManage={canCredentials} /> }] : []),
                { divider: 'Access' },
                ...(canMembers ? [{ key: 'Groups', label: 'Groups', icon: 'bi-people', render: () => <GroupsSection user={user} onOpenGroup={onOpenGroup} /> }] : []),
                {
                    key: 'SysPerms', label: 'Sys Perms', icon: 'bi-shield-check',
                    permissions: ADMIN,
                    render: () => <SysPermsSection user={user} />,
                },
                ...(hasAppPerms ? [{
                    key: 'AppPerms', label: 'App Perms', icon: 'bi-puzzle',
                    permissions: ADMIN,
                    render: () => <AppPermsSection user={user} />,
                }] : []),
                ...(canCredentials ? [{ key: 'ApiKeys', label: 'API Keys', icon: 'bi-key', render: () => <ApiKeysSection user={user} canManage={canCredentials} isSelf={isSelf} /> }] : []),
                { divider: 'Activity' },
                ...((canDevices || canPushDevices) ? [{
                    key: 'Devices', label: 'Devices', icon: 'bi-laptop',
                    render: () => (
                        <DevicesSection
                            user={user}
                            counts={{ browser: shared.devices.data?.count ?? 0, push: shared.pushDevices.data?.count ?? 0 }}
                            canBrowser={canDevices}
                            canPush={canPushDevices}
                        />
                    ),
                }] : []),
                ...(canLogins ? [{ key: 'Logins', label: 'Logins', icon: 'bi-geo-alt', render: () => <LoginsSection user={user} /> }] : []),
                ...((canLogs || canEvents) ? [{
                    key: 'Audit', label: 'Audit', icon: 'bi-clock-history',
                    render: () => <AuditSection user={user} canLogs={canLogs} canEvents={canEvents} />,
                }] : []),
                { divider: 'Settings' },
                { key: 'Notifications', label: 'Notifications', icon: 'bi-bell', render: () => <NotificationsSection user={user} /> },
                { key: 'Metadata', label: 'Metadata', icon: 'bi-braces', render: () => <UserMetadataSection user={user} canManage={isAdmin} /> },
            ]}
        />
    );
}
