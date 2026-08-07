import { useState } from 'react';
import { ConversationsPage, MemoriesPage, SkillsPage } from 'portal-mojo/admin';

type Surface = 'conversations' | 'skills' | 'memory';
export function AdminAssistantDemo() {
    const [surface, setSurface] = useState<Surface>('conversations');
    return <div className="flex flex-col gap-3"><div className="panel panel-pad"><div className="eyebrow">Global Admin · REST only</div><h2 className="panel-title">Assistant control plane</h2><p className="dim">Imperative, component-local conversations with completed metadata-reference attachments, skills, and tiered memory. No websocket, polling, streaming, tool trace, auto-ingestion, or ambient group scope.</p><div className="seg">{(['conversations', 'skills', 'memory'] as Surface[]).map((key) => <button key={key} className={`seg-btn${surface === key ? ' seg-active' : ''}`} onClick={() => setSurface(key)}>{key}</button>)}</div></div>{surface === 'conversations' ? <ConversationsPage /> : surface === 'skills' ? <SkillsPage /> : <MemoriesPage />}</div>;
}
