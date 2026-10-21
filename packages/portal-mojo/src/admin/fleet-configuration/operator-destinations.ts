import { apiOrigin } from '../../client/client';
import { flag, object, OperatorError, privateCall, type PrivateScope } from './shared-validation-data';
export interface OperatorDestinations { admin_path: string; setup: boolean; deployments: boolean; topology: boolean; capacity: boolean; external: boolean }
export function parseDestinations(v: unknown): OperatorDestinations {
    const r = object(v), c = object(r.capabilities), f = object(r.features), platform = object(f.platform), pc = object(platform.capabilities), settings = object(f.settings), sc = object(settings.capabilities);
    if (typeof r.admin_path !== 'string' || !/^\/[A-Za-z0-9_-]+\/$/.test(r.admin_path)) throw new OperatorError('invalid');
    return { admin_path: r.admin_path, setup: flag(platform.enabled) && flag(pc.setup) && flag(c.setup), deployments: flag(platform.enabled) && flag(pc.view), topology: flag(settings.enabled) && flag(sc.owner_edit), capacity: flag(platform.enabled) && flag(pc.capacity), external: object(r.infrastructure).mode === 'external' };
}
export const readOperatorDestinations = async (scope?: PrivateScope) => parseDestinations(await privateCall('/api/account/admin/bootstrap', null, scope));
/** The backend capacity hint is semantic; the actual legacy route is fleet. */
export function legacyDestination(d: OperatorDestinations, kind: 'setup' | 'deployments' | 'topology' | 'capacity'): string | null {
    if (!d[kind]) return null;
    const base = new URL(apiOrigin() || '/', window.location.origin);
    if (base.origin !== window.location.origin) return null;
    return `${d.admin_path}#/${{ setup: 'setup', deployments: 'deployments', topology: 'settings?focus=topology', capacity: 'fleet' }[kind]}`;
}
export function fleetConnectionRoute(pathname: string): string {
    const marker = pathname.lastIndexOf('/dns'); const fleet = pathname.lastIndexOf('/fleet-configuration');
    return `${marker >= 0 ? pathname.slice(0, marker) : fleet >= 0 ? pathname.slice(0, fleet) : ''}/fleet-configuration/shared-validation`;
}
