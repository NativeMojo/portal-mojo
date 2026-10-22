import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAuthSessionRevision, getAuthSnapshot, hasPermission, subscribeAuth, useAuthSnapshot, useMe } from '../../client/runtime';
import { CollectionSelect, FormWizard, Badge, fmt, modal, type FormWizardSection } from '../../ui';
import { OperationsHelp } from '../core/OperationsHelp';
import { DNS_GROUP_CHOICE_ENDPOINT, fetchDnsCapabilities, fetchPurchaseDetail, purchaseDomain, quoteDomain, searchRegistrarBatch } from './api';
import { DNS_MANAGE_PERMISSIONS, DomainModel, DomainPurchaseModel, type DnsGroupChoice, type DomainPurchaseRow, type RegistrarSearchRow } from './models';
import { normalizePurchaseDomain, normalizeTypedTlds, pollPurchaseLedger, PURCHASE_MAY_HAVE_MOVED, quoteIdentity, quoteMatches, redactRegistrarError, searchAvailabilityLabel, type QuoteIdentity } from './purchase-data';
import { DomainPurchaseDetail } from './DomainPurchaseDetail';
import { RegistrantContactPage } from './RegistrantContactPage';

interface TransientQuote { readonly token: string; readonly identity: Readonly<QuoteIdentity> }
interface WizardProps { onDone?: () => void; onBusyChange?: (busy: boolean) => void }
export function DomainPurchaseWizard(props: WizardProps) {
    const { data: me } = useMe(); const auth = useAuthSnapshot();
    const revision = useSyncExternalStore(subscribeAuth, getAuthSessionRevision, getAuthSessionRevision);
    const canManage = auth.authenticated && hasPermission(me ?? null, DNS_MANAGE_PERMISSIONS, null);
    const [attempt, setAttempt] = useState<{ uid: string | null; revision: number; id: number } | null>(null);
    useEffect(() => { setAttempt(value => value?.uid === auth.uid ? value : null); }, [auth.uid]);
    const recordAttempt = useCallback((id: number) => setAttempt({ uid: auth.uid, revision, id }), [auth.uid, revision]);
    if (!canManage) return <p className="dim" role="status">DNS management permission is required to buy a domain.</p>;
    if (attempt?.uid === auth.uid && attempt.revision !== revision) return <PurchaseRecovery key={`${auth.uid}:${revision}`} id={attempt.id} onDone={props.onDone} />;
    return <PurchaseWizard key={`${auth.uid}:${revision}`} {...props} uid={auth.uid} revision={revision} onAttempt={recordAttempt} />;
}
function PurchaseWizard({ onDone, onBusyChange, uid, revision, onAttempt }: WizardProps & { uid: string | null; revision: number; onAttempt: (id: number) => void }) {
    const queryClient = useQueryClient();
    const [group, setGroup] = useState<DnsGroupChoice | null>(null);
    const [base, setBase] = useState(''); const [tlds, setTlds] = useState('com, net, org');
    const [results, setResults] = useState<RegistrarSearchRow[]>([]); const [selected, setSelected] = useState<RegistrarSearchRow | null>(null);
    const [typedDomain, setTypedDomain] = useState(''); const [receipt, setReceipt] = useState<DomainPurchaseRow | null>(null);
    const [terminalMessage, setTerminalMessage] = useState(''); const [purchaseId, setPurchaseId] = useState<number | null>(null);
    const [knownDomainId, setKnownDomainId] = useState<number>(); const [privacyDowngraded, setPrivacyDowngraded] = useState(false);
    const [contactRevision, setContactRevision] = useState(0); const [missingContact, setMissingContact] = useState(false); const [contactNotice, setContactNotice] = useState('');
    const [busy, setBusy] = useState(false); const [refreshing, setRefreshing] = useState(false);
    const quoteRef = useRef<TransientQuote | null>(null); const [quoted, setQuoted] = useState<QuoteIdentity | null>(null);
    const attempted = useRef(false); const inFlight = useRef(false); const generation = useRef(0); const alive = useRef(false);
    const onBusy = useRef(onBusyChange); onBusy.current = onBusyChange;
    const modalOwner = useRef<AbortController | null>(null);
    const handleBusy = useCallback((value: boolean) => { inFlight.current = value; setBusy(value); onBusy.current?.(value); }, []);
    const isCurrent = (accepted: number) => alive.current && generation.current === accepted && getAuthSnapshot().uid === uid && getAuthSessionRevision() === revision;
    const clearQuote = () => { quoteRef.current = null; setQuoted(null); setTypedDomain(''); };
    useEffect(() => {
        alive.current = true; const owner = new AbortController(); modalOwner.current = owner;
        return () => { alive.current = false; generation.current++; quoteRef.current = null; owner.abort(); onBusy.current?.(false); };
    }, []);
    useEffect(() => {
        if (!quoted || attempted.current) return;
        const delay = Math.max(0, Math.min(2_147_483_647, quoted.expires * 1000 - Date.now()));
        const timer = window.setTimeout(() => { if (!attempted.current) { generation.current++; clearQuote(); } }, delay);
        return () => window.clearTimeout(timer);
    }, [quoted]);
    const changeUpstream = (change: () => void) => { if (attempted.current || inFlight.current) return; generation.current++; clearQuote(); setResults([]); setSelected(null); setMissingContact(false); setContactNotice(''); change(); };
    const setupContact = async () => {
        if (!group || inFlight.current || attempted.current) return;
        const accepted = generation.current, target = { ...group }; let pending = false;
        await modal.open(close => <RegistrantContactPage initialGroup={target} lockScope onClose={() => close(null)} onBusyChange={value => { pending = value; }} onSaved={() => { if (isCurrent(accepted)) { setMissingContact(false); setContactNotice('Contact saved. Continue to search.'); setContactRevision(value => value + 1); } close(null); }} />, { size: 'lg', signal: modalOwner.current?.signal, canDismiss: () => !pending });
    };
    const refresh = async () => {
        if (!purchaseId || refreshing) return; const accepted = generation.current; setRefreshing(true);
        try { const value = await fetchPurchaseDetail(purchaseId); if (!isCurrent(accepted)) return; if (value.id !== purchaseId) throw new Error('The ledger response did not match this purchase'); setReceipt(value); setTerminalMessage(value.status === 'completed' ? 'Registration completed.' : PURCHASE_MAY_HAVE_MOVED); }
        catch (reason) { if (isCurrent(accepted)) setTerminalMessage(`${redactRegistrarError(reason)} ${PURCHASE_MAY_HAVE_MOVED}`); }
        finally { if (isCurrent(accepted)) setRefreshing(false); }
    };
    const sections = useMemo<FormWizardSection[]>(() => [
        {
            key: 'search', label: 'Search', fields: [],
            content: <div className="dns-registrar-grid">
                <CollectionSelect<DnsGroupChoice> endpoint={DNS_GROUP_CHOICE_ENDPOINT} value={group} onChange={(_id, row) => changeUpstream(() => setGroup(row ?? null))} label="Purchasing group" required placeholder="Search eligible groups…" maxItems={25} defaultParams={{ start: 0 }} disabled={busy || attempted.current} />
                <label className="field"><span className="field-label">Base name <em>*</em></span><input className="input" value={base} disabled={busy || attempted.current} onChange={event => changeUpstream(() => setBase(event.target.value))} placeholder="example" /></label>
                <label className="field"><span className="field-label">TLDs <em>*</em> <OperationsHelp label="domain search">Enter endings to search, separated by commas, for example com, net. Availability and pricing are checked with the registrar.</OperationsHelp></span><input className="input" value={tlds} disabled={busy || attempted.current} onChange={event => changeUpstream(() => setTlds(event.target.value))} placeholder="com, net" /></label>
                {missingContact && <div className="form-alert">Set up a registrant contact for {group?.name} before purchasing. <button type="button" className="btn" disabled={busy} onClick={() => void setupContact()}>Set up contact</button></div>}{contactNotice && <p role="status">{contactNotice}</p>}
            </div>,
            onNext: async () => {
                if (!group) throw new Error('Choose a purchasing group'); const accepted = generation.current;
                const caps = await fetchDnsCapabilities(group.id); if (!isCurrent(accepted)) throw new Error('The purchasing scope changed. Search again.');
                if (!caps.purchase_enabled) throw new Error('Domain purchasing is disabled on this deployment');
                if (!caps.registrant_contact_configured) { setMissingContact(true); throw new Error('A registrant contact is required'); }
                const label = base.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
                if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) throw new Error('Enter one valid base label');
                const typed = normalizeTypedTlds(tlds, caps.search_batch_limit); const answer = await searchRegistrarBatch({ domain: label, tlds: typed });
                if (!isCurrent(accepted)) throw new Error('The purchasing scope changed. Search again.');
                if (!answer.results.length) throw new Error('The registry returned no search results');
                setResults(answer.results); setSelected(answer.results.find(row => row.available === true) ?? null);
            },
        },
        {
            key: 'quote', label: 'Choose & quote', fields: [],
            content: <div className="dns-search-results"><p className="dim">One-year registration <OperationsHelp label="registration term">Purchases in this portal are for one year. The registrar provides the final quote before you confirm.</OperationsHelp></p>{results.map(row => <label key={row.name} className={`dns-search-result${selected?.name === row.name ? ' is-selected' : ''}`}><input type="radio" name="domain-result" checked={selected?.name === row.name} disabled={row.available !== true || busy || attempted.current} onChange={() => { clearQuote(); setSelected(row); }} /><span><code>{row.name}</code><small>{row.reason ?? `${row.price ?? '—'} ${row.currency ?? ''}`}</small></span><Badge tone={row.available === true ? 'success' : row.available === false ? 'danger' : 'warning'}>{searchAvailabilityLabel(row)}</Badge></label>)}</div>,
            onNext: async () => {
                if (!group || !selected || selected.available !== true || selected.price == null || !selected.currency) throw new Error('Choose an explicitly available domain');
                const accepted = generation.current; const quote = await quoteDomain({ group: group.id, domain: normalizePurchaseDomain(selected.name), years: 1 }, () => { if (!isCurrent(accepted)) throw new Error('The purchasing scope changed. Request a new quote.'); });
                if (!isCurrent(accepted)) throw new Error('The purchasing scope changed. Request a new quote.');
                const identity = quoteIdentity(quote, group.id);
                if (!Number.isInteger(identity.purchase) || identity.purchase <= 0 || !quote.token || typeof quote.privacy_supported !== 'boolean' || !quoteMatches(identity, { group: group.id, domain: selected.name, years: 1, price: selected.price, currency: selected.currency })) throw new Error('Quote did not match the selected one-year registration');
                quoteRef.current = Object.freeze({ token: quote.token, identity: Object.freeze(identity) }); setQuoted(identity);
            },
        },
        {
            key: 'confirm', label: 'Confirm purchase', fields: [],
            content: quoted ? <div className="dns-quote-card"><div><span>Domain</span><code>{quoted.domain}</code></div><div><span>Term</span><b>1 year</b></div><div><span>Exact price</span><b>{quoted.price} {quoted.currency}</b></div><div><span>Expires</span><b>{fmt.datetime(quoted.expires)}</b></div><div><span>WHOIS privacy</span><b>{quoted.privacy_supported ? 'Requested where supported' : 'Not available for this domain'}</b></div>{!quoted.privacy_supported && <p className="form-alert">Your registrant contact may be publicly visible. Confirm only if you accept registration without WHOIS privacy.</p>}<label className="field"><span className="field-label">Type {quoted.domain} to confirm <em>*</em> <OperationsHelp label="purchase confirmation">Confirming charges the exact quoted price for one year. The confirmation can be used only once. An uncertain response must be checked in the purchase ledger.</OperationsHelp></span><input className="input" value={typedDomain} disabled={busy || attempted.current} autoComplete="off" onChange={event => setTypedDomain(event.target.value)} /></label></div> : <p className="form-alert" role="alert">Your quote expired. Go back to request a new quote.</p>,
            onNext: async () => {
                if (attempted.current) throw new Error('This quote has already been attempted'); const transient = quoteRef.current;
                if (!transient || !group || !selected || selected.price == null || !selected.currency) throw new Error('The quote is missing or expired. Go back for a new quote.');
                if (!quoteMatches(transient.identity, { group: group.id, domain: selected.name, years: 1, price: selected.price, currency: selected.currency })) { clearQuote(); throw new Error('The quote expired or its inputs changed. Go back for a new quote.'); }
                if (typedDomain.trim().toLowerCase() !== transient.identity.domain) throw new Error(`Type ${transient.identity.domain} exactly`);
                attempted.current = true; const accepted = ++generation.current; const token = transient.token; quoteRef.current = null; setPurchaseId(transient.identity.purchase); onAttempt(transient.identity.purchase);
                try {
                    const acknowledgement = await purchaseDomain({ group: transient.identity.group, purchase: transient.identity.purchase, confirm_token: token, confirm_domain: transient.identity.domain, confirm_price: transient.identity.price }, () => { if (!isCurrent(accepted)) throw new Error('The purchasing session changed. Review the exact purchase before continuing.'); });
                    if (!isCurrent(accepted)) return;
                    if (acknowledgement.purchase !== transient.identity.purchase || acknowledgement.name !== transient.identity.domain) throw new Error('The acknowledgement did not match this purchase');
                    setKnownDomainId(acknowledgement.domain); setPrivacyDowngraded(acknowledgement.privacy_downgraded);
                    const settled = await pollPurchaseLedger({ purchase: transient.identity.purchase, isCurrent: () => isCurrent(accepted), fetch: fetchPurchaseDetail });
                    if (!isCurrent(accepted)) return;
                    setReceipt(settled); setTerminalMessage(settled?.status === 'completed' ? 'Registration completed.' : PURCHASE_MAY_HAVE_MOVED);
                } catch (reason) {
                    if (!isCurrent(accepted)) return; setTerminalMessage(`${redactRegistrarError(reason)} ${PURCHASE_MAY_HAVE_MOVED}`);
                    try { const value = await fetchPurchaseDetail(transient.identity.purchase); if (isCurrent(accepted) && value.id === transient.identity.purchase) setReceipt(value); } catch { /* Exact ledger remains available for deliberate Refresh. */ }
                } finally { await Promise.allSettled([DomainPurchaseModel.invalidate(queryClient), DomainModel.invalidate(queryClient)]); }
            },
        },
        {
            key: 'receipt', label: 'Purchase status', fields: [], terminal: true,
            content: <div className="dns-purchase-receipt"><h3>{receipt?.status === 'completed' ? 'Purchase complete' : 'Check purchase status'}</h3><p className={receipt?.status === 'completed' ? '' : 'form-alert'}>{terminalMessage}</p>{privacyDowngraded && <p role="alert" className="form-alert">The registrar completed registration without WHOIS privacy. Your registrant contact may be publicly visible.</p>}<div><span>Purchase</span><code>#{purchaseId}</code></div><div><span>Domain</span><code>{receipt?.domain_name ?? quoted?.domain}</code></div>{receipt && <div><span>Status</span><Badge tone={receipt.status === 'completed' ? 'success' : receipt.status === 'failed' ? 'danger' : 'warning'}>{receipt.status}</Badge></div>}<div className="modal-actions"><button className="btn" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Refreshing…' : 'Refresh'}</button><button className="btn" disabled={!purchaseId} onClick={() => { if (purchaseId) void modal.open(close => <DomainPurchaseDetail id={purchaseId} knownDomainId={knownDomainId} privacyDowngraded={privacyDowngraded} close={() => close(null)} />, { size: 'md', signal: modalOwner.current?.signal }); }}>View purchase</button><button className="btn btn-primary" onClick={onDone}>Close</button></div></div>,
        },
    ], [base, busy, contactNotice, group, knownDomainId, missingContact, onDone, privacyDowngraded, purchaseId, queryClient, quoted, receipt, refreshing, results, selected, terminalMessage, tlds, typedDomain]);
    return <FormWizard mode="wizard" resetKey={contactRevision} sections={sections} onBusyChange={handleBusy} onCancel={onDone} onFinish={() => undefined} nextText="Continue" />;
}

/** Only the attempted ID survives same-user session replacement; tokens and drafts do not. */
function PurchaseRecovery({ id, onDone }: { id: number; onDone?: () => void }) {
    const [row, setRow] = useState<DomainPurchaseRow | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
    const flight = useRef(false); const owner = useRef<AbortController | null>(null);
    useEffect(() => { const controller = new AbortController(); owner.current = controller; return () => controller.abort(); }, []);
    const refresh = async () => {
        if (flight.current) return; const signal = owner.current?.signal; flight.current = true; setBusy(true); setError('');
        try { const value = await fetchPurchaseDetail(id); if (signal?.aborted) return; if (value.id !== id) throw new Error('The ledger response did not match this purchase'); setRow(value); }
        catch (reason) { if (!signal?.aborted) setError(redactRegistrarError(reason)); }
        finally { if (!signal?.aborted) { flight.current = false; setBusy(false); } }
    };
    return <div className="dns-purchase-receipt"><h3>Check purchase #{id}</h3><p className="form-alert" role="alert">Your session changed. Review this purchase before starting another.</p>{row && <p><code>{row.domain_name}</code> · {row.status}</p>}{error && <p className="form-alert" role="alert">{error}</p>}<div className="modal-actions"><button className="btn" disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh'}</button><button className="btn" onClick={() => void modal.open(close => <DomainPurchaseDetail id={id} close={() => close(null)} />, { size: 'md', signal: owner.current?.signal })}>View purchase</button><button className="btn btn-primary" onClick={onDone}>Close</button></div></div>;
}
