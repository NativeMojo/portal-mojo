import { useEffect, useRef, useState } from 'react';
import { useCan, useMe, useRealtime, useRealtimeStatus } from '../../client';
import type { RightPanelRenderContext } from '../../ui';
import { AssistantFeed } from './AssistantFeed';
import { sendAssistantMessage } from './api';
import type { AssistantConversation, AssistantMessage } from './types';
import type { FileReference } from '../../client/record-feed';
import { AssistantOutcomeUnknownError, chooseAssistantTransport, startAssistantRealtimeTurn, type AssistantRealtimeProgress, type AssistantRealtimeTurn } from './streaming';

export const ASSISTANT_PERMISSIONS = ['sys.view_admin', 'sys.assistant'];

export function AssistantPanel({ context, initialConversation = null }: { context: RightPanelRenderContext; initialConversation?: AssistantConversation | null }) {
    const { can } = useCan(ASSISTANT_PERMISSIONS);
    const { can: canViewAdmin } = useCan('sys.view_admin');
    const { data: me } = useMe();
    const realtime = useRealtime();
    const realtimeStatus = useRealtimeStatus();
    const [conversation, setConversation] = useState(initialConversation);
    const [messages, setMessages] = useState<AssistantMessage[]>(initialConversation?.messages ?? []);
    const [responding, setResponding] = useState(false);
    const [error, setError] = useState('');
    const [streamProgress, setStreamProgress] = useState<AssistantRealtimeProgress | null>(null);
    const [streamingActive, setStreamingActive] = useState(false);
    const flight = useRef(false);
    const stream = useRef<AssistantRealtimeTurn | null>(null);
    const seenMessageIds = useRef(new Set<number | string>());
    useEffect(() => { if (!can) { stream.current?.cancel(); stream.current = null; setStreamProgress(null); setStreamingActive(false); setMessages(conversation?.messages ?? []); context.close(); } }, [can, context, conversation]);
    useEffect(() => { if (!canViewAdmin && stream.current) { stream.current.cancel(); stream.current = null; setStreamProgress(null); setStreamingActive(false); setMessages(conversation?.messages ?? []); } }, [canViewAdmin, conversation]);
    useEffect(() => { setConversation(initialConversation); setMessages(initialConversation?.messages ?? []); seenMessageIds.current = new Set(initialConversation?.messages.map((message) => message.id) ?? []); setStreamProgress(null); setError(''); }, [initialConversation?.id]);
    useEffect(() => () => { stream.current?.cancel(); stream.current = null; }, []);
    if (!can || !me) return null;
    const owner = conversation == null || conversation.user.id === me.id;
    const send = async (text: string, attachments: readonly FileReference[] = []) => {
        if (flight.current || !owner) return;
        flight.current = true; setResponding(true); setError('');
        const temporary: AssistantMessage = { id: `local-${Date.now()}`, role: 'user', content: text, created: Math.floor(Date.now() / 1000), blocks: attachments.length ? [{ type: 'attachment', files: [...attachments] }] : [] };
        setMessages((current) => [...current, temporary]);
        try {
            const transport = chooseAssistantTransport({ owner, textOnly: attachments.length === 0, hasViewAdmin: canViewAdmin, realtimeStatus: realtimeStatus.status });
            if (transport === 'websocket') {
                setStreamingActive(true);
                const turn = startAssistantRealtimeTurn(realtime, { message: text, conversationId: conversation?.id, seenMessageIds: seenMessageIds.current }, {
                    onConversation: (id) => setConversation((current) => current ?? { id, title: text.slice(0, 80), created: temporary.created, modified: temporary.created, user: { id: me.id, display_name: me.display_name ?? 'You' }, messages: [] }),
                    onText: (message) => setMessages((current) => [...current, message]),
                    onProgress: setStreamProgress,
                    onResponse: (message) => setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]),
                    onReconcile: (next) => { setConversation(next); setMessages(next.messages); },
                    onUnknown: () => { window.dispatchEvent(new CustomEvent('portal-mojo:assistant-list-refresh')); },
                });
                stream.current = turn;
                await turn.promise;
                stream.current = null;
            } else {
                const reply = await sendAssistantMessage(text, conversation?.id, attachments);
                const assistant: AssistantMessage = { id: `local-assistant-${Date.now()}`, role: 'assistant', content: reply.response, created: Math.floor(Date.now() / 1000), blocks: reply.blocks };
                setMessages((current) => [...current, assistant]);
                setConversation((current) => current ?? { id: reply.conversation_id, title: text.slice(0, 80), created: temporary.created, modified: assistant.created, user: { id: me.id, display_name: me.display_name ?? 'You' }, messages: [] });
            }
        } catch (cause) {
            if (!(cause instanceof AssistantOutcomeUnknownError)) setMessages((current) => current.filter((message) => message.id !== temporary.id));
            const message = cause instanceof Error ? cause.message : 'Assistant request failed'; setError(message); throw cause;
        } finally { stream.current = null; setStreamProgress(null); setStreamingActive(false); flight.current = false; setResponding(false); }
    };
    return <div className="assistant-panel"><div className="assistant-panel-meta"><span>{conversation ? conversation.title : 'New conversation'}</span>{conversation && !owner && <span className="chip chip-muted">Inspect only</span>}{responding && <span>{streamingActive ? streamProgress?.tools.length ? `${streamProgress.tools.reduce((sum, tool) => sum + tool.count, 0)} tool call${streamProgress.tools.reduce((sum, tool) => sum + tool.count, 0) === 1 ? '' : 's'}` : realtimeStatus.status === 'ready' ? 'Streaming…' : 'Reconciling…' : 'Responding…'}</span>}</div>{streamProgress?.tools.length ? <div className="assistant-stream-tools" aria-label="Assistant tool progress">{streamProgress.tools.map((tool) => <span className="chip chip-muted" key={tool.name}>{tool.name} · {tool.status}{tool.count > 1 ? ` ×${tool.count}` : ''}</span>)}</div> : null}{error && <div className="form-alert" role="alert">{error}</div>}<AssistantFeed messages={messages} user={{ id: me.id, display_name: me.display_name ?? 'You' }} onSend={send} responding={responding} disabled={!owner} attachmentKey={conversation?.id ?? 'new'} /></div>;
}
