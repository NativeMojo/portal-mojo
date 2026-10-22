import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { hasPermission, useMe } from '../../client/runtime';
import { toast } from '../../ui';
import { adoptHouseDomain } from './api';
import { DNS_MANAGE_PERMISSIONS, DomainModel } from './models';
import { normalizePurchaseDomain, redactRegistrarError } from './purchase-data';
import { DomainPurchaseWizard } from './DomainPurchaseWizard';
import { DomainRegisterExisting } from './DomainRegisterExisting';

export type OnboardingMode = 'menu' | 'register' | 'purchase' | 'adopt';

export function DomainOnboardingDialog({ close, setBusyGate, initialMode = 'menu' }: { close: () => void; setBusyGate: (busy: boolean) => void; initialMode?: OnboardingMode }) {
    const { data: me } = useMe(); const queryClient = useQueryClient();
    const [mode, setMode] = useState<OnboardingMode>(initialMode);
    const [name, setName] = useState(''); const [review, setReview] = useState<string | null>(null);
    const [busy, setBusy] = useState(false); const [attempted, setAttempted] = useState(false); const [error, setError] = useState('');
    const inFlight = useRef(false);
    const canManage = hasPermission(me ?? null, DNS_MANAGE_PERMISSIONS, null);
    const prepareAdoption = () => {
        if (inFlight.current || attempted || me?.is_superuser !== true) return;
        try { setReview(normalizePurchaseDomain(name)); setError(''); setBusyGate(true); }
        catch (reason) { setError(redactRegistrarError(reason)); }
    };
    const cancelReview = () => { if (inFlight.current) return; setReview(null); setBusyGate(false); };
    const adopt = async () => {
        if (inFlight.current || attempted || !review || me?.is_superuser !== true || !canManage) return;
        inFlight.current = true; setBusy(true); setBusyGate(true); setAttempted(true); setError('');
        try { const domain = await adoptHouseDomain({ domain: review }); await DomainModel.invalidate(queryClient); toast.success(`${domain.name} adopted at Platform scope`); close(); }
        catch (reason) { await DomainModel.invalidate(queryClient); setError(`${redactRegistrarError(reason)} Review the domain inventory before another adoption.`); }
        finally { inFlight.current = false; setBusy(false); setReview(null); setBusyGate(false); }
    };
    if (!me) return <div className="modal-pad dim">Checking DNS authority…</div>;
    if (!canManage) return <div className="modal-pad"><h2 className="modal-title">DNS management required</h2><p className="dim">A global DNS management permission is required.</p><button className="btn" onClick={close}>Close</button></div>;
    if (mode === 'purchase') return <div className="modal-pad"><h2 className="modal-title">Buy domain</h2><DomainPurchaseWizard onDone={close} onBusyChange={setBusyGate} /></div>;
    if (mode === 'register') return <DomainRegisterExisting close={close} back={() => setMode('menu')} setBusyGate={setBusyGate} />;
    if (mode === 'adopt') {
        if (me.is_superuser !== true) return <div className="modal-pad"><h2 className="modal-title">Platform superuser required</h2><button className="btn" onClick={close}>Close</button></div>;
        return <div className="modal-pad"><h2 className="modal-title">Adopt a House domain</h2><p className="dim">Adopt one existing public hosted zone at Platform scope. No account discovery, new zone, or tenant assignment.</p>{error && <div className="form-alert" role="alert">{error}</div>}
            {review ? <div className="dns-quote-card"><h3>Review exact adoption</h3><div><span>Domain</span><code>{review}</code></div><div><span>Scope</span><b>Platform</b></div><div className="modal-actions"><button className="btn" disabled={busy} onClick={cancelReview}>Cancel review</button><button className="btn btn-primary" disabled={busy} onClick={() => void adopt()}>{busy ? 'Adopting…' : 'Confirm adoption'}</button></div></div> : <><label className="field"><span className="field-label">Existing House domain</span><input className="input" value={name} disabled={busy || attempted} onChange={(event) => setName(event.target.value)} /></label><div className="modal-actions"><button className="btn" disabled={busy} onClick={attempted ? close : () => setMode('menu')}>{attempted ? 'Close and review inventory' : 'Back'}</button><button className="btn btn-primary" disabled={busy || attempted || !name.trim()} onClick={prepareAdoption}>Review adoption</button></div></>}
        </div>;
    }
    return <div className="modal-pad"><h2 className="modal-title">Add a domain</h2><p className="dim">Choose one explicit workflow.</p><div className="dns-onboarding-options"><button className="panel panel-pad" onClick={() => setMode('register')}><i className="bi bi-globe2" /><b>Register existing</b><span>Prove ownership of one GoDaddy domain using a verified group credential.</span></button>{me.is_superuser === true && <button className="panel panel-pad" onClick={() => setMode('adopt')}><i className="bi bi-house-add" /><b>Adopt a House domain</b><span>Type an existing public zone name; keep it at Platform scope.</span></button>}<button className="panel panel-pad" onClick={() => setMode('purchase')}><i className="bi bi-cart-check" /><b>Buy domain</b><span>Search, quote, confirm once, and reconcile against the durable ledger.</span></button></div><div className="modal-actions"><button className="btn" onClick={close}>Cancel</button></div></div>;
}
