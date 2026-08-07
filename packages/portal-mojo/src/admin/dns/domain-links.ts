import { useSyncExternalStore } from 'react';
import type { DnsCapabilities, DomainRow } from './models';

export interface DnsDomainLink {
    key: string;
    label: string;
    icon: string;
    route: string | ((domain: DomainRow) => string);
    permissions?: string | string[];
    when?: (domain: DomainRow, capabilities: DnsCapabilities) => boolean;
    order?: number;
}
export const DNS_DOMAIN_LINK_ORDER: Readonly<Record<string, number>> = {
    domains: 10,
    records: 20,
    certificates: 30,
    credentials: 40,
};
const links = new Map<string, DnsDomainLink>();
const listeners = new Set<() => void>();
let snapshot: readonly DnsDomainLink[] = [];
const emit = () => {
    snapshot = [...links.values()].sort((a, b) => (a.order ?? DNS_DOMAIN_LINK_ORDER[a.key] ?? 100) - (b.order ?? DNS_DOMAIN_LINK_ORDER[b.key] ?? 100));
    listeners.forEach((listener) => listener());
};
export function registerDnsDomainLinks(...entries: DnsDomainLink[]): () => void {
    const prior = new Map<string, DnsDomainLink | undefined>();
    entries.forEach((entry) => { prior.set(entry.key, links.get(entry.key)); links.set(entry.key, entry); });
    emit();
    return () => { entries.forEach((entry) => { if (links.get(entry.key) !== entry) return; const old = prior.get(entry.key); if (old) links.set(entry.key, old); else links.delete(entry.key); }); emit(); };
}
export function getDnsDomainLinks(): readonly DnsDomainLink[] { return snapshot; }
export function useDnsDomainLinks(): readonly DnsDomainLink[] {
    return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, getDnsDomainLinks, getDnsDomainLinks);
}
