import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAuthSessionRevision, getAuthSnapshot, hasPermission, requestFreshAuth, subscribeAuth, useAuthSnapshot, useMe } from '../../client/runtime';
import { CollectionSelect, FlatRow, modal, toast } from '../../ui';
import { DNS_MANAGE_PERMISSIONS, DomainModel, sanitizeDomainRow, type DnsGroupChoice, type DomainRow } from './models';
import { checkValidation, connectValidation, getAllocations, getHubCapabilities, getParticipants, getRecipient, grantValidation, invalidateValidation, requestWildcard, revokeValidation, sanitizeSetupGroup, SETUP_GROUP_ENDPOINT, useValidationPlan } from './shared-validation-api';
import { normalizeHostname, parseConnectionRequest, SharedValidationError, type Allocation, type ConnectionRequest, type HubCapabilities, type Page, type Participant, type Recipient, type SetupTarget } from './shared-validation-data';
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
    const nameRef = useRef<HTMLInputElement>(null), allocationRef = useRef<HTMLInputElement>(null), descriptorRef = useRef<HTMLTextAreaElement>(null);
    const [inspected, setInspected] = useState<{ target: SetupTarget; allocation?: string } | null>(fixedDomain ? { target: { domain: fixedDomain.id } } : null);
    const plan = useValidationPlan(mode === 'project' ? inspected?.target ?? null : null, inspected?.allocation);
    const controllerIdentity = JSON.stringify([auth.uid, revision, canManage]);
    const [controllerAuthority, setControllerAuthority] = useState<{ identity: string; caps: HubCapabilities } | null>(null);
    // A replacement session never borrows the previous session's controller proof,
    // including the render before the cleanup effect clears its selected facts.
    const caps = controllerAuthority?.identity === controllerIdentity ? controllerAuthority.caps : null;
    const setCaps = (value: HubCapabilities | null) => setControllerAuthority(value ? { identity: controllerIdentity, caps: value } : null);
    const [descriptor, setDescriptor] = useState<ConnectionRequest | null>(null);
    const [allocations, setAllocations] = useState<Page<Allocation> | null>(null);
    const [allocation, setAllocation] = useState<Allocation | null>(null);
    const [recipient, setRecipient] = useState<Recipient | null>(null);
    const [participants, setParticipants] = useState<Page<Participant> | null>(null);
    const [error, setError] = useState(''); const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false); const flight = useRef(false);
    const [refreshRequired, setRefreshRequired] = useState(false);
    const selection = JSON.stringify([fixedDomain?.id, fixedDomain?.name, fixedDomain?.group, mode, targetKind, domain?.id, group?.id, inspected, descriptor, allocation?.allocation_ref, auth.uid, revision, canManage]);
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
        if (descriptorRef.current) descriptorRef.current.value = '';
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
    const resetSelection = () => { setInspected(null); setDescriptor(null); setAllocations(null); setAllocation(null); setRecipient(null); setParticipants(null); setError(''); setNotice(''); setRefreshRequired(false); };
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
        const fence = scope(); setPending(true); setError(''); setNotice('');
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
            setPending(false);
        }
    };
    const refreshController = async (selected: Allocation, fence = scope()) => {
        const [nextCaps, rows] = await Promise.all([getHubCapabilities(fence), getParticipants(selected, undefined, fence)]);
        fence.beforeSend();
        if (!nextCaps.shared_validation || !nextCaps.can_manage_trust) throw new SharedValidationError('access');
        setCaps(nextCaps); setParticipants(rows); return rows;
    };
    const loadController = async () => {
        if (flight.current || !canManage) return;
        const fence = scope(); setPending(true); setError('');
        try { const nextCaps = await getHubCapabilities(fence); fence.beforeSend(); setCaps(nextCaps); if (!nextCaps.shared_validation || !nextCaps.can_manage_trust) setError('This session cannot manage shared validation trust. Ask the allocation controller.'); }
        catch (reason) { if (!fence.signal?.aborted) await explain(reason); }
        finally { setPending(false); }
    };
    const reviewDescriptor = async () => {
        if (flight.current || !canManage || !caps?.shared_validation || !caps.can_manage_trust) return;
        let request: ConnectionRequest;
        try { const input = descriptorRef.current?.value ?? ''; if (input.length > 2048) throw new Error(); request = parseConnectionRequest(JSON.parse(input)); }
        catch { setError('Paste only the public five-field connection request exported by the project.'); return; }
        finally { if (descriptorRef.current) descriptorRef.current.value = ''; }
        // Scope changes synchronously clear previous controller facts. Resolve only
        // the pasted exact domain; no directory or allocation creation is used.
        setDescriptor(request); setAllocation(null); setAllocations(null); setParticipants(null); setRecipient(null); setRefreshRequired(false); setError('');
    };
    useEffect(() => {
        if (!descriptor || mode !== 'controller' || !caps?.can_manage_trust || !caps.shared_validation || !canManage) return;
        const fence = scope(); let active = true; setPending(true);
        void (async () => {
            try {
                const page = await getAllocations(descriptor.domain, undefined, fence); fence.beforeSend();
                if (!active) return; setAllocations(page);
                const selected = page.items.find((row) => row.allocation_ref === descriptor.allocation_ref && row.can_manage_trust);
                if (!selected && !page.next_cursor) throw new SharedValidationError('access');
                if (selected) setAllocation(selected);
            } catch (reason) { if (active && !fence.signal?.aborted) void explain(reason); }
            finally { if (active) setPending(false); }
        })();
        return () => { active = false; };
    // descriptor identity and controller eligibility own this resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [descriptor, mode, caps?.can_manage_trust, caps?.shared_validation, canManage]);
    useEffect(() => {
        if (!allocation || !descriptor || !canManage || !caps?.can_manage_trust) return;
        const fence = scope(); let active = true; setPending(true);
        void Promise.all([getRecipient(allocation, descriptor.consumer_project_uuid, fence), getParticipants(allocation, undefined, fence)]).then(([person, rows]) => { fence.beforeSend(); if (active) { setRecipient(person); setParticipants(rows); } }).catch((reason) => { if (active && !fence.signal?.aborted) void explain(reason); }).finally(() => { if (active) setPending(false); });
        return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allocation, descriptor, canManage, caps?.can_manage_trust]);
    const moreAllocations = async () => {
        if (!descriptor || !allocations?.next_cursor || flight.current) return;
        const fence = scope(); setPending(true);
        try { const page = await getAllocations(descriptor.domain, allocations.next_cursor, fence); fence.beforeSend(); setAllocations(page); const selected = page.items.find((row) => row.allocation_ref === descriptor.allocation_ref && row.can_manage_trust); if (selected) setAllocation(selected); else if (!page.next_cursor) setError(new SharedValidationError('access').message); }
        catch (reason) { if (!fence.signal?.aborted) await explain(reason); } finally { setPending(false); }
    };
    const controllerAction = async (participant?: Participant) => {
        if (flight.current || refreshRequired || !canManage || !caps?.shared_validation || !caps.can_manage_trust || !allocation?.can_manage_trust || !recipient || !descriptor || !participants) return;
        const selected = allocation, request = descriptor, person = recipient;
        const existing = participants.items.find((p) => p.client_ref === request.client_ref && p.consumer_project_uuid === request.consumer_project_uuid);
        if (!participant && existing?.trust_state === 'revoked') { setError('This reference was revoked. Ask the project to prepare a fresh request.'); return; }
        if (participant && (participant.role !== 'trusted' || participant.allocation_ref !== selected.allocation_ref)) return;
        const fence = scope(); setPending(true); setError(''); setNotice(''); let submitted = false;
        try {
            const confirmed = await confirmShared({
                title: participant ? 'Revoke project trust' : 'Grant certificate issuance authority', danger: !!participant,
                message: <div className="dns-shared-confirm"><p><strong>{participant?.consumer_label ?? person.label}</strong></p><p>Project: <code>{participant?.consumer_project_uuid ?? person.consumer_project_uuid}</code></p><p>Domain: <code>{selected.domain}</code><br />Target: <code>{selected.target}</code><br />Reference: <code>{participant?.client_ref ?? request.client_ref}</code></p><p>{participant ? 'Stop future DNS-01 validation for this project. Certificates already issued remain valid until expiry or separate revocation. Other trusted projects keep working.' : `Allow this project to issue certificates for ${selected.domain} and *.${selected.domain} using this validation target. Each deployment keeps its own certificate and private key.`}</p></div>,
                confirmText: participant ? 'Revoke trust' : 'Allow issuance', signal: fence.signal,
            });
            if (!confirmed) return;
            fence.beforeSend(); if (!liveCaps.current?.can_manage_trust) throw new SharedValidationError('access');
            submitted = true;
            if (participant) await revokeValidation(selected, participant.participant_ref, fence); else await grantValidation(selected, request, fence);
            fence.beforeSend(); setNotice(participant ? 'Trust revoked. Other consumers remain unaffected.' : 'Exact connection authorized. The project can reconnect using its original request.');
        } catch (reason) { if (!fence.signal?.aborted) { await explain(reason); if (participant && submitted) setNotice('Revocation may have persisted; cleanup is unconfirmed. Review refreshed trust before continuing.'); } }
        finally {
            if (submitted) {
                await invalidateValidation(qc);
                if (!fence.signal?.aborted) { try { await refreshController(selected, fence); setRefreshRequired(false); } catch { setRefreshRequired(true); setError('The operation may have persisted. Refresh successfully before another action.'); } }
            }
            setPending(false);
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
            {r && <><ValidationFacts readiness={r} />{r.connection_request && canManage && <div className="dns-shared-request"><strong>Public connection request</strong><dl>{Object.entries(r.connection_request).map(([key, value]) => <div key={key}><dt>{key}</dt><dd><code>{String(value)}</code></dd></div>)}</dl><button className="btn" disabled={busy || !!plan.error || plan.loading} onClick={() => { const fence = scope(); void (async () => { try { fence.beforeSend(); await navigator.clipboard.writeText(JSON.stringify(r.connection_request)); fence.beforeSend(); toast.success('Public connection request copied'); } catch { setError('Copy was unavailable. Refresh and try again in a supported browser.'); } })(); }}>Copy connection request</button></div>}
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
            {caps?.shared_validation && caps.can_manage_trust && <><label className="field"><span className="field-label">Public connection request</span><textarea className="input" ref={descriptorRef} rows={5} maxLength={2048} disabled={busy} placeholder="Paste the project’s five-field JSON request" /></label><button className="btn" disabled={busy} onClick={() => void reviewDescriptor()}>Review exact request</button>
                {descriptor && <p className="dim">Requested domain: <code>{descriptor.domain}</code> · target <code>{descriptor.allocation_ref}</code></p>}
                {!allocation && allocations?.next_cursor && <button className="btn" disabled={busy} onClick={() => void moreAllocations()}>Find target on next allocation page</button>}
                {allocation && recipient && <div className="dns-shared-request"><FlatRow label="Recipient">{recipient.label}</FlatRow><FlatRow label="Project UUID"><code>{recipient.consumer_project_uuid}</code></FlatRow><FlatRow label="Exact target"><code>{allocation.target}</code></FlatRow><FlatRow label="Issuance scope"><code>{allocation.domain}, *.{allocation.domain}</code></FlatRow><p>Allow this project to issue certificates for {allocation.domain} and *.{allocation.domain} using this validation target. Each deployment keeps its own certificate and private key.</p><button className="btn btn-primary" disabled={busy || refreshRequired || !participants} onClick={() => void controllerAction()}>Review grant</button></div>}
                {allocation && participants && <><h3>Selected allocation’s projects</h3>{participants.items.map((p) => <div className="dns-shared-request" key={p.participant_ref}><strong>{p.consumer_label}</strong><code>{p.consumer_project_uuid}</code><span>{p.role} · {p.trust_state}</span><small>Reference: {p.client_ref}</small>{p.role === 'trusted' && <button className="btn" disabled={busy || refreshRequired} onClick={() => void controllerAction(p)}>{p.trust_state === 'revoked' ? 'Review cleanup retry' : 'Review revoke'}</button>}</div>)}{participants.next_cursor && <button className="btn" disabled={busy} onClick={() => { const fence = scope(); setPending(true); void getParticipants(allocation, participants.next_cursor!, fence).then((page) => { fence.beforeSend(); setParticipants(page); }).catch((reason) => explain(reason)).finally(() => setPending(false)); }}>Next project page</button>}<button className="btn" disabled={busy} onClick={() => void refresh()}>Refresh trust</button></>}
            </>}
        </>}
        <div className="modal-actions"><button className="btn" disabled={busy} onClick={close}>{busy ? 'Operation pending…' : 'Close'}</button></div>
    </div>;
}
