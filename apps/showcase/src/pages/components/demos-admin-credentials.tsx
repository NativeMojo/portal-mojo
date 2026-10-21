// MERGE-WIRE: orchestrator should import AdminCredentialsDemo in
// ComponentsPage.tsx and register it under a new/existing Admin group.
// This leaf deliberately owns no shared showcase registry edits.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { login, setMockConnectionScenario } from 'portal-mojo/client';
import {
    ApiKeyLimitsSummary, GroupApiKeyDetail, GroupApiKeysPage, GroupApiKeysSection,
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
    const [crossGroup, setCrossGroup] = useState(false);
    const [persona, setPersona] = useState('dns.platform@nativemojo.com'), [ready, setReady] = useState(false); const qc = useQueryClient();
    useEffect(() => { let active = true; setReady(false); setMockConnectionScenario('ready'); void login(persona, 'mojo').then(async () => { await qc.invalidateQueries(); if (active) setReady(true); }); return () => { active = false; }; }, [persona, qc]);
    useEffect(() => () => { setMockConnectionScenario('ready'); void login('showcase.operator@nativemojo.com', 'mojo'); }, []);
    const openKey = (id: number) => {
        void modal.detail((close) => <GroupApiKeyDetail id={id} onClose={() => close(null)} />);
    };
    return (
        <div className="dns-shared-showcase" style={{ display: 'grid', gap: 18 }}>
            <label className="field"><span className="field-label">Credential identity</span><select className="input" value={persona} onChange={e => setPersona(e.target.value)}><option value="dns.platform@nativemojo.com">Deployment operator</option><option value="showcase.operator@nativemojo.com">Ordinary credential manager</option></select></label>
            <label><input type="checkbox" checked={crossGroup} onChange={e => setCrossGroup(e.target.checked)} />Cross-Group key inventory</label>
            <div className="panel">
                <div className="panel-head">
                    <div>
                        <div className="eyebrow">Package section</div>
                        <h3 style={{ margin: 0 }}>Group API keys</h3>
                    </div>
                    <span className="chip chip-info">secret-safe create</span>
                </div>
                <div className="panel-body">
                    {ready ? crossGroup ? <GroupApiKeysPage /> : <GroupApiKeysSection group={DEMO_GROUP} /> : <p>Preparing fixture…</p>}
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
                API-key token reads and webhook-secret reads occur only after an explicit click. A deployment operator can use Create ACME consumer key to resolve the original hub Group UUID and issue the fixed protected purpose without editing permission names.
            </p>
        </div>
    );
}
