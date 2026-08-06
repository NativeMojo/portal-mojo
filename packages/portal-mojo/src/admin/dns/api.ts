import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
    mojoCall, mojoList, withFreshAuth, type MojoList, type Params,
} from '../../client';
import {
    DnsCredentialModel, sanitizeCertificateRow, sanitizeDnsCredentialRow, sanitizeDomainRow,
    sanitizeRegistrarDiscoveryResponse,
    type CertificateRow, type DnsCapabilities, type DnsCredentialRow,
    type DnsGroupChoice, type DnsProviderCapability, type DnsRecordRow,
    type DnsRecordSetResponse, type DomainRow, type RegistrarQuote,
    type RegistrarDiscoveryResponse, type RegistrarSearchRow, type RegistrantContact, type RegistrantContactResponse,
    type WhoisResponse,
} from './models';
import { recordKey, sameRecordOwnerSnapshot, snapshotRecordOwner, type RecordOwnerSnapshot } from './dns-data';

export const DNS_GROUP_CHOICE_ENDPOINT = '/api/dnsman/credential/group-choice';

export const dnsKeys = {
    root: ['dnsman'] as const,
    capabilities: (group?: number | null) => ['dnsman', 'config', group ?? 'global'] as const,
    groupChoices: (params: Params) => ['dnsman', 'credential-group-choice', params] as const,
    groupChoice: (id: number) => ['dnsman', 'credential-group-choice', 'one', id] as const,
    records: (domainId: number) => ['dnsman', 'records', domainId] as const,
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

function groupChoiceInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
    const input = value == null ? fallback : value;
    if (typeof input === 'boolean' || (typeof input !== 'string' && typeof input !== 'number')) {
        throw new Error('Invalid credential group-choice query');
    }
    if (typeof input === 'string' && !/^[0-9]+$/.test(input)) {
        throw new Error('Invalid credential group-choice query');
    }
    const parsed = typeof input === 'number' ? input : Number(input);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error('Invalid credential group-choice query');
    }
    return parsed;
}

export function normalizeGroupChoiceParams(params: Params): Params {
    const keys = Object.keys(params).filter((key) => params[key] != null);
    if (keys.some((key) => !['id', 'search', 'start', 'size'].includes(key))) throw new Error('Invalid credential group-choice query');
    if (keys.includes('id')) {
        if (keys.length !== 1) throw new Error('Invalid credential group-choice query');
        const input = params.id;
        if (typeof input === 'boolean' || (typeof input !== 'string' && typeof input !== 'number')) {
            throw new Error('Invalid credential group-choice query');
        }
        const text = String(input);
        if (!/^[0-9]+$/.test(text) || BigInt(text) < 1n || BigInt(text) > 9223372036854775807n) throw new Error('Invalid credential group-choice query');
        return { id: text };
    }
    const searchInput = params.search;
    if (searchInput != null && typeof searchInput !== 'string') throw new Error('Invalid credential group-choice query');
    const search = (searchInput ?? '').trim();
    const start = groupChoiceInteger(params.start, 0, 0, 100000);
    const size = groupChoiceInteger(params.size, 25, 1, 50);
    if (search.length > 100) {
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

export async function purchaseDomain(input: { group: number; purchase: number; confirm_token: string }): Promise<DomainRow> {
    return sanitizeDomainRow(await postData<DomainRow>('/api/dnsman/registrar/purchase', input));
}

export async function registerExistingDomain(input: { group: number; domain: string; credential: number }): Promise<DomainRow> {
    return sanitizeDomainRow(await postData<DomainRow>('/api/dnsman/registrar/register-existing', input));
}

export async function discoverHouseDomains(untracked = false): Promise<RegistrarDiscoveryResponse> {
    const response = await mojoCall('/api/dnsman/registrar/discover', { params: { untracked } });
    return sanitizeRegistrarDiscoveryResponse(response.data);
}

export async function adoptHouseDomain(input: { domain: string; group?: number; create_zone?: boolean }): Promise<DomainRow> {
    return sanitizeDomainRow(await postData<DomainRow>('/api/dnsman/registrar/adopt', input));
}

export async function assignHouseDomain(input: { domain: number; group: number }): Promise<DomainRow> {
    return sanitizeDomainRow(await postData<DomainRow>('/api/dnsman/registrar/assign-group', input));
}

export function parseDnsRecordSetResponse(value: unknown): DnsRecordSetResponse {
    const payload = object(value, 'record response');
    if (Object.keys(payload).some((key) => !['domain', 'provider', 'records'].includes(key))) throw new Error('DNS administration unavailable: malformed record response');
    if (typeof payload.domain !== 'string' || !payload.domain || typeof payload.provider !== 'string' || !payload.provider || !Array.isArray(payload.records)) {
        throw new Error('DNS administration unavailable: malformed record response');
    }
    const records = payload.records.map((value, index): DnsRecordRow => {
        const record = object(value, `records[${index}]`);
        if (Object.keys(record).some((key) => !['type', 'name', 'record_values', 'ttl'].includes(key))) throw new Error(`DNS administration unavailable: malformed records[${index}]`);
        if (typeof record.type !== 'string' || !record.type || typeof record.name !== 'string' || !record.name
            || !Array.isArray(record.record_values) || record.record_values.some((item) => typeof item !== 'string')
            || !Number.isInteger(record.ttl) || Number(record.ttl) < 0 || 'id' in record) {
            throw new Error(`DNS administration unavailable: malformed records[${index}]`);
        }
        return { type: record.type, name: record.name, record_values: [...record.record_values] as string[], ttl: Number(record.ttl) };
    });
    return { domain: payload.domain, provider: payload.provider, records };
}

/** Direct, uncached read used for confirmation-window preflight/reconciliation. */
export async function fetchDnsRecords(domain: number): Promise<DnsRecordSetResponse> {
    const response = await mojoCall('/api/dnsman/dns', { params: { domain } });
    return parseDnsRecordSetResponse(response.data);
}

/** Compatibility alias; unlike #1429 it remains strictly id-less. */
export const listDnsRecords = fetchDnsRecords;

export function useDnsRecords(domain: number | null, enabled = true) {
    return useQuery({
        queryKey: dnsKeys.records(domain ?? 0),
        queryFn: () => fetchDnsRecords(domain!),
        enabled: enabled && domain != null,
    });
}

export interface DnsWriteResponse { status: true; provider: string; change_id: string | null }
export function parseDnsWriteResponse(value: unknown): DnsWriteResponse {
    const response = object(value, 'record write response');
    if (Object.keys(response).some((key) => !['status', 'provider', 'change_id'].includes(key))
        || response.status !== true || typeof response.provider !== 'string' || !response.provider
        || !(typeof response.change_id === 'string' || response.change_id === null)) {
        throw new Error('DNS administration unavailable: malformed record write response');
    }
    return { status: true, provider: response.provider, change_id: response.change_id };
}
export async function upsertDnsRecord(domain: number, record: DnsRecordRow): Promise<DnsWriteResponse> {
    const response = await mojoCall('/api/dnsman/dns', { method: 'POST', body: {
        domain, type: record.type, name: record.name,
        record_values: record.record_values, ttl: record.ttl,
    } });
    return parseDnsWriteResponse(response);
}

export async function deleteDnsRecordSet(domain: number, record: Pick<DnsRecordRow, 'type' | 'name'>): Promise<DnsWriteResponse> {
    const response = await mojoCall('/api/dnsman/dns/delete', { method: 'POST', body: { domain, type: record.type, name: record.name } });
    return parseDnsWriteResponse(response);
}
export const deleteDnsRecord = deleteDnsRecordSet;

export class DnsStaleSnapshotError extends Error {
    constructor() { super('The live record set changed after this editor opened. Refresh and review the new values before trying again.'); this.name = 'DnsStaleSnapshotError'; }
}
export interface DnsOperationResult<T> {
    response?: T;
    live: DnsRecordSetResponse | null;
    applied: boolean;
    ambiguousApplied: boolean;
}
export interface CoordinateDnsOperationOptions<T> {
    opening: RecordOwnerSnapshot;
    fetchFresh: () => Promise<DnsRecordSetResponse>;
    write: () => Promise<T>;
    intended: DnsRecordRow | null;
    reconcile?: (live: DnsRecordSetResponse) => void | Promise<void>;
    /** Required cache-safety boundary after every attempted write. */
    invalidate: () => void | Promise<void>;
}
function intendedMatches(live: DnsRecordSetResponse, intended: DnsRecordRow | null, opening: RecordOwnerSnapshot): boolean {
    const exact = live.records.find((record) => recordKey(record) === opening.key) ?? null;
    if (intended == null) return exact == null;
    return !!exact && exact.ttl === intended.ttl && exact.type === intended.type && exact.name.toLowerCase().replace(/\.+$/, '') === intended.name.toLowerCase().replace(/\.+$/, '')
        && exact.record_values.length === intended.record_values.length && exact.record_values.every((value, index) => value === intended.record_values[index]);
}

/** Executable confirm -> fresh preflight -> immediate write -> finally reconcile sequence. */
export async function coordinateDnsRecordOperation<T>(options: CoordinateDnsOperationOptions<T>): Promise<DnsOperationResult<T>> {
    const preflight = await options.fetchFresh();
    const current = snapshotRecordOwner(preflight.records, options.opening.exact?.type ?? options.intended?.type ?? options.opening.key.split('|')[0]!, options.opening.owner);
    if (!sameRecordOwnerSnapshot(options.opening, current)) {
        await options.reconcile?.(preflight);
        throw new DnsStaleSnapshotError();
    }
    let response: T | undefined;
    let requestError: unknown;
    let reconciliationError: unknown;
    let invalidationError: unknown;
    let live: DnsRecordSetResponse | null = null;
    try {
        response = await options.write();
    } catch (error) {
        requestError = error;
    } finally {
        try {
            live = await options.fetchFresh();
            await options.reconcile?.(live);
        } catch (error) {
            reconciliationError = error;
        }
        try {
            await options.invalidate();
        } catch (error) {
            invalidationError = error;
        }
    }
    const applied = live != null && intendedMatches(live, options.intended, options.opening);
    if (requestError) {
        if (applied) {
            const error = requestError instanceof Error ? requestError : new Error(String(requestError));
            Object.assign(error, { dnsLiveStateApplied: true });
        }
        throw requestError;
    }
    if (reconciliationError) throw reconciliationError;
    if (invalidationError) throw invalidationError;
    return { response, live, applied, ambiguousApplied: false };
}

export function useDnsRecordCoordinator(domain: number) {
    const queryClient = useQueryClient();
    return async <T>(options: Omit<CoordinateDnsOperationOptions<T>, 'fetchFresh' | 'reconcile' | 'invalidate'>) => coordinateDnsRecordOperation({
        ...options,
        fetchFresh: () => fetchDnsRecords(domain),
        reconcile: async (live) => {
            queryClient.setQueryData(dnsKeys.records(domain), live);
        },
        invalidate: async () => {
            await queryClient.invalidateQueries({ queryKey: dnsKeys.records(domain) });
        },
    });
}

export async function resolveDnsDomainByName(normalizedName: string): Promise<number | null> {
    const target = normalizedName.trim().toLowerCase().replace(/\.+$/, '');
    if (!target) return null;
    const page = await mojoList<DomainRow>(DomainModel.endpoint, DomainModel.normalizeListParams?.({ search: target, sort: 'name', size: 50 }) ?? { search: target, sort: 'name', size: 50 });
    const exact = page.rows.map(sanitizeDomainRow).find((row) => row.name.toLowerCase().replace(/\.+$/, '') === target);
    return exact && Number.isInteger(exact.id) && exact.id > 0 ? exact.id : null;
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
