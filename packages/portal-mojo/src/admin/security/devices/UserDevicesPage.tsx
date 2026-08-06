// User Devices — the UserDeviceTablePage port.
//
// The source's search placeholder promised "Search user, IP, or device ID".
// `UserDevice` declares NO `SEARCH_FIELDS` at all, so only the DUID and
// user-agent text the backend's fallback can reach are searchable — user and
// IP are not, and the placeholder must not claim otherwise. They are offered
// as explicit filters instead, which is the honest affordance.
//
// The user filter is a NUMBER (the FK id), not a select: the directory is far
// larger than one page and `FilterDef` has no collection type, so a select
// would silently offer only the first page of users. Opening a device's
// dossier gives the named cross-link to its owner.
import { ModelTable, fmt, type Column, type FilterDef, type Preset } from '../../../ui';
import { showUserDeviceDetail } from './UserDeviceDetail';
import {
    UserDeviceModel, browserLabel, deviceIcon, osLabel, presenceOf,
    type UserDeviceRow,
} from './models';

const COLUMNS: Column<UserDeviceRow>[] = [
    { key: 'id', label: 'ID', sortable: true, align: 'end', render: (row) => <span className="dim">{row.id}</span> },
    {
        key: 'duid', label: 'Device ID', sortable: true, hideable: false,
        render: (row) => (
            <span className="ud-id">
                <i className={`bi ${deviceIcon(row.device_info)}`} />
                <code title={row.duid}>{fmt.truncateMiddle(row.duid, 16)}</code>
            </span>
        ),
    },
    {
        key: 'user', label: 'User', sortable: true,
        render: (row) => row.user?.display_name || row.user?.username || '—',
    },
    { key: 'device_info__user_agent__family', label: 'Browser', render: (row) => browserLabel(row.device_info) },
    { key: 'device_info__os__family', label: 'OS', render: (row) => osLabel(row.device_info) },
    { key: 'last_ip', label: 'Last IP', sortable: true, render: (row) => <code>{row.last_ip || '—'}</code> },
    { key: 'first_seen', label: 'First seen', sortable: true, render: (row) => fmt.datetime(row.first_seen) },
    {
        key: 'last_seen', label: 'Last seen', sortable: true,
        render: (row) => (
            <span className={`ud-presence ud-presence-${presenceOf(row.last_seen)}`}>
                <span className="ud-dot" />{fmt.relative(row.last_seen)}
            </span>
        ),
    },
];

const FILTERS: FilterDef[] = [
    { key: 'user', label: 'User ID', type: 'number', lookup: 'exact', placeholder: 'e.g. 1' },
    { key: 'muid', label: 'MUID', type: 'text' },
    { key: 'duid', label: 'Device ID', type: 'text' },
    { key: 'last_ip', label: 'Last IP', type: 'text' },
    { key: 'last_seen', label: 'Last seen', type: 'daterange' },
];

/** `dayRangeFilter: {field: 'last_seen', value: '30d'}`, as the dr_* triple. */
function presets(): Preset[] {
    const day = (offsetDays: number) => new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);
    return [
        { key: 'all', label: 'All', params: {} },
        { key: 'recent', label: 'Last 30 days', params: { dr_field: 'last_seen', dr_start: day(30), dr_end: day(0) } },
    ];
}

export function UserDevicesPage() {
    return (
        <ModelTable<UserDeviceRow>
            model={UserDeviceModel}
            eyebrow="Security · Devices & Logins"
            title="User Devices"
            searchPlaceholder="Search device ID or user agent"
            columns={COLUMNS}
            filters={FILTERS}
            presets={presets()}
            defaultSort="-last_seen"
            columnChooser
            persistState
            persistKey="admin:devices:user"
            exportFormats={['csv', 'json']}
            onRowClick={(row) => showUserDeviceDetail(row.id)}
        />
    );
}
