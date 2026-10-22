import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { Badge, ModelTable, fmt, modal, type Column, type FilterDef } from '../../ui';
import { DomainDetail } from './DomainDetail';
import { hasPermission, useMe } from '../../client/runtime';
import { DomainModel, DNS_MANAGE_PERMISSIONS, type DomainRow } from './models';
import { providerLabel } from './data';
import { domainRecordsHref, domainScopeLabel, supportsDomainRecords } from './domain-navigation';

const filters: FilterDef[] = [
    { key: 'provider', label: 'Provider', type: 'select', options: [{ value: 'route53', label: 'Route 53' }, { value: 'godaddy', label: 'GoDaddy' }, { value: 'mojo', label: 'Mojo certificate-only' }] },
    { key: 'status', label: 'Status', type: 'select', options: ['pending', 'registering', 'active'].map((value) => ({ value, label: value })) },
];

export function DomainsPage() {
    const queryClient = useQueryClient();
    const { data: me } = useMe();
    const location = useLocation(); const navigate = useNavigate();
    const canManage = hasPermission(me ?? null, DNS_MANAGE_PERMISSIONS, null);
    const start = async (initialMode: 'register' | 'adopt' | 'purchase') => {
        const { showDomainOnboarding } = await import('./DomainOnboardingDialog');
        await showDomainOnboarding({ initialMode });
    };
    const open = (row: DomainRow) => {
        void DomainModel.fetchOne(queryClient, row.id).catch(() => undefined);
        void modal.detail((close) => <DomainDetail id={row.id} onClose={() => close(null)} />);
    };
    const columns: Column<DomainRow>[] = [
        { key: 'name', label: 'Domain', sortable: true, hideable: false, render: (row) => <code>{row.name}</code> },
        { key: 'provider', label: 'Provider', sortable: true, render: (row) => providerLabel(row.provider) },
        { key: 'status', label: 'Status', sortable: true, render: (row) => <Badge tone={fmt.inferTone(row.status)}>{row.status}</Badge> },
        { key: 'expires', label: 'Expires', sortable: true, render: (row) => fmt.date(row.expires) },
        { key: 'group', label: 'Scope', render: (row) => <span className="domains-scope">{domainScopeLabel(row.group)}</span> },
        { key: 'records', label: 'DNS Records', render: (row) => supportsDomainRecords(row.provider) ? <button className="btn btn-sm" type="button" onClick={(event) => { event.stopPropagation(); navigate(domainRecordsHref(location.pathname, row.id)); }}>DNS Records <i className="bi bi-arrow-right" /></button> : <span className="dim">{row.provider === 'mojo' ? 'Certificate-only' : 'Provider unavailable'}</span> },
    ];
    return <div>
        <div className="domains-header"><p className="dim">Register, adopt, buy, and inspect managed domain names.</p>{canManage && <div className="domains-actions"><button className="btn" onClick={() => void start('register')}>Register existing</button>{me?.is_superuser === true && <button className="btn" onClick={() => void start('adopt')}>Adopt</button>}<button className="btn btn-primary" onClick={() => void start('purchase')}>Buy domain</button></div>}</div>
        <ModelTable<DomainRow> model={DomainModel} eyebrow="Operations · DNS" title="Domains" searchable searchPlaceholder="Search domain names" columns={columns} filters={filters} defaultParams={{ sort: 'name' }} columnChooser persistState persistKey="admin:dns:domains" onRowClick={open} />
        {canManage && <details className="domains-advanced"><summary>Advanced</summary><p className="dim">Connect external domains to shared wildcard validation, or review controller allocations and trust.</p><button className="btn" onClick={() => void import('./SharedValidationDialog').then(({ openSharedValidation }) => openSharedValidation())}>Shared validation setup</button></details>}
    </div>;
}
