import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CollectionSelect, FormWizard, Badge, fmt, type FormWizardSection } from '../../ui';
import { DNS_GROUP_CHOICE_ENDPOINT, fetchDnsCapabilities, fetchPurchaseDetail, purchaseDomain, quoteDomain, searchRegistrarBatch } from './api';
import { DomainModel, DomainPurchaseModel, type DnsGroupChoice, type DomainPurchaseRow, type RegistrarSearchRow } from './models';
import { normalizePurchaseDomain, normalizeTypedTlds, pollPurchaseLedger, PURCHASE_MAY_HAVE_MOVED, quoteIdentity, quoteMatches, redactRegistrarError, searchAvailabilityLabel, type QuoteIdentity } from './purchase-data';

interface TransientQuote { readonly token: string; readonly identity: Readonly<QuoteIdentity> }

export function DomainPurchaseWizard({ onDone, onBusyChange }: { onDone?: () => void; onBusyChange?: (busy: boolean) => void }) {
    const queryClient = useQueryClient();
    const [group, setGroup] = useState<DnsGroupChoice | null>(null);
    const [base, setBase] = useState('');
    const [tlds, setTlds] = useState('com, net, org');
    const [results, setResults] = useState<RegistrarSearchRow[]>([]);
    const [selected, setSelected] = useState<RegistrarSearchRow | null>(null);
    const [years, setYears] = useState(1);
    const [typedDomain, setTypedDomain] = useState('');
    const [receipt, setReceipt] = useState<DomainPurchaseRow | null>(null);
    const [terminalMessage, setTerminalMessage] = useState('');
    const quoteRef = useRef<TransientQuote | null>(null);
    const [quoted, setQuoted] = useState<QuoteIdentity | null>(null);
    const attempted = useRef(false);
    const inFlight = useRef(false);
    const generation = useRef(0);
    const clearQuote = () => { quoteRef.current = null; setQuoted(null); setTypedDomain(''); };

    useEffect(() => () => { generation.current += 1; quoteRef.current = null; }, []);
    useEffect(() => {
        if (!quoted) return;
        const delay = Math.max(0, Math.min(2_147_483_647, quoted.expires * 1000 - Date.now()));
        const timer = window.setTimeout(() => { generation.current += 1; quoteRef.current = null; setQuoted(null); setTypedDomain(''); }, delay);
        return () => window.clearTimeout(timer);
    }, [quoted]);
    const changeUpstream = (change: () => void) => { if (attempted.current) return; generation.current += 1; clearQuote(); setResults([]); setSelected(null); change(); };

    const sections = useMemo<FormWizardSection[]>(() => [
        {
            key: 'search', label: 'Search', fields: [], description: 'Choose one authorized group, then enter a base label and your own TLD list. The backend—not this client—is the supported-TLD authority.',
            content: <div className="dns-registrar-grid">
                <CollectionSelect<DnsGroupChoice> endpoint={DNS_GROUP_CHOICE_ENDPOINT} value={group} onChange={(_id, row) => changeUpstream(() => setGroup(row ?? null))} label="Purchasing group" required placeholder="Search eligible groups…" maxItems={25} defaultParams={{ start: 0 }} />
                <label className="field"><span className="field-label">Base name <em>*</em></span><input className="input" value={base} disabled={attempted.current} onChange={(event) => changeUpstream(() => setBase(event.target.value))} placeholder="example" /></label>
                <label className="field"><span className="field-label">TLDs <em>*</em></span><input className="input" value={tlds} disabled={attempted.current} onChange={(event) => changeUpstream(() => setTlds(event.target.value))} placeholder="com, net" /><span className="field-help">Typed values only; no client-maintained supported list.</span></label>
            </div>,
            onNext: async () => {
                if (!group) throw new Error('Choose a purchasing group');
                const caps = await fetchDnsCapabilities(group.id);
                if (!caps.purchase_enabled) throw new Error('Domain purchasing is disabled on this deployment');
                if (!caps.registrant_contact_configured) throw new Error('This group has no usable registrant contact');
                const label = base.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
                if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) throw new Error('Enter one valid base label');
                const typed = normalizeTypedTlds(tlds, caps.search_batch_limit);
                const answer = await searchRegistrarBatch({ domain: label, tlds: typed });
                if (!answer.results.length) throw new Error('The registry returned no search results');
                setResults(answer.results); setSelected(answer.results.find((row) => row.available === true) ?? null);
            },
        },
        {
            key: 'quote', label: 'Choose & quote', fields: [], description: 'Availability is tri-state. Only an explicit Available answer can be quoted.',
            content: <div className="dns-search-results">
                {results.map((row) => <label key={row.name} className={`dns-search-result${selected?.name === row.name ? ' is-selected' : ''}`}>
                    <input type="radio" name="domain-result" checked={selected?.name === row.name} disabled={row.available !== true || attempted.current} onChange={() => { clearQuote(); setSelected(row); }} />
                    <span><code>{row.name}</code><small>{row.reason ?? `${row.price ?? '—'} ${row.currency ?? ''}`}</small></span>
                    <Badge tone={row.available === true ? 'success' : row.available === false ? 'danger' : 'warning'}>{searchAvailabilityLabel(row)}</Badge>
                </label>)}
                <label className="field"><span className="field-label">Registration years</span><select className="input" value={years} disabled={attempted.current} onChange={(event) => { clearQuote(); setYears(Number(event.target.value)); }}>{Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            </div>,
            onNext: async () => {
                if (!group || !selected || selected.available !== true || selected.price == null || !selected.currency) throw new Error('Choose an explicitly available domain');
                const quote = await quoteDomain({ group: group.id, domain: normalizePurchaseDomain(selected.name), years });
                const identity = quoteIdentity(quote, group.id);
                if (!quoteMatches(identity, { group: group.id, domain: selected.name, years, price: selected.price, currency: selected.currency })) throw new Error('Quote did not match the selected search result');
                quoteRef.current = Object.freeze({ token: quote.token, identity: Object.freeze(identity) }); setQuoted(identity);
            },
        },
        {
            key: 'confirm', label: 'Confirm purchase', fields: [], description: 'This is a real-money operation. The exact quote tuple is immutable and the one-use token exists only in this mounted wizard.',
            content: quoted && <div className="dns-quote-card">
                <div><span>Domain</span><code>{quoted.domain}</code></div><div><span>Term</span><b>{quoted.years} year{quoted.years === 1 ? '' : 's'}</b></div>
                <div><span>Exact price</span><b>{quoted.price} {quoted.currency}</b></div><div><span>Expires</span><b>{fmt.datetime(quoted.expires)}</b></div>
                <label className="field"><span className="field-label">Type {quoted.domain} to confirm <em>*</em></span><input className="input" value={typedDomain} disabled={attempted.current} autoComplete="off" onChange={(event) => setTypedDomain(event.target.value)} /></label>
            </div>,
            onNext: async () => {
                if (inFlight.current || attempted.current) throw new Error('This quote has already been attempted');
                const transient = quoteRef.current;
                if (!transient || !group || !selected || selected.price == null || !selected.currency) throw new Error('The quote is missing or expired. Start over.');
                if (!quoteMatches(transient.identity, { group: group.id, domain: selected.name, years, price: selected.price, currency: selected.currency })) { clearQuote(); throw new Error('The quote expired or its inputs changed. Start over.'); }
                if (typedDomain.trim().toLowerCase() !== transient.identity.domain) throw new Error(`Type ${transient.identity.domain} exactly`);
                inFlight.current = true; attempted.current = true; const accepted = ++generation.current;
                const token = transient.token; quoteRef.current = null;
                try {
                    const acknowledgement = await purchaseDomain({ group: transient.identity.group, purchase: transient.identity.purchase, confirm_token: token });
                    const settled = await pollPurchaseLedger({ purchase: acknowledgement.purchase, isCurrent: () => generation.current === accepted, fetch: fetchPurchaseDetail });
                    if (!settled) setTerminalMessage(`Purchase acknowledgement was received, but bounded polling did not settle. ${PURCHASE_MAY_HAVE_MOVED}`);
                    else { setReceipt(settled); setTerminalMessage(settled.status === 'completed' ? 'Registration completed.' : `${redactRegistrarError(settled.error)} ${PURCHASE_MAY_HAVE_MOVED}`); }
                } catch (error) {
                    setTerminalMessage(`${redactRegistrarError(error)} ${PURCHASE_MAY_HAVE_MOVED}`);
                    try { setReceipt(await fetchPurchaseDetail(transient.identity.purchase)); } catch { /* detail stays local and optional */ }
                } finally {
                    await Promise.allSettled([DomainPurchaseModel.invalidate(queryClient), DomainModel.invalidate(queryClient)]);
                    inFlight.current = false;
                }
            },
        },
        {
            key: 'receipt', label: 'Ledger', fields: [], terminal: true,
            content: <div className="dns-purchase-receipt"><h3>{receipt?.status === 'completed' ? 'Purchase complete' : 'Check the durable ledger'}</h3><p className={receipt?.status === 'completed' ? '' : 'form-alert'}>{terminalMessage}</p>{receipt && <><div><span>Purchase</span><code>#{receipt.id}</code></div><div><span>Domain</span><code>{receipt.domain_name}</code></div><div><span>Status</span><Badge tone={receipt.status === 'completed' ? 'success' : receipt.status === 'failed' ? 'danger' : 'warning'}>{receipt.status}</Badge></div></>}<div className="modal-actions"><button className="btn btn-primary" onClick={onDone}>Close</button></div></div>,
        },
    ], [base, group, onDone, queryClient, quoted, receipt, results, selected, terminalMessage, tlds, typedDomain, years]);

    return <FormWizard mode="wizard" sections={sections} onBusyChange={onBusyChange} onCancel={onDone} onFinish={() => undefined} nextText="Continue" />;
}
