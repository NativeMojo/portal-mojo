import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useCan } from '../../client/runtime';
import { useRightPanel } from '../../ui/RightPanel';
import { SECURITY_VIEW_PERMS } from '../security-permissions';
import { ASSISTANT_PERMISSIONS } from './permissions';
import { createAssistantContext } from './api';

export { AssistantLauncher } from './AssistantLauncher';

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
        try { const [conversation, { AssistantPanel }] = await Promise.all([createAssistantContext(model, pk), import('./AssistantPanel')]); if (generation.current !== run) return; panel.open({ key: `assistant:context:${model}:${pk}:${conversation.id}`, title: `Assistant · ${model === 'incident.Incident' ? 'Incident' : 'Ticket'} #${pk}`, render: (context) => <AssistantPanel context={context} initialConversation={conversation} /> }, launcher); }
        catch (cause) { if (generation.current === run) setError(cause instanceof Error ? cause.message : 'Could not create context'); }
        finally { if (generation.current === run) setLoading(false); }
    };
    return <span className="assistant-context-launcher"><button type="button" className="btn btn-compact" disabled={loading} onClick={(event) => void launch(event)}><i className="bi bi-stars" aria-hidden="true" /> {loading ? 'Opening…' : label}</button>{error && <span className="text-bad" role="alert">{error}</span>}</span>;
}
