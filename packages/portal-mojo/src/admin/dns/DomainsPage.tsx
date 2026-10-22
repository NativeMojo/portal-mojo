import { useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Badge, ModelTable, Popover, fmt, type Column, type FilterDef } from '../../ui';
import { showDomainDetails } from './DomainDetail';
import { hasPermission, useMe } from '../../client/runtime';
import { DomainModel, DNS_MANAGE_PERMISSIONS, type DomainRow } from './models';
import { providerLabel } from './data';
import { domainRecordsHref, domainScopeLabel, dnsAdminMount, supportsDomainRecords } from './domain-navigation';

const filters: FilterDef[] = [
    { key: 'provider', label: 'Provider', type: 'select', options: [{ value: 'route53', label: 'Route 53' }, { value: 'godaddy', label: 'GoDaddy' }, { value: 'mojo', label: 'Mojo certificate-only' }] },
    { key: 'status', label: 'Status', type: 'select', options: ['pending', 'registering', 'active'].map(value => ({ value, label: value })) },
];
const narrowQuery = () => window.matchMedia('(max-width: 560px)');
const subscribeNarrow = (listener: () => void) => { const media = narrowQuery(); media.addEventListener('change', listener); return () => media.removeEventListener('change', listener); };

export function DomainsPage() {
    const { data: me } = useMe(); const location = useLocation(); const navigate = useNavigate();
    const [menu, setMenu] = useState(false); const anchor = useRef<HTMLButtonElement>(null);
    const narrow = useSyncExternalStore(subscribeNarrow, () => narrowQuery().matches, () => false);
    const canManage = hasPermission(me ?? null, DNS_MANAGE_PERMISSIONS, null);
    const start = async () => { const { showDomainOnboarding } = await import('./DomainOnboardingDialog'); await showDomainOnboarding(); };
    const columns: Column<DomainRow>[] = [
        { key: 'name', label: 'Domain', sortable: true, hideable: false, render: row => <span className="ops-cell"><strong>{row.name}</strong><small>{providerLabel(row.provider)}<span className="domains-narrow-scope"> · {domainScopeLabel(row.group)}</span></small><span className="domains-narrow-status"><Badge tone={fmt.inferTone(row.status)}>{row.status}</Badge></span></span> },
        { key: 'status', label: 'Status', sortable: true, render: row => <Badge tone={fmt.inferTone(row.status)}>{row.status}</Badge> },
        { key: 'expires', label: 'Expires', sortable: true, render: row => row.expires ? fmt.date(row.expires) : 'Unknown' },
        { key: 'group', label: 'Scope', render: row => <span className="domains-scope">{domainScopeLabel(row.group)}</span> },
        { key: 'records', label: 'DNS records', render: row => supportsDomainRecords(row.provider) ? <button className="btn btn-sm" type="button" onClick={event => { event.stopPropagation(); navigate(domainRecordsHref(location.pathname, row.id)); }}>Records <i className="bi bi-arrow-right" /></button> : <span className="dim">{row.provider === 'mojo' ? 'Certificate-only' : 'Unavailable'}</span> },
    ];
    return <div className="domains-page">
        <header className="domains-header"><div><div className="eyebrow">Network &amp; hosting</div><h1>Domains</h1><p className="dim">Manage your domains and DNS.</p></div><div className="domains-actions"><button className="btn" onClick={() => navigate(`${dnsAdminMount(location.pathname)}/dns/purchases`)}>Purchases</button>{canManage && <><button className="btn btn-primary" onClick={() => void start()}><i className="bi bi-plus-lg" /> Add domain</button><button ref={anchor} className="btn-icon" aria-label="More domain actions" aria-expanded={menu} onClick={() => setMenu(value => !value)}><i className="bi bi-three-dots-vertical" /></button><Popover anchorRef={anchor} open={menu} onClose={() => setMenu(false)} className="domains-action-menu"><button className="btn" onClick={() => { setMenu(false); void import('./SharedValidationDialog').then(({ openSharedValidation }) => openSharedValidation()); }}>Shared validation setup</button></Popover></>}</div></header>
        <ModelTable<DomainRow> model={DomainModel} title="Managed domains" searchable searchPlaceholder="Search domain names" columns={narrow ? columns.filter(column => !['expires', 'group', 'status'].includes(column.key)) : columns} filters={filters} defaultParams={{ sort: 'name' }} columnChooser persistState persistKey="admin:dns:domains" onRowClick={row => void showDomainDetails(row.id)} />
    </div>;
}
