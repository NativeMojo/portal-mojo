import type { AssistantBlock, AssistantConversation, AssistantConversationSummary, AssistantMessage, AssistantReply, AssistantScalar, AssistantSkill, AssistantUser } from './types';

const MAX_BLOCKS = 8;
const MAX_TEXT = 4_000;
const MAX_ITEMS = 24;
const MAX_COLUMNS = 12;
const MAX_ROWS = 50;
const obj = (value: unknown): Record<string, unknown> | null => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, cap = MAX_TEXT): string => typeof value === 'string' ? value.slice(0, cap) : '';
const id = (value: unknown): number | string | null => typeof value === 'number' || typeof value === 'string' ? value : null;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const scalar = (value: unknown): AssistantScalar | null => value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ? value : typeof value === 'string' ? value.slice(0, 500) : null;

function pairItems(value: unknown): Array<{ label: string; value: AssistantScalar }> | null {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS) return null;
    const out = value.map(obj).map((item) => item && text(item.label, 120) && scalar(item.value) !== null ? { label: text(item.label, 120), value: scalar(item.value)! } : null);
    return out.every(Boolean) ? out as Array<{ label: string; value: AssistantScalar }> : null;
}

function block(value: unknown): AssistantBlock | null {
    const raw = obj(value); if (!raw || typeof raw.type !== 'string') return null;
    const title = text(raw.title, 200) || undefined;
    if (raw.type === 'table') {
        if (!Array.isArray(raw.columns) || !Array.isArray(raw.rows) || raw.columns.length === 0 || raw.columns.length > MAX_COLUMNS || raw.rows.length > MAX_ROWS) return null;
        const columns = raw.columns.map((v) => text(v, 120)); if (columns.some((v) => !v)) return null;
        const rows = raw.rows.map((row) => Array.isArray(row) && row.length === columns.length ? row.map(scalar) : null);
        if (rows.some((row) => !row || row.some((v) => v === null))) return null;
        return { type: 'table', title, columns, rows: rows as AssistantScalar[][] };
    }
    if (raw.type === 'chart') {
        if (!['line', 'bar', 'pie', 'area'].includes(String(raw.chart_type)) || !Array.isArray(raw.labels) || raw.labels.length === 0 || raw.labels.length > MAX_ROWS || !Array.isArray(raw.series) || raw.series.length === 0 || raw.series.length > 8) return null;
        const labels = raw.labels.map((v) => text(v, 80));
        const series = raw.series.map(obj).map((s) => s && text(s.name, 80) && Array.isArray(s.values) && s.values.length === labels.length && s.values.every((v) => number(v) !== null) ? { name: text(s.name, 80), values: s.values as number[] } : null);
        if (labels.some((v) => !v) || series.some((v) => !v)) return null;
        return { type: 'chart', title, chart_type: raw.chart_type as 'line' | 'bar' | 'pie' | 'area', labels, series: series as Array<{ name: string; values: number[] }> };
    }
    if (raw.type === 'stat' || raw.type === 'list') { const items = pairItems(raw.items); return items ? { type: raw.type, title, items } : null; }
    if (raw.type === 'action') {
        if (!Array.isArray(raw.actions) || raw.actions.length === 0 || raw.actions.length > 6) return null;
        const actions = raw.actions.map(obj).map((a) => a && text(a.label, 80) && text(a.value, 200) ? { label: text(a.label, 80), value: text(a.value, 200) } : null);
        return actions.every(Boolean) ? { type: 'action', title, description: text(raw.description, 500) || undefined, action_id: text(raw.action_id, 120) || undefined, actions: actions as Array<{ label: string; value: string }> } : null;
    }
    if (raw.type === 'alert' && ['info', 'success', 'warning', 'error'].includes(String(raw.level)) && text(raw.message)) return { type: 'alert', level: raw.level as 'info' | 'success' | 'warning' | 'error', title, message: text(raw.message) };
    if (raw.type === 'file' && text(raw.filename, 255) && text(raw.url, 2_000)) return { type: 'file', filename: text(raw.filename, 255), url: text(raw.url, 2_000), ...(number(raw.size) != null ? { size: number(raw.size)! } : {}), ...(text(raw.format, 32) ? { format: text(raw.format, 32) } : {}), ...(number(raw.row_count) != null ? { row_count: number(raw.row_count)! } : {}), ...(text(raw.expires_in, 80) ? { expires_in: text(raw.expires_in, 80) } : {}) };
    if (raw.type === 'context' && Array.isArray(raw.references) && raw.references.length > 0 && raw.references.length <= MAX_ITEMS) {
        const references = raw.references.map(obj).map((r) => r && (r.model === 'incident.Incident' || r.model === 'incident.Ticket') && id(r.pk) != null ? { model: r.model, pk: id(r.pk)!, ...(text(r.label, 160) ? { label: text(r.label, 160) } : {}) } : null);
        return references.every(Boolean) ? { type: 'context', references: references as Array<{ model: 'incident.Incident' | 'incident.Ticket'; pk: number | string; label?: string }> } : null;
    }
    return null;
}

export function projectBlocks(value: unknown): AssistantBlock[] { return Array.isArray(value) ? value.slice(0, MAX_BLOCKS).map(block).filter((v): v is AssistantBlock => v != null) : []; }
function projectUser(value: unknown): AssistantUser | null { const raw = obj(value); const userId = raw && number(raw.id); return raw && userId != null ? { id: userId, display_name: text(raw.display_name, 160) || `User #${userId}` } : null; }
export function projectMessage(value: unknown): AssistantMessage | null { const raw = obj(value); const messageId = raw && id(raw.id); if (!raw || messageId == null || (raw.role !== 'user' && raw.role !== 'assistant')) return null; return { id: messageId, role: raw.role, content: text(raw.content, 20_000), created: typeof raw.created === 'number' || typeof raw.created === 'string' ? raw.created : 0, blocks: raw.role === 'assistant' ? projectBlocks(raw.blocks) : [] }; }
export function projectConversation(value: unknown): AssistantConversation | null { const raw = obj(value); const conversationId = raw && number(raw.id); const user = raw && projectUser(raw.user); if (!raw || conversationId == null || !user) return null; return { id: conversationId, title: text(raw.title, 255) || `Conversation #${conversationId}`, created: typeof raw.created === 'number' || typeof raw.created === 'string' ? raw.created : 0, modified: typeof raw.modified === 'number' || typeof raw.modified === 'string' ? raw.modified : 0, user, messages: Array.isArray(raw.messages) ? raw.messages.map(projectMessage).filter((v): v is AssistantMessage => v != null) : [] }; }
export function projectConversationSummary(value: unknown): AssistantConversationSummary | null { const conversation = projectConversation(value); if (!conversation) return null; const { messages: _messages, ...summary } = conversation; return summary; }
export function projectSkill(value: unknown): AssistantSkill | null { const raw = obj(value); const skillId = raw && number(raw.id); if (!raw || skillId == null || !['global', 'user', 'group'].includes(String(raw.tier))) return null; const steps = Array.isArray(raw.steps) ? raw.steps.slice(0, MAX_ITEMS).map(obj).map((step) => step && text(step.tool, 160) && text(step.description, 500) ? { tool: text(step.tool, 160), description: text(step.description, 500), ...(text(step.condition, 500) ? { condition: text(step.condition, 500) } : {}) } : null).filter((step): step is { tool: string; description: string; condition?: string } => step != null) : []; return { id: skillId, tier: raw.tier as 'global' | 'user' | 'group', name: text(raw.name, 160) || `Skill #${skillId}`, description: text(raw.description, 2_000), auto_execute: raw.auto_execute === true, is_active: raw.is_active === true, created: typeof raw.created === 'number' || typeof raw.created === 'string' ? raw.created : 0, modified: typeof raw.modified === 'number' || typeof raw.modified === 'string' ? raw.modified : 0, user: projectUser(raw.user), triggers: Array.isArray(raw.triggers) ? raw.triggers.slice(0, 10).map((v) => text(v, 200)).filter(Boolean) : [], steps }; }
export function projectReply(value: unknown): AssistantReply | null { const raw = obj(value); const conversationId = raw && number(raw.conversation_id); if (!raw || conversationId == null || typeof raw.response !== 'string') return null; return { response: text(raw.response, 20_000), conversation_id: conversationId, tool_calls_made: number(raw.tool_calls_made) ?? 0, duration_ms: number(raw.duration_ms) ?? 0, blocks: projectBlocks(raw.blocks) }; }
