// MERGE-WIRE: orchestrator should import AdminCredentialsDemo in
// ComponentsPage.tsx and register it under a new/existing Admin group.
// This leaf deliberately owns no shared showcase registry edits.
import {
    GroupApiKeysSection,
    WebhookSubscriptionsSection,
    type CredentialGroup,
} from 'portal-mojo/admin/identity';

const DEMO_GROUP: CredentialGroup = {
    id: 1,
    name: 'Northstar Operations',
    kind: 'org',
};

export function AdminCredentialsDemo() {
    return (
        <div style={{ display: 'grid', gap: 18 }}>
            <div className="panel">
                <div className="panel-head">
                    <div>
                        <div className="eyebrow">Package section</div>
                        <h3 style={{ margin: 0 }}>Group API keys</h3>
                    </div>
                    <span className="chip chip-info">secret-safe create</span>
                </div>
                <div className="panel-body">
                    <GroupApiKeysSection group={DEMO_GROUP} />
                </div>
            </div>

            <div className="panel">
                <div className="panel-head">
                    <div>
                        <div className="eyebrow">Package section</div>
                        <h3 style={{ margin: 0 }}>Webhook subscriptions</h3>
                    </div>
                    <span className="chip chip-info">explicit secret reveal</span>
                </div>
                <div className="panel-body">
                    <WebhookSubscriptionsSection group={DEMO_GROUP} />
                </div>
            </div>

            <p className="dim" style={{ margin: 0 }}>
                Both examples are the same package components used by GroupDetail.
                API-key token reads and webhook-secret reads occur only after an explicit click.
            </p>
        </div>
    );
}
