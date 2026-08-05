// Me + permissions — the CHECK side of web-mojo's permission model, ported
// from User.hasPermission (src/core/models/User.js:13-61) and
// Member.hasPermission (Member.js:15-28). UX gating only: the client may err
// permissive (category rollups), the server stays authoritative on every
// request.
//
// Semantics, in check order:
//   1. `is_superuser` passes everything.
//   2. An array means ANY-of.
//   3. A `sys.` prefix pins the check to system-level (user) permissions —
//      group/member permissions are never consulted for sys.* checks.
//   4. Direct grant, or a category grant covering the granular name
//      (CATEGORY_GRANULAR_MAP rollup).
//   5. System-level `admin` is the permission-driven equivalent of
//      is_superuser — passes every gate.
//   6. Otherwise the active-group member: direct grant, or the member
//      `admin` wildcard (full access within the group — never sys.*).
import { useQuery } from '@tanstack/react-query';
import { useContext, useSyncExternalStore } from 'react';
import { mojoGet } from './client';
import { getAuthSnapshot, subscribeAuth, type AuthSnapshot } from './auth';
import { GroupContext } from './group-context';

/** Server permission dicts use true AND 1 as granted (web-mojo checked `== true`). */
export type PermissionsDict = Record<string, unknown>;

export interface Me {
    id: number;
    display_name?: string;
    email?: string;
    is_superuser?: boolean;
    permissions?: PermissionsDict | null;
    [field: string]: unknown;
}

/** Active-group membership context — provided by the A3 GroupProvider. */
export interface MemberLike {
    permissions?: PermissionsDict | null;
}

// ── Category → granular rollup map ────────────────────────────────────
// A category grant implicitly grants every granular permission it covers.
// Ported verbatim from User.CATEGORY_GRANULAR_MAP (incl. the dnsman note:
// `security` maps view_dns/manage_dns because dnsman's RestMeta accepts
// `security` for both VIEW_PERMS and SAVE_PERMS — mirroring, not over-granting).

const BASE_CATEGORY_GRANULAR_MAP: Record<string, string[]> = {
    security: ['view_security', 'manage_security', 'view_dns', 'manage_dns'],
    users: ['view_users', 'manage_users', 'view_members'],
    groups: ['view_groups', 'manage_groups', 'manage_group'],
    comms: ['manage_chat', 'manage_aws', 'view_notifications', 'manage_notifications', 'send_notifications',
        'view_devices', 'manage_devices', 'manage_push_config',
        'view_phone_numbers', 'manage_phone_numbers', 'manage_phone_config',
        'view_sms', 'manage_sms', 'send_sms'],
    jobs: ['view_jobs', 'manage_jobs'],
    metrics: ['view_metrics', 'manage_metrics', 'write_metrics'],
    files: ['view_fileman', 'manage_files', 'view_vault', 'manage_vault'],
};

let categoryGranularMap: Record<string, string[]> = { ...BASE_CATEGORY_GRANULAR_MAP };
let granularToCategory: Record<string, string> = invertMap(categoryGranularMap);

function invertMap(map: Record<string, string[]>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [category, granulars] of Object.entries(map)) {
        for (const g of granulars) out[g] = category;
    }
    return out;
}

/**
 * App extension point: add category → granular coverage (web-mojo's
 * APP_CATEGORY_PERMISSIONS + rebuildPermissions, as a registry call instead
 * of live-mutated arrays). Existing categories are extended, not replaced.
 */
export function registerPermissionCategories(extra: Record<string, string[]>): void {
    for (const [category, granulars] of Object.entries(extra)) {
        const current = categoryGranularMap[category] ?? [];
        categoryGranularMap[category] = [...new Set([...current, ...granulars])];
    }
    granularToCategory = invertMap(categoryGranularMap);
}

export function getCategoryGranularMap(): Readonly<Record<string, readonly string[]>> {
    return categoryGranularMap;
}

// ── The check ─────────────────────────────────────────────────────────

/** The backend stores grants as true or 1 (web-mojo's loose `== true`). */
function granted(dict: PermissionsDict | null | undefined, name: string): boolean {
    const v = dict?.[name];
    return v === true || v === 1;
}

/** Direct grant or category rollup on one permissions dict (User._hasPermission). */
function dictHasPermission(dict: PermissionsDict | null | undefined, name: string): boolean {
    if (!dict) return false;
    if (granted(dict, name)) return true;
    const category = granularToCategory[name];
    return category != null && granted(dict, category);
}

/** Member.hasPermission: direct grant, or the group `admin` wildcard (never sys.*). */
export function memberHasPermission(member: MemberLike | null | undefined, permission: string | string[]): boolean {
    if (!member) return false;
    if (Array.isArray(permission)) return permission.some((p) => memberHasPermission(member, p));
    const dict = member.permissions;
    if (!dict) return false;
    if (granted(dict, permission)) return true;
    return !permission.startsWith('sys.') && granted(dict, 'admin');
}

/** User.hasPermission, full semantics. `member` is the active-group membership. */
export function hasPermission(
    me: Me | null | undefined,
    permission: string | string[],
    member?: MemberLike | null,
): boolean {
    if (!me) return false;
    if (me.is_superuser) return true;
    if (Array.isArray(permission)) return permission.some((p) => hasPermission(me, p, member));

    const isSys = permission.startsWith('sys.');
    const name = isSys ? permission.slice(4) : permission;

    if (dictHasPermission(me.permissions, name)) return true;
    // System-level `admin` is a full-access grant — the permission-driven
    // equivalent of is_superuser.
    if (dictHasPermission(me.permissions, 'admin')) return true;
    // Member permissions are only consulted for non-sys checks.
    if (!isSys && member && memberHasPermission(member, permission)) return true;
    return false;
}

// ── Hooks ─────────────────────────────────────────────────────────────

/** Live auth-session snapshot (re-renders on login/logout, incl. cross-tab). */
export function useAuthSnapshot(): AuthSnapshot {
    return useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
}

/**
 * The signed-in user. Disabled (no fetch, no data) while anonymous; keyed by
 * uid so a login/logout/login sequence never bleeds one identity's data into
 * the next.
 */
export function useMe() {
    const auth = useAuthSnapshot();
    return useQuery<Me>({
        queryKey: ['me', auth.uid],
        queryFn: () => mojoGet<Me>('/api/user', 'me'),
        enabled: auth.authenticated,
        staleTime: 5 * 60_000,
    });
}

export interface CanResult {
    can: boolean;
    /** True only during the first `me` fetch — anonymous is NOT loading. */
    isLoading: boolean;
    me: Me | null;
}

/**
 * Permission check against the signed-in user PLUS the active-group member
 * when a <GroupProvider> is mounted (member `admin` grants everything in the
 * group; sys.* checks never consult it). Resolves false while loading or
 * anonymous (fail-closed rendering).
 */
export function useCan(permission: string | string[]): CanResult {
    const { data, isLoading } = useMe();
    const groupCtx = useContext(GroupContext);
    const me = data ?? null;
    return { can: hasPermission(me, permission, groupCtx?.member ?? null), isLoading, me };
}
