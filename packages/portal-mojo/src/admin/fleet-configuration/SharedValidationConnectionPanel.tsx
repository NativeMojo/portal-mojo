import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { requestFreshAuth } from '../../client/runtime';
import { FlatRow, fmt, modal } from '../../ui';
import { applyConnection, connectionAuthority, connectionOperationFinished as operationFinished, connectionVerified, enableHub, nodeVerified, OperatorError, previewConnection, publishConnection, readConnection, readConnectionHistory, readConnectionOperation, readHubStatus, usePrivateOperator, type ConnectionInput, type ConnectionOperation, type ConnectionState, type HubStatus, type Preview, type SafeHistory } from './shared-validation-data';
import { legacyDestination, readOperatorDestinations, type OperatorDestinations } from './operator-destinations';

const layout = { display: 'grid', gap: 16, minWidth: 0, overflowWrap: 'anywhere' as const };
export function SharedValidationConnectionPage() {
    const owner = usePrivateOperator();
    if (!owner.allowed) return <div className="panel panel-pad">Shared validation connection requires an interactive deployment operator.</div>;
    return <div className="page" style={layout}><header><div className="eyebrow">Operations · Fleet Configuration</div><h1>Shared validation</h1><p className="dim">Share DNS validation while each issuer keeps its own certificates and private keys.</p></header><SharedValidationConnectionPanel key={owner.key} /></div>;
}
export function SharedValidationConnectionPanel({ pollInterval = 3000, pollLimit = 120 }: { pollInterval?: number; pollLimit?: number }) {
    const owner = usePrivateOperator();
    return owner.allowed ? <ConnectionContent key={owner.key} pollInterval={pollInterval} pollLimit={pollLimit} /> : <p>Deployment operator access is unavailable.</p>;
}
function ConnectionContent({ pollInterval, pollLimit }: { pollInterval: number; pollLimit: number }) {
    const owner = usePrivateOperator();
    const [state, setState] = useState<ConnectionState | null>(null), [history, setHistory] = useState<SafeHistory | null>(null);
    const [destinations, setDestinations] = useState<OperatorDestinations | null>(null), [destinationError, setDestinationError] = useState('');
    const [profileId, setProfileId] = useState(''), [keyAction, setKeyAction] = useState<ConnectionInput['key_action']>('keep');
    const input = useRef<HTMLInputElement>(null), draft = useRef<ConnectionInput | null>(null);
    const [preview, setPreview] = useState<Preview | null>(null), [operation, setOperation] = useState<ConnectionOperation | null>(null);
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [blocked, setBlocked] = useState(true), [timedOut, setTimedOut] = useState(false);
    const flight = useRef(false), generation = useRef(0), ticks = useRef(0), previewEpoch = useRef(0), observationEpoch = useRef(0), authority = useRef<string | null>(null);
    const clearDraft = () => { previewEpoch.current++; draft.current = null; setPreview(null); if (input.current) input.current.value = ''; };
    useEffect(() => () => { draft.current = null; if (input.current) input.current.value = ''; }, [owner.key]);
    const failure = async (reason: unknown) => {
        const safe = reason instanceof OperatorError ? reason : new OperatorError('unavailable'); setError(safe.message); setBlocked(true); clearDraft();
        if (safe.kind === 'fresh') await requestFreshAuth();
    };
    const refresh = async (clear = true) => {
        if (!owner.allowed) return false;
        const fence = owner.fence(), run = ++generation.current, tracked = clear ? operation : null; if (clear) observationEpoch.current++; if (clear) clearDraft(); setLoading(true);
        try {
            const results = await Promise.allSettled([readConnection(fence), readConnectionHistory(fence), readOperatorDestinations(fence), tracked ? readConnectionOperation(tracked.operation_id, fence, tracked.revision) : Promise.resolve(null)]);
            fence.beforeSend(); if (generation.current !== run) return false;
            const main = results[0]; if (main.status === 'rejected') throw main.reason;
            if (tracked && results[3].status === 'rejected') throw results[3].reason;
            const nextAuthority = connectionAuthority(main.value);
            if (authority.current !== null && authority.current !== nextAuthority) { clearDraft(); setNotice('Configuration authority changed. Preview again before publication.'); }
            authority.current = nextAuthority;
            if (clear) { if (tracked) setOperation(main.value.revision === tracked.revision && results[3].status === 'fulfilled' ? results[3].value : null); ticks.current = 0; setTimedOut(false); }
            setState(main.value); setProfileId((old) => main.value.profiles.some((p) => p.id === old) ? old : main.value.selected_profile_id ?? main.value.profiles[0]?.id ?? '');
            setHistory(results[1].status === 'fulfilled' ? results[1].value : null);
            setDestinations(results[2].status === 'fulfilled' ? results[2].value : null);
            setDestinationError(results[2].status === 'rejected' ? 'Existing Admin destinations could not be verified. Refresh before opening them.' : '');
            setBlocked(false); setError(''); return true;
        } catch (reason) { if (!fence.signal?.aborted && generation.current === run) await failure(reason); return false; }
        finally { if (!fence.signal?.aborted && generation.current === run) setLoading(false); }
    };
    useEffect(() => { void refresh(); return () => { generation.current++; }; }, [owner.key]); // owner identity owns all state
    useEffect(() => {
        if (!operation || operationFinished(operation) || busy || loading || blocked || !owner.allowed || ticks.current >= pollLimit) return;
        const timer = setTimeout(() => {
            ticks.current++; const fence = owner.fence(), epoch = observationEpoch.current;
            void readConnectionOperation(operation.operation_id, fence, operation.revision).then(async (next) => {
                fence.beforeSend(); if (observationEpoch.current !== epoch) return; setOperation(next); await refresh(false); if (observationEpoch.current !== epoch) return; if (ticks.current >= pollLimit && !operationFinished(next)) setTimedOut(true);
            }).catch((reason) => { if (!fence.signal?.aborted && observationEpoch.current === epoch) void failure(reason); });
        }, pollInterval);
        return () => clearTimeout(timer);
    }, [operation, busy, loading, blocked, owner.key, pollInterval, pollLimit]);
    const selected = state?.profiles.find((p) => p.id === profileId);
    const change = () => { previewEpoch.current++; draft.current = null; setPreview(null); setNotice(''); };
    const run = async (action: 'preview' | 'publish' | 'apply') => {
        if (flight.current || !owner.allowed || !state?.available || blocked || loading) return;
        const fence = owner.fence(); const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null; const current = state; observationEpoch.current++; flight.current = true; setBusy(true); setError(''); setNotice(''); let attempted = false;
        try {
            fence.beforeSend();
            if (action === 'preview') {
                if (!current.catalog_revision || !selected) throw new OperatorError('invalid');
                const candidate: ConnectionInput = { expected_revision: current.revision, expected_catalog_revision: current.catalog_revision, profile_id: selected.id, key_action: keyAction, ...(keyAction === 'replace' ? { replacement_key: input.current?.value ?? '' } : {}) };
                const epoch = previewEpoch.current, expectedAuthority = authority.current;
                const result = await previewConnection(candidate, keyAction === 'clear' ? null : selected, fence); fence.beforeSend(); if (previewEpoch.current !== epoch || authority.current !== expectedAuthority) throw new OperatorError('conflict'); draft.current = candidate; setPreview(result);
                setNotice('Preview checked the candidate identity. Nothing was saved or applied.');
            } else {
                if (action === 'publish' && (!preview?.can_publish || !draft.current)) return;
                if (action === 'apply' && !current.revision) return;
                const frozen = draft.current;
                const confirmed = await modal.open<boolean>((close) => <div className="modal-pad"><h2 className="modal-title">{action === 'publish' ? 'Publish shared validation connection?' : 'Apply configuration to every expected node?'}</h2><div className="modal-message"><p>{action === 'publish' ? `Profile: ${preview?.profile_id ?? 'Disabled connection'}` : `Published revision: ${current.revision}`}</p><p>Expected project: {preview?.expected_identity?.consumer_label ?? current.expected_identity?.consumer_label ?? 'Disabled'} · <code>{preview?.expected_identity?.consumer_project_uuid ?? current.expected_identity?.consumer_project_uuid ?? '—'}</code></p><p>{action === 'publish' ? 'Publish the reviewed connection bundle. Config-sync may restart services; node activation must be verified separately. This does not grant allocation trust, retire a key or activate hub sharing.' : 'Ask every expected node to sync this exact revision. Application and worker processes may restart. Missing nodes remain unconfirmed; existing release holds are unchanged.'}</p>{action === 'publish' && keyAction === 'clear' && <p className="text-warn">Disable the whole connection and mask base credentials. This does not delete base keys or revoke remote trust. Existing identity rows can refuse this operation.</p>}</div><div className="modal-actions"><button className="btn" onClick={() => close(false)}>Cancel</button><button className="btn btn-primary" onClick={() => close(true)}>{action === 'publish' ? 'Publish connection' : 'Apply now'}</button></div></div>, { size: 'md', signal: fence.signal });
                if (!confirmed) return; fence.beforeSend();
                if (action === 'publish' && frozen !== draft.current) throw new OperatorError('conflict');
                attempted = true;
                if (action === 'publish') { await publishConnection(frozen!, fence); fence.beforeSend(); setOperation(null); setNotice('Published. Apply and verify every expected node separately. The old key is still active.'); }
                else { const result = await applyConnection(current.revision!, fence); fence.beforeSend(); setOperation(result); ticks.current = 0; setTimedOut(false); setNotice('Apply requested. Waiting for revision-bound process and identity proof.'); }
                clearDraft(); await refresh(false);
            }
        } catch (reason) {
            if (!fence.signal?.aborted) {
                if (attempted) { clearDraft(); await refresh(false); }
                await failure(reason);
            }
        } finally { if (!fence.signal?.aborted) { setBusy(false); requestAnimationFrame(() => { try { fence.beforeSend(); if (opener?.isConnected) opener.focus(); } catch { /* Former owner cannot regain focus. */ } }); } flight.current = false; }
    };
    if (!owner.allowed) return <p>Deployment operator access is no longer available.</p>;
    const report = operation?.revision === state?.revision ? operation : state?.fleet;
    const currentReport = !blocked && !loading;
    return <div className="shared-validation-operator" style={layout}>
        <HubSharing key={owner.key} />
        <section className="panel panel-pad" aria-label="Shared validation connection" style={layout}>
            <h2>Protected connection</h2>
            <p>Use a protected ACME consumer key issued for the original hub project. The approved profile fixes the hub origin and project identity.</p>
            <div><button className="btn" disabled={busy || loading} onClick={() => void refresh()}>Refresh connection status</button>{loading && <span role="status"> Checking current state…</span>}</div>
            {error && <p className="form-alert" role="alert">{error}{state && ' Earlier observations are not current confirmation.'}</p>}{notice && <p role="status">{notice}</p>}
            {state && <><FlatRow label="Published revision"><code>{state.revision ?? 'Not published'}</code></FlatRow><FlatRow label="This process loaded"><code>{state.loaded_revision ?? 'Not reported'}</code></FlatRow><FlatRow label="Credential">{state.credential.configured ? 'Configured (hidden)' : 'Not configured'} · {state.credential.source}</FlatRow><FlatRow label="Loaded identity">{state.loaded_identity?.state ?? 'Unavailable'} · <code>{state.loaded_identity?.observed_project_uuid ?? 'Not observed'}</code></FlatRow><FlatRow label="Identity checked">{state.loaded_identity?.checked_at ? fmt.datetime(state.loaded_identity.checked_at) : 'Not observed'}</FlatRow>
                {state.loaded_identity?.state === 'verified' && !state.loaded_identity.sharing_ready && <p className="dns-warning">The connection identity is verified. Enable sharing on the approved hub, then refresh this connection.</p>}
                {!state.available && <div className="dns-blocked"><strong>Connection setup unavailable</strong><ul>{state.unavailable_reasons.map((reason) => <li key={reason}>{reason.replaceAll('_', ' ')}</li>)}</ul><p>Use the permitted System Setup destination below to inspect publisher, schema, delegation and node enrollment. An empty profile catalog cannot be filled in this form.</p></div>}
                <fieldset disabled={busy || loading || blocked || !state.available} style={{ border: 0, padding: 0, ...layout }}>
                    <label className="field"><span className="field-label">Approved hub profile</span><select className="input" value={profileId} onChange={(e) => { change(); setProfileId(e.target.value); }}><option value="">Choose an approved profile</option>{state.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
                    {selected && <><FlatRow label="Approved hub"><code>{selected.origin}</code></FlatRow><FlatRow label="Expected original hub project">{selected.consumer_label} · <code>{selected.consumer_project_uuid}</code></FlatRow></>}
                    <label className="field"><span className="field-label">Protected key action</span><select className="input" value={keyAction} onChange={(e) => { change(); if (input.current) input.current.value = ''; setKeyAction(e.target.value as ConnectionInput['key_action']); }}><option value="keep">Keep current key</option><option value="replace">Replace key</option><option value="clear">Disable connection</option></select></label>
                    {keyAction === 'replace' && <label className="field"><span className="field-label">Replacement protected key</span><input className="input" type="password" ref={input} autoComplete="off" spellCheck={false} maxLength={4096} onChange={change} /><span className="field-help">Write only. Blank preserves the existing key. The value remains only in this mounted form until the attempt completes.</span></label>}
                    {keyAction === 'clear' && <p className="text-warn">Disable the whole bundle and mask base credentials; remote trust and base keys remain. Retained shared identities can make disabling ineligible.</p>}
                    <div><button className="btn" disabled={!selected} onClick={() => void run('preview')}>Preview connection</button></div>
                    {preview && <div className="dns-shared-request"><h3>Revision and identity preview</h3><FlatRow label="Current revision"><code>{preview.revision ?? 'Unpublished'}</code></FlatRow><FlatRow label="Observed project"><code>{preview.identity.observed_project_uuid ?? 'Disabled'}</code></FlatRow><FlatRow label="Identity">{preview.identity.state} · {preview.identity.checked_at ? fmt.datetime(preview.identity.checked_at) : 'Not applicable'}</FlatRow><p>{preview.identity.sharing_ready ? 'Hub reports sharing ready.' : 'Hub sharing activation is not established by this preview.'}</p><p>Credential changes: {preview.credential_changed ? 'Yes' : 'No'}. Apply and every-node verification remain separate. Retiring the old key is a later explicit action.</p><button className="btn btn-primary" disabled={!preview.can_publish} onClick={() => void run('publish')}>Review publication</button></div>}
                </fieldset>
                <div><button className="btn btn-primary" disabled={busy || loading || blocked || !state.available || !state.revision || !!operation && !operationFinished(operation)} onClick={() => void run('apply')}>Review apply to nodes</button></div>
            </>}
        </section>
        {state && report && <section className="panel panel-pad" aria-label="Every expected node" style={layout}><h2>Every expected node</h2><p role="status" className={currentReport && connectionVerified(state, report) ? 'text-ok' : 'text-warn'}>{currentReport && connectionVerified(state, report) ? 'Connection applied and verified on every expected node' : 'Not confirmed on every expected node'} · {report.status}</p><p className="dim">Combined proof covers the request service where enabled, job engine and scheduler at the target revision. Worker-only exemption is server-owned. Offline nodes stay in the denominator; a completed dispatch job is not process proof.</p>{!report.nodes.length && <p>No expected-node evidence is available.</p>}{report.nodes.map((node) => <article className="dns-shared-request" key={node.hostname}><h3>{node.hostname}</h3><FlatRow label="Revision"><code>{node.revision}</code></FlatRow><FlatRow label="Publication / installation">{node.published ? 'Published' : 'Unconfirmed'} · {node.installed ? 'Installed' : 'Not installed'}</FlatRow><FlatRow label="Restart">{node.restarted ? 'Reported restarted' : node.restart_requested ? 'Requested' : 'Unconfirmed'}</FlatRow><FlatRow label="Request + engine + scheduler proof">{currentReport && nodeVerified(node, report, state.revision, state.profiles.find((p) => p.id === state.selected_profile_id)) ? 'Confirmed at target revision and identity' : 'Unconfirmed'}</FlatRow><FlatRow label="Observed hub project"><code>{node.shared_validation?.observed_project_uuid ?? 'Unavailable'}</code></FlatRow><FlatRow label="Identity check">{node.shared_validation?.checked_at ? fmt.datetime(node.shared_validation.checked_at) : 'Unavailable'} · {node.shared_validation?.sharing_ready ? 'Sharing ready' : 'Sharing readiness not established'}</FlatRow><p>{node.error_code ?? node.status}</p></article>)}{timedOut && <p className="text-warn">Automatic observations reached their limit. Refresh explicitly for current status.</p>}</section>}
        <section className="panel panel-pad" style={layout}><h2>Existing deployment controls</h2><p>Update every expected node through the existing deployment controls before enabling sharing. Each control keeps its own confirmation and release permissions.</p>{destinationError && <p role="alert">{destinationError}</p>}{destinations?.external && <p>External infrastructure mode: existing controls retain their IaC restrictions.</p>}<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{(['setup', 'deployments', 'topology', 'capacity'] as const).map((kind) => { const href = destinations && legacyDestination(destinations, kind); return href ? <a key={kind} className="btn" href={href}>{({ setup: 'Open System Setup', deployments: 'Open Deployments and framework policy', topology: 'Open expected topology', capacity: 'Open Fleet Scaling' })[kind]}</a> : <span key={kind} className="dim">{kind}: destination unavailable</span>; })}</div></section>
        <section className="panel panel-pad" style={layout}><h2>Replace first, retire later</h2><p>On the approved hub, use Group API Keys → Create ACME consumer key for the exact original project. Enter the replacement here, Preview and Publish, then Apply and verify every expected node. Only then explicitly review/deactivate the old key in the hub inventory. No key is retired automatically.</p><p>Existing audited Token reveal can recover an issued key. In-place rotation invalidates the previous token immediately and is not this staged rollout.</p><Link className="btn" to="../../api-keys" relative="path">Open this deployment’s Group API Keys</Link><p className="dim">This local inventory is not a claim that this deployment is the approved hub or that it observed another deployment’s nodes.</p></section>
        <section className="panel panel-pad"><h2>Version history</h2>{history ? <>{history.versions.map((version) => <p key={version.version_id}><code>{version.version_id}</code> · {version.published_at ? fmt.datetime(version.published_at) : 'Time unavailable'}{version.current ? ' · current' : ''}</p>)}{history.truncated && <p>Only recent versions are shown.</p>}</> : <p>History unavailable. Use Refresh; secrets are never displayed here.</p>}</section>
    </div>;
}

const hubMessages: Record<NonNullable<HubStatus['reason']>, string> = {
    hub_unconfigured: 'This deployment is not configured as a validation hub. Use System Setup to configure hub DNS settings.',
    hub_unavailable: 'Hub status is unavailable. Refresh to try again.',
    deployment_required: 'Deploy the compatible framework to every expected node first.',
    deployment_in_progress: 'Wait for the current deployment to finish, then refresh.',
    deployment_not_converged: 'Finish the deployment on every expected node, then refresh.',
    deployment_proof_unavailable: 'Some nodes have not confirmed the deployed framework. Check Deployments, then refresh.',
    framework_upgrade_required: 'Update every expected node to a compatible framework release, then refresh.',
};
function HubSharing() {
    const owner = usePrivateOperator();
    const [state, setState] = useState<HubStatus | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
    const flight = useRef(false), generation = useRef(0);
    const refresh = async () => {
        const fence = owner.fence(), current = ++generation.current; setLoading(true);
        try { const next = await readHubStatus(fence); fence.beforeSend(); if (current === generation.current) { setState(next); setError(''); } }
        catch (reason) { if (!fence.signal?.aborted && current === generation.current) setError((reason instanceof OperatorError ? reason : new OperatorError('unavailable')).message); }
        finally { if (!fence.signal?.aborted && current === generation.current) setLoading(false); }
    };
    useEffect(() => { void refresh(); return () => { generation.current++; }; }, [owner.key]);
    const enable = async () => {
        if (flight.current || loading || error || !state?.can_enable || !state.deployment_uuid) return;
        const fence = owner.fence(), deployment = state.deployment_uuid, opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        flight.current = true; setBusy(true);
        try {
            fence.beforeSend();
            const confirmed = await modal.open<boolean>(close => <div className="modal-pad"><h2 className="modal-title">Enable shared validation?</h2><div className="modal-message"><p>Enable this hub after the verified deployment <code>{deployment}</code>.</p><p>Trusted projects can share DNS validation. Each issuer keeps its own certificates, accounts and private keys. Allocation trust still requires explicit approval.</p><p>Keep the compatible framework installed on every node after enabling sharing.</p></div><div className="modal-actions"><button className="btn" onClick={() => close(false)}>Cancel</button><button className="btn btn-primary" onClick={() => close(true)}>Enable sharing</button></div></div>, { size: 'md', signal: fence.signal });
            if (!confirmed) return; fence.beforeSend();
            const next = await enableHub(deployment, fence); fence.beforeSend(); setState(next); setError('');
        } catch (reason) {
            if (!fence.signal?.aborted) {
                const safe = reason instanceof OperatorError ? reason : new OperatorError('unavailable');
                await refresh(); try { fence.beforeSend(); } catch { return; } setError(`${safe.message} Refresh hub status before trying again.`);
                if (safe.kind === 'fresh') await requestFreshAuth();
            }
        } finally { flight.current = false; if (!fence.signal?.aborted) { setBusy(false); requestAnimationFrame(() => { try { fence.beforeSend(); if (opener?.isConnected) opener.focus(); } catch { /* The former session no longer owns focus. */ } }); } }
    };
    return <section className="panel panel-pad" aria-label="Validation hub" style={layout}><h2>Validation hub</h2><p>Enable sharing once after updating every node through the existing deployment controls. Configured issuers renew automatically.</p><p role="status">{loading ? 'Checking hub status…' : error ? 'Current hub status is unavailable.' : state?.enabled ? 'Sharing is enabled.' : state?.reason ? hubMessages[state.reason] : 'Ready to enable sharing.'}</p>{state?.enabled && !state.configured && <p className="text-warn">Hub DNS configuration is unavailable. Check System Setup, then refresh.</p>}{error && <p className="form-alert" role="alert">{error}</p>}<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><button className="btn" disabled={busy || loading} onClick={() => void refresh()}>Refresh hub status</button>{!state?.enabled && <button className="btn btn-primary" disabled={busy || loading || !!error || !state?.can_enable} onClick={() => void enable()}>Enable shared validation</button>}</div></section>;
}
