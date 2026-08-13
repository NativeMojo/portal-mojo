// Route-error helpers (board #1604) — deliberately ROUTER-FREE so the
// verify script can ssrLoadModule this file without pulling react-router
// into the node harness. The React card lives in RouteError.tsx.

/**
 * Render whatever was thrown. `String(err)` collapses a plain object to
 * "[object Object]", which hides exactly the errors that matter most here —
 * rejected API payloads and router ErrorResponses are thrown as objects,
 * not Errors. Prefer a message + stack, then a JSON dump, then coercion.
 * Total: never throws (circular-safe, symbol-safe).
 */
export function describeRouteError(err: unknown): string {
    if (err instanceof Error) return err.stack ? `${err.message}\n\n${err.stack}` : err.message;
    if (err && typeof err === 'object') {
        // react-router ErrorResponse (a thrown Response) and mojo error bodies.
        const o = err as Record<string, unknown>;
        const head = [o.status, o.statusText].filter(Boolean).join(' ');
        // Strings only — a non-string error/message would join as "[object Object]".
        const body = typeof o.data === 'string' ? o.data
            : typeof o.error === 'string' ? o.error
                : typeof o.message === 'string' ? o.message
                    : null;
        try {
            const dump = JSON.stringify(err, null, 2);
            if (dump && dump !== '{}') return [head, body, dump].filter(Boolean).join('\n');
        } catch {
            /* circular — fall through */
        }
        if (head || body) return [head, body].filter(Boolean).join('\n');
        // Unserializable AND headless (circular, no status/message): name the
        // keys — String(err) here would be the "[object Object]" this helper
        // exists to prevent.
        return `[unserializable object] keys: ${Object.keys(o).join(', ')}`;
    }
    return String(err);
}

/**
 * Structural `isRouteErrorResponse` + status check — the shape react-router
 * throws for unmatched routes, without importing react-router here.
 */
export function isNotFoundError(err: unknown): boolean {
    if (err == null || typeof err !== 'object') return false;
    const o = err as Record<string, unknown>;
    return typeof o.status === 'number' && o.status === 404
        && typeof o.statusText === 'string' && 'data' in o;
}

/**
 * A Vite dynamic-import failure (stale deploy, network drop mid-navigation).
 * Everything else — including a page render that happens to throw a
 * TypeError — is NOT a chunk error; when in doubt this returns false, so the
 * caller rethrows and the route-level card shows the REAL message instead of
 * a wrong "bundle unavailable" Retry card.
 */
export function isChunkLoadError(err: unknown): boolean {
    if (err == null) return false;
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
    return /dynamically imported module|Failed to fetch dynamically|Importing a module script failed|error loading dynamically imported/i.test(message);
}
