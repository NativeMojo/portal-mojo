import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArmedButton, Badge, DataView, DetailView, FlatRow, SchemaForm, fmt, modal, toast } from '../../ui';
import { useCan } from '../../client';
import { FilePreview, filePreviewCategory } from './FilePreview';
import { normalizeRenditions, normalizeRenditionRoles, pollRenditionConvergence, renditionMapSignature, type RenditionPollStop } from './file-renditions';
import { FileModel, ShortLinkShareModel, STORAGE_MANAGE_PERMS, createFileShare, isSafeCapabilityUrl, openCapabilityUrl, revokeFileShare, saveFileAndReconcileGroup, type FileRenditionRow } from './models';

function ShareResult({ url, close }: { url: string; close: () => void }) {
    return <div className="modal-pad"><h2 className="modal-title">Share link created</h2><p className="modal-message">This newly minted capability is shown once from component-local state.</p><code className="storage-capability">{url}</code><div className="modal-actions"><button className="btn" onClick={() => void navigator.clipboard.writeText(url)}>Copy</button><button className="btn btn-primary" onClick={close}>Done</button></div></div>;
}

function RenditionRows({ rows, canManage, onRegenerate }: { rows: FileRenditionRow[]; canManage: boolean; onRegenerate: (roles: string[]) => void }) {
    if (!rows.length) return <p className="dim">No renditions have appeared yet.</p>;
    return <div className="storage-renditions">{rows.map((row) => <div className="storage-rendition" key={`${row.role}:${row.id}`}><div><b>{row.role}</b><small>{row.content_type} · {row.width && row.height ? `${row.width}×${row.height} · ` : ''}{row.file_size == null ? 'unknown size' : fmt.filesize(row.file_size)} · {row.upload_status}</small></div><div className="storage-action-row">{isSafeCapabilityUrl(row.url) && <><button className="btn-icon" title="Open rendition" onClick={() => openCapabilityUrl(row.url!)}><i className="bi bi-box-arrow-up-right" /></button><button className="btn-icon" title="Download rendition" onClick={() => openCapabilityUrl(row.url!, true)}><i className="bi bi-download" /></button></>}{canManage && <button className="btn-icon" title={`Regenerate ${row.role}`} onClick={() => onRegenerate([row.role])}><i className="bi bi-arrow-clockwise" /></button>}</div></div>)}</div>;
}

export function FileView({ id, onClose }: { id: number; onClose: () => void }) {
    const queryClient = useQueryClient();
    const query = FileModel.useOne(id);
    const canManage = useCan(STORAGE_MANAGE_PERMS).can;
    const regenerate = FileModel.useAction('regenerate_renditions');
    const remove = FileModel.useDelete();
    const shares = ShortLinkShareModel.useList({ file: id, start: 0, size: 25 }, { enabled: canManage });
    const alive = useRef(true);
    const initialPollStarted = useRef(false);
    const [pollState, setPollState] = useState<RenditionPollStop | 'polling' | null>(null);
    useEffect(() => () => { alive.current = false; }, []);

    const startPoll = async (before: string) => {
        setPollState('polling');
        try {
            const reason = await pollRenditionConvergence({ fileId: id, beforeSignature: before, isCurrent: () => alive.current, fetch: async () => { const result = await query.refetch(); if (!result.data) throw new Error('File refresh returned no record'); return result.data; } });
            if (alive.current) setPollState(reason);
        } catch (error) {
            if (alive.current) { setPollState('timeout'); toast.error(error instanceof Error ? error.message : 'Rendition refresh failed'); }
        }
    };

    const file = query.data;
    useEffect(() => {
        if (!file || initialPollStarted.current || file.upload_status !== 'completed' || normalizeRenditions(file.renditions).length > 0) return;
        if (!['image', 'video', 'document', 'spreadsheet', 'presentation', 'pdf'].includes(filePreviewCategory(file))) return;
        initialPollStarted.current = true;
        void startPoll(renditionMapSignature(file));
    }, [file?.id]);

    if (query.isLoading) return <div className="empty"><p>Loading file…</p></div>;
    if (!file) return <div className="empty"><h2>File unavailable</h2><p>{query.error instanceof Error ? query.error.message : 'The record was not returned.'}</p><button className="btn" onClick={onClose}>Close</button></div>;
    const renditionRows = normalizeRenditions(file.renditions);

    const updatePublic = async () => {
        const next = !file.is_public;
        const ok = await modal.confirm({ title: next ? 'Make file public?' : 'Make file private?', message: <>Change access for <b>{file.filename}</b>?</>, confirmText: next ? 'Make public' : 'Make private', danger: next });
        if (!ok) return;
        try { await saveFileAndReconcileGroup(queryClient, id, { is_public: next }); await query.refetch(); } catch (error) { toast.error(error instanceof Error ? error.message : 'Access change failed'); }
    };
    const createShare = async () => {
        const values = await modal.open<Record<string, unknown>>((close) => <div className="modal-pad"><h2 className="modal-title">Create share link</h2><SchemaForm fields={[{ name: 'expire_days', type: 'text', label: 'Expire after days', help: '0 means no expiry.' }, { name: 'track_clicks', type: 'switch', label: 'Track clicks' }, { name: 'note', type: 'textarea', label: 'Audit note' }]} initial={{ expire_days: '30', track_clicks: false, note: '' }} submitText="Create share" onCancel={() => close(null as never)} onSubmit={(data) => close(data as unknown as Record<string, unknown>)} /></div>);
        if (!values) return;
        try {
            const result = await createFileShare(id, { expire_days: Number(values.expire_days ?? 30), track_clicks: Boolean(values.track_clicks), note: String(values.note ?? '') });
            await modal.open((close) => <ShareResult url={result.url} close={() => close(null)} />, { size: 'sm' });
            await shares.refetch().catch(() => undefined);
        } catch (error) { toast.error(error instanceof Error ? error.message : 'Share creation failed'); }
    };
    const runRegenerate = async (roles: string[] = []) => {
        const normalized = normalizeRenditionRoles(roles);
        const ok = await modal.confirm({ title: normalized.length ? `Regenerate ${normalized.join(', ')}?` : 'Regenerate all renditions?', message: 'The renderer is asynchronous. This viewer polls finite observable state for up to 12 attempts.', confirmText: 'Queue regeneration' });
        if (!ok) return;
        const before = renditionMapSignature(file);
        try { await regenerate.mutateAsync({ id, payload: normalized.length ? normalized : true }); void startPoll(before); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not queue renditions'); }
    };
    const deleteOne = async () => {
        await modal.open((close) => <div className="modal-pad"><h2 className="modal-title">Delete {file.filename}</h2><p className="modal-message">Enter the exact filename. This deletes the record, original backend object, and renditions.</p><SchemaForm fields={[{ name: 'filename', type: 'text', label: 'Exact filename', required: true }]} submitText="Delete file" onCancel={() => close(null)} onSubmit={async (data) => { if (String(data.filename ?? '') !== file.filename) throw new Error('Filename does not match. No request was sent.'); await remove.mutateAsync({ id }); close(true); onClose(); }} /></div>, { size: 'sm' });
    };

    return <DetailView title={file.filename} subtitle={`${file.content_type} · ${file.file_size == null ? 'unknown size' : fmt.filesize(file.file_size)}`} icon="bi-file-earmark" chips={[{ text: file.upload_status, tone: file.upload_status === 'completed' ? 'success' : file.upload_status === 'failed' ? 'danger' : 'warning' }, { text: file.is_public ? 'Public' : 'Private', tone: file.is_public ? 'warning' : 'muted' }]} sections={[
        { key: 'overview', label: 'Overview', icon: 'bi-info-circle', render: () => <div className="detail-section"><div className="storage-action-row">{isSafeCapabilityUrl(file.url) && <><button className="btn" onClick={() => openCapabilityUrl(file.url!)}><i className="bi bi-box-arrow-up-right" /> Open</button><button className="btn" onClick={() => openCapabilityUrl(file.url!, true)}><i className="bi bi-download" /> Download</button><button className="btn" onClick={() => void navigator.clipboard.writeText(file.url!)}><i className="bi bi-copy" /> Copy URL</button></>}{canManage && <button className="btn" onClick={() => void updatePublic()}>{file.is_public ? 'Make private…' : 'Make public…'}</button>}</div>{!isSafeCapabilityUrl(file.url) && <p className="storage-unsafe">The backend URL is absent or unsafe; Open, Download, and Copy are refused.</p>}<FlatRow label="Filename">{file.filename}</FlatRow><FlatRow label="Category">{file.category || 'Unknown'}</FlatRow><FlatRow label="Upload status"><Badge tone={file.upload_status === 'completed' ? 'success' : 'warning'}>{file.upload_status}</Badge></FlatRow><FlatRow label="Public">{file.is_public ? 'Yes' : 'No'}</FlatRow><FlatRow label="Active">{file.is_active ? 'Yes' : 'No'}</FlatRow></div> },
        { key: 'preview', label: 'Preview', icon: 'bi-eye', render: () => <div className="detail-section"><FilePreview file={file} /></div> },
        { key: 'details', label: 'Details', icon: 'bi-card-list', render: () => <div className="detail-section"><FlatRow label="ID">{file.id}</FlatRow><FlatRow label="Content type">{file.content_type}</FlatRow><FlatRow label="Size">{file.file_size == null ? 'Unknown' : fmt.filesize(file.file_size)}</FlatRow><FlatRow label="Group">{typeof file.group === 'object' && file.group ? file.group.name || `#${file.group.id}` : file.group == null ? 'System' : `#${file.group}`}</FlatRow><FlatRow label="Backend">{typeof file.file_manager === 'object' && file.file_manager ? file.file_manager.name || `#${file.file_manager.id}` : `#${file.file_manager ?? '—'}`}</FlatRow><FlatRow label="Created">{fmt.datetime(file.created)}</FlatRow><FlatRow label="Modified">{fmt.datetime(file.modified)}</FlatRow></div> },
        { key: 'renditions', label: 'Renditions', icon: 'bi-images', render: () => <div className="detail-section"><div className="storage-section-head"><div><h3>Renditions</h3><p className="dim">Derived from the role-keyed File graph; no duplicate rendition store.</p></div>{canManage && <button className="btn" onClick={() => void runRegenerate()}>Regenerate all…</button>}</div><RenditionRows rows={renditionRows} canManage={canManage} onRegenerate={(roles) => void runRegenerate(roles)} />{pollState === 'polling' && <p className="dim"><i className="bi bi-arrow-repeat spin" /> Waiting for observable rendition change…</p>}{pollState === 'timeout' && <div className="form-alert">No convergence after 12 attempts. The job may still be running. <button className="btn btn-compact" onClick={() => void query.refetch()}>Refresh now</button></div>}{pollState && ['failed', 'expired'].includes(pollState) && <div className="form-alert">Polling stopped because upload state is {pollState}.</div>}</div> },
        { key: 'shares', label: 'Shares', icon: 'bi-share', render: () => <div className="detail-section"><div className="storage-section-head"><div><h3>Visible shares</h3><p className="dim">Owner-visible rows only unless the caller separately holds global shortlink authority.</p></div>{canManage && <button className="btn btn-primary" onClick={() => void createShare()}>Create share…</button>}</div>{!canManage ? <p className="dim">Share controls are unavailable for this viewer.</p> : shares.isError ? <div className="form-alert">Visible shares unavailable. File inspection remains available.</div> : (shares.data?.rows ?? []).length === 0 ? <p className="dim">No visible shares.</p> : <div className="storage-shares">{shares.data!.rows.map((share) => <div key={share.id}><span><code>{share.code}</code><small>{share.is_active ? 'Active' : 'Revoked'} · {share.expires_at ? fmt.datetime(share.expires_at) : 'No expiry'} · {share.hit_count} hits</small></span>{share.is_active && <button className="btn btn-compact" onClick={async () => { await revokeFileShare(share.id); await shares.refetch(); }}>Revoke</button>}</div>)}</div>}</div> },
        { key: 'metadata', label: 'Metadata', icon: 'bi-braces', render: () => <div className="detail-section"><DataView data={file.metadata ?? {}} columns={2} /></div> },
        ...(canManage ? [{ key: 'danger', label: 'Danger zone', icon: 'bi-exclamation-octagon', permissions: STORAGE_MANAGE_PERMS, render: () => <div className="detail-section storage-danger"><h3>Delete file</h3><p>This removes the backend object and derived renditions. It cannot be undone.</p><ArmedButton className="btn-danger" icon="bi-trash" label="Delete file" armedLabel="Click again — open exact-filename confirmation" onConfirm={deleteOne} /></div> }] : []),
    ]} initialSection="overview" onClose={onClose} />;
}
