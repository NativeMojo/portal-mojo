import { defineModel, type Params } from '../../client';
import { sanitizeCertificateRow } from './certificate-data';

export { sanitizeCertificateRow } from './certificate-data';

export const DNS_VIEW_PERMISSIONS = ['sys.view_dns', 'sys.manage_dns', 'sys.security'];
export const DNS_MANAGE_PERMISSIONS = ['sys.manage_dns', 'sys.security'];

export interface DnsGroupChoice extends Record<string, unknown> { id: number; name: string }
export interface DnsGroupBasic extends DnsGroupChoice { is_active?: boolean; kind?: string }

export interface DnsUserBasic {
    id: number;
    display_name?: string;
    username?: string;
    last_login?: number | null;
    last_activity?: number | null;
    is_active?: boolean;
    is_email_verified?: boolean;
    is_phone_verified?: boolean;
    is_dob_verified?: boolean;
    avatar?: string | null;
}

export interface DnsProviderCapability {
    name: string;
    purchase: boolean;
    requires_credential: boolean;
}

export interface DnsCapabilities {
    purchase_enabled: boolean;
    registrant_contact_configured: boolean;
    max_domain_price: string;
    currency: string;
    quote_ttl_minutes: number;
    allowed_record_types: string[];
    search_batch_limit: number;
    suggestions_enabled: boolean;
    providers: DnsProviderCapability[];
    acme: { configured: boolean; staging: boolean };
    delegated_acme: {
        available: boolean;
        record_type: string;
        target_suffix: string | null;
        profile: string;
        requires_provider_credentials: boolean;
    };
    cert_renew_days: number;
}

export interface DnsCredentialRow {
    id: number;
    created: number;
    modified: number;
    name: string;
    provider: string;
    is_active: boolean;
    verified: boolean;
    verified_at: number | null;
    domain_count: number;
    last_error: string | null;
    api_key_masked: string;
    api_secret_masked: string;
    group: DnsGroupBasic | number | null;
}

export interface DomainRow {
    id: number;
    created: number;
    modified?: number;
    name: string;
    provider: string;
    status: string;
    expires: number | null;
    hosted_zone_id?: string | null;
    auto_renew?: boolean;
    privacy?: boolean;
    verified?: boolean;
    registered_on?: number | null;
    last_error?: string | null;
    group: DnsGroupBasic | number | null;
    user?: DnsUserBasic | null;
    credential?: Pick<DnsCredentialRow, 'id' | 'name' | 'provider' | 'is_active' | 'verified'> | number | null;
}

export interface DomainPurchaseRow {
    id: number;
    created: number;
    modified: number;
    domain_name: string;
    kind: string;
    status: string;
    price: string | number | null;
    cost: string | number | null;
    currency: string;
    years: number;
    quote_expires: number | null;
    operation_id: string | null;
    error: string | null;
    group: DnsGroupBasic | number | null;
    user: DnsUserBasic | null;
}

export interface CertificateRow {
    id: number;
    created: number;
    modified: number;
    common_name: string;
    sans: string[];
    status: string;
    issuer: string | null;
    serial: string | null;
    not_before: number | null;
    not_after: number | null;
    renew_after: number | null;
    last_error: string | null;
    attempts: number;
    days_remaining: number | null;
    domain: Pick<DomainRow, 'id' | 'name' | 'provider' | 'status' | 'expires'> | number;
}

export interface DnsRecordRow {
    type: string;
    name: string;
    record_values: string[];
    ttl: number;
}

export interface DnsRecordSetResponse {
    domain: string;
    provider: string;
    records: DnsRecordRow[];
}

export interface RegistrarSearchRow {
    name: string;
    available: boolean | null;
    status: string | null;
    price: string | number | null;
    currency: string | null;
    tld: string | null;
    tld_supported: boolean | null;
    privacy_supported: boolean | null;
    reason: string | null;
}

export interface RegistrarQuote {
    purchase: number;
    name: string;
    price: string | number;
    currency: string;
    years: number;
    /** One-use value. Keep in local call flow only; never Query-cache it. */
    token: string;
    expires: number;
    privacy_supported: boolean;
}

export interface RegistrarPurchaseResult {
    purchase: number;
    domain: number;
    name: string;
    status: string;
    operation_id: string | null;
    privacy: boolean;
    privacy_downgraded: boolean;
}

export interface RegistrarDiscoveryRow {
    name: string;
    registered: boolean;
    hosted_zone: boolean;
    hosted_zone_id: string | null;
    record_count: number | null;
    expires: number | null;
    auto_renew: boolean | null;
    tracked: boolean;
    domain: number | null;
    adoptable: boolean;
    reason: string | null;
}

export interface RegistrarDiscoveryResponse {
    count: number;
    truncated: boolean;
    domains: RegistrarDiscoveryRow[];
}

export interface RegistrantExtraParam { Name: string; Value: string }
export interface RegistrantContact {
    FirstName?: string; LastName?: string; ContactType?: string; OrganizationName?: string;
    AddressLine1?: string; AddressLine2?: string; City?: string; State?: string;
    CountryCode?: string; ZipCode?: string; PhoneNumber?: string; Email?: string;
    Fax?: string; ExtraParams?: RegistrantExtraParam[];
}

export interface RegistrantContactResponse {
    scope: 'group' | 'global';
    group: number | null;
    contact: RegistrantContact | null;
    source: 'database' | 'settings_file' | 'none';
    inherited: boolean;
    effective_configured: boolean;
    problems: string[];
}

export interface WhoisResponse {
    name: string;
    registrant: RegistrantContact;
    admin: RegistrantContact;
    tech: RegistrantContact;
    privacy: boolean;
    admin_privacy: boolean;
    registrant_privacy: boolean;
    tech_privacy: boolean;
    auto_renew: boolean;
    nameservers: string[];
    registrar: string | null;
    registered_on: number | null;
    expires: number | null;
    status_list: string[];
    privacy_supported: boolean;
}

function rowObject(value: unknown): Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function projectGroup(value: unknown): DnsGroupBasic | number | null {
    if (value == null || typeof value === 'number') return value as number | null;
    const raw = rowObject(value);
    return {
        id: raw.id as number,
        name: raw.name as string,
        ...(typeof raw.is_active === 'boolean' ? { is_active: raw.is_active } : {}),
        ...(typeof raw.kind === 'string' ? { kind: raw.kind } : {}),
    };
}

function projectUser(value: unknown): DnsUserBasic | null {
    if (value == null) return null;
    const raw = rowObject(value);
    return {
        id: raw.id as number,
        ...(typeof raw.display_name === 'string' ? { display_name: raw.display_name } : {}),
        ...(typeof raw.username === 'string' ? { username: raw.username } : {}),
        ...(typeof raw.last_login === 'number' || raw.last_login === null ? { last_login: raw.last_login } : {}),
        ...(typeof raw.last_activity === 'number' || raw.last_activity === null ? { last_activity: raw.last_activity } : {}),
        ...(typeof raw.is_active === 'boolean' ? { is_active: raw.is_active } : {}),
        ...(typeof raw.is_email_verified === 'boolean' ? { is_email_verified: raw.is_email_verified } : {}),
        ...(typeof raw.is_phone_verified === 'boolean' ? { is_phone_verified: raw.is_phone_verified } : {}),
        ...(typeof raw.is_dob_verified === 'boolean' ? { is_dob_verified: raw.is_dob_verified } : {}),
        ...(typeof raw.avatar === 'string' || raw.avatar === null ? { avatar: raw.avatar } : {}),
    };
}

function projectCredentialRelation(value: unknown): DomainRow['credential'] {
    if (value == null || typeof value === 'number') return value as number | null;
    const raw = rowObject(value);
    return {
        id: raw.id as number,
        name: raw.name as string,
        provider: raw.provider as string,
        is_active: raw.is_active as boolean,
        verified: raw.verified as boolean,
    };
}

/** Explicit safe graph projectors: unknown/equivalent secret containers drop by default. */
export function sanitizeDnsCredentialRow(row: unknown): DnsCredentialRow {
    const raw = rowObject(row);
    return {
        id: raw.id as number, created: raw.created as number, modified: raw.modified as number,
        name: raw.name as string, provider: raw.provider as string,
        is_active: raw.is_active as boolean, verified: raw.verified as boolean,
        verified_at: raw.verified_at as number | null, domain_count: raw.domain_count as number,
        last_error: raw.last_error as string | null,
        api_key_masked: raw.api_key_masked as string,
        api_secret_masked: raw.api_secret_masked as string,
        group: projectGroup(raw.group),
    };
}

export function sanitizeDomainRow(row: unknown): DomainRow {
    const raw = rowObject(row);
    return {
        id: raw.id as number, created: raw.created as number,
        ...(typeof raw.modified === 'number' ? { modified: raw.modified } : {}),
        name: raw.name as string, provider: raw.provider as string, status: raw.status as string,
        expires: raw.expires as number | null, group: projectGroup(raw.group),
        ...(typeof raw.hosted_zone_id === 'string' || raw.hosted_zone_id === null ? { hosted_zone_id: raw.hosted_zone_id } : {}),
        ...(typeof raw.auto_renew === 'boolean' ? { auto_renew: raw.auto_renew } : {}),
        ...(typeof raw.privacy === 'boolean' ? { privacy: raw.privacy } : {}),
        ...(typeof raw.verified === 'boolean' ? { verified: raw.verified } : {}),
        ...(typeof raw.registered_on === 'number' || raw.registered_on === null ? { registered_on: raw.registered_on } : {}),
        ...(typeof raw.last_error === 'string' || raw.last_error === null ? { last_error: raw.last_error } : {}),
        ...('user' in raw ? { user: projectUser(raw.user) } : {}),
        ...('credential' in raw ? { credential: projectCredentialRelation(raw.credential) } : {}),
    };
}

export function sanitizeDomainPurchaseRow(row: unknown): DomainPurchaseRow {
    const raw = rowObject(row);
    return {
        id: raw.id as number, created: raw.created as number, modified: raw.modified as number,
        domain_name: raw.domain_name as string, kind: raw.kind as string, status: raw.status as string,
        price: raw.price as string | number | null, cost: raw.cost as string | number | null,
        currency: raw.currency as string, years: raw.years as number,
        quote_expires: raw.quote_expires as number | null,
        operation_id: raw.operation_id as string | null, error: raw.error as string | null,
        group: projectGroup(raw.group), user: projectUser(raw.user),
    };
}

export function sanitizeRegistrarDiscoveryResponse(value: unknown): RegistrarDiscoveryResponse {
    const raw = rowObject(value);
    const domains = Array.isArray(raw.domains) ? raw.domains.map((value): RegistrarDiscoveryRow => {
        const row = rowObject(value);
        return {
            name: row.name as string, registered: row.registered as boolean,
            hosted_zone: row.hosted_zone as boolean, hosted_zone_id: row.hosted_zone_id as string | null,
            record_count: row.record_count as number | null, expires: row.expires as number | null,
            auto_renew: row.auto_renew as boolean | null, tracked: row.tracked as boolean,
            domain: row.domain as number | null, adoptable: row.adoptable as boolean,
            reason: row.reason as string | null,
        };
    }) : [];
    return { count: raw.count as number, truncated: raw.truncated as boolean, domains };
}

const COMMON = new Set(['start', 'size', 'search']);

function normalizeListParams(params: Params, filters: ReadonlySet<string>, sorts: ReadonlySet<string>, graph: string): Params {
    const safe: Params = { graph };
    for (const [key, value] of Object.entries(params)) {
        if (value == null || value === '') continue;
        if (COMMON.has(key) || filters.has(key)) safe[key] = value;
    }
    if (typeof params.sort === 'string' && sorts.has(params.sort.replace(/^-/, ''))) safe.sort = params.sort;
    return safe;
}

export function normalizeCredentialListParams(params: Params): Params {
    return normalizeListParams(
        params,
        new Set(['group', 'provider', 'provider__in', 'verified', 'is_active']),
        new Set(['name', 'provider', 'verified', 'is_active', 'domain_count', 'created', 'modified']),
        'default',
    );
}

export function normalizeDomainListParams(params: Params): Params {
    return normalizeListParams(
        params,
        new Set(['group', 'provider', 'status']),
        new Set(['name', 'provider', 'status', 'expires', 'created']),
        'list',
    );
}

export function normalizePurchaseListParams(params: Params): Params {
    if (params.graph != null && params.graph !== '' && params.graph !== 'basic') throw new Error('Purchase lists support only graph=basic');
    for (const key of ['download_format', 'filename', 'export', 'download']) {
        if (params[key] != null && params[key] !== '') throw new Error('Purchase export and download are not available');
    }
    return normalizeListParams(
        params,
        new Set(['group', 'kind', 'status', 'status__in', 'created__gte', 'created__lte']),
        new Set(['domain_name', 'kind', 'status', 'price', 'created']),
        'basic',
    );
}

export function normalizeCertificateListParams(params: Params): Params {
    if (params.graph != null && params.graph !== '' && params.graph !== 'default') {
        throw new Error('Certificate lists support only graph=default');
    }
    for (const key of ['download_format', 'filename', 'export', 'download']) {
        if (params[key] != null && params[key] !== '') throw new Error('Certificate export and download are not available');
    }
    return normalizeListParams(
        params,
        new Set(['domain', 'domain__exact', 'domain__group', 'status', 'status__in', 'not_after__gte', 'not_after__lte']),
        new Set(['common_name', 'status', 'not_after', 'renew_after', 'created']),
        'default',
    );
}

export const DomainModel = defineModel<DomainRow>({
    name: 'dns_domain', endpoint: '/api/dnsman/domain',
    permissions: { view: DNS_VIEW_PERMISSIONS, manage: DNS_MANAGE_PERMISSIONS },
    normalizeListParams: normalizeDomainListParams,
    sanitizeRow: sanitizeDomainRow,
});

export const DnsCredentialModel = defineModel<DnsCredentialRow>({
    name: 'dns_credential', endpoint: '/api/dnsman/credential',
    permissions: { view: DNS_VIEW_PERMISSIONS, manage: DNS_MANAGE_PERMISSIONS, delete: DNS_MANAGE_PERMISSIONS },
    normalizeListParams: normalizeCredentialListParams,
    sanitizeRow: sanitizeDnsCredentialRow,
});

export const DomainPurchaseModel = defineModel<DomainPurchaseRow>({
    name: 'domain_purchase', endpoint: '/api/dnsman/purchase',
    permissions: { view: DNS_VIEW_PERMISSIONS },
    normalizeListParams: normalizePurchaseListParams,
    sanitizeRow: sanitizeDomainPurchaseRow,
});

export const CertificateModel = defineModel<CertificateRow>({
    name: 'dns_certificate', endpoint: '/api/dnsman/certificate',
    permissions: { view: DNS_VIEW_PERMISSIONS, manage: DNS_MANAGE_PERMISSIONS },
    normalizeListParams: normalizeCertificateListParams,
    sanitizeRow: sanitizeCertificateRow,
});
