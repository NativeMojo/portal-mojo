import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AssistantSetupPage, ConversationsPage, MemoriesPage, SkillsPage } from 'portal-mojo/admin/assistant';
import {
    armMockReauth, login, setMockAssistantSetupScenario, usingMockTransport,
    useRealtimeStatus, useRealtimeTopic, type MockAssistantSetupScenario,
} from 'portal-mojo/client';

type Surface = 'setup' | 'conversations' | 'skills' | 'memory';
const SCENARIOS: readonly MockAssistantSetupScenario[] = ['ready', 'missing-policy', 'missing-key', 'handler', 'bedrock', 'static-stop', 'rejected-key', 'discovery-failure', 'grants', 'deployment', 'manual-pin', 'fixed-policy', 'deployment-pin', 'admin-over-deployment-pin', 'fresh-failure', 'stale-failure', 'unavailable-model', 'throttled', 'in-progress', 'legacy-server', 'malformed-capability'];
function RealtimeLifecycleDemo() {
    const realtime = useRealtimeStatus();
    const topic = useRealtimeTopic('showcase:lifecycle');
    return <div className="panel panel-pad"><div className="eyebrow">Deterministic realtime lifecycle</div><h3 className="panel-title">Transport: {realtime.status}</h3><p className="dim">Generation {realtime.generation} · automatic topic {realtime.automaticUserTopic ?? 'pending'} · refcounted demo topic {topic}</p></div>;
}
export function AdminAssistantDemo() {
    const qc = useQueryClient();
    const [surface, setSurface] = useState<Surface>('conversations');
    const [scenario, setScenario] = useState<MockAssistantSetupScenario>('ready');
    const [setupRevision, setSetupRevision] = useState(0);
    const [switching, setSwitching] = useState(false);
    const [freshArmed, setFreshArmed] = useState(false);
    const switchPersona = async (owner: boolean) => {
        if (!usingMockTransport() || switching) return;
        setSwitching(true);
        try {
            await login(owner ? 'assistant.owner@nativemojo.com' : 'assistant.wildcard@nativemojo.com', 'mojo');
            await qc.invalidateQueries({ queryKey: ['me'] });
            setSetupRevision((value) => value + 1);
        } finally { setSwitching(false); }
    };
    return <div className="flex flex-col gap-3">
        <RealtimeLifecycleDemo />
        <div className="panel panel-pad">
            <div className="eyebrow">Global Admin · streaming when eligible</div>
            <h2 className="panel-title">Assistant control plane</h2>
            <p className="dim">Owned text-only conversations stream over the authenticated transport. Attachments, inspection, and unavailable-transport cases keep the authoritative REST path.</p>
            <div className="seg">{(['setup', 'conversations', 'skills', 'memory'] as Surface[]).map((key) => <button key={key} className={`seg-btn${surface === key ? ' seg-active' : ''}`} onClick={() => setSurface(key)}>{key}</button>)}</div>
        </div>
        {surface === 'setup' ? <>
            <div className="panel panel-pad">
                <h3>Fake setup fixtures</h3>
                <p className="dim">This showcase uses synthetic credentials and mock-only installation state. Owner and denied permission-admin sessions are explicit. The fixture-sonnet-2099 identifiers are fake. In ready, Refresh provider catalogue advances to a newer fixture; manual pins survive that refresh.</p>
                <div className="assistant-action-row">
                    <button className="btn" disabled={switching} onClick={() => void switchPersona(true)}>Use fake installation owner</button>
                    <button className="btn" disabled={switching} onClick={() => void switchPersona(false)}>Use denied permission admin</button>
                    <button className="btn" onClick={() => { if (usingMockTransport()) { armMockReauth('POST', '/api/account/admin/assistant'); setFreshArmed(true); } }}>Require fresh sign-in on next action</button>
                    <label>Scenario <select className="input" value={scenario} onChange={(event) => {
                        const next = event.target.value as MockAssistantSetupScenario;
                        setScenario(next); setMockAssistantSetupScenario(next); setSetupRevision((value) => value + 1);
                    }}>{SCENARIOS.map((value) => <option key={value}>{value}</option>)}</select></label>
                </div>
                {freshArmed && <p className="dim">The next setup action will request fresh sign-in. Keys must be re-entered afterward.</p>}
            </div>
            <AssistantSetupPage key={setupRevision} />
        </> : surface === 'conversations' ? <ConversationsPage /> : surface === 'skills' ? <SkillsPage /> : <MemoriesPage />}
    </div>;
}
