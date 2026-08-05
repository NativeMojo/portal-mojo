// group-sections/MembersSection.tsx — the Members ListView port
// (GroupView.js:1169-1200 + MEMBER_ROW_TEMPLATE:892-941) with BOTH toolbar
// flows the source carried:
//   · "Invite by Email"     → POST /api/group/member/invite {email, group}
//   · "Add Existing User"   → user picker (collection field over /api/user,
//     labelField email — display_name is frequently blank) → POST a Member
//     {group, user}
// Server search sweeps the model's SEARCH_FIELDS (user__username/email/
// display_name); the Status filter defaults to Active (the source collection
// started at is_active:true and let the admin flip to Inactive).
// Row click-through opens the member's UserDetail (no MemberView in the
// portal yet — the admin program owns it; deviation documented).
import { useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
    Badge, Eyebrow, SecurityItem,
    fmt, formModal, modal, toast,
} from 'portal-mojo/ui';
import { useCan, type Params } from 'portal-mojo/client';
import { MemberModel, type GroupRow, type MemberRow } from '../../models';
import { UserDetail } from '../UserDetail';
import { MEMBER_MANAGE_PERMS, grantedPerms, inviteMemberByEmail } from './models';

/**
 * The "Invite by Email" flow — shared by the Members toolbar and the header
 * kebab's "Invite Member" (source: both delegate to _inviteMemberByEmail).
 */
export async function runInviteMemberFlow(group: GroupRow, qc: QueryClient): Promise<void> {
    const form = await formModal({
        title: `Invite user to ${group.name}`,
        submitText: 'Send invite',
        fields: [{
            name: 'email', type: 'email', label: 'Email', required: true,
            help: 'They will receive an email invitation to join this group.',
        }],
    });
    if (!form?.email) return;
    const email = String(form.email);
    try {
        await inviteMemberByEmail(group.id, email);
        toast.success(`Invite sent to ${email}`);
        await MemberModel.invalidate(qc);
    } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to send invite');
    }
}

type StatusFilter = 'active' | 'inactive' | 'all';

function memberParams(groupId: number, search: string, status: StatusFilter): Params {
    const params: Params = { group: groupId, size: 15, sort: '-id' };
    if (search) params.search = search;
    if (status !== 'all') params.is_active = status === 'active';
    return params;
}

function MemberRowItem({ member, onOpen }: { member: MemberRow; onOpen: () => void }) {
    const u = member.user;
    const grants = grantedPerms(member.permissions);
    const role = typeof member.metadata?.role === 'string' && member.metadata.role !== ''
        ? member.metadata.role : null;
    const shown = grants.slice(0, 6);
    const extra = grants.length - shown.length;
    return (
        <div className="ga-click-row" role="button" tabIndex={0}
            onClick={onOpen}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
        >
            <SecurityItem
                icon="bi-person-circle"
                title={u?.display_name || u?.email || u?.username || `User #${u?.id ?? '?'}`}
                desc={`${u?.email ?? ''}${member.created ? ` · Joined ${fmt.date(member.created)}` : ''}`}
            >
                <span className="chip-row">
                    {role && <Badge tone="primary">{role}</Badge>}
                    {shown.map((g) => <Badge key={g} tone="info">{g}</Badge>)}
                    {extra > 0 && <Badge tone="muted">+{extra}</Badge>}
                    <Badge tone={member.is_active ? 'success' : 'muted'}>{member.is_active ? 'Active' : 'Disabled'}</Badge>
                </span>
            </SecurityItem>
        </div>
    );
}

export function MembersSection({ group }: { group: GroupRow }) {
    const qc = useQueryClient();
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<StatusFilter>('active');
    const { data, isPending } = MemberModel.useList(memberParams(group.id, search, status));
    const saveMember = MemberModel.useSave();
    // Backend invite threshold (rest/group.py) — category rollups (users /
    // groups) and the member `admin` wildcard pass via hasPermission.
    const { can: canManage } = useCan(MEMBER_MANAGE_PERMS);

    const members = data?.rows ?? [];

    const addExistingUser = async () => {
        const form = await formModal({
            title: `Add existing user to ${group.name}`,
            submitText: 'Add to group',
            fields: [{
                name: 'user', type: 'collection', label: 'User', required: true,
                endpoint: '/api/user', labelField: 'email', valueField: 'id',
                maxItems: 10, emptyFetch: false, debounceMs: 300,
                placeholder: 'Search users by email…',
                help: 'Search for an existing user to add to this group.',
            }],
        });
        if (form?.user == null || form.user === '') return;
        try {
            await saveMember.mutateAsync({ id: null, changes: { group: group.id, user: Number(form.user) } });
            toast.success(`User added to ${group.name}`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to add user');
        }
    };

    const openMember = (member: MemberRow) => {
        const uid = member.user?.id;
        if (!uid) {
            toast.error('This membership has no linked user');
            return;
        }
        void modal.detail((close) => <UserDetail id={uid} onClose={() => close(null)} />);
    };

    return (
        <>
            <Eyebrow>Members</Eyebrow>
            {canManage && (
                <div className="ga-toolbar">
                    <button className="btn btn-primary btn-compact" onClick={() => void runInviteMemberFlow(group, qc)}
                        title="Send an invite email — no account required yet">
                        <i className="bi bi-envelope" /> Invite by Email
                    </button>
                    <button className="btn btn-compact" onClick={() => void addExistingUser()}
                        title="Search for an existing user and add them to this group">
                        <i className="bi bi-person-plus" /> Add Existing User
                    </button>
                </div>
            )}
            <div className="ga-filter-row">
                <input
                    className="input"
                    type="search"
                    placeholder="Search members…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <select
                    className="input input-compact"
                    value={status}
                    aria-label="Status filter"
                    onChange={(e) => setStatus(e.target.value as StatusFilter)}
                >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="all">All</option>
                </select>
            </div>
            {!isPending && members.length === 0 && (
                <p className="dim-italic">
                    {search ? 'No members match this search.'
                        : canManage ? 'No members yet. Use "Invite by Email" or "Add Existing User".'
                        : 'No members yet.'}
                </p>
            )}
            {members.map((m) => <MemberRowItem key={m.id} member={m} onOpen={() => openMember(m)} />)}
            {(data?.count ?? 0) > members.length && (
                <p className="dim" style={{ marginTop: 8 }}>{data!.count - members.length} more — refine the search.</p>
            )}
        </>
    );
}
