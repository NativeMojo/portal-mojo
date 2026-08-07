import {
    createContext, createElement, useCallback, useContext, useEffect, useMemo,
    useSyncExternalStore, type PropsWithChildren,
} from 'react';
import { apiOrigin } from './client';
import { getAccessToken, subscribeAuth } from './auth';

export type RealtimeLifecycleStatus =
    | 'disabled' | 'idle' | 'connecting' | 'authenticating' | 'ready'
    | 'backoff' | 'auth-failed' | 'forced-disconnect';
export type RealtimeTopicStatus =
    | 'idle' | 'subscribing' | 'subscribed' | 'unsubscribing' | 'denied';

export interface RealtimeStatusSnapshot {
    status: RealtimeLifecycleStatus;
    generation: number;
    reconnectAttempt: number;
    retryAt: number | null;
    automaticUserTopic: string | null;
}

export interface RealtimeEvent<T = unknown> {
    type: string;
    data: T;
    topic?: string;
    timestamp?: number;
}

export interface RealtimeEventDefinition<T> {
    readonly type: string;
    readonly project: (value: unknown) => T | null;
}

export function defineRealtimeEvent<T>(type: string, project: (value: unknown) => T | null): RealtimeEventDefinition<T> {
    if (!type || typeof type !== 'string') throw new Error('Realtime event type is required');
    return Object.freeze({ type, project });
}

export interface RealtimeSocket {
    readonly readyState: number;
    onopen: ((event: unknown) => void) | null;
    onmessage: ((event: { data: unknown }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onclose: ((event: { code: number; reason?: string; wasClean?: boolean }) => void) | null;
    send(data: string): void;
    close(code?: number, reason?: string): void;
}

export type RealtimeSocketFactory = (url: string) => RealtimeSocket;

export interface RealtimeClock {
    now(): number;
    random(): number;
    setTimeout(callback: () => void, delay: number): unknown;
    clearTimeout(handle: unknown): void;
}

const browserClock: RealtimeClock = {
    now: () => Date.now(),
    random: () => Math.random(),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
};

const defaultSocketFactory: RealtimeSocketFactory = (url) => new WebSocket(url) as unknown as RealtimeSocket;

interface TopicEntry {
    refs: number;
    status: RealtimeTopicStatus;
}

interface TopicOperation {
    topic: string;
    action: 'subscribe' | 'unsubscribe';
    generation: number;
    timeout: unknown | null;
}

export interface RealtimeClientOptions {
    origin?: string;
    socketFactory?: RealtimeSocketFactory;
    clock?: RealtimeClock;
    topicTimeoutMs?: number;
}

function deriveRealtimeUrl(origin: string): string {
    const base = origin || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const url = new URL(base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws/realtime/';
    url.search = '';
    url.hash = '';
    return url.toString();
}

function object(value: unknown): Record<string, unknown> | null {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

export class RealtimeClient {
    readonly url: string;
    private readonly socketFactory: RealtimeSocketFactory;
    private readonly clock: RealtimeClock;
    private readonly topicTimeoutMs: number;
    private socket: RealtimeSocket | null = null;
    private token: string | null = null;
    private enabled = false;
    private generation = 0;
    private reconnectAttempt = 0;
    private retryTimer: unknown | null = null;
    private retryAt: number | null = null;
    private extendedBackoffUntil = 0;
    private heartbeatTimer: unknown | null = null;
    private pongTimer: unknown | null = null;
    private suspended: 'auth-failed' | 'forced-disconnect' | null = null;
    private lifecycle: RealtimeLifecycleStatus = 'disabled';
    private automaticUserTopic: string | null = null;
    private statusSnapshot: RealtimeStatusSnapshot = {
        status: 'disabled', generation: 0, reconnectAttempt: 0,
        retryAt: null, automaticUserTopic: null,
    };
    private readonly topics = new Map<string, TopicEntry>();
    private readonly topicQueue: Array<{ topic: string; action: 'subscribe' | 'unsubscribe' }> = [];
    private topicOperation: TopicOperation | null = null;
    private readonly statusListeners = new Set<() => void>();
    private readonly topicListeners = new Map<string, Set<() => void>>();
    private readonly eventListeners = new Map<string, Set<(event: RealtimeEvent) => void>>();

    constructor(options: RealtimeClientOptions = {}) {
        this.url = deriveRealtimeUrl(options.origin ?? apiOrigin());
        this.socketFactory = options.socketFactory ?? defaultSocketFactory;
        this.clock = options.clock ?? browserClock;
        this.topicTimeoutMs = options.topicTimeoutMs ?? 10_000;
    }

    getStatus = (): RealtimeStatusSnapshot => this.statusSnapshot;

    subscribeStatus = (listener: () => void): (() => void) => {
        this.statusListeners.add(listener);
        return () => this.statusListeners.delete(listener);
    };

    setEnabled(enabled: boolean): void {
        if (this.enabled === enabled) return;
        this.enabled = enabled;
        if (!enabled) this.stop('disabled');
        else if (this.token) this.open();
        else this.setLifecycle('idle');
    }

    /** The only token comparison boundary. Equal token notifications are no-ops. */
    setToken(token: string | null): void {
        if (this.token === token) return;
        this.token = token;
        this.suspended = null;
        this.stop(this.enabled && token ? 'idle' : this.enabled ? 'idle' : 'disabled');
        if (this.enabled && token) this.open();
    }

    connect(token: string): void {
        this.setToken(token);
        this.setEnabled(true);
    }

    disconnect(): void {
        this.enabled = false;
        this.stop('disabled');
    }

    destroy(): void {
        this.disconnect();
        this.statusListeners.clear();
        this.topicListeners.clear();
        this.eventListeners.clear();
    }

    send(data: Record<string, unknown>): void {
        if (this.lifecycle !== 'ready' || !this.socket) throw new Error('Realtime transport is not ready');
        this.socket.send(JSON.stringify(data));
    }

    retainTopic(topic: string): () => void {
        if (!topic || typeof topic !== 'string') throw new Error('Realtime topic is required');
        const entry = this.topics.get(topic) ?? { refs: 0, status: 'idle' as const };
        entry.refs += 1;
        this.topics.set(topic, entry);
        if (entry.refs === 1 && this.lifecycle === 'ready') this.enqueueTopic(topic, 'subscribe');
        this.emitTopic(topic);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const current = this.topics.get(topic);
            if (!current) return;
            current.refs = Math.max(0, current.refs - 1);
            if (current.refs === 0) {
                if (current.status === 'subscribed' && this.lifecycle === 'ready') this.enqueueTopic(topic, 'unsubscribe');
                else if (current.status !== 'subscribing') this.topics.delete(topic);
            }
            this.emitTopic(topic);
        };
    }

    topicStatus(topic: string): RealtimeTopicStatus {
        return this.topics.get(topic)?.status ?? 'idle';
    }

    subscribeTopicStatus(topic: string, listener: () => void): () => void {
        let listeners = this.topicListeners.get(topic);
        if (!listeners) this.topicListeners.set(topic, (listeners = new Set()));
        listeners.add(listener);
        return () => {
            listeners?.delete(listener);
            if (listeners?.size === 0) this.topicListeners.delete(topic);
        };
    }

    on<T>(definition: RealtimeEventDefinition<T>, listener: (event: RealtimeEvent<T>) => void): () => void {
        const wrapped = (event: RealtimeEvent) => {
            const projected = definition.project(event.data);
            if (projected != null) listener({ ...event, data: projected });
        };
        let listeners = this.eventListeners.get(definition.type);
        if (!listeners) this.eventListeners.set(definition.type, (listeners = new Set()));
        listeners.add(wrapped);
        return () => {
            listeners?.delete(wrapped);
            if (listeners?.size === 0) this.eventListeners.delete(definition.type);
        };
    }

    nudge(): void {
        if (!this.enabled || !this.token || this.suspended || this.socket || this.retryTimer == null) return;
        if (this.clock.now() < this.extendedBackoffUntil) return;
        this.clearRetry();
        this.open();
    }

    private open(): void {
        if (!this.enabled || !this.token || this.suspended || this.socket) return;
        const run = this.generation;
        this.setLifecycle('connecting');
        let socket: RealtimeSocket;
        try {
            socket = this.socketFactory(this.url);
        } catch {
            this.scheduleReconnect(run, 0);
            return;
        }
        this.socket = socket;
        socket.onopen = () => {
            if (!this.isCurrent(run, socket)) return;
            this.setLifecycle('authenticating');
        };
        socket.onmessage = (event) => {
            if (!this.isCurrent(run, socket)) return;
            this.handleFrame(event.data, run, socket);
        };
        socket.onerror = () => { /* close is the single retry path */ };
        socket.onclose = (event) => {
            if (!this.isCurrent(run, socket)) return;
            this.socket = null;
            this.clearHeartbeat();
            this.resetTopicConnectionState();
            if (event.code === 4429) this.extendedBackoffUntil = this.clock.now() + 60_000;
            if (this.enabled && this.token && !this.suspended) this.scheduleReconnect(run, event.code);
        };
    }

    private handleFrame(raw: unknown, run: number, socket: RealtimeSocket): void {
        if (typeof raw !== 'string') return;
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { return; }
        const frame = object(parsed);
        if (!frame || typeof frame.type !== 'string') return;

        if (frame.type === 'auth_required') {
            if (this.lifecycle !== 'authenticating' || !this.token) return;
            socket.send(JSON.stringify({ type: 'authenticate', token: this.token, prefix: 'bearer' }));
            return;
        }
        if (frame.type === 'auth_success') {
            if (this.lifecycle !== 'authenticating') return;
            this.reconnectAttempt = 0;
            this.extendedBackoffUntil = 0;
            this.automaticUserTopic = (typeof frame.user_type === 'string' && (typeof frame.user_id === 'number' || typeof frame.user_id === 'string'))
                ? `${frame.user_type}:${frame.user_id}` : null;
            this.setLifecycle('ready');
            this.startHeartbeat(run, socket);
            this.replayTopics();
            return;
        }
        if (frame.type === 'pong') {
            if (this.lifecycle === 'ready') this.clearPong();
            return;
        }
        if (frame.type === 'subscribed' || frame.type === 'unsubscribed') {
            if (typeof frame.topic === 'string') this.completeTopic(frame.type, frame.topic);
            return;
        }
        if (frame.type === 'error') {
            if (this.lifecycle === 'authenticating') {
                this.suspend('auth-failed', 4003, 'Authentication failed');
            } else if (this.topicOperation) {
                this.denyCurrentTopic();
            }
            return;
        }

        if (frame.type === 'message') {
            const data = object(frame.data);
            if (!data || typeof data.type !== 'string') return;
            if (this.isTrustedForcedDisconnect(frame, data)) {
                this.suspend('forced-disconnect', 4003, 'Forced disconnect');
                return;
            }
            this.dispatch(data.type, data, typeof frame.topic === 'string' ? frame.topic : undefined,
                typeof frame.timestamp === 'number' && Number.isFinite(frame.timestamp) ? frame.timestamp : undefined);
            return;
        }

        // Direct application frame. Framework frames above never leak here.
        this.dispatch(frame.type, frame);
    }

    private isTrustedForcedDisconnect(wrapper: Record<string, unknown>, data: Record<string, unknown>): boolean {
        return wrapper.type === 'message'
            && wrapper.topic === undefined
            && typeof wrapper.timestamp === 'number' && Number.isFinite(wrapper.timestamp)
            && Object.keys(data).length === 2
            && data.type === 'disconnect' && data.reason === 'forced_disconnect';
    }

    private dispatch(type: string, data: Record<string, unknown>, topic?: string, timestamp?: number): void {
        const event: RealtimeEvent = { type, data, ...(topic ? { topic } : {}), ...(timestamp != null ? { timestamp } : {}) };
        this.eventListeners.get(type)?.forEach((listener) => listener(event));
    }

    private enqueueTopic(topic: string, action: 'subscribe' | 'unsubscribe'): void {
        if (this.topicQueue.some((op) => op.topic === topic && op.action === action)
            || (this.topicOperation?.topic === topic && this.topicOperation.action === action)) return;
        this.topicQueue.push({ topic, action });
        this.pumpTopicQueue();
    }

    private pumpTopicQueue(): void {
        if (this.topicOperation || this.lifecycle !== 'ready' || !this.socket) return;
        const next = this.topicQueue.shift();
        if (!next) return;
        const entry = this.topics.get(next.topic);
        if (!entry || (next.action === 'subscribe' && entry.refs === 0)) {
            this.pumpTopicQueue();
            return;
        }
        entry.status = next.action === 'subscribe' ? 'subscribing' : 'unsubscribing';
        this.emitTopic(next.topic);
        const operation: TopicOperation = { ...next, generation: this.generation, timeout: null };
        this.topicOperation = operation;
        this.socket.send(JSON.stringify({ type: next.action, topic: next.topic }));
        operation.timeout = this.clock.setTimeout(() => {
            if (this.topicOperation !== operation) return;
            if (entry) entry.status = next.action === 'subscribe' ? 'denied' : 'subscribed';
            this.topicOperation = null;
            this.emitTopic(next.topic);
            this.pumpTopicQueue();
        }, this.topicTimeoutMs);
    }

    private completeTopic(type: 'subscribed' | 'unsubscribed', topic: string): void {
        const operation = this.topicOperation;
        if (!operation || operation.topic !== topic || operation.action !== (type === 'subscribed' ? 'subscribe' : 'unsubscribe')) return;
        if (operation.timeout != null) this.clock.clearTimeout(operation.timeout);
        const entry = this.topics.get(topic);
        if (entry) {
            entry.status = type === 'subscribed' ? 'subscribed' : 'idle';
            if (entry.refs === 0 && type === 'unsubscribed') this.topics.delete(topic);
        }
        this.topicOperation = null;
        this.emitTopic(topic);
        if (entry?.refs === 0 && type === 'subscribed') this.enqueueTopic(topic, 'unsubscribe');
        this.pumpTopicQueue();
    }

    private denyCurrentTopic(): void {
        const operation = this.topicOperation;
        if (!operation) return;
        if (operation.timeout != null) this.clock.clearTimeout(operation.timeout);
        const entry = this.topics.get(operation.topic);
        if (entry) entry.status = operation.action === 'subscribe' ? 'denied' : 'subscribed';
        this.topicOperation = null;
        this.emitTopic(operation.topic);
        this.pumpTopicQueue();
    }

    private replayTopics(): void {
        for (const [topic, entry] of this.topics) {
            if (entry.refs > 0) {
                entry.status = 'idle';
                this.enqueueTopic(topic, 'subscribe');
            }
        }
    }

    private resetTopicConnectionState(): void {
        if (this.topicOperation?.timeout != null) this.clock.clearTimeout(this.topicOperation.timeout);
        this.topicOperation = null;
        this.topicQueue.length = 0;
        for (const [topic, entry] of this.topics) {
            if (entry.refs > 0) entry.status = 'idle';
            else this.topics.delete(topic);
            this.emitTopic(topic);
        }
    }

    private startHeartbeat(run: number, socket: RealtimeSocket): void {
        this.clearHeartbeat();
        const ping = () => {
            if (!this.isCurrent(run, socket) || this.lifecycle !== 'ready') return;
            socket.send(JSON.stringify({ type: 'ping' }));
            this.clearPong();
            this.pongTimer = this.clock.setTimeout(() => {
                if (this.isCurrent(run, socket)) socket.close(4001, 'Pong timeout');
            }, 10_000);
            this.heartbeatTimer = this.clock.setTimeout(ping, 20_000);
        };
        this.heartbeatTimer = this.clock.setTimeout(ping, 20_000);
    }

    private scheduleReconnect(run: number, closeCode: number): void {
        if (run !== this.generation || this.retryTimer != null || this.suspended) return;
        this.reconnectAttempt += 1;
        const normal = Math.min(2_000 * Math.pow(1.5, this.reconnectAttempt - 1), 30_000);
        const jittered = Math.round(normal * (0.8 + this.clock.random() * 0.4));
        const extended = closeCode === 4429 ? Math.max(jittered, 60_000) : jittered;
        const delay = Math.max(extended, this.extendedBackoffUntil - this.clock.now());
        this.retryAt = this.clock.now() + delay;
        this.setLifecycle('backoff');
        this.retryTimer = this.clock.setTimeout(() => {
            this.retryTimer = null;
            this.retryAt = null;
            if (run === this.generation) this.open();
        }, delay);
    }

    private suspend(reason: 'auth-failed' | 'forced-disconnect', code: number, message: string): void {
        this.suspended = reason;
        this.setLifecycle(reason);
        const socket = this.socket;
        this.socket = null;
        this.clearHeartbeat();
        this.resetTopicConnectionState();
        if (socket) socket.close(code, message);
    }

    private stop(status: RealtimeLifecycleStatus): void {
        this.generation += 1;
        this.clearRetry();
        this.clearHeartbeat();
        this.resetTopicConnectionState();
        this.automaticUserTopic = null;
        const socket = this.socket;
        this.socket = null;
        if (socket) socket.close(1000, 'Client disconnect');
        this.setLifecycle(status);
    }

    private clearRetry(): void {
        if (this.retryTimer != null) this.clock.clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.retryAt = null;
    }

    private clearPong(): void {
        if (this.pongTimer != null) this.clock.clearTimeout(this.pongTimer);
        this.pongTimer = null;
    }

    private clearHeartbeat(): void {
        if (this.heartbeatTimer != null) this.clock.clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = null;
        this.clearPong();
    }

    private isCurrent(run: number, socket: RealtimeSocket): boolean {
        return run === this.generation && socket === this.socket;
    }

    private setLifecycle(status: RealtimeLifecycleStatus): void {
        this.lifecycle = status;
        this.statusSnapshot = {
            status,
            generation: this.generation,
            reconnectAttempt: this.reconnectAttempt,
            retryAt: this.retryAt,
            automaticUserTopic: this.automaticUserTopic,
        };
        this.statusListeners.forEach((listener) => listener());
    }

    private emitTopic(topic: string): void {
        this.topicListeners.get(topic)?.forEach((listener) => listener());
    }
}

const RealtimeContext = createContext<RealtimeClient | null>(null);

export interface RealtimeProviderProps extends PropsWithChildren {
    enabled?: boolean;
    client?: RealtimeClient;
    socketFactory?: RealtimeSocketFactory;
    origin?: string;
}

export function RealtimeProvider({ children, enabled = true, client, socketFactory, origin }: RealtimeProviderProps) {
    const owned = useMemo(() => client ?? new RealtimeClient({ socketFactory, origin }), [client, socketFactory, origin]);
    const token = useSyncExternalStore(subscribeAuth, getAccessToken, getAccessToken);
    useEffect(() => { owned.setToken(token); }, [owned, token]);
    useEffect(() => {
        owned.setEnabled(enabled);
        return () => owned.setEnabled(false);
    }, [owned, enabled]);
    useEffect(() => () => { if (!client) owned.destroy(); }, [client, owned]);
    useEffect(() => {
        const nudge = () => owned.nudge();
        const visibility = () => { if (!document.hidden) owned.nudge(); };
        window.addEventListener('focus', nudge);
        document.addEventListener('visibilitychange', visibility);
        return () => {
            window.removeEventListener('focus', nudge);
            document.removeEventListener('visibilitychange', visibility);
        };
    }, [owned]);
    return createElement(RealtimeContext.Provider, { value: owned }, children);
}

export function useRealtime(): RealtimeClient {
    const client = useContext(RealtimeContext);
    if (!client) throw new Error('useRealtime must be used inside RealtimeProvider');
    return client;
}

export function useRealtimeStatus(): RealtimeStatusSnapshot {
    const client = useRealtime();
    return useSyncExternalStore(client.subscribeStatus, client.getStatus, client.getStatus);
}

export function useRealtimeTopic(topic: string | null | undefined): RealtimeTopicStatus {
    const client = useRealtime();
    useEffect(() => topic ? client.retainTopic(topic) : undefined, [client, topic]);
    return useSyncExternalStore(
        useCallback((listener) => topic ? client.subscribeTopicStatus(topic, listener) : () => {}, [client, topic]),
        useCallback(() => topic ? client.topicStatus(topic) : 'idle', [client, topic]),
        () => 'idle',
    );
}

export function useRealtimeEvent<T>(definition: RealtimeEventDefinition<T>, listener: (event: RealtimeEvent<T>) => void): void {
    const client = useRealtime();
    useEffect(() => client.on(definition, listener), [client, definition, listener]);
}
