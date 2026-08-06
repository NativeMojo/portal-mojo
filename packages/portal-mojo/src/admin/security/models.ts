import type { QueryClient } from '@tanstack/react-query';
import { defineModel } from '../../client';
import {
    SECURITY_DELETE_PERMS, SECURITY_MANAGE_PERMS, SECURITY_USER_LOOKUP_PERMS,
    SECURITY_VIEW_PERMS,
} from '../security-permissions';

export type RelationId = number | string;
export interface BasicRelation { id: RelationId; name?: string | null; title?: string | null; display_name?: string | null; username?: string | null; status?: string | null; priority?: number | null }
export type RelationValue = BasicRelation | RelationId | null;

export interface TicketRow {
    id: number;
    created: number;
    modified: number;
    title: string;
    description: string | null;
    status: string;
    priority: number;
    category: string;
    assignee: RelationValue;
    incident: RelationValue;
    user: RelationValue;
    group: RelationValue;
    metadata: Record<string, unknown>;
}

export interface TicketNoteAction {
    handler?: unknown;
    type?: unknown;
    label?: unknown;
    resolved?: unknown;
    resolution?: unknown;
    context?: unknown;
    references?: unknown;
}

export interface MaestroItemLinkRow {
    id: number;
    created: number;
    modified: number;
    ticket: RelationValue;
    incident: RelationValue;
    remote_integration_id: string;
    remote_item_id: number;
    remote_board_id: number | null;
    remote_url: string;
    last_synced: number | null;
    source_kind?: string;
    source_id?: number;
}

export const TICKET_VIEW_PERMS = SECURITY_VIEW_PERMS;
export const TICKET_MANAGE_PERMS = SECURITY_MANAGE_PERMS;
export const TICKET_DELETE_PERMS = SECURITY_DELETE_PERMS;
export const TICKET_USER_LOOKUP_PERMS = SECURITY_USER_LOOKUP_PERMS;

export const TicketModel = defineModel<TicketRow>({
    name: 'ticket',
    endpoint: '/api/incident/ticket',
    permissions: {
        view: TICKET_VIEW_PERMS,
        manage: TICKET_MANAGE_PERMS,
        create: TICKET_MANAGE_PERMS,
        delete: TICKET_DELETE_PERMS,
    },
    actions: {
        enable_llm: { permissions: TICKET_MANAGE_PERMS, response: 'row' },
        disable_llm: { permissions: TICKET_MANAGE_PERMS, response: 'row' },
        push_to_maestro: { permissions: TICKET_MANAGE_PERMS, response: 'row' },
    },
});

export const MaestroItemLinkModel = defineModel<MaestroItemLinkRow>({
    name: 'maestro-item-link',
    endpoint: '/api/incident/maestro/item-link',
    permissions: { view: TICKET_VIEW_PERMS },
});

export function relationId(value: RelationValue | undefined): RelationId | null {
    if (value == null) return null;
    return typeof value === 'object' ? value.id : value;
}

export function relationLabel(value: RelationValue | undefined, fallback = '—'): string {
    if (value == null) return fallback;
    if (typeof value !== 'object') return String(value);
    return value.display_name ?? value.name ?? value.title ?? value.username ?? String(value.id);
}

/** Preserve an arbitrary server value alongside the known catalog. */
export function knownOptionsWithCurrent(known: readonly string[], current: unknown): string[] {
    const value = current == null ? '' : String(current);
    return value && !known.includes(value) ? [...known, value] : [...known];
}

export function isTicketTerminal(status: unknown): boolean {
    return status === 'closed' || status === 'resolved';
}

export function isTicketActionDisabled(
    action: TicketNoteAction,
    ticketStatus: unknown,
    canManage: boolean,
    pending: boolean,
): boolean {
    return Boolean(action.resolved) || isTicketTerminal(ticketStatus) || !canManage || pending;
}

/** The action context is intentionally passed through by identity. */
export function buildTicketActionResponseBody(
    ticketId: number,
    groupId: RelationId | null,
    action: TicketNoteAction,
    decision: 'approve' | 'deny',
): Record<string, unknown> {
    return {
        parent: ticketId,
        ...(groupId == null ? {} : { group: groupId }),
        note: decision === 'approve' ? 'Approved' : 'Denied',
        metadata: {
            action_response: {
                handler: action.handler,
                action: decision,
                context: action.context,
            },
        },
    };
}

export async function invalidateTicketDependents(queryClient: QueryClient, ticketId: number): Promise<void> {
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: TicketModel.keys.root }),
        queryClient.invalidateQueries({ queryKey: ['record-feed', 'ticket-note', ticketId] }),
        queryClient.invalidateQueries({ queryKey: MaestroItemLinkModel.keys.root }),
    ]);
}
