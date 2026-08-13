// Endpoint-scope registry — the declaration half of the scoped middle tier
// (board #1936). LEAF module: client.ts calls assertScoped from the unwrap
// boundary and scoped.ts builds the injection helpers on top, so this file
// imports neither (only types) — no cycle.
//
// Apps declare their scoped endpoint families ONCE at boot:
//   registerEndpointScope('/api/wallet/', { key: 'group' })
// The base admin registers none — it is deliberately no-group.
import type { FetchOpts } from './client';

export interface EndpointScope {
    /** Wire spelling for the scope param ('group', 'gid', 'player__group', …). */
    key?: string;
    /** Required scopes dev-throw when absent; optional ones only inject. */
    required?: boolean;
    /** Wire value for a group id — for spellings like `account=group-<pk>`. */
    format?: (groupId: number) => unknown;
}

export interface EndpointScopeRegistration {
    prefix: string;
    key: string;
    required: boolean;
    format?: (groupId: number) => unknown;
}

const registrations: EndpointScopeRegistration[] = [];

/** Declare an endpoint family's scope requirement. Longest prefix wins. */
export function registerEndpointScope(prefix: string | string[], scope: EndpointScope = {}): void {
    for (const p of Array.isArray(prefix) ? prefix : [prefix]) {
        const entry: EndpointScopeRegistration = {
            prefix: p,
            key: scope.key ?? 'group',
            required: scope.required ?? true,
            format: scope.format,
        };
        const existing = registrations.findIndex((r) => r.prefix === p);
        if (existing >= 0) registrations[existing] = entry;
        else registrations.push(entry);
    }
    registrations.sort((a, b) => b.prefix.length - a.prefix.length);
}

/** The registration governing a path, if any (longest prefix). */
export function endpointScopeFor(path: string): Readonly<EndpointScopeRegistration> | null {
    return registrations.find((r) => path.startsWith(r.prefix)) ?? null;
}

/** TEST/DEV ONLY: wipe registrations (module state survives HMR). */
export function resetEndpointScopes(): void {
    registrations.length = 0;
}

/** The wire value for a group id under a registration. */
export function endpointScopeValue(reg: EndpointScopeRegistration, groupId: number): unknown {
    return reg.format ? reg.format(groupId) : groupId;
}

/**
 * Dev-only tripwire, called by the transport on every request: a
 * registered-REQUIRED path whose params and body both lack the scope key is
 * the consumer audit's largest bug class — fail at the desk, not in
 * production data. `unscoped: true` is the explicit opt-out.
 */
export function assertScoped(path: string, opts: FetchOpts): void {
    if (!import.meta.env.DEV || opts.unscoped) return;
    const reg = endpointScopeFor(path);
    if (!reg || !reg.required) return;
    const inParams = opts.params != null && reg.key in opts.params;
    const body = opts.body;
    const inBody = typeof body === 'object' && body !== null && reg.key in (body as Record<string, unknown>);
    if (inParams || inBody) return;
    throw new Error(
        `[portal-mojo] ${path} is scope-registered ('${reg.key}' required via registerEndpointScope('${reg.prefix}')) `
        + `but the request carries no '${reg.key}' in params or body. Use useScopedQuery/mojoRpc/mojoScopedCall, `
        + `pass it explicitly, or mark the call { unscoped: true } if it is genuinely global.`,
    );
}
