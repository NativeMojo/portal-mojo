import type { DnsCapabilities, DnsProviderCapability, DnsRecordRow, DomainRow } from './models';

export function providerLabel(provider: string | null | undefined): string {
    const key = String(provider ?? '').trim().toLowerCase();
    if (key === 'route53') return 'Route 53';
    if (key === 'godaddy') return 'GoDaddy';
    return key ? key.charAt(0).toUpperCase() + key.slice(1) : '—';
}

export function providerCapability(caps: DnsCapabilities, provider: string): DnsProviderCapability | null {
    const key = provider.trim().toLowerCase();
    return caps.providers.find((entry) => entry.name.toLowerCase() === key) ?? null;
}

export function linkableProviders(caps: DnsCapabilities): DnsProviderCapability[] {
    return caps.providers.filter((provider) => provider.requires_credential);
}

export function requiresCredential(provider: string, caps: DnsCapabilities): boolean {
    return providerCapability(caps, provider)?.requires_credential === true;
}

export function isManagementOnly(domain: Pick<DomainRow, 'provider'> | string, caps: DnsCapabilities): boolean {
    const provider = typeof domain === 'string' ? domain : domain.provider;
    return providerCapability(caps, provider)?.purchase === false;
}

/** Provider records are live and id-less; type+normalized name is the stable set identity. */
export function dnsRecordKey(record: Pick<DnsRecordRow, 'type' | 'name'>): string {
    return `${record.type.trim().toUpperCase()}|${record.name.trim().toLowerCase().replace(/\.+$/, '')}`;
}
