import { mojoCall } from '../../client/runtime';
import { sanitizeDomainRow, type DomainRow } from './models';

/** Registrar writes are deliberately narrower than the generic model surface. */
export async function saveDomainRegistrarSettings(id: number, changes: Partial<Pick<DomainRow, 'auto_renew' | 'privacy'>>): Promise<void> {
    if (Object.keys(changes).length === 0 || Object.entries(changes).some(([key, value]) => !['auto_renew', 'privacy'].includes(key) || typeof value !== 'boolean')) throw new Error('Only changed boolean registrar settings may be saved');
    await mojoCall(`/api/dnsman/domain/${id}`, { method: 'POST', body: { ...changes } });
}

/** Authoritative uncached read after every attempted registrar write. */
export async function fetchDomainOverview(id: number): Promise<DomainRow> {
    return sanitizeDomainRow((await mojoCall(`/api/dnsman/domain/${id}`)).data);
}
