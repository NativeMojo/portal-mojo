import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMe } from '../../client/runtime';
import { modal } from '../../ui';
import {
    FLEET_ENDPOINT, displayFleetValue, fleetChange, fleetIsHealthy, operationFinished,
    readFleet, readFleetHistory, readFleetOperation, writeFleet,
    type FleetChanges, type FleetEntry, type FleetOperation, type FleetPublication, type FleetReport, type FleetState,
} from './data';

function SettingInput({ entry, disabled }: { entry: FleetEntry; disabled: boolean }) {
    const [mode, setMode] = useState('keep');
    const current = entry.sensitive ? (entry.configured ? 'Configured (hidden)' : 'Not configured') : displayFleetValue(entry.current);
    const initial = entry.sensitive ? '' : entry.value_type === 'string' ? String(entry.current ?? '')
        : entry.value_type === 'boolean' ? String(entry.current === true)
        : entry.current == null ? '' : JSON.stringify(entry.current);
    const control = { name: `${entry.key}:value`, className: 'input', disabled, defaultValue: initial };
    return <div className="panel panel-pad" style={{ minWidth: 0 }}>
        <h3>{entry.label}</h3><p className="dim">{entry.description}</p>
        <p style={{ overflowWrap: 'anywhere' }}><b>Current:</b> {current}</p>
        {!entry.sensitive && <p className="dim">Default: {displayFleetValue(entry.default)}</p>}
        <p><span className="badge">{entry.restart_required ? 'Restart required' : 'No restart required'}</span></p>
        <label className="field"><span className="field-label">Proposed change for {entry.label}</span>
            <select className="input" name={`${entry.key}:mode`} value={mode} disabled={disabled} onChange={(event) => setMode(event.target.value)}>
                <option value="keep">Keep current value</option><option value="set">{entry.sensitive ? 'Replace secret' : 'Set value'}</option>
                {entry.overridden && <option value="clear">Remove published override</option>}
            </select>
        </label>
        {mode === 'set' && <label className="field"><span className="field-label">{entry.sensitive ? 'Secret replacement' : 'Proposed value'}</span>
            {entry.value_type === 'boolean' ? <select {...control}><option value="true">True</option><option value="false">False</option></select>
                : entry.value_type === 'list' || entry.value_type === 'object' ? <textarea {...control} rows={4} autoComplete="off" spellCheck={false} />
                    : <input {...control} type={entry.sensitive ? 'password' : entry.value_type === 'integer' ? 'number' : 'text'}
                        autoComplete="off" spellCheck={false} min={entry.min_value ?? undefined} max={entry.max_value ?? undefined} maxLength={entry.max_length} step={1} />}
            <span className="field-help">{entry.sensitive ? 'Leave blank to preserve the existing secret. Secrets are never shown in history.'
                : entry.value_type === 'list' || entry.value_type === 'object' ? `Enter a JSON ${entry.value_type}; at most ${entry.max_items ?? 100} entries.` : 'Validated again by the server before publication.'}</span>
        </label>}
        {mode === 'clear' && <p className="text-warn">Removes this published override; the node’s base configuration or application default will apply.</p>}
    </div>;
}

function FleetEditor({ state, busy, publish }: { state: FleetState; busy: boolean; publish: (changes: FleetChanges) => Promise<void> }) {
    const form = useRef<HTMLFormElement>(null);
    const [error, setError] = useState('');
    const sections = [...new Set(state.entries.map((entry) => entry.section))];
    const submit = async (event: React.FormEvent) => {
        event.preventDefault(); setError('');
        try {
            const fields = new FormData(form.current!);
            const changes: FleetChanges = {};
            for (const entry of state.entries) {
                const change = fleetChange(entry, String(fields.get(`${entry.key}:mode`) ?? 'keep'), String(fields.get(`${entry.key}:value`) ?? ''));
                if (change) changes[entry.key] = change;
            }
            if (!Object.keys(changes).length) { setError('Choose at least one change before publishing.'); return; }
            await publish(changes);
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not publish configuration'); }
    };
    return <form ref={form} onSubmit={submit}>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            {sections.map((section) => <section key={section} style={{ marginBottom: 20 }}><h2>{section}</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 12 }}>
                    {state.entries.filter((entry) => entry.section === section).map((entry) => <SettingInput key={entry.key} entry={entry} disabled={busy} />)}
                </div></section>)}
            {!state.entries.length && <p>No settings have been registered and delegated for this application.</p>}
            {error && <p className="form-alert" role="alert">{error}</p>}
            <button className="btn btn-primary" type="submit" disabled={busy || !state.publish_configured || !state.entries.length}>Publish</button>
        </fieldset>
    </form>;
}

export function FleetNodeStatus({ report, revision }: { report: FleetReport; revision: string | null }) {
    const healthy = fleetIsHealthy(report);
    return <section className="panel panel-pad" aria-label="Fleet convergence" style={{ marginTop: 20 }}>
        <h2>Fleet convergence</h2><p role="status" className={healthy ? 'text-ok' : 'text-warn'}>
            {healthy ? 'Applied and healthy on every expected node' : `Not confirmed healthy everywhere — ${report.status}`}</p>
        <p className="dim" style={{ overflowWrap: 'anywhere' }}>Target revision: {revision ?? 'Not published'}{report.observed_at ? ` · Observed ${report.observed_at}` : ''}</p>
        {report.error_code && <p className="form-alert">{report.error_code}</p>}
        {!report.nodes.length ? <p>No node results are available. Publication alone does not establish fleet health.</p>
            : <div className="tbl-scroll"><table className="tbl"><thead><tr><th>Node</th><th>Published</th><th>Downloaded / installed</th><th>Restart</th><th>Healthy</th><th>Result</th></tr></thead>
                <tbody>{report.nodes.map((node) => <tr key={node.hostname}><td>{node.hostname}</td><td>{node.published ? 'Yes' : 'Unconfirmed'}</td>
                    <td>{node.installed ? 'Yes' : 'Unconfirmed'}</td><td>{node.restarted ? 'Confirmed' : node.restart_requested ? 'Requested' : 'Unconfirmed'}</td>
                    <td>{node.healthy && node.installed && node.restarted && !node.error_code ? 'Yes' : 'Unconfirmed'}</td><td>{node.error_code ?? node.status}</td></tr>)}</tbody></table></div>}
        <p className="dim">Health verifies the request service where enabled, plus the job engine and scheduler. Worker-only nodes do not require a request service. Offline or missing nodes remain unconfirmed.</p>
    </section>;
}

function FleetContent({ userId }: { userId: number }) {
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [editorEpoch, setEditorEpoch] = useState(0);
    const [operationId, setOperationId] = useState<string | null>(null);
    const queryKey = [FLEET_ENDPOINT, userId];
    const stateQuery = useQuery({ queryKey, queryFn: readFleet, refetchOnWindowFocus: false, retry: false });
    const history = useQuery({ queryKey: [...queryKey, 'history'], queryFn: readFleetHistory, retry: false });
    const operation = useQuery({ queryKey: [...queryKey, 'operation', operationId], enabled: operationId != null,
        queryFn: () => readFleetOperation(operationId!), retry: false,
        refetchInterval: (query) => query.state.error || (query.state.data && operationFinished(query.state.data)) ? false : 3000 });
    const state = stateQuery.data;
    const refresh = async () => { await Promise.all([stateQuery.refetch(), history.refetch(), ...(operationId ? [operation.refetch()] : [])]); };
    const run = async (task: () => Promise<void>) => {
        setBusy(true); setError(''); setNotice('');
        try { await task(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Fleet operation failed'); }
        finally { setBusy(false); }
    };
    const publish = async (changes: FleetChanges) => {
        if (!state || !await modal.confirm({ title: 'Publish fleet configuration?',
            message: `Publish changes to ${Object.keys(changes).join(', ')}? Config-sync timers will download the new configuration and may restart services. Publication does not confirm that nodes are healthy.`, confirmText: 'Publish' })) return;
        await run(async () => {
            const result = await writeFleet<FleetPublication>({ action: 'publish', expected_revision: state.revision, changes });
            if (result.published !== true) throw new Error('Publication was not confirmed. Reload to check the current revision.');
            setOperationId(null); setEditorEpoch((value) => value + 1); setNotice('Published to S3. Node application and health are still pending.'); await refresh();
        });
    };
    const apply = async () => {
        if (!state || !await modal.confirm({ title: 'Apply configuration now?', message: 'Ask every expected node to run its configured sync service now. Services may restart. Results will appear below.', confirmText: 'Apply now' })) return;
        await run(async () => {
            const result = await writeFleet<FleetOperation>({ action: 'apply', expected_revision: state.revision });
            if (!result.operation_id) throw new Error('No apply operation was returned. Refresh node status before retrying.');
            queryClient.setQueryData([...queryKey, 'operation', result.operation_id], result);
            setOperationId(result.operation_id); setNotice('Apply requested. Waiting for each node to confirm its result.');
        });
    };
    const restore = async (versionId: string) => {
        if (!state || !await modal.confirm({ title: 'Restore previous version?', message: 'Publish this previous configuration as a new revision, including its stored secret values. Config-sync timers may restart services. Node health must be checked separately.', confirmText: 'Restore previous version' })) return;
        await run(async () => {
            const result = await writeFleet<FleetPublication>({ action: 'restore', expected_revision: state.revision, version_id: versionId });
            if (result.published !== true) throw new Error('Restore was not confirmed. Reload to check the current revision.');
            setOperationId(null); setEditorEpoch((value) => value + 1); setNotice('Previous version published as a new revision. Node application and health are still pending.'); await refresh();
        });
    };
    if (!state) return <div className="panel panel-pad"><h1>Fleet Configuration</h1><p role="alert">{stateQuery.error?.message ?? 'Loading configuration…'}</p>
        {stateQuery.error && <button className="btn" onClick={() => void refresh()}>Retry</button>}</div>;
    const tracked = operationId && operation.data?.revision === state.revision ? operation.data : null;
    const evidence = tracked && (!operationFinished(tracked) || Date.parse(tracked.observed_at ?? '') > Date.parse(state.fleet.observed_at ?? '')) ? tracked : state.fleet;
    const report = stateQuery.error || operation.error ? { ...evidence, status: 'observation_unavailable', healthy_everywhere: false,
        nodes: evidence.nodes.map((node) => ({ ...node, healthy: false })) } : evidence;
    return <div className="page" style={{ minWidth: 0, overflowWrap: 'anywhere' }}><header className="page-header"><div><h1>Fleet Configuration</h1>
        <p className="dim">Publish registered application settings and track their application across your nodes.</p></div></header>
        <div className="panel panel-pad" style={{ marginBottom: 20 }}><p style={{ overflowWrap: 'anywhere' }}><b>Published to S3:</b> {state.published ? state.revision : 'Not yet published'}</p>
            <p className="dim">This request’s node loaded revision: {state.loaded_revision ?? 'Not reported'}</p>
            {!state.publish_configured && <p className="form-alert">Publishing is unavailable until the fleet configuration location, encryption and delegated settings are configured.</p>}
            <button className="btn" disabled={busy || stateQuery.isFetching} onClick={() => void refresh()}>Refresh status</button>{' '}
            <button className="btn" disabled={busy || !state.revision || (operation.data != null && !operationFinished(operation.data))} onClick={() => void apply()}>Apply now</button>
            {notice && <p role="status">{notice}</p>}{(error || stateQuery.error) && <p className="form-alert" role="alert">{error || stateQuery.error?.message}</p>}
        </div>
        <FleetEditor key={`${state.revision ?? 'unpublished'}:${editorEpoch}`} state={state} busy={busy} publish={publish} />
        {operation.error && <p className="form-alert" role="alert">Apply status could not be refreshed: {operation.error.message}. Refresh status to check nodes; prior results are not current confirmation.</p>}
        {tracked && <p role="status">Apply operation: {tracked.status}</p>}
        <FleetNodeStatus report={report} revision={state.revision} />
        <section className="panel panel-pad" style={{ marginTop: 20 }}><h2>Version history</h2>
            {history.error && <p className="form-alert">{history.error.message}</p>}
            {history.isPending && <p>Loading versions…</p>}
            {history.data?.versions.map((version) => <div key={version.version_id} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, alignItems: 'center' }}>
                <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{version.published_at ?? 'Time unavailable'} · {version.version_id}{version.current ? ' (current)' : ''}</span>
                {!version.current && <button className="btn" disabled={busy || !state.publish_configured} onClick={() => void restore(version.version_id)}>Restore previous version</button>}
            </div>)}
            {history.data?.versions.length === 0 && <p>No previous versions are available.</p>}
            {history.data?.truncated && <p className="dim">Only the most recent available versions are shown.</p>}
        </section></div>;
}

export function FleetConfigurationPage() {
    const { data: me, isLoading } = useMe();
    if (isLoading) return <p>Checking access…</p>;
    if (me?.is_superuser !== true) return <div className="panel panel-pad">Fleet Configuration requires a superuser account.</div>;
    return <FleetContent key={me.id} userId={me.id} />;
}
