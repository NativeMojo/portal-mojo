import { Badge, DetailView, Eyebrow, FlatRow, fmt } from '../../ui';
import { useCan, useMe } from '../../client/runtime';
import { backendGlobalCan } from '../fleet/access';
import {
    SETTINGS_PERMISSIONS, SettingModel, settingGroupLabel, type SettingRow,
} from './model';
import { showSettingEditor } from './SettingEditor';
import { SettingValue } from './SettingValue';
import { useAdminRouteContext } from '../core/route-context';

export function SettingDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const { data: row, isPending, error } = SettingModel.useOne(id);
    const { can } = useCan(SETTINGS_PERMISSIONS);
    const route = useAdminRouteContext();
    const { data: me } = useMe();
    const maintenanceHref = backendGlobalCan(me, ['view_platform','manage_platform','admin']) && route?.paths.includes('maintenance') ? `#${route.mount}/maintenance?tab=framework` : undefined;
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
                                <SettingValue row={row} />
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
                            {row.key === 'EDGE_FRAMEWORK_VERSION' ? <p className="dim">Managed by Maintenance → Django-MOJO. {maintenanceHref && <a href={maintenanceHref} onClick={onClose}>Open framework policy</a>}</p> : can && (
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
