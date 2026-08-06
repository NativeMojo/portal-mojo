import { useMemo, useRef, useState } from 'react';
import {
    createIncidentHistoryAdapter,
    createTicketNoteAdapter,
    normalizeRecordFeedItem,
    type RecordFeedItem,
} from 'portal-mojo/client';
import { RecordFeed } from 'portal-mojo/ui';

const NOW = Math.floor(Date.now() / 1000);

const CONTROLLED_SEED: RecordFeedItem[] = [
    normalizeRecordFeedItem({
        id: 'status-1', created: NOW - 900, user: { id: 7, display_name: 'Jordan Lee' },
        note: 'Status changed from open to investigating.',
        metadata: { type: 'status_change', old_status: 'open', new_status: 'investigating' },
    }),
    // Canonical LLM wins even though the modern row carries a user relation.
    normalizeRecordFeedItem({
        id: 'agent-1', created: NOW - 600, user: { id: 19, display_name: 'Automation service' },
        note: '[LLM Agent] Correlated the failure window with **five** webhook retries.',
        metadata: { action: { handler: 'llm' } },
    }),
    // A null user alone remains System; prose is never guessed into a status.
    normalizeRecordFeedItem({
        id: 'system-1', created: NOW - 360, user: null, kind: 'threshold_reached',
        note: 'The alert crossed its configured threshold.', metadata: {},
    }),
    normalizeRecordFeedItem({
        id: 'human-1', created: NOW - 120,
        user: { id: 1, display_name: 'Ian', avatar: null },
        note: 'Receiver recovered. Keeping this open through the next deploy.', metadata: {},
    }),
];

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function RecordFeedDemo() {
    const [variant, setVariant] = useState<'compact' | 'bubbles'>('compact');
    const [adapterType, setAdapterType] = useState<'ticket' | 'incident'>('ticket');
    const [controlled, setControlled] = useState<readonly RecordFeedItem[]>(CONTROLLED_SEED);
    const [thinking, setThinking] = useState(false);
    const nextId = useRef(10);
    const ticket = useMemo(() => createTicketNoteAdapter(501, { groupId: 1 }), []);
    const incident = useMemo(() => createIncidentHistoryAdapter(601, { groupId: 1 }), []);
    const adapter = adapterType === 'ticket' ? ticket : incident;

    const controlledSend = async (text: string) => {
        const humanId = `controlled-${nextId.current++}`;
        setControlled((items) => [...items, normalizeRecordFeedItem({
            id: humanId,
            created: Math.floor(Date.now() / 1000),
            user: { id: 1, display_name: 'Ian' },
            note: text,
            metadata: {},
        })]);
        setThinking(true);
        await wait(650);
        setControlled((items) => [...items, normalizeRecordFeedItem({
            id: `controlled-${nextId.current++}`,
            created: Math.floor(Date.now() / 1000),
            user: { id: 19, display_name: 'Automation service' },
            kind: 'handler:llm',
            note: `[LLM Agent] Acknowledged: ${text}`,
            metadata: {},
        })]);
        setThinking(false);
    };

    return (
        <div style={{ display: 'grid', gap: 16 }}>
            <div className="panel panel-pad">
                <div className="demo-row" style={{ marginBottom: 10 }}>
                    <div className="seg" aria-label="Feed layout">
                        {(['compact', 'bubbles'] as const).map((value) => (
                            <button
                                key={value}
                                className={`seg-btn${variant === value ? ' seg-active' : ''}`}
                                onClick={() => setVariant(value)}
                            >
                                {value}
                            </button>
                        ))}
                    </div>
                    <div className="seg" aria-label="Adapter type">
                        {(['ticket', 'incident'] as const).map((value) => (
                            <button
                                key={value}
                                className={`seg-btn${adapterType === value ? ' seg-active' : ''}`}
                                onClick={() => setAdapterType(value)}
                            >
                                {value}
                            </button>
                        ))}
                    </div>
                    <span className="dim">
                        Real adapter · parent <code>{adapter.parentId}</code> · group <code>{adapter.groupId}</code>
                    </span>
                </div>
                <p className="dim" style={{ margin: '0 0 12px' }}>
                    This is the actual Query-backed adapter: newest 100 from <code>graph=default</code>, reversed into
                    chronological order. Send a note to see optimistic append → server replacement. The mock stamps the
                    signed-in user and rejects unknown parents exactly like django-mojo.
                </p>
                <RecordFeed
                    key={adapterType}
                    adapter={adapter}
                    variant={variant}
                    currentUser={{ id: 1, name: 'Ian' }}
                    currentUserId={1}
                    ariaLabel={`${adapterType} adapter feed`}
                    renderAddon={(item) => item.kind === 'assistant' ? <span className="chip chip-info">assistant-normalized</span> : null}
                />
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">Controlled mode · streaming owner</div>
                <p className="dim" style={{ margin: '4px 0 12px' }}>
                    The parent owns <code>items</code> and <code>onSend</code>. This demo appends your message, exposes the
                    pending slot, then adds an assistant row. It also proves structured status, LLM-with-user precedence,
                    null-user System behavior, and client-only MarkdownView rendering without attachment UI.
                </p>
                <RecordFeed
                    items={controlled}
                    onSend={controlledSend}
                    variant={variant}
                    currentUserId={1}
                    pending={thinking ? <><i className="bi bi-stars" /> AI Agent is investigating…</> : null}
                    ariaLabel="Controlled streaming feed"
                />
            </div>
        </div>
    );
}
