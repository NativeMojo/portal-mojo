import type { CertificateRow, DnsCapabilities, DnsCredentialRow, DomainRow } from './models';

export const CERTIFICATE_STATUSES = ['pending', 'issuing', 'active', 'failed', 'revoked'] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

export interface AcmeDelegationStatus {
    id: number;
    created: string | null;
    modified: string | null;
    domain: number | null;
    domain_name: string;
    source: string | null;
    target: string | null;
    state: 'pending' | 'verified' | 'broken' | 'retired' | 'unknown';
    verified_at: string | null;
    last_error_code: string | null;
}

export type CertificateRenewalHealth =
    | 'pending' | 'issuing' | 'healthy' | 'due' | 'renewal-error'
    | 'failed' | 'revoked' | 'unknown';

export interface CertificateReadiness {
    ready: boolean;
    mode: 'direct' | 'delegated' | 'blocked';
    label: string;
    reason: string | null;
}

function object(value: unknown): Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function finite(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableText(value: unknown, limit: number): string | null {
    if (value == null) return null;
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    if (!normalized) return null;
    return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}…`;
}

/** Bound and redact provider/ACME exceptions before they enter Query cache. */
export function sanitizeCertificateLastError(value: unknown): string | null {
    const bounded = nullableText(value, 2_000);
    if (!bounded) return null;
    return bounded
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
        .replace(/([?&;](?:token|api_key|secret|password|credential)=)[^&#;\s]*/gi, '$1[redacted]')
        .replace(/(^|[&;\s])((?:token|api_key|secret|password|credential)=)[^&;\s]*/gi, '$1$2[redacted]')
        .replace(/\b(token|api[ _-]?key|client[ _-]?secret|password|credential)(\s*(?:is|:|=)?\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1$2[redacted]');
}

export function normalizeCertificateStatus(value: unknown): CertificateStatus {
    const status = String(value ?? '').trim().toLowerCase();
    return (CERTIFICATE_STATUSES as readonly string[]).includes(status)
        ? status as CertificateStatus
        : 'failed';
}

/** DNS names are lowercase, ASCII, and have no trailing dot. */
export function normalizeCertificateName(value: unknown): string {
    const input = String(value ?? '').trim().toLowerCase().replace(/\.+$/, '');
    if (!input) return '';
    const wildcard = input.startsWith('*.');
    const host = wildcard ? input.slice(2) : input;
    try {
        const ascii = new URL(`https://${host}`).hostname.toLowerCase().replace(/\.+$/, '');
        return wildcard ? `*.${ascii}` : ascii;
    } catch {
        return input;
    }
}

export function normalizeCertificateSans(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const candidate of value) {
        if (typeof candidate !== 'string') continue;
        const name = normalizeCertificateName(candidate);
        if (name && !out.includes(name)) out.push(name);
        if (out.length >= 100) break;
    }
    return out;
}

function validDnsName(name: string): boolean {
    if (!name || name.length > 253 || name.includes('/') || name.includes(':')) return false;
    const wildcard = name.startsWith('*.');
    if (name.includes('*') && !wildcard) return false;
    const host = wildcard ? name.slice(2) : name;
    return host.split('.').every((label) => label.length > 0 && label.length <= 63
        && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

/** Normalize, dedupe and require every requested SAN to remain in-zone. */
export function validateCertificateNames(zoneValue: string, values: readonly string[]): { names: string[]; errors: string[] } {
    const zone = normalizeCertificateName(zoneValue).replace(/^\*\./, '');
    const names = normalizeCertificateSans(values);
    const effective = names.length ? names : [zone, `*.${zone}`];
    const errors: string[] = [];
    for (const name of effective) {
        const host = name.startsWith('*.') ? name.slice(2) : name;
        if (!validDnsName(name)) errors.push(`${name || 'Empty name'} is not a valid DNS name.`);
        else if (host !== zone && !host.endsWith(`.${zone}`)) errors.push(`${name} is outside the ${zone} zone.`);
    }
    return { names: effective, errors };
}

export function sanitizeCertificateRow(row: unknown): CertificateRow {
    const raw = object(row);
    const domainRaw = typeof raw.domain === 'number' ? raw.domain : object(raw.domain);
    const status = normalizeCertificateStatus(raw.status);
    const commonName = normalizeCertificateName(raw.common_name);
    return {
        id: finite(raw.id) ?? 0,
        created: finite(raw.created) ?? 0,
        modified: finite(raw.modified) ?? 0,
        common_name: commonName,
        sans: normalizeCertificateSans(raw.sans),
        status,
        issuer: nullableText(raw.issuer, 255),
        serial: nullableText(raw.serial, 128),
        not_before: finite(raw.not_before),
        not_after: finite(raw.not_after),
        renew_after: finite(raw.renew_after),
        last_error: sanitizeCertificateLastError(raw.last_error),
        attempts: Math.max(0, Math.trunc(finite(raw.attempts) ?? 0)),
        days_remaining: finite(raw.days_remaining),
        domain: typeof domainRaw === 'number' ? domainRaw : {
            id: finite(domainRaw.id) ?? 0,
            name: normalizeCertificateName(domainRaw.name),
            provider: nullableText(domainRaw.provider, 32) ?? 'unknown',
            status: nullableText(domainRaw.status, 32) ?? 'unknown',
            expires: finite(domainRaw.expires),
        },
    };
}

export function sanitizeAcmeDelegationStatus(value: unknown): AcmeDelegationStatus {
    const raw = object(value);
    const state = String(raw.state ?? '').toLowerCase();
    return {
        id: finite(raw.id) ?? 0,
        created: nullableText(raw.created, 64),
        modified: nullableText(raw.modified, 64),
        domain: finite(raw.domain),
        domain_name: normalizeCertificateName(raw.domain_name),
        source: nullableText(raw.source, 253),
        target: nullableText(raw.target, 253),
        state: ['pending', 'verified', 'broken', 'retired'].includes(state)
            ? state as AcmeDelegationStatus['state']
            : 'unknown',
        verified_at: nullableText(raw.verified_at, 64),
        last_error_code: nullableText(raw.last_error_code, 64)?.replace(/[^a-z0-9_.-]/gi, '') || null,
    };
}

/** `renew_after` is authoritative; days remaining is display-only. */
export function deriveCertificateRenewalHealth(row: CertificateRow, nowSeconds = Date.now() / 1000): CertificateRenewalHealth {
    if (row.status === 'pending') return 'pending';
    if (row.status === 'issuing') return 'issuing';
    if (row.status === 'failed') return 'failed';
    if (row.status === 'revoked') return 'revoked';
    if (row.status !== 'active') return 'unknown';
    if (row.last_error) return 'renewal-error';
    if (row.renew_after == null) return 'unknown';
    return row.renew_after <= nowSeconds ? 'due' : 'healthy';
}

export function isHouseDomain(domain: Pick<DomainRow, 'group'>): boolean {
    return domain.group == null;
}

export function canInspectHouseCertificate(domain: Pick<DomainRow, 'group'>, isSuperuser: boolean): boolean {
    return !isHouseDomain(domain) || isSuperuser;
}

/**
 * Readiness mirrors certs.py routing: once a delegation was verified it is
 * sticky. A broken sticky delegation must be repaired; it never falls back to
 * direct provider DNS.
 */
export function deriveCertificateReadiness(input: {
    domain: DomainRow;
    capabilities: DnsCapabilities;
    delegations?: readonly AcmeDelegationStatus[];
    credential?: Pick<DnsCredentialRow, 'is_active' | 'verified'> | null;
}): CertificateReadiness {
    const { domain, capabilities } = input;
    if (!capabilities.acme.configured) return { ready: false, mode: 'blocked', label: 'ACME unavailable', reason: 'ACME is not configured on this deployment.' };
    if (domain.status !== 'active') return { ready: false, mode: 'blocked', label: 'Domain unavailable', reason: 'Certificates can be requested only for active domains.' };
    const delegations = input.delegations ?? [];
    const sticky = delegations.find((row) => row.verified_at != null && row.state !== 'retired');
    if (sticky) {
        if (sticky.state !== 'verified') return { ready: false, mode: 'blocked', label: 'Delegation broken', reason: 'This verified ACME delegation is sticky and must be repaired; direct DNS fallback is intentionally disabled.' };
        if (!capabilities.delegated_acme.available) return { ready: false, mode: 'blocked', label: 'Delegation unavailable', reason: 'The delegated ACME service is unavailable.' };
        return { ready: true, mode: 'delegated', label: 'Delegated DNS-01', reason: null };
    }
    if (domain.provider === 'mojo') return { ready: false, mode: 'blocked', label: 'Delegation not verified', reason: 'Certificate-only domains require a verified ACME delegation.' };
    if (domain.provider === 'godaddy') {
        const relation = input.credential ?? (typeof domain.credential === 'object' ? domain.credential : null);
        if (!relation?.is_active || !relation.verified) return { ready: false, mode: 'blocked', label: 'Credential unavailable', reason: 'Direct GoDaddy DNS-01 requires an active, verified provider credential.' };
    } else if (domain.provider !== 'route53') {
        return { ready: false, mode: 'blocked', label: 'Provider unsupported', reason: `Certificate issuance is unavailable for ${domain.provider}.` };
    }
    return { ready: true, mode: 'direct', label: 'Direct DNS-01', reason: null };
}

export function certificateStatusTone(value: string): 'success' | 'warning' | 'danger' | 'muted' {
    const status = normalizeCertificateStatus(value);
    if (status === 'active') return 'success';
    if (status === 'failed' || status === 'revoked') return 'danger';
    if (status === 'pending' || status === 'issuing') return 'warning';
    return 'muted';
}
