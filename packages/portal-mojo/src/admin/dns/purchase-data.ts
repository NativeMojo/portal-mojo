import type { DomainPurchaseRow, RegistrarPurchaseResult, RegistrarQuote, RegistrarSearchRow } from './models';

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const PURCHASE_MAY_HAVE_MOVED = 'Money may have moved. Do not retry or request another quote. Check the AWS Route 53 Domains operations console and this purchase ledger first.';

export function normalizePurchaseDomain(value: unknown): string {
    const domain = String(value ?? '').trim().toLowerCase().replace(/\.+$/, '');
    if (!DOMAIN_RE.test(domain)) throw new Error('Enter a complete domain name, including its TLD');
    return domain;
}

/** TLDs stay caller-authored; the backend is the only supported-TLD authority. */
export function normalizeTypedTlds(value: string, limit: number): string[] {
    const tlds = [...new Set(value.split(/[\s,]+/).map((item) => item.trim().toLowerCase().replace(/^\.+|\.+$/g, '')).filter(Boolean))];
    if (!tlds.length) throw new Error('Enter at least one TLD');
    if (tlds.length > limit) throw new Error(`Search is limited to ${limit} TLDs`);
    if (tlds.some((tld) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tld))) throw new Error('Enter valid TLD labels');
    return tlds;
}

export function searchAvailabilityLabel(row: RegistrarSearchRow): string {
    return row.available === true ? 'Available' : row.available === false ? 'Unavailable' : 'Registry did not answer';
}

export function decimalTupleEqual(left: string | number, right: string | number): boolean {
    const normalize = (value: string | number) => {
        const match = String(value).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
        if (!match) return null;
        return BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
    };
    const a = normalize(left); const b = normalize(right);
    return a != null && b != null && a === b;
}

export interface QuoteIdentity { purchase: number; group: number; domain: string; years: number; price: string; currency: string; expires: number }
export function quoteIdentity(quote: RegistrarQuote, group: number): QuoteIdentity {
    return { purchase: quote.purchase, group, domain: normalizePurchaseDomain(quote.name), years: quote.years, price: String(quote.price), currency: quote.currency, expires: quote.expires };
}
export function quoteMatches(identity: QuoteIdentity, input: { group: number; domain: string; years: number; price: string | number; currency: string }, now = Date.now() / 1000): boolean {
    return identity.group === input.group && identity.domain === normalizePurchaseDomain(input.domain) && identity.years === input.years
        && identity.currency === input.currency && decimalTupleEqual(identity.price, input.price) && identity.expires > now;
}

export function redactRegistrarError(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error ?? 'Registrar operation failed');
    return text.slice(0, 600).replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
        .replace(/([?&;](?:token|confirm_token|api_key|secret|password)=)[^&#;\s]*/gi, '$1[redacted]')
        .replace(/\b(confirm[_ -]?token|secret|password)(\s*(?:is|:|=)?\s+)[A-Za-z0-9._~+/=-]{6,}/gi, '$1$2[redacted]');
}

export function sanitizePurchaseResult(value: unknown): RegistrarPurchaseResult {
    const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    if (!Number.isInteger(row.purchase) || !Number.isInteger(row.domain) || typeof row.name !== 'string' || typeof row.status !== 'string') throw new Error('Registrar returned a malformed purchase acknowledgement');
    return { purchase: Number(row.purchase), domain: Number(row.domain), name: normalizePurchaseDomain(row.name), status: row.status.slice(0, 32), operation_id: typeof row.operation_id === 'string' ? row.operation_id.slice(0, 128) : null, privacy: row.privacy === true, privacy_downgraded: row.privacy_downgraded === true };
}

export function purchaseTerminal(row: Pick<DomainPurchaseRow, 'status'>): boolean { return ['completed', 'failed', 'expired'].includes(row.status); }
export const PURCHASE_POLL_DELAYS_MS = [1_000, 2_000, 3_000, 5_000, 8_000, 13_000] as const;
export async function pollPurchaseLedger(options: { purchase: number; fetch: (id: number) => Promise<DomainPurchaseRow>; isCurrent?: () => boolean; delays?: readonly number[] }): Promise<DomainPurchaseRow | null> {
    for (const delay of [0, ...(options.delays ?? PURCHASE_POLL_DELAYS_MS)]) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        if (options.isCurrent?.() === false) return null;
        const row = await options.fetch(options.purchase);
        if (purchaseTerminal(row)) return row;
    }
    return null;
}
