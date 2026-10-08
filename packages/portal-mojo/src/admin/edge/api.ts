import { mojoCall, mojoDelete, mojoList, mojoSave, withFreshAuth } from '../../client/runtime';
import {
    EdgeRouteModel, EdgeUpstreamModel, EdgeVhostModel,
    normalizeRouteListParams, sanitizeEdgeRouteRow, sanitizeEdgeUpstreamRow, sanitizeEdgeVhostRow,
    type EdgeRouteRow, type EdgeUpstreamRow, type EdgeVhostRow,
} from './models';

// Every call goes through the one client boundary; a refused write rejects
// with the server's own message.

export async function saveVhost(id: number | null, changes: Record<string, unknown>): Promise<EdgeVhostRow> {
    return sanitizeEdgeVhostRow(await withFreshAuth(() => mojoSave<EdgeVhostRow>(EdgeVhostModel.endpoint, id, changes)));
}

export async function deleteVhost(id: number): Promise<void> {
    await withFreshAuth(() => mojoDelete(EdgeVhostModel.endpoint, id));
}

export async function listVhostRoutes(vhost: number): Promise<EdgeRouteRow[]> {
    const page = await mojoList<EdgeRouteRow>(EdgeRouteModel.endpoint, normalizeRouteListParams({ vhost, sort: 'path_prefix', size: 200 }));
    return page.rows.map(sanitizeEdgeRouteRow);
}

export async function saveVhostRoute(id: number | null, changes: { vhost?: number; path_prefix?: string; upstream?: number }): Promise<EdgeRouteRow> {
    return sanitizeEdgeRouteRow(await withFreshAuth(() => mojoSave<EdgeRouteRow>(EdgeRouteModel.endpoint, id, changes)));
}

export async function deleteVhostRoute(id: number): Promise<void> {
    await withFreshAuth(() => mojoDelete(EdgeRouteModel.endpoint, id));
}

/** The only field a `manage_dns` holder can write on an upstream. */
export async function setUpstreamEnabled(id: number, enabled: boolean): Promise<EdgeUpstreamRow> {
    return sanitizeEdgeUpstreamRow(await withFreshAuth(() => mojoSave<EdgeUpstreamRow>(EdgeUpstreamModel.endpoint, id, { is_enabled: enabled })));
}

export type DeclareUpstreamInput =
    | { name: string; kind: 'http'; host: string; port: number; group?: number | null }
    | { name: string; kind: 'unix'; socket_path: string; group?: number | null };

/** Platform administrators only; the server refuses everyone else. */
export async function declareUpstream(input: DeclareUpstreamInput): Promise<EdgeUpstreamRow> {
    // Only the chosen kind's destination fields are sent.
    const body: Record<string, unknown> = input.kind === 'http'
        ? { name: input.name, kind: 'http', host: input.host, port: input.port }
        : { name: input.name, kind: 'unix', socket_path: input.socket_path };
    if (input.group != null) body.group = input.group;
    const response = await withFreshAuth(() => mojoCall('/api/edge/upstream/declare', { method: 'POST', body }));
    return sanitizeEdgeUpstreamRow(response.data);
}

/** Retiring disables; the row and its history stay. */
export async function retireUpstream(upstream: number): Promise<EdgeUpstreamRow> {
    const response = await withFreshAuth(() => mojoCall('/api/edge/upstream/retire', { method: 'POST', body: { upstream } }));
    return sanitizeEdgeUpstreamRow(response.data);
}
