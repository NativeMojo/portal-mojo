// SidebarNav — renders the ACTIVE menu from the registry (menu-registry.ts).
// Static menus keep A4's original always-visible children. Menus that opt into
// `presentation: 'accordion'` get one-open domain groups, navigation search,
// active-branch expansion, and an app-owned icon-rail presentation.
import {
    useContext, useEffect, useId, useMemo, useState, useSyncExternalStore,
    type Dispatch, type SetStateAction,
} from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useMe } from '../client/me';
import { GroupContext } from '../client/group-context';
import {
    itemContainsRoute, itemVisible, menusVersion, resolveActiveMenu,
    routesMatch, subscribeMenus, visibleMenuChildren,
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

function itemKey(item: MenuItem, index: number, parent = 'root'): string {
    return item.id ?? item.route ?? `${parent}:${item.label ?? item.divider ?? index}`;
}

function domToken(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

/** Remove denied/empty branches while retaining the public MenuItem shape. */
function visibleTree(item: MenuItem, ctx: MenuContext): MenuItem | null {
    if (!itemVisible(item, ctx)) return null;
    if (item.divider) return item;
    const hadChildren = item.children != null;
    const children = visibleMenuChildren(item, ctx)
        .map((child) => visibleTree(child, ctx))
        .filter((child): child is MenuItem => child != null);
    if (!item.route && hadChildren && children.length === 0) return null;
    return hadChildren ? { ...item, children } : item;
}

/** Drop section dividers whose complete visible section is empty. */
function visibleRootItems(items: MenuItem[], ctx: MenuContext): MenuItem[] {
    const out: MenuItem[] = [];
    let pendingDivider: MenuItem | null = null;
    for (const item of items) {
        if (item.divider) {
            pendingDivider = item;
            continue;
        }
        const visible = visibleTree(item, ctx);
        if (!visible) continue;
        if (pendingDivider) {
            out.push(pendingDivider);
            pendingDivider = null;
        }
        out.push(visible);
    }
    return out;
}

function filterTree(item: MenuItem, query: string): MenuItem | null {
    if (item.divider) return null;
    const children = (item.children ?? [])
        .map((child) => filterTree(child, query))
        .filter((child): child is MenuItem => child != null);
    const selfMatch = [item.label ?? '', ...(item.keywords ?? [])]
        .some((value) => value.toLocaleLowerCase().includes(query));
    if (!selfMatch && children.length === 0) return null;
    return item.children ? { ...item, children: selfMatch ? item.children : children } : item;
}

function countDestinations(items: MenuItem[]): number {
    return items.reduce((total, item) => total
        + (item.route ? 1 : 0)
        + countDestinations(item.children ?? []), 0);
}

function treeOwnsRoute(item: MenuItem, pathname: string): boolean {
    if (item.route && routesMatch(item.route, pathname)) return true;
    return (item.children ?? []).some((child) => treeOwnsRoute(child, pathname));
}

function NavRow({
    item, pathname, depth, collapsed = false,
}: {
    item: MenuItem;
    pathname: string;
    depth: number;
    collapsed?: boolean;
}) {
    if (!item.route) return null;
    const active = routesMatch(item.route, pathname);
    const label = item.label ?? item.route;
    return (
        <NavLink
            to={item.route}
            end={item.route === '/'}
            aria-label={collapsed ? label : undefined}
            data-tooltip={collapsed ? label : undefined}
            className={`nav-item${depth > 0 ? ' nav-child' : ''}${active ? ' nav-active' : ''}`}
        >
            {item.icon && <i className={`bi ${item.icon}`} />}
            <span className="nav-text">{label}</span>
            {item.badge && <span className={`chip chip-${item.badge.tone ?? 'muted'} nav-badge`}>{item.badge.text}</span>}
        </NavLink>
    );
}

function StaticItem({
    item, pathname, depth, parentKey, index,
}: {
    item: MenuItem;
    pathname: string;
    depth: number;
    parentKey: string;
    index: number;
}) {
    if (item.divider) return <div className="side-label">{item.divider}</div>;
    const children = item.children ?? [];
    if (!item.route) {
        return (
            <div className="nav-static-group">
                {item.label && <div className="side-label">{item.label}</div>}
                {children.map((child, childIndex) => (
                    <StaticItem
                        key={itemKey(child, childIndex, itemKey(item, index, parentKey))}
                        item={child}
                        pathname={pathname}
                        depth={depth + 1}
                        parentKey={itemKey(item, index, parentKey)}
                        index={childIndex}
                    />
                ))}
            </div>
        );
    }
    return (
        <>
            <NavRow item={item} pathname={pathname} depth={depth} />
            {children.map((child, childIndex) => (
                <StaticItem
                    key={itemKey(child, childIndex, itemKey(item, index, parentKey))}
                    item={child}
                    pathname={pathname}
                    depth={depth + 1}
                    parentKey={itemKey(item, index, parentKey)}
                    index={childIndex}
                />
            ))}
        </>
    );
}

function AccordionItem({
    item, index, pathname, openKey, setOpenKey, searching, collapsed,
    onRequestExpand, idPrefix,
}: {
    item: MenuItem;
    index: number;
    pathname: string;
    openKey: string | null;
    setOpenKey: Dispatch<SetStateAction<string | null>>;
    searching: boolean;
    collapsed: boolean;
    onRequestExpand?: () => void;
    idPrefix: string;
}) {
    if (item.divider) return collapsed ? null : <div className="side-label">{item.divider}</div>;
    const children = item.children ?? [];
    if (item.route || children.length === 0) {
        return <NavRow item={item} pathname={pathname} depth={0} collapsed={collapsed} />;
    }

    const key = itemKey(item, index);
    const active = treeOwnsRoute(item, pathname);
    const open = searching || openKey === key;
    const disclosureId = `${idPrefix}-${domToken(key)}`;
    const label = item.label ?? key;
    const activate = () => {
        if (collapsed) {
            setOpenKey(key);
            onRequestExpand?.();
        } else {
            setOpenKey((current) => current === key ? null : key);
        }
    };

    return (
        <div className={`nav-accordion${open ? ' nav-accordion-open' : ''}`}>
            <button
                type="button"
                className={`nav-item nav-parent${active ? ' nav-active' : ''}`}
                aria-expanded={collapsed ? undefined : open}
                aria-controls={collapsed ? undefined : disclosureId}
                aria-label={collapsed ? label : undefined}
                data-tooltip={collapsed ? label : undefined}
                onClick={activate}
                onKeyDown={(event) => {
                    if (collapsed && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        activate();
                    }
                }}
            >
                {item.icon && <i className={`bi ${item.icon}`} />}
                <span className="nav-text">{label}</span>
                {item.badge && <span className={`chip chip-${item.badge.tone ?? 'muted'} nav-badge`}>{item.badge.text}</span>}
                {!collapsed && <i className="bi bi-chevron-down nav-arrow" aria-hidden="true" />}
            </button>
            {!collapsed && (
                <div id={disclosureId} className="nav-submenu" hidden={!open}>
                    {children.map((child, childIndex) => (
                        child.route
                            ? <NavRow key={itemKey(child, childIndex, key)} item={child} pathname={pathname} depth={1} />
                            : <StaticItem
                                key={itemKey(child, childIndex, key)}
                                item={child}
                                pathname={pathname}
                                depth={1}
                                parentKey={key}
                                index={childIndex}
                            />
                    ))}
                </div>
            )}
        </div>
    );
}

export interface SidebarNavProps {
    /** App-owned icon-rail state. Layout width remains the app's concern. */
    collapsed?: boolean;
    /** Called when a rail category is activated so the shell can expand. */
    onRequestExpand?: () => void;
}

export function SidebarNav({ collapsed = false, onRequestExpand }: SidebarNavProps = {}) {
    const { menu, ctx } = useSidebarMenu();
    const { pathname } = useLocation();
    const disclosurePrefix = domToken(useId());
    const [openKey, setOpenKey] = useState<string | null>(null);
    const [query, setQuery] = useState('');

    const items = useMemo(
        () => menu ? visibleRootItems(menu.items, ctx) : [],
        [menu, ctx.me, ctx.member, ctx.group],
    );
    const activeKey = useMemo(() => {
        const index = items.findIndex((item) => !item.divider && itemContainsRoute(item, pathname, ctx));
        return index < 0 ? null : itemKey(items[index]!, index);
    }, [items, pathname, ctx]);

    useEffect(() => {
        setOpenKey(activeKey);
    }, [activeKey, menu?.name]);

    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filteredItems = useMemo(() => normalizedQuery
        ? items.map((item) => filterTree(item, normalizedQuery)).filter((item): item is MenuItem => item != null)
        : items, [items, normalizedQuery]);
    const resultCount = countDestinations(filteredItems);

    if (!menu) return null;
    if (menu.presentation !== 'accordion') {
        return (
            <nav className="side-nav" data-menu={menu.name}>
                {items.map((item, index) => (
                    <StaticItem
                        key={itemKey(item, index)} item={item} pathname={pathname}
                        depth={0} parentKey="root" index={index}
                    />
                ))}
            </nav>
        );
    }

    return (
        <nav className={`side-nav side-nav-accordion${collapsed ? ' side-nav-collapsed' : ''}`} data-menu={menu.name} aria-label="Admin navigation">
            {!collapsed && (
                <div className="nav-search">
                    <i className="bi bi-search" aria-hidden="true" />
                    <input
                        type="search"
                        value={query}
                        aria-label="Search Admin navigation"
                        placeholder="Find admin page…"
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape' && query) {
                                event.preventDefault();
                                setQuery('');
                            }
                        }}
                    />
                    {query && <button type="button" aria-label="Clear navigation search" onClick={() => setQuery('')}><i className="bi bi-x-lg" /></button>}
                </div>
            )}
            {!collapsed && normalizedQuery && (
                <div className="nav-search-status" role="status" aria-live="polite">
                    {resultCount === 0 ? 'No admin pages found' : `${resultCount} admin page${resultCount === 1 ? '' : 's'} found`}
                </div>
            )}
            {filteredItems.map((item, index) => (
                <AccordionItem
                    key={itemKey(item, index)}
                    item={item}
                    index={index}
                    pathname={pathname}
                    openKey={openKey}
                    setOpenKey={setOpenKey}
                    searching={Boolean(normalizedQuery)}
                    collapsed={collapsed}
                    onRequestExpand={onRequestExpand}
                    idPrefix={disclosurePrefix}
                />
            ))}
        </nav>
    );
}
