import { useLocation, useNavigate } from 'react-router-dom';
import { hasPermission, useMe } from '../../client/runtime';
import { DetailView, Eyebrow, FlatRow, fmt } from '../../ui';
import { useDnsCapabilities } from './api';
import { providerLabel } from './data';
import { useDnsDomainLinks } from './domain-links';
import { DnsRecordsPanel } from './DnsRecordsPanel';
import { DomainCertificatesSection } from './DomainCertificatesSection';
import { SharedValidationPanel } from './SharedValidationPanel';
import { openSharedValidation } from './SharedValidationDialog';
import { useValidationPlan } from './shared-validation-api';
import { domainRecordsHref, domainScopeLabel, dnsAdminMount, supportsDomainRecords } from './domain-navigation';
import { redactRegistrarError } from './purchase-data';
import { DNS_MANAGE_PERMISSIONS, DNS_VIEW_PERMISSIONS, DomainModel } from './models';

export function DomainDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const query = DomainModel.useOne(id);
    const { data: me } = useMe();
    const links = useDnsDomainLinks();
    const navigate = useNavigate();
    const location = useLocation();
    const domain = query.data;
    const shared = useValidationPlan(domain ? { domain: domain.id } : null);
    const group = typeof domain?.group === 'number' ? domain.group : domain?.group?.id ?? null;
    const capabilities = useDnsCapabilities(group, { enabled: !!domain });
    if (query.isPending) return <div className="modal-pad dim">Loading domain…</div>;
    if (!domain || query.error) return <div className="modal-pad text-bad">{query.error?.message ?? 'Domain not found'}</div>;
    const availableLinks = capabilities.data ? links.filter((link) => (!link.permissions || hasPermission(me, link.permissions)) && (!link.when || link.when(domain, capabilities.data!))) : [];
    const navigateLink = (route: string) => {
        const marker = location.pathname.indexOf('/dns/');
        const mount = marker >= 0 ? location.pathname.slice(0, marker) : '';
        onClose();
        navigate(`${mount}/dns/${route.replace(/^\/?dns\//, '').replace(/^\//, '')}`);
    };
    const groupLabel = domainScopeLabel(domain.group);
    const canManage = hasPermission(me ?? null, DNS_MANAGE_PERMISSIONS, null);
    const openDestination = (href: string) => { onClose(); navigate(href); };
    const credential = typeof domain.credential === 'object' ? domain.credential : null;
    return <DetailView
        icon="bi-globe2" title={domain.name} subtitle={providerLabel(domain.provider)}
        chips={[{ text: domain.status, tone: fmt.inferTone(domain.status) }, ...(domain.verified ? [{ text: 'Verified', tone: 'success' as const }] : [])]}
        sections={[
            { key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => <div className="dns-domain-overview"><div className="domains-overview-actions">{supportsDomainRecords(domain.provider) && <button className="btn btn-primary" onClick={() => openDestination(domainRecordsHref(location.pathname, domain.id))}>DNS Records <i className="bi bi-arrow-right" /></button>}{canManage && domain.provider === 'route53' && <button className="btn" onClick={() => void import('./DomainRegistrarSettings').then(({ showDomainRegistrarSettings }) => showDomainRegistrarSettings(domain))}>Registrar settings</button>}{hasPermission(me ?? null, DNS_VIEW_PERMISSIONS, null) && <button className="btn" onClick={() => openDestination(`${dnsAdminMount(location.pathname)}/edge/vhosts`)}>Serving <i className="bi bi-arrow-right" /></button>}</div><Eyebrow>Domain</Eyebrow><FlatRow label="Scope">{groupLabel}</FlatRow><FlatRow label="Expires">{fmt.date(domain.expires)}</FlatRow><FlatRow label="Auto-renew">{domain.auto_renew ? 'Enabled' : 'Disabled'}</FlatRow><FlatRow label="WHOIS privacy">{domain.privacy ? 'Enabled' : 'Disabled'}</FlatRow><details className="ops-details"><summary>Registration details</summary>{domain.hosted_zone_id && <FlatRow label="Hosted zone"><code>{domain.hosted_zone_id}</code></FlatRow>}<FlatRow label="Registered">{fmt.date(domain.registered_on)}</FlatRow><FlatRow label="Credential">{credential ? `${credential.name} · ${credential.is_active && credential.verified ? 'usable' : 'unavailable'}` : '—'}</FlatRow></details>{domain.last_error && <div className="dns-error">{redactRegistrarError(domain.last_error)}</div>}{domain.provider === 'godaddy' && <div className="dns-provider-note">DNS is managed here; purchase, renewal, privacy, and WHOIS remain in the GoDaddy account.</div>}{domain.provider === 'mojo' && <div className="dns-blocked">Mojo is certificate-only and cannot use generic DNS CRUD.</div>}{availableLinks.length > 0 && <><Eyebrow>Related</Eyebrow><div className="dns-domain-links">{availableLinks.filter((link) => link.key !== 'records' || supportsDomainRecords(domain.provider)).map((link) => <button className="btn" type="button" key={link.key} onClick={() => navigateLink(typeof link.route === 'function' ? link.route(domain) : link.route)}><i className={`bi ${link.icon}`} /> {link.label}</button>)}</div></>}</div> },
            { key: 'validation', label: 'Advanced validation', icon: 'bi-diagram-2', render: () => <SharedValidationPanel domain={domain} /> },
            { key: 'records', label: 'DNS Records', icon: 'bi-list-columns', render: () => <DnsRecordsPanel domain={domain} /> },
            { key: 'certificates', label: 'Certificates', icon: 'bi-patch-check', render: () => <DomainCertificatesSection domain={domain} /> },
        ]}
        initialSection="overview" onClose={onClose}
        contextMenu={canManage && shared.data?.capabilities.group_choices ? [{ label: 'Set up shared validation', icon: 'bi-diagram-2', onSelect: () => void openSharedValidation(domain) }] : []}
    />;
}
