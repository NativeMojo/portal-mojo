import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '../../client';
import { modal, toast } from '../../ui';
import { adoptHouseDomain } from './api';
import { DomainModel } from './models';
import { normalizePurchaseDomain, redactRegistrarError } from './purchase-data';
import { DomainPurchaseWizard } from './DomainPurchaseWizard';

function DomainOnboardingDialog({ close, setBusyGate }: { close: () => void; setBusyGate: (busy: boolean) => void }) {
    const { data: me } = useMe(); const queryClient = useQueryClient();
    const [mode, setMode] = useState<'menu' | 'purchase' | 'adopt'>('menu'); const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
    const adopt = async () => {
        if (busy || me?.is_superuser !== true) return; setBusy(true); setBusyGate(true); setError('');
        try { const domain = await adoptHouseDomain({ domain: normalizePurchaseDomain(name) }); await DomainModel.invalidate(queryClient); toast.success(`${domain.name} adopted at House scope`); close(); }
        catch (reason) { setError(redactRegistrarError(reason)); }
        finally { setBusy(false); setBusyGate(false); }
    };
    if (mode === 'purchase') return <div className="modal-pad"><h2 className="modal-title">Purchase a domain</h2><DomainPurchaseWizard onDone={close} onBusyChange={setBusyGate} /></div>;
    if (mode === 'adopt') return <div className="modal-pad"><h2 className="modal-title">Adopt a House domain</h2><p className="dim">Manual, exact-name adoption only. This does not enumerate the House account and creates no tenant assignment.</p>{error && <div className="form-alert">{error}</div>}<label className="field"><span className="field-label">Existing House domain</span><input className="input" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label><div className="modal-actions"><button className="btn" disabled={busy} onClick={() => setMode('menu')}>Back</button><button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void adopt()}>{busy ? 'Adopting…' : 'Adopt exact name'}</button></div></div>;
    return <div className="modal-pad"><h2 className="modal-title">Add a domain</h2><p className="dim">Choose one explicit workflow.</p><div className="dns-onboarding-options"><button className="panel panel-pad" onClick={() => setMode('purchase')}><i className="bi bi-cart-check" /><b>Purchase a new domain</b><span>Search, quote, confirm once, and reconcile against the durable ledger.</span></button>{me?.is_superuser === true && <button className="panel panel-pad" onClick={() => setMode('adopt')}><i className="bi bi-house-add" /><b>Adopt a House domain</b><span>Type an existing name manually; no account discovery.</span></button>}</div><div className="modal-actions"><button className="btn" onClick={close}>Cancel</button></div></div>;
}

export function showDomainOnboarding(): Promise<unknown> {
    let busy = false;
    return modal.open((close) => <DomainOnboardingDialog close={() => close(null)} setBusyGate={(value) => { busy = value; }} />, { size: 'lg', canDismiss: () => !busy });
}
