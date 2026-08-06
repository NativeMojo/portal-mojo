import { createSafeExporter } from '../../client';
import { Badge, ModelTable, fmt, groupByDay, type Column, type FilterDef, type Tone } from '../../ui';
import { useRightPanel } from '../../ui/RightPanel';
import { EventDetail } from './EventDetail';
import { EventModel, type EventRow } from './models';
import { sanitizeEventRow } from './sanitize';

function levelTone(level: number): Tone { return level >= 8 ? 'danger' : level >= 4 ? 'warning' : 'muted'; }
const EVENT_EXPORTER = createSafeExporter<EventRow>({
    endpoint: EventModel.endpoint, filename: 'security-events', sanitizeRow: sanitizeEventRow,
    fields: [
        { key: 'id' }, { key: 'created' }, { key: 'level' }, { key: 'scope' }, { key: 'category' },
        { key: 'title' }, { key: 'details' }, { key: 'source_ip' }, { key: 'hostname' },
        { key: 'country_code' }, { key: 'model_name' }, { key: 'model_id' }, { key: 'group_id' },
        { key: 'server', value: (row) => row.metadata.server },
    ],
});
const FILTERS: FilterDef[] = [
    { key: 'created', label: 'Created', type: 'daterange' },
    { key: 'level', label: 'Minimum level', type: 'number', lookup: 'gte' },
    { key: 'level', label: 'Maximum level', type: 'number', lookup: 'lte' },
    { key: 'scope', label: 'Scope', type: 'text' }, { key: 'category', label: 'Category', type: 'text' },
    { key: 'category', label: 'Not category', type: 'text', lookup: 'not' },
    { key: 'source_ip', label: 'Source IP', type: 'text' }, { key: 'model_name', label: 'Model name', type: 'text' },
    { key: 'model_id', label: 'Model ID', type: 'number', lookup: 'exact' },
    { key: 'metadata__server', label: 'Server', type: 'text' },
    { key: 'metadata__http_url', label: 'URL contains', type: 'text' },
    { key: 'metadata__http_path', label: 'Path contains', type: 'text' },
    { key: 'metadata__http_query_string', label: 'Query contains', type: 'text' },
    { key: 'metadata__http_status', label: 'HTTP status', type: 'number', lookup: 'exact' },
    { key: 'metadata__http_user_agent', label: 'User agent contains', type: 'text' },
];

export function EventsPage() {
    const panel = useRightPanel();
    const grouping = groupByDay<EventRow>('created');
    const columns: Column<EventRow>[] = [
        { key: 'created', label: 'Created', sortable: true, render: (row) => fmt.datetime(row.created) },
        { key: 'level', label: 'Level', sortable: false, align: 'center', render: (row) => <Badge tone={levelTone(row.level)}>L{row.level}</Badge> },
        { key: 'scope', label: 'Scope', sortable: false }, { key: 'category', label: 'Category', sortable: false, render: (row) => <code>{row.category}</code> },
        { key: 'title', label: 'Details', sortable: false, hideable: false, render: (row) => <span title={row.details ?? undefined}>{fmt.truncate(row.title || row.details || 'No details', 80)}</span> },
        { key: 'source_ip', label: 'Source IP', sortable: false, render: (row) => <code>{row.source_ip || '—'}</code> },
        { key: 'metadata__server', label: 'Server', sortable: false, render: (row) => String(row.metadata.server ?? row.hostname ?? '—') },
    ];
    return <ModelTable
        model={EventModel} title="Events" eyebrow="Security operations"
        columns={columns} filters={FILTERS} searchable searchPlaceholder="Search event details"
        defaultParams={{ sort: '-created', category__not: 'ossec' }}
        rowTone={(row) => row.level >= 8 ? 'danger' : row.level >= 4 ? 'warning' : null}
        {...grouping} groupHeaderStyle="band"
        exporter={EVENT_EXPORTER} exportFormats={['csv', 'json']}
        columnChooser persistState persistKey="admin-security-events" autoRefresh={30}
        onRowClick={(row) => panel.open({ key: `event:${row.id}`, title: `Event #${row.id}`, render: ({ close }) => <EventDetail id={row.id} onClose={close} /> })}
    />;
}
