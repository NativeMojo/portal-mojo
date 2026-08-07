import { useQueryClient } from '@tanstack/react-query';
import { Badge, ModelTable, fmt, modal, toast, type BatchAction, type Column, type FilterDef } from '../../ui';
import { useCan } from '../../client/runtime';
import { FileManagerDetail } from './FileManagerDetail';
import { openFileManagerEditor } from './storage-dialogs';
import { FileManagerModel, GROUP_DIRECTORY_PERMS, STORAGE_MANAGE_PERMS, USER_DIRECTORY_PERMS, exportFileManagers, storageRelationId, saveFileManagerAtomic, type FileManagerRow } from './models';

function scope(row: FileManagerRow): string { return storageRelationId(row.group) != null ? `Group · ${(typeof row.group === 'object' && row.group?.name) || `#${storageRelationId(row.group)}`}` : storageRelationId(row.user) != null ? `User · ${(typeof row.user === 'object' && row.user && (row.user.display_name || row.user.name)) || `#${storageRelationId(row.user)}`}` : 'System'; }
const COLUMNS: Column<FileManagerRow>[] = [
    { key: 'name', label: 'Name', sortable: true, hideable: false },
    { key: 'backend_type', label: 'Backend', sortable: true, render: (row) => <Badge tone={row.backend_type === 's3' ? 'info' : 'muted'}>{row.backend_type}</Badge> },
    { key: 'backend_url', label: 'Location', render: (row) => <code>{fmt.truncate(row.backend_url, 36)}</code> },
    { key: 'scope', label: 'Scope', render: scope },
    { key: 'is_active', label: 'Active', sortable: true, render: (row) => <Badge tone={row.is_active ? 'success' : 'muted'}>{row.is_active ? 'Active' : 'Inactive'}</Badge> },
    { key: 'is_default', label: 'Default', sortable: true, render: (row) => row.is_default ? <i className="bi bi-star-fill text-warn" /> : '—' },
    { key: 'is_public', label: 'Access', sortable: true, render: (row) => <Badge tone={row.is_public ? 'warning' : 'success'}>{row.is_public ? 'Public' : 'Private'}</Badge> },
    { key: 'aws_region', label: 'Region', render: (row) => row.aws_region || '—' },
    { key: 'credentials', label: 'Credentials', render: (row) => row.aws_key_masked ? <code>{row.aws_key_masked}</code> : '—' },
    { key: 'created', label: 'Created', sortable: true, render: (row) => fmt.date(row.created) },
];
const FILTERS: FilterDef[] = [
    { key: 'backend_type', label: 'Backend', type: 'select', options: [{ value: 'file', label: 'File system' }, { value: 's3', label: 'AWS S3' }] },
    { key: 'is_active', label: 'Active', type: 'boolean' }, { key: 'is_default', label: 'Default', type: 'boolean' }, { key: 'is_public', label: 'Public', type: 'boolean' },
    { key: 'group__isnull', label: 'Group scope', type: 'boolean', trueLabel: 'No group', falseLabel: 'Has group' },
];

export function showFileManagerDetail(id: number): void { void modal.detail((close) => <FileManagerDetail id={id} onClose={() => close(null)} />); }

export function BackendsPage() {
    const queryClient = useQueryClient();
    const manage = useCan(STORAGE_MANAGE_PERMS);
    const canManage = manage.can;
    const canViewGroups = useCan(GROUP_DIRECTORY_PERMS).can;
    const canViewUsers = useCan(USER_DIRECTORY_PERMS).can;
    const canCreate = canManage && (Boolean(manage.me?.is_superuser) || canViewGroups || canViewUsers);
    const saveState = (row: FileManagerRow, active: boolean) => saveFileManagerAtomic({ queryClient, id: row.id, changes: { is_active: active } });
    const batchActions: BatchAction<FileManagerRow>[] = [
        { key: 'activate', label: 'Activate', eligible: (row) => !row.is_active, run: (row) => saveState(row, true) },
        { key: 'deactivate', label: 'Deactivate', eligible: (row) => row.is_active, run: (row) => saveState(row, false) },
    ];
    const add = async () => { const row = await openFileManagerEditor('create'); if (row) toast.success(`${row.name} created private`); };
    return <ModelTable model={FileManagerModel} eyebrow="Infrastructure · Storage" title="Storage Backends" columns={COLUMNS} filters={FILTERS} defaultSort="-created" searchable searchPlaceholder="Search name, backend, description" selectable={canManage} batchActions={canManage ? batchActions : []} columnChooser persistState persistKey="admin:storage:backends" exportFormats={['csv', 'json']} exporter={exportFileManagers} onRowClick={(row) => showFileManagerDetail(row.id)} {...(canCreate ? { addLabel: 'Create backend', onAdd: () => void add() } : {})} />;
}
