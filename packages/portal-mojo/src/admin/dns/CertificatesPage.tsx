import { useQueryClient } from '@tanstack/react-query';
import { hasPermission, useMe } from '../../client/runtime';
import { Badge, ModelTable, fmt, modal, toast, type Column, type FilterDef } from '../../ui';
import { useDnsCapabilities } from './api';
import { CertificateDetail } from './CertificateDetail';
import { CertificateLifecyclePoller } from './CertificateLifecyclePoller';
import { CertificateRequestDialog } from './CertificateRequestDialog';
import {
    canInspectHouseCertificate, certificateStatusTone, deriveCertificateRenewalHealth,
} from './certificate-data';
import {
    CertificateModel, DNS_MANAGE_PERMISSIONS, DomainModel,
    type CertificateRow,
} from './models';

function domainId(row: CertificateRow): number {
    return typeof row.domain === 'number' ? row.domain : row.domain.id;
}

function renewalLabel(row: CertificateRow): string {
    const health = deriveCertificateRenewalHealth(row);
    if (health === 'healthy') return fmt.date(row.renew_after);
    if (health === 'due') return 'Due now';
    if (health === 'renewal-error') return 'Error';
    return health === 'unknown' ? '—' : health;
}

const columns: Column<CertificateRow>[] = [
    { key: 'common_name', label: 'Common name', sortable: true, hideable: false, render: (row) => <code>{row.common_name || `Certificate ${row.id}`}</code> },
    { key: 'status', label: 'Status', sortable: true, render: (row) => <Badge tone={certificateStatusTone(row.status)}>{row.status}</Badge> },
    { key: 'sans', label: 'SANs', align: 'end', render: (row) => row.sans.length },
    { key: 'issuer', label: 'Issuer', render: (row) => row.issuer ?? '—' },
    { key: 'not_after', label: 'Expires', sortable: true, render: (row) => fmt.date(row.not_after) },
    { key: 'renew_after', label: 'Renewal', sortable: true, render: (row) => <span className={deriveCertificateRenewalHealth(row) === 'renewal-error' ? 'text-bad' : deriveCertificateRenewalHealth(row) === 'due' ? 'text-warn' : undefined}>{renewalLabel(row)}</span> },
    { key: 'domain', label: 'Domain', render: (row) => typeof row.domain === 'number' ? `#${row.domain}` : <code>{row.domain.name}</code> },
];

const filters: FilterDef[] = [
    { key: 'status', label: 'Status', type: 'multiselect', options: ['pending', 'issuing', 'active', 'failed', 'revoked'].map((value) => ({ value, label: value })) },
    { key: 'domain', label: 'Domain id', type: 'number', lookup: 'exact' },
];

export function CertificatesPage() {
    const queryClient = useQueryClient();
    const { data: me } = useMe();
    const capabilities = useDnsCapabilities(null);
    const canManage = hasPermission(me ?? null, DNS_MANAGE_PERMISSIONS, null);
    const openCertificate = async (row: CertificateRow) => {
        try {
            const domain = await DomainModel.fetchOne(queryClient, domainId(row));
            if (!canInspectHouseCertificate(domain, me?.is_superuser === true)) {
                toast.error('This certificate cannot be inspected with the current session.');
                return;
            }
            await CertificateModel.fetchOne(queryClient, row.id);
            await modal.detail((close) => <CertificateDetail id={row.id} domain={domain} onClose={() => close(null)} />);
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Certificate detail is unavailable');
        }
    };
    const request = async () => {
        await modal.open((close) => <CertificateRequestDialog close={close} />, { size: 'md' });
    };
    return <div className="dns-certificates-page">
        {capabilities.data?.acme.configured === false && <div className="dns-cert-banner is-blocked"><i className="bi bi-exclamation-triangle" /><span><strong>ACME is not configured.</strong> Existing lifecycle state remains visible, but new certificate requests are unavailable.</span></div>}
        {capabilities.data?.acme.staging === true && <div className="dns-cert-banner"><i className="bi bi-cone-striped" /><span><strong>Current ACME configuration uses staging.</strong> New certificates are not publicly trusted. Existing rows do not record historical staging provenance.</span></div>}
        {capabilities.error && <div className="dns-cert-banner is-blocked"><i className="bi bi-exclamation-triangle" /><span>{capabilities.error.message}</span></div>}
        <ModelTable<CertificateRow>
            model={CertificateModel}
            eyebrow="Infrastructure · DNS"
            title="Certificates"
            searchable
            searchPlaceholder="Search common name or status"
            columns={columns}
            filters={filters}
            defaultParams={{ sort: '-created' }}
            columnChooser
            persistState
            persistKey="admin:dns:certificates"
            onRowClick={(row) => void openCertificate(row)}
            {...(canManage && capabilities.data?.acme.configured !== false ? { addLabel: 'Request certificate', onAdd: () => void request() } : {})}
        />
        <CertificateLifecyclePoller />
    </div>;
}
