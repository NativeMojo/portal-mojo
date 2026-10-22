import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getAuthSessionRevision, getAuthSnapshot, subscribeAuth, useAuthSnapshot, useMe } from '../../client/runtime';
import { modal } from '../../ui/modal';
import { Tabs } from '../../ui/Tabs';
import { datetime } from '../../ui/format';
import { backendGlobalCan } from '../fleet/access';
import { FleetHelp } from '../fleet/FleetHelp';
import { DomainRegistrarSettings, type RegistrarChanges } from './DomainRegistrarSettings';
import { fetchDomainOverview, fetchDomainRegistration, registrationAuthority, registrationContact, saveDomainRegistrarSettings, saveRegistrationContacts, saveRegistrationPrivacy, type DomainRegistration, type RegistrationRequest } from './registrar-api';
import { CONTACT_STRING_FIELDS, validateContactDraft } from './registrant-data';
import type { DomainRow, RegistrantContact } from './models';

const LABELS: Record<(typeof CONTACT_STRING_FIELDS)[number], string> = { FirstName: 'First name', LastName: 'Last name', ContactType: 'Contact type', OrganizationName: 'Organization', AddressLine1: 'Address line 1', AddressLine2: 'Address line 2', City: 'City', State: 'State / province', CountryCode: 'Country code', ZipCode: 'Postal code', PhoneNumber: 'Phone number', Email: 'Email', Fax: 'Fax' };
const CONTACT_FIELDS = ['FirstName', 'LastName', 'ContactType', 'OrganizationName', 'PhoneNumber', 'Email', 'Fax'] as const;
const ADDRESS_FIELDS = ['AddressLine1', 'AddressLine2', 'City', 'State', 'CountryCode', 'ZipCode'] as const;
const groupId = (domain: DomainRow) => typeof domain.group === 'number' ? domain.group : domain.group?.id ?? null;
const enabled = (value: boolean | null) => value === null ? 'Not reported' : value ? 'On' : 'Off';
const privacy = (row: DomainRegistration) => {
    const values = [row.admin_privacy, row.registrant_privacy, row.tech_privacy];
    return values.every(value => value === true) ? 'On for all contacts' : values.every(value => value === false) ? 'Off for all contacts' : values.some(value => value === null) ? 'Not fully reported' : 'Mixed by contact';
};

/** Live registrar evidence and contact PII stay in this mounted task, outside Query. */
export function DomainRegistrationPanel({ domain, onBusyChange, onChanged }: { domain: DomainRow; onBusyChange?: (busy: boolean) => void; onChanged?: () => void }) {
    const auth = useAuthSnapshot(), { data: me } = useMe();
    const revision = useSyncExternalStore(subscribeAuth, getAuthSessionRevision, getAuthSessionRevision);
    const canManage = auth.authenticated && me?.is_active !== false && backendGlobalCan(me, ['manage_dns', 'security']);
    const identity = JSON.stringify([domain.id, domain.name, domain.provider, groupId(domain), auth.uid, revision, canManage]);
    const latest = useRef(identity); latest.current = identity;
    const permitted = useRef(canManage); permitted.current = canManage;
    const callbacks = useRef({ onBusyChange, onChanged }); callbacks.current = { onBusyChange, onChanged };
    const controller = useRef<AbortController | null>(null), flight = useRef(false);
    const [stored, setStored] = useState<{ identity: string; value: DomainRegistration } | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => {
        const owner = new AbortController(); controller.current = owner; setStored(null); setError(''); setBusy(false); flight.current = false;
        return () => { owner.abort(); callbacks.current.onBusyChange?.(false); };
    }, [identity]);
    const registration = stored?.identity === identity ? stored.value : null;
    const request = (): RegistrationRequest => {
        const signal = controller.current?.signal, selected = identity, uid = auth.uid, rev = revision;
        const beforeSend = () => { if (!signal || signal.aborted || latest.current !== selected || !permitted.current || !getAuthSnapshot().authenticated || getAuthSnapshot().uid !== uid || getAuthSessionRevision() !== rev) throw new DOMException('Registration view changed', 'AbortError'); };
        beforeSend(); return { signal, beforeSend };
    };
    const accept = (value: DomainRegistration, options: RegistrationRequest) => { options.beforeSend?.(); setStored({ identity, value }); };
    const read = async () => {
        if (flight.current) return;
        let options: RegistrationRequest; try { options = request(); } catch { return; }
        flight.current = true; setBusy(true); setError(''); callbacks.current.onBusyChange?.(true);
        try { accept(await fetchDomainRegistration(domain, options), options); }
        catch { if (!options.signal?.aborted && latest.current === identity) { setStored(null); setError('Registration could not be read. The DNS provider does not establish where this domain is registered. Check the registrar account, then try again.'); } }
        finally { if (!options.signal?.aborted && latest.current === identity) { flight.current = false; setBusy(false); callbacks.current.onBusyChange?.(false); } }
    };
    const openEditor = async (mode: 'settings' | 'contacts') => {
        if (!registration || registrationAuthority(registration.registrar) !== 'route53') return;
        let options: RegistrationRequest; try { options = request(); } catch { return; }
        let pending = false;
        await modal.open(close => <RegistrationEditor domain={domain} registration={registration} mode={mode} request={request} onEvidence={value => accept(value, options)} onChanged={() => callbacks.current.onChanged?.()} onBusy={value => { pending = value; callbacks.current.onBusyChange?.(value); }} close={() => close(null)}/>, { signal: options.signal, size: mode === 'contacts' ? 'lg' : 'md', canDismiss: () => !pending });
    };
    if (!canManage) return <p className="dim">DNS management authority is required to read registration details.</p>;
    if (domain.provider === 'godaddy') return <section className="domains-registration"><p>Registration, renewal and contact details stay in the GoDaddy account that holds this domain.</p><a className="btn" href="https://dcc.godaddy.com/domains" target="_blank" rel="noopener noreferrer">Open GoDaddy domains</a></section>;
    if (domain.provider !== 'route53') return <p className="dim">Registration is managed by this domain’s registrar.</p>;
    return <section className="domains-registration"><div className="domains-overview-actions"><button className="btn" disabled={busy} onClick={() => void read()}>{busy ? 'Reading registration…' : registration ? 'Refresh registration' : 'Read registration'}</button><FleetHelp label="registration details">Reads live registrar data, including private contact details, for this domain only. DNS hosting and domain registration can use different providers.</FleetHelp></div>
        {error && <p className="text-bad" role="alert">{error}</p>}
        {registration && <><dl className="detail-grid"><div><dt>Registrar</dt><dd>{registration.registrar || 'Not reported'}</dd></div><div><dt>Expires</dt><dd>{registration.expires ? datetime(registration.expires) : 'Not reported'}</dd></div><div><dt>Auto-renew</dt><dd>{enabled(registration.auto_renew)}</dd></div><div><dt>WHOIS privacy</dt><dd>{privacy(registration)}</dd></div></dl>
            {registrationAuthority(registration.registrar) === 'route53' ? <div className="domains-overview-actions"><button className="btn" disabled={busy} onClick={() => void openEditor('settings')}>Registration settings…</button><button className="btn" disabled={busy} onClick={() => void openEditor('contacts')}>Contacts…</button></div> : <p className="dim">{registrationAuthority(registration.registrar) === 'godaddy' ? 'Manage registration in the GoDaddy account that holds this domain.' : 'Local registration edits are unavailable because this registrar has not been confirmed as Route 53.'}</p>}
        </>}
    </section>;
}

function RegistrationEditor({ domain, registration, mode, request, onEvidence, onChanged, onBusy, close }: { domain: DomainRow; registration: DomainRegistration; mode: 'settings' | 'contacts'; request: () => RegistrationRequest; onEvidence: (value: DomainRegistration) => void; onChanged: () => void; onBusy: (value: boolean) => void; close: () => void }) {
    const [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [editing, setEditing] = useState(false), [tab, setTab] = useState('contact');
    const [draft, setDraft] = useState<RegistrantContact>(() => registrationContact(registration.registrant));
    const flight = useRef(false), alive = useRef(true);
    const callback = useRef(onBusy); callback.current = onBusy;
    useEffect(() => { alive.current = true; return () => { alive.current = false; callback.current(false); }; }, []);
    const save = async (changes: RegistrarChanges | RegistrantContact, contact: boolean) => {
        if (flight.current || locked) return;
        if (contact) {
            const problems = validateContactDraft(changes as RegistrantContact);
            if (problems.length) { setError('Complete the required Contact and Address fields. Use +country.number for phone numbers.'); setTab(problems.some(problem => ADDRESS_FIELDS.some(field => problem.startsWith(field))) ? 'address' : 'contact'); return; }
        }
        let options: RegistrationRequest; try { options = request(); } catch { return; }
        flight.current = true; setBusy(true); setError(''); onBusy(true);
        let submitted = false, readbackAttempted = false;
        try {
            const object = await fetchDomainOverview(domain.id, options);
            if (object.name !== domain.name || object.provider !== domain.provider || groupId(object) !== groupId(domain)) throw new Error('Domain ownership changed');
            const fresh = await fetchDomainRegistration(domain, options);
            if (registrationAuthority(fresh.registrar) !== 'route53') throw new Error('Registrar changed');
            if (contact ? JSON.stringify([fresh.registrant, fresh.admin, fresh.tech]) !== JSON.stringify([registration.registrant, registration.admin, registration.tech]) : fresh.auto_renew !== registration.auto_renew || privacy(fresh) !== privacy(registration) || fresh.privacy_supported !== registration.privacy_supported) throw new Error('Registration changed');
            if (!contact && (changes as RegistrarChanges).privacy === true && fresh.privacy_supported !== true) throw new Error('Privacy not supported');
            setLocked(true); submitted = true;
            if (contact) await saveRegistrationContacts(domain, changes as RegistrantContact, options);
            else {
                const settings = changes as RegistrarChanges;
                if (settings.auto_renew !== undefined) await saveDomainRegistrarSettings(domain.id, { auto_renew: settings.auto_renew }, options);
                if (settings.privacy !== undefined) await saveRegistrationPrivacy(domain, settings.privacy, options);
            }
            readbackAttempted = true;
            const observed = await fetchDomainRegistration(domain, options); onEvidence(observed);
            const matched = contact ? Object.entries(changes).every(([key, value]) => JSON.stringify(observed.registrant[key as keyof RegistrantContact]) === JSON.stringify(value)) && [observed.admin, observed.tech].every(role => Object.entries(changes).every(([key, value]) => JSON.stringify(role[key as keyof RegistrantContact]) === JSON.stringify(value))) : ((changes as RegistrarChanges).auto_renew === undefined || observed.auto_renew === (changes as RegistrarChanges).auto_renew) && ((changes as RegistrarChanges).privacy === undefined || [observed.admin_privacy, observed.registrant_privacy, observed.tech_privacy].every(value => value === (changes as RegistrarChanges).privacy));
            setNotice(matched ? 'Requested values are now visible in the live registrar read.' : 'Request accepted. The registrar has not yet reported all requested values. Refresh registration to check progress.');
        } catch {
            if (!options.signal?.aborted && alive.current) setError(submitted ? 'The registrar outcome is unconfirmed. No request will be repeated. Close and refresh registration before another decision.' : 'Registration or domain ownership changed, or could not be checked. Close and refresh registration before editing.');
        } finally {
            if (submitted && !readbackAttempted && !options.signal?.aborted) {
                try { onEvidence(await fetchDomainRegistration(domain, options)); } catch { /* Unknown outcome remains locked; never replay. */ }
            }
            if (!options.signal?.aborted && alive.current) { if (submitted) onChanged(); flight.current = false; setBusy(false); onBusy(false); }
        }
    };
    if (mode === 'settings') return <DomainRegistrarSettings domain={domain} registration={registration} busy={busy} locked={locked} error={error} notice={notice} submit={changes => void save(changes, false)} close={close}/>;
    const fields = (keys: readonly (typeof CONTACT_STRING_FIELDS)[number][]) => <div className="form-grid">{keys.map(key => <label className={`field ${['OrganizationName', 'AddressLine1', 'AddressLine2'].includes(key) ? 'col-12' : 'col-6'}`} key={key}><span className="field-label">{LABELS[key]}</span>{key === 'ContactType' ? <select className="input" value={draft[key] ?? ''} disabled={busy || locked} onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))}><option value="">Choose…</option>{!['PERSON', 'COMPANY', 'ASSOCIATION', 'PUBLIC_BODY', 'RESELLER'].includes(draft.ContactType ?? '') && draft.ContactType && <option value={draft.ContactType} disabled>Unknown contact type</option>}{['PERSON', 'COMPANY', 'ASSOCIATION', 'PUBLIC_BODY', 'RESELLER'].map(value => <option key={value}>{value}</option>)}</select> : <input className="input" type={key === 'Email' ? 'email' : 'text'} maxLength={500} value={draft[key] ?? ''} disabled={busy || locked} onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))}/>}</label>)}</div>;
    return <form className="modal-pad domains-registration-contact" onSubmit={event => { event.preventDefault(); void save(registrationContact(draft), true); }}><h2 className="modal-title">Registration contacts</h2><p className="dim">{domain.name}</p>
        {editing ? <><p>Replace Registrant, Admin and Technical contacts with these details. A changed email may require verification.</p><Tabs ariaLabel="Contact fields" activeKey={tab} onActiveKeyChange={key => { if (!flight.current) setTab(key); }} items={[{ key: 'contact', label: 'Contact', panel: fields(CONTACT_FIELDS) }, { key: 'address', label: 'Address', panel: fields(ADDRESS_FIELDS) }]}/></> : <Tabs ariaLabel="Registrar contact roles" items={(['registrant', 'admin', 'tech'] as const).map(role => ({ key: role, label: role === 'tech' ? 'Technical' : role === 'admin' ? 'Admin' : 'Registrant', panel: <dl className="detail-grid">{CONTACT_STRING_FIELDS.filter(key => registration[role][key]).map(key => <div key={key}><dt>{LABELS[key]}</dt><dd>{registration[role][key]}</dd></div>)}</dl> }))}/>}
        {error && <p role="alert" className="text-bad">{error}</p>}{notice && <p role="status">{notice}</p>}
        <div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={close}>Close</button>{editing ? <button className="btn btn-primary" type="submit" disabled={busy || locked}>Replace all contacts</button> : <button className="btn btn-primary" type="button" onClick={() => setEditing(true)}>Edit all contacts…</button>}</div>
    </form>;
}
