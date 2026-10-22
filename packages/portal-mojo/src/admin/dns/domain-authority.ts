import { getAuthSessionRevision, getAuthSnapshot, hasPermission, mojoGet, type Me } from '../../client/runtime';
import { DNS_MANAGE_PERMISSIONS } from './models';

export const domainSession = () => `${getAuthSnapshot().uid}:${getAuthSessionRevision()}`;

/** Check the current interactive authority immediately before an onboarding write. */
export async function requireDomainManager(session: string, platform = false): Promise<void> {
    if (domainSession() !== session || !getAuthSnapshot().authenticated) throw new Error('Session changed. Reopen this task.');
    const me = await mojoGet<Me>('/api/user', 'me');
    if (domainSession() !== session || !hasPermission(me, DNS_MANAGE_PERMISSIONS, null) || platform && me.is_superuser !== true) throw new Error('DNS authority changed. Reopen this task.');
}
