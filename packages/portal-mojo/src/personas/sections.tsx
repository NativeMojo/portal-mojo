// PersonaSection — the product-surface section shape (routes + sidebar menu
// per persona), generalized from wmx-admin-v2's WmxSection. Deliberately NOT
// admin/core's AdminSection: that contract is frozen, and its guardedElement
// wraps AdminGlobalScope, which BLANKS the active group/member — correct for
// the framework admin, wrong for product surfaces where member grants count.
// Persona sections guard with plain fail-closed <Guarded> (member-aware) and
// opt into <RequiresGroup> for group-scoped screens.
import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import type { PermSpec } from '../client/model';
import { Guarded } from '../ui/Guarded';
import { RequiresGroup } from '../ui/RequiresGroup';
import type { MenuConfig, MenuItem } from '../ui/menu-registry';

/** Per-persona presentation overrides for a section. */
export interface PersonaSectionOwnership {
    /** Sidebar label override for this persona's menu. */
    label?: string;
    /** Divider (side-label) group override for the section's landing row. */
    navGroup?: string;
    /** Sort order within the persona's menu (default: registration order). */
    order?: number;
}

export interface PersonaSectionChild {
    /** Route path relative to the section basePath. */
    path: string;
    label: string;
    icon?: string;
    /** Labeled sidebar divider (side-label) this child sits under. */
    navGroup?: string;
    /** Any-of route gate — the ONLY gate on the child route. */
    permissions: PermSpec;
    element: ReactNode;
    /** Route-only (param routes, drill-ins) — no sidebar entry. */
    hidden?: boolean;
}

export interface PersonaSection {
    id: string;
    label: string;
    icon: string;
    /** Mount-relative, no leading slash (e.g. 'support'). */
    basePath: string;
    /** Any-of route gate for the section landing. */
    permissions: PermSpec;
    /** Wrap the landing AND every child in <RequiresGroup>. */
    groupScoped?: boolean;
    /**
     * Owning persona slugs — either a plain list, or a map carrying
     * per-persona presentation overrides (label/navGroup/order).
     */
    personas: string[] | Record<string, PersonaSectionOwnership>;
    /** Landing element; omitted → the section is children-only. */
    element?: ReactNode;
    children: PersonaSectionChild[];
}

/** Normalized [slug, overrides] pairs for a section's owners. */
export function sectionOwners(section: PersonaSection): Array<[string, PersonaSectionOwnership]> {
    return Array.isArray(section.personas)
        ? section.personas.map((slug) => [slug, {}])
        : Object.entries(section.personas);
}

// ── Section memory (route → owning personas) ──────────────────────────
// usePersonaFollowsRoute (PersonaProvider.tsx) derives a route's owners from
// the sections the app actually wired. Both builders below record their
// input here, so following-the-route needs no extra registration call.
const knownSections = new Map<string, PersonaSection>();

function rememberSections(sections: readonly PersonaSection[]): void {
    for (const s of sections) knownSections.set(s.id, s);
}

/** Personas owning `pathname` (basePath prefix match across known sections). */
export function personasOwningPath(pathname: string): string[] {
    const owners = new Set<string>();
    for (const s of knownSections.values()) {
        const base = `/${s.basePath}`;
        if (pathname !== base && !pathname.startsWith(`${base}/`)) continue;
        for (const [slug] of sectionOwners(s)) owners.add(slug);
    }
    return [...owners];
}

/** TEST/DEV ONLY: wipe remembered sections (module state survives HMR). */
export function resetPersonaSections(): void {
    knownSections.clear();
}

// ── Routes ────────────────────────────────────────────────────────────

function guardedPage(permissions: PermSpec, groupScoped: boolean | undefined, element: ReactNode): ReactNode {
    // Fail-closed Guarded is the security boundary; RequiresGroup inside it
    // so a denied user sees nothing, not a pick-a-group prompt.
    return (
        <Guarded permission={permissions} fallback={null}>
            {groupScoped ? <RequiresGroup>{element}</RequiresGroup> : element}
        </Guarded>
    );
}

/**
 * Hash-router route objects for persona sections. Every element is wrapped
 * in fail-closed <Guarded> (member grants count — no AdminGlobalScope);
 * `groupScoped` sections additionally wrap in <RequiresGroup>.
 */
export function personaSectionRoutes(sections: readonly PersonaSection[]): RouteObject[] {
    rememberSections(sections);
    return sections.map((s) => {
        const index = s.element != null
            ? [{ index: true as const, element: guardedPage(s.permissions, s.groupScoped, s.element) }]
            : [];
        return {
            path: s.basePath,
            children: [
                ...index,
                ...s.children.map((c) => ({
                    path: c.path,
                    element: guardedPage(c.permissions, s.groupScoped, c.element),
                })),
            ],
        };
    });
}

// ── Menus ─────────────────────────────────────────────────────────────

function sectionMenuEntries(s: PersonaSection, ownership: PersonaSectionOwnership): MenuItem[] {
    const kids = s.children.filter((c) => !c.hidden);
    const entries: Array<{ navGroup: string; item: MenuItem }> = [];
    if (s.element != null) {
        entries.push({
            navGroup: ownership.navGroup ?? kids[0]?.navGroup ?? s.label,
            item: {
                id: `${s.id}:home`,
                label: ownership.label ?? s.label,
                icon: s.icon,
                route: `/${s.basePath}`,
                permissions: s.permissions,
            },
        });
    }
    for (const c of kids) {
        entries.push({
            navGroup: c.navGroup ?? s.label,
            item: {
                id: `${s.id}:${c.path}`,
                label: c.label,
                icon: c.icon ?? s.icon,
                route: `/${s.basePath}/${c.path}`,
                permissions: c.permissions,
            },
        });
    }
    // navGroups render as divider rows (the side-label idiom); consecutive
    // duplicates collapse. SidebarNav drops dividers whose section is empty.
    const out: MenuItem[] = [];
    let current: string | null = null;
    for (const e of entries) {
        if (e.navGroup !== current) {
            out.push({ divider: e.navGroup });
            current = e.navGroup;
        }
        out.push(e.item);
    }
    return out;
}

/**
 * ONE MenuConfig per persona slug found across `sections` — named
 * `persona:<slug>`, scoped via `personas: [slug]` so menu resolution treats
 * it as eligible only while that persona is active. Items carry the
 * section/child permissions, so itemVisible stays fail-closed regardless of
 * the active persona (a persona never widens visibility).
 *
 * Register the result ONCE at boot: `registerMenus(personaSectionsMenu(...))`.
 * The active persona is a resolution INPUT (ui/active-persona.ts) — never
 * re-register menus to switch personas.
 */
export function personaSectionsMenu(sections: readonly PersonaSection[]): MenuConfig[] {
    rememberSections(sections);
    const bySlug = new Map<string, Array<{ order: number; index: number; section: PersonaSection; ownership: PersonaSectionOwnership }>>();
    sections.forEach((section, index) => {
        for (const [slug, ownership] of sectionOwners(section)) {
            const list = bySlug.get(slug) ?? [];
            list.push({ order: ownership.order ?? index, index, section, ownership });
            bySlug.set(slug, list);
        }
    });
    const configs: MenuConfig[] = [];
    for (const [slug, owned] of bySlug) {
        owned.sort((a, b) => a.order - b.order || a.index - b.index);
        configs.push({
            name: `persona:${slug}`,
            personas: [slug],
            items: owned.flatMap(({ section, ownership }) => sectionMenuEntries(section, ownership)),
        });
    }
    return configs;
}
