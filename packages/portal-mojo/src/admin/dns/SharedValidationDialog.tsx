import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAuthSessionRevision, getAuthSnapshot, hasPermission, requestFreshAuth, subscribeAuth, useAuthSnapshot, useMe } from '../../client/runtime';
import { CollectionSelect, FlatRow, modal, toast } from '../../ui';
import { DNS_MANAGE_PERMISSIONS, DomainModel, sanitizeDomainRow, type DnsGroupChoice, type DomainRow } from './models';
import { checkValidation, connectValidation, getAllocations, getHubCapabilities, getParticipants, getRecipient, grantValidation, invalidateValidation, requestWildcard, revokeValidation, sanitizeSetupGroup, SETUP_GROUP_ENDPOINT, useValidationPlan } from './shared-validation-api';
import { CONNECTION_REQUEST_MAX_BYTES, normalizeHostname, parseConnectionRequestText, serializeConnectionRequest, SharedValidationError, type Allocation, type ConnectionRequest, type HubCapabilities, type Page, type Participant, type Recipient, type SetupTarget } from './shared-validation-data';
import { ValidationFacts } from './SharedValidationPanel';

export function confirmShared(options: { title: string; message: ReactNode; confirmText: string; danger?: boolean; signal?: AbortSignal }) {
    return modal.open<boolean>((close) => <div className="modal-pad dns-shared-confirm"><h2 className="modal-title">{options.title}</h2><div className="modal-message">{options.message}</div><div className="modal-actions"><button className="btn" onClick={() => close(false)}>Cancel</button><button className={options.danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => close(true)}>{options.confirmText}</button></div></div>, { size: 'md', signal: options.signal }).then((value) => value === true);
}

export function openSharedValidation(domain?: DomainRow) {
    let pending = false;
    return modal.open((close) => <SharedValidationDialog domain={domain} close={() => close(null)} onBusy={(value) => { pending = value; }} />, { size: 'lg', canDismiss: () => !pending });
}

export function SharedValidationDialog({ domain: fixedDomain, close, onBusy }: { domain?: DomainRow; close: () => void; onBusy?: (value: boolean) => void }) {
    const qc = useQueryClient(); const { data: me } = useMe(); const auth = useAuthSnapshot();
    const canManage = auth.authenticated && hasPermission(me ?? null, DNS_MANAGE_PERMISSIONS, null);
    const revision = useSyncExternalStore(subscribeAuth, getAuthSessionRevision, getAuthSessionRevision);
    const [mode, setMode] = useState<'project' | 'controller'>('project');
    const [targetKind, setTargetKind] = useState<'existing' | 'new'>('existing');
    const [domain, setDomain] = useState<DomainRow | null>(fixedDomain ?? null);
    const [group, setGroup] = useState<DnsGroupChoice | null>(null);
    const nameRef = useRef<HTMLInputElement>(null), allocationRef = useRef<HTMLInputElement>(null);
    const [inspected, setInspected] = useState<{ target: SetupTarget; allocation?: string } | null>(fixedDomain ? { target: { domain: fixedDomain.id } } : null);
    const plan = useValidationPlan(mode === 'project' ? inspected?.target ?? null : null, inspected?.allocation);
    const controllerIdentity = JSON.stringify([auth.uid, revision, canManage]);
    const [controllerAuthority, setControllerAuthority] = useState<{ identity: string; caps: HubCapabilities } | null>(null);
    // A replacement session never borrows the previous session's controller proof,
    // including the render before the cleanup effect clears its selected facts.
    const caps = controllerAuthority?.identity === controllerIdentity ? controllerAuthority.caps : null;
    const setCaps = (value: HubCapabilities | null) => setControllerAuthority(value ? { identity: controllerIdentity, caps: value } : null);
    const [controllerDomain, setControllerDomain] = useState('');
    const [participantCursor, setParticipantCursor] = useState<string | undefined>();
    const [participantLoading, setParticipantLoading] = useState(false);
    const [participantError, setParticipantError] = useState('');
    const [recipientLoading, setRecipientLoading] = useState(false);
    const [recipientError, setRecipientError] = useState('');
    const fileGeneration = useRef(0);
    const downloadUrls = useRef(new Set<string>());
    useEffect(() => () => { fileGeneration.current++; downloadUrls.current.forEach((url) => URL.revokeObjectURL(url)); downloadUrls.current.clear(); }, []);
    const [descriptor, setDescriptor] = useState<ConnectionRequest | null>(null);
    const [allocations, setAllocations] = useState<Page<Allocation> | null>(null);
    const [allocation, setAllocation] = useState<Allocation | null>(null);
    const [recipient, setRecipient] = useState<Recipient | null>(null);
    const [participants, setParticipants] = useState<Page<Participant> | null>(null);
    const [error, setError] = useState(''); const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false); const flight = useRef(false);
    const [refreshRequired, setRefreshRequired] = useState(false);
    const selection = JSON.stringify([fixedDomain?.id, fixedDomain?.name, fixedDomain?.group, mode, targetKind, domain?.id, group?.id, inspected, controllerDomain, descriptor, allocation?.allocation_ref, participantCursor, auth.uid, revision, canManage]);
    const latest = useRef(selection); latest.current = selection;
    const owner = useRef<AbortController | null>(null);
    const livePermission = useRef(canManage); livePermission.current = canManage;
    const liveCaps = useRef(caps); liveCaps.current = caps;
    const setPending = (value: boolean) => { flight.current = value; setBusy(value); onBusy?.(value); };
    useEffect(() => {
        const abort = new AbortController(); owner.current = abort;
        return () => { abort.abort(); };
    }, [selection]);
    useEffect(() => () => { onBusy?.(false); }, [onBusy]);
    useEffect(() => {
        setControllerAuthority(null); setDescriptor(null); setAllocations(null); setAllocation(null); setRecipient(null); setParticipants(null);
        fileGeneration.current++; setControllerDomain(''); setParticipantCursor(undefined); setParticipantError(''); setRecipientError('');
    }, [auth.authenticated, canManage, auth.uid, revision]);
    const scope = () => {
        const selected = selection, uid = auth.uid, rev = revision;
        const signal = owner.current?.signal;
        const beforeSend = () => {
            if (signal?.aborted || latest.current !== selected || !livePermission.current || getAuthSnapshot().uid !== uid || getAuthSessionRevision() !== rev) throw new SharedValidationError('access');
        };
        return { signal, beforeSend };
    };
    useEffect(() => { if (fixedDomain) { setDomain(fixedDomain); setInspected({ target: { domain: fixedDomain.id } }); setError(''); setNotice(''); setRefreshRequired(false); } }, [fixedDomain?.id]);
    const resetSelection = () => { fileGeneration.current++; setControllerDomain(''); setParticipantCursor(undefined); setParticipantError(''); setRecipientError(''); setInspected(null); setDescriptor(null); setAllocations(null); setAllocation(null); setRecipient(null); setParticipants(null); setError(''); setNotice(''); setRefreshRequired(false); };
    const inspect = () => {
        try {
            const target: SetupTarget = targetKind === 'existing' && domain ? { domain: domain.id } : group ? { group: group.id, name: normalizeHostname(nameRef.current?.value ?? '') } : (() => { throw new SharedValidationError('invalid'); })();
            const value = allocationRef.current?.value.trim() ?? '';
            setInspected({ target, ...(value ? { allocation: normalizeHostname(value) } : {}) }); setError(''); setNotice(''); setRefreshRequired(false);
        } catch { setError('Choose an authorized domain, or an eligible group and exact domain name, and use only a public validation target hostname.'); }
    };
    const explain = async (reason: unknown) => {
        const safe = reason instanceof SharedValidationError ? reason : new SharedValidationError('unavailable');
        setError(safe.message);
        if (safe.kind === 'reauth') { setRefreshRequired(true); await requestFreshAuth(); }
    };
    const localAction = async (action: 'connect' | 'restart' | 'check' | 'request') => {
        const r = plan.data;
        if (flight.current || !canManage || !r || plan.error || plan.loading || refreshRequired || !inspected) return;
        if (!(action === 'restart' ? r.capabilities.can_restart : action === 'check' ? r.capabilities.can_check : action === 'request' ? r.capabilities.can_request : r.capabilities.can_connect)) return;
        const target = inspected.target; const targetAllocation = r.alias.target;
        if (!targetAllocation) return;
        const fence = scope(), trigger = document.activeElement as HTMLElement | null; setPending(true); setError(''); setNotice('');
        let submitted = false;
        try {
            const confirmed = await confirmShared({
                title: action === 'request' ? 'Request wildcard certificate' : action === 'check' ? 'Check validation' : action === 'restart' ? 'Prepare a fresh connection request' : r.connection ? 'Connect approved validation' : 'Prepare connection',
                message: <div className="dns-shared-confirm"><p><code>{r.domain.name}</code> and <code>*.{r.domain.name}</code></p><p>Existing target: <code>{targetAllocation}</code></p>{r.connection && <p>Connection reference: <code>{r.connection.client_ref}</code></p>}<p>{action === 'request' ? 'Request an independent local certificate for exactly this apex and wildcard. This deployment keeps its own private key.' : action === 'check' ? 'Check current trust and the exact one-hop CNAME, and save the local validation result.' : action === 'restart' ? 'Retire the old reference and prepare a fresh request requiring controller approval again. Keep the same validation target and any valid local certificate.' : 'Preparing shared validation pauses direct local validation and renewal until controller authorization and checking finish. An existing valid certificate remains available. This does not grant trust or replace DNS.'}</p></div>,
                confirmText: action === 'request' ? 'Request wildcard' : action === 'check' ? 'Check validation' : action === 'restart' ? 'Prepare fresh request' : r.connection ? 'Connect validation' : 'Prepare connection',
                signal: fence.signal,
            });
            if (!confirmed) return;
            fence.beforeSend(); submitted = true;
            const result = action === 'check' ? await checkValidation(r.connection!.id, target, targetAllocation, fence) : action === 'request' ? await requestWildcard(r.connection!.id, target, targetAllocation, fence) : await connectValidation(target, targetAllocation, action === 'restart', fence);
            fence.beforeSend(); setNotice(`Backend result: ${result.operation.outcome.replaceAll('_', ' ')}.`);
        } catch (reason) { if (!fence.signal?.aborted) await explain(reason); }
        finally {
            if (submitted) {
                await invalidateValidation(qc);
                if (!fence.signal?.aborted) { const fresh = await plan.refresh(); setRefreshRequired(!fresh); if (!fresh) setError('The operation may have persisted. Refresh successfully before another action.'); }
            }
            setPending(false); restoreFocus(trigger, fence);
        }
    };
    const discardControllerFacts = () => {
        setCaps(null); setAllocations(null); setAllocation(null); setParticipants(null); setRecipient(null); setDescriptor(null);
        setParticipantLoading(false); setRecipientLoading(false);
    };
    const refreshController = async (selected: Allocation, fence = scope()) => {
        try {
            const nextCaps = await getHubCapabilities(fence); fence.beforeSend();
            if (!nextCaps.shared_validation || !nextCaps.can_manage_trust) throw new SharedValidationError('access');
            const rows = await getParticipants(selected, participantCursor, fence); fence.beforeSend();
            setCaps(nextCaps); setParticipants(rows); setParticipantError(''); return rows;
        } catch (reason) {
            if (!fence.signal?.aborted) discardControllerFacts();
            throw reason;
        }
    };
    const loadController = async () => {
        if (flight.current || !canManage) return;
        const fence = scope(); setPending(true); setError('');
        try { const nextCaps = await getHubCapabilities(fence); fence.beforeSend(); setCaps(nextCaps); if (!nextCaps.shared_validation || !nextCaps.can_manage_trust) { discardControllerFacts(); setError('This session cannot manage shared validation trust. Ask the allocation controller.'); } }
        catch (reason) { if (!fence.signal?.aborted) { discardControllerFacts(); await explain(reason); } }
        finally { setPending(false); }
    };
    const clearControllerSelection = () => {
        setAllocations(null); setAllocation(null); setParticipants(null); setRecipient(null); setParticipantCursor(undefined);
        setParticipantError(''); setRecipientError(''); setRefreshRequired(false); setError(''); setNotice('');
    };
    const importRequest = async (file?: File) => {
        if (!file || flight.current || !canManage || !caps?.shared_validation || !caps.can_manage_trust) return;
        const fence = scope(), generation = ++fileGeneration.current;
        setPending(true); setError('');
        try {
            if (!file.size || file.size > CONNECTION_REQUEST_MAX_BYTES) throw new SharedValidationError('invalid');
            const request = parseConnectionRequestText(await file.text());
            fence.beforeSend(); if (generation !== fileGeneration.current) return;
            clearControllerSelection(); setDescriptor(request); setControllerDomain(request.domain);
        } catch { if (!fence.signal?.aborted && generation === fileGeneration.current) setError('Choose a public five-field v1 request file, between 1 and 2048 UTF-8 bytes.'); }
        finally { setPending(false); }
    };
    const findAllocations = async (cursor?: string) => {
        if (flight.current || !canManage || !caps?.shared_validation || !caps.can_manage_trust) return;
        const fence = scope(); setPending(true); setError('');
        try {
            const exact = normalizeHostname(controllerDomain);
            const page = await getAllocations(exact, cursor, fence); fence.beforeSend();
            setAllocations(page); setAllocation(null); setParticipants(null); setRecipient(null); setParticipantCursor(undefined); setRefreshRequired(false);
        } catch (reason) { if (!fence.signal?.aborted) { discardControllerFacts(); await explain(reason); } }
        finally { setPending(false); }
    };
    // Participant maintenance is authorized by the selected allocation, independently
    // of an imported request or active recipient. Each read has its own error state.
    useEffect(() => {
        if (!allocation || mode !== 'controller' || !canManage || !caps?.shared_validation || !caps.can_manage_trust) return;
        const fence = scope(); let active = true; setParticipantLoading(true); setParticipantError(''); setParticipants(null);
        void getParticipants(allocation, participantCursor, fence).then((rows) => { fence.beforeSend(); if (active) setParticipants(rows); }).catch((reason) => {
            if (active && !fence.signal?.aborted) { discardControllerFacts(); setRefreshRequired(true); void explain(reason); }
        }).finally(() => { if (active) setParticipantLoading(false); });
        return () => { active = false; };
    // selection owns all auth, allocation, request and page fences.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selection, caps?.shared_validation, caps?.can_manage_trust]);
    const requestMatches = !!descriptor && !!allocation && descriptor.domain === allocation.domain && descriptor.allocation_ref === allocation.allocation_ref;
    useEffect(() => {
        setRecipient(null); setRecipientError(''); setRecipientLoading(false);
        if (!descriptor || !allocation || !requestMatches || !canManage || !caps?.shared_validation || !caps.can_manage_trust) return;
        const fence = scope(); let active = true; setRecipientLoading(true);
        void getRecipient(allocation, descriptor.consumer_project_uuid, fence).then((person) => { fence.beforeSend(); if (active) setRecipient(person); }).catch((reason) => {
            if (active && !fence.signal?.aborted) setRecipientError(reason instanceof SharedValidationError ? reason.message : new SharedValidationError('unavailable').message);
        }).finally(() => { if (active) setRecipientLoading(false); });
        return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selection, caps?.shared_validation, caps?.can_manage_trust]);
    const exportRequest = async (action: 'download' | 'copy' | 'share') => {
        const request = plan.data?.connection_request;
        if (!request || flight.current || !canManage || plan.error || plan.loading) return;
        const fence = scope(); setPending(true); setError('');
        try {
            fence.beforeSend(); const contents = serializeConnectionRequest(request);
            if (action === 'copy') { await navigator.clipboard.writeText(contents); fence.beforeSend(); toast.success('Public connection request copied'); }
            else {
                const file = new File([contents], 'shared-validation-request.json', { type: 'application/json' });
                if (action === 'share') {
                    if (!navigator.canShare?.({ files: [file] }) || !navigator.share) throw new Error();
                    await navigator.share({ files: [file] }); fence.beforeSend();
                } else {
                    const url = URL.createObjectURL(file); downloadUrls.current.add(url);
                    const link = document.createElement('a'); link.href = url; link.download = file.name;
                    document.body.append(link); link.click(); link.remove();
                    setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current.delete(url); }, 0);
                }
            }
        } catch (reason) {
            if (!fence.signal?.aborted && !(reason instanceof DOMException && reason.name === 'AbortError')) setError('This handoff was unavailable. Use Download request to save the same public request file.');
        } finally { setPending(false); }
    };
    const controllerAction = async (participant?: Participant) => {
        if (flight.current || refreshRequired || !canManage || !caps?.shared_validation || !caps.can_manage_trust || !allocation?.can_manage_trust || !participants || participantLoading) return;
        const selected = allocation, request = descriptor, person = recipient;
        if (!participant && (!requestMatches || !request || !person?.active || person.consumer_project_uuid !== request.consumer_project_uuid || recipientLoading)) return;
        const existing = participants.items.find((p) => p.client_ref === request?.client_ref && p.consumer_project_uuid === request?.consumer_project_uuid);
        if (!participant && existing?.trust_state === 'revoked') { setError('This reference was revoked. Ask the project to prepare a fresh request.'); return; }
        if (participant && (participant.role !== 'trusted' || participant.allocation_ref !== selected.allocation_ref || !participants.items.includes(participant))) return;
        const fence = scope(), trigger = document.activeElement as HTMLElement | null; setPending(true); setError(''); setNotice(''); let submitted = false;
        try {
            const confirmed = await confirmShared({
                title: participant ? participant.trust_state === 'revoked' ? 'Retry revoked project cleanup' : 'Revoke project trust' : 'Grant certificate issuance authority', danger: !!participant,
                message: <div className="dns-shared-confirm"><p><strong>{participant?.consumer_label ?? person!.label}</strong></p><p>Project: <code>{participant?.consumer_project_uuid ?? person!.consumer_project_uuid}</code></p>{participant && <p>Participant: <code>{participant.participant_ref}</code></p>}<p>Domain: <code>{selected.domain}</code><br />Target: <code>{selected.target}</code><br />Reference: <code>{participant?.client_ref ?? request!.client_ref}</code></p><p>{participant?.trust_state === 'revoked' ? 'Retry DNS cleanup for this already-revoked reference. It remains revoked; this never restores issuance authority. Other trusted projects keep working.' : participant ? 'Stop future DNS-01 validation for this project. Certificates already issued remain valid until expiry or separate revocation. Other trusted projects keep working.' : `Allow this project to issue certificates for ${selected.domain} and *.${selected.domain} using this validation target. Each deployment keeps its own certificate and private key.`}</p></div>,
                confirmText: participant ? participant.trust_state === 'revoked' ? 'Retry cleanup' : 'Revoke trust' : 'Allow issuance', signal: fence.signal,
            });
            if (!confirmed) return;
            fence.beforeSend(); if (!liveCaps.current?.can_manage_trust) throw new SharedValidationError('access');
            submitted = true;
            if (participant) await revokeValidation(selected, participant.participant_ref, fence); else await grantValidation(selected, request!, fence);
            fence.beforeSend(); setNotice(participant ? 'Trust revoked. Other consumers remain unaffected.' : 'Exact connection authorized. The project can reconnect using its original request.');
        } catch (reason) { if (!fence.signal?.aborted) { await explain(reason); if (participant && submitted) setNotice('Revocation may have persisted; cleanup is unconfirmed. Review refreshed trust before continuing.'); } }
        finally {
            if (submitted) {
                await invalidateValidation(qc);
                if (!fence.signal?.aborted) { try { await refreshController(selected, fence); setRefreshRequired(false); } catch { setRefreshRequired(true); setError('The operation may have persisted. Refresh successfully before another action.'); } }
            }
            setPending(false); restoreFocus(trigger, fence);
        }
    };
    const refresh = async () => {
        if (flight.current) return;
        if (mode === 'project') { const fresh = await plan.refresh(); setRefreshRequired(!fresh); if (fresh) { setError(''); setNotice(''); } }
        else if (allocation) { setPending(true); try { await refreshController(allocation); setRefreshRequired(false); setError(''); } catch (reason) { setRefreshRequired(true); await explain(reason); } finally { setPending(false); } }
        else await loadController();
    };
    const r = plan.data;
    return <div className="modal-pad dns-shared-dialog">
        <h2 className="modal-title">Shared validation setup</h2>
        <p className="dim">Share an existing DNS-01 validation target. Each project issues its own certificate and keeps its own private key.</p>
        <div className="seg" aria-label="Shared validation role"><button className={`seg-btn${mode === 'project' ? ' seg-active' : ''}`} disabled={busy} onClick={() => { resetSelection(); setMode('project'); if (fixedDomain) setInspected({ target: { domain: fixedDomain.id } }); }}>Project setup</button><button className={`seg-btn${mode === 'controller' ? ' seg-active' : ''}`} disabled={busy || !canManage} onClick={() => { resetSelection(); setMode('controller'); }}>Controller review</button></div>
        {error && <div className="dns-errors" role="alert">{error}</div>}{notice && <div className="dns-provider-note" role="status">{notice}</div>}
        {!canManage && <p className="dns-blocked">The current session can inspect available facts but cannot perform shared setup.</p>}
        {mode === 'project' ? <>
            {fixedDomain ? <FlatRow label="Domain"><code>{fixedDomain.name}</code></FlatRow> : <>
                <label className="field"><span className="field-label">Target type</span><select className="input" disabled={busy} value={targetKind} onChange={(e) => { resetSelection(); setTargetKind(e.target.value as 'existing' | 'new'); }}><option value="existing">Existing local domain</option><option value="new">Eligible group and exact name</option></select></label>
                {targetKind === 'existing' ? <CollectionSelect<DomainRow> model={DomainModel} sanitizeRow={sanitizeDomainRow} value={domain ? { ...domain } : null} label="Local domain" disabled={busy} onChange={(_id, row) => { resetSelection(); setDomain(row ? sanitizeDomainRow(row) : null); }} maxItems={25} /> : <><CollectionSelect<DnsGroupChoice> endpoint={SETUP_GROUP_ENDPOINT} sanitizeRow={sanitizeSetupGroup} value={group} label="Eligible group" maxItems={25} disabled={busy || !canManage} onChange={(_id, row) => { resetSelection(); setGroup(row ? sanitizeSetupGroup(row) : null); }} /><label className="field"><span className="field-label">Exact domain name</span><input ref={nameRef} className="input" maxLength={253} disabled={busy} placeholder="customer.example" onChange={() => setInspected(null)} /></label></>}
            </>}
            <label className="field"><span className="field-label">Existing validation target (optional for inspection)</span><input ref={allocationRef} className="input" maxLength={253} disabled={busy} placeholder="existing-target.acme-hub.example" onChange={() => setInspected(null)} /><span className="field-help">Only the public target hostname supplied by its controller. Knowing it does not grant issuance authority.</span></label>
            <div className="dns-shared-actions"><button className="btn" disabled={busy} onClick={inspect}>Inspect plan</button><button className="btn" disabled={busy || plan.loading || !inspected} onClick={() => void refresh()}>Refresh</button></div>
            {plan.loading && inspected && <p className="dim">Checking validation…</p>}{plan.error && <div className="dns-errors" role="alert">{plan.error.message}{r && ' Displaying the last successful check.'}</div>}
            {r && <><ValidationFacts readiness={r} />{r.connection_request && canManage && <div className="dns-shared-request"><strong>Public connection request</strong><RequestFacts request={r.connection_request} /><p>Send this file to the allocation controller. They open their deployment’s Domains → Shared validation setup → Controller review and import it.</p><div className="dns-shared-actions"><button className="btn" disabled={busy || !!plan.error || plan.loading} onClick={() => void exportRequest('download')}>Download request</button>{typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && <button className="btn" disabled={busy || !!plan.error || plan.loading} onClick={() => void exportRequest('share')}>Share request</button>}<button className="btn" disabled={busy || !!plan.error || plan.loading} onClick={() => void exportRequest('copy')}>Copy request</button></div></div>}
                {canManage && <div className="dns-shared-actions">
                    {r.capabilities.can_connect && r.next_action.code !== 'grant_trust' && <button className="btn btn-primary" disabled={busy || !!plan.error || plan.loading || refreshRequired} onClick={() => void localAction('connect')}>{r.connection ? 'Connect approved validation' : 'Prepare connection'}</button>}
                    {r.capabilities.can_restart && r.trust.state === 'revoked' && <button className="btn btn-primary" disabled={busy || !!plan.error || plan.loading || refreshRequired} onClick={() => void localAction('restart')}>Prepare fresh request</button>}
                    {r.capabilities.can_check && <button className="btn" disabled={busy || !!plan.error || plan.loading || refreshRequired} onClick={() => void localAction('check')}>Check validation</button>}
                    {r.capabilities.can_request && <button className="btn btn-primary" disabled={busy || !!plan.error || plan.loading || refreshRequired} onClick={() => void localAction('request')}>Request wildcard certificate</button>}
                </div>}
            </>}{plan.timedOut && <p className="dns-warning">Automatic checks reached their limit. Refresh for current status.</p>}
        </> : <>
            <p className="dim">Only the existing allocation’s authorized controller can grant issuance authority. Ordinary DNS management is insufficient.</p>
            <button className="btn" disabled={busy || !canManage} onClick={() => void loadController()}>Check controller access</button>
            {caps?.shared_validation && caps.can_manage_trust && <>
                <label className="field"><span className="field-label">Exact domain</span><input className="input" aria-label="Exact domain" value={controllerDomain} maxLength={253} disabled={busy} placeholder="acme.example" onChange={(e) => { clearControllerSelection(); setDescriptor(null); setControllerDomain(e.target.value); }} /><span className="field-help">Find an existing allocation to maintain its projects. A request file is needed only for a new grant.</span></label>
                <div className="dns-shared-actions"><button className="btn" disabled={busy || !controllerDomain.trim()} onClick={() => void findAllocations()}>Find allocations</button><label className="field"><span className="field-label">Import request</span><input type="file" accept=".json,application/json" aria-label="Import request" disabled={busy} onChange={(e) => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void importRequest(file); }} /></label></div>
                {descriptor && <div className="dns-shared-request"><strong>Imported public request</strong><RequestFacts request={descriptor} /><button className="btn" disabled={busy} onClick={() => setDescriptor(null)}>Clear imported request</button><p className="dim">Importing grants no authority. Find and select this exact existing target before reviewing a grant.</p></div>}
                {allocations && <fieldset className="dns-shared-allocations"><legend>Existing allocations</legend>{allocations.items.length === 0 && <p>No accessible allocation for this exact domain.</p>}{allocations.items.map((row) => <label className="dns-shared-allocation" key={row.allocation_ref}><input type="radio" name="shared-allocation" disabled={busy || !row.can_manage_trust} checked={allocation?.allocation_ref === row.allocation_ref} onChange={() => { if (descriptor && (descriptor.domain !== row.domain || descriptor.allocation_ref !== row.allocation_ref)) setDescriptor(null); setAllocation(row); setParticipants(null); setRecipient(null); setParticipantCursor(undefined); setRefreshRequired(false); }} /><span><strong>{row.target}</strong><small>Owner project: {row.owner_project_uuid}</small>{!row.can_manage_trust && <small>Trust management unavailable</small>}</span></label>)}<div className="dns-shared-actions">{allocations.next_cursor && <button className="btn" disabled={busy} onClick={() => void findAllocations(allocations.next_cursor!)}>Next allocation page</button>}<button className="btn" disabled={busy} onClick={() => void findAllocations()}>First allocation page</button></div></fieldset>}
                {allocation && <div className="dns-shared-request"><FlatRow label="Selected domain"><code>{allocation.domain}</code></FlatRow><FlatRow label="Validation source"><code>{allocation.source}</code></FlatRow><FlatRow label="Exact target"><code>{allocation.target}</code></FlatRow><FlatRow label="Issuance scope"><code>{allocation.domain}, *.{allocation.domain}</code></FlatRow></div>}
                {descriptor && allocation && !requestMatches && <p className="dns-warning">The imported request does not match this selected domain and allocation. A grant is unavailable.</p>}
                {recipientLoading && <p className="dim">Checking exact grant recipient…</p>}{recipientError && <div className="dns-errors" role="alert">Grant recipient: {recipientError} Existing project maintenance remains available.</div>}
                {requestMatches && recipient && <div className="dns-shared-request"><FlatRow label="Active recipient">{recipient.label}</FlatRow><FlatRow label="Project UUID"><code>{recipient.consumer_project_uuid}</code></FlatRow><p>Allow this project to issue certificates for {allocation!.domain} and *.{allocation!.domain} using this validation target. Each deployment keeps its own certificate and private key.</p><button className="btn btn-primary" disabled={busy || refreshRequired || !participants || participantLoading || recipientLoading} onClick={() => void controllerAction()}>Review grant</button></div>}
                {participantLoading && allocation && <p className="dim">Loading selected allocation’s projects…</p>}{participantError && <div className="dns-errors" role="alert">{participantError}</div>}
                {allocation && participants && <><h3>Selected allocation’s projects</h3>{participants.items.length === 0 && <p>No projects on this page.</p>}{participants.items.map((p) => <div className="dns-shared-request" key={p.participant_ref}><strong>{p.consumer_label}</strong><code>{p.consumer_project_uuid}</code><span>{p.role} · {p.trust_state}</span><small>Reference: {p.client_ref}</small><small>Participant: {p.participant_ref}</small><small>Scope: {p.scope.join(', ')}</small>{p.revoked_at && <small>Revoked: {p.revoked_at}</small>}{p.role === 'trusted' && <button className="btn" disabled={busy || refreshRequired || participantLoading} onClick={() => void controllerAction(p)}>{p.trust_state === 'revoked' ? 'Review cleanup retry' : 'Review revoke'}</button>}</div>)}<div className="dns-shared-actions">{participants.next_cursor && <button className="btn" disabled={busy || participantLoading} onClick={() => setParticipantCursor(participants.next_cursor!)}>Next project page</button>}{participantCursor && <button className="btn" disabled={busy || participantLoading} onClick={() => setParticipantCursor(undefined)}>First project page</button>}</div></>}
                {allocation && <button className="btn" disabled={busy || participantLoading} onClick={() => void refresh()}>Refresh trust</button>}
            </>}
        </>}
        <div className="modal-actions"><button className="btn" disabled={busy} onClick={close}>{busy ? 'Operation pending…' : 'Close'}</button></div>
    </div>;
}

function restoreFocus(trigger: HTMLElement | null, fence: { beforeSend: () => void }) {
    // Native dialog restoration happens while this single-flight trigger is still
    // disabled. Restore after React enables it, only if the same scope survives.
    setTimeout(() => { try { fence.beforeSend(); if (trigger?.isConnected) trigger.focus(); } catch { /* Scope no longer owns this focus. */ } }, 0);
}

function RequestFacts({ request }: { request: ConnectionRequest }) {
    return <dl>{[['Request version', request.version], ['Project UUID', request.consumer_project_uuid], ['Client reference', request.client_ref], ['Domain', request.domain], ['Validation target', request.allocation_ref], ['Issuance scope', `${request.domain}, *.${request.domain}`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd><code>{value}</code></dd></div>)}</dl>;
}
