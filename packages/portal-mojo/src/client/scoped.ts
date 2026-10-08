// Scoped call helpers — the injection half of the scoped middle tier
// (board #1936; the registry + dev tripwire live in endpoint-scope.ts).
// The model layer scopes reliably; everything hand-rolled with useQuery +
// mojoCall historically forgot the group param (the largest bug class in
// the first consumer audit). These helpers make the raw path as safe as
// the blessed one: the registered spelling is INJECTED (params on reads,
// body on mutations), the group id rides the query key, and a REQUIRED
// scope with no group resolves loudly, never silently.
//
// Where the group id comes from: an explicit `group` option always wins.
// Without one, a HOOK under a mounted GroupProvider reads the group context
// and nothing else — context first under a provider; the signal only without
// one. PLAIN functions have no context and read the active-group signal,
// which GroupProvider writes in the layout phase (#5918).
import { useContext } from 'react';
import { useQuery, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query';
import { mojoCall, type Envelope, type FetchOpts } from './client';
import type { Params } from './types';
import { withFreshAuth } from './auth';
import { getActiveGroupId } from './active-group';
import { GroupContext } from './group-context';
import { endpointScopeFor, endpointScopeValue } from './endpoint-scope';

export interface ScopedCallOpts extends FetchOpts {
    /** Explicit scope — beats the active-group signal. */
    group?: number | null;
}

/**
 * mojoCall with the registered scope injected (params for parameter-only
 * requests, body when a body is present). Throws in dev when a REQUIRED
 * scope cannot be resolved — an unscoped write to a scoped family must
 * never leave the machine.
 */
export function mojoScopedCall(path: string, opts: ScopedCallOpts = {}): Promise<Envelope> {
    const { group, ...rest } = opts;
    const reg = endpointScopeFor(path);
    if (!reg) return mojoCall(path, rest);
    const gid = group ?? getActiveGroupId();
    if (gid == null) {
        if (reg.required && import.meta.env.DEV) {
            throw new Error(`[portal-mojo] ${path} requires '${reg.key}' scope but no group is active and none was passed`);
        }
        return mojoCall(path, rest);
    }
    const value = endpointScopeValue(reg, gid);
    const scoped: FetchOpts = rest.body != null
        ? { ...rest, body: { [reg.key]: value, ...rest.body } }
        : { ...rest, params: { [reg.key]: value, ...(rest.params ?? {}) } as Params };
    return mojoCall(path, scoped);
}

/**
 * The scoped RPC verb: POST `body` under fresh auth with the scope injected.
 * Envelope failures reject in the transport (one boundary); action-shaped
 * `{key: payload}` saves on a record belong to mojoAction, which sends no
 * scope (the server binds the row's own group, #5923).
 */
export async function mojoRpc<T>(path: string, body: Record<string, unknown>, opts: Omit<ScopedCallOpts, 'body' | 'method'> = {}): Promise<T> {
    const out = await withFreshAuth(() => mojoScopedCall(path, { ...opts, method: 'POST', body }));
    return out.data as T;
}

export interface ScopedQueryOpts<T> extends Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'> {
    /** Map the unwrapped envelope; defaults to `env.data as T`. */
    read?: (env: Envelope) => T;
    /** Explicit scope — beats the group context. */
    group?: number | null;
}

/**
 * useQuery over a scoped GET: the registered spelling is injected, the
 * group id rides the query key (brand switches can never serve another
 * brand's cached rows — invalidation by `[path]` prefix keeps working),
 * and a REQUIRED scope with no active group renders the query DISABLED.
 * A disabled query has neither data nor error: state the wait honestly at
 * the call site rather than drawing an empty box.
 *
 * The group: an explicit `group` option, else the group context when a
 * GroupProvider is mounted, else (no provider at all) the active-group
 * signal. Under a provider the signal is never borrowed — a null context
 * group means no group (#5918). While the provider is still resolving its
 * group, a registered query, required or optional, is held DISABLED so
 * nothing goes out under the previous group or unscoped.
 */
export function useScopedQuery<T>(path: string, params: Params = {}, opts: ScopedQueryOpts<T> = {}): UseQueryResult<T> {
    const { read, group, enabled, ...rest } = opts;
    const groupCtx = useContext(GroupContext);
    const reg = endpointScopeFor(path);
    const gid = group !== undefined ? group : groupCtx ? groupCtx.group?.id ?? null : getActiveGroupId();
    const scopedParams: Params = reg && gid != null
        ? { [reg.key]: endpointScopeValue(reg, gid) as Params[string], ...params }
        : params;
    const scopeSatisfied = !reg || !reg.required || gid != null;
    // The provider is still resolving its group (boot, or a switch nothing
    // seeded): wait for it. An explicit `group` has nothing to wait for.
    const groupResolving = group === undefined && !!reg && !!groupCtx?.loading && groupCtx.group == null;
    return useQuery<T>({
        ...rest,
        queryKey: [path, params, gid ?? null],
        enabled: scopeSatisfied && !groupResolving && (enabled ?? true),
        queryFn: async () => {
            const env = await mojoCall(path, { params: scopedParams });
            return read ? read(env) : (env.data as T);
        },
    });
}
