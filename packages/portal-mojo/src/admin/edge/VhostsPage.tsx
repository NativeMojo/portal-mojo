import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, ModelTable, modal, toast, type Column, type FilterDef } from '../../ui';
import { useCan } from '../../client/runtime';
import { EDGE_MANAGE_PERMS, EdgeVhostModel, VHOST_KIND_CARDS, vhostKindTitle, type EdgeVhostRow } from './models';
import { VhostDetail } from './VhostDetail';
import { ServingReadiness } from './ServingReadiness';
import { openVhostWizard } from './VhostWizard';

const COLUMNS: Column<EdgeVhostRow>[] = [
    { key: 'server_name', label: 'Hostname', sortable: false, hideable: false, render: (row) => <span className="ops-cell"><strong>{row.server_name ?? '—'}</strong><small>{row.domain?.name}</small></span> },
    { key: 'kind', label: 'Serves', sortable: true, render: (row) => <Badge tone="info">{vhostKindTitle(row.kind)}</Badge> },
    { key: 'is_enabled', label: 'State', sortable: true, render: (row) => row.is_enabled ? <span title="Enabled configuration; readiness is reported separately"><Badge tone="info">Enabled</Badge></span> : <Badge tone="muted">Disabled</Badge> },
];

const FILTERS: FilterDef[] = [
    { key: 'kind', label: 'Serves', type: 'select', options: VHOST_KIND_CARDS.map((card) => ({ value: card.value, label: card.title })) },
    { key: 'is_enabled', label: 'State', type: 'boolean', trueLabel: 'Enabled', falseLabel: 'Disabled' },
    { key: 'pool', label: 'Pool', type: 'text' },
];

export function VhostsPage() {
    const queryClient = useQueryClient();
    const [revision, setRevision] = useState(0);
    const changed = () => setRevision(value => value + 1);
    const canManage = useCan(EDGE_MANAGE_PERMS).can;
    const open = async (row: EdgeVhostRow) => {
        try {
            await EdgeVhostModel.fetchOne(queryClient, row.id);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not open the hostname');
            return;
        }
        let pending = false;
        await modal.detail((close) => <VhostDetail id={row.id} onChanged={changed} onBusyChange={value => { pending = value; }} onClose={() => { if (!pending) close(null); }} />);
    };
    const create = async () => {
        const saved = await openVhostWizard();
        if (saved) { changed(); toast.success(`${saved.server_name ?? 'Hostname'} configuration saved${saved.is_enabled ? ', enabled intent' : ', disabled'}.`); }
    };
    return <div className="edge-serving-page"><header className="page-header edge-serving-heading"><div><div className="eyebrow">Infrastructure · Edge</div><h1>Serving</h1></div>{canManage && <button type="button" className="btn btn-primary" onClick={() => void create()}><i className="bi bi-plus-lg" /> Add hostname</button>}</header><ServingReadiness refreshRevision={revision} /><ModelTable<EdgeVhostRow>
        model={EdgeVhostModel} title="Hostnames"
        searchable searchPlaceholder="Search label, kind or pool"
        columns={COLUMNS} filters={FILTERS} defaultSort="label"
        columnChooser persistState persistKey="admin:edge:vhosts"
        onRowClick={(row) => void open(row)}
    /></div>;
}
