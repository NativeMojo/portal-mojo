// portal-mojo/admin — the base admin portal as self-registering section
// bundles (PLAN.md "Admin distribution: dual-mount", decided 2026-08-04).
// The same sections mount two ways:
//   1. standalone — apps/portal mounts ALL sections at the root and IS the
//      dedicated back office for any django-mojo deployment;
//   2. embedded — a product's own portal registers them under a "System"
//      area (#/system/…) beside its product pages, gated by `view_admin`.
// Constraints built in from day one:
//   · routes are MOUNT-POINT RELATIVE — a section never knows where it lives;
//   · sections CONTRIBUTE sidebar entries; the sidebar engine (Chunk A4
//     registry) owns the menu — a section never renders the sidebar itself;
//   · visibility = permissions (now) ∧ backend capabilities (Phase 2
//     capabilities endpoint), evaluated by the mounting shell.
// Sections land here as Phase 2 admin pages stabilize; deployed portals then
// pick up admin updates via `npm update portal-mojo` — clone the shell,
// never the admin.
import { createElement, useContext, type ComponentType, type ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { GroupContext, hasPermission, useMe, type PermSpec } from '../client';
import { Guarded } from '../ui/Guarded';
import type { MenuConfig, MenuItem } from '../ui/menu-registry';
import {
    GLOBAL_CREDENTIAL_PERMS,
    GroupApiKeysPage,
    WebhookSubscriptionsPage,
} from './credentials';
import { MONITORING_ADMIN_SECTION } from './monitoring';
import { CLOUDWATCH_ADMIN_SECTION } from './cloudwatch';
import { SETTINGS_ADMIN_SECTION } from './settings';
import { BOUNCER_ADMIN_SECTION } from './bouncer';
import {
    DEVICE_INTEL_ADMIN_SECTION,
    GEOIP_ADMIN_SECTION,
    SECURITY_OPERATIONS_ADMIN_SECTION,
} from './security';
import { MEMBERS_ADMIN_SECTION, USERS_ADMIN_SECTION } from './identity';
import { JOBS_ADMIN_SECTION } from './jobs';
import { NETWORK_SECURITY_ADMIN_SECTION } from './network';
import { DNS_ADMIN_SECTION } from './dns';
import { STORAGE_ADMIN_SECTION } from './storage';
import { EMAIL_ADMIN_SECTION, PUBLIC_MESSAGES_ADMIN_SECTION, PUSH_ADMIN_SECTION } from './messaging';
import { PHONE_HUB_ADMIN_SECTION } from './phonehub';
import { ADMIN_DASHBOARD_PERMISSIONS, AdminDashboardPage } from './dashboard';

export * from './credentials';
export * from './monitoring';
export * from './cloudwatch';
export * from './settings';
export * from './bouncer';
export * from './security-permissions';
export * from './security';
export * from './incidents';
export * from './rules';
export * from './identity';
export * from './jobs';
export * from './network';
export * from './dns';
export * from './storage';
export * from './messaging';
export * from './phonehub';
export * from './dashboard';

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
    id: string;
    label: string;
    icon: string;
    order: number;
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

/** One mountable admin area: pages + routes + sidebar contribution + gates. */
export interface AdminSection {
    /** Stable id; the default route segment (`'users'` → `#/users` standalone, `#/system/users` embedded). */
    id: string;
    /**
     * Route prefix relative to the admin mount. Defaults to `id`. Use `''`
     * when sibling routes should mount directly at the admin root.
     */
    basePath?: string;
    /** Sidebar entry label. */
    title: string;
    /** bootstrap-icons class for the sidebar entry (e.g. `'bi-people'`). */
    icon: string;
    /** Permissions that reveal the section (client errs permissive; the server stays authoritative). */
    permissions: string[];
    /** Backend capability key that must be enabled for the section to mount (Phase 2 handshake). */
    capability?: string;
    /** Operator-domain category. Omitted external sections fall under Other. */
    navigationGroup?: AdminNavigationGroup;
    /** Mount-point-relative routes (no leading slash). */
    routes: AdminRoute[];
}

export interface AdminRoute {
    /** Path relative to the section mount (`''` for the index, `':id'` for details). */
    path: string;
    component: ComponentType;
    /** Additional route gate (ANY-of). It is ANDed with section permissions. */
    permissions?: PermSpec;
    /** Present → the route appears as a sidebar item under the section. */
    label?: string;
    /** A denied root landing redirects to the first visible admin route. */
    fallbackToFirstVisible?: boolean;
}

/** Registry of every shipped admin section. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
    {
        id: 'dashboard',
        basePath: '',
        title: 'Overview',
        icon: 'bi-grid-1x2',
        navigationGroup: 'overview',
        permissions: ADMIN_DASHBOARD_PERMISSIONS,
        routes: [{ path: '', label: 'Dashboard', component: AdminDashboardPage, permissions: ADMIN_DASHBOARD_PERMISSIONS, fallbackToFirstVisible: true }],
    },
    USERS_ADMIN_SECTION,
    MEMBERS_ADMIN_SECTION,
    {
        id: 'credentials',
        basePath: '',
        title: 'Credentials',
        icon: 'bi-key',
        navigationGroup: 'identity-access',
        permissions: GLOBAL_CREDENTIAL_PERMS,
        routes: [
            {
                path: 'api-keys', label: 'Group API Keys',
                component: GroupApiKeysPage, permissions: GLOBAL_CREDENTIAL_PERMS,
            },
            {
                path: 'webhook-subscriptions', label: 'Webhooks',
                component: WebhookSubscriptionsPage, permissions: GLOBAL_CREDENTIAL_PERMS,
            },
        ],
    },
    MONITORING_ADMIN_SECTION,
    CLOUDWATCH_ADMIN_SECTION,
    SETTINGS_ADMIN_SECTION,
    SECURITY_OPERATIONS_ADMIN_SECTION,
    BOUNCER_ADMIN_SECTION,
    DEVICE_INTEL_ADMIN_SECTION,
    GEOIP_ADMIN_SECTION,
    JOBS_ADMIN_SECTION,
    NETWORK_SECURITY_ADMIN_SECTION,
    DNS_ADMIN_SECTION,
    STORAGE_ADMIN_SECTION,
    EMAIL_ADMIN_SECTION,
    PUBLIC_MESSAGES_ADMIN_SECTION,
    PUSH_ADMIN_SECTION,
    PHONE_HUB_ADMIN_SECTION,
];

function relativePath(...parts: Array<string | undefined>): string {
    return parts.filter((part) => part != null && part !== '')
        .join('/')
        .replace(/^\/+|\/+$/g, '')
        .replace(/\/+/g, '/');
}

function absolutePath(...parts: Array<string | undefined>): string {
    const relative = relativePath(...parts);
    return relative ? `/${relative}` : '/';
}

function AdminDenied() {
    return createElement('div', { className: 'panel' },
        createElement('div', { className: 'empty' },
            createElement('i', { className: 'bi bi-shield-lock' }),
            createElement('h2', null, 'Access denied'),
            createElement('p', { className: 'dim' }, 'Your account does not have permission to open this admin page.'),
        ));
}

function guardedElement(section: AdminSection, route: AdminRoute, sections: readonly AdminSection[], mount: string): ReactNode {
    const page = createElement(route.component);
    const fallback = route.fallbackToFirstVisible
        ? createElement(AdminMountLanding, { sections: sections.filter((candidate) => candidate !== section), mount })
        : createElement(AdminDenied);
    const routeGuarded = route.permissions
        ? createElement(Guarded, {
            permission: route.permissions,
            fallback,
            children: page,
        })
        : page;
    const guarded = createElement(Guarded, {
        permission: section.permissions,
        fallback,
        children: routeGuarded,
    });
    return createElement(AdminGlobalScope, { children: guarded });
}

/** Admin is global even when embedded beneath a product portal's provider. */
function AdminGlobalScope({ children }: { children: ReactNode }) {
    const outer = useContext(GroupContext);
    if (!outer) return children;
    return createElement(GroupContext.Provider, {
        value: { ...outer, group: null, member: null, loading: false },
        children,
    });
}

function routeVisible(section: AdminSection, route: AdminRoute, me: ReturnType<typeof useMe>['data']): boolean {
    return hasPermission(me ?? null, section.permissions, null)
        && (!route.permissions || hasPermission(me ?? null, route.permissions, null));
}

function AdminLanding({ section, mount }: { section: AdminSection; mount: string }) {
    const { data: me } = useMe();
    const first = section.routes.find((route) => routeVisible(section, route, me));
    if (!first) return createElement(AdminDenied);
    const base = section.basePath ?? section.id;
    return createElement(Navigate, {
        replace: true,
        to: absolutePath(mount, base, first.path),
    });
}

function AdminMountLanding({ sections, mount }: { sections: readonly AdminSection[]; mount: string }) {
    const { data: me } = useMe();
    for (const section of sections) {
        const first = section.routes.find((route) => routeVisible(section, route, me));
        if (first) {
            return createElement(Navigate, {
                replace: true,
                to: absolutePath(mount, section.basePath ?? section.id, first.path),
            });
        }
    }
    return createElement(AdminDenied);
}

/**
 * Generate mount-relative React Router entries with section AND route gates.
 * A non-root section receives a dynamic index redirect to its first visible
 * route, so direct navigation never lands on a route the operator cannot see.
 */
export function adminSectionRoutes(
    sections: readonly AdminSection[],
    opts: { mount?: string } = {},
): RouteObject[] {
    const mount = relativePath(opts.mount ?? '');
    const routes: RouteObject[] = [];
    const rootSections = sections.filter((section) => relativePath(section.basePath ?? section.id) === '');
    const rootHasIndex = rootSections.some((section) =>
        section.routes.some((route) => relativePath(route.path) === ''));
    if (mount && rootSections.length > 0 && !rootHasIndex) {
        routes.push({
            path: mount,
            element: createElement(AdminGlobalScope, {
                children: createElement(AdminMountLanding, { sections: rootSections, mount }),
            }),
        });
    }
    for (const section of sections) {
        const base = relativePath(section.basePath ?? section.id);
        const landing = relativePath(mount, base);
        const hasIndex = section.routes.some((route) => relativePath(route.path) === '');
        if (base && landing && !hasIndex) {
            routes.push({
                path: landing,
                element: createElement(AdminGlobalScope, {
                    children: createElement(AdminLanding, { section, mount }),
                }),
            });
        }
        for (const route of section.routes) {
            routes.push({
                path: relativePath(mount, base, route.path),
                element: guardedElement(section, route, sections, mount),
            });
        }
    }
    return routes;
}

/**
 * Bridge admin sections into the A4 sidebar registry — sections CONTRIBUTE
 * menu entries; they never own the sidebar. `mount` prefixes every route:
 * '' for the standalone back office (section routes at root), '/system' when
 * embedded in a product portal. Permission gates carry over per item;
 * capability filtering slots in here when the Phase 2 endpoint lands.
 */
export function adminSectionsMenu(
    sections: readonly AdminSection[],
    opts: {
        name?: string;
        mount?: string;
        divider?: string;
        /** Category grouping is opt-in for compatibility with shipped menus. */
        grouped?: boolean;
        presentation?: MenuConfig['presentation'];
    } = {},
): MenuConfig {
    const mount = relativePath(opts.mount ?? '');
    const items: MenuItem[] = [];
    if (opts.divider) items.push({ divider: opts.divider });

    if (opts.grouped) {
        const groups = new Map<AdminNavigationGroup, MenuItem[]>();
        for (const section of sections) {
            const group = section.navigationGroup ?? 'other';
            const base = relativePath(mount, section.basePath ?? section.id);
            const labeled = section.routes.filter((route) => route.label);
            const destinations: MenuItem[] = labeled.length > 0
                ? labeled.map((route) => ({
                    id: `admin:${section.id}:${route.path || 'index'}`,
                    label: route.label!,
                    keywords: [section.title],
                    route: absolutePath(base, route.path),
                    permissionClauses: [section.permissions, ...(route.permissions ? [route.permissions] : [])],
                }))
                : [{
                    id: `admin:${section.id}`,
                    label: section.title,
                    keywords: [section.title],
                    route: absolutePath(base),
                    permissionClauses: [section.permissions],
                }];
            groups.set(group, [...(groups.get(group) ?? []), ...destinations]);
        }
        for (const [group, children] of [...groups.entries()].sort((a, b) =>
            ADMIN_NAVIGATION_GROUPS[a[0]].order - ADMIN_NAVIGATION_GROUPS[b[0]].order)) {
            const meta = ADMIN_NAVIGATION_GROUPS[group];
            items.push({ id: meta.id, label: meta.label, icon: meta.icon, children });
        }
        return {
            name: opts.name ?? 'admin',
            scope: 'admin',
            presentation: opts.presentation ?? 'static',
            items,
        };
    }

    for (const section of sections) {
        const labeled = section.routes.filter((r) => r.label);
        const base = relativePath(mount, section.basePath ?? section.id);
        const children = labeled.map((route) => ({
            label: route.label!,
            route: absolutePath(base, route.path),
            permissions: route.permissions,
        }));
        items.push({
            label: section.title,
            icon: section.icon,
            permissions: section.permissions,
            // Root-mounted sections cannot own `/`; render a pure parent and
            // let the first visible child be the landing. Prefixed sections
            // use the generated dynamic index redirect above.
            ...(base ? { route: absolutePath(base) } : {}),
            children,
        });
    }
    return { name: opts.name ?? 'admin', scope: 'admin', presentation: opts.presentation ?? 'static', items };
}
