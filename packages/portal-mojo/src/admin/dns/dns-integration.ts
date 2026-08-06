/** Dependency-free DNS composition seam. Keep this safe for client/mock import order. */
export interface ManagedDnsRecordInput { type: string; name: string; record_values: string[]; ttl: number }
export interface DnsAdminIntegration {
    resolveDomainByName?: (normalizedName: string) => Promise<number | null>;
    recordsHref?: (domainId: number) => string;
    applyManagedDnsRecords?: (domainId: number, records: readonly ManagedDnsRecordInput[]) => void | Promise<void>;
}

let integration: DnsAdminIntegration = {};
export function registerDnsAdminIntegration(adapter: DnsAdminIntegration): () => void {
    const previous: DnsAdminIntegration = {};
    for (const key of Object.keys(adapter) as (keyof DnsAdminIntegration)[]) {
        Object.assign(previous, { [key]: integration[key] });
        Object.assign(integration, { [key]: adapter[key] });
    }
    return () => {
        for (const key of Object.keys(adapter) as (keyof DnsAdminIntegration)[]) {
            if (integration[key] === adapter[key]) Object.assign(integration, { [key]: previous[key] });
        }
    };
}
export function getDnsAdminIntegration(): DnsAdminIntegration | null {
    return Object.keys(integration).length ? integration : null;
}
