import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useCan } from '../../client/runtime';
import { Badge, DetailView, FlatRow, fmt, modal, toast } from '../../ui';
import { FileView } from './FileView';
import { FileManagerModel, FileModel, GROUP_DIRECTORY_PERMS, STORAGE_MANAGE_PERMS, USER_DIRECTORY_PERMS, runFileManagerAction, saveFileManagerAtomic, storageRelationId } from './models';
import { openFileManagerEditor } from './storage-dialogs';

function NestedFiles({ managerId }: { managerId: number }) {
    const query = FileModel.useList({ file_manager: managerId, start: 0, size: 10, sort: '-created' });
    if (query.isLoading) return <p className="dim">Loading recent files…</p>;
    if (query.isError) return <div className="form-alert">{query.error instanceof Error ? query.error.message : 'Files unavailable'}</div>;
    const rows = query.data?.rows ?? [];
    return <div className="storage-child-files">{rows.length === 0 ? <p className="dim">No files. Upload is unavailable in this release.</p> : rows.map((file) => <button key={file.id} className="storage-child-file" onClick={() => void modal.detail((close) => <FileView id={file.id} onClose={() => close(null)} />)}><span><b>{file.filename}</b><small>{file.content_type} · {fmt.filesize(file.file_size ?? 0)}</small></span><i className="bi bi-chevron-right" /></button>)}</div>;
}

export function FileManagerDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const queryClient = useQueryClient();
    const [pending, setPending] = useState(false);
    const query = FileManagerModel.useOne(id);
    const managerPermission = useCan(STORAGE_MANAGE_PERMS);
    const groupDirectoryPermission = useCan(GROUP_DIRECTORY_PERMS);
    const userDirectoryPermission = useCan(USER_DIRECTORY_PERMS);
    const canManage = managerPermission.can;
    const canChangeOwner = groupDirectoryPermission.can || userDirectoryPermission.can || Boolean(managerPermission.me?.is_superuser);
    if (query.isLoading) return <div className="empty"><p>Loading storage backend…</p></div>;
    if (!query.data) return <div className="empty"><h2>Storage backend unavailable</h2><p>{query.error instanceof Error ? query.error.message : 'The record was not returned.'}</p><button className="btn" onClick={onClose}>Close</button></div>;
    const row = query.data;
    const edit = async (mode: 'general' | 'credentials' | 'owner') => { const saved = await openFileManagerEditor(mode, row); if (saved) { toast.success(`${saved.name} updated`); await query.refetch(); } };
    const action = async (name: 'test_connection' | 'check_cors' | 'fix_cors') => { try { const result = await runFileManagerAction(id, name); toast.success(name === 'test_connection' ? 'Connection succeeded' : `${name.replace('_', ' ')} completed`); await modal.open((close) => <div className="modal-pad"><h2 className="modal-title">{name.replaceAll('_', ' ')}</h2><pre className="storage-result-json">{JSON.stringify(result, null, 2)}</pre><div className="modal-actions"><button className="btn" onClick={() => close(null)}>Close</button></div></div>); } catch (error) { toast.error(error instanceof Error ? error.message : `${name} failed`); } };
    const clone = async () => { const ok = await modal.confirm({ title: 'Clone backend?', message: <>Create a private clone of <b>{row.name}</b> under the same explicit owner scope?</>, confirmText: 'Clone' }); if (!ok) return; try { await runFileManagerAction(id, 'clone'); await FileManagerModel.invalidate(queryClient); toast.success(`${row.name} cloned`); } catch (error) { toast.error(error instanceof Error ? error.message : 'Clone failed'); } };
    const toggle = async () => { const ok = await modal.confirm({ title: row.is_public ? 'Make backend private?' : 'Make backend public?', message: 'This changes prefix policy on the storage provider. Continue?', confirmText: row.is_public ? 'Make private' : 'Make public', danger: !row.is_public }); if (!ok) return; try { await saveFileManagerAtomic({ queryClient, id, changes: { is_public: !row.is_public } }); await query.refetch(); } catch (error) { toast.error(error instanceof Error ? error.message : 'Access change failed'); } };
    const setActive = async (next: boolean) => {
        if (!canManage || pending) return; setPending(true);
        try { await saveFileManagerAtomic({ queryClient, id, changes: { is_active: next } }); await query.refetch(); }
        catch (error) { toast.error(error instanceof Error ? error.message : 'State change failed'); }
        finally { setPending(false); }
    };
    return <DetailView active={canManage ? { value: row.is_active, disabled: pending, onChange: next => void setActive(next) } : undefined}
        contextMenu={canManage ? [
            { label: 'Edit backend', onSelect: () => void edit('general') },
            { label: 'Credentials…', onSelect: () => void edit('credentials') },
            ...(canChangeOwner ? [{ label: 'Owner scope…', onSelect: () => void edit('owner') }] : []),
            { label: row.is_active ? 'Deactivate' : 'Reactivate', disabled: pending, onSelect: () => void setActive(!row.is_active) },
            { label: row.is_public ? 'Make private…' : 'Make public…', onSelect: () => void toggle() },
            { label: 'Test connection', onSelect: () => void action('test_connection') },
            ...(row.backend_type === 's3' ? [{ label: 'Check CORS', onSelect: () => void action('check_cors') }, { label: 'Fix CORS', onSelect: () => void action('fix_cors') }] : []),
            { label: 'Clone…', onSelect: () => void clone() },
        ] : []} title={row.name} subtitle={`${row.backend_type} · ${row.backend_url}`} icon="bi-hdd-stack" chips={[{ text: row.is_active ? 'Active' : 'Inactive', tone: row.is_active ? 'success' : 'muted' }, { text: row.is_public ? 'Public' : 'Private', tone: row.is_public ? 'warning' : 'success' }]} sections={[
        { key: 'overview', label: 'Overview', icon: 'bi-info-circle', render: () => <div className="detail-section"><FlatRow label="Backend"><Badge tone="info">{row.backend_type}</Badge></FlatRow><FlatRow label="Use">{row.use || '—'}</FlatRow><FlatRow label="URL"><code>{row.backend_url}</code></FlatRow><FlatRow label="Owner">{storageRelationId(row.group) != null ? `Group #${storageRelationId(row.group)}` : storageRelationId(row.user) != null ? `User #${storageRelationId(row.user)}` : 'System'}</FlatRow><FlatRow label="Default">{row.is_default ? 'Yes' : 'No'}</FlatRow><FlatRow label="Region">{row.aws_region || '—'}</FlatRow><FlatRow label="Access key">{row.aws_key_masked || 'Not configured'}</FlatRow><FlatRow label="Secret key">{row.aws_secret_masked || 'Not configured'}</FlatRow><FlatRow label="Created">{fmt.datetime(row.created)}</FlatRow></div> },
        { key: 'files', label: 'Files', icon: 'bi-files', render: () => <div className="detail-section"><h3>Recent files</h3><p className="dim">Newest 10 for this backend. This bounded child inventory does not own URL table state.</p><NestedFiles managerId={id} /></div> },

    ]} initialSection="overview" onClose={onClose} />;
}
