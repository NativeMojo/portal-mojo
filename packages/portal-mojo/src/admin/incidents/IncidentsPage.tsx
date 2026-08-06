import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSafeExporter, useCan } from '../../client';
import { Badge, ModelTable, fmt, modal, type BatchAction, type Column, type FilterDef, type Tone } from '../../ui';
import { useRightPanel } from '../../ui/RightPanel';
import { SECURITY_MANAGE_PERMS } from '../security-permissions';
import { IncidentDetail } from './IncidentDetail';
import { INCIDENT_LIFECYCLE, IncidentModel, buildIncidentMerge, type IncidentRow } from './models';
import { sanitizeIncidentRow } from './sanitize';

function priorityTone(priority: number): Tone { return priority >= 8 ? 'danger' : priority >= 5 ? 'warning' : 'info'; }
function statusTone(status: string): Tone { return ['resolved', 'closed'].includes(status) ? 'success' : ['new', 'open'].includes(status) ? 'danger' : status === 'investigating' ? 'warning' : 'muted'; }
const options = (values: readonly string[]) => values.map((value) => ({ value, label: value.replaceAll('_', ' ') }));

const INCIDENT_EXPORTER = createSafeExporter<IncidentRow>({
    endpoint: IncidentModel.endpoint, filename: 'security-incidents', sanitizeRow: sanitizeIncidentRow,
    fields: [
        { key: 'id' }, { key: 'created' }, { key: 'status' }, { key: 'state' }, { key: 'priority' },
        { key: 'scope' }, { key: 'category' }, { key: 'title' }, { key: 'details' },
        { key: 'source_ip' }, { key: 'hostname' }, { key: 'group_id' },
        { key: 'rule_id', value: (row) => row.metadata.rule_id },
        { key: 'protected', value: (row) => Boolean(row.metadata.do_not_delete) },
    ],
});

function MergeTargetForm({ rows, done }: { rows: IncidentRow[]; done: (value: number | null) => void }) {
    const [target, setTarget] = useState(String(rows[0]?.id ?? ''));
    return <form className="modal-pad" onSubmit={(event) => { event.preventDefault(); done(Number(target)); }}>
        <h2 className="modal-title">Choose merge target</h2>
        <p className="dim">The target survives. Every other selected incident becomes a source and is deleted after its events and tickets move.</p>
        <label className="field"><span className="field-label">Target incident</span><select className="input" value={target} onChange={(event) => setTarget(event.target.value)}>{rows.map((row) => <option key={row.id} value={row.id}>#{row.id} · {row.title || row.details || row.category}</option>)}</select></label>
        <div className="modal-actions"><button type="button" className="btn" onClick={() => done(null)}>Cancel</button><button type="submit" className="btn btn-primary">Merge into target</button></div>
    </form>;
}

export function IncidentsPage() {
    const { can: canManage } = useCan(SECURITY_MANAGE_PERMS);
    const queryClient = useQueryClient();
    const panel = useRightPanel();
    const save = IncidentModel.useSave();
    const merge = IncidentModel.useAction('merge');
    const openIncident = (row: IncidentRow, launcher?: HTMLElement | null) => panel.open({
        key: `incident:${row.id}`, title: `Incident #${row.id}`,
        render: ({ close }) => <IncidentDetail id={row.id} onClose={close} />,
    }, launcher);
    const lifecycle = (status: string): BatchAction<IncidentRow> => ({
        key: status, label: `Set ${status}`, icon: 'bi-arrow-left-right',
        run: (row) => save.mutateAsync({ id: row.id, changes: { status } }),
    });
    const actions: BatchAction<IncidentRow>[] = [
        ...['open', 'investigating', 'resolved', 'closed', 'ignored'].map(lifecycle),
        {
            key: 'protect', label: 'Protect', icon: 'bi-shield-fill-check',
            run: (row) => save.mutateAsync({ id: row.id, changes: { metadata: { ...row.metadata, do_not_delete: true } } }),
        },
        {
            key: 'merge', label: 'Merge', icon: 'bi-union', danger: true,
            prepare: async (rows) => {
                if (rows.length < 2) throw new Error('Select at least two incidents to merge.');
                return modal.open<number | null>((done) => <MergeTargetForm rows={rows} done={done} />, { size: 'sm' });
            },
            runBatch: async (rows, prepared) => {
                const spec = buildIncidentMerge(rows, Number(prepared));
                try {
                    await merge.mutateAsync({ id: spec.target.id, payload: spec.sourceIds });
                } finally {
                    for (const id of spec.sourceIds) {
                        queryClient.removeQueries({ queryKey: IncidentModel.keys.one(id) });
                        queryClient.removeQueries({ queryKey: ['record-feed', 'incident-history', id] });
                    }
                    await Promise.all([
                        queryClient.invalidateQueries({ queryKey: IncidentModel.keys.root }),
                        queryClient.invalidateQueries({ queryKey: ['/api/incident/event'] }),
                        queryClient.invalidateQueries({ queryKey: ['record-feed', 'incident-history', spec.target.id] }),
                    ]);
                }
            },
        },
    ];
    const columns: Column<IncidentRow>[] = [
        { key: 'id', label: 'ID', sortable: true, align: 'end', render: (row) => `#${row.id}` },
        { key: 'status', label: 'Status', sortable: true, render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
        { key: 'created', label: 'Created', sortable: true, render: (row) => fmt.datetime(row.created) },
        { key: 'scope', label: 'Scope', sortable: true },
        { key: 'category', label: 'Category', sortable: true, render: (row) => <code>{row.category}</code> },
        { key: 'priority', label: 'Priority', sortable: true, align: 'center', render: (row) => <Badge tone={priorityTone(row.priority)}>P{row.priority}</Badge> },
        { key: 'title', label: 'Details', sortable: true, hideable: false, render: (row) => <span title={row.details ?? undefined}>{fmt.truncate(row.title || row.details || 'No details', 100)}</span> },
    ];
    const filters: FilterDef[] = [
        { key: 'status', label: 'Lifecycle', type: 'multiselect', options: options(INCIDENT_LIFECYCLE) },
        { key: 'created', label: 'Created', type: 'daterange' },
        { key: 'scope', label: 'Scope', type: 'text' }, { key: 'category', label: 'Category', type: 'text' },
        { key: 'priority', label: 'Minimum priority', type: 'number', lookup: 'gte' },
        { key: 'priority', label: 'Maximum priority', type: 'number', lookup: 'lte' },
        { key: 'metadata__rule_id', label: 'Rule ID', type: 'text', lookup: 'exact' },
        { key: 'metadata__do_not_delete', label: 'Protected', type: 'boolean' },
    ];
    return <ModelTable
        model={IncidentModel} title="Incidents" eyebrow="Security operations"
        columns={columns} filters={filters} searchable searchPlaceholder="Search incident details"
        defaultParams={{ sort: '-id', status: 'new' }}
        presets={[{ key: 'new', label: 'New', params: { status: 'new' } }, { key: 'open', label: 'Open', params: { status: 'open' } }, { key: 'investigating', label: 'Investigating', params: { status: 'investigating' } }, { key: 'all', label: 'All', params: {} }]}
        rowTone={(row) => row.priority >= 8 ? 'danger' : row.priority >= 5 ? 'warning' : null}
        exporter={INCIDENT_EXPORTER} exportFormats={['csv', 'json']}
        columnChooser persistState persistKey="admin-security-incidents" autoRefresh={30}
        onRowClick={(row) => openIncident(row)}
        {...(canManage ? { selectable: true, batchActions: actions } : {})}
    />;
}
