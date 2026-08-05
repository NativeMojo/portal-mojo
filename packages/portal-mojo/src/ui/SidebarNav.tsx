// SidebarNav — renders the ACTIVE menu from the registry (menu-registry.ts).
// The app shell keeps brand/switcher/footer; this component owns only the
// nav: dividers as side-labels, permission/kind-filtered items, children
// indented, active-state walk (a matching child lights its parent too).
import { useContext, useSyncExternalStore } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useMe } from '../client/me';
import { GroupContext } from '../client/group-context';
import {
    itemVisible, menusVersion, resolveActiveMenu, routesMatch, subscribeMenus,
    type MenuConfig, type MenuContext, type MenuItem,
} from './menu-registry';

/** The active menu + context, derived — no menu state to desync. */
export function useSidebarMenu(): { menu: MenuConfig | null; ctx: MenuContext } {
    useSyncExternalStore(subscribeMenus, menusVersion, menusVersion);
    const { pathname } = useLocation();
    const { data: me } = useMe();
    const groupCtx = useContext(GroupContext);
    const ctx: MenuContext = {
        me: me ?? null,
        member: groupCtx?.member ?? null,
        group: groupCtx?.group ?? null,
    };
    return { menu: resolveActiveMenu(pathname, ctx), ctx };
}

function ItemRow({ item, ctx, pathname, depth }: { item: MenuItem; ctx: MenuContext; pathname: string; depth: number }) {
    if (item.divider) return <div className="side-label">{item.divider}</div>;
    if (!itemVisible(item, ctx)) return null;

    const children = (item.children ?? []).filter((c) => itemVisible(c, ctx));
    const childActive = children.some((c) => c.route && routesMatch(c.route, pathname));

    if (!item.route) {
        // Pure parent (no route of its own): render label + children.
        return (
            <>
                {item.label && <div className="side-label">{item.label}</div>}
                {children.map((c, i) => <ItemRow key={c.route ?? i} item={c} ctx={ctx} pathname={pathname} depth={depth + 1} />)}
            </>
        );
    }

    return (
        <>
            <NavLink
                to={item.route}
                end={item.route === '/'}
                className={({ isActive }) =>
                    `nav-item${depth > 0 ? ' nav-child' : ''}${isActive || childActive ? ' nav-active' : ''}`}
            >
                {item.icon && <i className={`bi ${item.icon}`} />} {item.label}
                {item.badge && <span className={`chip chip-${item.badge.tone ?? 'muted'} nav-badge`}>{item.badge.text}</span>}
            </NavLink>
            {children.map((c, i) => <ItemRow key={c.route ?? i} item={c} ctx={ctx} pathname={pathname} depth={depth + 1} />)}
        </>
    );
}

/**
 * Drop dividers whose whole section filtered away (every item until the next
 * divider is invisible) — an orphan section label must never render.
 */
function pruneOrphanDividers(items: MenuItem[], ctx: MenuContext): MenuItem[] {
    const out: MenuItem[] = [];
    let pendingDivider: MenuItem | null = null;
    for (const item of items) {
        if (item.divider) {
            pendingDivider = item;
            continue;
        }
        if (!itemVisible(item, ctx)) continue;
        if (pendingDivider) {
            out.push(pendingDivider);
            pendingDivider = null;
        }
        out.push(item);
    }
    return out;
}

export function SidebarNav() {
    const { menu, ctx } = useSidebarMenu();
    const { pathname } = useLocation();
    if (!menu) return null;
    const items = pruneOrphanDividers(menu.items, ctx);
    return (
        <nav className="side-nav" data-menu={menu.name}>
            {items.map((item, i) => (
                <ItemRow key={item.route ?? item.divider ?? i} item={item} ctx={ctx} pathname={pathname} depth={0} />
            ))}
        </nav>
    );
}
