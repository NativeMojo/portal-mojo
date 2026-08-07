import { useEffect, useRef, useState } from 'react';
import { useMe } from '../../client';
import { Badge, CollectionSelect, modal } from '../../ui';
import { DNS_GROUP_CHOICE_ENDPOINT, clearRegistrantContact, fetchRegistrantContact, saveRegistrantContact } from './api';
import type { DnsGroupChoice, RegistrantContact, RegistrantContactResponse } from './models';
import { CONTACT_STRING_FIELDS, contactDraft, contactPayload, validateContactDraft } from './registrant-data';
import { redactRegistrarError } from './purchase-data';

type Scope = { kind: 'group'; group: DnsGroupChoice } | { kind: 'house' };
const LABELS: Record<(typeof CONTACT_STRING_FIELDS)[number], string> = { FirstName: 'First name', LastName: 'Last name', ContactType: 'Contact type', OrganizationName: 'Organization', AddressLine1: 'Address line 1', AddressLine2: 'Address line 2', City: 'City', State: 'State / province', CountryCode: 'Country code', ZipCode: 'Postal code', PhoneNumber: 'Phone number', Email: 'Email', Fax: 'Fax' };

export function RegistrantContactPage() {
    const { data: me } = useMe(); const [scope, setScope] = useState<Scope | null>(null); const [response, setResponse] = useState<RegistrantContactResponse | null>(null); const [draft, setDraft] = useState<RegistrantContact>({}); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const generation = useRef(0); const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; generation.current += 1; }, []);
    const choose = async (next: Scope | null) => {
        const current = ++generation.current; setScope(next); setResponse(null); setDraft({}); setError('');
        if (!next) return; setLoading(true); const group = next.kind === 'group' ? next.group.id : null;
        try { const value = await fetchRegistrantContact(group); if (mounted.current && generation.current === current) { setResponse(value); setDraft(contactDraft(value)); } }
        catch (reason) { if (mounted.current && generation.current === current) setError(redactRegistrarError(reason)); }
        finally { if (mounted.current && generation.current === current) setLoading(false); }
    };
    const save = async () => {
        if (!scope || !response || busy) return; const problems = validateContactDraft(draft); if (problems.length) { setError(problems.join('; ')); return; }
        const current = generation.current; const group = scope.kind === 'group' ? scope.group.id : null; setBusy(true); setError('');
        try { const saved = await saveRegistrantContact(contactPayload(draft, response, { group }), group); if (mounted.current && generation.current === current) { setResponse(saved); setDraft(contactDraft(saved)); } }
        catch (reason) { if (mounted.current && generation.current === current) setError(redactRegistrarError(reason)); }
        finally { if (mounted.current && generation.current === current) setBusy(false); }
    };
    const clear = async () => {
        if (!scope || !response || busy || response.source !== 'database') return;
        if (!await modal.confirm({ title: 'Clear this scope’s contact?', message: 'This reveals any inherited or deployment-file contact but never its values.', confirmText: 'Clear contact', danger: true })) return;
        const current = generation.current; const group = scope.kind === 'group' ? scope.group.id : null; setBusy(true); setError('');
        try { const saved = await clearRegistrantContact(group); if (mounted.current && generation.current === current) { setResponse(saved); setDraft(contactDraft(saved)); } }
        catch (reason) { if (mounted.current && generation.current === current) setError(redactRegistrarError(reason)); }
        finally { if (mounted.current && generation.current === current) setBusy(false); }
    };
    return <div className="dns-registrant-page"><div className="panel panel-pad dns-registrant-head"><div><div className="eyebrow">Infrastructure · DNS</div><h1>Registrant Contact</h1><p className="dim">ICANN contact PII is fetched imperatively into this mounted page only. It is cleared on every scope change and never enters Query cache.</p></div><div className="dns-scope-picker"><CollectionSelect<DnsGroupChoice> endpoint={DNS_GROUP_CHOICE_ENDPOINT} value={scope?.kind === 'group' ? scope.group : null} onChange={(_id, row) => void choose(row ? { kind: 'group', group: row } : null)} label="Group scope" placeholder="Search eligible groups…" maxItems={25} defaultParams={{ start: 0 }} />{me?.is_superuser === true && <button className={`btn${scope?.kind === 'house' ? ' btn-primary' : ''}`} disabled={busy} onClick={() => void choose({ kind: 'house' })}><i className="bi bi-house" /> House contact</button>}</div></div>
        {!scope && <div className="panel panel-pad dim">Choose one authorized group{me?.is_superuser === true ? ' or the House scope' : ''}. No contact has been loaded.</div>}
        {loading && <div className="panel panel-pad dim">Loading selected scope…</div>}{error && <div className="form-alert" role="alert">{error}</div>}
        {scope && response && <div className="panel panel-pad dns-contact-card"><div className="dns-contact-status"><h2>{scope.kind === 'house' ? 'House registrant' : scope.group.name}</h2><div className="chip-row"><Badge tone={response.source === 'database' ? 'success' : response.inherited ? 'warning' : 'muted'}>{response.source === 'database' ? 'Direct database contact' : response.inherited ? 'Inherited (values hidden)' : response.source === 'settings_file' ? 'Deployment file' : 'Not configured'}</Badge><Badge tone={response.effective_configured ? 'success' : 'danger'}>{response.effective_configured ? 'Effective contact ready' : 'Purchase blocked'}</Badge></div></div>{response.inherited && <p className="form-alert">A contact is inherited, but its values are intentionally not disclosed. Saving creates this group’s own contact from the blank form.</p>}{response.source === 'settings_file' && <p className="form-alert">The House contact comes from deployment configuration. Saving creates a database override; the file values are shown for editing but opaque extension fields are not copied.</p>}<div className="form-grid">{CONTACT_STRING_FIELDS.map((key) => <div key={key} className={['AddressLine1', 'AddressLine2', 'OrganizationName'].includes(key) ? 'col-12' : 'col-6'}><label className="field"><span className="field-label">{LABELS[key]}</span>{key === 'ContactType' ? <select className="input" value={String(draft[key] ?? '')} disabled={busy} onChange={(event) => setDraft((value) => ({ ...value, [key]: event.target.value }))}><option value="">Select…</option>{['PERSON', 'COMPANY', 'ASSOCIATION', 'PUBLIC_BODY', 'RESELLER'].map((value) => <option key={value}>{value}</option>)}</select> : <input className="input" type={key === 'Email' ? 'email' : 'text'} value={String(draft[key] ?? '')} disabled={busy} onChange={(event) => setDraft((value) => ({ ...value, [key]: event.target.value }))} />}</label></div>)}</div>{response.problems.length > 0 && <div className="form-alert">{response.problems.join('; ')}</div>}<div className="modal-actions">{response.source === 'database' && <button className="btn btn-danger" disabled={busy} onClick={() => void clear()}>Clear this scope</button>}<button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save contact'}</button></div></div>}
    </div>;
}
