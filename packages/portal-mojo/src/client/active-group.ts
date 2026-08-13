// Active-group signal — GroupProvider OWNS the active group (context stays
// the React-side source of truth); this cell mirrors it so plain functions
// (mojoRpc, mojoScopedCall, mojoAction's scope injection) can resolve the
// current scope without threading an id through every call site. Same
// subscribable-module-state idiom as ui/active-persona.ts (#1609).
//
// Do NOT read localStorage's `active_group_id` here instead — the URL
// `?group=` param BEATS the stored id (group.tsx resolution order), and only
// the provider computes that. The signal is written from the provider's
// activation path, so it always reflects the resolved truth.

let activeGroupId: number | null = null;
const listeners = new Set<() => void>();

/** Written by GroupProvider only. */
export function setActiveGroupSignal(id: number | null): void {
    if (id === activeGroupId) return;
    activeGroupId = id;
    for (const cb of listeners) cb();
}

export function getActiveGroupId(): number | null {
    return activeGroupId;
}

export function subscribeActiveGroup(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}
