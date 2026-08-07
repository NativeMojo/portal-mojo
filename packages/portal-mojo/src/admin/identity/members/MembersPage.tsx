import { useQueryClient } from '@tanstack/react-query';
import { useCan } from '../../../client/runtime';
import {
    Badge, ModelTable, fmt, formModal, modal,
    type BatchAction, type Column, type FilterDef,
} from '../../../ui';
import { MemberDetail, type MemberNavigationCallbacks } from './MemberDetail';
import { openMemberAdmissionDialog } from './member-flows';
import {
    MEMBER_INVITE_PERMISSIONS,
    MEMBER_SAVE_PERMISSIONS,
    MEMBER_USER_DIRECTORY_PERMISSIONS,
    MemberModel,
    rawMemberGrants,
    type MemberRow,
} from './models';

const COLUMNS: Column<MemberRow>[] = [
    {
        key: 'user__display_name', label: 'Member', sortable: false, hideable: false, render: (member) => (
            <div className="cell-user">
                <span className="cell-avatar"><i className="bi bi-person" /></span>
                <span>
                    <span className="cell-name">{member.user?.display_name || member.user?.username || `User #${member.user?.id ?? '?'}`}</span>
                    <span className="cell-sub">{member.user?.email ?? 'No linked email'}</span>
                </span>
            </div>
        ),
    },
    {
        key: 'group__name', label: 'Group', sortable: false, render: (member) => (
            <span>{member.group?.name ?? 'Unknown group'}{member.group?.kind && <span className="cell-sub">{member.group.kind}</span>}</span>
        ),
    },
    {
        key: 'metadata__role', label: 'Role label', sortable: false, render: (member) => {
            const role = typeof member.metadata?.role === 'string' ? member.metadata.role.trim() : '';
            return role ? <Badge tone="primary">{role}</Badge> : <span className="dim">Member</span>;
        },
    },
    { key: 'is_active', label: 'Status', sortable: true, render: (member) => <Badge>{member.is_active ? 'Active' : 'Inactive'}</Badge> },
    {
        key: 'permissions', label: 'Granted permissions', sortable: false, render: (member) => {
            const grants = rawMemberGrants(member.permissions);
            return grants.length > 0
                ? <span className="chip-row">{grants.slice(0, 3).map((grant) => <Badge key={grant} tone="info">{grant}</Badge>)}{grants.length > 3 && <Badge tone="muted">+{grants.length - 3}</Badge>}</span>
                : <span className="dim">None</span>;
        },
    },
    { key: 'created', label: 'Joined', sortable: true, render: (member) => fmt.datetime(member.created) },
    { key: 'modified', label: 'Modified', sortable: true, render: (member) => fmt.relative(member.modified) },
];

const FILTERS: FilterDef[] = [
    { key: 'user__email', label: 'Email', type: 'text', lookup: 'icontains', placeholder: 'Contains…' },
    { key: 'user__display_name', label: 'Display name', type: 'text', lookup: 'icontains', placeholder: 'Contains…' },
    { key: 'group__name', label: 'Group name', type: 'text', lookup: 'icontains', placeholder: 'Contains…' },
    { key: 'metadata__role', label: 'Role label', type: 'text', lookup: 'icontains', placeholder: 'Contains…' },
    { key: 'is_active', label: 'Status', type: 'boolean', trueLabel: 'Active', falseLabel: 'Inactive' },
    { key: 'created', label: 'Joined', type: 'daterange' },
];

export function MembersPage({ onNavigateUser, onNavigateGroup }: MemberNavigationCallbacks = {}) {
    const qc = useQueryClient();
    const save = MemberModel.useSave();
    const { can: canSave } = useCan(MEMBER_SAVE_PERMISSIONS);
    const { can: canInvite } = useCan(MEMBER_INVITE_PERMISSIONS);
    const { can: canReadUsers } = useCan(MEMBER_USER_DIRECTORY_PERMISSIONS);

    const batchActions: BatchAction<MemberRow>[] = canSave ? [
        {
            key: 'activate', label: 'Activate', icon: 'bi-check-circle',
            run: (member) => save.mutateAsync({ id: member.id, changes: { is_active: true } }),
        },
        {
            key: 'deactivate', label: 'Deactivate', icon: 'bi-x-circle', danger: true,
            run: (member) => save.mutateAsync({ id: member.id, changes: { is_active: false } }),
        },
        {
            key: 'role', label: 'Set role label', icon: 'bi-person-gear',
            prepare: async () => {
                const data = await formModal({
                    title: 'Set role label',
                    submitText: 'Apply to selected',
                    fields: [{
                        name: 'role', type: 'text', label: 'Role label',
                        help: 'Display-only metadata; this does not change authorization.',
                    }],
                });
                return data ? String(data.role ?? '').trim() : null;
            },
            run: (member, prepared) => save.mutateAsync({
                id: member.id,
                changes: { metadata: { role: String(prepared ?? '') } },
            }),
        },
    ] : [];

    const openMember = (member: MemberRow) => {
        void MemberModel.fetchOne(qc, member.id).catch(() => {});
        void modal.detail((close) => (
            <MemberDetail
                id={member.id}
                onClose={() => close(null)}
                onNavigateUser={onNavigateUser}
                onNavigateGroup={onNavigateGroup}
            />
        ));
    };

    const admit = () => openMemberAdmissionDialog({
        canInvite,
        canCreate: canSave,
        canReadUsers,
        queryClient: qc,
    });

    return (
        <ModelTable<MemberRow>
            model={MemberModel}
            eyebrow="Identity & Access"
            title="Members"
            columns={COLUMNS}
            filters={FILTERS}
            searchable
            searchPlaceholder="Search name, email, or username…"
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'active', label: 'Active', params: { is_active: 'true' } },
                { key: 'inactive', label: 'Inactive', params: { is_active: 'false' } },
            ]}
            defaultSort="-created"
            selectable={canSave}
            batchActions={batchActions}
            columnChooser
            persistState
            persistKey="admin-members"
            exportFormats={['csv', 'json']}
            onRowClick={openMember}
            addLabel="Add or invite member"
            onAdd={canInvite || (canSave && canReadUsers) ? () => { void admit(); } : undefined}
        />
    );
}
