import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, CollectionSelect, ModelTable, modal, toast, type Column, type FilterDef } from '../../ui';
import { getAuthSessionRevision, useAuthSnapshot, useCan, useTableParams } from '../../client/runtime';
import { DomainModel, type DomainRow } from '../dns/models';
import { EDGE_MANAGE_PERMS, EdgeVhostModel, VHOST_KIND_CARDS, vhostKindTitle, type EdgeVhostRow } from './models';
import { VhostDetail } from './VhostDetail';
import { ServingReadiness } from './ServingReadiness';
import { openVhostWizard } from './VhostWizard';

const COLUMNS: Column<EdgeVhostRow>[] = [
    { key: 'server_name', label: 'Hostname', sortable: false, hideable: false, render: row => <span className="ops-cell"><strong>{row.server_name ?? '—'}</strong><small>{row.domain?.name}</small></span> },
    { key: 'kind', label: 'Serves', sortable: true, render: row => <Badge tone="info">{vhostKindTitle(row.kind)}</Badge> },
    { key: 'is_enabled', label: 'State', sortable: true, render: row => <Badge tone={row.is_enabled ? 'info' : 'muted'}>{row.is_enabled ? 'Enabled' : 'Disabled'}</Badge> },
];
const FILTERS: FilterDef[] = [
    { key: 'kind', label: 'Serves', type: 'select', options: VHOST_KIND_CARDS.map(card => ({ value: card.value, label: card.title })) },
    { key: 'is_enabled', label: 'State', type: 'boolean', trueLabel: 'Enabled', falseLabel: 'Disabled' },
];

export function VhostsPage() {
    const queryClient = useQueryClient();
    const [revision, setRevision] = useState(0);
    const changed = () => setRevision(value => value + 1);
    const canManage = useCan(EDGE_MANAGE_PERMS).can;
    const auth = useAuthSnapshot();
    const scope = `${auth.uid}:${getAuthSessionRevision()}`;
    const lifetime = useRef<AbortController | null>(null);
    useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, [scope, canManage]);
    const params = useTableParams({ sort: 'label' });
    const domain = params.filterValue('domain');
    const open = async (row: EdgeVhostRow) => {
        const signal = lifetime.current?.signal;
        try { await EdgeVhostModel.fetchOne(queryClient, row.id); }
        catch (error) { if (!signal?.aborted) toast.error(error instanceof Error ? error.message : 'Could not open the hostname'); return; }
        let pending = false;
        await modal.open(close => <VhostDetail id={row.id} onChanged={changed} onBusyChange={value => { pending = value; }} onClose={() => { if (!pending) close(null); }} />, { size: 'lg', signal, canDismiss: () => !pending });
    };
    const create = async () => {
        if (!canManage) return;
        const signal = lifetime.current?.signal;
        const saved = await openVhostWizard(null, { signal });
        if (saved && !signal?.aborted) { changed(); toast.success(`${saved.server_name ?? 'Hostname'} configuration saved${saved.is_enabled ? ', enabled intent' : ', disabled'}.`); await open(saved); }
    };
    return <div className="edge-serving-page"><header className="page-header edge-serving-heading"><div><div className="eyebrow">Network &amp; hosting</div><h1>Serving</h1><ServingReadiness refreshRevision={revision} /></div>{canManage && <button type="button" className="btn btn-primary" onClick={() => void create()}><i className="bi bi-plus-lg" /> Add hostname</button>}</header><div className="edge-domain-filter"><CollectionSelect<DomainRow> model={DomainModel} value={domain ? Number(domain) : null} label="Domain" placeholder="All domains" defaultParams={{ sort: 'name' }} onChange={id => params.setFilter('domain', id == null ? null : String(id))} /></div><ModelTable<EdgeVhostRow> model={EdgeVhostModel} title="Hostnames" searchable searchPlaceholder="Search label, type or pool" columns={COLUMNS} filters={FILTERS} defaultSort="label" columnChooser persistState persistKey="admin:edge:vhosts" onRowClick={row => void open(row)} /></div>;
}
