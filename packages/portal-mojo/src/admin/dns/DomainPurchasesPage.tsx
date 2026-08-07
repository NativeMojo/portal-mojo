import { useMe, hasPermission } from '../../client';
import { Badge, ModelTable, modal, type Column, type FilterDef } from '../../ui';
import { DomainPurchaseDetail } from './DomainPurchaseDetail';
import { showDomainOnboarding } from './DomainOnboardingDialog';
import { DNS_MANAGE_PERMISSIONS, DomainPurchaseModel, type DomainPurchaseRow } from './models';

const columns: Column<DomainPurchaseRow>[] = [
    { key: 'domain_name', label: 'Domain', hideable: false, render: (row) => <code>{row.domain_name}</code> },
    { key: 'status', label: 'Status', render: (row) => <Badge tone={row.status === 'completed' ? 'success' : row.status === 'failed' || row.status === 'expired' ? 'danger' : 'warning'}>{row.status}</Badge> },
    { key: 'price', label: 'Price', align: 'end', render: (row) => `${row.price ?? '—'} ${row.currency}` },
];
const filters: FilterDef[] = [{ key: 'status', label: 'Status', type: 'multiselect', options: ['quoted', 'submitted', 'completed', 'failed', 'expired'].map((value) => ({ value, label: value })) }];
export function DomainPurchasesPage() {
    const { data: me } = useMe(); const canManage = hasPermission(me ?? null, DNS_MANAGE_PERMISSIONS, null);
    return <ModelTable model={DomainPurchaseModel} eyebrow="Infrastructure · DNS" title="Domain Purchases" searchable searchPlaceholder="Search domain or status" columns={columns} filters={filters} defaultParams={{ sort: '-created' }} persistState persistKey="admin:dns:purchases" onRowClick={(row) => void modal.detail((close) => <DomainPurchaseDetail id={row.id} close={() => close(null)} />)} {...(canManage ? { addLabel: 'Add domain', onAdd: () => void showDomainOnboarding() } : {})} />;
}
