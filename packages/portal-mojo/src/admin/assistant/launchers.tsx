import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useCan } from '../../client';
import { useRightPanel } from '../../ui';
import { SECURITY_VIEW_PERMS } from '../security-permissions';
import { AssistantPanel, ASSISTANT_PERMISSIONS } from './AssistantPanel';
import { createAssistantContext } from './api';

export function AssistantLauncher() {
    const { can } = useCan(ASSISTANT_PERMISSIONS);
    const panel = useRightPanel();
    useEffect(() => { if (!can && panel.descriptor?.key.startsWith('assistant:')) panel.close(); }, [can, panel]);
    if (!can) return null;
    return <button type="button" className="btn-icon" title="Open Assistant" aria-label="Open Assistant" aria-pressed={panel.descriptor?.key === 'assistant:new'} onClick={(event) => panel.open({ key: 'assistant:new', title: 'Assistant', render: (context) => <AssistantPanel context={context} /> }, event.currentTarget)}><i className="bi bi-stars" aria-hidden="true" /></button>;
}

export function AssistantContextLauncher({ model, pk, label = 'Ask Assistant' }: { model: 'incident.Incident' | 'incident.Ticket'; pk: number; label?: string }) {
    const assistant = useCan(ASSISTANT_PERMISSIONS);
    const security = useCan(SECURITY_VIEW_PERMS);
    const panel = useRightPanel();
    const generation = useRef(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => () => { generation.current += 1; }, []);
    useEffect(() => { generation.current += 1; setLoading(false); setError(''); }, [model, pk]);
    if (!assistant.can || !security.can) return null;
    const launch = async (event: MouseEvent<HTMLButtonElement>) => {
        const launcher = event.currentTarget; const run = ++generation.current; setLoading(true); setError('');
        try { const conversation = await createAssistantContext(model, pk); if (generation.current !== run) return; panel.open({ key: `assistant:context:${model}:${pk}:${conversation.id}`, title: `Assistant · ${model === 'incident.Incident' ? 'Incident' : 'Ticket'} #${pk}`, render: (context) => <AssistantPanel context={context} initialConversation={conversation} /> }, launcher); }
        catch (cause) { if (generation.current === run) setError(cause instanceof Error ? cause.message : 'Could not create context'); }
        finally { if (generation.current === run) setLoading(false); }
    };
    return <span className="assistant-context-launcher"><button type="button" className="btn btn-compact" disabled={loading} onClick={(event) => void launch(event)}><i className="bi bi-stars" aria-hidden="true" /> {loading ? 'Opening…' : label}</button>{error && <span className="text-bad" role="alert">{error}</span>}</span>;
}
