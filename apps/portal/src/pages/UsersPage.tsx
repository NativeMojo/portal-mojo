// Users — a full ModelTable page in ~80 declarative lines: columns, filters,
// presets, add form. This is the per-screen authoring cost of the toolkit.
import { ModelTable, type Column } from '../components/ModelTable';
import type { FilterDef } from '../components/FilterBar';
import { formModal } from '../components/FormFields';
import { modal } from '../components/modal';
import { toast } from '../components/toast';
import { Badge } from '../components/ui';
import { useSaveModel } from '../lib/hooks';
import * as fmt from '../lib/format';
import type { User } from '../lib/types';
import { UserDetail } from './UserDetail';

const ENDPOINT = '/api/account/user';

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
    const save = useSaveModel<User>(ENDPOINT);

    const addUser = async () => {
        const data = await formModal({
            title: 'Add user',
            submitText: 'Create',
            fields: [
                { name: 'display_name', type: 'text', label: 'Display name', required: true, placeholder: 'Jane Cooper' },
                { name: 'email', type: 'email', label: 'Email', required: true, placeholder: 'jane@example.com' },
                { name: 'phone', type: 'tel', label: 'Phone', columns: 6 },
                {
                    name: 'role', type: 'select', label: 'Role', columns: 6, options: [
                        { value: 'user', label: 'User' },
                        { value: 'staff', label: 'Staff' },
                        { value: 'admin', label: 'Admin' },
                    ],
                },
            ],
        });
        if (!data) return;
        try {
            await save.mutateAsync({ id: null, changes: data });
            toast.success(`${data.display_name} created`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Create failed');
        }
    };

    return (
        <ModelTable<User>
            endpoint={ENDPOINT}
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
            onRowClick={(u) => { void modal.detail((close) => <UserDetail id={u.id} onClose={() => close(null)} />); }}
            addLabel="Add User"
            onAdd={addUser}
        />
    );
}
