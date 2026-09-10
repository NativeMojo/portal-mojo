import { useState } from 'react';
import { Badge, DetailView, FlatRow, formModal, modal } from 'portal-mojo/ui';

function AuditRecord({ onClose }: { onClose?: () => void }) {
    const [name, setName] = useState('Admin modal audit — a long record name with useful lifecycle context');
    const [active, setActive] = useState(true);
    const [busy, setBusy] = useState(false);
    const [draft, setDraft] = useState('');
    const toggle = async (next: boolean) => {
        if (busy) return;
        setBusy(true);
        try { if (await modal.confirm({ title: next ? 'Reactivate demo record?' : 'Deactivate demo record?', message: 'This changes only the local demonstration record. History is retained.', confirmText: next ? 'Reactivate' : 'Deactivate' })) setActive(next); }
        finally { setBusy(false); }
    };
    return <DetailView title={name} subtitle="A local demonstration of the shared record presentation" icon="bi-ui-checks" onClose={onClose}
        active={{ value: active, disabled: busy, onChange: next => void toggle(next) }}
        chips={[{ text: active ? 'Active' : 'Inactive', tone: active ? 'success' : 'muted' }]}
        badges={{ overview: 0, notes: <Badge tone="warning">Review</Badge>, metadata: <span className="rail-dot" /> }}
        contextMenu={[{ label: 'Edit name…', onSelect: async () => { const result = await formModal({ title: 'Edit demo record', fields: [{ name: 'name', label: 'Name', type: 'text', required: true }], initial: { name } }); if (typeof result?.name === 'string' && result.name.trim()) setName(result.name.trim()); } }, { label: active ? 'Deactivate' : 'Reactivate', disabled: busy, onSelect: () => void toggle(!active) }]}
        sections={[
            { key: 'overview', label: 'Overview', icon: 'bi-info-circle', render: () => <><FlatRow label="Lifecycle">{active ? 'Active' : 'Inactive'}</FlatRow><p>Open the header menu for focused editors and lifecycle actions. No action-only navigation sections are present.</p><p>At narrow container widths the section control expands in place; zero, rich and dot badges retain their rendering.</p></> },
            { divider: 'Content' },
            { key: 'notes', label: 'Notes', icon: 'bi-journal', render: () => <label className="field"><span className="field-label">Retained section draft</span><textarea className="input" value={draft} onChange={event => setDraft(event.target.value)} /></label> },
            { key: 'metadata', label: 'Metadata', icon: 'bi-braces', render: () => <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify({ long_value: 'Long content remains scrollable. '.repeat(45), nested: { retained: true } }, null, 2)}</pre> },
        ]} />;
}

export function AdminModalsDemo() {
    const [narrow, setNarrow] = useState(true);
    return <div className="detail-audit-demo"><div className="panel panel-pad"><h2 className="panel-title">Admin modal convention</h2><p className="dim">Inspect responsive record chrome, nested editors, cancellation, content badges and embedded sizing. Domain demos use the actual mock resources and lifecycle handlers.</p><div className="demo-row"><button className="btn btn-primary" onClick={() => void modal.detail(close => <AuditRecord onClose={() => close(null)} />)}>Open audit record</button><button className="btn" onClick={() => setNarrow(value => !value)}>{narrow ? 'Use wide embedded host' : 'Use 390px embedded host'}</button></div></div><div className="panel" style={{ width: narrow ? 'min(390px, 100%)' : '100%', marginTop: 16 }}><AuditRecord /></div></div>;
}
