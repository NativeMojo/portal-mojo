import { useQueryClient } from '@tanstack/react-query';
import {
    Badge, ModelTable, fmt, modal, type Column, type FilterDef,
} from '../../ui';
import {
    SettingModel, settingGroupLabel, type SettingRow,
} from './model';
import { SettingDetail } from './SettingDetail';
import { showSettingEditor } from './SettingEditor';

const COLUMNS: Column<SettingRow>[] = [
    {
        key: 'key', label: 'Key', sortable: true, hideable: false, render: (row) => (
            <div className="cell-user">
                <span className="cell-avatar"><i className="bi bi-gear" /></span>
                <span><span className="cell-name"><code>{row.key}</code></span><span className="cell-sub">#{row.id}</span></span>
            </div>
        ),
    },
    {
        key: 'display_value', label: 'Value', render: (row) => (
            <code>{row.is_secret ? row.display_value || '******' : row.display_value || '—'}</code>
        ),
    },
    { key: 'group', label: 'Scope', render: (row) => settingGroupLabel(row.group) },
    {
        key: 'is_secret', label: 'Storage', sortable: true, align: 'center', render: (row) => (
            <Badge tone={row.is_secret ? 'warning' : 'muted'}>{row.is_secret ? 'Secret' : 'Plain'}</Badge>
        ),
    },
    { key: 'created', label: 'Created', sortable: true, render: (row) => fmt.date(row.created) },
];

const FILTERS: FilterDef[] = [
    { key: 'is_secret', label: 'Storage', type: 'boolean', trueLabel: 'Secret', falseLabel: 'Plain' },
    {
        key: 'group__isnull', label: 'Scope', type: 'select', options: [
            { value: 'true', label: 'Global' },
            { value: 'false', label: 'Group scoped' },
        ],
    },
];

export function SettingsPage() {
    const queryClient = useQueryClient();
    const openDetail = (row: SettingRow) => {
        void SettingModel.fetchOne(queryClient, row.id).catch(() => undefined);
        void modal.detail((close) => <SettingDetail id={row.id} onClose={() => close(null)} />);
    };
    return (
        <ModelTable<SettingRow>
            model={SettingModel}
            eyebrow="Account"
            title="Settings"
            searchPlaceholder="Search setting keys…"
            columns={COLUMNS}
            filters={FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'global', label: 'Global', params: { group__isnull: 'true' } },
                { key: 'group', label: 'Group scoped', params: { group__isnull: 'false' } },
                { key: 'secret', label: 'Secrets', params: { is_secret: 'true' } },
            ]}
            defaultSort="key"
            columnChooser
            persistState
            onRowClick={openDetail}
            addLabel="New Setting"
            onAdd={() => void showSettingEditor()}
        />
    );
}
