// group-sections/SubGroupsSection.tsx — the Sub-Groups TableView port
// (GroupView.js:1203-1225): a compact table of the group's children —
// Name / Kind badge / Status / Created — with row click-through to that
// group's stacked GroupDetail, and the "Add Group" flow (GroupForms.create
// minus the redundant parent field; the parent IS this group —
// GroupView._addSubGroup:1670-1689).
import {
    Badge, Eyebrow,
    fmt, formModal, toast,
} from 'portal-mojo/ui';
import { useCan } from 'portal-mojo/client';
import { GroupModel, type GroupRow } from '../../models';
import { GROUP_ADMIN_PERMS, GROUP_KIND_COMBO_OPTIONS, kindLabel } from './models';

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
    const { can: canManage } = useCan(GROUP_ADMIN_PERMS);
    const subs = data?.rows ?? [];

    return (
        <>
            <Eyebrow>Sub-groups</Eyebrow>
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
