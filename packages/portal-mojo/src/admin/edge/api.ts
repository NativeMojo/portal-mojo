import { mojoCall, mojoDelete, mojoList, mojoSave, withFreshAuth } from '../../client/runtime';
import {
    EdgeRouteModel, EdgeUpstreamModel, EdgeVhostModel,
    normalizeRouteListParams, sanitizeEdgeRouteRow, sanitizeEdgeUpstreamRow, sanitizeEdgeVhostRow,
    type EdgeRouteRow, type EdgeUpstreamRow, type EdgeVhostRow,
} from './models';

// Every call goes through the one client boundary; a refused write rejects
// with the server's own message.

export async function saveVhost(id: number | null, changes: Record<string, unknown>, beforeWrite?: () => void): Promise<EdgeVhostRow> {
    return sanitizeEdgeVhostRow(await withFreshAuth(() => { beforeWrite?.(); return mojoSave<EdgeVhostRow>(EdgeVhostModel.endpoint, id, changes); }));
}

export async function deleteVhost(id: number, beforeWrite?: () => void): Promise<void> {
    await withFreshAuth(() => { beforeWrite?.(); return mojoDelete(EdgeVhostModel.endpoint, id); });
}

export async function listVhostRoutes(vhost: number): Promise<EdgeRouteRow[]> {
    const rows: EdgeRouteRow[] = [];
    const seen = new Set<number>();
    let total: number | null = null;
    while (rows.length < 2000) {
        const page = await mojoList<EdgeRouteRow>(EdgeRouteModel.endpoint, normalizeRouteListParams({ vhost, sort: 'path_prefix', start: rows.length, size: 200 }));
        if (!Number.isSafeInteger(page.count) || page.count < rows.length + page.rows.length || total != null && total !== page.count) throw new Error('The route inventory changed or was incomplete. Refresh before changing routes.');
        total = page.count;
        for (const raw of page.rows) {
            const row = sanitizeEdgeRouteRow(raw);
            if (!Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id)) throw new Error('The route list changed or was incomplete. Refresh before changing routes.');
            seen.add(row.id); rows.push(row);
        }
        if (rows.length === total) return rows;
        if (!page.rows.length) throw new Error('The route inventory was incomplete. No route was changed.');
    }
    throw new Error('The route list exceeds the safe inspection limit. No route was changed.');
}

export async function saveVhostRoute(id: number | null, changes: { vhost?: number; path_prefix?: string; upstream?: number }, beforeWrite?: () => void): Promise<EdgeRouteRow> {
    return sanitizeEdgeRouteRow(await withFreshAuth(() => { beforeWrite?.(); return mojoSave<EdgeRouteRow>(EdgeRouteModel.endpoint, id, changes); }));
}

export async function deleteVhostRoute(id: number, beforeWrite?: () => void): Promise<void> {
    await withFreshAuth(() => { beforeWrite?.(); return mojoDelete(EdgeRouteModel.endpoint, id); });
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
