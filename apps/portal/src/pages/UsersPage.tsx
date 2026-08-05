// Users — a full ModelTable page in ~70 declarative lines: columns, filters,
// presets, add form. The endpoint, form config and save/action wiring all
// come from the UserModel definition (models.ts) — the page is presentation.
// Columns and filters target the REAL /api/user default-graph row (no role,
// no created; epoch timestamps; verified live against a django-mojo server).
import { useQueryClient } from '@tanstack/react-query';
import { type User } from 'portal-mojo/client';
import { Badge, fmt, formModal, modal, toast, ModelTable, type Column, type FilterDef } from 'portal-mojo/ui';
import { UserModel } from '../models';
import { UserDetail } from './UserDetail';

const COLUMNS: Column<User>[] = [
    {
        key: 'display_name', label: 'User', render: (u) => (
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

// Adding a filter is one entry. Every type the framework supports is here:
// text (icontains), boolean, and dateranges — all real Django lookups the
// live server answers (multiselect returns with a real __in field on C4's
// Groups page — user rows have no enum-ish field to feed it).
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

export function UsersPage() {
    const qc = useQueryClient();
    const save = UserModel.useSave();

    const addUser = async () => {
        const form = UserModel.forms.create!;
        const data = await formModal(form);
        if (!data) return;
        // Optional blanks stay client-side; the backend derives username
        // from the email localpart when it is absent.
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
        // to this in-flight request instead of issuing its own (one GET total
        // — visible in getMockCallCounts()).
        void UserModel.fetchOne(qc, u.id).catch(() => {});
        void modal.detail((close) => <UserDetail id={u.id} onClose={() => close(null)} />);
    };

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
            onRowClick={openUser}
            addLabel="Add User"
            onAdd={addUser}
        />
    );
}
