import { backendGlobalCan, type BackendGlobalUser } from '../fleet/access';
import { decodeJwt } from '../../client/jwt';
import { getAccessToken, getAuthSessionRevision, getAuthSnapshot } from '../../client/auth';
import type { Bootstrap, WebAppObject } from './types';
export const DEPLOYMENTS_PERMISSIONS = ['sys.view_platform', 'sys.manage_platform', 'sys.admin', 'sys.view_dns', 'sys.manage_dns', 'sys.security'];
const active = (u: BackendGlobalUser | null | undefined) => !!u && (!('is_active' in u) || u.is_active !== false);
export const canReadApi = (u: BackendGlobalUser | null | undefined) => active(u) && backendGlobalCan(u, ['view_platform', 'manage_platform', 'admin']);
export const canRecoverApi = (u: BackendGlobalUser | null | undefined) => active(u) && backendGlobalCan(u, ['manage_platform', 'admin']);
export const canReadWebApps = (u: BackendGlobalUser | null | undefined) => active(u) && backendGlobalCan(u, ['view_dns', 'manage_dns', 'security']);
export const canReadBootstrap = (u: BackendGlobalUser | null | undefined) => active(u) && backendGlobalCan(u, ['view_admin', 'manage_users', 'manage_settings', 'admin']);
export function isInteractive(): boolean { const s = getAuthSnapshot(), c = decodeJwt(getAccessToken()); return s.authenticated && !!c && c.credential_kind !== 'api_key' && c.credential_kind !== 'group_scoped_token'; }
export interface DeploymentOwner {
    actor: string;
    origin: string;
    session: number;
    signal?: AbortSignal;
}
export function deploymentOwner(): DeploymentOwner { return {
    actor: getAuthSnapshot().uid ?? '', origin: typeof window === 'undefined' ? '' : window.location.origin, session: getAuthSessionRevision()
}; }
export function ownerKey(o: DeploymentOwner): string { return `${o.origin}:${o.actor}:${o.session}`; }
export function assertOwner(o: DeploymentOwner, signal?: AbortSignal): void { signal?.throwIfAborted(); o.signal?.throwIfAborted(); const now = deploymentOwner(); if (!getAuthSnapshot().authenticated || !o.actor || ownerKey(o) !== ownerKey(now))
    throw new DOMException('Session changed; refresh and review again', 'AbortError'); }
/** Verb and exact object VIEW/SAVE are independent; member dict is from this app's owning group only. */
export function webAppAuthority(user: BackendGlobalUser | null | undefined, app: WebAppObject, member?: {
    permissions?: Record<string, unknown>;
} | null) {
    const local = member ? { permissions: member.permissions } : null;
    const can = (grants: readonly string[]) => backendGlobalCan(user, grants) || backendGlobalCan(local, grants);
    const view = active(user) && app.id > 0 && app.group.id > 0 && can(['view_dns', 'manage_dns', 'security']);
    return {
        read: view, custom: view && can(['manage_webapp']), release: view, workflow: active(user) && app.group.id > 0 && (can(['security']) || (can(['manage_webapp']) && can(['manage_dns'])))
    };
}
export function canOnboard(bootstrap: Bootstrap | undefined): boolean { return !!bootstrap && (bootstrap.groups.length > 0 || bootstrap.can_create_webapp_group); }
