import {
    SettingsPage,
    FleetNodeStatus,
    buildSettingPayload,
    type SettingRow,
} from 'portal-mojo/admin/operations';

const SECRET_ROW: SettingRow = {
    id: 402,
    created: 1_720_000_000,
    modified: 1_725_000_000,
    key: 'MAIL_API_TOKEN',
    display_value: '******',
    is_secret: true,
    group: null,
};

const PLAIN_ROW: SettingRow = {
    ...SECRET_ROW,
    id: 401,
    key: 'MAIL_FROM_NAME',
    value: 'NativeMojo',
    display_value: 'NativeMojo',
    is_secret: false,
};

export function AdminSettingsDemo() {
    const toPlain = buildSettingPayload({
        key: SECRET_ROW.key,
        value: '',
        valueTouched: true,
        is_secret: false,
        group: null,
    }, SECRET_ROW);
    const toSecret = buildSettingPayload({
        key: PLAIN_ROW.key,
        value: 'replacement-token',
        valueTouched: true,
        is_secret: true,
        group: null,
    }, PLAIN_ROW);
    return (
        <div style={{ display: 'grid', gap: 16 }}>
            <div className="panel panel-pad">
                <div className="eyebrow">Directional atomic writes</div>
                <p className="dim">
                    The live backend applies fields in insertion order. The two transitions
                    deliberately serialize in opposite directions.
                </p>
                <div style={{ display: 'grid', gap: 8 }}>
                    <span>Plain → Secret: <code>{Object.keys(toSecret ?? {}).join(' → ')}</code></span>
                    <span>Secret → Plain: <code>{Object.keys(toPlain ?? {}).join(' → ')}</code></span>
                </div>
            </div>
            <SettingsPage />
        </div>
    );
}

export function FleetConfigurationDemo() {
    return <FleetNodeStatus revision={'a'.repeat(32)} report={{ status: 'pending', healthy_everywhere: false, health_scope: 'request_service_jobs_and_dependencies',
        nodes: [{ hostname: 'node-a', revision: 'a'.repeat(32), published: true, installed: true,
            restart_requested: true, restarted: true, healthy: true, status: 'healthy' },
        { hostname: 'node-b', revision: 'a'.repeat(32), published: true, installed: false,
            restart_requested: false, restarted: false, healthy: false, status: 'unknown', error_code: 'node_did_not_reply' }] }} />;
}
