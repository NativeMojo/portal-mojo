import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, ModelTable, fmt, modal, toast, type Column, type FilterDef } from '../../ui';
import {
    ShortlinkModel, ShortlinkReconciliationError, createShortlink, functionalShortlinkUrl,
    refreshShortlinks, type ShortlinkRow,
} from './models';
import { ShortlinkDetail } from './ShortlinkDetail';

const columns: Column<ShortlinkRow>[] = [
    { key: 'code', label: 'Code', sortable: true, hideable: false, render: (row) => <code>{row.code}</code> },
    { key: 'source', label: 'Source', sortable: true, render: (row) => row.source || '—' },
    { key: 'is_active', label: 'State', sortable: true, render: (row) => <Badge tone={row.is_active ? 'success' : 'muted'}>{row.is_active ? 'Active' : 'Inactive'}</Badge> },
    { key: 'hit_count', label: 'Hits', sortable: true, align: 'end' },
    { key: 'expires_at', label: 'Expires', sortable: true, render: (row) => row.expires_at ? fmt.datetime(row.expires_at) : 'Never' },
    { key: 'created', label: 'Created', sortable: true, render: (row) => fmt.datetime(row.created) },
];
const filters: FilterDef[] = [
    { key: 'source', label: 'Source', type: 'text' }, { key: 'is_active', label: 'Active', type: 'boolean' },
    { key: 'created', label: 'Created', type: 'daterange' },
];

function CreateShortlink({ close, blockRetries }: { close: (value: unknown) => void; blockRetries: () => void }) {
    const queryClient = useQueryClient();
    const [url, setUrl] = useState(''); const [source, setSource] = useState(''); const [days, setDays] = useState('3');
    const [track, setTrack] = useState(false); const [botPassthrough, setBotPassthrough] = useState(false); const [busy, setBusy] = useState(false);
    const submit = async (event: React.FormEvent) => {
        event.preventDefault(); setBusy(true);
        try {
            const row = await createShortlink(queryClient, { url, source, expire_days: Math.max(0, Number(days) || 0), track_clicks: track, bot_passthrough: botPassthrough });
            toast.success(`Shortlink ${row.code} created`); close(row);
        } catch (error) {
            if (error instanceof ShortlinkReconciliationError) blockRetries();
            toast.error(error instanceof Error ? error.message : 'Shortlink creation failed');
        } finally { setBusy(false); }
    };
    return <form className="modal-pad" onSubmit={(event) => void submit(event)}><h2 className="modal-title">Create shortlink</h2><p className="dim">The destination is sent once to the API and is deliberately omitted from cached Admin rows.</p>
        <label className="field"><span className="field-label">Destination URL</span><input className="input" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} /></label>
        <label className="field"><span className="field-label">Source label</span><input className="input" maxLength={50} value={source} onChange={(event) => setSource(event.target.value)} /></label>
        <label className="field"><span className="field-label">Expire after days</span><input className="input" type="number" min="0" value={days} onChange={(event) => setDays(event.target.value)} /><span className="field-help">0 means no expiry.</span></label>
        <label className="check-row"><input type="checkbox" checked={track} onChange={(event) => setTrack(event.target.checked)} /> Track click records</label>
        <label className="check-row"><input type="checkbox" checked={botPassthrough} onChange={(event) => setBotPassthrough(event.target.checked)} /> Allow known preview bots through</label>
        <div className="modal-actions"><button type="button" className="btn" onClick={() => close(null)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button></div>
    </form>;
}

export function showShortlinkDetail(id: number): void { void modal.detail((close) => <ShortlinkDetail id={id} onClose={() => close(null)} />); }

export function ShortlinksPage() {
    const queryClient = useQueryClient(); const [retryBlocked, setRetryBlocked] = useState(false);
    const refresh = async () => { try { await refreshShortlinks(queryClient); setRetryBlocked(false); toast.success('Shortlinks refreshed'); } catch { toast.error('Refresh failed. Mutations remain blocked.'); } };
    return <div className="shortlinks-page">{retryBlocked && <div className="form-alert shortlink-page-alert">A change may have persisted without authoritative reconciliation. Creation is blocked until refresh succeeds. <button className="btn btn-compact" onClick={() => void refresh()}>Refresh</button></div>}
        <ModelTable model={ShortlinkModel} eyebrow="Communications · Redirects" title="Shortlinks" columns={columns} filters={filters}
            searchable={false} defaultSort="-created" columnChooser persistState persistKey="admin:shortlinks:links"
            addLabel="Create shortlink" onAdd={retryBlocked ? undefined : () => void modal.open((close) => <CreateShortlink close={close} blockRetries={() => setRetryBlocked(true)} />, { size: 'sm' })}
            onRowClick={(row) => showShortlinkDetail(row.id)} />
        <p className="shortlink-origin-note">Displayed short URLs use the configured API origin: <code>{functionalShortlinkUrl('code')}</code>.</p>
    </div>;
}
