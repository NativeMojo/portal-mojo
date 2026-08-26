// MERGE-WIRE: orchestrator should import AdminCredentialsDemo in
// ComponentsPage.tsx and register it under a new/existing Admin group.
// This leaf deliberately owns no shared showcase registry edits.
import {
    ApiKeyLimitsSummary, GroupApiKeyDetail, GroupApiKeysSection,
    WebhookSubscriptionsSection,
    type CredentialGroup,
} from 'portal-mojo/admin/identity';
import { modal } from 'portal-mojo/ui';

const DEMO_GROUP: CredentialGroup = {
    id: 1,
    name: 'Northstar Operations',
    kind: 'org',
};

export function AdminCredentialsDemo() {
    const openKey = (id: number) => {
        void modal.detail((close) => <GroupApiKeyDetail id={id} onClose={() => close(null)} />);
    };
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
                        <div className="eyebrow">Rate-limit states</div>
                        <h3 style={{ margin: 0 }}>Lossless limits policy</h3>
                    </div>
                    <span className="chip chip-info">minutes · exact-key clear</span>
                </div>
                <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
                    <div><b>Configured</b><div><ApiKeyLimitsSummary limits={{ orders: { limit: 120, window: 5 } }} /></div></div>
                    <div><b>Default</b><div><ApiKeyLimitsSummary limits={{}} /></div></div>
                    <div>
                        <b>Review and repair</b>
                        <div><ApiKeyLimitsSummary limits={{ partial: { limit: 8 }, scalar: 'legacy', __replace: { limit: 1, window: 1 } }} /></div>
                    </div>
                    <div className="ga-toolbar">
                        <button className="btn btn-primary btn-compact" onClick={() => openKey(201)}>
                            Open configured editor
                        </button>
                        <button className="btn btn-compact" onClick={() => openKey(204)}>
                            Open unsafe/repair editor
                        </button>
                    </div>
                    <p className="dim" style={{ margin: 0 }}>
                        Use the detail editors to exercise validation, edit/repair, cancel a Clear, complete it,
                        and refresh. Stored <code>__replace</code> remains visibly read-only.
                    </p>
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
