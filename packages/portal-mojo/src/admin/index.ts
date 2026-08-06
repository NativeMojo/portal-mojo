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
import { SETTINGS_ADMIN_SECTION } from './settings';
import { BOUNCER_ADMIN_SECTION } from './bouncer';

export * from './credentials';
export * from './monitoring';
export * from './settings';
export * from './bouncer';

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
}

/** Registry of every shipped admin section. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
    {
        id: 'credentials',
        basePath: '',
        title: 'Credentials',
        icon: 'bi-key',
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
    SETTINGS_ADMIN_SECTION,
    BOUNCER_ADMIN_SECTION,
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

function guardedElement(section: AdminSection, route: AdminRoute): ReactNode {
    const page = createElement(route.component);
    const routeGuarded = route.permissions
        ? createElement(Guarded, {
            permission: route.permissions,
            fallback: createElement(AdminDenied),
            children: page,
        })
        : page;
    return createElement(Guarded, {
        permission: section.permissions,
        fallback: createElement(AdminDenied),
        children: routeGuarded,
    });
}

function AdminLanding({ section, mount }: { section: AdminSection; mount: string }) {
    const { data: me } = useMe();
    const member = useContext(GroupContext)?.member ?? null;
    const first = section.routes.find((route) =>
        hasPermission(me ?? null, section.permissions, member)
        && (!route.permissions || hasPermission(me ?? null, route.permissions, member)));
    if (!first) return createElement(AdminDenied);
    const base = section.basePath ?? section.id;
    return createElement(Navigate, {
        replace: true,
        to: absolutePath(mount, base, first.path),
    });
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
    for (const section of sections) {
        const base = relativePath(section.basePath ?? section.id);
        const landing = relativePath(mount, base);
        const hasIndex = section.routes.some((route) => relativePath(route.path) === '');
        if (landing && !hasIndex) {
            routes.push({
                path: landing,
                element: createElement(AdminLanding, { section, mount }),
            });
        }
        for (const route of section.routes) {
            routes.push({
                path: relativePath(mount, base, route.path),
                element: guardedElement(section, route),
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
    opts: { name?: string; mount?: string; divider?: string } = {},
): MenuConfig {
    const mount = relativePath(opts.mount ?? '');
    const items: MenuItem[] = [];
    if (opts.divider) items.push({ divider: opts.divider });
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
    return { name: opts.name ?? 'admin', items };
}
