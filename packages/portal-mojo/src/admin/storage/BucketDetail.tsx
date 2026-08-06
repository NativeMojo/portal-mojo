import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArmedButton, DetailView, FlatRow, SchemaForm, fmt, modal, toast } from '../../ui';
import {
    BUCKET_MANAGE_PERMS, emptyBucket, setBucketPublic,
    type BucketEmptyResult, type BucketMutationOutcome, type S3BucketRow, type S3FailureEvidence,
} from './models';

function message(error: unknown): string { return error instanceof Error ? error.message : 'Storage operation failed'; }

function AggregateEvidence({ label, values }: { label: string; values: Record<string, number | null> | null | undefined }) {
    if (values === undefined) return null;
    if (values === null) return <p><b>{label}:</b> Unknown (no safe final probe)</p>;
    const entries = Object.entries(values);
    return entries.length > 0 ? <><h4>{label}</h4><dl>{entries.map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{value == null ? 'Unknown' : value.toLocaleString()}</dd></div>)}</dl></> : null;
}

function posture(value: boolean | null | undefined): string { return value == null ? 'Unknown' : value ? 'Public' : 'Private'; }

export function IncompleteEvidence({ evidence }: { evidence: S3FailureEvidence }) {
    const failure = evidence.failure;
    return <div className="storage-operation-evidence"><b>External operation incomplete: {evidence.mutation_state}</b><p>AWS state may have changed. Stop writers where relevant, correct IAM/provider posture, refresh, and retry.</p><AggregateEvidence label="Acknowledged counts" values={evidence.counts} /><AggregateEvidence label="Failed" values={evidence.failed} /><AggregateEvidence label="Remaining" values={evidence.remaining} />{failure && <dl>{failure.operation !== undefined && <div><dt>Failure operation</dt><dd>{failure.operation}</dd></div>}{failure.provider_code !== undefined && <div><dt>Provider code</dt><dd>{failure.provider_code}</dd></div>}{failure.retryable !== undefined && <div><dt>Retryable</dt><dd>{failure.retryable ? 'Yes' : 'No'}</dd></div>}</dl>}{evidence.requested_public !== undefined && <p>Requested posture: <b>{posture(evidence.requested_public)}</b></p>}{evidence.configured_public !== undefined && <p>Configured posture: <b>{posture(evidence.configured_public)}</b></p>}{evidence.created_new !== undefined && <p>Bucket newly created: <b>{evidence.created_new == null ? 'Unknown' : evidence.created_new ? 'Yes' : 'No'}</b></p>}{evidence.safety_lock && <p>Safety lock: <b>{evidence.safety_lock}</b></p>}</div>;
}

function Outcome({ value }: { value: BucketMutationOutcome<unknown> | null }) {
    if (!value) return null;
    return <div className={`storage-operation-result${value.error ? ' is-error' : ''}`}>{Boolean(value.error) && <p>{message(value.error)}</p>}{value.evidence && <IncompleteEvidence evidence={value.evidence} />}{Boolean(value.refreshError) && <p className="text-warn"><i className="bi bi-exclamation-triangle" /> Authoritative refresh also failed. Refresh manually before another action.</p>}</div>;
}

export function BucketDetail({ bucket, onClose }: { bucket: S3BucketRow; onClose: () => void }) {
    const queryClient = useQueryClient();
    const [outcome, setOutcome] = useState<BucketMutationOutcome<unknown> | null>(null);
    const [emptyResult, setEmptyResult] = useState<BucketEmptyResult | null>(null);

    const access = async (isPublic: boolean) => {
        const confirmed = await modal.confirm({
            title: isPublic ? 'Make whole bucket public?' : 'Make whole bucket private?',
            message: isPublic
                ? <>This changes account-level S3 policy and Public Access Block posture for <code>{bucket.name}</code>. Verified configuration does not guarantee every anonymous fetch.</>
                : <>This applies the all-private Public Access Block posture to <code>{bucket.name}</code>. The operation is externally observable and not atomic.</>,
            confirmText: isPublic ? 'Make public' : 'Make private', danger: isPublic,
        });
        if (!confirmed) return;
        const next = await setBucketPublic(queryClient, bucket.name, isPublic);
        setOutcome(next);
        if (next.data) toast.success(`${bucket.name} verified ${next.data.is_public ? 'public' : 'private'}`);
    };

    const confirmEmpty = async () => {
        await modal.open((close) => (
            <div className="modal-pad">
                <h2 className="modal-title">Empty {bucket.name}</h2>
                <p className="modal-message">Irreversibly removes current objects, every version/delete marker, and outstanding multipart uploads. Enter the exact case-sensitive name.</p>
                <SchemaForm
                    fields={[{ name: 'confirm_name', type: 'text', label: 'Exact bucket name', required: true }]}
                    submitText="Empty bucket"
                    onCancel={() => close(null)}
                    onSubmit={async (data) => {
                        const exact = String(data.confirm_name ?? '');
                        if (exact !== bucket.name) throw new Error('Bucket name does not match exactly. No request was sent.');
                        const next = await emptyBucket(queryClient, bucket.name, exact);
                        setOutcome(next);
                        if (next.error) throw next.error;
                        if (next.data) { setEmptyResult(next.data); toast.success(`${bucket.name} empty acknowledged`); }
                        close(true);
                    }}
                />
            </div>
        ), { size: 'sm' });
    };

    return <DetailView title={bucket.name} subtitle="Account-level S3 bucket" icon="bi-bucket" chips={[{ text: 'Global', tone: 'info' }]} sections={[
        { key: 'overview', label: 'Overview', icon: 'bi-info-circle', render: () => <div className="detail-section"><FlatRow label="Name"><code>{bucket.name}</code></FlatRow><FlatRow label="Created">{fmt.datetime(bucket.created)}</FlatRow><FlatRow label="Inventory">Complete account inventory row</FlatRow><Outcome value={outcome} />{emptyResult && <div className="storage-counts"><b>Last acknowledged empty counts</b><span>Objects {emptyResult.deleted_objects}</span><span>Versions {emptyResult.deleted_versions}</span><span>Delete markers {emptyResult.deleted_markers}</span><span>Multipart uploads {emptyResult.aborted_uploads}</span></div>}</div> },
        { key: 'access', label: 'Access', icon: 'bi-shield-lock', permissions: BUCKET_MANAGE_PERMS, render: () => <div className="detail-section"><h3>Verified access posture</h3><p className="dim">Every attempt refreshes inventory in a finally path. A rejection can still represent partial external change.</p><div className="storage-action-row"><button className="btn btn-danger" onClick={() => void access(true)}>Make public…</button><button className="btn" onClick={() => void access(false)}>Make private…</button></div></div> },
        { key: 'danger', label: 'Danger zone', icon: 'bi-exclamation-octagon', permissions: BUCKET_MANAGE_PERMS, render: () => <div className="detail-section storage-danger"><h3>Empty bucket</h3><p>Irreversible and non-atomic against active writers. Bucket deletion is unavailable.</p><ArmedButton className="btn-danger" icon="bi-trash3" label="Empty bucket" armedLabel="Click again — remove all objects, versions, markers, and uploads" onConfirm={confirmEmpty} /></div> },
    ]} initialSection="overview" onClose={onClose} />;
}
