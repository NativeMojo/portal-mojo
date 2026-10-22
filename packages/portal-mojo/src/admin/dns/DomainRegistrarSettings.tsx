import { useState } from 'react';
import { modal } from '../../ui/modal';
import type { DomainRow } from './models';
import { registrationAuthority, type DomainRegistration } from './registrar-api';
export interface RegistrarChanges { auto_renew?: boolean; privacy?: boolean }
export function DomainRegistrarSettings({ domain, registration, busy = false, locked = false, error, notice, submit, close }: {
    domain: DomainRow; registration?: DomainRegistration; busy?: boolean; locked?: boolean; error?: string; notice?: string;
    submit?: (changes: RegistrarChanges) => void; close?: () => void;
}) {
    const [autoRenew, setAutoRenew] = useState(registration?.auto_renew ?? null), [privacy, setPrivacy] = useState('');
    if (!registration || registrationAuthority(registration.registrar) !== 'route53') return <p>Read live registration before changing registrar settings.</p>;
    const changed = autoRenew !== registration.auto_renew || privacy !== '';
    return <form className="modal-pad domains-registrar-settings" onSubmit={event => { event.preventDefault(); if (!busy && !locked && changed) submit?.({ ...(autoRenew !== null && autoRenew !== registration.auto_renew ? { auto_renew: autoRenew } : {}), ...(privacy !== '' ? { privacy: privacy === 'true' } : {}) }); }}>
        <h2 className="modal-title">Registration settings</h2><p className="dim">{domain.name}</p>
        <div className="form-grid"><label className="field col-12"><span className="field-label">Auto-renew</span><select className="input" value={autoRenew === null ? '' : String(autoRenew)} disabled={busy || locked || registration.auto_renew === null} onChange={event => setAutoRenew(event.target.value === 'true')}><option value="" disabled>Not reported</option><option value="true">On</option><option value="false">Off</option></select></label>
        <label className="field col-12"><span className="field-label">WHOIS privacy · all contacts</span><select className="input" value={privacy} disabled={busy || locked} onChange={event => setPrivacy(event.target.value)}><option value="">Keep current privacy</option><option value="true" disabled={registration.privacy_supported !== true}>Enable for all contacts</option><option value="false">Disable for all contacts</option></select></label></div>
        {registration.privacy_supported !== true && <p className="dim">This registry has not confirmed support for enabling privacy.</p>}
        {error && <p role="alert" className="text-bad">{error}</p>}{notice && <p role="status">{notice}</p>}
        {(error || notice) && <a className="btn" href="https://console.aws.amazon.com/route53/domains/home" target="_blank" rel="noopener noreferrer">Open Route 53 registered domains</a>}
        <div className="modal-actions">{close && <button type="button" className="btn" disabled={busy} onClick={close}>Close</button>}<button type="submit" className="btn btn-primary" disabled={busy || locked || !changed}>Save registration settings</button></div>
    </form>;
}
/** Compatibility entry point now requires the same explicit live inspection. */
export async function showDomainRegistrarSettings(domain: DomainRow): Promise<unknown> {
    const { DomainRegistrationPanel } = await import('./DomainRegistrationPanel');
    let busy = false;
    function Dialog({ close }: { close: () => void }) {
        const [pending, setPending] = useState(false);
        return <div className="modal-pad"><h2 className="modal-title">Registration · {domain.name}</h2><DomainRegistrationPanel domain={domain} onBusyChange={value => { busy = value; setPending(value); }}/><div className="modal-actions"><button className="btn" disabled={pending} onClick={() => { if (!busy) close(); }}>Close</button></div></div>;
    }
    return modal.open(close => <Dialog close={() => close(null)}/>, { size: 'md', canDismiss: () => !busy });
}
