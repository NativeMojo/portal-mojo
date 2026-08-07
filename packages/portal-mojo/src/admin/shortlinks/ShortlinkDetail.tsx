import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArmedButton, DetailView, FlatRow, fmt, toast } from '../../ui';
import {
    ShortlinkModel, ShortlinkReconciliationError, deleteShortlink, functionalShortlinkUrl,
    refreshShortlinks, setShortlinkActive, useTrackedCounts,
} from './models';

export function ShortlinkDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const queryClient = useQueryClient();
    const query = ShortlinkModel.useOne(id);
    const [retryBlocked, setRetryBlocked] = useState(false);
    const counts = useTrackedCounts(query.data ?? null);
    if (!query.data) return <div className="modal-pad"><p>{query.isLoading ? 'Loading…' : 'Shortlink unavailable.'}</p><div className="modal-actions"><button className="btn" onClick={onClose}>Close</button></div></div>;
    const row = query.data;
    const capability = functionalShortlinkUrl(row.code);
    const act = async (action: () => Promise<unknown>, success: string): Promise<boolean> => {
        if (retryBlocked) return false;
        try { await action(); toast.success(success); await query.refetch(); return true; }
        catch (error) {
            if (error instanceof ShortlinkReconciliationError) setRetryBlocked(true);
            toast.error(error instanceof Error ? error.message : 'Shortlink operation failed');
            return false;
        }
    };
    const refresh = async () => {
        try { await refreshShortlinks(queryClient); await query.refetch(); setRetryBlocked(false); toast.success('Authoritative shortlink state refreshed'); }
        catch { toast.error('Refresh failed. Mutations remain blocked.'); }
    };
    return <DetailView title={row.code} subtitle={row.source || 'No source label'} icon="bi-link-45deg"
        chips={[{ text: row.is_active ? 'Active' : 'Inactive', tone: row.is_active ? 'success' : 'muted' }]}
        onClose={onClose} sections={[
            { key: 'overview', label: 'Overview', icon: 'bi-info-circle', render: () => <div className="detail-section">
                {retryBlocked && <div className="form-alert">The last change may have persisted, but reconciliation failed. Refresh successfully before retrying.</div>}
                <div className="shortlink-actions"><button className="btn" onClick={() => void navigator.clipboard.writeText(capability)}><i className="bi bi-copy" /> Copy short URL</button><button className="btn" onClick={() => void refresh()}><i className="bi bi-arrow-clockwise" /> Refresh</button></div>
                <FlatRow label="Short URL"><code>{capability}</code></FlatRow>
                <FlatRow label="Source">{row.source || '—'}</FlatRow><FlatRow label="Hits">{row.hit_count}</FlatRow>
                <FlatRow label="Expires">{row.expires_at ? fmt.datetime(row.expires_at) : 'Never'}</FlatRow>
                <FlatRow label="Tracking">{row.track_clicks ? 'Enabled' : 'Disabled'}</FlatRow>
                <FlatRow label="Bot passthrough">{row.bot_passthrough ? 'Enabled' : 'Disabled'}</FlatRow>
                <FlatRow label="Protected">{row.is_protected ? 'Yes' : 'No'}</FlatRow>
                <FlatRow label="Created">{fmt.datetime(row.created)}</FlatRow>
            </div> },
            { key: 'traffic', label: 'Traffic', icon: 'bi-bar-chart', render: () => <div className="detail-section">
                <h3>Tracked records</h3><p className="dim">Human and bot values count retained tracking records. Total hits may also include requests made while tracking was off.</p>
                {counts.isLoading ? <p>Loading counts…</p> : counts.isError ? <div className="form-alert">Tracked counts unavailable.</div> : <div className="shortlink-counts"><div><b>{counts.data?.human ?? 0}</b><span>Human records</span></div><div><b>{counts.data?.bot ?? 0}</b><span>Bot records</span></div><div><b>{counts.data?.remainder ?? row.hit_count}</b><span>Hit-count remainder</span></div></div>}
            </div> },
            { key: 'controls', label: 'Controls', icon: 'bi-sliders', render: () => <div className="detail-section">
                <h3>{row.is_active ? 'Deactivate link' : 'Reactivate link'}</h3><p>Changes use a single non-retrying request followed by an authoritative refresh.</p>
                <button className="btn" disabled={retryBlocked} onClick={() => void act(() => setShortlinkActive(queryClient, row, !row.is_active), row.is_active ? 'Shortlink deactivated' : 'Shortlink reactivated')}>{row.is_active ? 'Deactivate' : 'Reactivate'}</button>
                <h3>Delete link</h3><p>Deletion is permanent. Click history is removed by the backend cascade.</p>
                <ArmedButton label="Delete shortlink" armedLabel={`Click again to delete ${row.code}`} disabled={retryBlocked} onConfirm={async () => { if (await act(() => deleteShortlink(queryClient, row), 'Shortlink deleted')) onClose(); }} />
            </div> },
        ]} />;
}
