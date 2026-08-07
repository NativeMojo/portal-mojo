import { useLocation, useNavigate } from 'react-router-dom';
import { hasPermission, useMe } from '../../client/runtime';
import { DetailView, Eyebrow, FlatRow, fmt } from '../../ui';
import { useDnsCapabilities } from './api';
import { providerLabel } from './data';
import { useDnsDomainLinks } from './domain-links';
import { DnsRecordsPanel } from './DnsRecordsPanel';
import { DomainCertificatesSection } from './DomainCertificatesSection';
import { DomainModel } from './models';

export function DomainDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const query = DomainModel.useOne(id);
    const { data: me } = useMe();
    const links = useDnsDomainLinks();
    const navigate = useNavigate();
    const location = useLocation();
    const domain = query.data;
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
    const groupLabel = typeof domain.group === 'object' ? domain.group?.name ?? 'Platform' : domain.group ?? 'Platform';
    const credential = typeof domain.credential === 'object' ? domain.credential : null;
    return <DetailView
        icon="bi-globe2" title={domain.name} subtitle={`${providerLabel(domain.provider)}${domain.hosted_zone_id ? ` · ${domain.hosted_zone_id}` : ''}`}
        chips={[{ text: domain.status, tone: fmt.inferTone(domain.status) }, ...(domain.verified ? [{ text: 'Verified', tone: 'success' as const }] : [])]}
        sections={[
            { key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => <div className="dns-domain-overview"><Eyebrow>Domain</Eyebrow><FlatRow label="Name"><code>{domain.name}</code></FlatRow><FlatRow label="Provider">{providerLabel(domain.provider)}</FlatRow><FlatRow label="Status">{domain.status}</FlatRow><FlatRow label="Group">{groupLabel}</FlatRow>{domain.hosted_zone_id && <FlatRow label="Hosted zone"><code>{domain.hosted_zone_id}</code></FlatRow>}<FlatRow label="Registered">{fmt.date(domain.registered_on)}</FlatRow><FlatRow label="Expires">{fmt.date(domain.expires)}</FlatRow><FlatRow label="Verified">{domain.verified ? 'Yes' : 'No'}</FlatRow><FlatRow label="Auto-renew">{domain.auto_renew ? 'Enabled' : 'Disabled'}</FlatRow><FlatRow label="WHOIS privacy">{domain.privacy ? 'Enabled' : 'Disabled'}</FlatRow><FlatRow label="Credential">{credential ? `${credential.name} · ${credential.is_active && credential.verified ? 'usable' : 'unavailable'}` : '—'}</FlatRow>{domain.last_error && <div className="dns-error">{domain.last_error}</div>}{domain.provider === 'godaddy' && <div className="dns-provider-note">DNS is managed here; purchase, renewal, privacy, and WHOIS remain in the GoDaddy account.</div>}{domain.provider === 'mojo' && <div className="dns-blocked">Mojo is certificate-only and cannot use generic DNS CRUD.</div>}{availableLinks.length > 0 && <><Eyebrow>Related</Eyebrow><div className="dns-domain-links">{availableLinks.map((link) => <button className="btn" type="button" key={link.key} onClick={() => navigateLink(typeof link.route === 'function' ? link.route(domain) : link.route)}><i className={`bi ${link.icon}`} /> {link.label}</button>)}</div></>}</div> },
            { key: 'records', label: 'DNS Records', icon: 'bi-list-columns', render: () => <DnsRecordsPanel domain={domain} /> },
            { key: 'certificates', label: 'Certificates', icon: 'bi-patch-check', render: () => <DomainCertificatesSection domain={domain} /> },
        ]}
        initialSection="overview" onClose={onClose}
    />;
}
