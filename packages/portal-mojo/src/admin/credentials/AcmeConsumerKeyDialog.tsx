import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { requestFreshAuth } from '../../client/runtime';
import { CollectionSelect, FlatRow, modal } from '../../ui';
import { SecretBox } from './secret-dialog';
import { OperatorError, usePrivateOperator, projectIdentity } from '../fleet-configuration/shared-validation-data';
import { issueAcmeKey, projectKeyGroup, readAcmeRecipient, readKeyGroup, readRecipientKeyInventory, revealRecipientKey, type AcmeRecipient, type KeyGroup, type KeySummary } from './acme-consumer-key';
import { GroupApiKeyModel, type CredentialGroup } from './models';


export function AcmeConsumerKeyButton({ group }: { group?: CredentialGroup }) {
    const owner = usePrivateOperator();
    return owner.allowed ? <button className="btn btn-compact" onClick={() => void openAcmeConsumerKey(group)}>Create ACME consumer key</button> : null;
}

export function openAcmeConsumerKey(group?: CredentialGroup) {
    let pending = false;
    return modal.open((close) => <AcmeConsumerKeyDialog group={group} close={() => close(null)} onBusy={(busy) => { pending = busy; }} />, { size: 'lg', canDismiss: () => !pending });
}
export function AcmeConsumerKeyDialog({ group: fixedGroup, close, onBusy }: { group?: CredentialGroup; close: () => void; onBusy?: (busy: boolean) => void }) {
    const owner = usePrivateOperator(), qc = useQueryClient();
    const [group, setGroup] = useState<KeyGroup | null>(null), [recipient, setRecipient] = useState<AcmeRecipient | null>(null);
    const [inventory, setInventory] = useState<KeySummary[] | null>(null), [blocked, setBlocked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const name = useRef<HTMLInputElement>(null), flight = useRef(false), generation = useRef(0), recipientOwner = useRef('');
    const selected = useRef(group?.id); selected.current = group?.id;
    const opener = useRef<HTMLElement | null>(null);
    const pending = (value: boolean) => {
        if (value) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        flight.current = value; setBusy(value); onBusy?.(value);
        if (!value) { const fence = owner.fence(), target = opener.current; requestAnimationFrame(() => { try { fence.beforeSend(); if (target?.isConnected) target.focus(); } catch { /* Former owner cannot regain focus. */ } }); }
    };
    useEffect(() => () => { generation.current++; onBusy?.(false); }, []);
    useEffect(() => { setRecipient(null); setInventory(null); setBlocked(true); if (name.current) name.current.value = ''; }, [owner.key]);
    const failure = async (reason: unknown) => { const safe = reason instanceof OperatorError ? reason : new OperatorError('unavailable'); setError(safe.message); setBlocked(true); if (safe.kind === 'fresh') await requestFreshAuth(); };
    useEffect(() => {
        if (!fixedGroup || !owner.allowed) return;
        const fence = owner.fence(); void readKeyGroup(fixedGroup.id, fence).then((g) => { fence.beforeSend(); setGroup(g); }).catch((e) => { if (!fence.signal?.aborted) void failure(e); });
    }, [fixedGroup?.id, owner.key]);
    useEffect(() => { setRecipient(null); setInventory(null); setError(''); setBlocked(false); generation.current++; }, [group?.id]);
    const refresh = async () => {
        if (flight.current || !group || !owner.allowed) return;
        const fence = owner.fence(), id = group.id, run = ++generation.current; pending(true); setError(''); setRecipient(null);
        try {
            const current = await readKeyGroup(id, fence); fence.beforeSend();
            if (selected.current !== id || generation.current !== run) return;
            if (!current.uuid) throw new OperatorError('invalid'); projectIdentity(current.uuid);
            const [person, keys] = await Promise.all([readAcmeRecipient(current.uuid, fence), readRecipientKeyInventory(id, fence)]); fence.beforeSend();
            if (selected.current !== id || generation.current !== run) return;
            recipientOwner.current = owner.key; setGroup(current); setRecipient(person); setInventory(keys); setBlocked(false);
        } catch (e) { if (!fence.signal?.aborted && generation.current === run) await failure(e); }
        finally { if (!fence.signal?.aborted) pending(false); }
    };
    const displaySecret = async (value: string, title: string) => {
        const fence = owner.fence(); let secret: string | null = value;
        try { fence.beforeSend(); await modal.open((done) => <div className="modal-pad"><h2 className="modal-title">{title}</h2><p>This transient display is not stored in Portal. A later explicit Token reveal in the key inventory is audited and remains available.</p><SecretBox secret={secret ?? ''} ariaLabel="ACME consumer token" /><p>Enter the replacement normally in the receiving deployment’s protected connection form. Publish, Apply and verify every expected node before explicitly deactivating the old hub key. Issuance alone grants no allocation trust or hub activation.</p><div className="modal-actions"><button className="btn" onClick={() => done(null)}>Close token</button></div></div>, { size: 'lg', signal: fence.signal }); }
        finally { secret = null; value = ''; }
    };
    const issue = async () => {
        if (flight.current || !owner.allowed || recipientOwner.current !== owner.key || !recipient?.can_issue || !group || blocked) return;
        const fence = owner.fence(), person = recipient, id = group.id, keyName = name.current?.value.trim() ?? ''; if (!keyName) { setError('Name this replacement key.'); return; }
        const run = generation.current; pending(true); setError(''); let attempted = false;
        try {
            const confirmed = await modal.open<boolean>((done) => <div className="modal-pad"><h2 className="modal-title">Issue protected ACME consumer key?</h2><div className="modal-message"><p>{person.consumer_label} · <code>{person.consumer_project_uuid}</code></p><p>Key: {keyName}</p><p>Grant this exact original hub project the protected ACME validation consumer purpose. The fixed grant is dnsman_acme_federation, with no linked user or override. This does not grant allocation trust or enable shared validation. The existing key stays active.</p></div><div className="modal-actions"><button className="btn" onClick={() => done(false)}>Cancel</button><button className="btn btn-primary" onClick={() => done(true)}>Issue replacement key</button></div></div>, { size: 'md', signal: fence.signal });
            if (!confirmed) return; fence.beforeSend(); if (selected.current !== id || generation.current !== run) throw new OperatorError('conflict');
            attempted = true; const result = await issueAcmeKey(person, keyName, fence); fence.beforeSend();
            if (selected.current !== id || generation.current !== run) { result.token = ''; return; }
            setNotice(`Key ${result.key.name} issued. The old key was not retired.`);
            try { await displaySecret(result.token, 'ACME consumer key issued'); } finally { result.token = ''; }
        } catch (e) { if (!fence.signal?.aborted) await failure(e); }
        finally {
            if (attempted) { if (name.current) name.current.value = ''; await GroupApiKeyModel.invalidate(qc); if (!fence.signal?.aborted && selected.current === id) { try { const keys = await readRecipientKeyInventory(id, fence); fence.beforeSend(); setInventory(keys); } catch { setBlocked(true); setError('Issuance may have persisted. Refresh the Group key inventory before issuing another key.'); } } }
            if (!fence.signal?.aborted) pending(false);
        }
    };
    const reveal = async (row: KeySummary) => {
        if (flight.current || !owner.allowed || recipientOwner.current !== owner.key) return; const fence = owner.fence(); pending(true);
        try { const value = await revealRecipientKey(row.id, fence); fence.beforeSend(); await displaySecret(value, `Audited token — ${row.name}`); }
        catch (e) { if (!fence.signal?.aborted) await failure(e); } finally { if (!fence.signal?.aborted) pending(false); }
    };
    if (!owner.allowed) return <div className="modal-pad"><h2>Protected key access unavailable</h2><p>A current interactive literal superuser is required.</p><button className="btn" onClick={close}>Close</button></div>;
    return <div className="modal-pad shared-validation-operator" style={{ minWidth: 0, overflowWrap: 'anywhere' }}><h2 className="modal-title">Create ACME consumer key</h2><p>Run this form on the approved hub. Choose its original recipient Group by name; a downstream tenant or acting user is not that identity.</p>
        {fixedGroup ? <FlatRow label="Selected hub Group">{group?.name ?? fixedGroup.name}</FlatRow> : <CollectionSelect<KeyGroup> endpoint="/api/group" sanitizeRow={projectKeyGroup} value={group} label="Original hub recipient Group" disabled={busy} onChange={(_id, row) => setGroup(row ?? null)} />}
        {group && <><FlatRow label="Group UUID"><code>{group.uuid ?? 'No valid UUID reported'}</code></FlatRow><button className="btn" disabled={busy} onClick={() => void refresh()}>Resolve recipient and refresh keys</button></>}
        {error && <p className="form-alert" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
        {recipient && <div className="dns-shared-request"><FlatRow label="Actual active hub project">{recipient.consumer_label}</FlatRow><FlatRow label="Exact UUID"><code>{recipient.consumer_project_uuid}</code></FlatRow><FlatRow label="Purpose">ACME validation consumer</FlatRow><FlatRow label="Fixed protected grant"><code>{recipient.permission}</code></FlatRow><p>{recipient.grant_explanation}</p><p>Issuing a key does not grant allocation trust or activate the hub.</p><label className="field"><span className="field-label">Replacement key name</span><input className="input" ref={name} maxLength={200} disabled={busy || blocked || !recipient.can_issue} placeholder="Project shared validation" /></label><button className="btn btn-primary" disabled={busy || blocked || !recipient.can_issue} onClick={() => void issue()}>Review protected key issuance</button>{!recipient.can_issue && <p>Protected issuance is unavailable for this operator.</p>}</div>}
        <h3>Recent Group key inventory</h3><p>After an uncertain response, Refresh this inventory and use audited reveal before creating another successor. Up to 100 recent keys are shown; generic key management remains in the existing inventory.</p>{inventory?.map((row) => <div className="dns-shared-request" key={row.id}><strong>{row.name} · #{row.id}</strong><p>{row.is_active ? 'Active' : 'Inactive'}</p><button className="btn" disabled={busy} onClick={() => void reveal(row)}>Reveal audited token</button></div>)}
        <p>Replacement → protected connection Preview/Publish → Apply → verify every expected node → explicitly review/deactivate the old hub key. No key is rotated or retired by this form.</p><div className="modal-actions"><button className="btn" disabled={busy} onClick={close}>{busy ? 'Operation pending…' : 'Close'}</button></div></div>;
}
