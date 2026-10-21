// group-sections/SubGroupsSection.tsx — the Sub-Groups TableView port
// (GroupView.js:1203-1225): a compact table of the group's children —
// Name / Kind badge / Status / Created — with row click-through to that
// group's stacked GroupDetail, and the "Add Group" flow (GroupForms.create
// minus the redundant parent field; the parent IS this group —
// GroupView._addSubGroup:1670-1689). Above the table, system admins get the
// django-mojo #9107/#9126 switch that lets this group's own administrators
// create groups directly under it (no web-mojo source; new in portal-mojo).
import { useQueryClient } from '@tanstack/react-query';
import {
    Badge, Eyebrow,
    fmt, formModal, toast,
} from 'portal-mojo/ui';
import { MojoError, useCan } from 'portal-mojo/client/runtime';
import { GROUP_MANAGE_PERMS, GroupModel, type GroupRow } from '../models';
import { GROUP_KIND_COMBO_OPTIONS, kindLabel } from './models';

/** The policy key django-mojo keeps under metadata.protected (Group.SUBGROUP_POLICY_KEY). */
const SUBGROUP_POLICY_KEY = 'allow_member_subgroups';

function protectedMetadata(group: GroupRow): Record<string, unknown> {
    const value = group.metadata?.protected;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** On only when exactly true — the backend's Group.allows_member_subgroups(). */
export function allowsMemberSubgroups(group: GroupRow): boolean {
    return protectedMetadata(group)[SUBGROUP_POLICY_KEY] === true;
}

/**
 * The system-admin switch. The server action answers with the new value,
 * not the row, so the one-record cache is written through here and the
 * action's own invalidation refetches the group behind it.
 */
function MemberSubgroupsSwitch({ group }: { group: GroupRow }) {
    const qc = useQueryClient();
    const policy = GroupModel.useAction(SUBGROUP_POLICY_KEY);
    const on = allowsMemberSubgroups(group);

    const change = async (next: boolean) => {
        try {
            const outcome = await policy.mutateAsync({ id: group.id, payload: next });
            const echoed = outcome.result.payload[SUBGROUP_POLICY_KEY];
            const value = typeof echoed === 'boolean' ? echoed : next;
            // Off removes the key, as the server does.
            const nextProtected = { ...protectedMetadata(group) };
            if (value) nextProtected[SUBGROUP_POLICY_KEY] = true;
            else delete nextProtected[SUBGROUP_POLICY_KEY];
            qc.setQueryData(GroupModel.keys.one(group.id), {
                ...group,
                metadata: { ...group.metadata, protected: nextProtected },
            });
            toast.success(value
                ? `${group.name}'s administrators can now create sub-groups`
                : `${group.name}'s administrators can no longer create sub-groups`);
        } catch (err) {
            toast.error(err instanceof MojoError && err.status === 403
                ? 'You do not have permission to change who can create sub-groups'
                : err instanceof Error ? err.message : 'Could not change the setting');
        }
    };

    return (
        <div style={{ marginBottom: 12 }}>
            <label className="switch-row">
                <input
                    type="checkbox"
                    role="switch"
                    className="switch"
                    checked={on}
                    disabled={policy.isPending}
                    onChange={(e) => void change(e.target.checked)}
                />
                <span className="field-label">Administrators can create sub-groups</span>
            </label>
            <span className="field-help">
                While on, people who manage this group as members can create groups directly under it.
                It does not pass down to the new groups, and turning it off leaves existing groups alone.
            </span>
        </div>
    );
}

/** GroupModel.useSave().mutateAsync — what the add-sub-group flow needs. */
type GroupSaveFn = (vars: { id: number | string | null; changes: Record<string, unknown> }) => Promise<GroupRow>;

/**
 * The "Add Sub-Group" flow — shared by the section toolbar and the header
 * kebab's "Add Sub-{Noun}" (source: both delegate to _addSubGroup). The
 * parent field is dropped from the create form: the parent IS this group.
 */
export async function runAddSubGroupFlow(group: GroupRow, save: GroupSaveFn): Promise<void> {
    const noun = kindLabel(group.kind) || 'Group';
    const form = await formModal({
        title: `Add sub-${noun.toLowerCase()} to ${group.name}`,
        submitText: 'Create',
        fields: [
            { name: 'name', type: 'text', label: 'Name', required: true, placeholder: 'Enter group name' },
            {
                name: 'kind', type: 'combo', label: 'Kind', required: true,
                options: GROUP_KIND_COMBO_OPTIONS, placeholder: 'Type or pick a kind…',
            },
        ],
    });
    if (!form) return;
    try {
        await save({ id: null, changes: { ...form, parent: group.id } });
        toast.success(`Sub-${noun.toLowerCase()} created`);
    } catch (err) {
        toast.error(err instanceof Error ? err.message : `Failed to create sub-${noun.toLowerCase()}`);
    }
}

export function SubGroupsSection({ group, openGroup }: {
    group: GroupRow;
    openGroup: (id: number) => void;
}) {
    const { data, isPending } = GroupModel.useList({ parent: group.id, size: 25, sort: 'name' });
    const save = GroupModel.useSave();
    const { can: canManage } = useCan(GROUP_MANAGE_PERMS);
    const subs = data?.rows ?? [];

    return (
        <>
            <Eyebrow>Sub-groups</Eyebrow>
            {canManage && <MemberSubgroupsSwitch group={group} />}
            {canManage && (
                <div className="ga-toolbar">
                    <button className="btn btn-primary btn-compact" onClick={() => void runAddSubGroupFlow(group, save.mutateAsync)}>
                        <i className="bi bi-diagram-3" /> Add Group
                    </button>
                </div>
            )}
            {!isPending && subs.length === 0 && <p className="dim-italic">No sub-groups.</p>}
            {subs.length > 0 && (
                <div className="tbl-scroll">
                    <table className="tbl ga-subgroups">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Kind</th>
                                <th>Status</th>
                                <th>Created</th>
                            </tr>
                        </thead>
                        <tbody>
                            {subs.map((sg) => (
                                <tr key={sg.id} className="ga-row-link" onClick={() => openGroup(sg.id)}>
                                    <td><b>{sg.name}</b></td>
                                    <td>
                                        {sg.kind
                                            ? <Badge tone="primary">{kindLabel(sg.kind)}</Badge>
                                            : <span className="dim">—</span>}
                                    </td>
                                    <td>
                                        <Badge tone={sg.is_active ? 'success' : 'muted'}>
                                            {sg.is_active ? 'Active' : 'Inactive'}
                                        </Badge>
                                    </td>
                                    <td className="dim">{fmt.date(sg.created)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {(data?.count ?? 0) > subs.length && (
                <p className="dim" style={{ marginTop: 8 }}>{data!.count - subs.length} more sub-groups not shown.</p>
            )}
        </>
    );
}
