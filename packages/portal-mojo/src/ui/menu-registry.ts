// Sidebar menu engine — the registry + resolution logic, ported from
// web-mojo Sidebar.js (menus Map, autoSwitchToMenuForRoute, menuContainsRoute,
// getGroupMenu/_groupKindMatches, _applyFallbackMenu, _menuHasVisibleItems).
//
// Menus are DATA in a registry; the sidebar renders whichever one is active.
// web-mojo kept mutable active-menu state driven by events; here the active
// menu is a PURE FUNCTION of (route, active group, me):
//   1. the first registered menu whose visible items contain the route —
//      group menus are eligible only when a kind-matched group is active
//      (web-mojo skipped them only when NO group was active; requiring the
//      kind match too is a deliberate tightening)
//   2. otherwise the fallback chain: defaultMenu → first non-group menu with
//      at least one visible item → first non-group menu
// Entering a group menu happens by NAVIGATION (e.g. the app routes into the
// group's home on switcher selection) — no hidden menu state to desync.
//
// Admin sections contribute menus through this same registry (see
// portal-mojo/admin adminSectionsMenu) — sections never own the sidebar.
import { matchPath } from 'react-router-dom';
import { hasPermission, type Me, type MemberLike } from '../client/me';
import type { PermSpec } from '../client/model';
import type { Group } from '../client/group-context';

export interface MenuItem {
    /** Stable identity for route-less parents (accordion state, aria ids). */
    id?: string;
    /** Section label row (the side-label idiom). Mutually exclusive with route. */
    divider?: string;
    label?: string;
    /** Extra quick-navigation terms that are never rendered. */
    keywords?: string[];
    icon?: string;
    /** Absolute route within the hash router, e.g. '/users'. */
    route?: string;
    children?: MenuItem[];
    /** Permission name(s) required to see the item (ANY-of; member-aware). */
    permissions?: string | string[];
    /**
     * Additional permission clauses: ANY within one clause, AND across clauses.
     * `permissions`, when present, is evaluated as one more required clause.
     */
    permissionClauses?: PermSpec[];
    /** Only visible when the active group's kind matches. */
    requiresGroupKind?: string | string[];
    badge?: { text: string; tone?: 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'primary' };
    /**
     * On a parent with children: `'flat'` hoists the children to top level
     * as divider-grouped rows (each child's `group` labels its divider; a
     * child without one falls to the parent's label). The parent's own
     * `route`, when present, hoists first as an exact-matched home row.
     * Flattening is presentation-only (`flattenMenuItems`, applied by
     * SidebarNav) — route resolution walks the original tree.
     */
    presentation?: 'flat';
    /** Divider label this item sorts under when its section is flat. */
    group?: string;
    /** End-match this item's route (no prefix lighting). Stamped on hoisted
     *  flat home rows so they don't steal `activeKey` from deep routes. */
    exact?: boolean;
}

export interface MenuConfig {
    name: string;
    /** Shell metadata. Omitted group menus infer `group`; others infer `global`. */
    scope?: 'admin' | 'group' | 'account' | 'global';
    /** Route-less parents stay static unless a consumer explicitly opts in. */
    presentation?: 'static' | 'accordion';
    /**
     * null/undefined → a global menu. A kind string/array scopes the menu to
     * active groups of that kind; 'any' matches every kind (used as the
     * fallback group menu).
     */
    groupKind?: string | string[] | 'any' | null;
    /**
     * Persona slugs this menu belongs to. Unset → persona-agnostic (eligible
     * under every persona and in apps that use none). Set → eligible only
     * while `MenuContext.persona` matches, and the first registered match is
     * that persona's default menu in the fallback chain. Menus stay declared
     * ONCE at import time — the persona is a resolution input, never
     * re-registration (see portal-mojo/personas).
     */
    personas?: string[];
    items: MenuItem[];
}

export interface MenuContext {
    me: Me | null;
    member: MemberLike | null;
    group: Group | null;
    /** Active persona slug, when the app runs portal-mojo/personas. */
    persona?: string | null;
}

// ── Registry (insertion-ordered; subscribable so late registration — lazy
// admin sections, HMR — re-renders subscribers) ───────────────────────

const menus = new Map<string, MenuConfig>();
let defaultMenuName: string | null = null;
let version = 0;
const listeners = new Set<() => void>();

function bump(): void {
    version += 1;
    for (const cb of listeners) cb();
}

/** Register (or replace) one menu. Registration order is resolution order. */
export function registerMenu(config: MenuConfig): void {
    menus.set(config.name, config);
    bump();
}

export function registerMenus(configs: MenuConfig[]): void {
    for (const c of configs) menus.set(c.name, c);
    bump();
}

/** The menu the fallback chain prefers when no route matches. */
export function setDefaultMenu(name: string): void {
    defaultMenuName = name;
    bump();
}

export function getMenus(): ReadonlyMap<string, MenuConfig> {
    return menus;
}

export function subscribeMenus(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

export function menusVersion(): number {
    return version;
}

// ── Matching + visibility (pure) ──────────────────────────────────────

export function groupKindMatches(menuKind: MenuConfig['groupKind'], kind: string | null | undefined): boolean {
    if (!menuKind || !kind) return false;
    if (menuKind === 'any') return true;
    if (Array.isArray(menuKind)) return menuKind.includes(kind);
    return menuKind === kind;
}

/** Route match: exact for '/' and `exact` items, prefix (param-aware) otherwise. */
export function routesMatch(itemRoute: string, pathname: string, exact = false): boolean {
    return matchPath({ path: itemRoute, end: exact || itemRoute === '/' }, pathname) != null;
}

/** Permission + group-kind visibility for one item (dividers always show). */
export function itemVisible(item: MenuItem, ctx: MenuContext): boolean {
    if (item.divider) return true;
    if (item.permissions && !hasPermission(ctx.me, item.permissions, ctx.member)) return false;
    if (item.permissionClauses?.some((clause) => !hasPermission(ctx.me, clause, ctx.member))) return false;
    if (item.requiresGroupKind) {
        if (!groupKindMatches(item.requiresGroupKind, ctx.group?.kind)) return false;
    }
    return true;
}

/** Visible immediate children, shared by route resolution and SidebarNav. */
export function visibleMenuChildren(item: MenuItem, ctx: MenuContext): MenuItem[] {
    return (item.children ?? []).filter((child) => itemVisible(child, ctx));
}

/** Does this item's visible subtree own the current route? */
export function itemContainsRoute(item: MenuItem, pathname: string, ctx: MenuContext): boolean {
    if (!itemVisible(item, ctx)) return false;
    if (item.route && routesMatch(item.route, pathname, item.exact)) return true;
    return visibleMenuChildren(item, ctx).some((child) => itemContainsRoute(child, pathname, ctx));
}

/** Effective scope with backward-compatible groupKind inference. */
export function menuScope(menu: MenuConfig): NonNullable<MenuConfig['scope']> {
    return menu.scope ?? (menu.groupKind ? 'group' : 'global');
}

function menuHasVisibleItems(menu: MenuConfig, ctx: MenuContext): boolean {
    return menu.items.some((item) => !item.divider && itemVisible(item, ctx));
}

/** Does this menu own the route (visible items + children considered)? */
export function menuContainsRoute(menu: MenuConfig, pathname: string, ctx: MenuContext): boolean {
    return menu.items.some((item) => itemContainsRoute(item, pathname, ctx));
}

/** Is a menu persona-eligible? Persona-scoped menus need a matching persona. */
function personaMenuEligible(menu: MenuConfig, ctx: MenuContext): boolean {
    if (!menu.personas || menu.personas.length === 0) return true;
    return ctx.persona != null && menu.personas.includes(ctx.persona);
}

/** Is a group menu eligible at all under the current context? */
function groupMenuEligible(menu: MenuConfig, ctx: MenuContext): boolean {
    if (!menu.groupKind) return true;
    return ctx.group != null && groupKindMatches(menu.groupKind, ctx.group.kind);
}

function menuEligible(menu: MenuConfig, ctx: MenuContext): boolean {
    return personaMenuEligible(menu, ctx) && groupMenuEligible(menu, ctx);
}

/**
 * The active menu for (route, context) — autoSwitchToMenuForRoute + the
 * _applyFallbackMenu chain, as one pure resolution.
 */
export function resolveActiveMenu(pathname: string, ctx: MenuContext): MenuConfig | null {
    // 1. Route containment, registration order. Persona- and group-scoped
    //    menus compete only while eligible, so two personas may both carry
    //    /players and the active persona's menu wins deterministically.
    for (const menu of menus.values()) {
        if (!menuEligible(menu, ctx)) continue;
        if (menuContainsRoute(menu, pathname, ctx)) return menu;
    }
    // 2a. The active persona's own menu (first registered match, preferring
    //     one with visible items) beats the global default.
    if (ctx.persona != null) {
        let firstPersonaMenu: MenuConfig | null = null;
        for (const menu of menus.values()) {
            if (!menu.personas?.includes(ctx.persona)) continue;
            if (!groupMenuEligible(menu, ctx)) continue;
            firstPersonaMenu ??= menu;
            if (menuHasVisibleItems(menu, ctx)) return menu;
        }
        if (firstPersonaMenu) return firstPersonaMenu;
    }
    // 2b. defaultMenu.
    if (defaultMenuName) {
        const dm = menus.get(defaultMenuName);
        if (dm && personaMenuEligible(dm, ctx)) return dm;
    }
    // 3. First non-group, persona-eligible menu with visible items; else the
    //    first such menu at all.
    let firstNonGroup: MenuConfig | null = null;
    for (const menu of menus.values()) {
        if (menu.groupKind) continue;
        if (!personaMenuEligible(menu, ctx)) continue;
        firstNonGroup ??= menu;
        if (menuHasVisibleItems(menu, ctx)) return menu;
    }
    return firstNonGroup;
}

/** The kind-matched group menu (exact/array match beats 'any') — getGroupMenu. */
export function resolveGroupMenu(group: Group): MenuConfig | null {
    let anyMenu: MenuConfig | null = null;
    for (const menu of menus.values()) {
        if (!menu.groupKind) continue;
        if (menu.groupKind === 'any') {
            anyMenu ??= menu;
        } else if (groupKindMatches(menu.groupKind, group.kind)) {
            return menu;
        }
    }
    return anyMenu;
}

/** TEST/DEV ONLY: wipe the registry (module state survives HMR reloads). */
export function resetMenus(): void {
    menus.clear();
    defaultMenuName = null;
    bump();
}

// ── Flat sections (board #1606) ───────────────────────────────────────
// wmx-admin-v2's persona lenses needed one section's children rendered as
// FLAT top-level rows under labeled dividers (no accordion); it built the
// hoisting app-side, and the personas layer re-implemented it again. The
// registry owns the shape once now. Semantics ported from wmx menus.ts
// flatSectionItems: divider on group CHANGE (run semantics — a repeated
// non-consecutive label is two runs), nested children hoist as-is (one
// accordion among flat rows) and RESET the run, icons fall back to the
// parent's, and a final static pass drops a divider immediately followed
// by another (keep the later). Divergences from wmx, both deliberate:
// gates compose section AND child (a child's own permissions never bypass
// the section gate), and the hoisted home row keeps the parent's label
// (no auto-"Overview").

/**
 * Presentation-only flatten applied by SidebarNav before rendering. Items
 * without `presentation: 'flat'` pass through unchanged — the grouped
 * admin nav and the personas layer's pre-flattened menus are untouched.
 * Route RESOLUTION always walks the original tree, so active-menu
 * selection can never disagree with what is rendered.
 */
export function flattenMenuItems(items: MenuItem[], ctx: MenuContext): MenuItem[] {
    if (!items.some((item) => item.presentation === 'flat')) return items;
    const out: MenuItem[] = [];
    for (const item of items) {
        if (item.presentation !== 'flat' || !item.children?.length) {
            out.push(item);
            continue;
        }
        // Section gate: an invisible flat parent drops WHOLE — the same
        // section AND route composition itemContainsRoute applies.
        if (!itemVisible(item, ctx)) continue;
        const parentId = item.id ?? item.label ?? 'flat';
        let run: string | null = null;
        let dividerSeq = 0;
        const emit = (group: string) => {
            if (run === group) return;
            run = group;
            out.push({ id: `${parentId}:grp:${group}:${dividerSeq++}`, divider: group });
        };
        if (item.route) {
            emit(item.group ?? item.children[0]?.group ?? item.label ?? '');
            const { children: _c, presentation: _p, ...home } = item;
            out.push({ ...home, exact: true });
        }
        for (const child of item.children) {
            if (child.divider) continue; // flat sections group via `group`, not inline dividers
            if (child.children?.length) {
                // Nested group: hoist as ONE accordion among the flat rows,
                // and reset the run so the next flat row re-emits its divider.
                out.push({ ...child, icon: child.icon ?? item.icon });
                run = null;
                continue;
            }
            emit(child.group ?? item.label ?? '');
            out.push({
                ...child,
                icon: child.icon ?? item.icon,
                keywords: child.group ? [...(child.keywords ?? []), child.group] : child.keywords,
            });
        }
    }
    // Static hygiene: a divider immediately followed by another divider is
    // dead — keep the later. SidebarNav's visibleRootItems remains the
    // authoritative visibility-aware collapse at render time.
    return out.filter((item, i) => !(item.divider && out[i + 1]?.divider));
}
