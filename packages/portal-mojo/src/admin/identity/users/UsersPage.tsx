// Users — the full-fidelity ModelTable proof (B2): columns + filters +
// presets from B1, now with selection + batch actions (real POST_SAVE_ACTIONS
// fanned out with allSettled), column chooser, persisted view state,
// auto-refresh, expandable rows, recency grouping, and server-side export.
import { useQueryClient } from '@tanstack/react-query';
import { useCan, type User } from '../../../client/runtime';
import {
    Badge, fmt, formModal, groupByRecency, modal, toast, ModelTable,
    type BatchAction, type Column, type FilterDef,
} from '../../../ui';
import { USER_MANAGE_PERMISSIONS, UserModel } from './models';
import { UserDetail } from './UserDetail';

const COLUMNS: Column<User>[] = [
    {
        // The identity column is the table's anchor — locked in the chooser.
        key: 'display_name', label: 'User', hideable: false, render: (u) => (
            <div className="cell-user">
                <span className="cell-avatar">{fmt.initials(u.display_name || u.username)}</span>
                <span>
                    <span className="cell-name">
                        {u.display_name || u.username}
                        {u.is_online && <span className="online-dot" title="Online" />}
                    </span>
                    <span className="cell-sub">{u.email}</span>
                </span>
            </div>
        ),
    },
    { key: 'username', label: 'Username', render: (u) => <span className="dim">{u.username}</span> },
    {
        key: 'is_superuser', label: 'Access', render: (u) =>
            u.is_superuser ? <Badge tone="primary">superuser</Badge>
            : Object.keys(u.permissions ?? {}).length > 0 ? <Badge tone="warning">staff</Badge>
            : <span className="dim">—</span>,
    },
    { key: 'is_active', label: 'Status', render: (u) => <Badge>{u.is_active ? 'Active' : 'Inactive'}</Badge> },
    {
        key: 'is_email_verified', label: 'Verified', align: 'center', render: (u) =>
            u.is_email_verified ? <i className="bi bi-patch-check-fill text-ok" /> : <span className="dim">—</span>,
    },
    { key: 'last_login', label: 'Last Login', render: (u) => fmt.relative(u.last_login) },
    { key: 'last_activity', label: 'Last Activity', render: (u) => fmt.relative(u.last_activity, '—') },
];

const FILTERS: FilterDef[] = [
    { key: 'display_name', label: 'Name', type: 'text', placeholder: 'Contains…' },
    { key: 'email', label: 'Email', type: 'text', placeholder: 'Contains…' },
    { key: 'username', label: 'Username', type: 'text', placeholder: 'Contains…' },
    { key: 'is_active', label: 'Status', type: 'boolean', trueLabel: 'Active', falseLabel: 'Inactive' },
    { key: 'is_email_verified', label: 'Email verified', type: 'boolean', trueLabel: 'Verified', falseLabel: 'Unverified' },
    { key: 'is_phone_verified', label: 'Phone verified', type: 'boolean', trueLabel: 'Verified', falseLabel: 'Unverified' },
    { key: 'is_superuser', label: 'Superuser', type: 'boolean', trueLabel: 'Yes', falseLabel: 'No' },
    { key: 'last_login', label: 'Last login', type: 'daterange' },
    { key: 'last_activity', label: 'Last activity', type: 'daterange' },
];

/** Expanded-row detail: the quick facts a hover-curious admin wants. */
function UserExpand({ u }: { u: User }) {
    const perms = Object.entries(u.permissions ?? {}).filter(([, v]) => v === true || v === 1).map(([k]) => k);
    return (
        <div className="expand-grid">
            <div>
                <div className="eyebrow">Contact</div>
                <div>{u.email}</div>
                <div className="dim">{u.phone_number ?? 'No phone'}</div>
            </div>
            <div>
                <div className="eyebrow">Verification</div>
                <div>Email {u.is_email_verified ? <Badge tone="success">Verified</Badge> : <Badge tone="muted">Unverified</Badge>}</div>
                <div>Phone {u.is_phone_verified ? <Badge tone="success">Verified</Badge> : <Badge tone="muted">Unverified</Badge>}</div>
            </div>
            <div>
                <div className="eyebrow">Permissions</div>
                <div className="chip-row">
                    {u.is_superuser && <Badge tone="primary">superuser</Badge>}
                    {perms.map((k) => <Badge key={k} tone="info">{k}</Badge>)}
                    {!u.is_superuser && perms.length === 0 && <span className="dim-italic">none</span>}
                </div>
            </div>
        </div>
    );
}

export function UsersPage({ onOpenGroup }: { onOpenGroup?: (groupId: number) => void } = {}) {
    const qc = useQueryClient();
    const { can: canManage } = useCan(USER_MANAGE_PERMISSIONS);
    const save = UserModel.useSave();
    const disable = UserModel.useAction('disable');
    const reactivate = UserModel.useAction('reactivate');

    const addUser = async () => {
        const form = UserModel.forms.create!;
        const data = await formModal(form);
        if (!data) return;
        const changes = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== ''));
        try {
            const created = await save.mutateAsync({ id: null, changes });
            toast.success(`${created.display_name || created.username} created`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Create failed');
        }
    };

    const openUser = (u: User) => {
        // Prefetch through the shared cache key: the modal's useOne attaches
        // to this in-flight request instead of issuing its own.
        void UserModel.fetchOne(qc, u.id).catch(() => {});
        void modal.detail((close) => <UserDetail id={u.id} onClose={() => close(null)} onOpenGroup={onOpenGroup} />);
    };

    // Batch actions run the model's REAL POST_SAVE_ACTIONS per row; the
    // reason for a batch disable is collected once and shared.
    const BATCH: BatchAction<User>[] = [
        {
            key: 'disable', label: 'Disable', icon: 'bi-slash-circle', danger: true, confirm: false,
            eligible: (row) => row.is_active,
            prepare: async () => {
                const data = await formModal(UserModel.forms.disable!);
                if (!data) return null;
                const payload: Record<string, unknown> = { reason: data.reason };
                if (data.note) payload.note = data.note;
                return payload;
            },
            run: (row, payload) => disable.mutateAsync({ id: row.id, payload }),
        },
        {
            key: 'reactivate', label: 'Reactivate', icon: 'bi-arrow-counterclockwise',
            eligible: (row) => !row.is_active,
            run: (row) => reactivate.mutateAsync({ id: row.id }),
        },
    ];

    return (
        <ModelTable<User>
            model={UserModel}
            eyebrow="Account"
            title="Users"
            searchPlaceholder="Search name, username, email…"
            columns={COLUMNS}
            filters={FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'active', label: 'Active', params: { is_active: 'true' } },
                { key: 'superusers', label: 'Superusers', params: { is_superuser: 'true' } },
                { key: 'never', label: 'Never signed in', params: { last_login__isnull: 'true' } },
                { key: 'inactive', label: 'Inactive', params: { is_active: 'false' } },
            ]}
            defaultSort="-last_activity"
            selectable={canManage}
            batchActions={canManage ? BATCH : []}
            columnChooser
            persistState
            exportFormats={['csv', 'json']}
            autoRefresh={30}
            rowExpand={(u) => <UserExpand u={u} />}
            {...groupByRecency<User>('last_activity')}
            onRowClick={openUser}
            addLabel="Add User"
            onAdd={canManage ? addUser : undefined}
        />
    );
}
