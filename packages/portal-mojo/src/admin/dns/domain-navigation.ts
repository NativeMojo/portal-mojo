import type { DomainRow } from './models';

/** The observed DNS route supplies the mount, including embedded prefixes. */
export function dnsAdminMount(pathname: string): string {
    const marker = pathname.indexOf('/dns/');
    return marker < 0 ? '' : pathname.slice(0, marker);
}
export function domainRecordsHref(pathname: string, id: number): string {
    return `${dnsAdminMount(pathname)}/dns/records?domain=${encodeURIComponent(id)}`;
}
export function domainScopeLabel(group: DomainRow['group']): string {
    return group == null ? 'Platform' : typeof group === 'number' ? `Group #${group}` : group.name;
}
export function supportsDomainRecords(provider: string): boolean {
    return provider === 'route53' || provider === 'godaddy';
}
