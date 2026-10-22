import { ComboBox } from '../../../ui/ComboBox';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCan, type Params } from '../../../client/runtime';
import { Badge, Eyebrow, SecurityItem, fmt, modal } from '../../../ui';
import { MemberDetail, type MemberNavigationCallbacks } from './MemberDetail';
import { openMemberAdmissionDialog, type AdmissionGroup, type AdmissionMode, type AdmissionRole } from './member-flows';
import { useMemberScope } from './member-scope';
import type { PermSpec } from '../../../client/runtime';
import {
    MEMBER_GROUP_READ_PERMISSIONS,
    MEMBER_INVITE_PERMISSIONS,
    MEMBER_SAVE_PERMISSIONS,
    MEMBER_USER_DIRECTORY_PERMISSIONS,
    MemberModel,
    rawMemberGrants,
    type MemberRow,
} from './models';

type StatusFilter = 'active' | 'inactive' | 'all';
const PAGE_SIZE = 15;

function paramsFor(groupId: number, search: string, status: StatusFilter, start: number): Params {
    const params: Params = { group: groupId, size: PAGE_SIZE, start, sort: '-id' };
    if (search) params.search = search;
    if (status !== 'all') params.is_active = status === 'active';
    return params;
}

function MemberItem({ member, onOpen }: { member: MemberRow; onOpen: () => void }) {
    const user = member.user;
    const grants = rawMemberGrants(member.permissions);
    const role = typeof member.metadata?.role === 'string' && member.metadata.role.trim()
        ? member.metadata.role : null;
    const shown = grants.slice(0, 5);
    return (
        <div
            className="ga-click-row" role="button" tabIndex={0}
            onClick={onOpen}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpen();
                }
            }}
        >
            <SecurityItem
                icon="bi-person-circle"
                title={user?.display_name || user?.email || user?.username || `User #${user?.id ?? '?'}`}
                desc={`${user?.email ?? 'No email'} · Joined ${fmt.date(member.created)}`}
            >
                <span className="chip-row">
                    {role && <Badge tone="primary">{role}</Badge>}
                    {shown.map((grant) => <Badge key={grant} tone="info">{grant}</Badge>)}
                    {grants.length > shown.length && <Badge tone="muted">+{grants.length - shown.length}</Badge>}
                    <Badge tone={member.is_active ? 'success' : 'muted'}>{member.is_active ? 'Active' : 'Inactive'}</Badge>
                </span>
            </SecurityItem>
        </div>
    );
}

export interface GroupMembersPanelProps extends MemberNavigationCallbacks {
    group: AdmissionGroup;
    /** Global Admin gates are system-pinned; a tenant composition passes its group-local gates. */
    invitePermissions?: PermSpec;
    savePermissions?: PermSpec;
    directoryPermissions?: PermSpec;
    /** Optional fixed roles offered on invite; each sets grants and the role label. */
    roles?: AdmissionRole[];
}

export function GroupMembersPanel({
    group, onNavigateUser, onNavigateGroup, roles,
    invitePermissions = MEMBER_INVITE_PERMISSIONS,
    savePermissions = MEMBER_SAVE_PERMISSIONS,
    directoryPermissions = MEMBER_USER_DIRECTORY_PERMISSIONS,
}: GroupMembersPanelProps) {
    const qc = useQueryClient();
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<StatusFilter>('active');
    const [start, setStart] = useState(0);
    useEffect(() => setStart(0), [search, status, group.id]);
    const query = MemberModel.useList(paramsFor(group.id, search, status, start));
    const { can: canInvite } = useCan(invitePermissions);
    const { can: canCreate } = useCan(savePermissions);
    const { can: canReadUsers } = useCan(directoryPermissions);
    const scope = useMemberScope(`${group.id}:${canInvite}:${canCreate}:${canReadUsers}`);
    const members = query.data?.rows ?? [];
    const count = query.data?.count ?? 0;

    const admit = (initialMode: AdmissionMode) => openMemberAdmissionDialog({
        group,
        initialMode,
        roles,
        canInvite,
        canCreate,
        canReadUsers,
        queryClient: qc,
        signal: scope.current?.signal,
    });
    const openMember = (member: MemberRow) => {
        void MemberModel.fetchOne(qc, member.id).catch(() => {});
        void modal.detail((close) => (
            <MemberDetail
                id={member.id}
                onClose={() => close(null)}
                readPermissions={MEMBER_GROUP_READ_PERMISSIONS}
                savePermissions={savePermissions}
                ownerSignal={scope.current?.signal}
                onNavigateUser={onNavigateUser}
                onNavigateGroup={onNavigateGroup}
            />
        ));
    };

    return (
        <>
            <Eyebrow>Members</Eyebrow>
            {(canInvite || (canCreate && canReadUsers)) && (
                <div className="ga-toolbar">
                    {canInvite && (
                        <button className="btn btn-primary btn-compact" onClick={() => { void admit('invite'); }}>
                            <i className="bi bi-envelope" /> Invite by email
                        </button>
                    )}
                    {canCreate && canReadUsers && (
                        <button className="btn btn-compact" onClick={() => { void admit('add'); }}>
                            <i className="bi bi-person-plus" /> Add existing user
                        </button>
                    )}
                </div>
            )}
            <div className="ga-filter-row">
                <input
                    className="input" type="search" placeholder="Search members…"
                    value={search} onChange={(event) => setSearch(event.target.value)}
                />
                <ComboBox allowCustom={false} maxSuggestions={Number.MAX_SAFE_INTEGER} value={String(status)} aria-label="Status filter" onChange={(selectedValue) => setStatus(String(selectedValue) as StatusFilter)} options={[({ value: "active", label: "Active" }), ({ value: "inactive", label: "Inactive" }), ({ value: "all", label: "All" })]} />
            </div>
            {query.isPending && <div className="skel skel-block" />}
            {query.error && <p className="text-bad">{query.error.message}</p>}
            {!query.isPending && !query.error && members.length === 0 && (
                <p className="dim-italic">{search ? 'No members match this search.' : 'No members in this view.'}</p>
            )}
            {members.map((member) => <MemberItem key={member.id} member={member} onOpen={() => openMember(member)} />)}
            {count > 0 && (
                <div className="ga-toolbar" style={{ justifyContent: 'space-between' }}>
                    <span className="dim">Showing {start + 1}–{Math.min(start + members.length, count)} of {count}</span>
                    <span className="chip-row">
                        <button className="btn btn-compact" disabled={start === 0} onClick={() => setStart(Math.max(0, start - PAGE_SIZE))}>Previous</button>
                        <button className="btn btn-compact" disabled={start + members.length >= count} onClick={() => setStart(start + PAGE_SIZE)}>Next</button>
                    </span>
                </div>
            )}
        </>
    );
}
