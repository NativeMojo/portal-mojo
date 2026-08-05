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
import type { ComponentType } from 'react';

/** One mountable admin area: pages + routes + sidebar contribution + gates. */
export interface AdminSection {
    /** Stable id; the default route segment (`'users'` → `#/users` standalone, `#/system/users` embedded). */
    id: string;
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
    /** Present → the route appears as a sidebar item under the section. */
    label?: string;
}

/** Registry of every shipped admin section. Empty until Phase 2 pages stabilize. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [];
