import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { hasPermission, useMe } from '../../client/runtime';
import { CollectionSelect, FlatRow, modal, toast } from '../../ui';
import { assignHouseDomain, DNS_GROUP_CHOICE_ENDPOINT, fetchDnsGroupChoice } from './api';
import { domainSession, requireDomainManager } from './domain-authority';
import { fetchDomainOverview } from './registrar-api';
import { DNS_MANAGE_PERMISSIONS, DomainModel, type DnsGroupChoice, type DomainRow } from './models';
import { redactRegistrarError } from './purchase-data';

export function DomainAssignment({ domain, close, onBusyChange }: { domain: DomainRow; close: () => void; onBusyChange: (busy: boolean) => void }) {
    const { data: me } = useMe(); const qc = useQueryClient();
    const [group, setGroup] = useState<DnsGroupChoice | null>(null);
    const [review, setReview] = useState(false); const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false); const [attempted, setAttempted] = useState(false); const [error, setError] = useState('');
    const [observed, setObserved] = useState<DomainRow | null>(null);
    const flight = useRef(false); const mounted = useRef(true); const session = useRef(domainSession());
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const allowed = me?.is_superuser === true && hasPermission(me, DNS_MANAGE_PERMISSIONS, null) && domain.group == null;
    const refresh = async () => {
        try { const row = await fetchDomainOverview(domain.id); if (!mounted.current || domainSession() !== session.current) return; setObserved(row); qc.setQueryData(DomainModel.keys.one(domain.id), row); }
        catch { if (mounted.current) setError('Could not refresh the domain. Check its inventory before taking another action.'); }
        finally { await DomainModel.invalidate(qc); }
    };
    const submit = async () => {
        if (flight.current || attempted || !allowed || !group || !review || confirm !== group.name) return;
        flight.current = true; setBusy(true); onBusyChange(true); setError('');
        try {
            await requireDomainManager(session.current, true);
            const [current, target] = await Promise.all([fetchDomainOverview(domain.id), fetchDnsGroupChoice(group.id)]);
            if (domainSession() !== session.current || !mounted.current) return;
            if (current.group != null) { setObserved(current); setAttempted(true); throw new Error('This domain has already been assigned. Reassignment is unavailable.'); }
            if (!target || target.name !== group.name) throw new Error('The destination changed. Close and choose it again.');
            setAttempted(true);
            const row = await assignHouseDomain({ domain: domain.id, group: group.id }, () => { if (!mounted.current || domainSession() !== session.current) throw new Error('Session changed. Reopen this task.'); });
            if (domainSession() !== session.current || !mounted.current) return;
            const owner = typeof row.group === 'number' ? row.group : row.group?.id;
            if (row.id !== domain.id || owner !== group.id) throw new Error('The response did not confirm the selected destination.');
            qc.setQueryData(DomainModel.keys.one(domain.id), row); toast.success(`${domain.name} assigned to ${group.name}`); close();
        } catch (reason) {
            if (mounted.current && domainSession() === session.current) setError(`${redactRegistrarError(reason)}${flight.current ? ' Refresh to inspect the current owner. This form will not repeat a submitted assignment.' : ''}`);
        } finally { await refresh(); flight.current = false; if (mounted.current) setBusy(false); onBusyChange(false); }
    };
    if (!allowed) return <div className="modal-pad"><h2 className="modal-title">Assignment unavailable</h2><p>Only a platform administrator can assign an unassigned domain.</p><button className="btn" onClick={close}>Close</button></div>;
    return <div className="modal-pad domains-assignment"><h2 className="modal-title">Assign {domain.name}</h2><p className="dim">Give this Platform domain to one group. This assignment cannot be changed here.</p>{error && <div className="form-alert" role="alert">{error}</div>}{observed?.group != null && <FlatRow label="Current owner">{typeof observed.group === 'number' ? `Group #${observed.group}` : observed.group.name}</FlatRow>}
        {!attempted && !review && <CollectionSelect<DnsGroupChoice> endpoint={DNS_GROUP_CHOICE_ENDPOINT} value={group} onChange={(_id, row) => setGroup(row ?? null)} label="Destination group" required maxItems={25} defaultParams={{ start: 0 }} disabled={busy} />}
        {review && !attempted && <><FlatRow label="Domain">{domain.name}</FlatRow><FlatRow label="From">Platform</FlatRow><FlatRow label="To">{group?.name}</FlatRow><label className="field"><span className="field-label">Type {group?.name} to confirm</span><input className="input" value={confirm} disabled={busy} onChange={event => setConfirm(event.target.value)} /></label></>}
        <div className="modal-actions"><button className="btn" disabled={busy} onClick={close}>{attempted ? 'Close' : 'Cancel'}</button>{attempted ? <button className="btn" disabled={busy} onClick={() => void refresh()}>Refresh owner</button> : review ? <><button className="btn" disabled={busy} onClick={() => { setReview(false); setConfirm(''); }}>Back</button><button className="btn btn-primary" disabled={busy || confirm !== group?.name} onClick={() => void submit()}>{busy ? 'Assigning…' : 'Assign to group'}</button></> : <button className="btn btn-primary" disabled={!group || busy} onClick={() => setReview(true)}>Review assignment</button>}</div>
    </div>;
}

export function showDomainAssignment(domain: DomainRow) {
    let busy = false;
    return modal.open(close => <DomainAssignment domain={domain} close={() => close(null)} onBusyChange={value => { busy = value; }} />, { size: 'md', canDismiss: () => !busy });
}
