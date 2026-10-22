import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { hasPermission, useMe } from '../../client/runtime';
import { fetchDomainOverview, saveDomainRegistrarSettings } from './registrar-api';
import { DNS_MANAGE_PERMISSIONS, DomainModel, type DomainRow } from './models';
import { modal } from '../../ui';
import { redactRegistrarError } from './purchase-data';

export function DomainRegistrarSettings({ domain, onBusyChange, close }: { domain: DomainRow; onBusyChange?: (busy: boolean) => void; close?: () => void }) {
    const { data: me } = useMe(); const queryClient = useQueryClient();
    const [autoRenew, setAutoRenew] = useState(domain.auto_renew === true);
    const [privacy, setPrivacy] = useState(domain.privacy === true);
    const [live, setLive] = useState(domain);
    const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState(false);
    const [uncertain, setUncertain] = useState(false); const inFlight = useRef(false);
    if (domain.provider !== 'route53' || !hasPermission(me ?? null, DNS_MANAGE_PERMISSIONS, null)) return null;
    const changed = autoRenew !== (live.auto_renew === true) || privacy !== (live.privacy === true);
    const submit = async (event: React.FormEvent) => {
        event.preventDefault(); if (inFlight.current || uncertain || !changed) return;
        const changes: Partial<Pick<DomainRow, 'auto_renew' | 'privacy'>> = {};
        if (autoRenew !== (live.auto_renew === true)) changes.auto_renew = autoRenew;
        if (privacy !== (live.privacy === true)) changes.privacy = privacy;
        inFlight.current = true; onBusyChange?.(true); setBusy(true); setError(''); setSaved(false);
        let failed = false;
        try { await saveDomainRegistrarSettings(domain.id, changes); }
        catch (reason) { failed = true; setUncertain(true); setError(`${redactRegistrarError(reason)} The registrar outcome is uncertain. Inspect the registrar before another change.`); }
        finally {
            try {
                const fresh = await fetchDomainOverview(domain.id);
                queryClient.setQueryData(DomainModel.keys.one(domain.id), fresh);
                setLive(fresh); setAutoRenew(fresh.auto_renew === true); setPrivacy(fresh.privacy === true);
                if (!failed) setSaved(true);
            } catch { setUncertain(true); setError('The authoritative domain could not be refreshed. Inspect the registrar and reopen this domain before making another change.'); }
            await DomainModel.invalidate(queryClient);
            inFlight.current = false; onBusyChange?.(false); setBusy(false);
        }
    };
    return <form className="modal-pad domains-registrar-settings" onSubmit={(event) => void submit(event)}>
        <h2 className="modal-title">Registrar settings</h2><p className="dim">Route 53 only. A database save does not prove that the registrar applied the change.</p>
        {error && <div className="form-alert" role="alert">{error}</div>}
        {live.last_error && <div className="form-alert" role="status"><b>Registrar warning</b><p>{redactRegistrarError(live.last_error)}</p><p>This may be historical. Inspect the registrar before assuming the setting was applied.</p></div>}
        {saved && <p role="status">Domain refreshed after save. Check the registrar for application of these settings.</p>}
        <label className="field"><span><input type="checkbox" checked={autoRenew} disabled={busy || uncertain} onChange={(event) => setAutoRenew(event.target.checked)} /> Auto-renew</span></label>
        <label className="field"><span><input type="checkbox" checked={privacy} disabled={busy || uncertain} onChange={(event) => setPrivacy(event.target.checked)} /> WHOIS privacy</span></label>
        <div className="modal-actions">{close && <button className="btn" type="button" disabled={busy} onClick={close}>Close</button>}<button className="btn btn-primary" type="submit" disabled={busy || uncertain || !changed}>{busy ? 'Saving and refreshing…' : 'Save registrar settings'}</button></div>
    </form>;
}

export function showDomainRegistrarSettings(domain: DomainRow): Promise<unknown> {
    let busy = false;
    return modal.open((close) => <DomainRegistrarSettings domain={domain} close={() => close(null)} onBusyChange={(value) => { busy = value; }} />, { size: 'md', canDismiss: () => !busy });
}
