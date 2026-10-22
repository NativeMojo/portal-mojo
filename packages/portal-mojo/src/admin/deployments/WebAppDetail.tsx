import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMe } from '../../client/runtime';
import { modal } from '../../ui/modal';
import { Tabs } from '../../ui/Tabs';
import { datetime } from '../../ui/format';
import { ModelTable, type ModelTableQueryAdapterProps } from '../../ui/ModelTable';
import { backendGlobalCan } from '../fleet/access';
import { getAttempt, getDeployment, getHealth, getHistory, getMember, getSummary, getWebApp } from './api';
import { assertOwner, canReadWebApps, isInteractive, webAppAuthority, type DeploymentOwner } from './permissions';
import { rollbackEligible } from './deployment-state';
import { useDeploymentOwner } from './useDeploymentObservation';
import { DeploymentHelp, ErrorNotice, Facts, Status, useCloseOnOwnerChange } from './shared';
import { useAppActionsRefused } from './authority-state';
import { appUnsettled, receiptsFor, settleReceipt } from './receipts';
import type { Attempt, Release, DeploymentsDestinations } from './types';

const DeploySetup = lazy(() => import('./WebAppDeploySetup').then(module => ({ default: module.WebAppDeploySetup })));

export function WebAppDetail({ id, onClose, destinations }: {
    id: number;
    onClose: () => void;
    destinations?: DeploymentsDestinations;
}) {
    const me = useMe(), s = useDeploymentOwner(), client = useQueryClient();
    const [health, setHealth] = useState(''), [healthBusy, setHealthBusy] = useState(false);
    const read = canReadWebApps(me.data) && isInteractive();
    useCloseOnOwnerChange(s.key, onClose);
    const summary = useQuery({ queryKey: ['deployments', s.key, id, 'summary'], queryFn: ({ signal }) => getSummary(s.owner, id, signal), enabled: read, retry: false });
    const object = useQuery({ queryKey: ['deployments', s.key, id, 'default'], queryFn: ({ signal }) => getWebApp(s.owner, id, signal), enabled: read, retry: false });
    const globalAuthority = backendGlobalCan(me.data, ['manage_webapp']) && backendGlobalCan(me.data, ['manage_dns', 'security']);
    const member = useQuery({ queryKey: ['deployments', s.key, id, 'member', object.data?.group.id], queryFn: ({ signal }) => getMember(s.owner, object.data!.group.id, signal), enabled: read && !!object.data && !globalAuthority, retry: false });
    const actionsRefused = useAppActionsRefused(s.owner, id);
    const authority = object.data ? webAppAuthority(me.data, object.data, member.data) : { read: false, custom: false, release: false, workflow: false };
    if (actionsRefused) { authority.custom = false; authority.release = false; authority.workflow = false; }
    const app = summary.data, group = object.data?.group.id ?? 0;
    const latest = useQuery({ queryKey: ['deployments', s.key, id, 'latest-attempt', app?.latest_deployment?.id], queryFn: ({ signal }) => getAttempt(s.owner, app!.latest_deployment!.id, id, signal), enabled: read && !!app?.latest_deployment && !app.latest_deployment.release, retry: false });
    const refresh = async () => { await client.invalidateQueries({ queryKey: ['deployments', s.key] }); };
    useEffect(() => {
        const receipt = appUnsettled(s.owner, id);
        if (authority.release && receipt?.deployment && receipt.release) void getDeployment(s.owner, receipt.deployment, id, receipt.release, s.signal).then(result => { if (result.terminal) settleReceipt(receipt); }).catch(() => {});
    }, [s.key, id, summary.dataUpdatedAt, authority.release]);
    const inspectAttempt = async (attempt: Attempt) => {
        if (!object.data) return;
        const { WebAppDeploymentDetail } = await import('./WebAppDeploymentDetail'); assertOwner(s.owner, s.signal);
        await modal.open(close => <WebAppDeploymentDetail app={object.data!} attempt={attempt} detailedAllowed={authority.release} onChanged={() => void refresh()} onClose={() => close(null)}/>, { signal: s.signal, size: 'lg' });
    };
    const launchRollback = async (release: Release) => {
        if (!object.data || !authority.custom) return;
        const { WebAppRollbackDialog } = await import('./WebAppRollbackDialog'); assertOwner(s.owner, s.signal); let busy = false;
        await modal.open(close => <WebAppRollbackDialog app={object.data!} release={release} onChanged={() => void refresh()} onClose={() => close(null)} onBusy={value => { busy = value; }}/>, { signal: s.signal, canDismiss: () => !busy, size: 'lg' });
    };
    const launchKey = async (action: 'mint' | 'rotate' | 'revoke') => {
        if (!object.data || !authority.custom) return;
        const { WebAppKeyDialog } = await import('./WebAppKeyDialog'); assertOwner(s.owner, s.signal); let busy = false;
        await modal.open(close => <WebAppKeyDialog app={object.data!} action={action} onChanged={() => void refresh()} onClose={() => close(null)} onBusy={value => { busy = value; }}/>, { signal: s.signal, canDismiss: () => !busy });
    };
    const edit = async () => {
        if (!object.data || !authority.release) return;
        const { WebAppEditDialog } = await import('./WebAppEditDialog'); assertOwner(s.owner, s.signal); let busy = false;
        await modal.open(close => <WebAppEditDialog app={object.data!} onChanged={() => void refresh()} onClose={() => close(null)} onBusy={value => { busy = value; }}/>, { signal: s.signal, canDismiss: () => !busy, size: 'md' });
    };
    const resume = async () => {
        const { WebAppOnboardingDialog } = await import('./WebAppOnboardingDialog'); assertOwner(s.owner, s.signal); let busy = false;
        await modal.open(close => <WebAppOnboardingDialog destinations={destinations} resume={receiptsFor(s.owner).find(receipt => receipt.kind === 'create' && receipt.app === id)} onChanged={() => void refresh()} onClose={() => close(null)} onBusy={value => { busy = value; }}/>, { signal: s.signal, canDismiss: () => !busy, size: 'lg' });
    };
    const checkHealth = async () => {
        if (healthBusy || !group) return;
        setHealthBusy(true);
        try { const result = await getHealth(s.owner, id, group, s.signal); assertOwner(s.owner, s.signal); setHealth(`${result.status}: ${result.detail}${result.checked ? ` · ${datetime(result.checked)}` : ''}`); }
        catch { if (!s.signal.aborted) setHealth('Observation unavailable. Reachability is unconfirmed.'); }
        finally { if (!s.signal.aborted) setHealthBusy(false); }
    };
    if (!read || summary.isError || object.isError) return <div className="modal-pad admin-deployments"><h2 className="modal-title">WebApp unavailable</h2><ErrorNotice>App evidence could not be read. No app actions are available.</ErrorNotice><div className="modal-actions"><button className="btn" onClick={onClose}>Close</button>{read && <button className="btn" onClick={() => void refresh()}>Refresh app</button>}</div></div>;
    if (!app || !object.data) return <div className="modal-pad admin-deployments"><p role="status">Loading WebApp…</p><button className="btn" onClick={onClose}>Close</button></div>;
    const attempted = app.latest_deployment?.release ?? latest.data?.release;
    const historyContext = { owner: s.owner, scopeKey: s.key, app: id };
    const setupIncomplete = app.onboarding.status !== 'succeeded', pending = appUnsettled(s.owner, id);
    return <div className="modal-pad admin-deployments deployment-dialog">
        <header className="deployment-dialog-header"><div className="deployment-dialog-heading"><h2 className="modal-title">{app.webapp.display_name || app.webapp.slug}</h2><p className="dim">{app.address?.hostname || 'No public address'}</p></div><div className="deployment-row-actions"><button className="btn" disabled={summary.isFetching || object.isFetching} onClick={() => void refresh()}>Refresh app</button><button className="btn" aria-label="Close WebApp" onClick={onClose}><i className="bi bi-x-lg" aria-hidden="true"/></button></div></header>
        <Tabs ariaLabel="WebApp tasks" items={[
            { key: 'overview', label: 'Overview', panel: <div>
                <div className="deployment-summary-grid"><section><h3>Desired version <DeploymentHelp label="desired version">The saved release pointer describes desired content. It does not prove that every node is serving it.</DeploymentHelp></h3><strong className="mono">{app.current_release?.version || 'No release'}</strong></section><section><h3>Latest deployment</h3>{app.latest_deployment ? <><strong className="mono">{attempted?.version || (latest.isError ? 'Version unavailable' : 'Loading version…')}</strong><p><Status value={app.latest_deployment.status}/></p><button className="btn" onClick={() => void inspectAttempt(latest.data ?? app.latest_deployment!)}>Inspect deployment</button></> : <p className="dim">No deployment attempts.</p>}</section></div>
                {setupIncomplete && <section className="deployment-confirm"><h3>Setup {app.onboarding.status}</h3>{receiptsFor(s.owner).some(receipt => receipt.kind === 'create' && receipt.app === id) ? <button className="btn" onClick={() => void resume()}>Resume saved setup</button> : <p className="dim">No matching saved setup receipt is available in this browser. Existing resources are preserved.</p>}</section>}
                {pending && <p role="status" className="text-warn">{pending.kind === 'create' ? 'Finish or cancel saved setup before starting another change.' : 'A submitted operation has an unconfirmed outcome. Inspect its deployment before starting another change.'}</p>}
                <Facts rows={[["Environment", app.webapp.environment], ["HTTPS certificate", app.address?.certificate?.status || 'Not configured']]}/>
            </div> },
            { key: 'deployments', label: 'Deployments', panel: <HistoryContext.Provider value={historyContext}><ModelTable<Release | Attempt> endpoint="/api/edge/deployment" title="Deployment attempts" paramsMode="local" searchable={false} defaultParams={{ size: 15 }} fixedParams={{ webapp: id, graph: 'list' }} queryAdapter={AttemptRows} onRowClick={row => void inspectAttempt(row as Attempt)} columns={[{ key: 'release', label: 'Version', render: row => (row as Attempt).release?.version || 'Unobserved' }, { key: 'status', label: 'Outcome', render: row => <Status value={row.status}/> }, { key: 'created', label: 'Started', render: row => datetime(row.created) }]}/></HistoryContext.Provider> },
            { key: 'releases', label: 'Releases', panel: <HistoryContext.Provider value={historyContext}><ModelTable<Release | Attempt> endpoint="/api/edge/release" title="Registered releases" paramsMode="local" searchable={false} defaultParams={{ size: 25 }} fixedParams={{ webapp: id, graph: 'list' }} queryAdapter={ReleaseRows} columns={[{ key: 'version', label: 'Version', render: row => <span className="mono">{(row as Release).version}{row.id === app.current_release?.id && <small className="dim"> · desired</small>}</span> }, { key: 'status', label: 'Verification', render: row => <Status value={row.status}/> }, { key: 'created', label: 'Registered', render: row => datetime(row.created) }, ...(authority.custom ? [{ key: 'action', label: '', render: (row: Release | Attempt) => rollbackEligible(row as Release, app.current_release) ? <button className="btn" disabled={!!appUnsettled(s.owner, id)} onClick={() => void launchRollback(row as Release)}>Roll back</button> : null }] : [])]}/></HistoryContext.Provider> },
            ...(authority.workflow || authority.release || authority.custom ? [{ key: 'deploy', label: 'Deploy', panel: <Suspense fallback={<p role="status">Loading deployment methods…</p>}><DeploySetup app={object.data} workflowAllowed={authority.workflow} releaseAllowed={authority.release} keyAllowed={authority.custom} deploymentKey={app.deployment_key} onChanged={() => void refresh()} onKey={action => void launchKey(action)}/></Suspense> }] : []),
            { key: 'settings', label: 'Settings', panel: <div><div className="deployment-toolbar"><h3>App profile</h3>{authority.release && <button className="btn" onClick={() => void edit()}>Edit app</button>}</div><Facts rows={[["Name", app.webapp.display_name], ["Environment", app.webapp.environment], ["Repository", app.webapp.repository || 'Not configured'], ["Branch", app.webapp.deployment_ref], ["Build output", app.webapp.build_output]]}/><h3>Address & HTTPS</h3><Facts rows={[["Address", app.address?.hostname || 'Not configured'], ["Certificate", app.address?.certificate?.status || 'Not configured'], ["Expires", app.address?.certificate?.not_after ? datetime(app.address.certificate.not_after) : 'Unknown']]}/><div className="deployment-row-actions">{(['domains', 'serving'] as const).map(key => { const path = destinations?.[key]; return path && /^\/[a-z0-9/_-]+$/i.test(path) ? <Link key={key} className="btn" to={path} onClick={onClose}>{key === 'domains' ? 'Open Domains' : 'Open Serving'}</Link> : null; })}{authority.read && <button className="btn" disabled={!group || healthBusy} onClick={() => void checkHealth()}>{healthBusy ? 'Checking HTTPS…' : 'Check HTTPS'}</button>}</div>{health && <p role="status">{health}</p>}{member.isError && !globalAuthority && <p className="dim">Workspace action authority could not be confirmed. Read-only app evidence remains available.</p>}</div> },
        ]}/>
    </div>;
}

const HistoryContext = createContext<{ owner: DeploymentOwner; scopeKey: string; app: number } | null>(null);
function HistoryRows({ params, enabled, children, kind }: { kind: 'release' | 'deployment' } & ModelTableQueryAdapterProps<Release | Attempt>) {
    const context = useContext(HistoryContext)!;
    const query = useQuery({ queryKey: ['deployments', context.scopeKey, context.app, kind, params.start, params.size], queryFn: ({ signal }) => getHistory(context.owner, context.app, kind, Number(params.start) || 0, signal, Number(params.size) || (kind === 'release' ? 25 : 15)), enabled, retry: false });
    return children({ data: query.data ? { rows: query.data.items, count: query.data.count } : undefined, status: query.status, isFetching: query.isFetching, error: query.error, refetch: query.refetch });
}
function ReleaseRows(props: ModelTableQueryAdapterProps<Release | Attempt>) { return <HistoryRows {...props} kind="release"/>; }
function AttemptRows(props: ModelTableQueryAdapterProps<Release | Attempt>) { return <HistoryRows {...props} kind="deployment"/>; }
