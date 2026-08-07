import type { QueryClient } from '@tanstack/react-query';
import { mojoCall, mojoSave, type Group } from '../../../client/runtime';
import { formModal, modal, toast } from '../../../ui';
import { MemberModel, type MemberRow } from './models';

export interface AdmissionGroup extends Pick<Group, 'id' | 'name' | 'kind'> {}

/** Email-only, with no user-directory lookup or existence-dependent branch. */
export async function inviteMemberByEmail(groupId: number, email: string): Promise<MemberRow | null> {
    const response = await mojoCall('/api/group/member/invite', {
        method: 'POST',
        body: { group: groupId, email: email.trim() },
    });
    return (response.data ?? null) as MemberRow | null;
}

export type AdmissionMode = 'invite' | 'add';

function chooseAdmissionMode(group: AdmissionGroup, showInvite: boolean, showAdd: boolean): Promise<AdmissionMode | null> {
    return modal.open<AdmissionMode>((close) => (
        <div className="modal-pad">
            <h2 className="modal-title">Add a member to {group.name}</h2>
            <p className="modal-message">
                Invite by email without checking whether an account exists, or select an existing user from the authorized directory.
            </p>
            <div className="detail-kpi-grid">
                {showInvite && (
                    <button type="button" className="btn btn-primary" onClick={() => close('invite')}>
                        <i className="bi bi-envelope" /> Invite by email
                    </button>
                )}
                {showAdd && (
                    <button type="button" className="btn" onClick={() => close('add')}>
                        <i className="bi bi-person-plus" /> Add existing user
                    </button>
                )}
            </div>
            <div className="modal-actions">
                <button type="button" className="btn" onClick={() => close(null as unknown as AdmissionMode)}>Cancel</button>
            </div>
        </div>
    ), { size: 'md' });
}

async function pickGroup(): Promise<AdmissionGroup | null> {
    const data = await formModal({
        title: 'Choose a group',
        submitText: 'Continue',
        fields: [{
            name: 'group', type: 'collection', label: 'Group', required: true,
            endpoint: '/api/group', labelField: 'name', valueField: 'id',
            maxItems: 12, emptyFetch: true, debounceMs: 300,
            placeholder: 'Search groups…',
        }],
    });
    if (data?.group == null || data.group === '') return null;
    const id = Number(data.group);
    if (!Number.isFinite(id)) return null;
    // The picker returns only an id. The label is presentation-only here and
    // deliberately does not trigger a second directory request.
    return { id, name: `Group #${id}`, kind: 'group' };
}

export interface OpenMemberAdmissionOptions {
    group?: AdmissionGroup;
    canInvite: boolean;
    canCreate: boolean;
    canReadUsers: boolean;
    /** Fixed-group panels use separate buttons; headers/global pages omit it for the chooser. */
    initialMode?: AdmissionMode;
    queryClient?: QueryClient;
    onCreated?: (member: MemberRow) => void | Promise<void>;
}

/** Shared explicit Invite/Add chooser used by global Members and GroupDetail. */
export async function openMemberAdmissionDialog(options: OpenMemberAdmissionOptions): Promise<MemberRow | null> {
    const group = options.group ?? await pickGroup();
    if (!group) return null;
    const canAddExisting = options.canCreate && options.canReadUsers;
    if (!options.canInvite && !canAddExisting) return null;

    const allowedInitial = options.initialMode === 'invite'
        ? options.canInvite
        : options.initialMode === 'add'
            ? canAddExisting
            : false;
    const mode = allowedInitial
        ? options.initialMode!
        : await chooseAdmissionMode(group, options.canInvite, canAddExisting);
    if (!mode) return null;

    try {
        let member: MemberRow | null;
        if (mode === 'invite') {
            const data = await formModal({
                title: `Invite a member to ${group.name}`,
                submitText: 'Send invitation',
                fields: [{
                    name: 'email', type: 'email', label: 'Email', required: true,
                    help: 'The same confirmation is shown whether this is a new, existing, or already-associated account.',
                }],
            });
            if (!data?.email) return null;
            member = await inviteMemberByEmail(group.id, String(data.email));
            toast.success('Invitation request accepted');
        } else {
            const data = await formModal({
                title: `Add an existing user to ${group.name}`,
                submitText: 'Add to group',
                fields: [{
                    name: 'user', type: 'collection', label: 'User', required: true,
                    endpoint: '/api/user', labelField: 'email', valueField: 'id',
                    maxItems: 10, emptyFetch: false, debounceMs: 300,
                    placeholder: 'Search users by email…',
                    help: 'This directory-backed option is available only to authorized user-directory viewers.',
                }],
            });
            if (data?.user == null || data.user === '') return null;
            member = await mojoSave<MemberRow>(MemberModel.endpoint, null, {
                group: group.id,
                user: Number(data.user),
            });
            toast.success('Existing user added to the group');
        }
        if (member) await options.onCreated?.(member);
        if (options.queryClient) await MemberModel.invalidate(options.queryClient);
        return member;
    } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Member admission failed');
        return null;
    }
}
