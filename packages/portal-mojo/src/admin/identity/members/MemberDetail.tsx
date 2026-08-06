import { useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCan, type PermSpec } from '../../../client';
import {
    Badge, DetailView, Eyebrow, FlatRow, FormView, JsonBlock, MetricCard,
    ModelTable, fmt, formModal, toast, type Column, type DetailMenuEntry,
} from '../../../ui';
import { LOGS_ADMIN_PERMISSIONS, LogModel, type LogRow } from '../../monitoring';
import {
    MEMBER_READ_PERMISSIONS,
    MEMBER_SAVE_PERMISSIONS,
    MemberModel,
    effectiveMemberGrants,
    getMemberPermissions,
    ignoredMemberGrants,
    memberPermissionFields,
    memberPermissionsVersion,
    rawMemberGrants,
    subscribeMemberPermissions,
    type MemberRow,
} from './models';

export interface MemberNavigationCallbacks {
    onNavigateUser?: (id: number) => void;
    onNavigateGroup?: (id: number) => void;
}

export interface MemberDetailProps extends MemberNavigationCallbacks {
    id: number;
    onClose: () => void;
    /** Global Admin is system-pinned; fixed-group compositions pass their read gate. */
    readPermissions?: PermSpec;
}

function AuditTable({ memberId }: { memberId: number }) {
    const columns: Column<LogRow>[] = [
        { key: 'created', label: 'Time', sortable: true, render: (row) => fmt.datetime(row.created) },
        { key: 'level', label: 'Level', sortable: true, render: (row) => <Badge>{row.level}</Badge> },
        { key: 'kind', label: 'Kind', sortable: false, render: (row) => row.kind ?? '—' },
        { key: 'log', label: 'Event', sortable: false, render: (row) => row.log ?? '—' },
    ];
    return (
        <ModelTable<LogRow>
            model={LogModel}
            title="Membership audit"
            columns={columns}
            searchable={false}
            defaultParams={{ model_name: 'account.GroupMember', model_id: memberId, sort: '-created', size: 15 }}
            defaultSort="-created"
        />
    );
}

function GrantSummary({ member }: { member: MemberRow }) {
    const raw = rawMemberGrants(member.permissions);
    const effective = effectiveMemberGrants(member.permissions);
    const ignored = ignoredMemberGrants(member.permissions);
    return (
        <>
            <Eyebrow>Effective membership grants</Eyebrow>
            <div className="chip-row">
                {effective.map((grant) => <Badge key={grant} tone="info">{grant}</Badge>)}
            </div>
            <Eyebrow>Raw stored grants</Eyebrow>
            {raw.length > 0
                ? <div className="chip-row">{raw.map((grant) => <Badge key={grant} tone={ignored.includes(grant) ? 'warning' : 'muted'}>{grant}</Badge>)}</div>
                : <p className="dim">No raw grants are stored.</p>}
            {ignored.length > 0 && (
                <p className="dim">
                    Ignored: <code>{ignored.join(', ')}</code>. Literal <code>sys.*</code> and stored <code>full_member</code> never grant member authority.
                    <code> admin</code> remains a product-portal client compatibility wildcard, but django-mojo does not honor it server-side.
                </p>
            )}
        </>
    );
}

export function MemberDetail({
    id, onClose, onNavigateUser, onNavigateGroup,
    readPermissions = MEMBER_READ_PERMISSIONS,
}: MemberDetailProps) {
    const qc = useQueryClient();
    const { can: canRead, isLoading: readLoading } = useCan(readPermissions);
    const query = MemberModel.useOne(canRead ? id : null);
    const save = MemberModel.useSave();
    const resend = MemberModel.useAction('resend_invite');
    const { can: canSave } = useCan(MEMBER_SAVE_PERMISSIONS);
    useSyncExternalStore(subscribeMemberPermissions, memberPermissionsVersion, memberPermissionsVersion);

    if (readLoading) return <div className="detail-loading"><span className="skel skel-block" /></div>;
    if (!canRead) return <div className="modal-pad text-bad">Access denied</div>;
    if (query.isPending) return <div className="detail-loading"><span className="skel skel-block" /></div>;
    if (!query.data || query.error) return <div className="modal-pad text-bad">{query.error?.message ?? 'Membership not found'}</div>;
    const member = query.data;
    const userLabel = member.user?.display_name || member.user?.email || member.user?.username || 'Unknown user';
    const groupLabel = member.group?.name || 'Unknown group';
    const role = typeof member.metadata?.role === 'string' && member.metadata.role.trim()
        ? member.metadata.role.trim() : 'Member';
    const inviter = typeof member.metadata?.invited_by_name === 'string'
        ? member.metadata.invited_by_name
        : typeof member.metadata?.invited_by === 'string' || typeof member.metadata?.invited_by === 'number'
            ? String(member.metadata.invited_by)
            : null;
    const raw = rawMemberGrants(member.permissions);
    const catalog = getMemberPermissions();
    const catalogNames = new Set(catalog.map((permission) => permission.name));
    const deploymentOnly = raw.filter((name) => !catalogNames.has(name) && !ignoredMemberGrants(member.permissions).includes(name));

    const editRole = async () => {
        const values = await formModal({
            title: 'Edit role label',
            submitText: 'Update label',
            fields: [{
                name: 'role', type: 'text', label: 'Role label',
                help: 'Presentation only. This label does not grant authorization.',
            }],
            initial: { role },
        });
        if (!values) return;
        try {
            await save.mutateAsync({ id: member.id, changes: { metadata: { role: String(values.role ?? '').trim() } } });
            toast.success('Role label updated');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Role update failed');
        }
    };

    const setActive = async (next: boolean) => {
        try {
            await save.mutateAsync({ id: member.id, changes: { is_active: next } });
            toast.success(next ? 'Membership activated' : 'Membership deactivated');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Membership update failed');
        }
    };

    const resendInvite = async () => {
        try {
            await resend.mutateAsync({ id: member.id });
            toast.success('Invitation resent');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Invitation resend failed');
        }
    };

    const menu: DetailMenuEntry<MemberRow>[] = [
        ...(onNavigateUser && member.user ? [{ label: 'View user', icon: 'bi-person', onSelect: () => onNavigateUser(member.user!.id) }] : []),
        ...(onNavigateGroup && member.group ? [{ label: 'View group', icon: 'bi-people', onSelect: () => onNavigateGroup(member.group!.id) }] : []),
        { divider: true as const },
        { label: 'Edit role label', icon: 'bi-person-badge', permissions: MEMBER_SAVE_PERMISSIONS, onSelect: () => { void editRole(); } },
        { label: 'Resend invitation', icon: 'bi-envelope-arrow-up', permissions: MEMBER_SAVE_PERMISSIONS, onSelect: () => { void resendInvite(); } },
        {
            label: member.is_active ? 'Deactivate membership' : 'Activate membership',
            icon: member.is_active ? 'bi-toggle-off' : 'bi-toggle-on',
            danger: member.is_active,
            permissions: MEMBER_SAVE_PERMISSIONS,
            onSelect: () => { void setActive(!member.is_active); },
        },
    ];

    return (
        <DetailView<MemberRow>
            icon="bi-person-badge"
            title={`${userLabel} in ${groupLabel}`}
            subtitle={`${role} · joined ${fmt.relative(member.created)}`}
            chips={[
                ...(member.user?.email ? [{ icon: 'bi-envelope', text: member.user.email, tone: 'muted' as const }] : []),
                ...(member.group?.kind ? [{ icon: 'bi-people', text: member.group.kind, tone: 'info' as const }] : []),
                { icon: 'bi-person-badge', text: role, tone: 'primary' as const },
                { text: `${effectiveMemberGrants(member.permissions).length} effective grants`, tone: 'muted' as const },
            ]}
            active={canSave ? { value: member.is_active, onChange: (next) => { void setActive(next); } } : undefined}
            contextMenu={menu}
            menuContext={member}
            onClose={onClose}
            sections={[
                {
                    key: 'Overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => (
                        <>
                            <div className="detail-kpi-grid">
                                <MetricCard label="Role label" value={role} />
                                <MetricCard label="Status" value={member.is_active ? 'Active' : 'Inactive'} />
                                <MetricCard label="Joined" value={fmt.relative(member.created)} />
                                <MetricCard label="Effective grants" value={effectiveMemberGrants(member.permissions).length} />
                            </div>
                            <Eyebrow>This membership</Eyebrow>
                            <FlatRow label="User" action={member.user && onNavigateUser ? () => onNavigateUser(member.user!.id) : undefined} actionTitle="View user">{userLabel}</FlatRow>
                            <FlatRow label="Email">{member.user?.email ?? '—'}</FlatRow>
                            <FlatRow label="Group" action={member.group && onNavigateGroup ? () => onNavigateGroup(member.group!.id) : undefined} actionTitle="View group">{groupLabel}</FlatRow>
                            <FlatRow label="Role label" action={canSave ? () => { void editRole(); } : undefined}>{role}</FlatRow>
                            <FlatRow label="Joined">{fmt.datetime(member.created)}</FlatRow>
                            <FlatRow label="Modified">{fmt.datetime(member.modified)}</FlatRow>
                            {inviter && <FlatRow label="Invited by">{inviter}</FlatRow>}
                            <GrantSummary member={member} />
                        </>
                    ),
                },
                {
                    key: 'Permissions', label: 'Permissions', icon: 'bi-shield-lock', render: () => (
                        <>
                            <Eyebrow>Per-group authorization</Eyebrow>
                            <p className="dim">Role labels are not authorization. Protected changes may be rejected by <code>MEMBER_PERMS_PROTECTION</code>; failed autosaves revert and show the server error.</p>
                            {canSave
                                ? <FormView model={MemberModel} row={member} fields={memberPermissionFields()} onSaved={() => { void MemberModel.invalidate(qc); }} />
                                : <GrantSummary member={member} />}
                            {deploymentOnly.length > 0 && (
                                <p className="dim">Deployment-specific stored grants without registered editors remain read-only: <code>{deploymentOnly.join(', ')}</code>.</p>
                            )}
                        </>
                    ),
                },
                { divider: 'Activity' },
                {
                    key: 'Audit', label: 'Audit', icon: 'bi-clock-history',
                    permissions: LOGS_ADMIN_PERMISSIONS,
                    render: () => <AuditTable memberId={member.id} />,
                },
                {
                    key: 'Raw', label: 'Raw', icon: 'bi-braces', render: () => (
                        <JsonBlock value={{ permissions: member.permissions, metadata: member.metadata }} label="Membership JSON" defaultOpen />
                    ),
                },
            ]}
        />
    );
}
