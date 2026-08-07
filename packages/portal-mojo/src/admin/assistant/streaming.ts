import {
    defineRealtimeEvent, type RealtimeClient, type RealtimeLifecycleStatus,
} from '../../client/realtime';
import { projectBlocks } from './data';
import { getAssistantConversation, listAssistantConversations } from './api';
import type { AssistantBlock, AssistantConversation, AssistantMessage } from './types';

const MAX_TEXT = 20_000;
const MAX_TOOL_NAME = 160;
const MAX_TOOLS = 32;
const MAX_PLAN_STEPS = 20;
const object = (value: unknown): Record<string, unknown> | null => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, cap: number): string | null => typeof value === 'string' && value.length > 0 ? value.slice(0, cap) : null;
const conversationId = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;

export interface AssistantThinkingEvent { type: 'thinking'; conversationId: number }
export interface AssistantTextEvent { type: 'text'; conversationId: number; text: string; blocks: AssistantBlock[] }
export interface AssistantToolEvent { type: 'tool'; conversationId: number; name: string; status: 'running'; count: number }
export interface AssistantPlanStep { id: number; description: string; status: 'pending' | 'in_progress' | 'done' | 'skipped'; summary?: string }
export interface AssistantPlanEvent { type: 'plan'; conversationId: number; planId: string; title: string; steps: AssistantPlanStep[] }
export interface AssistantPlanUpdateEvent { type: 'plan_update'; conversationId: number; planId: string; stepId: number; status: AssistantPlanStep['status']; summary?: string }
export interface AssistantResponseEvent { type: 'response'; conversationId: number; messageId: number | string | null; created: number | string; response: string; blocks: AssistantBlock[]; toolCount: number; durationMs: number }
export interface AssistantErrorEvent { type: 'error'; conversationId: number | null; error: string }
export type AssistantProjectedEvent = AssistantThinkingEvent | AssistantTextEvent | AssistantToolEvent | AssistantPlanEvent | AssistantPlanUpdateEvent | AssistantResponseEvent | AssistantErrorEvent;

function exact(value: unknown, expectedType: string): Record<string, unknown> | null {
    const raw = object(value);
    return raw?.type === expectedType ? raw : null;
}

export function projectAssistantThinking(value: unknown): AssistantThinkingEvent | null {
    const raw = exact(value, 'assistant_thinking'); const id = raw && conversationId(raw.conversation_id);
    return id == null ? null : { type: 'thinking', conversationId: id };
}

export function projectAssistantText(value: unknown): AssistantTextEvent | null {
    const raw = exact(value, 'assistant_text'); const id = raw && conversationId(raw.conversation_id); const content = raw && text(raw.text, MAX_TEXT);
    return id == null || content == null ? null : { type: 'text', conversationId: id, text: content, blocks: projectBlocks(raw.blocks) };
}

export function projectAssistantToolCall(value: unknown): AssistantToolEvent | null {
    const raw = exact(value, 'assistant_tool_call'); const id = raw && conversationId(raw.conversation_id); const name = raw && text(raw.tool, MAX_TOOL_NAME);
    return id == null || name == null ? null : { type: 'tool', conversationId: id, name, status: 'running', count: 1 };
}

const PLAN_STATUSES = new Set<AssistantPlanStep['status']>(['pending', 'in_progress', 'done', 'skipped']);
function planStatus(value: unknown): AssistantPlanStep['status'] | null {
    return typeof value === 'string' && PLAN_STATUSES.has(value as AssistantPlanStep['status']) ? value as AssistantPlanStep['status'] : null;
}

export function projectAssistantPlan(value: unknown): AssistantPlanEvent | null {
    const raw = exact(value, 'assistant_plan'); const id = raw && conversationId(raw.conversation_id); const plan = raw && object(raw.plan);
    const planId = plan && text(plan.plan_id, 80); const title = plan && text(plan.title, 200);
    if (id == null || !plan || !planId || !title || !Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > MAX_PLAN_STEPS) return null;
    const steps = plan.steps.map(object).map((step) => {
        const stepId = step && conversationId(step.id); const description = step && text(step.description, 500); const status = step && planStatus(step.status);
        if (stepId == null || !description || !status) return null;
        const summary = text(step.summary, 500);
        return { id: stepId, description, status, ...(summary ? { summary } : {}) };
    });
    return steps.every(Boolean) ? { type: 'plan', conversationId: id, planId, title, steps: steps as AssistantPlanStep[] } : null;
}

export function projectAssistantPlanUpdate(value: unknown): AssistantPlanUpdateEvent | null {
    const raw = exact(value, 'assistant_plan_update'); const id = raw && conversationId(raw.conversation_id); const planId = raw && text(raw.plan_id, 80);
    const stepId = raw && conversationId(raw.step_id); const status = raw && planStatus(raw.status); const summary = raw && text(raw.summary, 500);
    return id == null || !planId || stepId == null || !status ? null : { type: 'plan_update', conversationId: id, planId, stepId, status, ...(summary ? { summary } : {}) };
}

export function projectAssistantResponse(value: unknown): AssistantResponseEvent | null {
    const raw = exact(value, 'assistant_response'); const id = raw && conversationId(raw.conversation_id); const response = raw && typeof raw.response === 'string' ? raw.response.slice(0, MAX_TEXT) : null;
    if (id == null || response == null) return null;
    const messageId = typeof raw.message_id === 'number' && Number.isSafeInteger(raw.message_id) && raw.message_id > 0
        ? raw.message_id : typeof raw.message_id === 'string' && raw.message_id.length > 0 && raw.message_id.length <= 160 ? raw.message_id : null;
    const created = typeof raw.created === 'number' || typeof raw.created === 'string' ? raw.created : 0;
    const toolCount = Array.isArray(raw.tool_calls_made) ? Math.min(raw.tool_calls_made.length, MAX_TOOLS) : typeof raw.tool_calls_made === 'number' ? Math.min(Math.max(0, raw.tool_calls_made), MAX_TOOLS) : 0;
    const durationMs = typeof raw.duration_ms === 'number' && Number.isFinite(raw.duration_ms) ? Math.max(0, raw.duration_ms) : 0;
    return { type: 'response', conversationId: id, messageId, created, response, blocks: projectBlocks(raw.blocks), toolCount, durationMs };
}

export function projectAssistantError(value: unknown): AssistantErrorEvent | null {
    const raw = exact(value, 'assistant_error'); const error = raw && text(raw.error, 1_000);
    return !raw || !error ? null : { type: 'error', conversationId: conversationId(raw.conversation_id), error };
}

export const ASSISTANT_REALTIME_EVENTS = {
    thinking: defineRealtimeEvent('assistant_thinking', projectAssistantThinking),
    text: defineRealtimeEvent('assistant_text', projectAssistantText),
    tool: defineRealtimeEvent('assistant_tool_call', projectAssistantToolCall),
    plan: defineRealtimeEvent('assistant_plan', projectAssistantPlan),
    planUpdate: defineRealtimeEvent('assistant_plan_update', projectAssistantPlanUpdate),
    response: defineRealtimeEvent('assistant_response', projectAssistantResponse),
    error: defineRealtimeEvent('assistant_error', projectAssistantError),
} as const;

export type AssistantTransportChoice = 'websocket' | 'rest' | 'inspect';
export function chooseAssistantTransport(input: { owner: boolean; textOnly: boolean; hasViewAdmin: boolean; realtimeStatus: RealtimeLifecycleStatus }): AssistantTransportChoice {
    if (!input.owner) return 'inspect';
    return input.textOnly && input.hasViewAdmin && input.realtimeStatus === 'ready' ? 'websocket' : 'rest';
}

export class AssistantOutcomeUnknownError extends Error {
    constructor() {
        super('Outcome unknown: the connection ended before the server assigned a conversation. The conversation list was refreshed; the message was not resent.');
        this.name = 'AssistantOutcomeUnknownError';
    }
}

export interface AssistantRealtimeProgress {
    tools: Array<{ name: string; status: 'running'; count: number }>;
    plan: AssistantPlanEvent | null;
}

export interface AssistantRealtimeTurnCallbacks {
    onConversation(id: number): void;
    onText(message: AssistantMessage): void;
    onProgress(progress: AssistantRealtimeProgress): void;
    onResponse(message: AssistantMessage): void;
    onReconcile(conversation: AssistantConversation): void;
    onUnknown(): void;
}

export interface AssistantRealtimeTurn {
    promise: Promise<void>;
    cancel(): void;
}

export function startAssistantRealtimeTurn(
    client: RealtimeClient,
    input: {
        message: string;
        conversationId?: number;
        seenMessageIds: Set<number | string>;
        reconcile?: (conversationId: number) => Promise<AssistantConversation>;
        refreshList?: () => Promise<unknown>;
    },
    callbacks: AssistantRealtimeTurnCallbacks,
): AssistantRealtimeTurn {
    let expected = input.conversationId ?? null;
    let active = true;
    let disconnected = false;
    let interimSequence = 0;
    const tools = new Map<string, { name: string; status: 'running'; count: number }>();
    let plan: AssistantPlanEvent | null = null;
    const cleanups: Array<() => void> = [];
    let resolvePromise!: () => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });

    const finish = (error?: Error) => {
        if (!active) return;
        active = false;
        cleanups.splice(0).forEach((cleanup) => cleanup());
        if (error) rejectPromise(error); else resolvePromise();
    };
    const correlated = (id: number | null): id is number => id != null && (expected == null || expected === id);
    const adopt = (id: number) => {
        if (expected == null) { expected = id; callbacks.onConversation(id); }
    };
    const progress = () => callbacks.onProgress({ tools: [...tools.values()].slice(0, MAX_TOOLS), plan });

    cleanups.push(client.on(ASSISTANT_REALTIME_EVENTS.thinking, ({ data, source }) => {
        if (source !== 'direct' || !active || !correlated(data.conversationId)) return;
        adopt(data.conversationId);
    }));
    cleanups.push(client.on(ASSISTANT_REALTIME_EVENTS.text, ({ data, source }) => {
        if (source !== 'direct' || !active || !correlated(data.conversationId)) return;
        adopt(data.conversationId);
        callbacks.onText({ id: `stream-${data.conversationId}-${++interimSequence}`, role: 'assistant', content: data.text, created: Math.floor(Date.now() / 1000), blocks: data.blocks });
    }));
    cleanups.push(client.on(ASSISTANT_REALTIME_EVENTS.tool, ({ data, source }) => {
        if (source !== 'direct' || !active || !correlated(data.conversationId)) return;
        adopt(data.conversationId);
        const current = tools.get(data.name);
        tools.set(data.name, { name: data.name, status: 'running', count: Math.min(MAX_TOOLS, (current?.count ?? 0) + 1) });
        progress();
    }));
    cleanups.push(client.on(ASSISTANT_REALTIME_EVENTS.plan, ({ data, source }) => {
        if (source !== 'direct' || !active || !correlated(data.conversationId)) return;
        adopt(data.conversationId); plan = data; progress();
    }));
    cleanups.push(client.on(ASSISTANT_REALTIME_EVENTS.planUpdate, ({ data, source }) => {
        if (source !== 'direct' || !active || !correlated(data.conversationId) || !plan || plan.planId !== data.planId) return;
        plan = { ...plan, steps: plan.steps.map((step) => step.id === data.stepId ? { ...step, status: data.status, ...(data.summary ? { summary: data.summary } : {}) } : step) };
        progress();
    }));
    cleanups.push(client.on(ASSISTANT_REALTIME_EVENTS.response, ({ data, source }) => {
        if (source !== 'direct' || !active || !correlated(data.conversationId)) return;
        adopt(data.conversationId);
        if (data.messageId == null) {
            void (input.reconcile ?? getAssistantConversation)(data.conversationId).then((conversation) => {
                if (!active) return;
                callbacks.onReconcile(conversation);
                for (const message of conversation.messages) input.seenMessageIds.add(message.id);
                finish();
            }, (cause) => finish(cause instanceof Error ? cause : new Error('Assistant terminal reconciliation failed')));
            return;
        }
        if (!input.seenMessageIds.has(data.messageId)) {
            input.seenMessageIds.add(data.messageId);
            callbacks.onResponse({ id: data.messageId, role: 'assistant', content: data.response, created: data.created, blocks: data.blocks });
        }
        finish();
    }));
    cleanups.push(client.on(ASSISTANT_REALTIME_EVENTS.error, ({ data, source }) => {
        if (source !== 'direct' || !active || (data.conversationId != null && !correlated(data.conversationId))) return;
        if (data.conversationId != null) adopt(data.conversationId);
        finish(new Error(data.error));
    }));
    cleanups.push(client.subscribeStatus(() => {
        if (!active) return;
        const status = client.getStatus().status;
        if (status !== 'ready') {
            if (expected == null) {
                callbacks.onUnknown();
                void (input.refreshList ?? listAssistantConversations)().catch(() => undefined);
                finish(new AssistantOutcomeUnknownError());
            } else {
                disconnected = true;
            }
        } else if (disconnected && expected != null) {
            disconnected = false;
            void (input.reconcile ?? getAssistantConversation)(expected).then((conversation) => {
                if (!active) return;
                callbacks.onReconcile(conversation);
                for (const message of conversation.messages) input.seenMessageIds.add(message.id);
                finish();
            }, (cause) => finish(cause instanceof Error ? cause : new Error('Assistant reconciliation failed')));
        }
    }));

    try {
        client.send({ type: 'assistant_message', message: input.message, ...(input.conversationId != null ? { conversation_id: input.conversationId } : {}) });
    } catch (cause) {
        finish(cause instanceof Error ? cause : new Error('Realtime Assistant send failed'));
    }
    return { promise, cancel: () => finish(new Error('Assistant stream cancelled')) };
}
