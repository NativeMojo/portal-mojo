import { useEffect, useRef, useState } from 'react';
import { useCan, useMe } from '../../client';
import type { RightPanelRenderContext } from '../../ui';
import { AssistantFeed } from './AssistantFeed';
import { sendAssistantMessage } from './api';
import type { AssistantConversation, AssistantMessage } from './types';
import type { FileReference } from '../../client/record-feed';

export const ASSISTANT_PERMISSIONS = ['sys.view_admin', 'sys.assistant'];

export function AssistantPanel({ context, initialConversation = null }: { context: RightPanelRenderContext; initialConversation?: AssistantConversation | null }) {
    const { can } = useCan(ASSISTANT_PERMISSIONS);
    const { data: me } = useMe();
    const [conversation, setConversation] = useState(initialConversation);
    const [messages, setMessages] = useState<AssistantMessage[]>(initialConversation?.messages ?? []);
    const [responding, setResponding] = useState(false);
    const [error, setError] = useState('');
    const flight = useRef(false);
    useEffect(() => { if (!can) context.close(); }, [can, context]);
    useEffect(() => { setConversation(initialConversation); setMessages(initialConversation?.messages ?? []); setError(''); }, [initialConversation?.id]);
    if (!can || !me) return null;
    const owner = conversation == null || conversation.user.id === me.id;
    const send = async (text: string, attachments: readonly FileReference[] = []) => {
        if (flight.current || !owner) return;
        flight.current = true; setResponding(true); setError('');
        const temporary: AssistantMessage = { id: `local-${Date.now()}`, role: 'user', content: text, created: Math.floor(Date.now() / 1000), blocks: attachments.length ? [{ type: 'attachment', files: [...attachments] }] : [] };
        setMessages((current) => [...current, temporary]);
        try {
            const reply = await sendAssistantMessage(text, conversation?.id, attachments);
            const assistant: AssistantMessage = { id: `local-assistant-${Date.now()}`, role: 'assistant', content: reply.response, created: Math.floor(Date.now() / 1000), blocks: reply.blocks };
            setMessages((current) => [...current, assistant]);
            setConversation((current) => current ?? { id: reply.conversation_id, title: text.slice(0, 80), created: temporary.created, modified: assistant.created, user: { id: me.id, display_name: me.display_name ?? 'You' }, messages: [] });
        } catch (cause) {
            setMessages((current) => current.filter((message) => message.id !== temporary.id));
            const message = cause instanceof Error ? cause.message : 'Assistant request failed'; setError(message); throw cause;
        } finally { flight.current = false; setResponding(false); }
    };
    return <div className="assistant-panel"><div className="assistant-panel-meta"><span>{conversation ? conversation.title : 'New conversation'}</span>{conversation && !owner && <span className="chip chip-muted">Inspect only</span>}</div>{error && <div className="form-alert" role="alert">{error}</div>}<AssistantFeed messages={messages} user={{ id: me.id, display_name: me.display_name ?? 'You' }} onSend={send} responding={responding} disabled={!owner} attachmentKey={conversation?.id ?? 'new'} /></div>;
}
