import { Badge, DetailView, Eyebrow, FlatRow, fmt } from '../../ui';
import { useCan } from '../../client/runtime';
import {
    SETTINGS_PERMISSIONS, SettingModel, settingGroupLabel, type SettingRow,
} from './model';
import { showSettingEditor } from './SettingEditor';

export function SettingDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const { data: row, isPending, error } = SettingModel.useOne(id);
    const { can } = useCan(SETTINGS_PERMISSIONS);
    if (isPending) return <div className="modal-pad dim">Loading setting…</div>;
    if (!row || error) return <div className="modal-pad text-bad">{error?.message ?? 'Setting not found'}</div>;

    return (
        <DetailView<SettingRow>
            icon={row.is_secret ? 'bi-shield-lock' : 'bi-gear'}
            title={row.key}
            subtitle={`${settingGroupLabel(row.group)} · setting #${row.id}`}
            chips={[
                { text: row.is_secret ? 'Secret' : 'Plain', tone: row.is_secret ? 'warning' : 'muted' },
            ]}
            sections={[
                {
                    key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => (
                        <>
                            <Eyebrow>Configuration</Eyebrow>
                            <FlatRow label="Key"><code>{row.key}</code></FlatRow>
                            <FlatRow label="Value">
                                <code>{row.is_secret ? row.display_value || '******' : row.display_value || '—'}</code>
                            </FlatRow>
                            <FlatRow label="Scope">{settingGroupLabel(row.group)}</FlatRow>
                            <FlatRow label="Storage">
                                <Badge tone={row.is_secret ? 'warning' : 'muted'}>{row.is_secret ? 'Secret' : 'Plain'}</Badge>
                            </FlatRow>
                            <FlatRow label="Created">{fmt.datetime(row.created)}</FlatRow>
                            <FlatRow label="Modified">{fmt.datetime(row.modified)}</FlatRow>
                            {row.is_secret && (
                                <p className="dim">
                                    The stored value is write-only. Editing with a blank replacement preserves it.
                                </p>
                            )}
                            {can && (
                                <div style={{ marginTop: 16 }}>
                                    <button className="btn btn-compact" onClick={() => void showSettingEditor(row)}>
                                        <i className="bi bi-pencil" /> Edit setting
                                    </button>
                                </div>
                            )}
                        </>
                    ),
                },
            ]}
            menuContext={row}
            onClose={onClose}
        />
    );
}
