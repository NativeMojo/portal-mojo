import type { RecordFeedId } from '../../client/record-feed';

export type AssistantScalar = string | number | boolean | null;
export type AssistantBlock =
    | { type: 'table'; title?: string; columns: string[]; rows: AssistantScalar[][] }
    | { type: 'chart'; title?: string; chart_type: 'line' | 'bar' | 'pie' | 'area'; labels: string[]; series: Array<{ name: string; values: number[] }> }
    | { type: 'stat'; title?: string; items: Array<{ label: string; value: AssistantScalar }> }
    | { type: 'list'; title?: string; items: Array<{ label: string; value: AssistantScalar }> }
    | { type: 'action'; title?: string; description?: string; action_id?: string; actions: Array<{ label: string; value: string }> }
    | { type: 'alert'; level: 'info' | 'success' | 'warning' | 'error'; title?: string; message: string }
    | { type: 'file'; filename: string; url: string; size?: number; format?: string; row_count?: number; expires_in?: string }
    | { type: 'context'; references: Array<{ model: 'incident.Incident' | 'incident.Ticket'; pk: RecordFeedId; label?: string }> };

export interface AssistantUser { id: number; display_name: string }
export interface AssistantMessage {
    id: RecordFeedId; role: 'user' | 'assistant'; content: string; created: number | string;
    blocks: AssistantBlock[];
}
export interface AssistantConversation {
    id: number; title: string; created: number | string; modified: number | string;
    user: AssistantUser; messages: AssistantMessage[];
}
export interface AssistantConversationSummary extends Omit<AssistantConversation, 'messages'> {}
export interface AssistantSkill {
    id: number; tier: 'global' | 'user' | 'group'; name: string; description: string;
    auto_execute: boolean; is_active: boolean; created: number | string; modified: number | string;
    user: AssistantUser | null; triggers: string[]; steps: Array<{ tool: string; description: string; condition?: string }>;
}
export interface AssistantReply { response: string; conversation_id: number; tool_calls_made: number; duration_ms: number; blocks: AssistantBlock[] }
