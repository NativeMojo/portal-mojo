import { defineModel, type Params } from '../../client';

export const DNS_VIEW_PERMISSIONS = ['sys.view_dns', 'sys.manage_dns', 'sys.security'];
export const DNS_MANAGE_PERMISSIONS = ['sys.manage_dns', 'sys.security'];

export interface DnsGroupChoice { id: number; name: string }
export interface DnsGroupBasic extends DnsGroupChoice { is_active?: boolean; kind?: string }

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
    user?: unknown | null;
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
    user: unknown | null;
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
    id?: string;
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

export interface RegistrantContact {
    [field: string]: string | undefined;
}

export interface RegistrantContactResponse {
    scope: 'group' | 'global';
    group: number | null;
    contact: RegistrantContact | null;
    source: string;
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

const SENSITIVE_KEYS = new Set([
    'api_key', 'api_secret', 'secrets', 'mojo_secrets', 'token', 'token_hash',
    'confirm_token', 'confirm_token_hash', 'cert_pem', 'chain_pem',
    'private_key_pem', 'acme_order_url', 'certificate_material', 'pem',
]);

function sanitizeValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (value == null || typeof value !== 'object') return value;
    const safe: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
        safe[key] = sanitizeValue(item);
    }
    return safe;
}

/** Defense in depth against a malformed graph or mock echo. */
export function sanitizeDnsCredentialRow(row: DnsCredentialRow): DnsCredentialRow {
    return sanitizeValue(row) as DnsCredentialRow;
}

export function sanitizeDomainRow(row: DomainRow): DomainRow {
    return sanitizeValue(row) as DomainRow;
}

export function sanitizeDomainPurchaseRow(row: DomainPurchaseRow): DomainPurchaseRow {
    return sanitizeValue(row) as DomainPurchaseRow;
}

export function sanitizeCertificateRow(row: CertificateRow): CertificateRow {
    return sanitizeValue(row) as CertificateRow;
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
        new Set(['group', 'provider', 'provider__in', 'status', 'status__in', 'expires__gte', 'expires__lte']),
        new Set(['name', 'provider', 'status', 'expires', 'created']),
        'list',
    );
}

export function normalizePurchaseListParams(params: Params): Params {
    return normalizeListParams(
        params,
        new Set(['group', 'kind', 'status', 'status__in', 'created__gte', 'created__lte']),
        new Set(['domain_name', 'kind', 'status', 'price', 'created']),
        'default',
    );
}

export function normalizeCertificateListParams(params: Params): Params {
    return normalizeListParams(
        params,
        new Set(['domain', 'domain__group', 'status', 'status__in', 'not_after__gte', 'not_after__lte']),
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
