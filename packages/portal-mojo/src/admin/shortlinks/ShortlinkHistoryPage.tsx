import { Badge, ModelTable, fmt, type Column, type FilterDef } from '../../ui';
import { ShortlinkHistoryModel, type ShortlinkHistoryRow } from './models';

const columns: Column<ShortlinkHistoryRow>[] = [
    { key: 'created', label: 'Created', sortable: true, hideable: false, render: (row) => fmt.datetime(row.created) },
    { key: 'shortlink', label: 'Code', render: (row) => row.code ? <code>{row.code}</code> : '—' },
    { key: 'is_bot', label: 'Audience', sortable: true, render: (row) => <Badge tone={row.is_bot ? 'warning' : 'info'}>{row.is_bot ? 'Bot' : 'Human'}</Badge> },
    { key: 'agent_summary', label: 'Agent summary' }, { key: 'referer_origin', label: 'Referrer origin', render: (row) => row.referer_origin ?? 'Direct / unknown' },
];
const filters: FilterDef[] = [
    { key: 'shortlink', label: 'Shortlink ID', type: 'number' }, { key: 'is_bot', label: 'Bot', type: 'boolean' },
    { key: 'created', label: 'Created', type: 'daterange' },
];

export function ShortlinkHistoryPage() {
    return <ModelTable model={ShortlinkHistoryModel} eyebrow="Communications · Redirects" title="Tracked click records"
        columns={columns} filters={filters} searchable={false} defaultSort="-created" columnChooser persistState persistKey="admin:shortlinks:history" />;
}
