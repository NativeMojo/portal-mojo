import { useQuery } from '@tanstack/react-query';
import { createElement } from 'react';
import { defineModel, mojoCall, mojoList, type Params } from '../../client';
import { modal } from '../../ui';
import { SECURITY_DELETE_PERMS, SECURITY_MANAGE_PERMS, SECURITY_VIEW_PERMS } from '../security-permissions';
import { sanitizeEventRow, sanitizeIncidentRow } from './sanitize';

export type Relation = number | { id: number; title?: string | null; name?: string | null } | null;
export interface IncidentRow {
    id: number; created: number; priority: number; state: string; status: string;
    scope: string; category: string; country_code: string | null; title: string | null;
    details: string | null; model_name: string | null; model_id: number | null;
    source_ip: string | null; hostname: string | null; metadata: Record<string, unknown>;
    group_id: number | null; rule_set?: Relation; ip_info?: Record<string, unknown> | null;
}
export interface EventRow {
    id: number; created: number; level: number; scope: string; category: string;
    source_ip: string | null; hostname: string | null; uid: number | null;
    country_code: string | null; title: string | null; details: string | null;
    model_name: string | null; model_id: number | null; metadata: Record<string, unknown>;
    group_id: number | null; incident?: Relation; geo_ip?: Record<string, unknown> | null;
}

const COMMON = new Set(['start', 'size', 'sort', 'search', 'dr_field', 'dr_start', 'dr_end']);
const INCIDENT_FILTERS = new Set([
    'id', 'id__in', 'status', 'status__in', 'state', 'scope', 'scope__icontains', 'category',
    'category__icontains', 'category__not', 'category__startswith', 'priority', 'priority__gte',
    'priority__lte', 'priority__gt', 'priority__lt', 'metadata__rule_id',
    'metadata__do_not_delete', 'created__gte', 'created__lte', 'source_ip', 'model_name', 'model_id',
]);
const EVENT_FILTERS = new Set([
    'id', 'incident', 'category', 'category__icontains', 'category__not', 'category__not_in',
    'category__startswith', 'scope', 'scope__icontains', 'source_ip', 'source_ip__icontains',
    'level', 'level__gte', 'level__lte', 'level__gt', 'level__lt', 'created__gte', 'created__lte',
    'model_name', 'model_name__icontains', 'model_id', 'metadata__server',
    'metadata__server__icontains', 'metadata__http_url__icontains', 'metadata__http_path__icontains',
    'metadata__http_query_string__icontains', 'metadata__http_status', 'metadata__http_user_agent__icontains',
    'metadata__rule_id', 'metadata__country_code', 'metadata__region', 'metadata__city__icontains',
    'metadata__user_email',
]);

function normalize(params: Params, allowed: Set<string>, sort: string): Params {
    const out: Params = { graph: 'default' };
    for (const [key, value] of Object.entries(params)) {
        if ((COMMON.has(key) || allowed.has(key)) && value != null && value !== '') out[key] = value;
    }
    out.sort = String(out.sort ?? sort);
    return out;
}
export const normalizeIncidentListParams = (params: Params): Params => normalize(params, INCIDENT_FILTERS, '-id');
export const normalizeEventListParams = (params: Params): Params => {
    const out = normalize(params, EVENT_FILTERS, '-created');
    // Day grouping requires chronological contiguity.
    if (out.sort !== 'created' && out.sort !== '-created') out.sort = '-created';
    return out;
};

export const IncidentModel = defineModel<IncidentRow>({
    name: 'incident', endpoint: '/api/incident/incident',
    permissions: { view: SECURITY_VIEW_PERMS, manage: SECURITY_MANAGE_PERMS, delete: SECURITY_DELETE_PERMS },
    actions: { merge: { permissions: SECURITY_MANAGE_PERMS, response: 'payload' } },
    normalizeListParams: normalizeIncidentListParams, sanitizeRow: sanitizeIncidentRow,
});
export const EventModel = defineModel<EventRow>({
    name: 'event', endpoint: '/api/incident/event',
    permissions: { view: SECURITY_VIEW_PERMS, manage: SECURITY_MANAGE_PERMS },
    normalizeListParams: normalizeEventListParams, sanitizeRow: sanitizeEventRow,
});

export const INCIDENT_LIFECYCLE = ['pending', 'new', 'open', 'investigating', 'resolved', 'closed', 'ignored'] as const;

export function incidentDetailKey(id: number) { return [IncidentModel.endpoint, 'one', id, { graph: 'detailed' }] as const; }
export function eventDetailKey(id: number) { return [EventModel.endpoint, 'one', id, { graph: 'detailed' }] as const; }
export function useIncidentDetail(id: number | null) {
    return useQuery({
        queryKey: id == null ? [IncidentModel.endpoint, 'one', null, { graph: 'detailed' }] : incidentDetailKey(id),
        queryFn: async () => sanitizeIncidentRow((await mojoCall(`${IncidentModel.endpoint}/${id!}`, { params: { graph: 'detailed' } })).data as IncidentRow),
        enabled: id != null,
    });
}
export function useEventDetail(id: number | null) {
    return useQuery({
        queryKey: id == null ? [EventModel.endpoint, 'one', null, { graph: 'detailed' }] : eventDetailKey(id),
        queryFn: async () => sanitizeEventRow((await mojoCall(`${EventModel.endpoint}/${id!}`, { params: { graph: 'detailed' } })).data as EventRow),
        enabled: id != null,
    });
}
export function useIncidentEvents(id: number | null) {
    return useQuery({
        queryKey: [EventModel.endpoint, { incident: id, graph: 'default', sort: '-created', size: 100 }],
        queryFn: async () => {
            const page = await mojoList<EventRow>(EventModel.endpoint, { incident: id!, graph: 'default', sort: '-created', size: 100 });
            return { ...page, rows: page.rows.map(sanitizeEventRow) };
        },
        enabled: id != null,
    });
}

export function buildIncidentMerge(rows: readonly IncidentRow[], targetId: number): { target: IncidentRow; sourceIds: number[] } {
    if (rows.length < 2) throw new Error('Select at least two incidents to merge.');
    const target = rows.find((row) => row.id === targetId);
    if (!target) throw new Error('Choose a target from the selected incidents.');
    const sourceIds = [...new Set(rows.map((row) => row.id).filter((id) => id !== targetId))];
    if (!sourceIds.length) throw new Error('A merge needs at least one source incident.');
    return { target, sourceIds };
}

export function showIncidentDetail(id: number): void {
    void import('./IncidentDetail').then(({ IncidentDetail }) => modal.detail((close) => createElement(IncidentDetail, { id, onClose: () => close(null) })));
}
export function showEventDetail(id: number): void {
    void import('./EventDetail').then(({ EventDetail }) => modal.detail((close) => createElement(EventDetail, { id, onClose: () => close(null) })));
}
