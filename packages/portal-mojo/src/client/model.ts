// defineModel — the definition layer that replaces web-mojo's Model/Collection
// classes (src/core/Model.js, Collection.js, models/*.js).
//
// A model is a typed, STATELESS definition: endpoint + forms + permissions +
// actions, plus hooks bound to that endpoint. TanStack Query owns every byte
// of fetched data and all reactivity — the attribute stores, change events,
// dirty tracking, request dedup/abort/rate-limiting that Model/Collection
// implemented by hand are exactly the machinery Query already provides.
// Nothing here holds row data; there is ONE ownership system.
//
// Cache keys deliberately match the generic hooks (hooks.ts):
//   list  → [endpoint, params]        (useModelList)
//   one   → [endpoint, 'one', id]     (useModel)
// so ModelTable, GroupSwitcher and model-defined hooks share one cache and
// one invalidation root ([endpoint]).
//
// POST_SAVE_ACTIONS (django-mojo mojo/models/rest.py on_rest_save): an action
// is a key in the save body — `POST <endpoint>/<id>` `{disable: {...}}` — the
// backend saves any plain fields first, then runs `on_action_<key>(value)`.
// The response is either the refreshed record (handler returned nothing) or
// an action-specific payload (e.g. User.revoke_sessions → {status, message}).
// Which one is DECLARED per action (`response: 'row' | 'payload'`), never
// sniffed from the body — the resp.data heuristics class ends at this layer.
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { mojoCall, mojoDelete, mojoGet, mojoSave, type Envelope } from './client';
import { withFreshAuth } from './auth';
import { useModel, useModelList } from './hooks';
import type { ModelForm, Params } from './types';

/** Permission spec as useCan/Guarded/hasPermission accept: one name, or any-of list. */
export type PermSpec = string | string[];

export interface ModelActionDef {
    /** Save-body key for the POST; defaults to the action's name in the map. */
    key?: string;
    /** UI gate for offering the action (useCan). The server stays authoritative. */
    permissions?: PermSpec;
    /**
     * 'row' (default): the backend answers with the refreshed record → written
     * through to the one-record cache. 'payload': the backend answers with an
     * action-specific body → returned verbatim, caches invalidated only.
     */
    response?: 'row' | 'payload';
}

export interface ModelConfig<T> {
    /** Singular slug ('user') — labels, export filenames, devtools. */
    name: string;
    /** REST collection endpoint ('/api/account/user'). */
    endpoint: string;
    /**
     * UI permission gates by convention: view / manage / create / delete.
     * Carried metadata — consumers fold them through useCan; the backend
     * remains the authority on every request.
     */
    permissions?: Record<string, PermSpec>;
    /** Named form configs (ADD_FORM/EDIT_FORM heritage) — plain data for ui. */
    forms?: Record<string, ModelForm>;
    /** The POST_SAVE_ACTIONS the backend RestMeta declares for this model. */
    actions?: Record<string, ModelActionDef>;
    /** Normalize/allowlist list params before they become a query key or request. */
    normalizeListParams?: (params: Params) => Params;
    /** Strip fields that must never enter Query or Mutation cache. */
    sanitizeRow?(row: T): T;
}

export interface SaveVars {
    /** null → create (POST collection); id → update (POST detail). */
    id: number | string | null;
    changes: Record<string, unknown>;
}

export interface ActionVars {
    id: number | string;
    /**
     * The action's argument body — `{reason, note}` for disable, omitted for
     * argument-less actions ({} is sent; handlers treat value as a dict).
     */
    payload?: unknown;
}

export interface ActionOutcome<T> {
    /** The refreshed record, for `response: 'row'` actions; null otherwise. */
    row: T | null;
    /** The unwrapped envelope — message + any action-specific fields. */
    body: Envelope;
}

export interface ModelDef<T extends { id: number | string }> {
    name: string;
    endpoint: string;
    permissions: Record<string, PermSpec>;
    forms: Record<string, ModelForm>;
    actions: Record<string, ModelActionDef>;
    normalizeListParams?: (params: Params) => Params;
    sanitizeRow?(row: T): T;
    /** Query-key builders — for targeted setQueryData/invalidate in app code. */
    keys: {
        root: readonly [string];
        list: (params: Params) => readonly [string, Params];
        one: (id: number | string) => readonly [string, 'one', number | string];
    };
    /** Server-driven list under the shared cache key (keepPreviousData). */
    useList: (params?: Params) => ReturnType<typeof useModelList<T>>;
    /** One record; disabled while id is null. */
    useOne: (id: number | string | null) => ReturnType<typeof useModel<T>>;
    /** Create/update mutation. Write-through + invalidate. Rejects on failure. */
    useSave: () => ReturnType<typeof useMutation<T, Error, SaveVars>>;
    /** DELETE mutation; drops the one-record cache and invalidates lists. */
    useDelete: () => ReturnType<typeof useMutation<void, Error, { id: number | string }>>;
    /** Mutation for one declared POST_SAVE_ACTION. Throws on an undeclared name. */
    useAction: (action: string) => ReturnType<typeof useMutation<ActionOutcome<T>, Error, ActionVars>>;
    /**
     * Imperative fetch through the query cache (Collection.fetchOne heritage):
     * same key + fn as useOne, so it dedupes with mounted hooks and warms the
     * cache for them. Rejects on failure (fetchOne's null-swallow is gone).
     */
    fetchOne: (qc: QueryClient, id: number | string) => Promise<T>;
    /** Invalidate everything cached under this model's endpoint. */
    invalidate: (qc: QueryClient) => Promise<void>;
}

export function defineModel<T extends { id: number | string }>(config: ModelConfig<T>): ModelDef<T> {
    const { endpoint } = config;
    const actions = config.actions ?? {};
    const normalizeListParams = config.normalizeListParams;
    const sanitizeRow = config.sanitizeRow;

    const keys = {
        root: [endpoint] as const,
        list: (params: Params) => [
            endpoint,
            normalizeListParams ? normalizeListParams(params) : params,
        ] as const,
        one: (id: number | string) => [endpoint, 'one', id] as const,
    };

    return {
        name: config.name,
        endpoint,
        permissions: config.permissions ?? {},
        forms: config.forms ?? {},
        actions,
        normalizeListParams,
        sanitizeRow,
        keys,

        useList: (params: Params = {}) => {
            const safeParams = normalizeListParams ? normalizeListParams(params) : params;
            return useModelList<T>(endpoint, safeParams, { sanitizeRow });
        },

        useOne: (id: number | string | null) => useModel<T>(endpoint, id, sanitizeRow),

        useSave: () => {
            const qc = useQueryClient();
            return useMutation({
                mutationFn: async ({ id, changes }: SaveVars) => {
                    const row = await withFreshAuth(() => mojoSave<T>(endpoint, id, changes));
                    return sanitizeRow ? sanitizeRow(row) : row;
                },
                onSuccess: (row) => {
                    // The response body is the server-authoritative record —
                    // paint it immediately, then let invalidation re-sort and
                    // re-filter the lists.
                    qc.setQueryData(keys.one(row.id), row);
                    void qc.invalidateQueries({ queryKey: keys.root });
                },
            });
        },

        useDelete: () => {
            const qc = useQueryClient();
            return useMutation({
                mutationFn: ({ id }: { id: number | string }) => mojoDelete(endpoint, id),
                onSuccess: (_res, { id }) => {
                    qc.removeQueries({ queryKey: keys.one(id) });
                    void qc.invalidateQueries({ queryKey: keys.root });
                },
            });
        },

        useAction: (action: string) => {
            const def = actions[action];
            if (!def) {
                // Programmer error — fail loud at the call site, not with a
                // request the backend will ignore (dev-throw policy).
                throw new Error(`defineModel(${config.name}): unknown action "${action}" — declare it in the model's actions map`);
            }
            const bodyKey = def.key ?? action;
            const returnsRow = (def.response ?? 'row') === 'row';
            const qc = useQueryClient();
            return useMutation({
                mutationFn: async ({ id, payload = {} }: ActionVars): Promise<ActionOutcome<T>> => {
                    const body = await withFreshAuth(() => mojoCall(`${endpoint}/${id}`, {
                        method: 'POST',
                        body: { [bodyKey]: payload },
                    }));
                    const row = returnsRow ? (body.data as T) : null;
                    return { row: row && sanitizeRow ? sanitizeRow(row) : row, body };
                },
                onSuccess: (outcome, { id }) => {
                    if (outcome.row) qc.setQueryData(keys.one(id), outcome.row);
                    void qc.invalidateQueries({ queryKey: keys.root });
                },
            });
        },

        fetchOne: (qc: QueryClient, id: number | string) =>
            qc.fetchQuery({
                queryKey: keys.one(id),
                queryFn: async () => {
                    const row = await mojoGet<T>(endpoint, id);
                    return sanitizeRow ? sanitizeRow(row) : row;
                },
            }),

        invalidate: (qc: QueryClient) => qc.invalidateQueries({ queryKey: keys.root }),
    };
}
