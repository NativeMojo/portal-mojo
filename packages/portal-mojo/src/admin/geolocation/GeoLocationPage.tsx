import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { requestFreshAuth, useMe } from '../../client/runtime';
import { modal } from '../../ui';
import { OperationsHelp } from '../core/OperationsHelp';
import { usePrivateOperator } from '../fleet-configuration/shared-validation-data';
import { GeoLocationError, geoDraft, geoFleetRoute, geoProviderOptions, geoWriteBlock, readGeoLocation, saveGeoLocation, testGeoLocation, type GeoDraft, type GeoKeyEdit, type GeoLocationState, type GeoVerdict } from './data';

export function GeoLocationPage() {
    const owner = usePrivateOperator(), { data: me } = useMe();
    if (me?.is_superuser !== true || !owner.allowed) return <div className="panel panel-pad"><h1>GeoLocation</h1><p>GeoLocation requires a superuser account with an interactive session.</p></div>;
    return <GeoLocationContent key={owner.key} />;
}
function GeoLocationContent() {
    const owner = usePrivateOperator(), location = useLocation();
    const [state, setState] = useState<GeoLocationState | null>(null), [draft, setDraft] = useState<GeoDraft | null>(null);
    const [keyMode, setKeyMode] = useState<GeoKeyEdit['mode']>('untouched');
    const [verdict, setVerdict] = useState<GeoVerdict | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(true);
    const input = useRef<HTMLInputElement>(null), flight = useRef(false), generation = useRef(0), draftEpoch = useRef(0);
    const clearKey = () => { if (input.current) input.current.value = ''; setKeyMode('untouched'); };
    const invalidate = () => { draftEpoch.current++; setVerdict(null); setNotice(''); };
    useEffect(() => () => { generation.current++; draftEpoch.current++; if (input.current) input.current.value = ''; }, [owner.key]);
    const failure = async (reason: unknown, forceBlock = false) => {
        const safe = reason instanceof GeoLocationError ? reason : new GeoLocationError('unavailable');
        setError(safe.message);
        if (forceBlock || ['invalid', 'unsupported', 'denied', 'fresh', 'conflict', 'uncertain', 'unavailable'].includes(safe.kind)) setBlocked(true);
        if (safe.kind === 'fresh') { clearKey(); invalidate(); await requestFreshAuth(); }
    };
    const refresh = async () => {
        if (flight.current || !owner.allowed) return;
        const fence = owner.fence(), run = ++generation.current;
        invalidate(); clearKey(); setLoading(true); setBlocked(true); setError('');
        try {
            const next = await readGeoLocation(fence); fence.beforeSend();
            if (run !== generation.current) return;
            setState(next); setDraft(geoDraft(next.geoip)); setBlocked(false);
        } catch (reason) { if (!fence.signal?.aborted && run === generation.current) await failure(reason, true); }
        finally { if (!fence.signal?.aborted && run === generation.current) setLoading(false); }
    };
    useEffect(() => { void refresh(); }, [owner.key]);
    const change = <K extends keyof GeoDraft>(key: K, value: GeoDraft[K]) => { invalidate(); setDraft(old => old ? { ...old, [key]: value } : old); };
    const cancel = () => { invalidate(); clearKey(); if (state) setDraft(geoDraft(state.geoip)); setError(''); };
    const chooseKeyMode = async (mode: GeoKeyEdit['mode']) => {
        if (flight.current || loading || blocked || !state || geoWriteBlock(state)) return;
        invalidate();
        if (mode === 'clear') {
            flight.current = true; setBusy(true); const fence = owner.fence();
            try {
                const confirmed = await modal.open<boolean>((close) => <div className="modal-pad"><h2 className="modal-title">Remove the stored Mojo key?</h2><p className="modal-message">The key will be removed when you Save. Mojo lookups and threat-signal sharing may stop. This does not revoke the key at the remote service.</p><div className="modal-actions"><button className="btn" onClick={() => close(false)}>Cancel</button><button className="btn btn-danger" onClick={() => close(true)}>Confirm key removal</button></div></div>, { size: 'md', signal: fence.signal });
                fence.beforeSend(); clearKey(); if (confirmed) setKeyMode('clear');
            } catch (reason) { if (!fence.signal?.aborted) await failure(reason); }
            finally { flight.current = false; if (!fence.signal?.aborted) setBusy(false); }
        } else { clearKey(); setKeyMode(mode); }
    };
    const run = async (action: 'test' | 'save') => {
        if (flight.current || !owner.allowed || blocked || loading || !state || !draft || geoWriteBlock(state) || action === 'test' && keyMode === 'clear') return;
        flight.current = true; setBusy(true); setError(''); setNotice('');
        const fence = owner.fence(), epoch = draftEpoch.current, runGeneration = generation.current, base = state;
        let saving = false;
        try {
            fence.beforeSend();
            const edit: GeoKeyEdit = keyMode === 'replace' ? { mode: 'replace', value: input.current?.value ?? '' } : keyMode === 'clear' ? { mode: 'clear', confirmed: true } : { mode: 'untouched' };
            if (action === 'test') {
                const next = await testGeoLocation(base.configuration_revision, draft, edit, fence); fence.beforeSend();
                if (epoch !== draftEpoch.current || runGeneration !== generation.current) return;
                // Stored observations may change even when provider ordering differs. Never rebase the draft/token here.
                setVerdict(next);
                try {
                    const observed = await readGeoLocation(fence); fence.beforeSend();
                    if (epoch !== draftEpoch.current || runGeneration !== generation.current) return;
                    setState(old => old ? { ...old, verify_state: observed.verify_state } : old);
                    if (observed.configuration_revision !== base.configuration_revision || geoWriteBlock(observed)) {
                        setBlocked(true); setError('Authoritative configuration changed or became unavailable. Refresh and review before saving.');
                    }
                } catch (reason) { if (!fence.signal?.aborted) await failure(reason, true); }
            } else {
                saving = true;
                const result = await saveGeoLocation(base.configuration_revision, draft, edit, fence); fence.beforeSend();
                if (epoch !== draftEpoch.current || runGeneration !== generation.current) return;
                clearKey(); invalidate(); setBlocked(true);
                setNotice(result.published ? 'Saved and published. A config-sync restart is pending; check application in Fleet Configuration.' : 'Saved. The published provider values were unchanged; the database credential may have changed.');
                const authoritative = await readGeoLocation(fence); fence.beforeSend();
                if (runGeneration !== generation.current) return;
                setState(authoritative); setDraft(geoDraft(authoritative.geoip)); setBlocked(false);
            }
        } catch (reason) {
            if (!fence.signal?.aborted && runGeneration === generation.current) {
                if (saving) clearKey();
                await failure(reason, saving && !(reason instanceof GeoLocationError && reason.kind === 'validation'));
            }
        } finally { flight.current = false; if (!fence.signal?.aborted && runGeneration === generation.current) setBusy(false); }
    };
    const block = state ? geoWriteBlock(state) : null;
    const disabled = busy || loading || blocked || !!block;
    const options = state && draft ? geoProviderOptions(state, draft) : [];
    const meta = (key: keyof GeoDraft) => state?.fleet_fields.find(f => f.key === key);
    const field = (key: keyof GeoDraft, control: ReactNode) => <div className="field"><span className="field-label">{meta(key)?.label ?? key} <OperationsHelp label={meta(key)?.label ?? key}>{meta(key)?.description}{meta(key)?.constraints ? ` ${meta(key)?.constraints}.` : ''}</OperationsHelp></span>{control}</div>;
    const providerSelect = (key: 'GEOIP_PRIMARY_PROVIDER' | 'GEOIP_FALLBACK_PROVIDER') => <select className="input" aria-label={meta(key)?.label ?? key} value={draft?.[key] ?? ''} onChange={e => change(key, e.target.value)}>{options.map(p => <option key={p} value={p}>{p}{state?.geoip_providers.includes(p) ? '' : ' (configured; not in registry)'}</option>)}</select>;
    const move = (index: number, offset: number) => { if (!draft) return; const next = [...draft.GEOIP_ADDITIONAL_PROVIDERS], target = index + offset; [next[index], next[target]] = [next[target]!, next[index]!]; change('GEOIP_ADDITIONAL_PROVIDERS', next); };
    const stored = state?.verify_state.geoip;
    return <div className="page geo-admin"><header className="page-header"><div><div className="eyebrow">Operations</div><h1>GeoLocation</h1><p className="dim">Set up your IP location provider.</p></div><button className="btn" disabled={busy || loading} onClick={() => void refresh()}>Refresh</button></header>
        {loading && <p role="status">Loading GeoLocation configuration…</p>}
        {error && <p className="form-alert" role="alert">{error}</p>}{notice && <p className="geo-admin-notice" role="status">{notice}</p>}
        {block && <div className="panel panel-pad" role="alert"><h2>Provider setup unavailable</h2><p>{block}</p></div>}
        {state && draft && <><section className="panel panel-pad geo-admin-setup" aria-label="GeoLocation provider setup"><h2>Provider setup</h2>
            <fieldset disabled={disabled} className="geo-admin-fields">
                {field('GEOIP_PRIMARY_PROVIDER', providerSelect('GEOIP_PRIMARY_PROVIDER'))}
                {field('GEOIP_MOJO_PROVIDER_URL', <input className="input" aria-label={meta('GEOIP_MOJO_PROVIDER_URL')?.label ?? 'Mojo origin'} type="url" maxLength={512} value={draft.GEOIP_MOJO_PROVIDER_URL} autoComplete="off" onChange={e => change('GEOIP_MOJO_PROVIDER_URL', e.target.value)} />)}
                <div className="geo-admin-key"><div className="field-label">Mojo API key</div><p>{state.geoip.GEOIP_API_KEY_MOJO_CONFIGURED ? <>Key set{state.geoip.GEOIP_API_KEY_MOJO_HINT && <> · <span aria-label="Stored key suffix">••••{state.geoip.GEOIP_API_KEY_MOJO_HINT}</span></>}</> : 'No stored Mojo key'}</p>
                    <div className="geo-admin-actions"><button className="btn" aria-pressed={keyMode === 'replace'} onClick={() => void chooseKeyMode('replace')}>Replace key</button><button className="btn" onClick={() => void chooseKeyMode('clear')}>Remove key</button>{keyMode !== 'untouched' && <button className="btn" onClick={() => void chooseKeyMode('untouched')}>Keep stored key</button>}</div>
                    {/* Keep the password DOM local; never mirror its value into React state. */}
                    <label className="field" hidden={keyMode !== 'replace'}><span className="field-label">Replacement Mojo API key</span><input className="input" ref={input} type="password" aria-label="Replacement Mojo API key" autoComplete="new-password" spellCheck={false} maxLength={4096} onChange={invalidate} /><span className="field-help">Write only. Leave blank to preserve the stored key.</span></label>
                    {keyMode === 'clear' && <p className="text-warn">Key removal confirmed. Save removes the stored key. This is not a connection test.</p>}
                    {draft.GEOIP_MOJO_PROVIDER_URL.replace(/\/$/, '') !== state.geoip.GEOIP_MOJO_PROVIDER_URL.replace(/\/$/, '') && <p className="text-warn">Changing the Mojo origin requires a replacement key. The stored key is never sent to a different origin.</p>}
                </div>
                <details className="geo-admin-advanced"><summary>Advanced</summary><div className="geo-admin-fields">
                    {field('GEOIP_FALLBACK_PROVIDER', providerSelect('GEOIP_FALLBACK_PROVIDER'))}
                    <div className="field"><span className="field-label">{meta('GEOIP_ADDITIONAL_PROVIDERS')?.label ?? 'Additional providers'}</span><p className="field-help">{meta('GEOIP_ADDITIONAL_PROVIDERS')?.description} {meta('GEOIP_ADDITIONAL_PROVIDERS')?.constraints}. Order is preserved.</p>
                        <ol className="geo-admin-provider-list">{draft.GEOIP_ADDITIONAL_PROVIDERS.map((provider, index) => <li key={provider}><span>{provider}</span><div className="geo-admin-actions"><button className="btn" aria-label={`Move ${provider} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}>↑</button><button className="btn" aria-label={`Move ${provider} down`} disabled={disabled || index === draft.GEOIP_ADDITIONAL_PROVIDERS.length - 1} onClick={() => move(index, 1)}>↓</button><button className="btn" aria-label={`Remove ${provider}`} onClick={() => change('GEOIP_ADDITIONAL_PROVIDERS', draft.GEOIP_ADDITIONAL_PROVIDERS.filter(p => p !== provider))}>Remove</button></div></li>)}</ol>
                        {!draft.GEOIP_ADDITIONAL_PROVIDERS.length && <p className="dim">No additional providers.</p>}
                        <label className="field"><span className="field-label">Add provider</span><select className="input" aria-label="Add provider" value="" disabled={disabled || draft.GEOIP_ADDITIONAL_PROVIDERS.length >= 16} onChange={e => { if (e.target.value) change('GEOIP_ADDITIONAL_PROVIDERS', [...draft.GEOIP_ADDITIONAL_PROVIDERS, e.target.value]); }}><option value="">Choose a provider</option>{options.filter(p => !draft.GEOIP_ADDITIONAL_PROVIDERS.includes(p)).map(p => <option value={p} key={p}>{p}</option>)}</select></label>
                    </div>
                    <label className="field"><span><input type="checkbox" checked={draft.GEOIP_MOJO_SYNC_ENABLED} onChange={e => change('GEOIP_MOJO_SYNC_ENABLED', e.target.checked)} /> Share threat signals with Mojo</span><span className="field-help">{meta('GEOIP_MOJO_SYNC_ENABLED')?.description} The remote key must have the geoip_sync permission.</span></label>
                </div></details>
                <div className="geo-admin-actions"><button className="btn" disabled={disabled || keyMode === 'clear'} onClick={() => void run('test')}>Test Mojo connection</button><OperationsHelp label="connection test">Test checks only the Mojo credential, even when another provider is primary. It does not publish or prove the provider chain works.</OperationsHelp><button className="btn btn-primary" onClick={() => void run('save')}>{busy ? 'Working…' : 'Save'}</button><button className="btn" onClick={cancel}>Cancel changes</button></div>
            </fieldset>
            {verdict && <div className={verdict.success && verdict.code !== 'clear_requested' ? 'text-ok' : 'text-warn'} role="status" aria-label="Draft Mojo connection test"><strong>{verdict.success && verdict.code !== 'clear_requested' ? 'Draft Mojo connection verified' : 'Draft Mojo connection not verified'}</strong><p>{verdict.message}</p>{verdict.code && <code>{verdict.code}</code>}{!verdict.success && <p>A published Mojo origin may still be pending on this request node. Supply a replacement key, or apply the published configuration in Fleet Configuration and Refresh here.</p>}</div>}
        </section>
        <section className="panel panel-pad geo-admin-status" aria-label="Stored configuration status"><h2>Connection status</h2>{(blocked || loading) && <p className="text-warn">Earlier stored observations are not current confirmation. Refresh to check the configuration.</p>}<p className="geo-admin-verification"><strong>Stored Mojo connection verification:</strong> {stored ? stored.ok && stored.code !== 'clear_requested' ? 'Verified' : stored.code === 'clear_requested' ? 'Key removal requested; not a connection test' : 'Failed' : 'Not observed'}</p>
            <details className="geo-admin-configuration"><summary>Configuration details</summary>{stored && <p>{stored.message}{stored.at && <> · {stored.at}</>}</p>}
            <p className="dim">Stored verification is separate from this draft. A test with no replacement uses the node-loaded Mojo origin and sharing setting to decide whether it updates this observation.</p>
            <dl><div><dt>Published revision</dt><dd><code>{state.published_revision ?? 'Not published'}</code></dd></div><div><dt>This request node loaded</dt><dd><code>{state.loaded_revision ?? 'Not reported'}</code></dd></div></dl>
            <p className="dim">No fleet health proof is established by a connection test.</p>
            <Link className="btn" to={geoFleetRoute(location.pathname)}>Open Fleet Configuration</Link><p className="dim">Use Fleet Configuration to apply published changes and inspect node health. GeoIP Cache remains the IP inspection workspace.</p></details>{state.pending_restart && <p className="text-warn">Published changes are pending a config-sync restart on this request node.</p>}
        </section></>}
    </div>;
}
