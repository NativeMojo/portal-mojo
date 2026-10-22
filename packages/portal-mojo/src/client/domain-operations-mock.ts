/** Focused mock-only registrar checks, loaded only for registrar operations. */
const normalize = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase().replace(/\.+$/, '') : '';
const cents = (value: unknown) => {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const match = String(value).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
    return match ? BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0')) : null;
};
interface Quote { group: number | null; user: number | null; domain_name: string; price: string | number | null }
/** No token or submitted body is retained by this validator. */
export function validMockPurchaseTuple(quote: Quote, body: Record<string, unknown>, actor: number): boolean {
    const price = cents(body.confirm_price), expected = cents(quote.price);
    return quote.user === actor && Number(body.group) === quote.group && normalize(body.confirm_domain) === quote.domain_name && price !== null && expected !== null && price === expected;
}
export function mockRegistrarSession(claims: Record<string, unknown> | null, fresh: boolean): 'denied' | 'stale' | null {
    const kind = claims?.credential_kind ?? claims?.token_type;
    if (typeof kind === 'string' && ['api_key', 'group_scoped_token', 'group_token'].includes(kind)) return 'denied';
    if (fresh && (typeof claims?.auth_time !== 'number' || !Number.isFinite(claims.auth_time) || claims.auth_time > Date.now() / 1000 || Date.now() / 1000 - claims.auth_time > 600)) return 'stale';
    return null;
}
export function mockDomainRegistrationName(value: unknown): string | null {
    const name = normalize(value);
    return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name) ? name : null;
}
