// Persona registry — personas are DATA declared once at boot, exactly like
// menus (ui/menu-registry.ts). A persona is a working identity ("hat") the
// signed-in user operates under; it drives PRESENTATION only — which menu is
// active, which density the shell renders, where "home" is. It never grants
// or gates a permission: Guarded/hasPermission remain the security boundary,
// and hasPermission knows nothing about personas by design.
//
// Two flavors, one type:
//   · hat-style  — no `gate`: available to every authenticated user (a user
//     choosing how they want to look at the product).
//   · role-style — `gate` (any-of PermSpec): the persona appears only for
//     users who hold one of its gate keys. Gate on SIGNATURE keys held by
//     exactly one preset (see audit.ts), or shared capability keys will leak
//     personas across roles.
import { hasPermission, type Me } from '../client/me';
import type { PermSpec } from '../client/model';

export interface PersonaDef {
    slug: string;
    label: string;
    icon?: string;
    /**
     * 'brand' — a persona working inside the active group/brand.
     * 'admin' — operator-of-the-operators surfaces (cross-group/framework);
     * apps typically render these in a visually distinct switcher group.
     */
    tone?: 'brand' | 'admin';
    /** OPTIONAL any-of gate. Absent → available to every authenticated user. */
    gate?: PermSpec;
    /**
     * Grant bundle (preset) — optional plumbing for team UIs (phase B).
     * `categories` are NAMES of categories the app already registered via
     * registerPermissionCategories (they expand through the rollup map);
     * `keys` are granular permission names. Hats-only consumers omit it.
     */
    grants?: { categories?: string[]; keys?: string[] };
    /** The persona's landing route (hash-router absolute path). */
    home: string;
    /** Shell density stamped as <html data-density>; default 'dense'. */
    density?: 'simple' | 'dense';
}

// Subscribable module state — same idiom as menu-registry, so providers and
// HMR-late definitions re-render subscribers.
let personas: PersonaDef[] = [];
let version = 0;
const listeners = new Set<() => void>();

function bump(): void {
    version += 1;
    for (const cb of listeners) cb();
}

/**
 * Declare the app's personas. REPLACES any previous definition (declared
 * once at boot; an HMR re-run re-declares the same list safely). Duplicate
 * slugs within the list are ignored WITH a console.warn — the first
 * declaration wins, never silently.
 */
export function definePersonas(defs: PersonaDef[]): void {
    const seen = new Set<string>();
    const accepted: PersonaDef[] = [];
    for (const def of defs) {
        if (seen.has(def.slug)) {
            console.warn(`definePersonas: duplicate persona slug "${def.slug}" ignored`);
            continue;
        }
        seen.add(def.slug);
        accepted.push(def);
    }
    personas = accepted;
    bump();
}

export function getPersonas(): readonly PersonaDef[] {
    return personas;
}

export function getPersona(slug: string): PersonaDef | undefined {
    return personas.find((p) => p.slug === slug);
}

export function subscribePersonas(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

export function personasVersion(): number {
    return version;
}

/**
 * The personas this user may operate as. null me (anonymous / still loading)
 * → none; ungated personas are always included for an authenticated user;
 * gated personas require the any-of gate to pass. Member context is not
 * consulted — a persona is a user-level identity, not a group grant.
 */
export function availablePersonas(me: Me | null): PersonaDef[] {
    if (!me) return [];
    return personas.filter((p) => !p.gate || hasPermission(me, p.gate));
}

/** The persona's landing route. Unknown slug → console.warn + '/'. */
export function personaHome(slug: string): string {
    const def = getPersona(slug);
    if (!def) {
        console.warn(`personaHome: unknown persona "${slug}" — falling back to '/'`);
        return '/';
    }
    return def.home;
}
