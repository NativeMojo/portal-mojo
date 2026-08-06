import { useQueryClient } from '@tanstack/react-query';
import { Badge, ModelTable, fmt, modal, type Column, type FilterDef } from '../../ui';
import { DomainDetail } from './DomainDetail';
import { DomainModel, type DomainRow } from './models';
import { providerLabel } from './data';

const columns: Column<DomainRow>[] = [
    { key: 'name', label: 'Domain', sortable: true, hideable: false, render: (row) => <code>{row.name}</code> },
    { key: 'provider', label: 'Provider', sortable: true, render: (row) => providerLabel(row.provider) },
    { key: 'status', label: 'Status', sortable: true, render: (row) => <Badge tone={fmt.inferTone(row.status)}>{row.status}</Badge> },
    { key: 'group', label: 'Group', render: (row) => typeof row.group === 'object' ? row.group?.name ?? 'Platform' : row.group ?? 'Platform' },
    { key: 'expires', label: 'Expires', sortable: true, render: (row) => fmt.date(row.expires) },
    { key: 'created', label: 'Created', sortable: true, render: (row) => fmt.date(row.created) },
];
const filters: FilterDef[] = [
    { key: 'provider', label: 'Provider', type: 'select', options: [{ value: 'route53', label: 'Route 53' }, { value: 'godaddy', label: 'GoDaddy' }, { value: 'mojo', label: 'Mojo certificate-only' }] },
    { key: 'status', label: 'Status', type: 'select', options: ['pending', 'registering', 'active'].map((value) => ({ value, label: value })) },
];

export function DomainsPage() {
    const queryClient = useQueryClient();
    const open = async (row: DomainRow) => {
        await DomainModel.fetchOne(queryClient, row.id);
        await modal.detail((close) => <DomainDetail id={row.id} onClose={() => close(null)} />);
    };
    return <ModelTable<DomainRow> model={DomainModel} eyebrow="Infrastructure · DNS" title="Domains" searchable searchPlaceholder="Search domain names" columns={columns} filters={filters} defaultParams={{ sort: 'name' }} columnChooser persistState persistKey="admin:dns:domains" onRowClick={(row) => void open(row)} />;
}

