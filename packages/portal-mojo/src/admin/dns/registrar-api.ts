import { mojoCall } from '../../client/runtime';
import { sanitizeDomainRow, type DomainRow, type RegistrantContact } from './models';
import { CONTACT_STRING_FIELDS, validateContactDraft } from './registrant-data';
export interface RegistrationRequest { signal?: AbortSignal; beforeSend?: () => void }
export interface DomainRegistration {
    name: string; registrar: string | null; auto_renew: boolean | null;
    privacy: boolean | null; admin_privacy: boolean | null; registrant_privacy: boolean | null; tech_privacy: boolean | null;
    privacy_supported: boolean | null; expires: number | string | null;
    registrant: RegistrantContact; admin: RegistrantContact; tech: RegistrantContact;
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const bool = (value: unknown) => typeof value === 'boolean' ? value : null;
const name = (value: string) => value.toLowerCase().replace(/\.+$/, '');
export function registrationAuthority(registrar: string | null): 'route53' | 'godaddy' | 'unknown' {
    const value = (registrar ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['amazonregistrarinc', 'amazonregistrar', 'route53', 'amazonroute53'].includes(value)) return 'route53';
    if (value.startsWith('godaddy')) return 'godaddy';
    return 'unknown';
}
export function registrationContact(value: unknown): RegistrantContact {
    const source = object(value), contact: RegistrantContact = {};
    for (const key of CONTACT_STRING_FIELDS) if (typeof source[key] === 'string') contact[key] = source[key].slice(0, 500);
    if (Array.isArray(source.ExtraParams)) contact.ExtraParams = source.ExtraParams.slice(0, 25).flatMap(value => {
        const entry = object(value);
        return typeof entry.Name === 'string' && typeof entry.Value === 'string' ? [{ Name: entry.Name.slice(0, 100), Value: entry.Value.slice(0, 500) }] : [];
    });
    return contact;
}
export async function fetchDomainRegistration(domain: Pick<DomainRow, 'id' | 'name'>, options: RegistrationRequest = {}): Promise<DomainRegistration> {
    const row = object((await mojoCall('/api/dnsman/whois', { ...options, unscoped: true, params: { domain: domain.id } })).data);
    options.beforeSend?.();
    if (typeof row.name !== 'string' || name(row.name) !== name(domain.name)) throw new Error('Registration identity changed');
    return { name: domain.name, registrar: typeof row.registrar === 'string' ? row.registrar.slice(0, 200) : null,
        auto_renew: bool(row.auto_renew), privacy: bool(row.privacy), admin_privacy: bool(row.admin_privacy), registrant_privacy: bool(row.registrant_privacy), tech_privacy: bool(row.tech_privacy), privacy_supported: bool(row.privacy_supported),
        expires: typeof row.expires === 'number' || typeof row.expires === 'string' ? row.expires : null,
        registrant: registrationContact(row.registrant), admin: registrationContact(row.admin), tech: registrationContact(row.tech) };
}
/** The generic model hook is best-effort; only a subsequent WHOIS read is live evidence. */
export async function saveDomainRegistrarSettings(id: number, changes: Partial<Pick<DomainRow, 'auto_renew' | 'privacy'>>, options: RegistrationRequest = {}): Promise<void> {
    if (!Object.keys(changes).length || Object.entries(changes).some(([key, value]) => !['auto_renew', 'privacy'].includes(key) || typeof value !== 'boolean')) throw new Error('Only changed boolean registrar settings may be saved');
    await mojoCall(`/api/dnsman/domain/${id}`, { ...options, unscoped: true, method: 'POST', body: { ...changes } }); options.beforeSend?.();
}
async function registrarOperation(domain: Pick<DomainRow, 'id' | 'name'>, path: string, body: Record<string, unknown>, options: RegistrationRequest): Promise<string> {
    const row = object((await mojoCall(path, { ...options, unscoped: true, method: 'POST', body: { domain: domain.id, ...body } })).data);
    options.beforeSend?.();
    if (typeof row.name !== 'string' || name(row.name) !== name(domain.name) || typeof row.operation_id !== 'string' || !row.operation_id) throw new Error('Registrar receipt could not be confirmed');
    return row.operation_id.slice(0, 200);
}
export const saveRegistrationPrivacy = (domain: Pick<DomainRow, 'id' | 'name'>, enabled: boolean, options: RegistrationRequest = {}) => registrarOperation(domain, '/api/dnsman/whois/privacy', { enabled }, options);
export function saveRegistrationContacts(domain: Pick<DomainRow, 'id' | 'name'>, contact: RegistrantContact, options: RegistrationRequest = {}) {
    const safe = registrationContact(contact);
    if (validateContactDraft(safe).length) throw new Error('Complete the required contact and address fields');
    return registrarOperation(domain, '/api/dnsman/whois', { contact: safe }, options);
}
/** Safe model projection: no registrar PII enters the model cache. */
export async function fetchDomainOverview(id: number, options: RegistrationRequest = {}): Promise<DomainRow> {
    const row = sanitizeDomainRow((await mojoCall(`/api/dnsman/domain/${id}`, { ...options, unscoped: true, params: { graph: 'default' } })).data);
    options.beforeSend?.(); if (row.id !== id) throw new Error('Domain identity changed'); return row;
}
