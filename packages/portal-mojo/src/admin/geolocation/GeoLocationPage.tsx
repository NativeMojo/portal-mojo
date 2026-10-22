import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { requestFreshAuth, useMe } from '../../client/runtime';
import { modal } from '../../ui';
import { Popover } from '../../ui/Popover';
import { OperatorError, usePrivateOperator } from '../fleet-configuration/shared-validation-data';
import { GeoLocationError, geoDraft, geoFleetRoute, geoProviderLabel, geoProviderOptions, geoTestBlock, geoWriteBlock, readGeoLocation, saveGeoLocation, testGeoLocation, type GeoDraft, type GeoKeyEdit, type GeoLocationState, type GeoVerdict } from './data';

// The hosted MojoVerify service has one fixed origin; only its key is editable.
const mojoverifyDraft = (value: GeoDraft): GeoDraft => ({ ...geoDraft(value), GEOIP_MOJO_PROVIDER_URL: 'https://api.mojoverify.com' });
const tabs = ['Provider', 'Failover'] as const;

function GeoHelp({ label, children }: { label: string; children: ReactNode }) {
    const anchor = useRef<HTMLButtonElement>(null), id = useId();
    const [open, setOpen] = useState(false);
    return <><button ref={anchor} type="button" className="ops-help" aria-label={`About ${label}`} aria-expanded={open} aria-controls={open ? id : undefined} onClick={event => { event.preventDefault(); setOpen(value => !value); }}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10" cy="10" r="8" /><path d="M10 9v5" /><circle cx="10" cy="6" r=".8" fill="currentColor" stroke="none" /></svg></button><Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)} id={id} aria-label={`About ${label}`} className="ops-help-content">{children}</Popover></>;
}

export function GeoLocationPage({ fleetConfigurationPath }: { fleetConfigurationPath?: string } = {}) {
    const owner = usePrivateOperator(), { data: me } = useMe();
    if (me?.is_superuser !== true || !owner.allowed) return <div className="panel panel-pad"><h1>GeoLocation</h1><p>GeoLocation requires a superuser account with an interactive session.</p></div>;
    return <GeoLocationContent key={owner.key} fleetConfigurationPath={fleetConfigurationPath} />;
}
function GeoLocationContent({ fleetConfigurationPath }: { fleetConfigurationPath?: string }) {
    const owner = usePrivateOperator(), location = useLocation(), id = useId();
    const [state, setState] = useState<GeoLocationState | null>(null), [draft, setDraft] = useState<GeoDraft | null>(null);
    const [tab, setTab] = useState(0), [keyMode, setKeyMode] = useState<GeoKeyEdit['mode']>('untouched'), [keyChanged, setKeyChanged] = useState(false);
    const [verdict, setVerdict] = useState<GeoVerdict | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(true);
    const input = useRef<HTMLInputElement>(null), tabButtons = useRef<(HTMLButtonElement | null)[]>([]), flight = useRef(false), generation = useRef(0), draftEpoch = useRef(0);
    const keyRef = useCallback((node: HTMLInputElement | null) => {
        if (input.current && input.current !== node) input.current.value = '';
        input.current = node;
    }, []);
    const clearKey = () => { if (input.current) input.current.value = ''; setKeyMode('untouched'); setKeyChanged(false); };
    const invalidate = () => { draftEpoch.current++; setVerdict(null); setNotice(''); };
    useEffect(() => () => { generation.current++; draftEpoch.current++; if (input.current) input.current.value = ''; }, [owner.key]);
    const failure = async (reason: unknown, forceBlock = false) => {
        const safe = reason instanceof GeoLocationError ? reason : new GeoLocationError(reason instanceof OperatorError && reason.kind === 'denied' ? 'denied' : 'unavailable');
        setError(safe.message);
        if (forceBlock || ['invalid', 'unsupported', 'denied', 'fresh', 'conflict', 'uncertain', 'unavailable'].includes(safe.kind)) setBlocked(true);
        if (safe.kind === 'fresh' || safe.kind === 'denied') { clearKey(); invalidate(); }
        if (safe.kind === 'fresh') await requestFreshAuth();
    };
    const refresh = async () => {
        if (flight.current || !owner.allowed) return;
        const fence = owner.fence(), run = ++generation.current;
        invalidate(); clearKey(); setLoading(true); setBlocked(true); setError('');
        try {
            const next = await readGeoLocation(fence); fence.beforeSend();
            if (run !== generation.current) return;
            setState(next); setDraft(mojoverifyDraft(next.geoip)); setBlocked(false);
        } catch (reason) { if (!fence.signal?.aborted && run === generation.current) await failure(reason, true); }
        finally { if (!fence.signal?.aborted && run === generation.current) setLoading(false); }
    };
    useEffect(() => { void refresh(); }, [owner.key]);
    const dirty = !!state && !!draft && (JSON.stringify(draft) !== JSON.stringify(mojoverifyDraft(state.geoip)) || keyMode === 'clear' || keyChanged);
    const change = <K extends keyof GeoDraft>(key: K, value: GeoDraft[K]) => { invalidate(); setDraft(old => old ? { ...old, [key]: value } : old); };
    const discard = () => { invalidate(); clearKey(); if (state) setDraft(mojoverifyDraft(state.geoip)); setError(''); };
    const requestRefresh = async () => {
        if (flight.current || loading) return;
        if (dirty) {
            flight.current = true; setBusy(true); const fence = owner.fence(); let confirmed = false;
            try {
                confirmed = await modal.open<boolean>(close => <div className="modal-pad"><h2 className="modal-title">Discard unsaved changes?</h2><p className="modal-message">Refreshing replaces this draft and clears any entered API key.</p><div className="modal-actions"><button className="btn" onClick={() => close(false)}>Keep editing</button><button className="btn btn-danger" onClick={() => close(true)}>Discard and refresh</button></div></div>, { size: 'md', signal: fence.signal }) === true;
                fence.beforeSend();
            } catch (reason) { if (!fence.signal?.aborted) await failure(reason); }
            finally { flight.current = false; if (!fence.signal?.aborted) setBusy(false); }
            if (!confirmed || fence.signal?.aborted) return;
        }
        await refresh();
    };
    const chooseKeyMode = async (mode: GeoKeyEdit['mode']) => {
        if (flight.current || loading || blocked || !state) return;
        if (mode === 'clear') {
            flight.current = true; setBusy(true); const fence = owner.fence();
            try {
                const confirmed = await modal.open<boolean>(close => <div className="modal-pad"><h2 className="modal-title">Remove the stored MojoVerify key?</h2><p className="modal-message">Saving will remove the key. MojoVerify lookups and threat-signal sharing may stop. This does not revoke the key at the service.</p><div className="modal-actions"><button className="btn" onClick={() => close(false)}>Cancel</button><button className="btn btn-danger" onClick={() => close(true)}>Confirm key removal</button></div></div>, { size: 'md', signal: fence.signal });
                fence.beforeSend(); if (confirmed) { invalidate(); clearKey(); setKeyMode('clear'); }
            } catch (reason) { if (!fence.signal?.aborted) await failure(reason); }
            finally { flight.current = false; if (!fence.signal?.aborted) setBusy(false); }
        } else { invalidate(); clearKey(); setKeyMode(mode); }
    };
    const run = async (action: 'test' | 'save') => {
        if (flight.current || !owner.allowed || blocked || loading || !state || !draft || (action === 'save' ? !dirty || geoWriteBlock(state) : geoTestBlock(state) || keyMode === 'clear')) return;
        flight.current = true; setBusy(true); setError(''); setNotice('');
        const fence = owner.fence(), epoch = draftEpoch.current, runGeneration = generation.current, base = state;
        const saving = action === 'save';
        try {
            fence.beforeSend();
            const edit: GeoKeyEdit = keyMode === 'replace' ? { mode: 'replace', value: input.current?.value ?? '' } : keyMode === 'clear' ? { mode: 'clear', confirmed: true } : { mode: 'untouched' };
            if (action === 'test') {
                const next = await testGeoLocation(base.configuration_revision, draft, edit, fence); fence.beforeSend();
                if (epoch !== draftEpoch.current || runGeneration !== generation.current) return;
                setVerdict(next);
                try {
                    const observed = await readGeoLocation(fence); fence.beforeSend();
                    if (epoch !== draftEpoch.current || runGeneration !== generation.current) return;
                    // Refresh observations/prerequisites without rebasing a changed revision or the draft.
                    if (observed.configuration_revision !== base.configuration_revision || geoTestBlock(observed)) {
                        setBlocked(true); setError('Authoritative configuration changed or became unavailable. Refresh and review before continuing.');
                    } else setState(observed);
                } catch (reason) { if (!fence.signal?.aborted) await failure(reason, true); }
            } else {
                clearKey();
                const result = await saveGeoLocation(base.configuration_revision, draft, edit, fence); fence.beforeSend();
                if (epoch !== draftEpoch.current || runGeneration !== generation.current) return;
                invalidate(); setBlocked(true);
                setNotice(result.published ? 'Saved and published. Apply the pending configuration in Fleet Configuration.' : 'Saved. Published provider values were unchanged; the stored credential may have changed.');
                const authoritative = await readGeoLocation(fence); fence.beforeSend();
                if (runGeneration !== generation.current) return;
                setState(authoritative); setDraft(mojoverifyDraft(authoritative.geoip)); setBlocked(false);
            }
        } catch (reason) {
            if (!fence.signal?.aborted && runGeneration === generation.current) {
                if (saving) clearKey();
                await failure(reason, saving && !(reason instanceof GeoLocationError && reason.kind === 'validation'));
            }
        } finally { flight.current = false; if (!fence.signal?.aborted && runGeneration === generation.current) setBusy(false); }
    };
    const block = state ? geoWriteBlock(state) : null, diagnosticBlock = state ? geoTestBlock(state) : null;
    const disabled = busy || loading || blocked, options = state && draft ? geoProviderOptions(state, draft) : [];
    const additionalOptions = draft ? options.filter(p => p !== draft.GEOIP_PRIMARY_PROVIDER && p !== draft.GEOIP_FALLBACK_PROVIDER && !draft.GEOIP_ADDITIONAL_PROVIDERS.includes(p)) : [];
    const meta = (key: keyof GeoDraft) => state?.fleet_fields.find(f => f.key === key);
    const help = (label: string, content: ReactNode) => <GeoHelp label={label}>{content}</GeoHelp>;
    const providerSelect = (key: 'GEOIP_PRIMARY_PROVIDER' | 'GEOIP_FALLBACK_PROVIDER', label: string) => <label className="field"><span className="field-label">{label} {help(label, <>{meta(key)?.description} Each provider is queried only once at runtime, even if it appears in more than one position. Other provider credentials are managed in deployment settings.</>)}</span><select className="input" aria-label={label} value={draft?.[key] ?? ''} onChange={e => change(key, e.target.value)}>{options.map(p => <option key={p} value={p}>{geoProviderLabel(p)}{state?.geoip_providers.includes(p) ? '' : ' (configured; unavailable)'}</option>)}</select></label>;
    const move = (index: number, offset: number) => { if (!draft) return; const next = [...draft.GEOIP_ADDITIONAL_PROVIDERS], target = index + offset; [next[index], next[target]] = [next[target]!, next[index]!]; change('GEOIP_ADDITIONAL_PROVIDERS', next); };
    const tabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : event.key === 'ArrowRight' ? (index + 1) % 2 : event.key === 'ArrowLeft' ? (index + 1) % 2 : null;
        if (next !== null) { event.preventDefault(); setTab(next); tabButtons.current[next]?.focus(); }
    };
    const stored = state?.verify_state.geoip, storedDate = stored?.at && Number.isFinite(Date.parse(stored.at)) ? new Date(stored.at) : null;
    const details = () => {
        if (!state) return;
        void modal.open(close => <div className="modal-pad geo-admin-dialog"><h2 className="modal-title">Configuration information</h2><dl>{[['Published revision', state.published_revision ?? 'Not published'], ['This request node loaded', state.loaded_revision ?? 'Not reported'], ['Configuration revision', state.configuration_revision ?? 'Not published'], ['Published version', state.published_version ?? 'Not reported'], ['Remote configuration', state.remote_error ?? 'No read error reported']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd><code>{value}</code></dd></div>)}</dl><p className="dim">A key check does not prove that the provider chain or every Fleet node is healthy. Stored checks are historical observations, separate from this draft.</p>{stored && <p>{stored.message}{stored.code && <> · <code>{stored.code}</code></>}</p>}<div className="modal-actions"><button className="btn" onClick={() => close(undefined)}>Close</button></div></div>, { size: 'md', signal: owner.fence().signal });
    };
    return <div className="page geo-admin"><header className="page-header"><div><div className="eyebrow">Operations</div><h1>GeoLocation</h1><p className="dim">Set up your IP location providers.</p></div><button className="btn" disabled={busy || loading} onClick={() => void requestRefresh()}>Refresh</button></header>
        {loading && <p role="status">Loading GeoLocation configuration…</p>}
        {error && <p className="form-alert" role="alert">{error}</p>}{notice && <p className="geo-admin-notice" role="status">{notice}</p>}
        {block && <div className="geo-admin-notice" role="alert"><strong>Publishing unavailable</strong><p>{block}</p><span>You can review a local draft{!diagnosticBlock && ' and test the MojoVerify key'}.</span></div>}
        {state && draft && <><section className="panel geo-admin-setup" aria-label="GeoLocation provider setup">
            <div className="geo-admin-tabs" role="tablist" aria-label="GeoLocation settings">{tabs.map((label, index) => <button key={label} ref={el => { tabButtons.current[index] = el; }} id={`${id}-tab-${index}`} role="tab" aria-selected={tab === index} aria-controls={`${id}-panel-${index}`} tabIndex={tab === index ? 0 : -1} onClick={() => setTab(index)} onKeyDown={e => tabKey(e, index)}>{label}</button>)}</div>
            <div role="tabpanel" id={`${id}-panel-0`} aria-labelledby={`${id}-tab-0`} hidden={tab !== 0} tabIndex={0} className="geo-admin-tabpanel"><fieldset disabled={disabled} className="geo-admin-fields">
                {providerSelect('GEOIP_PRIMARY_PROVIDER', 'Primary provider')}
                <div className="geo-admin-key"><div className="geo-admin-key-heading"><span className="field-label">MojoVerify API key</span>{help('MojoVerify API key', 'Write only. Tests check only MojoVerify. Saving also checks MojoVerify, even when another provider is primary, unless you explicitly remove its key. Other provider credentials are managed in deployment settings.')}</div>
                    <p className="dim">{state.geoip.GEOIP_API_KEY_MOJO_CONFIGURED ? <>Key set{state.geoip.GEOIP_API_KEY_MOJO_HINT && <> · <span aria-label="Stored key suffix">••••{state.geoip.GEOIP_API_KEY_MOJO_HINT}</span></>}</> : 'No stored key'}</p>
                    <div className="geo-admin-actions"><button className="btn" aria-pressed={keyMode === 'replace'} onClick={() => void chooseKeyMode('replace')}>{state.geoip.GEOIP_API_KEY_MOJO_CONFIGURED ? 'Replace key' : 'Add key'}</button>{state.geoip.GEOIP_API_KEY_MOJO_CONFIGURED && <button className="btn" onClick={() => void chooseKeyMode('clear')}>Remove key</button>}<button className="btn" disabled={disabled || !!diagnosticBlock || keyMode === 'clear'} onClick={() => void run('test')}>Test key</button>{keyMode !== 'untouched' && <button className="btn" onClick={() => void chooseKeyMode('untouched')}>Cancel key change</button>}</div>
                    {/* Retained across tabs; the raw value lives only in this uncontrolled DOM input. */}
                    <label className="field" hidden={keyMode !== 'replace'}><span className="field-label">{state.geoip.GEOIP_API_KEY_MOJO_CONFIGURED ? 'Replacement key' : 'New key'}</span><input className="input" ref={keyRef} type="password" aria-label="MojoVerify API key" autoComplete="new-password" spellCheck={false} maxLength={4096} onChange={event => { invalidate(); setKeyChanged(event.currentTarget.value !== ''); }} /><span className="field-help">Leave blank to keep the stored key.</span></label>
                    {keyMode === 'clear' && <p className="text-warn">Save changes to remove the stored key. Key removal is not a connection test.</p>}
                    {draft.GEOIP_MOJO_PROVIDER_URL.replace(/\/$/, '') !== state.geoip.GEOIP_MOJO_PROVIDER_URL.replace(/\/$/, '') && <p className="text-warn">Switching to MojoVerify requires a replacement key. The stored key will not be sent to a different service.</p>}
                </div>
                <div className="geo-admin-sharing"><label><input type="checkbox" checked={draft.GEOIP_MOJO_SYNC_ENABLED} onChange={e => change('GEOIP_MOJO_SYNC_ENABLED', e.target.checked)} /> Share threat signals with MojoVerify</label>{help('threat-signal sharing', <>{meta('GEOIP_MOJO_SYNC_ENABLED')?.description} The remote key needs the geoip_sync permission. Sharing uses MojoVerify regardless of the primary provider.</>)}</div>
            </fieldset></div>
            <div role="tabpanel" id={`${id}-panel-1`} aria-labelledby={`${id}-tab-1`} hidden={tab !== 1} tabIndex={0} className="geo-admin-tabpanel"><fieldset disabled={disabled} className="geo-admin-fields">
                {providerSelect('GEOIP_FALLBACK_PROVIDER', 'Fallback provider')}
                <div className="field"><span className="field-label">Additional providers {help('additional providers', <>{meta('GEOIP_ADDITIONAL_PROVIDERS')?.description} Tried in the order shown after the primary and fallback providers. Other provider credentials are managed in deployment settings.</>)}</span>
                    <ol className="geo-admin-provider-list">{draft.GEOIP_ADDITIONAL_PROVIDERS.map((provider, index) => <li key={provider}><span><span className="dim">{index + 1}.</span> {geoProviderLabel(provider)}{!state.geoip_providers.includes(provider) && <small className="dim"> Configured; unavailable</small>}</span><div className="geo-admin-actions"><button className="btn" aria-label={`Move ${geoProviderLabel(provider)} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}>↑</button><button className="btn" aria-label={`Move ${geoProviderLabel(provider)} down`} disabled={disabled || index === draft.GEOIP_ADDITIONAL_PROVIDERS.length - 1} onClick={() => move(index, 1)}>↓</button><button className="btn" aria-label={`Remove ${geoProviderLabel(provider)}`} onClick={() => change('GEOIP_ADDITIONAL_PROVIDERS', draft.GEOIP_ADDITIONAL_PROVIDERS.filter(p => p !== provider))}>Remove</button></div></li>)}</ol>
                    {!draft.GEOIP_ADDITIONAL_PROVIDERS.length && <p className="field-help">No additional providers.</p>}
                    <select className="input" aria-label="Add provider" value="" disabled={disabled || !additionalOptions.length || draft.GEOIP_ADDITIONAL_PROVIDERS.length >= 16} onChange={e => { if (e.target.value) change('GEOIP_ADDITIONAL_PROVIDERS', [...draft.GEOIP_ADDITIONAL_PROVIDERS, e.target.value]); }}><option value="">{additionalOptions.length ? 'Add provider…' : 'All providers added'}</option>{additionalOptions.map(p => <option value={p} key={p}>{geoProviderLabel(p)}</option>)}</select>
                </div>
            </fieldset></div>
            {options.some(p => !state.geoip_providers.includes(p)) && <p className="geo-admin-context dim">Unavailable provider IDs are retained from your configuration. They cannot be verified against the current registry; review them before saving.</p>}
            {draft.GEOIP_PRIMARY_PROVIDER !== 'mojo' && !state.geoip.GEOIP_API_KEY_MOJO_CONFIGURED && !keyChanged && keyMode !== 'clear' && <p className="geo-admin-context text-warn">Saving also checks MojoVerify. Add its key in Provider before saving, or the backend may reject this change.</p>}
            {verdict && <div className={`geo-admin-result ${verdict.success && verdict.code !== 'clear_requested' ? 'text-ok' : 'text-warn'}`} role="status" aria-label="Draft MojoVerify key test"><strong>{verdict.success && verdict.code !== 'clear_requested' ? 'Draft MojoVerify key verified' : 'Draft MojoVerify key not verified'}</strong><p>{verdict.message}</p>{verdict.code && <code>{verdict.code}</code>}{!verdict.success && <p>Supply a replacement key, or apply pending configuration in Fleet Configuration and refresh here.</p>}</div>}
            <footer className="geo-admin-footer"><span className="dim" role="status">{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span><div className="geo-admin-actions"><button className="btn" disabled={busy || loading || !dirty} onClick={discard}>Discard changes</button><button className="btn btn-primary" disabled={disabled || !!block || !dirty} onClick={() => void run('save')}>{busy ? 'Working…' : 'Save changes'}</button></div></footer>
        </section>
        <section className="panel geo-admin-status" aria-label="Stored configuration status"><div className="geo-admin-status-heading"><div className="geo-admin-key-heading"><h2>Last stored check</h2>{help('last stored check', 'This historical MojoVerify result is separate from your current draft and Fleet activation. A successful key check does not prove the provider chain or every node is healthy.')}</div><button className="btn" onClick={details}>Configuration information</button></div><p><strong>MojoVerify:</strong> {stored ? stored.ok && stored.code !== 'clear_requested' ? 'Verified' : stored.code === 'clear_requested' ? 'Key removal requested; not tested' : 'Failed' : 'Not checked'}{storedDate && <> · <time dateTime={storedDate.toISOString()}>{storedDate.toLocaleString()}</time></>}</p>{(blocked || loading) && <p className="text-warn">Earlier observations are not current confirmation. Refresh to check the configuration.</p>}<div className="geo-admin-activation">{state.pending_restart ? <span className="text-warn">Activation pending on this request node.</span> : <span className="dim">Review application and node health in Fleet.</span>}<Link to={fleetConfigurationPath ?? geoFleetRoute(location.pathname)}>Open Fleet Configuration</Link></div></section></>}
    </div>;
}
