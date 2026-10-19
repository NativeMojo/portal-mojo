import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthSnapshot, useMe, type Me } from '../../client/me';
import { getAuthSessionRevision, getAuthSnapshot, isReauthRequired, requestFreshAuth, subscribeAuth } from '../../client/auth';
import {
    assistantSetupCredentialRefusal, assistantSetupReadiness, assistantSetupSave, getAssistantSetup, mutateAssistantSetup,
    type AssistantSetupState, type SetupAction, type SetupKey, type SetupCheck, type SetupTarget,
} from './setup';

type Operation = { controller: AbortController; revision: number };
/** Also gates direct component consumers, independently of navigation and lazy-route admission. */
export function AssistantSetupPage() {
    const { data: me } = useMe();
    const auth = useAuthSnapshot();
    const revision = useSyncExternalStore(subscribeAuth, getAuthSessionRevision, getAuthSessionRevision);
    if (!auth.authenticated || me?.is_superuser !== true || String(me.id) !== auth.uid) return <div className="panel panel-pad" role="alert"><h2>Owner access required</h2><p>Assistant setup requires a literal installation superuser signed in as a person.</p></div>;
    return <OwnerSetup key={`${auth.uid}:${revision}`} ownerId={me.id} revision={revision} />;
}
function KeySummary({ label, value, check }: { label: string; value: SetupKey; check: SetupCheck }) {
    return <div className="assistant-setup-key-status"><p><strong>{label} source:</strong> {value.source === 'admin' ? 'Protected Admin storage' : value.source === 'deployment' ? 'Deployment configuration' : 'Not configured'}{value.hint && <span> · server hint: <code>{value.hint}</code></span>}</p><p className="dim">Last stored-key check: {check.ok === null ? 'Not checked' : check.ok ? 'Accepted' : 'Failed'}{check.at && ` · ${check.at}`} · {check.message}</p></div>;
}
function OwnerSetup({ ownerId, revision }: { ownerId: number; revision: number }) {
    const queryClient = useQueryClient();
    const [state, setState] = useState<AssistantSetupState | null>(null);
    const stateRef = useRef(state); stateRef.current = state;
    const [draft, setDraft] = useState(''); const [handlerDraft, setHandlerDraft] = useState('');
    const [modelDraft, setModelDraft] = useState('');
    const [before, setBefore] = useState(''); const [limit, setLimit] = useState('25');
    const [pending, setPending] = useState(''); const [notice, setNotice] = useState(''); const [error, setError] = useState('');
    const [confirmation, setConfirmation] = useState<{ message: string; accept: () => void; cancel: () => void } | null>(null);
    const live = useRef(false); const operation = useRef<Operation | null>(null);
    const platform = useRef<HTMLDetailsElement>(null); const platformTitle = useRef<HTMLElement>(null);
    const validOwner = () => {
        const auth = getAuthSnapshot();
        const me = queryClient.getQueryData<Me>(['me', auth.uid]);
        return live.current && getAuthSessionRevision() === revision && auth.authenticated && auth.uid === String(ownerId) && me?.id === ownerId && me.is_superuser === true;
    };
    const clearDrafts = () => { setDraft(''); setHandlerDraft(''); setBefore(''); setLimit('25'); setModelDraft(''); };
    const dispose = () => {
        operation.current?.controller.abort(); operation.current = null;
        clearDrafts(); setConfirmation(null); setPending(''); setState(null); stateRef.current = null; setNotice(''); setError('');
    };
    const guard = (op: Operation) => {
        if (!validOwner() || operation.current !== op || op.controller.signal.aborted) throw new DOMException('Setup scope ended', 'AbortError');
    };
    const options = (op: Operation) => ({ signal: op.controller.signal, beforeSend: () => guard(op) });
    const apply = (next: AssistantSetupState, op: Operation) => { guard(op); stateRef.current = next; setState(next); setModelDraft(next.model.selected); };
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
            catch { if (validOwner() && operation.current === op) { setState(null); stateRef.current = null; } }
        }
    }
    async function load(probe?: 'models' | 'discovery') {
        const op = begin(probe ? 'Checking…' : 'Loading setup…'); if (!op) return;
        try { apply(await getAssistantSetup(options(op), probe), op); if (probe) { guard(op); setNotice(probe === 'models' ? 'Provider catalogue refreshed.' : 'Discovery check completed. Review its verdict below.'); } }
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
        if (confirm) setConfirmation({ message: confirm, accept: () => { void run(); }, cancel: () => finish(op) });
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
    const saveKey = (target: SetupTarget) => change((current) => assistantSetupSave(current, target === 'assistant' ? { api_key: draft } : { handler_api_key: handlerDraft }), 'Checking and saving key…', undefined, target);
    const clearKey = (target: SetupTarget) => change((current) => assistantSetupSave(current, target === 'assistant' ? { clear_api_key: true } : { clear_handler_api_key: true }), 'Clearing protected key…', 'Clear the protected Admin credential? A deployment credential may become active. Review the returned source after saving.', target);
    const openPlatform = () => { if (platform.current) platform.current.open = true; platformTitle.current?.focus(); };
    return <main className="assistant-setup" aria-labelledby="assistant-setup-title">
        <header className="assistant-setup-header"><div><div className="eyebrow">Installation owner</div><h1 id="assistant-setup-title">AI Assistant setup</h1><p className="dim">Set up your AI Assistant and review the controls that keep it safe.</p></div><button type="button" className="btn" disabled={locked} onClick={() => void load()}>Refresh setup</button></header>
        <div role="status" aria-live="polite">{pending && !confirmation ? pending : notice}</div>
        {error && <div className="assistant-setup-warning" role="alert">{error}</div>}
        {confirmation && <section className="panel panel-pad assistant-setup-confirm" role="group" aria-label="Confirm setup operation"><p>{confirmation.message}</p><div className="assistant-action-row"><button className="btn" type="button" autoFocus onClick={confirmation.cancel}>Cancel</button><button className="btn btn-primary" type="button" onClick={confirmation.accept}>Confirm operation</button></div></section>}
        {state && <>
            <section className="panel panel-pad"><div className="eyebrow">Basic setup</div><h2>{state.enabled && state.route.ready && !state.emergency_stop && state.assistant_installed && state.realtime_installed ? 'Ready to use' : 'Needs attention'}</h2><p>{assistantSetupReadiness(state)}</p>
                <dl className="assistant-setup-facts"><div><dt>Provider</dt><dd>{state.route.provider === 'anthropic' ? 'Anthropic' : state.route.provider === 'bedrock' ? 'AWS Bedrock' : 'Unavailable'}</dd></div><div><dt>Model</dt><dd>{state.route.model || 'Unavailable'}</dd></div><div><dt>Selected credential</dt><dd>{state.route.credential === 'admin' ? 'Assistant key' : state.route.credential === 'handler' ? 'Platform key' : state.route.credential === 'aws' ? 'AWS identity' : 'Unavailable'}</dd></div><div><dt>Deployment configuration</dt><dd>{state.route.ready ? 'Ready' : 'Needs attention'}</dd></div></dl>
                {state.route.credential === 'handler' && <div className="assistant-setup-warning"><p>This deployed route uses the Platform credential. An Assistant key will not supply it.</p><button className="btn" type="button" onClick={openPlatform}>Open Platform credential</button></div>}
                {state.route.credential === 'aws' && <p>The Bedrock route uses deployment AWS identity. Browser key fields do not configure that identity.</p>}
                <KeySummary label="Assistant key" value={state.key} check={state.verify} />
                <label className="assistant-setup-field" htmlFor="assistant-replacement-key">Replacement Assistant key<input id="assistant-replacement-key" className="input" type="password" value={draft} onChange={(event) => setDraft(event.target.value)} autoComplete="new-password" spellCheck={false} maxLength={4096} disabled={locked} aria-describedby="assistant-key-help" /></label>
                <p className="dim" id="assistant-key-help">Write-only replacement. The server checks a new key before storing it. Nothing saves while you type.</p>
                <div className="assistant-action-row"><button type="button" className="btn btn-primary" disabled={locked || !draft.trim()} onClick={() => saveKey('assistant')}>Check and save key</button><button type="button" className="btn" disabled={locked} onClick={() => change(() => ({ action: 'verify', target: 'assistant' }), 'Checking current key…')}>Check current key</button><button type="button" className="btn" disabled={locked || state.key.source !== 'admin'} onClick={() => clearKey('assistant')}>Clear stored Assistant key</button></div>
                <div className="assistant-setup-switch"><span>Assistant is <strong>{state.enabled ? 'enabled' : 'disabled'}</strong>. Enabling does not override deployment policy or emergency stops.</span><button className="btn" type="button" disabled={locked} onClick={() => change((current) => assistantSetupSave(current, { enabled: !current.enabled }), 'Saving Assistant switch…')}>{state.enabled ? 'Disable Assistant' : 'Enable Assistant'}</button></div>
            </section>
            <p className="dim">Advanced controls · deployment, safety, remote access and incident processing</p>
            <details className="panel assistant-setup-advanced" ref={platform}><summary ref={platformTitle} tabIndex={0}>Platform credential</summary><div className="panel-pad">
                <p>Used only by deployed routes selecting <code>handler</code>. Credentials never substitute for one another.</p><KeySummary label="Platform key" value={state.handler_key} check={state.handler_verify} />
                <label className="assistant-setup-field" htmlFor="handler-replacement-key">Replacement Platform key<input id="handler-replacement-key" className="input" type="password" value={handlerDraft} onChange={(event) => setHandlerDraft(event.target.value)} autoComplete="new-password" spellCheck={false} maxLength={4096} disabled={locked} /></label>
                <div className="assistant-action-row"><button className="btn btn-primary" type="button" disabled={locked || !handlerDraft.trim()} onClick={() => saveKey('handler')}>Check and save Platform key</button><button className="btn" type="button" disabled={locked} onClick={() => change(() => ({ action: 'verify', target: 'handler' }), 'Checking Platform key…')}>Check current Platform key</button><button className="btn" type="button" disabled={locked || state.handler_key.source !== 'admin'} onClick={() => clearKey('handler')}>Clear stored Platform key</button></div>
            </div></details>
            <details className="panel assistant-setup-advanced"><summary>Deployed policy and safety</summary><div className="panel-pad">
                <p>Policy status: {state.route.error || 'Ready'}. Deployment owns policy content and the runtime route. Activation acknowledges the policy on this node; it cannot establish fleet-wide agreement.</p><button type="button" className="btn" disabled={locked} onClick={() => change(() => ({ action: 'activate_policy' }), 'Activating policy…', 'Acknowledge the currently deployed policy on this node? This does not edit policy content, check other nodes or release an emergency stop.')}>Acknowledge deployed policy</button>
                <dl className="assistant-setup-facts"><div><dt>Deployment stop (read-only)</dt><dd>{state.emergency_stop_static ? 'On' : 'Off'}</dd></div><div><dt>Database stop</dt><dd>{state.emergency_stop_database ? 'On' : 'Off'}</dd></div><div><dt>Effective stop</dt><dd>{state.emergency_stop ? 'On' : 'Off'}</dd></div></dl>
                <button type="button" className="btn" disabled={locked} onClick={() => change((current) => assistantSetupSave(current, { emergency_stop: !current.emergency_stop_database }), 'Saving database stop…', 'Change only the database emergency stop? A deployment stop remains authoritative.')}>{state.emergency_stop_database ? 'Release database stop' : 'Set database stop'}</button>
                <h3>Requests · last {state.safety.hours || 24} hours</h3>{state.safety.error && <p role="alert">Safety statistics unavailable.</p>}
                <div className="assistant-table-scroll"><table><caption>Guarded request aggregates</caption><thead><tr><th>Provider / feature</th><th>Status</th><th>Requests</th><th>Tokens in / out</th></tr></thead><tbody>{state.safety.requests.map((row, i) => <tr key={i}><td>{row.provider} / {row.feature}</td><td>{row.status}</td><td>{row.requests}</td><td>{row.input_tokens} / {row.output_tokens}</td></tr>)}</tbody></table></div>
                <h3>Circuit breakers</h3><div className="assistant-table-scroll"><table><caption>Breaker state by provider</caption><thead><tr><th>Provider</th><th>State</th><th>Error</th><th>Count</th></tr></thead><tbody>{state.safety.breakers.map((row, i) => <tr key={i}><td>{row.provider}</td><td>{row.state}</td><td>{row.error_code || 'None'}</td><td>{row.count}</td></tr>)}</tbody></table></div>
                <div className="assistant-action-row">{(['all', 'anthropic', 'bedrock'] as const).map((provider) => <button key={provider} type="button" className="btn" disabled={locked} onClick={() => change(() => ({ action: 'reset_breaker', ...(provider === 'all' ? {} : { provider }) }), 'Resetting breakers…', `Reset ${provider} circuit breakers? Requests may try again; policy and emergency stops remain enforced.`)}>Reset {provider} breakers</button>)}</div>
                <h3>Legacy model pin</h3><p className="dim">This picker does not control the guarded runtime route. Refreshing the catalogue explicitly contacts the provider.</p><label className="assistant-setup-field" htmlFor="assistant-model-pin">Legacy model identifier<input className="input" id="assistant-model-pin" value={modelDraft} onChange={(event) => setModelDraft(event.target.value)} disabled={locked} list="assistant-model-choices" maxLength={81} /></label><datalist id="assistant-model-choices">{state.model.choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</datalist><div className="assistant-action-row"><button className="btn" type="button" disabled={locked} onClick={() => change((current) => assistantSetupSave(current, { model: modelDraft }), 'Saving legacy model pin…')}>Save legacy model pin</button><button className="btn" type="button" disabled={locked} onClick={() => void load('models')}>Refresh provider catalogue</button></div>
            </div></details>
            <details className="panel assistant-setup-advanced"><summary>Remote agent access and connections</summary><div className="panel-pad"><p>Remote agents can receive Tools, Full API or both kinds of access according to their grants. Full API access carries the signed-in user’s API authority. Turning access off pauses connections without revoking them.</p>
                <p>Remote access is <strong>{state.mcp.enabled ? 'on' : 'off'}</strong>.</p><button type="button" className="btn" disabled={locked} onClick={() => change((current) => assistantSetupSave(current, { mcp_enabled: !current.mcp.enabled }), 'Saving remote access…', 'Change remote agent access? Existing grants are retained; Disconnect revokes them.')}>{state.mcp.enabled ? 'Pause remote access' : 'Enable remote access'}</button>
                <label className="assistant-setup-field" htmlFor="assistant-connect-address">Connect address (select to copy)<input id="assistant-connect-address" className="input" value={state.mcp.url} readOnly onFocus={(event) => event.target.select()} /></label><p className="dim">{state.mcp.discovery_url || 'No public discovery address configured.'}</p>
                <button type="button" className="btn" disabled={locked} onClick={() => void load('discovery')}>Check public discovery</button><p role={state.mcp.discovery.ok === false ? 'alert' : undefined}>Discovery: {state.mcp.discovery.ok === null ? 'Not checked' : state.mcp.discovery.ok ? 'Reachable' : 'Failed'} · {state.mcp.discovery.detail}{state.mcp.discovery.checked_at && ` · ${state.mcp.discovery.checked_at}`}</p>
                <h3>Connected agents · {state.mcp.grant_count} total</h3><p className="dim">Showing {state.mcp.grants.length} connections, capped at 200. Disconnect all spans Tools and Full API grants for every user.</p><div className="assistant-table-scroll"><table><caption>Remote connections</caption><thead><tr><th>Client / user</th><th>Access</th><th>Last used / expires</th><th>Connection</th></tr></thead><tbody>{state.mcp.grants.map((row) => <tr key={row.id}><td>{row.client.name || row.client.client_id}<br />{row.user.display_name || row.user.email}</td><td>{row.access === 'api' ? 'Full API' : row.access === 'both' ? 'Tools and Full API' : 'Tools'}</td><td>{row.last_used || 'Not used'}<br />{row.expires}</td><td><button type="button" className="btn" disabled={locked} onClick={() => change(() => ({ action: 'revoke_grant', grant_id: row.id }), 'Disconnecting agent…', `Disconnect ${row.client.name || 'this agent'} for ${row.user.display_name || row.user.email}? A new authorization is required to reconnect.`)}>Disconnect #{row.id}</button></td></tr>)}</tbody></table></div><button type="button" className="btn" disabled={locked || state.mcp.grant_count === 0} onClick={() => change(() => ({ action: 'revoke_all_grants' }), 'Disconnecting all agents…', 'Disconnect every remote Tools and Full API grant, for every user? New authorizations will be required.')}>Disconnect all agents</button>
            </div></details>
            <details className="panel assistant-setup-advanced"><summary>Incident triage</summary><div className="panel-pad"><p>Autonomous incident triage is <strong>{state.autonomous_triage ? 'on' : 'off'}</strong>. Enabling establishes a no-history watermark; older incidents need an explicit historical run.</p><p>Watermark: {state.autonomous_triage_activated_at || 'Not activated'}</p><button type="button" className="btn" disabled={locked} onClick={() => change((current) => assistantSetupSave(current, { autonomous_triage: !current.autonomous_triage }), 'Saving autonomous triage…', 'Change autonomous incident triage? New activation establishes a watermark; it does not queue older incidents.')}>{state.autonomous_triage ? 'Disable autonomous triage' : 'Enable autonomous triage'}</button>
                <h3>Historical incident triage</h3><label className="assistant-setup-field" htmlFor="assistant-triage-before">Incidents before (local time)<input className="input" id="assistant-triage-before" type="datetime-local" value={before} onChange={(event) => setBefore(event.target.value)} disabled={locked} /></label><label className="assistant-setup-field" htmlFor="assistant-triage-limit">Maximum incidents (1–100)<input className="input" id="assistant-triage-limit" type="number" min={1} max={100} step={1} value={limit} onChange={(event) => setLimit(event.target.value)} disabled={locked} /></label><button type="button" className="btn" disabled={locked || !before || !Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 100} onClick={() => change(() => ({ action: 'historical_triage', before: new Date(before).toISOString(), limit: Number(limit) }), 'Queueing historical triage…', `Queue up to ${limit} incidents before ${before}? This explicitly processes historical incidents and can incur provider cost.`)}>Queue historical triage</button>
            </div></details>
        </>}
    </main>;
}
