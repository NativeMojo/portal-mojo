import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getAuthSessionRevision, getAuthSnapshot, hasPermission, subscribeAuth, useAuthSnapshot, useMe } from '../../client/runtime';
import { Badge, CollectionSelect, Tabs, modal } from '../../ui';
import { OperationsHelp } from '../core/OperationsHelp';
import { DNS_GROUP_CHOICE_ENDPOINT, clearRegistrantContact, fetchRegistrantContact, saveRegistrantContact } from './api';
import { DNS_MANAGE_PERMISSIONS, type DnsGroupChoice, type RegistrantContact, type RegistrantContactResponse } from './models';
import { CONTACT_STRING_FIELDS, contactDraft, contactPayload, validateContactDraft } from './registrant-data';
import { redactRegistrarError } from './purchase-data';

type Scope = { kind: 'group'; group: DnsGroupChoice } | { kind: 'house' };
const LABELS: Record<(typeof CONTACT_STRING_FIELDS)[number], string> = { FirstName: 'First name', LastName: 'Last name', ContactType: 'Contact type', OrganizationName: 'Organization', AddressLine1: 'Address line 1', AddressLine2: 'Address line 2', City: 'City', State: 'State / province', CountryCode: 'Country code', ZipCode: 'Postal code', PhoneNumber: 'Phone number', Email: 'Email', Fax: 'Fax' };
const REQUIRED = new Set(['FirstName', 'LastName', 'ContactType', 'AddressLine1', 'City', 'CountryCode', 'ZipCode', 'PhoneNumber', 'Email']);
const ADDRESS = new Set(['AddressLine1', 'AddressLine2', 'City', 'State', 'CountryCode', 'ZipCode']);

/** Contact values stay in this mounted form, never in Query or browser storage. */
export function RegistrantContactPage({ initialGroup, lockScope = false, onSaved, onClose, onBusyChange }: { initialGroup?: DnsGroupChoice; lockScope?: boolean; onSaved?: () => void; onClose?: () => void; onBusyChange?: (busy: boolean) => void }) {
    const { data: me } = useMe(); const auth = useAuthSnapshot();
    const revision = useSyncExternalStore(subscribeAuth, getAuthSessionRevision, getAuthSessionRevision);
    const canManage = auth.authenticated && hasPermission(me ?? null, DNS_MANAGE_PERMISSIONS, null);
    const identity = JSON.stringify([auth.uid, revision, canManage, initialGroup?.id, lockScope]);
    const latest = useRef(identity); latest.current = identity;
    const callbacks = useRef({ onSaved, onBusyChange }); callbacks.current = { onSaved, onBusyChange };
    const [scope, setScope] = useState<Scope | null>(null);
    const [loaded, setLoaded] = useState<{ identity: string; response: RegistrantContactResponse } | null>(null);
    const [draft, setDraft] = useState<RegistrantContact>({});
    const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
    const [tab, setTab] = useState('contact');
    const generation = useRef(0); const mounted = useRef(false); const flight = useRef(false);
    const response = loaded?.identity === identity && canManage ? loaded.response : null;
    const pending = (value: boolean) => { flight.current = value; setBusy(value); callbacks.current.onBusyChange?.(value); };
    const current = (accepted: number, owner: string, uid = auth.uid, rev = revision) => mounted.current && generation.current === accepted && latest.current === owner && getAuthSnapshot().uid === uid && getAuthSessionRevision() === rev;
    const guard = (accepted: number, owner: string) => () => { if (!current(accepted, owner)) throw new Error('Registrant scope or session changed. Reopen this task.'); };
    const accept = (value: RegistrantContactResponse, target: Scope) => {
        const group = target.kind === 'group' ? target.group.id : null;
        if (value.group !== group || value.scope !== (group == null ? 'global' : 'group')) throw new Error('The contact response did not match the selected scope');
        setLoaded({ identity, response: value }); setDraft(contactDraft(value));
    };
    const choose = async (next: Scope | null) => {
        if (!canManage || flight.current || (next?.kind === 'house' && me?.is_superuser !== true)) return;
        const accepted = ++generation.current, owner = identity;
        setScope(next); setLoaded(null); setDraft({}); setError(''); setNotice(''); setTab('contact'); setLoading(!!next);
        if (!next) return;
        try { const value = await fetchRegistrantContact(next.kind === 'group' ? next.group.id : null, guard(accepted, owner)); if (current(accepted, owner)) accept(value, next); }
        catch (reason) { if (current(accepted, owner)) setError(redactRegistrarError(reason)); }
        finally { if (current(accepted, owner)) setLoading(false); }
    };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; callbacks.current.onBusyChange?.(false); }; }, []);
    useEffect(() => {
        generation.current++; flight.current = false; setBusy(false); callbacks.current.onBusyChange?.(false);
        setScope(null); setLoaded(null); setDraft({}); setError(''); setNotice(''); setLoading(false);
        if (canManage && initialGroup) void choose({ kind: 'group', group: initialGroup });
        // A session or explicit fixed-scope change discards all local PII.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identity]);
    const save = async () => {
        if (!canManage || !scope || !response || flight.current || loading) return;
        const problems = validateContactDraft(draft);
        if (problems.length) { setError(problems.join('; ')); setTab(problems.some(value => /FirstName|LastName|ContactType|PhoneNumber|Email/.test(value)) ? 'contact' : 'address'); return; }
        const accepted = generation.current, owner = identity, target = scope; const group = target.kind === 'group' ? target.group.id : null;
        const payload = contactPayload(draft, response, { group }); pending(true); setError(''); setNotice('');
        try { const saved = await saveRegistrantContact(payload, group, guard(accepted, owner)); if (current(accepted, owner)) { accept(saved, target); setNotice('Contact saved.'); callbacks.current.onSaved?.(); } }
        catch (reason) { if (current(accepted, owner)) setError(redactRegistrarError(reason)); }
        finally { if (current(accepted, owner)) pending(false); }
    };
    const clear = async () => {
        if (!canManage || !scope || !response || flight.current || response.source !== 'database') return;
        const accepted = generation.current, owner = identity, target = scope; pending(true); setError(''); setNotice('');
        try {
            if (!await modal.confirm({ title: 'Clear this contact?', message: `Remove the saved contact for ${target.kind === 'house' ? 'House' : target.group.name}. Any inherited contact will apply instead.`, confirmText: 'Clear contact', danger: true })) return;
            if (!current(accepted, owner)) return;
            const saved = await clearRegistrantContact(target.kind === 'group' ? target.group.id : null, guard(accepted, owner));
            if (current(accepted, owner)) { accept(saved, target); setNotice('Saved contact cleared.'); }
        } catch (reason) { if (current(accepted, owner)) setError(redactRegistrarError(reason)); }
        finally { if (current(accepted, owner)) pending(false); }
    };
    if (!canManage) return <div className="modal-pad dim" role="status">DNS management permission is required to manage registrant contacts.</div>;
    const fields = (address: boolean) => <div className="form-grid">{CONTACT_STRING_FIELDS.filter(key => ADDRESS.has(key) === address).map(key => <div key={key} className={['AddressLine1', 'AddressLine2', 'OrganizationName'].includes(key) ? 'col-12' : 'col-6'}><label className="field"><span className="field-label">{LABELS[key]}{REQUIRED.has(key) && <em> *</em>}{key === 'PhoneNumber' && <OperationsHelp label="phone number">Use the international format +country.number, for example +1.2065550123.</OperationsHelp>}</span>{key === 'ContactType' ? <select className="input" value={String(draft[key] ?? '')} disabled={busy} onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))}><option value="">Select…</option>{['PERSON', 'COMPANY', 'ASSOCIATION', 'PUBLIC_BODY', 'RESELLER'].map(value => <option key={value}>{value}</option>)}</select> : <input className="input" aria-label={key === 'PhoneNumber' ? 'Phone number' : undefined} type={key === 'Email' ? 'email' : 'text'} value={String(draft[key] ?? '')} disabled={busy} onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))} />}</label></div>)}</div>;
    return <div className={lockScope ? 'modal-pad dns-registrant-scoped' : 'dns-registrant-page'}>
        <div className={lockScope ? 'dns-registrant-head' : 'panel panel-pad dns-registrant-head'}><div>{!lockScope && <div className="eyebrow">Infrastructure · DNS</div>}{lockScope ? <h2 className="modal-title">Registrant contact</h2> : <h1>Registrant Contact</h1>}<p className="dim">{lockScope ? initialGroup?.name : 'Choose whose contact to manage.'} <OperationsHelp label="registrant contact">The registrar requires accurate contact details to register a domain. Contact values are loaded only for the selected scope and remain in this open form.</OperationsHelp></p></div>{!lockScope && <div className="dns-scope-picker"><CollectionSelect<DnsGroupChoice> endpoint={DNS_GROUP_CHOICE_ENDPOINT} value={scope?.kind === 'group' ? scope.group : null} onChange={(_id, row) => void choose(row ? { kind: 'group', group: row } : null)} label="Group scope" placeholder="Search eligible groups…" maxItems={25} disabled={busy} defaultParams={{ start: 0 }} />{me?.is_superuser === true && <button className={`btn${scope?.kind === 'house' ? ' btn-primary' : ''}`} disabled={busy} onClick={() => void choose({ kind: 'house' })}><i className="bi bi-house" /> House contact</button>}</div>}</div>
        {loading && <p className="dim" role="status">Loading contact…</p>}{error && <div className="form-alert" role="alert">{error}</div>}{notice && <p role="status">{notice}</p>}
        {response && scope && <div className={lockScope ? 'dns-contact-card' : 'panel panel-pad dns-contact-card'}>
            <div className="dns-contact-status"><Badge tone={response.effective_configured ? 'success' : 'warning'}>{response.effective_configured ? 'Ready for purchase' : 'Contact required'}</Badge><OperationsHelp label="contact source">{response.source === 'database' ? 'This scope has its own saved contact.' : response.inherited ? 'An inherited contact applies. Its values are hidden. Saving this form creates a separate contact for this group.' : response.source === 'settings_file' ? 'This contact comes from deployment configuration. Saving creates an override.' : 'No contact is configured.'}</OperationsHelp></div>
            <Tabs ariaLabel="Registrant details" activeKey={tab} onActiveKeyChange={setTab} items={[{ key: 'contact', label: 'Contact', panel: fields(false) }, { key: 'address', label: 'Address', panel: fields(true) }]} />
            {response.problems.length > 0 && <div className="form-alert">{response.problems.join('; ')}</div>}
            <div className="modal-actions">{response.source === 'database' && <button className="btn btn-danger" disabled={busy} onClick={() => void clear()}>Clear this scope</button>}{onClose && <button className="btn" disabled={busy} onClick={onClose}>Close</button>}<button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save contact'}</button></div>
        </div>}{!response && onClose && <div className="modal-actions"><button className="btn" disabled={busy} onClick={onClose}>Close</button></div>}
    </div>;
}
