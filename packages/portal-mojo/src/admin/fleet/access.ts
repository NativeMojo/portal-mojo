/** Exact global User.has_permission implication rule (django-mojo helpers/perms.py). */
export interface BackendGlobalUser { is_superuser?: boolean; permissions?: Record<string, unknown> | null }
const categories = new Set(['users', 'groups', 'security', 'comms', 'jobs', 'metrics', 'files']);
export const FLEET_DASHBOARD_GRANTS = ['view_admin', 'manage_users', 'manage_settings', 'admin'] as const;
export const FLEET_CAPACITY_GRANTS = ['manage_aws'] as const;
export function backendGlobalCan(user: BackendGlobalUser | null | undefined, grants: string | readonly string[]): boolean {
    if (!user) return false;
    if (user.is_superuser === true) return true;
    // Python bool(JSON value), including false for empty containers.
    const granted = (key: string) => {
        if (!user.permissions || !Object.hasOwn(user.permissions, key)) return false;
        const value = user.permissions[key];
        if (Array.isArray(value)) return value.length > 0;
        if (value && typeof value === 'object') return Object.keys(value).length > 0;
        return Boolean(value);
    };
    return (typeof grants === 'string' ? [grants] : grants).some((key) => {
        if (granted(key)) return true;
        const match = /^(?:view_|manage_)(.+)$/.exec(key);
        return !!match && categories.has(match[1]!) && granted(match[1]!);
    });
}
