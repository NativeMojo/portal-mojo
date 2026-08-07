import { useQueryClient } from '@tanstack/react-query';
import { hasPermission, useMe } from '../../client/runtime';
import { Badge, fmt, modal, toast } from '../../ui';
import { CertificateDetail } from './CertificateDetail';
import { CertificateLifecyclePoller } from './CertificateLifecyclePoller';
import { CertificateRequestDialog } from './CertificateRequestDialog';
import { canInspectHouseCertificate, certificateStatusTone } from './certificate-data';
import { CertificateModel, DNS_MANAGE_PERMISSIONS, type CertificateRow, type DomainRow } from './models';

export function DomainCertificatesSection({ domain }: { domain: DomainRow }) {
    const queryClient = useQueryClient();
    const { data: me } = useMe();
    const canManage = hasPermission(me ?? null, DNS_MANAGE_PERMISSIONS, null);
    const query = CertificateModel.useList({ domain: domain.id, sort: '-created', start: 0, size: 25 });
    const open = async (row: CertificateRow) => {
        if (!canInspectHouseCertificate(domain, me?.is_superuser === true)) {
            toast.error('This certificate cannot be inspected with the current session.');
            return;
        }
        try {
            await CertificateModel.fetchOne(queryClient, row.id);
            await modal.detail((close) => <CertificateDetail id={row.id} domain={domain} onClose={() => close(null)} />);
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Certificate detail is unavailable');
        }
    };
    const request = async () => {
        await modal.open((close) => <CertificateRequestDialog close={close} domain={domain} />, { size: 'md' });
    };
    return <div className="dns-domain-certificates">
        <div className="dns-cert-section-head"><div><div className="eyebrow">Certificates</div><p className="dim">Issued certificate custody and ACME renewal state for this domain.</p></div>{canManage && <button className="btn btn-primary" onClick={() => void request()}><i className="bi bi-patch-plus" /> Request</button>}</div>
        {query.isPending ? <div className="dns-state dim">Loading certificates…</div> : query.error ? <div className="dns-errors">{query.error.message}</div> : !query.data?.rows.length ? <div className="dns-state dim">No certificates issued for this domain.</div> : <div className="dns-cert-list">
            {query.data.rows.map((row) => <button type="button" className="dns-cert-card" key={row.id} onClick={() => void open(row)}>
                <span><code>{row.common_name}</code><small>{row.sans.length} SAN{row.sans.length === 1 ? '' : 's'} · expires {fmt.date(row.not_after)}</small></span>
                <Badge tone={certificateStatusTone(row.status)}>{row.status}</Badge>
            </button>)}
        </div>}
        <CertificateLifecyclePoller domain={domain.id} />
    </div>;
}
