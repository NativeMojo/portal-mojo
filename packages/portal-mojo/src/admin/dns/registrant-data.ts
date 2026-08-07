import type { RegistrantContact, RegistrantContactResponse } from './models';

export const CONTACT_STRING_FIELDS = ['FirstName', 'LastName', 'ContactType', 'OrganizationName', 'AddressLine1', 'AddressLine2', 'City', 'State', 'CountryCode', 'ZipCode', 'PhoneNumber', 'Email', 'Fax'] as const;
const CONTACT_TYPES = new Set(['PERSON', 'COMPANY', 'ASSOCIATION', 'PUBLIC_BODY', 'RESELLER']);

export function sanitizeRegistrantResponse(value: unknown): RegistrantContactResponse {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    if (!['group', 'global'].includes(String(raw.scope)) || !(raw.group == null || Number.isInteger(raw.group)) || !['database', 'settings_file', 'none'].includes(String(raw.source)) || typeof raw.inherited !== 'boolean' || typeof raw.effective_configured !== 'boolean' || !Array.isArray(raw.problems)) throw new Error('Registrant contact response is malformed');
    let contact: RegistrantContact | null = null;
    if (raw.contact != null) {
        if (typeof raw.contact !== 'object' || Array.isArray(raw.contact)) throw new Error('Registrant contact response is malformed');
        const source = raw.contact as Record<string, unknown>; contact = {};
        for (const key of CONTACT_STRING_FIELDS) if (typeof source[key] === 'string') contact[key] = source[key].slice(0, 500);
        if (Array.isArray(source.ExtraParams)) contact.ExtraParams = source.ExtraParams.slice(0, 25).flatMap((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
            const entry = item as Record<string, unknown>;
            return typeof entry.Name === 'string' && typeof entry.Value === 'string' ? [{ Name: entry.Name.slice(0, 100), Value: entry.Value.slice(0, 500) }] : [];
        });
    }
    return { scope: raw.scope as 'group' | 'global', group: raw.group as number | null, contact, source: String(raw.source) as RegistrantContactResponse['source'], inherited: raw.inherited, effective_configured: raw.effective_configured, problems: raw.problems.filter((item): item is string => typeof item === 'string').slice(0, 20).map((item) => item.slice(0, 300)) };
}

export function contactDraft(response: RegistrantContactResponse): RegistrantContact {
    if (!response.contact || response.inherited) return {};
    const draft: RegistrantContact = {};
    for (const key of CONTACT_STRING_FIELDS) {
        if (key === 'Fax' && response.source !== 'database') continue;
        if (typeof response.contact[key] === 'string') draft[key] = response.contact[key];
    }
    if (response.source === 'database' && response.contact.ExtraParams) draft.ExtraParams = response.contact.ExtraParams.map((entry) => ({ ...entry }));
    return draft;
}
export function contactPayload(draft: RegistrantContact, original: RegistrantContactResponse, scope: { group: number | null }): RegistrantContact {
    const payload: RegistrantContact = {};
    const sameScopeDatabase = original.source === 'database' && original.scope === (scope.group == null ? 'global' : 'group') && original.group === scope.group;
    for (const key of CONTACT_STRING_FIELDS) {
        if (key === 'Fax' && !sameScopeDatabase) continue;
        const value = draft[key]; if (typeof value === 'string' && value.trim()) payload[key] = key === 'CountryCode' || key === 'ContactType' ? value.trim().toUpperCase() : value.trim();
    }
    if (sameScopeDatabase && original.contact?.ExtraParams) payload.ExtraParams = original.contact.ExtraParams.map((entry) => ({ ...entry }));
    return payload;
}
export function validateContactDraft(contact: RegistrantContact): string[] {
    const required = ['FirstName', 'LastName', 'ContactType', 'AddressLine1', 'City', 'CountryCode', 'ZipCode', 'PhoneNumber', 'Email'] as const;
    const problems = required.filter((key) => !String(contact[key] ?? '').trim()).map((key) => `${key} is required`);
    if (contact.ContactType && !CONTACT_TYPES.has(contact.ContactType.toUpperCase())) problems.push('ContactType is invalid');
    if (contact.CountryCode && !/^[A-Za-z]{2}$/.test(contact.CountryCode)) problems.push('CountryCode must be two letters');
    if (contact.PhoneNumber && !/^\+\d{1,3}\.\d{4,15}$/.test(contact.PhoneNumber)) problems.push('PhoneNumber must use +country.number format');
    if (contact.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.Email)) problems.push('Email is invalid');
    if (['US', 'CA'].includes(String(contact.CountryCode ?? '').toUpperCase()) && !String(contact.State ?? '').trim()) problems.push('State is required for US and CA contacts');
    return problems;
}
