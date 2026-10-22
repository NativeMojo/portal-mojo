import { useCallback, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { getAuthSessionRevision, hasPermission, subscribeAuth, useAuthSnapshot, useMe } from '../../client/runtime';
import { Badge, FlatRow, Tabs, fmt, modal } from '../../ui';
import { OperationsHelp } from '../core/OperationsHelp';
import { useDnsCapabilities } from './api';
import { providerLabel } from './data';
import { useDnsDomainLinks } from './domain-links';
import { DnsRecordsPanel } from './DnsRecordsPanel';
import { DomainCertificatesSection } from './DomainCertificatesSection';
import { openSharedValidation } from './SharedValidationDialog';
import { domainScopeLabel, dnsAdminMount, supportsDomainRecords } from './domain-navigation';
import { redactRegistrarError } from './purchase-data';
import { DNS_MANAGE_PERMISSIONS, DNS_VIEW_PERMISSIONS, DomainModel, type DomainRow } from './models';
import { DomainRegistrationPanel } from './DomainRegistrationPanel';
import { showDomainAssignment } from './DomainAssignment';

export function showDomainDetails(id: number, initialTab = 'overview') {
    let busy = false;
    const onBusyChange = (value: boolean) => { busy = value; };
    return modal.open(close => <DomainDetail id={id} initialTab={initialTab} onClose={() => close(null)} onBusyChange={onBusyChange} />, { size: 'lg', canDismiss: () => !busy });
}

export function DomainDetail({ id, initialTab = 'overview', onClose, onBusyChange }: { id: number; initialTab?: string; onClose: () => void; onBusyChange?: (busy: boolean) => void }) {
    const { data: me } = useMe(); const auth = useAuthSnapshot();
    const revision = useSyncExternalStore(subscribeAuth, getAuthSessionRevision, getAuthSessionRevision);
    const canView = auth.authenticated && hasPermission(me, DNS_VIEW_PERMISSIONS, null);
    const query = DomainModel.useOne(canView ? id : null);
    const domain = query.data;
    if (!canView) return <div className="modal-pad"><h2 className="modal-title">Domain unavailable</h2><button className="btn" onClick={onClose}>Close</button></div>;
    if (query.isPending) return <div className="modal-pad dim">Loading domain…</div>;
    if (!domain || query.error) return <div className="modal-pad"><h2 className="modal-title">Could not load domain</h2><p className="text-bad">{query.error?.message ?? 'Domain not found'}</p><div className="modal-actions"><button className="btn" onClick={onClose}>Close</button><button className="btn" onClick={() => void query.refetch()}>Retry</button></div></div>;
    return <DomainContent key={`${auth.uid}:${revision}:${domain.id}`} domain={domain} initialTab={initialTab} onClose={onClose} onBusyChange={onBusyChange} />;
}

function DomainContent({ domain, initialTab, onClose, onBusyChange }: { domain: DomainRow; initialTab: string; onClose: () => void; onBusyChange?: (busy: boolean) => void }) {
    const { data: me } = useMe(); const qc = useQueryClient();
    const location = useLocation(); const navigate = useNavigate(); const links = useDnsDomainLinks();
    const [tab, setTab] = useState(initialTab); const [recordType, setRecordType] = useState(''); const [busy, setBusy] = useState(false);
    const setPending = useCallback((value: boolean) => { setBusy(value); onBusyChange?.(value); }, [onBusyChange]);
    const canManage = hasPermission(me, DNS_MANAGE_PERMISSIONS, null);
    const group = typeof domain.group === 'number' ? domain.group : domain.group?.id ?? null;
    // Catalog is read-only; manager prerequisites and legal contacts load only on deliberate actions.
    const caps = useDnsCapabilities(group, { enabled: links.some(link => !['domains', 'records', 'certificates', 'purchases', 'registrant', 'credentials'].includes(link.key)) });
    const customLinks = links.filter(link => !['domains', 'records', 'certificates', 'purchases', 'registrant', 'credentials'].includes(link.key) && (!link.permissions || hasPermission(me, link.permissions, null)) && (!link.when || caps.data && link.when(domain, caps.data)));
    const go = (href: string) => { onClose(); navigate(href); };
    const refresh = async () => { await DomainModel.invalidate(qc); };
    const credential = typeof domain.credential === 'object' ? domain.credential : null;
    const items = [
        { key: 'overview', label: 'Overview', panel: <div className="domains-detail-panel">
            {domain.last_error && <div className="form-alert" role="alert">{redactRegistrarError(domain.last_error)}</div>}
            {domain.provider === 'godaddy' && <p className="dns-provider-note">Manage DNS here. Registration and renewals stay in your GoDaddy account.</p>}
            {domain.provider === 'mojo' && <p className="dns-provider-note">Certificate-only domain. General DNS records are managed by its DNS provider.</p>}
            {!supportsDomainRecords(domain.provider) && domain.provider !== 'mojo' && <p className="form-alert">This DNS provider is unavailable in this portal.</p>}
            <FlatRow label="Scope"><span>{domainScopeLabel(domain.group)}</span>{canManage && me?.is_superuser === true && domain.group == null && <button className="btn btn-sm" onClick={() => void showDomainAssignment(domain)}>Assign to group</button>}</FlatRow>
            <FlatRow label="Expires">{domain.expires ? fmt.date(domain.expires) : <span>Unknown <OperationsHelp label="domain expiry">A hosted zone does not prove that its registration never expires. Read live registration details or check its registrar.</OperationsHelp></span>}</FlatRow>
            <FlatRow label="Ownership">{domain.verified ? 'Verified' : 'Not verified'}</FlatRow>
            {domain.hosted_zone_id && <FlatRow label="Hosted zone"><code>{domain.hosted_zone_id}</code></FlatRow>}
            {credential && <FlatRow label="Credential"><span>{credential.name} · {credential.is_active && credential.verified ? 'Verified' : 'Needs attention'}</span></FlatRow>}
            <div className="domains-overview-actions"><button className="btn" onClick={() => go(`${dnsAdminMount(location.pathname)}/edge/vhosts`)}>Serving <i className="bi bi-arrow-right" /></button>{canManage && <span className="domains-task-help"><button className="btn" onClick={() => void openSharedValidation(domain)}>Shared validation</button><OperationsHelp label="shared validation">Connect shared wildcard validation or review controller trust for this domain.</OperationsHelp></span>}{customLinks.map(link => <button className="btn" key={link.key} onClick={() => go(`${dnsAdminMount(location.pathname)}/dns/${(typeof link.route === 'function' ? link.route(domain) : link.route).replace(/^\/?dns\//, '').replace(/^\//, '')}`)}>{link.label}</button>)}</div>
        </div> },
        ...(supportsDomainRecords(domain.provider) ? [{ key: 'records', label: 'DNS records', panel: <div className="domains-detail-panel"><DnsRecordsPanel domain={domain} recordType={recordType} onRecordTypeChange={setRecordType} /></div> }] : []),
        { key: 'certificates', label: 'Certificates', panel: <div className="domains-detail-panel"><DomainCertificatesSection domain={domain} /></div> },
        ...(canManage && domain.provider !== 'mojo' ? [{ key: 'registration', label: 'Registration', panel: <div className="domains-detail-panel"><DomainRegistrationPanel domain={domain} onBusyChange={setPending} onChanged={refresh} /></div> }] : []),
    ];
    return <div className="domains-detail"><header className="domains-detail-header"><div><h2 className="modal-title">{domain.name}</h2><div className="domains-detail-subtitle"><span>{providerLabel(domain.provider)}</span><Badge tone={fmt.inferTone(domain.status)}>{domain.status}</Badge></div></div><button className="btn-icon" aria-label="Close domain" disabled={busy} onClick={onClose}><i className="bi bi-x-lg" /></button></header><Tabs ariaLabel="Domain details" activeKey={tab} onActiveKeyChange={setTab} items={items.map(item => ({ ...item, disabled: busy && item.key !== tab }))} /></div>;
}
