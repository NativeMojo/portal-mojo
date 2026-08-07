import { useState } from 'react';
import { ConversationsPage, MemoriesPage, SkillsPage } from 'portal-mojo/admin';
import { useRealtimeStatus, useRealtimeTopic } from 'portal-mojo/client';

type Surface = 'conversations' | 'skills' | 'memory';
function RealtimeLifecycleDemo() {
    const realtime = useRealtimeStatus();
    const topic = useRealtimeTopic('showcase:lifecycle');
    return <div className="panel panel-pad"><div className="eyebrow">Deterministic realtime lifecycle</div><h3 className="panel-title">Transport: {realtime.status}</h3><p className="dim">Generation {realtime.generation} · automatic topic {realtime.automaticUserTopic ?? 'pending'} · refcounted demo topic {topic}</p></div>;
}
export function AdminAssistantDemo() {
    const [surface, setSurface] = useState<Surface>('conversations');
    return <div className="flex flex-col gap-3"><RealtimeLifecycleDemo /><div className="panel panel-pad"><div className="eyebrow">Global Admin · streaming when eligible</div><h2 className="panel-title">Assistant control plane</h2><p className="dim">Owned text-only conversations stream over the authenticated transport. Attachments, inspection, and unavailable-transport cases keep the authoritative REST path.</p><div className="seg">{(['conversations', 'skills', 'memory'] as Surface[]).map((key) => <button key={key} className={`seg-btn${surface === key ? ' seg-active' : ''}`} onClick={() => setSurface(key)}>{key}</button>)}</div></div>{surface === 'conversations' ? <ConversationsPage /> : surface === 'skills' ? <SkillsPage /> : <MemoriesPage />}</div>;
}
