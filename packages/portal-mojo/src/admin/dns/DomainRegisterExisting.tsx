import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CollectionSelect, toast } from '../../ui';
import { OperationsHelp } from '../core/OperationsHelp';
import { DNS_GROUP_CHOICE_ENDPOINT, fetchDnsCapabilities, registerExistingDomain } from './api';
import { domainSession, requireDomainManager } from './domain-authority';
import { DnsCredentialModel, DomainModel, type DnsCredentialRow, type DnsGroupChoice } from './models';
import { normalizePurchaseDomain, redactRegistrarError } from './purchase-data';

export function usableRegistrationCredential(row: DnsCredentialRow | null, group: number): row is DnsCredentialRow {
    return !!row && row.provider === 'godaddy' && row.is_active === true && row.verified === true
        && (typeof row.group === 'number' ? row.group : row.group?.id) === group;
}

export function DomainRegisterExisting({ close, back, setBusyGate }: { close: () => void; back: () => void; setBusyGate: (busy: boolean) => void }) {
    const queryClient = useQueryClient();
    const [group, setGroup] = useState<DnsGroupChoice | null>(null);
    const [credential, setCredential] = useState<DnsCredentialRow | null>(null);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [attempted, setAttempted] = useState(false);
    const [error, setError] = useState('');
    const inFlight = useRef(false);
    // Both picker remounting and this ref reject responses/events from old scope.
    const scope = useRef<number | null>(null);
    const session = useRef(domainSession());
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const changeGroup = (selected: DnsGroupChoice | null) => {
        if (inFlight.current || attempted) return;
        scope.current = selected?.id ?? null; setGroup(selected); setCredential(null); setError('');
    };
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (inFlight.current || attempted) return;
        if (!group || !usableRegistrationCredential(credential, group.id) || scope.current !== group.id) { setError('Choose an active, verified GoDaddy credential in the selected group'); return; }
        let domain: string;
        try { domain = normalizePurchaseDomain(name); } catch (reason) { setError(redactRegistrarError(reason)); return; }
        inFlight.current = true; setBusy(true); setBusyGate(true); setError('');
        // An unknown outcome is terminal for this mounted form: inspect inventory.
        try {
            await requireDomainManager(session.current);
            if (!mounted.current) return;
            setAttempted(true);
            const saved = await registerExistingDomain({ group: group.id, domain, credential: credential.id }, () => { if (!mounted.current || domainSession() !== session.current || scope.current !== group.id) throw new Error('Session or group changed. Reopen this task.'); });
            if (!mounted.current || domainSession() !== session.current) return;
            await DomainModel.invalidate(queryClient); toast.success(`${saved.name} registered`); close();
        } catch (reason) {
            await DomainModel.invalidate(queryClient);
            setError(`${redactRegistrarError(reason)} Refresh the domain inventory and review the provider account before starting another registration.`);
        } finally { inFlight.current = false; setBusy(false); setBusyGate(false); }
    };
    const groupId = group?.id;
    return <form className="modal-pad domain-onboarding" onSubmit={(event) => void submit(event)} noValidate>
        <h2 className="modal-title">Connect GoDaddy domain</h2>
        <p className="dim">Connect a GoDaddy domain you already own. <OperationsHelp label="domain registration">The provider checks ownership of this exact name without charging or listing the provider account. Choose an authorized group and an active, verified GoDaddy credential belonging to it. If no credentials appear, link and verify one in Provider Credentials.</OperationsHelp></p>
        {error && <div className="form-alert" role="alert">{error}</div>}
        <div className="dns-registrar-grid">
            <CollectionSelect<DnsGroupChoice> endpoint={DNS_GROUP_CHOICE_ENDPOINT} value={group} onChange={(_id, row) => changeGroup(row ?? null)} label="Authorized group" help="Choose the group that owns this domain." required maxItems={25} defaultParams={{ start: 0 }} disabled={busy || attempted} placeholder="Search eligible groups…" />
            <label className="field"><span className="field-label">Domain name <em>*</em></span><input className="input" value={name} disabled={busy || attempted} onChange={(event) => setName(event.target.value)} placeholder="example.com" /></label>
            {groupId ? <CollectionSelect<DnsCredentialRow> key={groupId} model={DnsCredentialModel} value={credential ? { ...credential } : null} label="GoDaddy credential" required maxItems={25} defaultParams={{ group: groupId, provider: 'godaddy', is_active: true, verified: true, start: 0 }} disabled={busy || attempted} placeholder="Search verified GoDaddy credentials…" help="An active, verified credential in the selected group." onChange={(_id, row) => {
                if (scope.current !== groupId || inFlight.current || attempted) return;
                if (!row) { setCredential(null); return; }
                if (!usableRegistrationCredential(row, groupId)) { setCredential(null); setError('That credential is not usable in the selected group'); return; }
                setCredential(row); setError('');
            }} /> : <p className="dim">Choose an authorized group before selecting its GoDaddy credential.</p>}
            {group && <button className="btn domains-inline-action" type="button" disabled={busy || attempted} onClick={() => void (async () => {
                if (inFlight.current) return;
                inFlight.current = true; setBusy(true); setBusyGate(true);
                const selected = group.id;
                try { const caps = await fetchDnsCapabilities(selected); const { showCredentialEditor } = await import('./ProviderCredentialsPage'); if (!mounted.current || scope.current !== selected || domainSession() !== session.current) return; const linked = await showCredentialEditor({ ...caps, providers: caps.providers.filter(provider => provider.name === 'godaddy') }, undefined, group); if (mounted.current && scope.current === selected && domainSession() === session.current && linked && usableRegistrationCredential(linked, selected)) setCredential(linked); }
                catch (reason) { if (scope.current === selected) setError(redactRegistrarError(reason)); }
                finally { inFlight.current = false; if (mounted.current) setBusy(false); setBusyGate(false); }
            })()}><i className="bi bi-key" /> Link credential</button>}
        </div>
        <div className="modal-actions"><button className="btn" type="button" disabled={busy} onClick={attempted ? close : back}>{attempted ? 'Close and review inventory' : 'Back'}</button><button className="btn btn-primary" type="submit" disabled={busy || attempted || !group || !credential || !name.trim()}>{busy ? 'Checking ownership…' : 'Connect domain'}</button></div>
    </form>;
}
