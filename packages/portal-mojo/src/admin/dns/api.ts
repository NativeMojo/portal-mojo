import { useQuery, type QueryClient } from '@tanstack/react-query';
import {
    mojoCall, mojoList, withFreshAuth, type MojoList, type Params,
} from '../../client';
import {
    DnsCredentialModel, sanitizeCertificateRow, sanitizeDnsCredentialRow,
    type CertificateRow, type DnsCapabilities, type DnsCredentialRow,
    type DnsGroupChoice, type DnsProviderCapability, type DnsRecordRow,
    type DnsRecordSetResponse, type DomainRow, type RegistrarQuote,
    type RegistrarSearchRow, type RegistrantContact, type RegistrantContactResponse,
    type WhoisResponse,
} from './models';
import { dnsRecordKey } from './data';

export const DNS_GROUP_CHOICE_ENDPOINT = '/api/dnsman/credential/group-choice';

export const dnsKeys = {
    root: ['dnsman'] as const,
    capabilities: (group?: number | null) => ['dnsman', 'config', group ?? 'global'] as const,
    groupChoices: (params: Params) => ['dnsman', 'credential-group-choice', params] as const,
    groupChoice: (id: number) => ['dnsman', 'credential-group-choice', 'one', id] as const,
};

function object(value: unknown, where: string): Record<string, unknown> {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`DNS administration unavailable: malformed ${where}`);
    }
    return value as Record<string, unknown>;
}

function boolean(value: unknown, where: string): boolean {
    if (typeof value !== 'boolean') throw new Error(`DNS administration unavailable: malformed ${where}`);
    return value;
}

function string(value: unknown, where: string, nullable = false): string | null {
    if (nullable && value === null) return null;
    if (typeof value !== 'string') throw new Error(`DNS administration unavailable: malformed ${where}`);
    return value;
}

function integer(value: unknown, where: string, min = 0): number {
    if (!Number.isInteger(value) || Number(value) < min) throw new Error(`DNS administration unavailable: malformed ${where}`);
    return Number(value);
}

export function parseDnsCapabilities(value: unknown): DnsCapabilities {
    const raw = object(value, 'capability response');
    const providersRaw = raw.providers;
    if (!Array.isArray(providersRaw) || providersRaw.length === 0) {
        throw new Error('DNS administration unavailable: malformed providers');
    }
    const providers: DnsProviderCapability[] = providersRaw.map((item, index) => {
        const provider = object(item, `providers[${index}]`);
        return {
            name: string(provider.name, `providers[${index}].name`) as string,
            purchase: boolean(provider.purchase, `providers[${index}].purchase`),
            requires_credential: boolean(provider.requires_credential, `providers[${index}].requires_credential`),
        };
    });
    const recordTypes = raw.allowed_record_types;
    if (!Array.isArray(recordTypes) || recordTypes.some((type) => typeof type !== 'string' || !type)) {
        throw new Error('DNS administration unavailable: malformed allowed_record_types');
    }
    const acme = object(raw.acme, 'acme');
    const delegated = object(raw.delegated_acme, 'delegated_acme');
    return {
        purchase_enabled: boolean(raw.purchase_enabled, 'purchase_enabled'),
        registrant_contact_configured: boolean(raw.registrant_contact_configured, 'registrant_contact_configured'),
        max_domain_price: string(raw.max_domain_price, 'max_domain_price') as string,
        currency: string(raw.currency, 'currency') as string,
        quote_ttl_minutes: integer(raw.quote_ttl_minutes, 'quote_ttl_minutes', 1),
        allowed_record_types: [...recordTypes] as string[],
        search_batch_limit: integer(raw.search_batch_limit, 'search_batch_limit', 1),
        suggestions_enabled: boolean(raw.suggestions_enabled, 'suggestions_enabled'),
        providers,
        acme: {
            configured: boolean(acme.configured, 'acme.configured'),
            staging: boolean(acme.staging, 'acme.staging'),
        },
        delegated_acme: {
            available: boolean(delegated.available, 'delegated_acme.available'),
            record_type: string(delegated.record_type, 'delegated_acme.record_type') as string,
            target_suffix: string(delegated.target_suffix, 'delegated_acme.target_suffix', true),
            profile: string(delegated.profile, 'delegated_acme.profile') as string,
            requires_provider_credentials: boolean(
                delegated.requires_provider_credentials,
                'delegated_acme.requires_provider_credentials',
            ),
        },
        cert_renew_days: integer(raw.cert_renew_days, 'cert_renew_days', 1),
    };
}

export async function fetchDnsCapabilities(group?: number | null): Promise<DnsCapabilities> {
    const response = await mojoCall('/api/dnsman/config', {
        ...(group == null ? {} : { params: { group } }),
    });
    return parseDnsCapabilities(response.data);
}

export function useDnsCapabilities(group?: number | null, opts: { enabled?: boolean } = {}) {
    return useQuery({
        queryKey: dnsKeys.capabilities(group),
        queryFn: () => fetchDnsCapabilities(group),
        enabled: opts.enabled !== false,
    });
}

function normalizeGroupChoiceParams(params: Params): Params {
    const keys = Object.keys(params).filter((key) => params[key] != null && params[key] !== '');
    if (keys.some((key) => !['id', 'search', 'start', 'size'].includes(key))) throw new Error('Invalid credential group-choice query');
    if (keys.includes('id')) {
        if (keys.length !== 1) throw new Error('Invalid credential group-choice query');
        const text = String(params.id);
        if (!/^[0-9]+$/.test(text) || BigInt(text) < 1n || BigInt(text) > 9223372036854775807n) {
            throw new Error('Invalid credential group-choice query');
        }
        return { id: text };
    }
    const search = String(params.search ?? '').trim();
    const start = Number(params.start ?? 0);
    const size = Number(params.size ?? 25);
    if (search.length > 100 || !Number.isInteger(start) || start < 0 || start > 100000
        || !Number.isInteger(size) || size < 1 || size > 50) {
        throw new Error('Invalid credential group-choice query');
    }
    return { ...(search ? { search } : {}), start, size };
}

export async function fetchDnsGroupChoices(params: Params = {}): Promise<MojoList<DnsGroupChoice>> {
    const safe = normalizeGroupChoiceParams(params);
    return mojoList<DnsGroupChoice>(DNS_GROUP_CHOICE_ENDPOINT, safe);
}

export async function fetchDnsGroupChoice(id: number): Promise<DnsGroupChoice | null> {
    const result = await fetchDnsGroupChoices({ id });
    return result.rows[0] ?? null;
}

export function useDnsGroupChoice(id: number | null) {
    return useQuery({
        queryKey: dnsKeys.groupChoice(id ?? 0),
        queryFn: () => fetchDnsGroupChoice(id!),
        enabled: id != null,
    });
}

export interface LinkDnsCredentialInput {
    group: number;
    provider: string;
    name?: string;
    api_key: string;
    api_secret: string;
}

async function submitCredential(body: Record<string, unknown>): Promise<DnsCredentialRow> {
    const response = await withFreshAuth(() => mojoCall('/api/dnsman/credential/link', {
        method: 'POST', body,
    }));
    return sanitizeDnsCredentialRow(response.data as DnsCredentialRow);
}

export async function linkDnsCredential(input: LinkDnsCredentialInput): Promise<DnsCredentialRow> {
    if (!Number.isInteger(input.group) || input.group < 1) throw new Error('Choose a group');
    return submitCredential({ ...input });
}

export async function rotateDnsCredential(
    row: DnsCredentialRow,
    input: Pick<LinkDnsCredentialInput, 'name' | 'api_key' | 'api_secret'>,
): Promise<DnsCredentialRow> {
    const group = typeof row.group === 'number' ? row.group : row.group?.id;
    if (!group) throw new Error('This credential has no valid group');
    return submitCredential({
        group, provider: row.provider, credential: row.id,
        name: input.name ?? row.name, api_key: input.api_key, api_secret: input.api_secret,
    });
}

async function postData<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return (await mojoCall(path, { method: 'POST', body })).data as T;
}

export function searchRegistrar(domain: string): Promise<RegistrarSearchRow> {
    return postData('/api/dnsman/registrar/search', { domain });
}

export function searchRegistrarBatch(input: { domain?: string; domains?: string[]; tlds?: string[] }): Promise<{ results: RegistrarSearchRow[] }> {
    return postData('/api/dnsman/registrar/search', input);
}

export function suggestRegistrar(input: { domain: string; count?: number; only_available?: boolean }): Promise<{ results: RegistrarSearchRow[] }> {
    return postData('/api/dnsman/registrar/suggest', input);
}

/** Returns a one-use token; consumers must keep it transient and uncached. */
export function quoteDomain(input: { group: number; domain: string; years?: number }): Promise<RegistrarQuote> {
    return postData('/api/dnsman/registrar/quote', input);
}

export function purchaseDomain(input: { group: number; purchase: number; confirm_token: string }): Promise<DomainRow> {
    return postData('/api/dnsman/registrar/purchase', input);
}

export function registerExistingDomain(input: { group: number; domain: string; credential: number }): Promise<DomainRow> {
    return postData('/api/dnsman/registrar/register-existing', input);
}

export async function discoverHouseDomains(untracked = false): Promise<unknown[]> {
    const response = await mojoCall('/api/dnsman/registrar/discover', { params: { untracked } });
    return response.data as unknown[];
}

export function adoptHouseDomain(input: { domain: string; group?: number; create_zone?: boolean }): Promise<DomainRow> {
    return postData('/api/dnsman/registrar/adopt', input);
}

export function assignHouseDomain(input: { domain: number; group: number }): Promise<DomainRow> {
    return postData('/api/dnsman/registrar/assign-group', input);
}

export async function listDnsRecords(domain: number): Promise<DnsRecordSetResponse> {
    const response = await mojoCall('/api/dnsman/dns', { params: { domain } });
    const payload = response.data as DnsRecordSetResponse;
    return { ...payload, records: payload.records.map((record) => ({ ...record, id: dnsRecordKey(record) })) };
}

export function upsertDnsRecord(domain: number, record: DnsRecordRow): Promise<{ status: true; change_id: string; provider: string }> {
    return postData('/api/dnsman/dns', {
        domain, type: record.type, name: record.name,
        record_values: record.record_values, ttl: record.ttl,
    });
}

export function deleteDnsRecord(domain: number, record: Pick<DnsRecordRow, 'type' | 'name'> & { record_values?: string[] }): Promise<{ status: true; change_id: string; provider: string }> {
    return postData('/api/dnsman/dns/delete', { domain, ...record });
}

/** Legal-contact PII: imperative and deliberately outside Query. */
export async function getRegistrantContact(group?: number | null): Promise<RegistrantContactResponse> {
    const response = await mojoCall('/api/dnsman/registrant', group == null ? {} : { params: { group } });
    return response.data as RegistrantContactResponse;
}

export function saveRegistrantContact(contact: RegistrantContact, group?: number | null): Promise<RegistrantContactResponse> {
    return postData('/api/dnsman/registrant', group == null ? { contact } : { group, contact });
}

export function clearRegistrantContact(group?: number | null): Promise<RegistrantContactResponse> {
    return postData('/api/dnsman/registrant', group == null ? { clear: true } : { group, clear: true });
}

/** Registrar PII: imperative and deliberately outside Query. */
export async function getWhois(domain: number): Promise<WhoisResponse> {
    const response = await mojoCall('/api/dnsman/whois', { params: { domain } });
    return response.data as WhoisResponse;
}

export function updateWhois(domain: number, contact: RegistrantContact): Promise<{ name: string; operation_id: string }> {
    return postData('/api/dnsman/whois', { domain, contact });
}

export function setWhoisPrivacy(domain: number, enabled: boolean): Promise<{ name: string; privacy: boolean; operation_id: string }> {
    return postData('/api/dnsman/whois/privacy', { domain, enabled });
}

export async function requestCertificate(domain: number, names?: string[]): Promise<CertificateRow> {
    return sanitizeCertificateRow(await postData<CertificateRow>('/api/dnsman/certificate/request', {
        domain, ...(names ? { names } : {}),
    }));
}

export async function revokeCertificate(certificate: number): Promise<CertificateRow> {
    return sanitizeCertificateRow(await postData<CertificateRow>('/api/dnsman/certificate/revoke', { certificate }));
}

export async function invalidateDnsCredentials(queryClient: QueryClient): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: DnsCredentialModel.keys.root });
}
