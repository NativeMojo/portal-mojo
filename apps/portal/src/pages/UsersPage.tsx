// Users — a full ModelTable page in ~70 declarative lines: columns, filters,
// presets, add form. The endpoint, form config and save/action wiring all
// come from the UserModel definition (models.ts) — the page is presentation.
import { useQueryClient } from '@tanstack/react-query';
import { type User } from 'portal-mojo/client';
import { Badge, fmt, formModal, modal, toast, ModelTable, type Column, type FilterDef } from 'portal-mojo/ui';
import { UserModel } from '../models';
import { UserDetail } from './UserDetail';

const COLUMNS: Column<User>[] = [
    {
        key: 'display_name', label: 'User', render: (u) => (
            <div className="cell-user">
                <span className="cell-avatar">{fmt.initials(u.display_name)}</span>
                <span>
                    <span className="cell-name">{u.display_name}</span>
                    <span className="cell-sub">{u.email}</span>
                </span>
            </div>
        ),
    },
    { key: 'role', label: 'Role', render: (u) => <Badge>{u.role}</Badge> },
    { key: 'is_active', label: 'Status', render: (u) => <Badge>{u.is_active ? 'Active' : 'Inactive'}</Badge> },
    { key: 'mfa_enabled', label: 'MFA', align: 'center', render: (u) => u.mfa_enabled ? <i className="bi bi-shield-check text-ok" /> : <span className="dim">—</span> },
    { key: 'last_login', label: 'Last Login', render: (u) => fmt.relative(u.last_login) },
    { key: 'created', label: 'Joined', render: (u) => fmt.date(u.created) },
];

// Adding a filter is one entry. Every type the framework supports is here:
// text (icontains), select, multiselect (__in), boolean, number (gte), and
// two dateranges — only one range can be active at a time by construction.
const FILTERS: FilterDef[] = [
    { key: 'display_name', label: 'Name', type: 'text', placeholder: 'Contains…' },
    { key: 'email', label: 'Email', type: 'text', placeholder: 'Contains…' },
    {
        key: 'role', label: 'Role', type: 'multiselect', options: [
            { value: 'user', label: 'User' },
            { value: 'staff', label: 'Staff' },
            { value: 'admin', label: 'Admin' },
        ],
    },
    { key: 'is_active', label: 'Status', type: 'boolean', trueLabel: 'Active', falseLabel: 'Inactive' },
    { key: 'mfa_enabled', label: 'MFA', type: 'boolean', trueLabel: 'Enabled', falseLabel: 'Disabled' },
    { key: 'email_verified', label: 'Email verified', type: 'boolean', trueLabel: 'Verified', falseLabel: 'Unverified' },
    { key: 'passkeys', label: 'Passkeys', type: 'number' },
    { key: 'created', label: 'Joined', type: 'daterange' },
    { key: 'last_login', label: 'Last login', type: 'daterange' },
];

export function UsersPage() {
    const qc = useQueryClient();
    const save = UserModel.useSave();

    const addUser = async () => {
        const form = UserModel.forms.create!;
        const data = await formModal(form);
        if (!data) return;
        try {
            await save.mutateAsync({ id: null, changes: data });
            toast.success(`${String(data.display_name)} created`);
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
            searchPlaceholder="Search name or email…"
            columns={COLUMNS}
            filters={FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'active', label: 'Active', params: { is_active: 'true' } },
                { key: 'admins', label: 'Admins', params: { role: 'admin' } },
                { key: 'inactive', label: 'Inactive', params: { is_active: 'false' } },
            ]}
            onRowClick={openUser}
            addLabel="Add User"
            onAdd={addUser}
        />
    );
}
