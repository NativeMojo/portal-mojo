import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthSnapshot, useMe, type Me } from '../../client/me';
import { getAuthSessionRevision, getAuthSnapshot, isReauthRequired, requestFreshAuth, subscribeAuth } from '../../client/auth';
import {
    assistantSetupCredentialRefusal, assistantSetupReadiness, assistantSetupSave, getAssistantSetup, mutateAssistantSetup,
    type AssistantSetupState, type SetupAction, type SetupKey, type SetupCheck, type SetupTarget,
} from './setup';

import { Popover } from '../../ui/Popover';
import { Tabs } from '../../ui/Tabs';
import { copyText } from '../../ui/secret-dialog';

type SetupPanel = 'model' | 'credentials' | 'safety' | 'triage';
type Operation = { controller: AbortController; revision: number };
/** Also gates direct component consumers, independently of navigation and lazy-route admission. */
export function AssistantSetupPage() {
    const { data: me } = useMe();
    const auth = useAuthSnapshot();
    const revision = useSyncExternalStore(subscribeAuth, getAuthSessionRevision, getAuthSessionRevision);
    if (!auth.authenticated || me?.is_superuser !== true || String(me.id) !== auth.uid) return <div className="panel panel-pad" role="alert"><h2>Owner access required</h2><p>Assistant setup requires a literal installation superuser signed in as a person.</p></div>;
    return <OwnerSetup key={`${auth.uid}:${revision}`} ownerId={me.id} revision={revision} />;
}
function SetupHelp({ label, children }: { label: string; children: ReactNode }) {
    const anchor = useRef<HTMLButtonElement>(null), id = useId();
    const [open, setOpen] = useState(false);
    return <><button type="button" ref={anchor} className="assistant-setup-help" aria-label={`About ${label}`} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}><i className="bi bi-info-circle" aria-hidden="true" /></button><Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)} id={id} aria-label={`About ${label}`} className="assistant-setup-help-content">{children}</Popover></>;
}
/** Local native dialog: shares the page's live state and dies with its owner scope. */
function SetupDialog({ title, locked, onClose, children, confirmation = false }: { title: string; locked: boolean; onClose: () => void; children: ReactNode; confirmation?: boolean }) {
    const ref = useRef<HTMLDialogElement>(null), id = useId();
    useLayoutEffect(() => {
        const dialog = ref.current, opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog?.showModal();
        return () => { if (dialog?.open) dialog.close(); if (opener?.isConnected) opener.focus(); };
    }, []);
    const dismiss = () => { if (!locked) onClose(); };
    return <dialog ref={ref} className={`assistant-setup-dialog${confirmation ? ' assistant-setup-dialog-confirm' : ''}`} aria-labelledby={id}
        onCancel={event => { event.preventDefault(); dismiss(); }} onMouseDown={event => { if (event.target === ref.current) dismiss(); }}
        onClose={() => { if (ref.current && !ref.current.open) { if (locked) ref.current.showModal(); else onClose(); } }}>
        <header><h2 id={id}>{title}</h2>{!confirmation && <button className="btn-icon" type="button" aria-label="Close setup dialog" disabled={locked} onClick={dismiss}><i className="bi bi-x-lg" aria-hidden="true" /></button>}</header>
        <div className="assistant-setup-dialog-content">{children}</div>
        {!confirmation && <footer><button className="btn" type="button" disabled={locked} onClick={dismiss}>Done</button></footer>}
    </dialog>;
}
function KeySummary({ label, value, check }: { label: string; value: SetupKey; check: SetupCheck }) {
    return <div className="assistant-setup-key-status"><strong>{value.configured ? 'Key configured' : 'No key configured'}</strong>
        <p className="dim">{value.source === 'admin' ? 'Saved in Admin' : value.source === 'deployment' ? 'Provided by deployment' : 'Add a key below'}{value.hint && <> · <code>{value.hint}</code></>}</p>
        <p className={check.ok === false ? 'assistant-setup-warning' : 'dim'}>Last check: {check.ok === null ? 'Not checked' : check.ok ? 'Accepted' : 'Failed'} <SetupHelp label={`${label} verification`}>{check.message}{check.at && <p>Checked {check.at}</p>}<p>A key check does not prove that all Assistant requests can run.</p></SetupHelp></p></div>;
}
function OwnerSetup({ ownerId, revision }: { ownerId: number; revision: number }) {
    const queryClient = useQueryClient();
    const [state, setState] = useState<AssistantSetupState | null>(null);
    const stateRef = useRef(state); stateRef.current = state;
    const [draft, setDraft] = useState(''); const [handlerDraft, setHandlerDraft] = useState('');
    const [modelDraft, setModelDraft] = useState('');
    const [modeDraft, setModeDraft] = useState<'auto' | 'pinned' | ''>('');
    const [before, setBefore] = useState(''); const [limit, setLimit] = useState('25');
    const [pending, setPending] = useState(''); const [notice, setNotice] = useState(''); const [error, setError] = useState('');
    const [confirmation, setConfirmation] = useState<{ message: string; accept: () => void; cancel: () => void } | null>(null);
    const live = useRef(false); const operation = useRef<Operation | null>(null);
    const [surface, setSurface] = useState('ai');
    const [panel, setPanel] = useState<SetupPanel | null>(null);
    const [keyTarget, setKeyTarget] = useState<SetupTarget>('assistant');
    const [safetyTab, setSafetyTab] = useState('policy');
    const validOwner = () => {
        const auth = getAuthSnapshot();
        const me = queryClient.getQueryData<Me>(['me', auth.uid]);
        return live.current && getAuthSessionRevision() === revision && auth.authenticated && auth.uid === String(ownerId) && me?.id === ownerId && me.is_superuser === true;
    };
    const clearDrafts = () => { setDraft(''); setHandlerDraft(''); setBefore(''); setLimit('25'); setModelDraft(''); setModeDraft(''); };
    const dispose = () => {
        operation.current?.controller.abort(); operation.current = null;
        clearDrafts(); setPanel(null); setConfirmation(null); setPending(''); setState(null); stateRef.current = null; setNotice(''); setError('');
    };
    const guard = (op: Operation) => {
        if (!validOwner() || operation.current !== op || op.controller.signal.aborted) throw new DOMException('Setup scope ended', 'AbortError');
    };
    const options = (op: Operation) => ({ signal: op.controller.signal, beforeSend: () => guard(op) });
    const apply = (next: AssistantSetupState, op: Operation) => { guard(op); stateRef.current = next; setState(next); setModelDraft(next.model.capability?.mode === 'pinned' ? next.model.selected : ''); setModeDraft(next.model.capability?.mode === 'auto' || next.model.capability?.mode === 'pinned' ? next.model.capability.mode : ''); };
    const begin = (label: string): Operation | null => {
        if (!validOwner() || operation.current) return null;
        const op = { controller: new AbortController(), revision }; operation.current = op; setPending(label); setNotice(''); setError(''); return op;
    };
    const finish = (op: Operation) => { if (operation.current === op) { operation.current = null; setPending(''); setConfirmation(null); } };
    async function failure(err: unknown, op: Operation, mutation: boolean) {
        if (!validOwner() || operation.current !== op || op.controller.signal.aborted) return;
        if (isReauthRequired(err)) {
            clearDrafts(); setConfirmation(null); setNotice('Sign in again, then re-enter any key and explicitly retry. Nothing is automatically replayed.');
            // Step-up replaces the session. Never close over a secret for retry.
            await requestFreshAuth(); return;
        }
        setError(assistantSetupCredentialRefusal(err) ?? (mutation ? 'The operation was refused or its outcome is unknown. Refreshing current configuration; no operation will be retried automatically.' : 'Assistant setup could not be loaded. Try Refresh setup.'));
        if (mutation) {
            try { apply(await getAssistantSetup(options(op)), op); }
            catch { if (validOwner() && operation.current === op) { setState(null); stateRef.current = null; setPanel(null); } }
        }
    }
    async function load(probe?: 'models' | 'discovery') {
        const op = begin(probe ? 'Checking…' : 'Loading setup…'); if (!op) return;
        try {
            const next = await getAssistantSetup(options(op), probe); apply(next, op);
            if (probe === 'models') {
                guard(op);
                const refresh = next.model.capability?.refresh;
                if (refresh?.ok === true) setNotice('Provider catalogue refreshed. Review the resolved runtime model below.');
                else setError(refresh?.code === 'refresh_in_progress' ? 'A catalogue refresh is already in progress. Returned configuration is unchanged; try again later.' : refresh?.code === 'refresh_throttled' ? 'Catalogue refresh is temporarily limited. Returned configuration is unchanged; try again later.' : 'Provider catalogue refresh was not confirmed. Any returned cached model keeps its reported freshness; no newer model is confirmed.');
            } else if (probe === 'discovery') { guard(op); setNotice('Discovery check completed. Review its verdict below.'); }
        }
        catch (err) { await failure(err, op, false); } finally { finish(op); }
    }
    function change(make: (current: AssistantSetupState) => SetupAction, label: string, confirm?: string, credential?: SetupTarget) {
        if (!stateRef.current) return;
        const op = begin(label); if (!op) return;
        const run = async () => {
            let action: SetupAction | null = null;
            try {
                guard(op); setConfirmation(null);
                if (!stateRef.current) throw new Error('Reload setup.');
                action = make(stateRef.current);
                const result = await mutateAssistantSetup(action, options(op));
                guard(op); apply(result.state, op);
                if (credential === 'assistant') setDraft(''); if (credential === 'handler') setHandlerDraft('');
                if (result.result) {
                    if (result.result.ok === true) setNotice(result.result.message);
                    else setError(result.result.message || 'The credential check failed.');
                } else setNotice(result.queued !== undefined ? `Historical triage queued: ${result.queued}.` : result.revoked !== undefined ? `Connections disconnected: ${result.revoked}.` : result.reset !== undefined ? `Breakers reset: ${result.reset}. Emergency stops are unchanged.` : label === 'Activating policy…' ? 'Deployed policy acknowledged on this node. Fleet-wide agreement has not been established.' : 'Configuration saved.');
            } catch (err) {
                // Drop request-local candidate references before showing any fresh-auth UI.
                if (action && 'api_key' in action) delete action.api_key;
                if (action && 'handler_api_key' in action) delete action.handler_api_key;
                action = null;
                await failure(err, op, true);
            } finally {
                if (action && 'api_key' in action) delete action.api_key;
                if (action && 'handler_api_key' in action) delete action.handler_api_key;
                finish(op);
            }
        };
        if (confirm) {
            let accepted = false;
            setConfirmation({ message: confirm, accept: () => { if (accepted) return; accepted = true; void run(); }, cancel: () => finish(op) });
        }
        else void run();
    }
    useEffect(() => {
        live.current = true;
        const revoke = () => { if (!validOwner()) dispose(); };
        const offAuth = subscribeAuth(revoke); const offQuery = queryClient.getQueryCache().subscribe(revoke);
        void load();
        return () => { live.current = false; operation.current?.controller.abort(); operation.current = null; offAuth(); offQuery(); };
    // The keyed boundary owns identity/revision. Ordinary token renewal preserves this instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const locked = pending !== '';
    const capability = state?.model.capability;
    const modelEditable = capability?.editable === true && capability.policy_model === 'auto:sonnet' && capability.mode !== 'fixed' && (capability.restriction === '' || capability.restriction === 'deployment_pin');
    const autoAvailable = modelEditable && capability?.restriction !== 'deployment_pin';
    const restriction = !capability ? 'Runtime model selection is unavailable on this server. Upgrade the backend to select Automatic or a manual pin.'
        : capability.restriction === 'fixed_policy' ? 'The deployed policy fixes the model. Model selection is read-only.'
        : capability.restriction === 'provider_unsupported' ? 'This provider uses a deployment-owned model. Automatic Sonnet and manual selection are unavailable.'
        : capability.restriction === 'policy_unavailable' ? 'The deployed model policy is unavailable. Model selection is read-only.'
        : capability.restriction === 'deployment_pin' ? 'A deployment pin is active beneath owner overrides. You may save a manual pin; remove the deployment pin before choosing Automatic.'
        : !modelEditable ? 'Runtime model selection is read-only for this deployment.' : '';

    const saveKey = (target: SetupTarget) => change((current) => assistantSetupSave(current, target === 'assistant' ? { api_key: draft } : { handler_api_key: handlerDraft }), 'Checking and saving key…', undefined, target);
    const clearKey = (target: SetupTarget) => change((current) => assistantSetupSave(current, target === 'assistant' ? { clear_api_key: true } : { clear_handler_api_key: true }), 'Clearing protected key…', 'Clear the protected Admin credential? A deployment credential may become active. Review the returned source after saving.', target);
    const openPanel = (next: SetupPanel, target: SetupTarget = 'assistant') => {
        if (locked) return;
        setDraft(''); setHandlerDraft(''); setBefore(''); setLimit('25');
        setModelDraft(state?.model.capability?.mode === 'pinned' ? state.model.selected : '');
        setModeDraft(state?.model.capability?.mode === 'auto' || state?.model.capability?.mode === 'pinned' ? state.model.capability.mode : '');
        setKeyTarget(target); setSafetyTab('policy'); setNotice(''); setError(''); setPanel(next);
    };
    const closePanel = () => { if (!operation.current) { clearDrafts(); setPanel(null); } };
    const messages = <>{(notice || (pending && !confirmation)) && <p className="assistant-setup-notice" role="status" aria-live="polite">{notice || pending}</p>}{error && <p className="assistant-setup-warning" role="alert">{error}</p>}</>;
    const provider = state?.route.provider === 'anthropic' ? 'Anthropic' : state?.route.provider === 'bedrock' ? 'AWS Bedrock' : 'Unavailable';
    const configured = !!state?.route.ready && state.assistant_installed && state.realtime_installed;
    const recoveryPanel: SetupPanel = state?.emergency_stop || !state?.assistant_installed || !state.realtime_installed ? 'safety'
        : state.route.error === 'credential_missing' || (state.route.credential && !state.route.credential_configured) ? 'credentials'
        : modelEditable && state.model.capability?.mode === 'auto' && !state.model.effective && state.route.provider && state.route.credential ? 'model' : 'safety';
    const readiness = state ? assistantSetupReadiness(state) : '';
    const key = state && (keyTarget === 'assistant' ? state.key : state.handler_key);
    const keyLabel = keyTarget === 'assistant' ? 'Assistant' : 'Platform';
    const panelTitles: Record<SetupPanel, string> = { model: 'Model', credentials: 'API keys', safety: 'Safety & usage', triage: 'Incident triage' };
    return <main className="assistant-setup" aria-labelledby="assistant-setup-title">
        <header className="assistant-setup-header"><div><h1 id="assistant-setup-title">Assistant setup</h1><p className="dim">Configure the built-in AI Assistant or connect external agents.</p></div><button type="button" className="btn" disabled={locked} onClick={() => void load()}>Refresh setup</button></header>
        {!panel && messages}
        {!state && !pending && <button className="btn" type="button" onClick={() => void load()}>Retry setup</button>}
        {state && <>
            <Tabs activeKey={surface} onActiveKeyChange={next => { if (!locked) { closePanel(); setNotice(''); setError(''); setSurface(next); } }} ariaLabel="Setup area" items={[
                { key: 'ai', label: 'AI Assistant', disabled: locked && surface !== 'ai', panel: <div className="assistant-setup-area">
            <section className="panel panel-pad assistant-setup-overview" aria-label="Assistant status">
                <div className="assistant-setup-status"><div><span className={`assistant-setup-dot${state.emergency_stop ? ' is-stopped' : configured && state.enabled ? ' is-ready' : ''}`} /><h2>{state.emergency_stop ? 'AI Assistant stopped' : !configured ? 'Setup needed' : state.enabled ? 'AI Assistant enabled' : 'AI Assistant disabled'}</h2><SetupHelp label="Assistant status"><p>{readiness}</p><p>The switch does not override deployment policy or emergency stops.</p></SetupHelp></div><button className={`btn${!state.enabled ? ' btn-primary' : ''}`} type="button" disabled={locked} onClick={() => change(current => assistantSetupSave(current, { enabled: !current.enabled }), 'Saving Assistant switch…')}>{state.enabled ? 'Disable Assistant' : 'Enable Assistant'}</button></div>
                {(!configured || state.emergency_stop) && <p className="assistant-setup-warning">{readiness} <button className="assistant-setup-text-button" type="button" disabled={locked} onClick={() => openPanel(recoveryPanel, state.route.credential === 'handler' ? 'handler' : 'assistant')}>Review setup</button></p>}
                <div className="assistant-setup-row"><div><h3>Model <SetupHelp label="Model"><p>The provider comes from your deployment. Automatic selection follows the backend's compatible Sonnet catalogue; a manual pin keeps a specific model.</p></SetupHelp></h3><p>{provider} · {capability?.mode === 'auto' ? 'Automatic' : capability?.mode === 'pinned' ? 'Manual pin' : 'Deployment managed'}</p><code>{state.model.effective || state.route.model || 'Model unavailable'}</code></div><button className="btn" type="button" disabled={locked} onClick={() => openPanel('model')}>{modelEditable ? 'Configure model' : 'View model'}</button></div>
                <div className="assistant-setup-row"><div><h3>Connection <SetupHelp label="Connection"><p>The active route selects an Assistant key, Platform key or deployment AWS identity. These credentials do not substitute for each other.</p></SetupHelp></h3><p>{state.route.credential === 'aws' ? 'AWS identity · managed by deployment' : state.route.credential === 'handler' ? `Platform key · ${state.route.credential_configured ? 'configured' : 'missing'}` : state.route.credential === 'admin' ? `Assistant key · ${state.route.credential_configured ? 'configured' : 'missing'}` : 'Deployment route unavailable'}</p></div><button className="btn" type="button" disabled={locked} onClick={() => openPanel('credentials', state.route.credential === 'handler' ? 'handler' : 'assistant')}>Manage keys</button></div>
            </section>
            <section className="panel assistant-setup-tools" aria-label="Assistant controls">
                <div className="assistant-setup-row"><i className="bi bi-shield-check" aria-hidden="true" /><div><h3>Safety & usage</h3><p>{state.emergency_stop ? 'Emergency stop active' : state.route.error ? 'Policy needs attention' : 'No emergency stop'}</p></div><button className="btn" type="button" disabled={locked} onClick={() => openPanel('safety')}>Review safety</button></div>
                <div className="assistant-setup-row"><i className="bi bi-activity" aria-hidden="true" /><div><h3>Incident triage <SetupHelp label="Incident triage"><p>Let the Assistant process new security incidents automatically. Older incidents need a separate, explicitly bounded run.</p></SetupHelp></h3><p>{state.autonomous_triage ? 'Automatic triage enabled' : 'Automatic triage disabled'}</p></div><button className="btn" type="button" disabled={locked} onClick={() => openPanel('triage')}>Manage triage</button></div>
            </section>
            </div> },
                { key: 'mcp', label: 'MCP connections', disabled: locked && surface !== 'mcp', panel: <section className="panel panel-pad assistant-setup-mcp" aria-label="MCP connections">
                <h2>Connect an external agent</h2><p className="dim">Use this address in your AI client. No AI provider, model or API key is needed here.</p>
                <div className="assistant-setup-row"><div><h3>MCP access <SetupHelp label="Remote access"><p>Tools, Full API or combined grants follow each user's authorization. Full API carries the signed-in user's API authority. Pausing retains grants; Disconnect revokes them.</p></SetupHelp></h3><p>{state.mcp.enabled ? 'Enabled' : 'Paused'}</p></div><button className="btn" type="button" disabled={locked} onClick={() => change(current => assistantSetupSave(current, { mcp_enabled: !current.mcp.enabled }), 'Saving remote access…', 'Change remote agent access? Existing grants are retained; Disconnect revokes them.')}>{state.mcp.enabled ? 'Pause remote access' : 'Enable remote access'}</button></div>
                <div className="assistant-setup-field"><span><label htmlFor="assistant-connect-address">Connect address</label> <SetupHelp label="Connect address"><p>Add this address to your AI client's MCP connections, then sign in there. Select the address to copy it. No connection is created on this page.</p></SetupHelp></span><div className="assistant-setup-address"><input id="assistant-connect-address" className="input" value={state.mcp.url} readOnly onFocus={event => event.target.select()} /><button className="btn" type="button" disabled={locked || !state.mcp.url} onClick={() => { void copyText(state.mcp.url).then(copied => { if (validOwner()) setNotice(copied ? 'Connect address copied.' : 'Select the address and copy it manually.'); }); }}>Copy address</button></div></div>
                {!state.mcp.url && <p className="assistant-setup-warning">No public connect address is configured. Review deployment configuration.</p>}
                <div className="assistant-action-row"><button className="btn" type="button" disabled={locked} onClick={() => void load('discovery')}>Check public discovery</button><span>Discovery: {state.mcp.discovery.ok === null ? 'Not checked' : state.mcp.discovery.ok ? 'Reachable' : 'Failed'} <SetupHelp label="Public discovery"><p>{state.mcp.discovery.detail}</p><p>{state.mcp.discovery_url || 'No public discovery address configured.'}</p>{state.mcp.discovery.checked_at && <p>{state.mcp.discovery.checked_at}</p>}</SetupHelp></span></div>
                {state.mcp.discovery.ok === false && <p className="assistant-setup-warning" role="alert">Discovery failed. {state.mcp.discovery.detail}</p>}
                <h3>Connected agents · {state.mcp.grant_count}</h3>
                {!state.mcp.grant_count && <p className="dim">No agents connected. Add the connect address in your AI client to get started.</p>}
                {state.mcp.grant_count > state.mcp.grants.length && <p className="dim">Showing {state.mcp.grants.length} of {state.mcp.grant_count} connections (up to 200).</p>}
                <div className="assistant-setup-connections">{state.mcp.grants.map(row => <article key={row.id} className="assistant-setup-row"><div><strong>{row.client.name || row.client.client_id}</strong><p>{row.user.display_name || row.user.email}</p><span className="dim">{row.access === 'api' ? 'Full API' : row.access === 'both' ? 'Tools and Full API' : 'Tools'} <SetupHelp label={`Connection ${row.id}`}><p>Last used: {row.last_used || 'Not used'}</p><p>Expires: {row.expires || 'Not reported'}</p></SetupHelp></span></div><button className="btn" type="button" disabled={locked} onClick={() => change(() => ({ action: 'revoke_grant', grant_id: row.id }), 'Disconnecting agent…', `Disconnect ${row.client.name || 'this agent'} for ${row.user.display_name || row.user.email}? A new authorization is required to reconnect.`)}>Disconnect #{row.id}</button></article>)}</div>
                {state.mcp.grant_count > 0 && <div className="assistant-setup-danger-row"><button className="btn" type="button" disabled={locked} onClick={() => change(() => ({ action: 'revoke_all_grants' }), 'Disconnecting all agents…', 'Disconnect every remote Tools and Full API grant, for every user? New authorizations will be required.')}>Disconnect all agents</button></div>}
            </section> },
            ]} />
        </>}
        {state && panel && <SetupDialog title={panelTitles[panel]} locked={locked} onClose={closePanel}>
            {messages}
            {panel === 'model' && <>
                <p className="dim">{provider} · source: {state.model.source || 'Unavailable'}</p>
                <div className="assistant-setup-current"><span>Current model</span><code>{state.model.effective || state.route.model || 'Unavailable'}</code></div>
                {restriction && <p className="assistant-setup-warning" id="assistant-model-restriction">{restriction}</p>}
                {modelEditable && <>
                    <label className="assistant-setup-field" htmlFor="assistant-model-mode">Selection method <select className="input" id="assistant-model-mode" value={modeDraft} disabled={locked} onChange={event => setModeDraft(event.target.value as 'auto' | 'pinned')}>
                        {!modeDraft && <option value="" disabled>Choose selection method</option>}<option value="auto" disabled={!autoAvailable}>Automatic — latest Sonnet</option><option value="pinned">Manual pin</option>
                    </select></label>
                    {modeDraft === 'pinned' && <label className="assistant-setup-field" htmlFor="assistant-model-pin">Manual model identifier<input className="input" id="assistant-model-pin" value={modelDraft} onChange={event => setModelDraft(event.target.value)} disabled={locked} list="assistant-model-choices" maxLength={81} autoComplete="off" spellCheck={false} /></label>}
                    <datalist id="assistant-model-choices">{state.model.choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</datalist>
                    <p className="dim">{modeDraft === 'pinned' ? 'Keeps this model until you change it.' : 'Uses the latest compatible Sonnet resolved by the backend.'} <SetupHelp label="Model selection"><p>Changes take effect only after saving. Refreshing the catalogue cannot replace a manual pin.</p></SetupHelp></p>
                    <div className="assistant-action-row"><button className="btn btn-primary" type="button" disabled={locked || !modeDraft || (modeDraft === 'auto' ? !autoAvailable : !/^[a-z0-9][a-z0-9.\-]{0,80}$/.test(modelDraft))} onClick={() => change(() => modeDraft === 'auto' ? { action: 'set_model_selection', mode: 'auto' } : { action: 'set_model_selection', mode: 'pinned', model: modelDraft }, 'Saving model selection…')}>Save model selection</button><button className="btn" type="button" disabled={locked} onClick={() => void load('models')}>Refresh provider catalogue</button></div>
                </>}
                {capability && <div className="assistant-setup-catalogue"><span>Catalogue: <strong>{capability.discovery.status === 'fresh' ? 'Fresh cache' : capability.discovery.status === 'stale' ? 'Stale cache — cached resolution only' : capability.discovery.status === 'unavailable' ? 'Unavailable — no usable automatic resolution' : 'Not applicable to the selected mode'}</strong></span><SetupHelp label="Provider catalogue"><dl className="assistant-setup-facts"><div><dt>Last successful fetch</dt><dd>{capability.discovery.fetched_at || 'None reported'}</dd></div><div><dt>Last attempt</dt><dd>{capability.discovery.attempted_at || 'None reported'}</dd></div><div><dt>Fresh until</dt><dd>{capability.discovery.expires_at || 'Not applicable'}</dd></div><div><dt>Usable cached limit</dt><dd>{capability.discovery.max_stale_at || 'Not applicable'}</dd></div></dl>{capability.discovery.error_code && <p>The backend reports a discovery problem.</p>}</SetupHelp></div>}
            </>}
            {panel === 'credentials' && <>
                {state.route.credential === 'aws' && <p className="assistant-setup-warning">This route uses deployment AWS identity. API keys below do not configure that identity.</p>}
                {state.route.credential === 'handler' && <p className="dim">This route uses the Platform key.</p>}
                {!state.route.credential && <p className="assistant-setup-warning">The deployment route is unavailable. Adding a key may not resolve it; review Safety & usage.</p>}
                <Tabs activeKey={keyTarget} onActiveKeyChange={value => { if (!locked) { setDraft(''); setHandlerDraft(''); setKeyTarget(value as SetupTarget); setNotice(''); setError(''); } }} ariaLabel="Credential type" items={(['assistant', 'handler'] as const).map(target => ({ key: target, label: target === 'assistant' ? 'Assistant key' : 'Platform key', disabled: locked && keyTarget !== target, panel: target === keyTarget && key && <>
                    <p className="dim">{keyTarget === 'assistant' ? 'Used when the deployed route selects the Assistant credential.' : 'Used only by deployed routes selecting the Platform credential.'} <SetupHelp label="API key storage"><p>Keys are write-only. A new key is checked before encrypted storage. Nothing saves while you type. Removing an Admin key can activate a deployment fallback.</p></SetupHelp></p>
                    <KeySummary label={`${keyLabel} key`} value={key} check={keyTarget === 'assistant' ? state.verify : state.handler_verify} />
                    <label className="assistant-setup-field" htmlFor={keyTarget === 'assistant' ? 'assistant-replacement-key' : 'handler-replacement-key'}>{key.configured ? `Replacement ${keyLabel} key` : `${keyLabel} API key`}<input id={keyTarget === 'assistant' ? 'assistant-replacement-key' : 'handler-replacement-key'} className="input" type="password" value={keyTarget === 'assistant' ? draft : handlerDraft} onChange={event => keyTarget === 'assistant' ? setDraft(event.target.value) : setHandlerDraft(event.target.value)} autoComplete="new-password" spellCheck={false} maxLength={4096} disabled={locked} /></label>
                    <div className="assistant-action-row"><button className="btn btn-primary" type="button" disabled={locked || !(keyTarget === 'assistant' ? draft : handlerDraft).trim()} onClick={() => saveKey(keyTarget)}>{keyTarget === 'assistant' ? 'Check and save key' : 'Check and save Platform key'}</button><button className="btn" type="button" disabled={locked} onClick={() => change(() => ({ action: 'verify', target: keyTarget }), 'Checking current key…')}>{keyTarget === 'assistant' ? 'Check current key' : 'Check current Platform key'}</button></div>
                    <div className="assistant-setup-danger-row"><button className="btn" type="button" disabled={locked || key.source !== 'admin'} onClick={() => clearKey(keyTarget)}>{`Clear stored ${keyLabel} key`}</button></div>
                </> }))} />
            </>}
            {panel === 'safety' && <Tabs activeKey={safetyTab} onActiveKeyChange={value => { if (!locked) setSafetyTab(value); }} ariaLabel="Safety controls" items={[
                { key: 'policy', label: 'Policy & stops', disabled: locked && safetyTab !== 'policy', panel: <>
                    <h3>Deployed policy <SetupHelp label="Deployed policy"><p>Deployment owns the policy and runtime route. Acknowledging activates the current policy on this node; it does not check the fleet or release an emergency stop.</p>{capability && <p>Deployed policy model: <code>{capability.policy_model || 'Unavailable'}</code></p>}{state.route.can_invoke !== undefined && <p>Guarded request admission: {state.route.can_invoke ? 'Allowed to attempt' : 'Blocked'} · separate from configuration readiness</p>}</SetupHelp></h3>
                    <p>Policy status: {state.route.error || 'Ready'}</p><button className="btn" type="button" disabled={locked} onClick={() => change(() => ({ action: 'activate_policy' }), 'Activating policy…', 'Acknowledge the currently deployed policy on this node? This does not edit policy content, check other nodes or release an emergency stop.')}>Acknowledge deployed policy</button>
                    <h3>Emergency stop <SetupHelp label="Emergency stop"><p>The Admin stop is stored in the database. A deployment stop is read-only here and must be removed in deployment configuration. Both block AI requests; MCP connections are separate.</p></SetupHelp></h3><dl className="assistant-setup-facts"><div><dt>Deployment stop (read-only)</dt><dd>{state.emergency_stop_static ? 'On' : 'Off'}</dd></div><div><dt>Admin stop</dt><dd>{state.emergency_stop_database ? 'On' : 'Off'}</dd></div><div><dt>Requests stopped</dt><dd>{state.emergency_stop ? 'On' : 'Off'}</dd></div></dl>
                    {state.emergency_stop_static && <p className="assistant-setup-warning">A deployment stop is active. Releasing the database stop cannot resume requests.</p>}
                    <button className="btn" type="button" disabled={locked} onClick={() => change(current => assistantSetupSave(current, { emergency_stop: !current.emergency_stop_database }), 'Saving database stop…', 'Change only the database emergency stop? A deployment stop remains authoritative.')}>{state.emergency_stop_database ? 'Release Admin stop' : 'Stop AI requests'}</button>
                </> },
                { key: 'usage', label: 'Usage & recovery', disabled: locked && safetyTab !== 'usage', panel: <>
                    <h3>Requests · last {state.safety.hours || 24} hours</h3>{state.safety.error && <p className="assistant-setup-warning" role="alert">Safety statistics unavailable.</p>}
                    {state.safety.requests.length ? <div className="assistant-table-scroll"><table><caption>Guarded request aggregates</caption><thead><tr><th>Provider / feature</th><th>Status</th><th>Requests</th><th>Tokens in / out</th></tr></thead><tbody>{state.safety.requests.map((row, i) => <tr key={i}><td>{row.provider} / {row.feature}</td><td>{row.status}</td><td>{row.requests}</td><td>{row.input_tokens} / {row.output_tokens}</td></tr>)}</tbody></table></div> : !state.safety.error && <p className="dim">No requests reported.</p>}
                    <h3>Circuit breakers <SetupHelp label="Circuit breakers"><p>Breakers pause requests after repeated provider errors. Reset allows another attempt; policy and emergency stops stay enforced.</p></SetupHelp></h3>{state.safety.breakers.length ? <div className="assistant-table-scroll"><table><caption>Breaker state by provider</caption><thead><tr><th>Provider</th><th>State</th><th>Error</th><th>Count</th></tr></thead><tbody>{state.safety.breakers.map((row, i) => <tr key={i}><td>{row.provider}</td><td>{row.state}</td><td>{row.error_code || 'None'}</td><td>{row.count}</td></tr>)}</tbody></table></div> : <p className="dim">No breaker records reported.</p>}
                    <div className="assistant-action-row">{(['all', 'anthropic', 'bedrock'] as const).map(provider => <button key={provider} className="btn" type="button" disabled={locked} onClick={() => change(() => ({ action: 'reset_breaker', ...(provider === 'all' ? {} : { provider }) }), 'Resetting breakers…', `Reset ${provider} circuit breakers? Requests may try again; policy and emergency stops remain enforced.`)}>Reset {provider} breakers</button>)}</div>
                </> },
            ]} />}
            {panel === 'triage' && <>
                <div className="assistant-setup-row"><div><h3>Automatic incident triage <SetupHelp label="Automatic incident triage"><p>Enabling establishes a no-history watermark. Only new incidents are processed automatically; older ones need an explicit run.</p><p>Watermark: {state.autonomous_triage_activated_at || 'Not activated'}</p></SetupHelp></h3><p>{state.autonomous_triage ? 'Enabled' : 'Disabled'}</p></div><button className="btn" type="button" disabled={locked} onClick={() => change(current => assistantSetupSave(current, { autonomous_triage: !current.autonomous_triage }), 'Saving autonomous triage…', 'Change autonomous incident triage? New activation establishes a watermark; it does not queue older incidents.')}>{state.autonomous_triage ? 'Disable autonomous triage' : 'Enable autonomous triage'}</button></div>
                <h3>Process older incidents</h3><p className="dim">Queue a limited historical run. Provider charges may apply.</p>
                <label className="assistant-setup-field" htmlFor="assistant-triage-before">Incidents before (local time)<input className="input" id="assistant-triage-before" type="datetime-local" value={before} onChange={event => setBefore(event.target.value)} disabled={locked} /></label>
                <label className="assistant-setup-field" htmlFor="assistant-triage-limit">Maximum incidents (1–100)<input className="input" id="assistant-triage-limit" type="number" min={1} max={100} step={1} value={limit} onChange={event => setLimit(event.target.value)} disabled={locked} /></label>
                <button className="btn btn-primary" type="button" disabled={locked || !before || !Number.isFinite(Date.parse(before)) || !Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 100} onClick={() => change(() => ({ action: 'historical_triage', before: new Date(before).toISOString(), limit: Number(limit) }), 'Queueing historical triage…', `Queue up to ${limit} incidents before ${before}? This explicitly processes historical incidents and can incur provider cost.`)}>Queue historical triage</button>
            </>}
        </SetupDialog>}
        {confirmation && <SetupDialog title="Confirm change" locked={false} onClose={confirmation.cancel} confirmation><p>{confirmation.message}</p><div className="modal-actions"><button className="btn" type="button" autoFocus onClick={confirmation.cancel}>Cancel</button><button className="btn btn-primary" type="button" onClick={confirmation.accept}>Confirm operation</button></div></SetupDialog>}
    </main>;
}
