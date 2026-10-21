import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TagInput, toast } from '../../ui';
import { requestCertificate, useAcmeDelegations, useDnsCapabilities } from './api';
import { deriveCertificateReadiness, validateCertificateNames } from './certificate-data';
import { getAuthSessionRevision, getAuthSnapshot, hasPermission, requestFreshAuth, useMe } from '../../client/runtime';
import { confirmShared } from './SharedValidationDialog';
import { invalidateValidation, requestWildcard, useValidationPlan } from './shared-validation-api';
import { SharedValidationError } from './shared-validation-data';
import { CertificateModel, DNS_MANAGE_PERMISSIONS, DnsCredentialModel, DomainModel, type CertificateRow, type DomainRow } from './models';

function relationId(value: DomainRow['credential']): number | null {
    if (typeof value === 'number') return value;
    return value?.id ?? null;
}

export function CertificateRequestDialog({ close, domain: fixedDomain }: {
    close: (value: CertificateRow | null) => void;
    domain?: DomainRow;
}) {
    const queryClient = useQueryClient();
    const { data: me } = useMe();
    const domains = DomainModel.useList({ status: 'active', size: 200, sort: 'name' }, { enabled: fixedDomain == null });
    const [domainId, setDomainId] = useState<number | null>(fixedDomain?.id ?? null);
    const domainQuery = DomainModel.useOne(domainId);
    const domain = domainQuery.data ?? (fixedDomain?.id === domainId ? fixedDomain : undefined);
    const groupId = typeof domain?.group === 'number' ? domain.group : domain?.group?.id ?? null;
    const capabilities = useDnsCapabilities(groupId, { enabled: domain != null });
    const delegations = useAcmeDelegations(domain?.id ?? null, domain != null);
    const credentialId = domain ? relationId(domain.credential) : null;
    const credential = DnsCredentialModel.useOne(credentialId);
    const sharedPlan = useValidationPlan(domain ? { domain: domain.id } : null);
    const explicitShared = sharedPlan.data?.connection?.mode === 'shared';
    const sharedFlight = useRef(false);
    const sharedOwner = useRef<AbortController | null>(null);
    const [sharedRefreshRequired, setSharedRefreshRequired] = useState(false);
    const sharedRevision = getAuthSessionRevision();
    const sharedIdentity = JSON.stringify([domainId, sharedRevision, me?.id, hasPermission(me ?? null, DNS_MANAGE_PERMISSIONS, null)]);
    const currentIdentity = useRef(sharedIdentity); currentIdentity.current = sharedIdentity;
    useEffect(() => { const abort = new AbortController(); sharedOwner.current = abort; return () => abort.abort(); }, [sharedIdentity]);
    const [namesCsv, setNamesCsv] = useState('');
    const [names, setNames] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const validation = useMemo(
        () => domain ? validateCertificateNames(domain.name, names) : { names: [], errors: [] },
        [domain, names],
    );
    const readiness = domain && capabilities.data && !delegations.isPending
        ? deriveCertificateReadiness({
            domain,
            capabilities: capabilities.data,
            delegations: delegations.data ?? [],
            credential: credential.data ?? (typeof domain.credential === 'object' ? domain.credential : null),
        })
        : null;
    const loadingReadiness = domainId != null && (domainQuery.isPending || capabilities.isPending || delegations.isPending || (credentialId != null && credential.isPending));

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (explicitShared) {
            const r = sharedPlan.data;
            if (!domain || !r?.capabilities.can_request || !r.connection || !r.alias.target || sharedPlan.error || sharedPlan.loading || sharedFlight.current || sharedRefreshRequired || !hasPermission(me ?? null, DNS_MANAGE_PERMISSIONS, null)) return;
            sharedFlight.current = true; setSubmitting(true); setError(null);
            const identity = sharedIdentity, uid = getAuthSnapshot().uid, revision = getAuthSessionRevision();
            const signal = sharedOwner.current?.signal;
            const beforeSend = () => { if (signal?.aborted || currentIdentity.current !== identity || getAuthSnapshot().uid !== uid || getAuthSessionRevision() !== revision) throw new SharedValidationError('access'); };
            let submitted = false;
            try {
                const confirmed = await confirmShared({ title: 'Request wildcard certificate', message: <>Request a local certificate for <code>{r.profile.names.join(', ')}</code> through the verified shared validation target <code>{r.alias.target}</code>? This deployment keeps its own private key.</>, confirmText: 'Request wildcard', signal });
                if (!confirmed) return;
                beforeSend(); submitted = true;
                const result = await requestWildcard(r.connection.id, { domain: domain.id }, r.alias.target, { signal, beforeSend });
                beforeSend();
                if (result.certificate) { const row = await CertificateModel.fetchOne(queryClient, result.certificate.id); beforeSend(); close(row); }
            } catch (reason) {
                if (!signal?.aborted) { setError(reason instanceof SharedValidationError ? reason.message : 'Shared wildcard request could not be completed. Refresh before retrying.'); if (reason instanceof SharedValidationError && reason.kind === 'reauth') { setSharedRefreshRequired(true); await requestFreshAuth(); } }
            } finally {
                if (submitted) { await invalidateValidation(queryClient); if (!signal?.aborted) setSharedRefreshRequired(!(await sharedPlan.refresh())); }
                sharedFlight.current = false; setSubmitting(false);
            }
            return;
        }
        if (!domain || !readiness?.ready || validation.errors.length || submitting || (sharedPlan.error && sharedPlan.error.kind !== 'unsupported')) return;
        setSubmitting(true);
        setError(null);
        try {
            const row = await requestCertificate(queryClient, domain.id, names.length ? validation.names : undefined);
            toast.success('Certificate requested — issuance continues in the background.');
            close(row);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Certificate request failed');
        } finally {
            setSubmitting(false);
        }
    };

    return <form className="modal-pad dns-cert-request" onSubmit={(event) => void submit(event)}>
        <h2 className="modal-title">Request certificate</h2>
        <p className="dim">Issue over ACME DNS-01. The request returns immediately; lifecycle status updates in the certificate inventory.</p>
        {fixedDomain ? <div className="field"><span className="field-label">Domain</span><code>{fixedDomain.name}</code></div> : <label className="field">
            <span className="field-label">Domain</span>
            <select className="input" required value={domainId ?? ''} onChange={(event) => { setDomainId(event.target.value ? Number(event.target.value) : null); setNamesCsv(''); setNames([]); setError(null); }}>
                <option value="">Select an active domain…</option>
                {(domains.data?.rows ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
        </label>}
        {explicitShared ? <div className="dns-cert-readiness"><strong>Fixed shared wildcard profile</strong><code>{sharedPlan.data!.profile.names.join(', ')}</code><span>Only the backend-authorized apex and wildcard can be requested through this connection.</span><span>{sharedPlan.data!.next_action.code.replaceAll('_', ' ')}</span><button className="btn" type="button" disabled={submitting || sharedPlan.loading} onClick={() => void sharedPlan.refresh().then((r) => { setSharedRefreshRequired(!r); if (r) setError(null); })}>Refresh shared readiness</button></div> : <label className="field">
            <span className="field-label">Names</span>
            <TagInput
                name="certificate_names"
                value={namesCsv}
                onChange={(csv, next) => { setNamesCsv(csv); setNames(next); setError(null); }}
                placeholder={domain ? `${domain.name}, *.${domain.name}` : 'Choose a domain first'}
                maxTags={100}
                maxLength={253}
                disabled={!domain || submitting}
            />
            <span className="field-help">Leave empty for the domain apex plus its wildcard. Every SAN must stay inside the selected zone.</span>
        </label>}
        {!!validation.errors.length && <div className="dns-errors" role="alert">{validation.errors.map((message) => <div key={message}>{message}</div>)}</div>}
        {loadingReadiness && <div className="dns-cert-readiness dim"><i className="bi bi-arrow-repeat spin" /> Checking issuance readiness…</div>}
        {!explicitShared && readiness && <div className={`dns-cert-readiness${readiness.ready ? ' is-ready' : ' is-blocked'}`}>
            <strong>{readiness.label}</strong>
            {readiness.reason && <span>{readiness.reason}</span>}
        </div>}
        {capabilities.data?.acme.staging && <div className="dns-provider-note">
            <strong>Current ACME configuration: staging.</strong> New certificates are not publicly trusted. This flag is current configuration, not historical provenance for existing certificates.
        </div>}
        {sharedPlan.error && sharedPlan.error.kind !== 'unsupported' && <div className="dns-errors" role="alert">{sharedPlan.error.message}</div>}
        {capabilities.error && <div className="dns-errors">{capabilities.error.message}</div>}
        {error && <div className="dns-errors" role="alert">{error}</div>}
        <div className="modal-actions">
            <button className="btn" type="button" disabled={submitting} onClick={() => close(null)}>Cancel</button>
            <button className="btn btn-primary" type="submit" disabled={!domain || submitting || sharedPlan.loading || (explicitShared ? !sharedPlan.data?.capabilities.can_request || !!sharedPlan.error || sharedRefreshRequired : !readiness?.ready || validation.errors.length > 0 || (!!sharedPlan.error && sharedPlan.error.kind !== 'unsupported'))}>
                {submitting ? 'Requesting…' : 'Request certificate'}
            </button>
        </div>
    </form>;
}
