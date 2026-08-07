// Groups — the second full-UX ModelTable screen (board #1281): chooser,
// filters incl. daterange, search, export, persistState, all against the
// live /api/group default graph (measured 2026-08-05: rows carry uuid /
// modified / last_activity / is_active / member_count / parent-basic).
// Row click opens the GroupDetail port of web-mojo's GroupView.
import { useQueryClient } from '@tanstack/react-query';
import {
    Badge, fmt, formModal, modal, toast, ModelTable,
    type BatchAction, type Column, type FilterDef,
} from 'portal-mojo/ui';
import { useCan } from 'portal-mojo/client/runtime';
import {
    GROUP_KIND_OPTIONS, GROUP_MANAGE_PERMS, GroupModel, type GroupRow,
} from '../models';
import { GroupDetail, iconForKind } from './GroupDetail';

const COLUMNS: Column<GroupRow>[] = [
    { key: 'id', label: 'ID', sortable: true, render: (g) => <span className="dim">{g.id}</span> },
    {
        key: 'name', label: 'Group', sortable: true, hideable: false, render: (g) => (
            <div className="cell-user">
                <span className="cell-avatar" style={{ fontSize: 13 }}><i className={`bi ${iconForKind(g.kind)}`} /></span>
                <span>
                    <span className="cell-name">{g.name}</span>
                    <span className="cell-sub">{g.parent?.name ?? 'Top-level'}</span>
                </span>
            </div>
        ),
    },
    {
        key: 'kind', label: 'Kind', sortable: true, render: (g) =>
            g.kind ? <Badge tone="primary">{g.kind}</Badge> : <span className="dim">—</span>,
    },
    {
        key: 'member_count', label: 'Members', align: 'center', render: (g) =>
            g.member_count > 0 ? String(g.member_count) : <span className="dim">—</span>,
    },
    { key: 'is_active', label: 'Status', render: (g) => <Badge>{g.is_active ? 'Active' : 'Inactive'}</Badge> },
    { key: 'parent', label: 'Parent', render: (g) => g.parent?.name ?? <span className="dim">—</span> },
    { key: 'uuid', label: 'UUID', render: (g) => g.uuid ? <code>{g.uuid}</code> : <span className="dim">—</span> },
    { key: 'created', label: 'Created', sortable: true, render: (g) => fmt.date(g.created) },
    { key: 'last_activity', label: 'Last Activity', sortable: true, render: (g) => fmt.relative(g.last_activity, '—') },
];

const FILTERS: FilterDef[] = [
    { key: 'name', label: 'Name', type: 'text', placeholder: 'Contains…' },
    { key: 'kind', label: 'Kind', type: 'multiselect', options: GROUP_KIND_OPTIONS },
    { key: 'is_active', label: 'Status', type: 'boolean', trueLabel: 'Active', falseLabel: 'Inactive' },
    // The boolean dialog writes the key verbatim — carrying the lookup IN
    // the key gives it Django __isnull semantics without a new filter type.
    { key: 'parent__isnull', label: 'Top-level', type: 'boolean', trueLabel: 'Top-level only', falseLabel: 'Has a parent' },
    { key: 'created', label: 'Created', type: 'daterange' },
    { key: 'last_activity', label: 'Last activity', type: 'daterange' },
];

export function GroupsPage() {
    const qc = useQueryClient();
    const save = GroupModel.useSave();
    const disable = GroupModel.useAction('disable');
    const reactivate = GroupModel.useAction('reactivate');
    const { can: canManage } = useCan(GROUP_MANAGE_PERMS);

    const addGroup = async () => {
        const form = GroupModel.forms.create!;
        const data = await formModal(form);
        if (!data) return;
        const changes = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== '' && v != null));
        try {
            const created = await save.mutateAsync({ id: null, changes });
            toast.success(`${created.name} created`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Create failed');
        }
    };

    const openGroup = (g: GroupRow) => {
        // Warm the one-record cache so the modal's useOne attaches to this
        // in-flight request instead of issuing its own.
        void GroupModel.fetchOne(qc, g.id).catch(() => {});
        void modal.detail((close) => <GroupDetail id={g.id} onClose={() => close(null)} />);
    };

    const batchActions: BatchAction<GroupRow>[] = canManage ? [
        {
            key: 'deactivate', label: 'Deactivate', icon: 'bi-x-circle', danger: true, confirm: false,
            prepare: async () => {
                const data = await formModal(GroupModel.forms.disable!);
                if (!data) return null;
                const payload: Record<string, unknown> = { reason: data.reason };
                if (data.note) payload.note = data.note;
                return payload;
            },
            run: (row, payload) => disable.mutateAsync({ id: row.id, payload }),
        },
        {
            key: 'reactivate', label: 'Reactivate', icon: 'bi-arrow-counterclockwise',
            run: (row) => reactivate.mutateAsync({ id: row.id }),
        },
    ] : [];

    return (
        <ModelTable<GroupRow>
            model={GroupModel}
            eyebrow="Account"
            title="Groups"
            searchPlaceholder="Search group names…"
            columns={COLUMNS}
            filters={FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'active', label: 'Active', params: { is_active: 'true' } },
                { key: 'top', label: 'Top-level', params: { parent__isnull: 'true' } },
                { key: 'orgs', label: 'Orgs', params: { kind: 'org' } },
            ]}
            defaultSort="-created"
            selectable={canManage}
            batchActions={batchActions}
            columnChooser
            persistState
            exportFormats={['csv', 'json']}
            onRowClick={openGroup}
            {...(canManage ? { addLabel: 'Add Group', onAdd: addGroup } : {})}
        />
    );
}
