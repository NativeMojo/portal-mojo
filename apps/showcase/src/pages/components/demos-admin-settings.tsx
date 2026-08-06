// MERGE-WIRE: after portal-mojo/admin exports ./settings, replace this relative
// import with `portal-mojo/admin` and register AdminSettingsDemo in ComponentsPage.
import {
    SettingsPage,
    buildSettingPayload,
    type SettingRow,
} from '../../../../../packages/portal-mojo/src/admin/settings';

const SECRET_ROW: SettingRow = {
    id: 402,
    created: 1_720_000_000,
    modified: 1_725_000_000,
    key: 'MAIL_API_TOKEN',
    display_value: '******',
    is_secret: true,
    group: null,
};

export function AdminSettingsDemo() {
    const transition = buildSettingPayload({
        key: SECRET_ROW.key,
        value: '',
        valueTouched: true,
        is_secret: false,
        group: null,
    }, SECRET_ROW);
    return (
        <div style={{ display: 'grid', gap: 16 }}>
            <div className="panel panel-pad">
                <div className="eyebrow">Ordered atomic write</div>
                <p className="dim">
                    Secret → Plain sends an explicit replacement; the ordered keys below prove
                    <code> is_secret </code> precedes <code>value</code>.
                </p>
                <code>{Object.keys(transition ?? {}).join(' → ')}</code>
            </div>
            <SettingsPage />
        </div>
    );
}
