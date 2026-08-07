import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { hasPermission, useMe } from '../../client';
import { Badge, DetailView, Eyebrow, FlatRow, fmt, modal, toast } from '../../ui';
import { revokeCertificate, useAcmeDelegations, useDnsCapabilities } from './api';
import {
    canInspectHouseCertificate, certificateStatusTone, deriveCertificateRenewalHealth,
} from './certificate-data';
import { CertificateModel, DNS_MANAGE_PERMISSIONS, type CertificateRow, type DomainRow } from './models';

function healthLabel(row: CertificateRow): string {
    const health = deriveCertificateRenewalHealth(row);
    if (health === 'due') return 'Renewal due';
    if (health === 'renewal-error') return 'Renewal error';
    if (health === 'healthy') return 'Renewal scheduled';
    return health.charAt(0).toUpperCase() + health.slice(1);
}

function AllowedCertificateDetail({ id, domain, onClose }: { id: number; domain: DomainRow; onClose: () => void }) {
    const queryClient = useQueryClient();
    const query = CertificateModel.useOne(id);
    const { data: me } = useMe();
    const groupId = typeof domain.group === 'number' ? domain.group : domain.group?.id ?? null;
    const capabilities = useDnsCapabilities(groupId);
    const delegations = useAcmeDelegations(domain.id);
    const [revoking, setRevoking] = useState(false);
    const certificate = query.data;
    if (query.isPending) return <div className="modal-pad dim">Loading certificate…</div>;
    if (!certificate || query.error) return <div className="modal-pad text-bad">{query.error?.message ?? 'Certificate not found'}</div>;
    const health = deriveCertificateRenewalHealth(certificate);
    const canManage = hasPermission(me ?? null, DNS_MANAGE_PERMISSIONS, null);

    const revoke = async () => {
        if (revoking) return;
        const confirmed = await modal.confirm({
            title: 'Revoke certificate',
            message: <>Revoke the certificate for <code>{certificate.common_name}</code>? Hosts may continue serving it until they sync a replacement. This cannot be undone.</>,
            confirmText: 'Revoke', danger: true,
        });
        if (!confirmed) return;
        setRevoking(true);
        try {
            await revokeCertificate(queryClient, certificate.id);
            toast.success('Certificate revoked');
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Certificate revocation failed');
        } finally {
            setRevoking(false);
        }
    };

    const delegation = (delegations.data ?? [])[0] ?? null;
    const expiryTone = certificate.days_remaining != null && certificate.days_remaining < 14 ? 'danger'
        : certificate.days_remaining != null && certificate.days_remaining < (capabilities.data?.cert_renew_days ?? 30) ? 'warning'
            : 'success';
    return <DetailView<CertificateRow>
        icon="bi-patch-check"
        title={certificate.common_name || `Certificate ${certificate.id}`}
        subtitle={certificate.issuer ?? 'Issued over ACME DNS-01'}
        chips={[
            { text: certificate.status, tone: certificateStatusTone(certificate.status) },
            ...(certificate.days_remaining == null ? [] : [{ text: `${certificate.days_remaining} days left`, tone: expiryTone as 'success' | 'warning' | 'danger' }]),
        ]}
        sections={[
            { key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => <div className="dns-cert-detail-section">
                <Eyebrow>Certificate</Eyebrow>
                <FlatRow label="Common name"><code>{certificate.common_name}</code></FlatRow>
                <FlatRow label="Status"><Badge tone={certificateStatusTone(certificate.status)}>{certificate.status}</Badge></FlatRow>
                <FlatRow label="Domain"><code>{domain.name}</code></FlatRow>
                <FlatRow label="Issuer">{certificate.issuer ?? '—'}</FlatRow>
                <FlatRow label="Serial"><code>{certificate.serial ?? '—'}</code></FlatRow>
                <FlatRow label="Attempts">{certificate.attempts}</FlatRow>
                {certificate.last_error && <div className="dns-errors"><strong>Last operation error</strong><span>{certificate.last_error}</span></div>}
            </div> },
            { key: 'names', label: 'Names', icon: 'bi-tags', render: () => <div className="dns-cert-detail-section">
                <Eyebrow>Subject alternative names</Eyebrow>
                {certificate.sans.length ? <ul className="dns-cert-names">{certificate.sans.map((name) => <li key={name}><code>{name}</code></li>)}</ul> : <p className="dim">No names are recorded yet; issuance may still be starting.</p>}
            </div> },
            { key: 'renewal', label: 'Renewal', icon: 'bi-arrow-repeat', render: () => <div className="dns-cert-detail-section">
                <Eyebrow>Validity and renewal</Eyebrow>
                <FlatRow label="Not before">{fmt.date(certificate.not_before)}</FlatRow>
                <FlatRow label="Not after">{fmt.date(certificate.not_after)}</FlatRow>
                <FlatRow label="Renew after">{fmt.date(certificate.renew_after)}</FlatRow>
                <FlatRow label="Health">{healthLabel(certificate)}</FlatRow>
                {health === 'due' && <div className="dns-provider-note">Renewal is due according to the backend-authored <code>renew_after</code> timestamp. The page watches the bounded lifecycle transition.</div>}
                <Eyebrow>Certificate custody</Eyebrow>
                <p className="dim">Serving hosts sync certificate material themselves after the backend broadcasts an update. Private keys are never loaded into this Admin client or its caches.</p>
                {capabilities.data?.acme.staging && <p className="dns-warning">The deployment currently targets the ACME staging directory. That current setting does not prove how this existing certificate was issued.</p>}
            </div> },
            { key: 'delegation', label: 'Delegation', icon: 'bi-diagram-2', render: () => <div className="dns-cert-detail-section">
                <Eyebrow>DNS-01 routing</Eyebrow>
                {delegations.isPending ? <p className="dim">Loading delegation status…</p> : delegation ? <>
                    <FlatRow label="State"><Badge tone={delegation.state === 'verified' ? 'success' : delegation.state === 'broken' ? 'danger' : 'warning'}>{delegation.state}</Badge></FlatRow>
                    <FlatRow label="Source"><code>{delegation.source ?? '—'}</code></FlatRow>
                    <FlatRow label="Target"><code>{delegation.target ?? '—'}</code></FlatRow>
                    {delegation.last_error_code && <FlatRow label="Error code"><code>{delegation.last_error_code}</code></FlatRow>}
                    {delegation.verified_at && delegation.state === 'broken' && <div className="dns-errors">This delegation is sticky after verification. Repair it; issuance will not fall back to direct provider DNS.</div>}
                </> : <p className="dim">No delegated ACME route is attached; provider DNS is used directly.</p>}
            </div> },
        ]}
        initialSection="overview"
        contextMenu={canManage && certificate.status === 'active' ? [{ label: revoking ? 'Revoking…' : 'Revoke certificate', icon: 'bi-x-octagon', danger: true, onSelect: () => void revoke() }] : []}
        menuContext={certificate}
        onClose={onClose}
    />;
}

/** Fail closed without explaining whether a denied id belongs to the house. */
export function CertificateDetail({ id, domain, onClose }: { id: number; domain: DomainRow; onClose: () => void }) {
    const { data: me } = useMe();
    if (!canInspectHouseCertificate(domain, me?.is_superuser === true)) {
        return <div className="modal-pad"><h2 className="modal-title">Certificate unavailable</h2><p className="dim">This certificate cannot be inspected with the current session.</p><div className="modal-actions"><button className="btn" onClick={onClose}>Close</button></div></div>;
    }
    return <AllowedCertificateDetail id={id} domain={domain} onClose={onClose} />;
}
