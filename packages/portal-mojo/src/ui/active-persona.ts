// Active-persona signal — the one mutable cell connecting the personas
// module (which OWNS the value via PersonaProvider) to menu resolution
// (which CONSUMES it as a pure input). Lives in ui/ so SidebarNav can read
// it without importing portal-mojo/personas (that module imports ui/, and a
// reverse import would cycle). Apps that don't run personas never touch it:
// the signal stays null and persona-scoped menus are simply never eligible.
//
// Same subscribable-module-state idiom as menu-registry.ts — no hidden
// context, useSyncExternalStore-friendly.

let activePersona: string | null = null;
let version = 0;
const listeners = new Set<() => void>();

/** Written by PersonaProvider only. Idempotent writes don't notify. */
export function setActivePersona(slug: string | null): void {
    if (slug === activePersona) return;
    activePersona = slug;
    version += 1;
    for (const cb of listeners) cb();
}

export function getActivePersona(): string | null {
    return activePersona;
}

export function subscribeActivePersona(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

export function activePersonaVersion(): number {
    return version;
}
