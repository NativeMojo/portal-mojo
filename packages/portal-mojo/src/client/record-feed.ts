import { mojoList, mojoSave } from './client';

export type RecordFeedId = number | string;
export type RecordFeedTimestamp = number | string;
export type RecordFeedAdapterKind = 'ticket-note' | 'incident-history';

export interface RecordFeedAuthor {
    id: RecordFeedId | null;
    name: string;
    avatarUrl?: string;
}

export interface RecordFeedItemBase {
    id: RecordFeedId;
    created: RecordFeedTimestamp;
    content: string;
    author: RecordFeedAuthor;
    metadata: Record<string, unknown>;
    /** Wire-shaped django-mojo row; sensitive-domain adapters may sanitize it. */
    raw: Record<string, unknown>;
    /** Client-only marker used by adapter-mode optimistic rows. */
    pending?: boolean;
}

export interface RecordFeedComment extends RecordFeedItemBase {
    kind: 'comment';
}

export interface RecordFeedAssistantNote extends RecordFeedItemBase {
    kind: 'assistant';
}

export interface RecordFeedSystemEvent extends RecordFeedItemBase {
    kind: 'system';
    event?: string;
}

export interface RecordFeedStatusEvent extends RecordFeedItemBase {
    kind: 'status';
    from: string | null;
    to: string | null;
}

export type RecordFeedItem =
    | RecordFeedComment
    | RecordFeedAssistantNote
    | RecordFeedSystemEvent
    | RecordFeedStatusEvent;

export interface RecordFeedPage {
    /** Chronological: oldest of the latest window first. */
    items: RecordFeedItem[];
    count: number;
    hasEarlier: boolean;
}

export type RecordFeedQueryKey = readonly [
    'record-feed',
    RecordFeedAdapterKind,
    RecordFeedId,
    RecordFeedId | null,
];

export interface RecordFeedAdapter {
    kind: RecordFeedAdapterKind;
    parentId: RecordFeedId;
    groupId: RecordFeedId | null;
    /** Stable, structural and record-scoped. Safe for exact Query operations. */
    queryKey: RecordFeedQueryKey;
    fetch(): Promise<RecordFeedPage>;
    addNote(text: string): Promise<RecordFeedItem>;
    /** Sanitizes optimistic cache and mutation variables for sensitive domains. */
    sanitizeDraft?(text: string): string;
}

export interface FeedAdapterOptions {
    groupId?: RecordFeedId | null;
    sanitizeRow?: (row: Record<string, unknown>) => Record<string, unknown>;
    sanitizeText?: (text: string) => string;
}

interface WireFeedUser {
    id?: RecordFeedId | null;
    display_name?: unknown;
    username?: unknown;
    email?: unknown;
    avatar?: unknown;
}

interface WireFeedRow extends Record<string, unknown> {
    id?: unknown;
    created?: unknown;
    user?: unknown;
    note?: unknown;
    metadata?: unknown;
    kind?: unknown;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function optionalText(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    return String(value);
}

function avatarUrl(value: unknown): string | undefined {
    if (typeof value === 'string' && value) return value;
    const avatar = objectOrEmpty(value);
    return typeof avatar.url === 'string' && avatar.url ? avatar.url : undefined;
}

function normalizeAuthor(value: unknown, fallback: string): RecordFeedAuthor {
    const user = objectOrEmpty(value) as WireFeedUser;
    const name = optionalText(user.display_name)
        ?? optionalText(user.username)
        ?? optionalText(user.email)
        ?? fallback;
    return {
        id: typeof user.id === 'number' || typeof user.id === 'string' ? user.id : null,
        name,
        avatarUrl: avatarUrl(user.avatar),
    };
}

function structuredStatus(metadata: Record<string, unknown>): { from: string | null; to: string | null } | null {
    const nested = objectOrEmpty(metadata.status_change);
    const isStatus = metadata.type === 'status_change' || Object.keys(nested).length > 0;
    if (!isStatus) return null;
    const from = optionalText(metadata.old_status ?? nested.old_status ?? nested.from);
    const to = optionalText(metadata.new_status ?? nested.new_status ?? nested.to);
    // A type marker without either structured endpoint is not enough. In
    // particular, never recover a transition by regexing the prose note.
    return from !== null || to !== null ? { from, to } : null;
}

function isCanonicalAssistant(row: WireFeedRow, metadata: Record<string, unknown>, content: string): boolean {
    if (content.startsWith('[LLM Agent]')) return true;
    if (row.kind === 'handler:llm') return true;
    if (metadata.handler === 'llm' || metadata.origin === 'llm') return true;
    const action = objectOrEmpty(metadata.action);
    return action.handler === 'llm';
}

function isLegacyAssistant(row: WireFeedRow, metadata: Record<string, unknown>): boolean {
    // These older ticket records encoded assistant context without a handler.
    // Only null-user rows qualify; null user on its own is always System.
    if (row.user !== null && row.user !== undefined) return false;
    const action = objectOrEmpty(metadata.action);
    if (Object.keys(action).length > 0) return true;
    return metadata.type === 'context' && metadata.references !== null && metadata.references !== undefined;
}

/**
 * Normalize ticket notes and incident history through one strict precedence:
 * structured status → canonical LLM → legacy null-user LLM → user → system.
 */
export function normalizeRecordFeedItem(raw: Record<string, unknown>): RecordFeedItem {
    const row = raw as WireFeedRow;
    const metadata = objectOrEmpty(row.metadata);
    const content = optionalText(row.note) ?? '';
    const id = typeof row.id === 'number' || typeof row.id === 'string'
        ? row.id
        : `missing-${optionalText(row.created) ?? 'record'}`;
    const created = typeof row.created === 'number' || typeof row.created === 'string'
        ? row.created
        : 0;
    const status = structuredStatus(metadata);

    if (status) {
        return {
            id, created, content, metadata, raw,
            kind: 'status', from: status.from, to: status.to,
            author: normalizeAuthor(row.user, 'System'),
        };
    }

    if (isCanonicalAssistant(row, metadata, content) || isLegacyAssistant(row, metadata)) {
        return {
            id, created, content, metadata, raw,
            kind: 'assistant',
            author: normalizeAuthor(row.user, 'AI Agent'),
        };
    }

    if (row.user !== null && row.user !== undefined) {
        return {
            id, created, content, metadata, raw,
            kind: 'comment',
            author: normalizeAuthor(row.user, 'Unknown user'),
        };
    }

    return {
        id, created, content, metadata, raw,
        kind: 'system', event: optionalText(row.kind) ?? optionalText(metadata.type) ?? undefined,
        author: normalizeAuthor(null, 'System'),
    };
}

export function recordFeedQueryKey(
    kind: RecordFeedAdapterKind,
    parentId: RecordFeedId,
    groupId: RecordFeedId | null = null,
): RecordFeedQueryKey {
    return ['record-feed', kind, parentId, groupId] as const;
}

interface AdapterConfig {
    kind: RecordFeedAdapterKind;
    endpoint: string;
    parentId: RecordFeedId;
    groupId: RecordFeedId | null;
    postKind?: string;
    sanitizeRow?: (row: Record<string, unknown>) => Record<string, unknown>;
    sanitizeText?: (text: string) => string;
}

function makeAdapter(config: AdapterConfig): RecordFeedAdapter {
    const { kind, endpoint, parentId, groupId, postKind, sanitizeRow, sanitizeText } = config;
    const queryKey = recordFeedQueryKey(kind, parentId, groupId);

    return {
        kind,
        parentId,
        groupId,
        queryKey,
        sanitizeDraft: (text) => sanitizeText ? sanitizeText(text) : text,
        async fetch() {
            const page = await mojoList<Record<string, unknown>>(endpoint, {
                parent: parentId,
                ...(groupId === null ? {} : { group: groupId }),
                graph: 'default',
                sort: '-created',
                start: 0,
                size: 100,
            });
            const newestFirst = page.rows.map((row) => normalizeRecordFeedItem(sanitizeRow ? sanitizeRow(row) : row));
            return {
                items: newestFirst.reverse(),
                count: page.count,
                hasEarlier: page.count > page.rows.length,
            };
        },
        async addNote(text) {
            const safeText = sanitizeText ? sanitizeText(text) : text;
            const raw = await mojoSave<Record<string, unknown>>(endpoint, null, {
                parent: parentId,
                // django-mojo's generic REST saver consumes ForeignKeys as a
                // bare primary key (`{"group": 5}`), permission-checks the
                // related row, then assigns it. Keep create scope identical
                // to the group-aware list/cache scope.
                ...(groupId === null ? {} : { group: groupId }),
                note: safeText,
                ...(postKind ? { kind: postKind } : {}),
            });
            const safeRaw = sanitizeRow ? sanitizeRow(raw) : raw;
            return normalizeRecordFeedItem(safeRaw);
        },
    };
}

/** Ticket comments and ticket status-change records. */
export function createTicketNoteAdapter(
    parentId: RecordFeedId,
    options: FeedAdapterOptions = {},
): RecordFeedAdapter {
    return makeAdapter({
        kind: 'ticket-note',
        endpoint: '/api/incident/ticket/note',
        parentId,
        groupId: options.groupId ?? null,
        sanitizeRow: options.sanitizeRow,
        sanitizeText: options.sanitizeText,
    });
}

/** Incident comments and automated incident history. */
export function createIncidentHistoryAdapter(
    parentId: RecordFeedId,
    options: FeedAdapterOptions = {},
): RecordFeedAdapter {
    return makeAdapter({
        kind: 'incident-history',
        endpoint: '/api/incident/incident/history',
        parentId,
        groupId: options.groupId ?? null,
        postKind: 'comment',
        sanitizeRow: options.sanitizeRow,
        sanitizeText: options.sanitizeText,
    });
}
