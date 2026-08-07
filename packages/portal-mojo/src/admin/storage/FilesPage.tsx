import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, CollectionSelect, ModelTable, fmt, modal, type BatchAction, type Column, type FilterDef } from '../../ui';
import { useCan } from '../../client/runtime';
import { FileView } from './FileView';
import { FileUploadSurface } from './FileUploadSurface';
import { FileModel, GROUP_DIRECTORY_PERMS, STORAGE_MANAGE_PERMS, exportFiles, openCapabilityUrl, saveFileAndReconcileGroup, type FileRow, type RelationRow } from './models';

const COLUMNS: Column<FileRow>[] = [
    { key: 'filename', label: 'Filename', sortable: true, hideable: false },
    { key: 'category', label: 'Category', sortable: true, render: (row) => <Badge tone="info">{row.category || 'unknown'}</Badge> },
    { key: 'content_type', label: 'Content type', sortable: true },
    { key: 'file_size', label: 'Size', sortable: true, align: 'end', render: (row) => row.file_size == null ? '—' : fmt.filesize(row.file_size) },
    { key: 'group', label: 'Group', render: (row) => typeof row.group === 'object' && row.group ? row.group.name || `#${row.group.id}` : row.group == null ? 'System' : `#${row.group}` },
    { key: 'file_manager', label: 'Backend', render: (row) => typeof row.file_manager === 'object' && row.file_manager ? row.file_manager.name || `#${row.file_manager.id}` : `#${row.file_manager ?? '—'}` },
    { key: 'upload_status', label: 'Upload', sortable: true, render: (row) => <Badge tone={row.upload_status === 'completed' ? 'success' : row.upload_status === 'failed' ? 'danger' : 'warning'}>{row.upload_status}</Badge> },
    { key: 'is_public', label: 'Access', sortable: true, render: (row) => <Badge tone={row.is_public ? 'warning' : 'muted'}>{row.is_public ? 'Public' : 'Private'}</Badge> },
    { key: 'user', label: 'Uploader', render: (row) => typeof row.user === 'object' && row.user ? row.user.display_name || row.user.name || `#${row.user.id}` : `#${row.user ?? '—'}` },
    { key: 'created', label: 'Created', sortable: true, render: (row) => fmt.datetime(row.created) },
];
const FILTERS: FilterDef[] = [
    { key: 'upload_status', label: 'Upload status', type: 'select', options: ['pending', 'uploading', 'completed', 'failed', 'expired'].map((value) => ({ value, label: value })) },
    { key: 'is_public', label: 'Public', type: 'boolean' },
    { key: 'category', label: 'Category', type: 'select', options: ['image', 'video', 'audio', 'document', 'spreadsheet', 'presentation', 'archive', 'text'].map((value) => ({ value, label: value })) },
    { key: 'created', label: 'Created', type: 'daterange' },
];

function MoveGroupDialog({ rows, close }: { rows: FileRow[]; close: (value: number | null) => void }) {
    const [group, setGroup] = useState<number | null>(null);
    return <div className="modal-pad"><h2 className="modal-title">Move {rows.length} selected file{rows.length === 1 ? '' : 's'}</h2><p className="modal-message">Choose the explicit target group. Cancelling sends no request.</p><CollectionSelect<RelationRow> endpoint="/api/group" value={group} onChange={(id) => setGroup(id == null ? null : Number(id))} label="Target group" required placeholder="Search authorized groups" /><div className="modal-actions"><button className="btn" onClick={() => close(null)}>Cancel</button><button className="btn btn-primary" disabled={group == null} onClick={() => close(group)}>Move files</button></div></div>;
}

export function showFileView(id: number): void { void modal.detail((close) => <FileView id={id} onClose={() => close(null)} />); }

export function FilesPage() {
    const queryClient = useQueryClient();
    const canManage = useCan(STORAGE_MANAGE_PERMS).can;
    const canChooseGroup = useCan(GROUP_DIRECTORY_PERMS).can;
    const remove = FileModel.useDelete();
    const saveAccess = (row: FileRow, value: boolean) => saveFileAndReconcileGroup(queryClient, row.id, { is_public: value });
    const batches: BatchAction<FileRow>[] = [
        { key: 'public', label: 'Make public', eligible: (row) => !row.is_public, confirm: 'Make the selected files public?', run: (row) => saveAccess(row, true) },
        { key: 'private', label: 'Make private', eligible: (row) => row.is_public, run: (row) => saveAccess(row, false) },
        ...(canChooseGroup ? [{ key: 'move', label: 'Move to group', confirm: false as const, prepare: (rows: FileRow[]) => modal.open<number>((close) => <MoveGroupDialog rows={rows} close={(value) => close(value as number)} />), run: (row: FileRow, prepared: unknown) => saveFileAndReconcileGroup(queryClient, row.id, { group: Number(prepared) }, Number(prepared)) }] : []),
        { key: 'download', label: 'Download selected', confirm: false, run: async (row) => { if (!openCapabilityUrl(row.url ?? '', true)) throw new Error(`${row.filename} has no safe download URL`); } },
        { key: 'delete', label: 'Delete', danger: true, confirm: 'Delete the selected files and their backend objects? This cannot be undone.', run: (row) => remove.mutateAsync({ id: row.id }) },
    ];
    const table = (openUpload?: () => void) => <ModelTable model={FileModel} eyebrow="Infrastructure · Storage" title="Files" columns={COLUMNS} filters={FILTERS} presets={[{ key: 'all', label: 'All', params: {} }, { key: 'ready', label: 'Ready', params: { upload_status: 'completed' } }, { key: 'failed', label: 'Failed', params: { upload_status: 'failed' } }, { key: 'public', label: 'Public', params: { is_public: 'true' } }]} defaultSort="-created" searchable searchPlaceholder="Search filename or content type" selectable={canManage} batchActions={canManage ? batches : []} columnChooser persistState persistKey="admin:storage:files" exportFormats={['csv', 'json']} exporter={exportFiles} onAdd={openUpload} addLabel="Add File" onRowClick={(row) => showFileView(row.id)} />;
    // Do not mount picker/drop/manager queries for view-only operators.
    return canManage
        ? <FileUploadSurface canManage canChooseGroup={canChooseGroup}>{(openUpload) => table(openUpload)}</FileUploadSurface>
        : table();
}
