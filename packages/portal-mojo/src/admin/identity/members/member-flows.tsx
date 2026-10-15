import type { QueryClient } from '@tanstack/react-query';
import { mojoCall, type Group } from '../../../client/runtime';
import { modal, toast } from '../../../ui';
import { memberForm } from './member-dialog';
import { captureMemberScope, saveMemberInScope, type MemberScope } from './member-scope';
import { MemberModel, type MemberRow } from './models';

export interface AdmissionGroup extends Pick<Group, 'id' | 'name' | 'kind'> {}

/** A fixed role a product offers on invite: the grants it sets and the label it records. */
export interface AdmissionRole {
    value: string;
    label: string;
    permissions: string[];
    help?: string;
}

/** Email-only, with no user-directory lookup or existence-dependent branch. */
export async function inviteMemberByEmail(groupId: number, email: string, permissions?: string[], beforeSend?: () => void): Promise<MemberRow | null> {
    const response = await mojoCall('/api/group/member/invite', {
        method: 'POST',
        beforeSend,
        body: {
            group: groupId, email: email.trim(),
            ...(permissions?.length ? { permissions: Object.fromEntries(permissions.map((name) => [name, true])) } : {}),
        },
    });
    return (response.data ?? null) as MemberRow | null;
}

export type AdmissionMode = 'invite' | 'add';

function chooseAdmissionMode(group: AdmissionGroup, showInvite: boolean, showAdd: boolean, signal: AbortSignal): Promise<AdmissionMode | null> {
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
    ), { size: 'md', signal });
}

async function pickGroup(scope: MemberScope): Promise<AdmissionGroup | null> {
    const data = await memberForm(scope, {
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
    /** Fixed roles shown as a select on the invite form; the first is the default. */
    roles?: AdmissionRole[];
    /** Abort when the initiating panel unmounts or its group/authority changes. */
    signal?: AbortSignal;
}

/** Shared explicit Invite/Add chooser used by global Members and GroupDetail. */
export async function openMemberAdmissionDialog(options: OpenMemberAdmissionOptions): Promise<MemberRow | null> {
    const scope = captureMemberScope(options.signal);
    try {
        const group = options.group ?? await pickGroup(scope);
        if (!scope.current() || !group) return null;
        const canAddExisting = options.canCreate && options.canReadUsers;
        if (!options.canInvite && !canAddExisting) return null;
        const allowedInitial = options.initialMode === 'invite' ? options.canInvite
            : options.initialMode === 'add' ? canAddExisting : false;
        const mode = allowedInitial ? options.initialMode!
            : await chooseAdmissionMode(group, options.canInvite, canAddExisting, scope.signal);
        if (!scope.current() || !mode) return null;
        const roles = options.roles ?? [];
        const result = mode === 'invite'
            ? await memberForm<{ member: MemberRow | null } | null>(scope, {
                title: `Invite a member to ${group.name}`,
                submitText: 'Send invitation',
                fields: [{
                    name: 'email', type: 'email', label: 'Email', required: true,
                    help: 'The same confirmation is shown whether this is a new, existing, or already-associated account.',
                }, ...(roles.length ? [{
                    name: 'role', type: 'select' as const, label: 'Role', required: true,
                    options: roles.map((role) => ({ value: role.value, label: role.label })),
                    help: roles.map((role) => role.help ? `${role.label}: ${role.help}` : null).filter(Boolean).join(' '),
                }] : [])],
                ...(roles.length ? { initial: { role: roles[0].value } } : {}),
            }, async (data, current) => {
                const role = roles.find((candidate) => candidate.value === data.role) ?? roles[0];
                let result = await inviteMemberByEmail(group.id, String(data.email), role?.permissions, () => {
                    scope.assert();
                    if (!current()) throw new DOMException('Member dialog closed', 'AbortError');
                });
                if (!current()) return null;
                // The grants are authoritative. A refused display-label write is non-fatal.
                if (result && role) {
                    try {
                        result = await saveMemberInScope(result.id, { metadata: { role: role.label } }, () => {
                            scope.assert();
                            if (!current()) throw new DOMException('Member dialog closed', 'AbortError');
                        });
                    } catch { /* invitation already accepted; keep its authoritative row */ }
                }
                if (!current()) return null;
                toast.success('Invitation request accepted');
                return { member: result };
            })
            : await memberForm<{ member: MemberRow }>(scope, {
                title: `Add an existing user to ${group.name}`, submitText: 'Add to group',
                fields: [{
                    name: 'user', type: 'collection', label: 'User', required: true,
                    endpoint: '/api/user', labelField: 'email', valueField: 'id',
                    maxItems: 10, emptyFetch: false, debounceMs: 300,
                    placeholder: 'Search users by email…',
                    help: 'This directory-backed option is available only to authorized user-directory viewers.',
                }],
            }, async (data, current) => {
                const result = await saveMemberInScope(null,
                    { group: group.id, user: Number(data.user) }, () => {
                        scope.assert();
                        if (!current()) throw new DOMException('Member dialog closed', 'AbortError');
                    });
                if (current()) toast.success('Existing user added to the group');
                return { member: result };
            });
        if (!scope.current() || !result) return null;
        const member = result.member;
        if (member) await options.onCreated?.(member);
        if (!scope.current()) return null;
        if (options.queryClient) await MemberModel.invalidate(options.queryClient);
        return scope.current() ? member : null;
    } catch (error) {
        if (scope.current()) toast.error(error instanceof Error ? error.message : 'Member admission failed');
        return null;
    } finally { scope.dispose(); }
}
