import {
    Component, Suspense, createElement, lazy, useContext, useMemo, useState,
    type ComponentType, type ErrorInfo, type ReactNode,
} from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { GroupContext } from '../../client/group-context';
import { hasPermission, useMe } from '../../client/me';
import type { PermSpec } from '../../client/model';
import { Guarded } from '../../ui/Guarded';
import type { MenuConfig, MenuItem } from '../../ui/menu-registry';

export type AdminNavigationGroup =
    | 'overview'
    | 'identity-access'
    | 'security'
    | 'observability'
    | 'operations'
    | 'infrastructure'
    | 'communications'
    | 'assistant'
    | 'other';

export const ADMIN_NAVIGATION_GROUPS: Readonly<Record<AdminNavigationGroup, {
    id: string; label: string; icon: string; order: number;
}>> = {
    overview: { id: 'admin:overview', label: 'Overview', icon: 'bi-grid-1x2', order: 0 },
    'identity-access': { id: 'admin:identity-access', label: 'Identity & Access', icon: 'bi-people', order: 10 },
    security: { id: 'admin:security', label: 'Security', icon: 'bi-shield-check', order: 20 },
    observability: { id: 'admin:observability', label: 'Observability', icon: 'bi-activity', order: 30 },
    operations: { id: 'admin:operations', label: 'Operations', icon: 'bi-gear', order: 40 },
    infrastructure: { id: 'admin:infrastructure', label: 'Infrastructure', icon: 'bi-cloud', order: 50 },
    communications: { id: 'admin:communications', label: 'Communications', icon: 'bi-chat-dots', order: 60 },
    assistant: { id: 'admin:assistant', label: 'Assistant', icon: 'bi-stars', order: 70 },
    other: { id: 'admin:other', label: 'Other', icon: 'bi-grid', order: 80 },
};

type AdminRouteBase = {
    path: string;
    permissions?: PermSpec;
    label?: string;
    fallbackToFirstVisible?: boolean;
};

/** External routes may stay synchronous; packaged routes use the explicit lazy arm. */
export type AdminRoute = AdminRouteBase & (
    | { component: ComponentType; loadComponent?: never }
    | { component?: never; loadComponent: () => Promise<{ default: ComponentType }> }
);

export interface AdminSection {
    id: string;
    basePath?: string;
    title: string;
    icon: string;
    permissions: string[];
    capability?: string;
    navigationGroup?: AdminNavigationGroup;
    routes: AdminRoute[];
}

type LazyPageBoundaryProps = { children: ReactNode; onRetry: () => void };
type LazyPageBoundaryState = { error: Error | null };

class LazyPageBoundary extends Component<LazyPageBoundaryProps, LazyPageBoundaryState> {
    state: LazyPageBoundaryState = { error: null };
    static getDerivedStateFromError(error: Error): LazyPageBoundaryState { return { error }; }
    componentDidCatch(_error: Error, _info: ErrorInfo): void { /* visible recovery is the contract */ }
    render(): ReactNode {
        if (!this.state.error) return this.props.children;
        return createElement('div', { className: 'panel panel-pad admin-route-error', role: 'alert' },
            createElement('h2', null, 'Admin page could not load'),
            createElement('p', { className: 'dim' }, 'The page bundle was unavailable. Check your connection and try again.'),
            createElement('button', {
                className: 'btn btn-primary', type: 'button',
                onClick: () => { this.setState({ error: null }); this.props.onRetry(); },
            }, 'Retry'),
        );
    }
}

export function AdminLazyPage({ load }: { load: () => Promise<{ default: ComponentType }> }) {
    const [attempt, setAttempt] = useState(0);
    const Page = useMemo(() => lazy(load), [load, attempt]);
    return createElement(LazyPageBoundary, { key: attempt, onRetry: () => setAttempt((value) => value + 1) },
        createElement(Suspense, {
            fallback: createElement('div', { className: 'panel panel-pad admin-route-loading', role: 'status' },
                createElement('span', { className: 'spinner', 'aria-hidden': true }),
                createElement('span', null, 'Loading admin page…')),
        }, createElement(Page)),
    );
}

function relativePath(...parts: Array<string | undefined>): string {
    return parts.filter((part) => part != null && part !== '').join('/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function absolutePath(...parts: Array<string | undefined>): string {
    const relative = relativePath(...parts);
    return relative ? `/${relative}` : '/';
}

function AdminDenied() {
    return createElement('div', { className: 'panel' }, createElement('div', { className: 'empty' },
        createElement('i', { className: 'bi bi-shield-lock' }), createElement('h2', null, 'Access denied'),
        createElement('p', { className: 'dim' }, 'Your account does not have permission to open this admin page.')));
}

function routeElement(route: AdminRoute): ReactNode {
    return 'loadComponent' in route
        ? createElement(AdminLazyPage, { load: route.loadComponent! })
        : createElement(route.component);
}

function guardedElement(section: AdminSection, route: AdminRoute, sections: readonly AdminSection[], mount: string): ReactNode {
    const fallback = route.fallbackToFirstVisible
        ? createElement(AdminMountLanding, { sections: sections.filter((candidate) => candidate !== section), mount })
        : createElement(AdminDenied);
    const page = routeElement(route);
    const routeGuarded = route.permissions
        ? createElement(Guarded, { permission: route.permissions, fallback, children: page })
        : page;
    return createElement(AdminGlobalScope, { children: createElement(Guarded, {
        permission: section.permissions, fallback, children: routeGuarded,
    }) });
}

/** Admin is global even when embedded beneath a product portal's provider. */
export function AdminGlobalScope({ children }: { children: ReactNode }) {
    const outer = useContext(GroupContext);
    if (!outer) return children;
    return createElement(GroupContext.Provider, { value: { ...outer, group: null, member: null, loading: false }, children });
}

function routeVisible(section: AdminSection, route: AdminRoute, me: ReturnType<typeof useMe>['data']): boolean {
    return hasPermission(me ?? null, section.permissions, null)
        && (!route.permissions || hasPermission(me ?? null, route.permissions, null));
}

function AdminLanding({ section, mount }: { section: AdminSection; mount: string }) {
    const { data: me } = useMe();
    const first = section.routes.find((route) => routeVisible(section, route, me));
    return first ? createElement(Navigate, { replace: true, to: absolutePath(mount, section.basePath ?? section.id, first.path) }) : createElement(AdminDenied);
}

function AdminMountLanding({ sections, mount }: { sections: readonly AdminSection[]; mount: string }) {
    const { data: me } = useMe();
    for (const section of sections) {
        const first = section.routes.find((route) => routeVisible(section, route, me));
        if (first) return createElement(Navigate, { replace: true, to: absolutePath(mount, section.basePath ?? section.id, first.path) });
    }
    return createElement(AdminDenied);
}

export function adminSectionRoutes(sections: readonly AdminSection[], opts: { mount?: string } = {}): RouteObject[] {
    const mount = relativePath(opts.mount ?? '');
    const routes: RouteObject[] = [];
    const rootSections = sections.filter((section) => relativePath(section.basePath ?? section.id) === '');
    const rootHasIndex = rootSections.some((section) => section.routes.some((route) => relativePath(route.path) === ''));
    if (mount && rootSections.length > 0 && !rootHasIndex) routes.push({
        path: mount,
        element: createElement(AdminGlobalScope, { children: createElement(AdminMountLanding, { sections: rootSections, mount }) }),
    });
    for (const section of sections) {
        const base = relativePath(section.basePath ?? section.id);
        const landing = relativePath(mount, base);
        const hasIndex = section.routes.some((route) => relativePath(route.path) === '');
        if (base && landing && !hasIndex) routes.push({
            path: landing,
            element: createElement(AdminGlobalScope, { children: createElement(AdminLanding, { section, mount }) }),
        });
        for (const route of section.routes) routes.push({
            path: relativePath(mount, base, route.path),
            element: guardedElement(section, route, sections, mount),
        });
    }
    return routes;
}

export function adminSectionsMenu(sections: readonly AdminSection[], opts: {
    name?: string; mount?: string; divider?: string; grouped?: boolean; presentation?: MenuConfig['presentation'];
} = {}): MenuConfig {
    const mount = relativePath(opts.mount ?? '');
    const items: MenuItem[] = [];
    if (opts.divider) items.push({ divider: opts.divider });
    if (opts.grouped) {
        const groups = new Map<AdminNavigationGroup, MenuItem[]>();
        for (const section of sections) {
            const group = section.navigationGroup ?? 'other';
            const base = relativePath(mount, section.basePath ?? section.id);
            const labeled = section.routes.filter((route) => route.label);
            const destinations: MenuItem[] = labeled.length > 0 ? labeled.map((route) => ({
                id: `admin:${section.id}:${route.path || 'index'}`, label: route.label!, keywords: [section.title],
                route: absolutePath(base, route.path), permissionClauses: [section.permissions, ...(route.permissions ? [route.permissions] : [])],
            })) : [{ id: `admin:${section.id}`, label: section.title, keywords: [section.title], route: absolutePath(base), permissionClauses: [section.permissions] }];
            groups.set(group, [...(groups.get(group) ?? []), ...destinations]);
        }
        for (const [group, children] of [...groups.entries()].sort((a, b) => ADMIN_NAVIGATION_GROUPS[a[0]].order - ADMIN_NAVIGATION_GROUPS[b[0]].order)) {
            const meta = ADMIN_NAVIGATION_GROUPS[group];
            items.push({ id: meta.id, label: meta.label, icon: meta.icon, children });
        }
        return { name: opts.name ?? 'admin', scope: 'admin', presentation: opts.presentation ?? 'static', items };
    }
    for (const section of sections) {
        const labeled = section.routes.filter((route) => route.label);
        const base = relativePath(mount, section.basePath ?? section.id);
        items.push({
            label: section.title, icon: section.icon, permissions: section.permissions,
            ...(base ? { route: absolutePath(base) } : {}),
            children: labeled.map((route) => ({ label: route.label!, route: absolutePath(base, route.path), permissions: route.permissions })),
        });
    }
    return { name: opts.name ?? 'admin', scope: 'admin', presentation: opts.presentation ?? 'static', items };
}
