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
import type { Group } from '../client/group-context';

export interface MenuItem {
    /** Section label row (the side-label idiom). Mutually exclusive with route. */
    divider?: string;
    label?: string;
    icon?: string;
    /** Absolute route within the hash router, e.g. '/users'. */
    route?: string;
    children?: MenuItem[];
    /** Permission name(s) required to see the item (ANY-of; member-aware). */
    permissions?: string | string[];
    /** Only visible when the active group's kind matches. */
    requiresGroupKind?: string | string[];
    badge?: { text: string; tone?: 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'primary' };
}

export interface MenuConfig {
    name: string;
    /**
     * null/undefined → a global menu. A kind string/array scopes the menu to
     * active groups of that kind; 'any' matches every kind (used as the
     * fallback group menu).
     */
    groupKind?: string | string[] | 'any' | null;
    items: MenuItem[];
}

export interface MenuContext {
    me: Me | null;
    member: MemberLike | null;
    group: Group | null;
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

/** Route match: exact for '/', prefix (param-aware) otherwise. */
export function routesMatch(itemRoute: string, pathname: string): boolean {
    return matchPath({ path: itemRoute, end: itemRoute === '/' }, pathname) != null;
}

/** Permission + group-kind visibility for one item (dividers always show). */
export function itemVisible(item: MenuItem, ctx: MenuContext): boolean {
    if (item.divider) return true;
    if (item.permissions && !hasPermission(ctx.me, item.permissions, ctx.member)) return false;
    if (item.requiresGroupKind) {
        if (!groupKindMatches(item.requiresGroupKind, ctx.group?.kind)) return false;
    }
    return true;
}

function menuHasVisibleItems(menu: MenuConfig, ctx: MenuContext): boolean {
    return menu.items.some((item) => !item.divider && itemVisible(item, ctx));
}

/** Does this menu own the route (visible items + children considered)? */
export function menuContainsRoute(menu: MenuConfig, pathname: string, ctx: MenuContext): boolean {
    const walk = (items: MenuItem[]): boolean => items.some((item) => {
        if (!itemVisible(item, ctx)) return false;
        if (item.route && routesMatch(item.route, pathname)) return true;
        return item.children ? walk(item.children) : false;
    });
    return walk(menu.items);
}

/** Is a group menu eligible at all under the current context? */
function groupMenuEligible(menu: MenuConfig, ctx: MenuContext): boolean {
    if (!menu.groupKind) return true;
    return ctx.group != null && groupKindMatches(menu.groupKind, ctx.group.kind);
}

/**
 * The active menu for (route, context) — autoSwitchToMenuForRoute + the
 * _applyFallbackMenu chain, as one pure resolution.
 */
export function resolveActiveMenu(pathname: string, ctx: MenuContext): MenuConfig | null {
    // 1. Route containment, registration order.
    for (const menu of menus.values()) {
        if (!groupMenuEligible(menu, ctx)) continue;
        if (menuContainsRoute(menu, pathname, ctx)) return menu;
    }
    // 2. defaultMenu.
    if (defaultMenuName) {
        const dm = menus.get(defaultMenuName);
        if (dm) return dm;
    }
    // 3. First non-group menu with visible items; else first non-group.
    let firstNonGroup: MenuConfig | null = null;
    for (const menu of menus.values()) {
        if (menu.groupKind) continue;
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
