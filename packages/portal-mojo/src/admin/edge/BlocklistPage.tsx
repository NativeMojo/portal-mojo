import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { mojoDelete, mojoSave, useCan, withFreshAuth } from '../../client/runtime';
import { ArmedButton, Badge, ModelTable, fmt, modal, toast, type Column, type FilterDef, type Tone } from '../../ui';
import { EdgeBlocklistModel, sanitizeEdgeBlocklistRow, validateBlocklistValue, type EdgeBlocklistRow } from './models';
import { EDGE_BLOCKLIST_MANAGE_PERMS } from './permissions';

export const BLOCKLIST_MODES: readonly { value: string; label: string; tone: Tone; help: string }[] = [
    { value: 'log', label: 'Log', tone: 'info', help: 'Matches are recorded and still served. Start here.' },
    { value: 'enforce', label: 'Enforce', tone: 'danger', help: 'Matches are refused at the edge.' },
    { value: 'allow', label: 'Allow', tone: 'success', help: 'An exemption: a match is never blocked by another entry.' },
    { value: 'off', label: 'Off', tone: 'muted', help: 'Kept on file, does nothing.' },
];
const KIND_LABELS: Record<string, string> = { ip: 'IP or network', ua: 'User agent' };

function modeMeta(mode: string) {
    return BLOCKLIST_MODES.find((entry) => entry.value === mode) ?? { value: mode, label: mode, tone: 'muted' as Tone, help: '' };
}

function BlocklistEditor({ row, pending, close }: { row: EdgeBlocklistRow | null; pending: { current: boolean }; close: (result: 'saved' | 'deleted' | null) => void }) {
    const queryClient = useQueryClient();
    const [kind, setKind] = useState(row?.kind ?? 'ip');
    const [value, setValue] = useState(row?.value ?? '');
    const [mode, setMode] = useState(row?.mode ?? 'log');
    const [note, setNote] = useState(row?.note ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy) return;
        const refusal = validateBlocklistValue(kind, value.trim());
        if (refusal) { setError(refusal); return; }
        setBusy(true); setError(''); pending.current = true;
        try {
            // The response row is authoritative: an address comes back as its network.
            const saved = sanitizeEdgeBlocklistRow(await withFreshAuth(() => mojoSave<EdgeBlocklistRow>(EdgeBlocklistModel.endpoint, row?.id ?? null, { kind, value: value.trim(), mode, note: note.trim() })));
            await EdgeBlocklistModel.invalidate(queryClient);
            toast.success(saved.value === value.trim() ? `${saved.value} saved as ${modeMeta(saved.mode).label.toLowerCase()}.` : `Saved as ${saved.value} (${modeMeta(saved.mode).label.toLowerCase()}): the address was stored as its network.`);
            close('saved');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'The entry was not saved');
        } finally {
            pending.current = false; setBusy(false);
        }
    };
    const remove = async () => {
        if (!row || busy) return;
        // One pending state for save and delete: neither can start over the other.
        setBusy(true); setError(''); pending.current = true;
        try {
            await withFreshAuth(() => mojoDelete(EdgeBlocklistModel.endpoint, row.id));
            await EdgeBlocklistModel.invalidate(queryClient);
            toast.success(`${row.value} removed from the blocklist.`);
            close('deleted');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'The entry was not deleted');
        } finally {
            pending.current = false; setBusy(false);
        }
    };

    return <div className="modal-pad edge-blocklist-editor"><h2 className="modal-title">{row ? 'Edit blocklist entry' : 'New blocklist entry'}</h2>
        {error && <div className="form-alert" role="alert">{error}</div>}
        <form onSubmit={(event) => void submit(event)}><div className="form-grid">
            <label className="field"><span className="field-label">Matches on</span><select className="input" value={kind} disabled={busy} onChange={(event) => setKind(event.target.value)}><option value="ip">IP address or network</option><option value="ua">User agent pattern</option></select></label>
            <label className="field"><span className="field-label">Value <em>*</em></span><input className="input mono" value={value} disabled={busy} onChange={(event) => setValue(event.target.value)} required autoComplete="off" placeholder={kind === 'ip' ? '203.0.113.0/24' : 'sqlmap'} /><span className="field-help">{kind === 'ip' ? 'One address or a CIDR network. An address inside a network is stored as the network.' : 'A pattern matched anywhere in the user agent, ignoring case. No spaces or quotes.'}</span></label>
            <div className="field edge-mode-field"><span className="field-label">Mode</span>
                <div className="edge-mode-control" role="radiogroup" aria-label="Mode">{BLOCKLIST_MODES.map((entry) => <label key={entry.value} className={`edge-mode-option${mode === entry.value ? ' is-selected' : ''}`}><input type="radio" name="edge-blocklist-mode" checked={mode === entry.value} disabled={busy} onChange={() => setMode(entry.value)} /> {entry.label}</label>)}</div>
                <span className="field-help">{modeMeta(mode).help} Log first, watch the edge watch log for this entry, then switch to Enforce. A change reaches the whole fleet in about 10 minutes.</span>
            </div>
            <label className="field"><span className="field-label">Note</span><input className="input" value={note} disabled={busy} maxLength={255} onChange={(event) => setNote(event.target.value)} placeholder="Why this entry exists" /></label>
        </div>
        <div className="modal-actions">
            {row && <ArmedButton icon="bi-trash" label="Delete" armedLabel="Click again to remove this entry from every node" disabled={busy} onConfirm={remove} />}
            <button type="button" className="btn" disabled={busy} onClick={() => close(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div></form>
    </div>;
}

export function openBlocklistEditor(row: EdgeBlocklistRow | null = null): Promise<'saved' | 'deleted' | null> {
    // Escape and the backdrop are refused while a save or delete is in flight.
    const pending = { current: false };
    return modal.open<'saved' | 'deleted' | null>((close) => <BlocklistEditor row={row} pending={pending} close={close} />, { canDismiss: () => !pending.current }).then((value) => value ?? null);
}

const COLUMNS: Column<EdgeBlocklistRow>[] = [
    { key: 'kind', label: 'Matches on', sortable: true, render: (row) => KIND_LABELS[row.kind] ?? row.kind },
    { key: 'value', label: 'Value', sortable: true, hideable: false, render: (row) => <code>{row.value}</code> },
    { key: 'mode', label: 'Mode', sortable: true, render: (row) => <Badge tone={modeMeta(row.mode).tone}>{modeMeta(row.mode).label}</Badge> },
    { key: 'note', label: 'Note', sortable: false, render: (row) => row.note ? <span title={row.note}>{fmt.truncate(row.note, 60)}</span> : <span className="dim">—</span> },
    { key: 'created', label: 'Created', sortable: true, render: (row) => fmt.date(row.created) },
];

const FILTERS: FilterDef[] = [
    { key: 'kind', label: 'Matches on', type: 'select', options: [{ value: 'ip', label: 'IP or network' }, { value: 'ua', label: 'User agent' }] },
    { key: 'mode', label: 'Mode', type: 'select', options: BLOCKLIST_MODES.map((entry) => ({ value: entry.value, label: entry.label })) },
];

export function BlocklistPage() {
    const canManage = useCan(EDGE_BLOCKLIST_MANAGE_PERMS).can;
    return <ModelTable<EdgeBlocklistRow>
        model={EdgeBlocklistModel} eyebrow="Security · Network" title="Edge Blocklist"
        searchable searchPlaceholder="Search value or note"
        columns={COLUMNS} filters={FILTERS} defaultSort="kind"
        columnChooser persistState persistKey="admin:edge:blocklist"
        {...(canManage ? { addLabel: 'New entry', onAdd: () => void openBlocklistEditor(), onRowClick: (row: EdgeBlocklistRow) => void openBlocklistEditor(row) } : {})}
    />;
}
