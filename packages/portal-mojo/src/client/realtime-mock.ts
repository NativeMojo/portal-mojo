import type { RealtimeSocket, RealtimeSocketFactory } from './realtime';

export type RealtimeMockAuthMode = 'success' | 'fail-open';

export interface RealtimeMockOptions {
    autoOpen?: boolean;
    autoAuthRequired?: boolean;
    autoPong?: boolean;
    authMode?: RealtimeMockAuthMode;
    deniedTopics?: readonly string[];
    userId?: number;
}

export interface RealtimeMockObservation {
    connection: number;
    kind: 'authenticate' | 'topic' | 'ping' | 'assistant';
    action?: string;
    topic?: string;
    hasToken?: boolean;
    conversationId?: number | null;
    messageLength?: number;
}

class MemoryRealtimeSocket implements RealtimeSocket {
    readyState = 0;
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onclose: ((event: { code: number; reason?: string; wasClean?: boolean }) => void) | null = null;
    readonly topics = new Set<string>();
    authenticated = false;
    closed = false;

    constructor(readonly id: number, private readonly server: RealtimeMockServer) {}

    send(data: string): void {
        if (this.readyState !== 1) throw new Error('Mock socket is not open');
        this.server.receive(this, data);
    }

    close(code = 1000, reason = ''): void {
        this.server.close(this, code, reason, true);
    }

    open(): void {
        if (this.closed || this.readyState !== 0) return;
        this.readyState = 1;
        this.onopen?.({});
    }

    frame(value: Record<string, unknown>): void {
        if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(value) });
    }
}

export class RealtimeMockServer {
    readonly sockets: MemoryRealtimeSocket[] = [];
    readonly observations: RealtimeMockObservation[] = [];
    readonly factory: RealtimeSocketFactory;
    autoPong: boolean;
    authMode: RealtimeMockAuthMode;
    readonly deniedTopics: Set<string>;
    private nextConversationId = 9000;
    private nextMessageId = 9500;
    private timestamp = 1_800_000_000;
    private readonly autoOpen: boolean;
    private readonly autoAuthRequired: boolean;
    private readonly userId: number;

    constructor(options: RealtimeMockOptions = {}) {
        this.autoOpen = options.autoOpen !== false;
        this.autoAuthRequired = options.autoAuthRequired !== false;
        this.autoPong = options.autoPong !== false;
        this.authMode = options.authMode ?? 'success';
        this.deniedTopics = new Set(options.deniedTopics ?? []);
        this.userId = options.userId ?? 14;
        this.factory = (_url) => {
            const socket = new MemoryRealtimeSocket(this.sockets.length + 1, this);
            this.sockets.push(socket);
            if (this.autoOpen) queueMicrotask(() => {
                socket.open();
                if (this.autoAuthRequired) socket.frame({ type: 'auth_required', timeout: 10 });
            });
            return socket;
        };
    }

    get activeConnections(): number {
        return this.sockets.filter((socket) => socket.readyState === 1).length;
    }

    open(connection?: number): void {
        for (const socket of this.select(connection)) socket.open();
    }

    authRequired(connection?: number): void {
        for (const socket of this.select(connection)) socket.frame({ type: 'auth_required', timeout: 10 });
    }

    authSuccess(connection?: number): void {
        for (const socket of this.select(connection)) {
            socket.authenticated = true;
            socket.frame({ type: 'auth_success', user_type: 'user', user_id: this.userId });
        }
    }

    authFailureLeftOpen(connection?: number): void {
        for (const socket of this.select(connection)) socket.frame({ type: 'error', message: 'Authentication failed' });
    }

    preacceptRateLimit(connection?: number): void {
        for (const socket of this.select(connection)) this.close(socket, 4429, '', false);
    }

    wrapped(data: Record<string, unknown>, topic?: string, connection?: number): void {
        for (const socket of this.select(connection)) socket.frame({
            type: 'message', data, timestamp: ++this.timestamp, ...(topic ? { topic } : {}),
        });
    }

    direct(data: Record<string, unknown>, connection?: number): void {
        for (const socket of this.select(connection)) socket.frame(data);
    }

    pong(connection?: number): void {
        for (const socket of this.select(connection)) socket.frame({ type: 'pong', user_type: 'user', user_id: this.userId });
    }

    forceDisconnect(connection?: number): void {
        this.wrapped({ type: 'disconnect', reason: 'forced_disconnect' }, undefined, connection);
    }

    finishAssistant(conversationId: number, response = 'The deterministic realtime response is ready.', connection?: number): void {
        this.direct({
            type: 'assistant_response', conversation_id: conversationId,
            message_id: ++this.nextMessageId, created: new Date(this.timestamp * 1000).toISOString(),
            response, blocks: null, tool_calls_made: [{ tool: 'mock_private_tool', input: { withheld: true } }],
            duration_ms: 250,
        }, connection);
    }

    failAssistant(conversationId: number, connection?: number): void {
        this.direct({ type: 'assistant_error', conversation_id: conversationId, error: 'Deterministic Assistant failure' }, connection);
    }

    clearObservations(): void {
        this.observations.length = 0;
    }

    receive(socket: MemoryRealtimeSocket, raw: string): void {
        let message: Record<string, unknown>;
        try {
            const value = JSON.parse(raw) as unknown;
            if (value == null || typeof value !== 'object' || Array.isArray(value)) return;
            message = value as Record<string, unknown>;
        } catch { return; }
        const type = typeof message.type === 'string' ? message.type : typeof message.action === 'string' ? message.action : '';
        if (type === 'authenticate') {
            this.observations.push({ connection: socket.id, kind: 'authenticate', hasToken: typeof message.token === 'string' && message.token.length > 0 });
            if (this.authMode === 'success') this.authSuccess(socket.id);
            else this.authFailureLeftOpen(socket.id);
            return;
        }
        if (type === 'ping') {
            this.observations.push({ connection: socket.id, kind: 'ping' });
            if (this.autoPong) this.pong(socket.id);
            return;
        }
        if (type === 'subscribe' || type === 'unsubscribe') {
            const topic = typeof message.topic === 'string' ? message.topic : '';
            this.observations.push({ connection: socket.id, kind: 'topic', action: type, topic });
            if (type === 'subscribe' && this.deniedTopics.has(topic)) {
                socket.frame({ type: 'error', message: `Access denied to topic: ${topic}` });
            } else {
                if (type === 'subscribe') socket.topics.add(topic); else socket.topics.delete(topic);
                socket.frame({ type: type === 'subscribe' ? 'subscribed' : 'unsubscribed', topic });
            }
            return;
        }
        if (type === 'assistant_message' || type === 'assistant_action') {
            const conversationId = typeof message.conversation_id === 'number' ? message.conversation_id : ++this.nextConversationId;
            const text = type === 'assistant_action' ? message.value : message.message;
            this.observations.push({
                connection: socket.id, kind: 'assistant', action: type,
                conversationId: typeof message.conversation_id === 'number' ? message.conversation_id : null,
                messageLength: typeof text === 'string' ? text.length : 0,
            });
            socket.frame({ type: 'assistant_thinking', conversation_id: conversationId });
            queueMicrotask(() => this.finishAssistant(conversationId, undefined, socket.id));
        }
    }

    close(socket: MemoryRealtimeSocket, code: number, reason: string, wasClean: boolean): void {
        if (socket.closed) return;
        socket.closed = true;
        socket.readyState = 3;
        socket.onclose?.({ code, reason, wasClean });
    }

    private select(connection?: number): MemoryRealtimeSocket[] {
        return connection == null ? this.sockets.filter((socket) => !socket.closed) : this.sockets.filter((socket) => socket.id === connection && !socket.closed);
    }
}

export function createRealtimeMock(options: RealtimeMockOptions = {}): RealtimeMockServer {
    return new RealtimeMockServer(options);
}
