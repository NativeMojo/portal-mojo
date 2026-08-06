import { useQueryClient } from '@tanstack/react-query';
import { Badge, DetailView, FlatRow, fmt, modal, toast } from '../../ui';
import { useCan } from '../../client';
import { FileView } from './FileView';
import { openFileManagerEditor } from './storage-dialogs';
import { FileManagerModel, FileModel, GROUP_DIRECTORY_PERMS, STORAGE_MANAGE_PERMS, USER_DIRECTORY_PERMS, relationId, runFileManagerAction, saveFileManagerAtomic } from './models';

function NestedFiles({ managerId }: { managerId: number }) {
    const query = FileModel.useList({ file_manager: managerId, start: 0, size: 10, sort: '-created' });
    if (query.isLoading) return <p className="dim">Loading recent files…</p>;
    if (query.isError) return <div className="form-alert">{query.error instanceof Error ? query.error.message : 'Files unavailable'}</div>;
    const rows = query.data?.rows ?? [];
    return <div className="storage-child-files">{rows.length === 0 ? <p className="dim">No files. Upload is unavailable in this release.</p> : rows.map((file) => <button key={file.id} className="storage-child-file" onClick={() => void modal.detail((close) => <FileView id={file.id} onClose={() => close(null)} />)}><span><b>{file.filename}</b><small>{file.content_type} · {fmt.filesize(file.file_size ?? 0)}</small></span><i className="bi bi-chevron-right" /></button>)}</div>;
}

export function FileManagerDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const queryClient = useQueryClient();
    const query = FileManagerModel.useOne(id);
    const canManage = useCan(STORAGE_MANAGE_PERMS).can;
    const canChangeOwner = useCan(GROUP_DIRECTORY_PERMS).can || useCan(USER_DIRECTORY_PERMS).can || Boolean(useCan([]).me?.is_superuser);
    if (query.isLoading) return <div className="empty"><p>Loading storage backend…</p></div>;
    if (!query.data) return <div className="empty"><h2>Storage backend unavailable</h2><p>{query.error instanceof Error ? query.error.message : 'The record was not returned.'}</p><button className="btn" onClick={onClose}>Close</button></div>;
    const row = query.data;
    const edit = async (mode: 'general' | 'credentials' | 'owner') => { const saved = await openFileManagerEditor(mode, row); if (saved) { toast.success(`${saved.name} updated`); await query.refetch(); } };
    const action = async (name: 'test_connection' | 'check_cors' | 'fix_cors') => { try { const result = await runFileManagerAction(id, name); toast.success(name === 'test_connection' ? 'Connection succeeded' : `${name.replace('_', ' ')} completed`); await modal.open((close) => <div className="modal-pad"><h2 className="modal-title">{name.replaceAll('_', ' ')}</h2><pre className="storage-result-json">{JSON.stringify(result, null, 2)}</pre><div className="modal-actions"><button className="btn" onClick={() => close(null)}>Close</button></div></div>); } catch (error) { toast.error(error instanceof Error ? error.message : `${name} failed`); } };
    const clone = async () => { const ok = await modal.confirm({ title: 'Clone backend?', message: <>Create a private clone of <b>{row.name}</b> under the same explicit owner scope?</>, confirmText: 'Clone' }); if (!ok) return; try { await runFileManagerAction(id, 'clone'); await FileManagerModel.invalidate(queryClient); toast.success(`${row.name} cloned`); } catch (error) { toast.error(error instanceof Error ? error.message : 'Clone failed'); } };
    const toggle = async () => { const ok = await modal.confirm({ title: row.is_public ? 'Make backend private?' : 'Make backend public?', message: 'This changes prefix policy on the storage provider. Continue?', confirmText: row.is_public ? 'Make private' : 'Make public', danger: !row.is_public }); if (!ok) return; try { await saveFileManagerAtomic({ queryClient, id, changes: { is_public: !row.is_public } }); await query.refetch(); } catch (error) { toast.error(error instanceof Error ? error.message : 'Access change failed'); } };
    return <DetailView title={row.name} subtitle={`${row.backend_type} · ${row.backend_url}`} icon="bi-hdd-stack" chips={[{ text: row.is_active ? 'Active' : 'Inactive', tone: row.is_active ? 'success' : 'muted' }, { text: row.is_public ? 'Public' : 'Private', tone: row.is_public ? 'warning' : 'success' }]} sections={[
        { key: 'overview', label: 'Overview', icon: 'bi-info-circle', render: () => <div className="detail-section"><div className="storage-action-row">{canManage && <><button className="btn" onClick={() => void edit('general')}>Edit</button><button className="btn" onClick={() => void edit('credentials')}>Credentials</button>{canChangeOwner && <button className="btn" onClick={() => void edit('owner')}>Owner scope</button>}<button className="btn" onClick={() => void toggle()}>{row.is_public ? 'Make private…' : 'Make public…'}</button></>}</div><FlatRow label="Backend"><Badge tone="info">{row.backend_type}</Badge></FlatRow><FlatRow label="Use">{row.use || '—'}</FlatRow><FlatRow label="URL"><code>{row.backend_url}</code></FlatRow><FlatRow label="Owner">{relationId(row.group) != null ? `Group #${relationId(row.group)}` : relationId(row.user) != null ? `User #${relationId(row.user)}` : 'System'}</FlatRow><FlatRow label="Default">{row.is_default ? 'Yes' : 'No'}</FlatRow><FlatRow label="Region">{row.aws_region || '—'}</FlatRow><FlatRow label="Access key">{row.aws_key_masked || 'Not configured'}</FlatRow><FlatRow label="Secret key">{row.aws_secret_masked || 'Not configured'}</FlatRow><FlatRow label="Created">{fmt.datetime(row.created)}</FlatRow></div> },
        { key: 'files', label: 'Files', icon: 'bi-files', render: () => <div className="detail-section"><h3>Recent files</h3><p className="dim">Newest 10 for this backend. This bounded child inventory does not own URL table state.</p><NestedFiles managerId={id} /></div> },
        { key: 'operations', label: 'Operations', icon: 'bi-tools', permissions: STORAGE_MANAGE_PERMS, render: () => <div className="detail-section"><h3>Provider operations</h3><div className="storage-action-row"><button className="btn" onClick={() => void action('test_connection')}>Test connection</button>{row.backend_type === 's3' && <><button className="btn" onClick={() => void action('check_cors')}>Check CORS</button><button className="btn" onClick={() => void action('fix_cors')}>Fix CORS</button></>}<button className="btn" onClick={() => void clone()}>Clone…</button></div><p className="dim">Backend deletion and public-access audit shortcuts are deliberately unavailable.</p></div> },
    ]} initialSection="overview" onClose={onClose} />;
}
