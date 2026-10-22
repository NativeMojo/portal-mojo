import { createContext, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMe } from '../../client/runtime';
import { modal } from '../../ui/modal';
import { DetailView } from '../../ui/DetailView';
import { ModelTable, type ModelTableQueryAdapterProps } from '../../ui/ModelTable';
import { backendGlobalCan } from '../fleet/access';
import { getDeployment, getHealth, getHistory, getMember, getSummary, getWebApp } from './api';
import { assertOwner, canReadWebApps, isInteractive, webAppAuthority, type DeploymentOwner } from './permissions';
import { useDeploymentOwner } from './useDeploymentObservation';
import { Facts, Status, useCloseOnOwnerChange } from './shared';
import { useAppActionsRefused } from './authority-state';
import { appUnsettled, receiptsFor, settleReceipt } from './receipts';
import type { Attempt, Release, DeploymentsDestinations } from './types';
export function WebAppDetail({ id, onClose, destinations }: {
    id: number;
    onClose: () => void;
    destinations?: DeploymentsDestinations;
}) {
    const me = useMe(), s = useDeploymentOwner(), [health, setHealth] = useState(''), [Setup, setSetup] = useState<typeof import('./WebAppDeploySetup').WebAppDeploySetup | null>(null);
    const read = canReadWebApps(me.data) && isInteractive();
    useCloseOnOwnerChange(s.key, onClose);
    const summary = useQuery({
        queryKey: ['deployments', s.key, id, 'summary'], queryFn: ({ signal }) => getSummary(s.owner, id, signal), enabled: read, retry: false
    });
    const object = useQuery({
        queryKey: ['deployments', s.key, id, 'default'], queryFn: ({ signal }) => getWebApp(s.owner, id, signal), enabled: read, retry: false
    });
    const globalAuthority = backendGlobalCan(me.data, ['manage_webapp']) && backendGlobalCan(me.data, ['view_dns', 'manage_dns', 'security']);
    const member = useQuery({
        queryKey: ['deployments', s.key, id, 'member', object.data?.group.id], queryFn: ({ signal }) => getMember(s.owner, object.data!.group.id, signal), enabled: read && !!object.data && !globalAuthority, retry: false
    });
    const actionsRefused = useAppActionsRefused(s.owner, id);
    const authority = object.data ? webAppAuthority(me.data, object.data, member.data) : {
        read: false, custom: false, release: false, workflow: false
    };
    if (actionsRefused) {
        authority.custom = false;
        authority.release = false;
        authority.workflow = false;
    }
    const denied = summary.isError || object.isError || (member.isError && !globalAuthority), app = summary.data, group = object.data?.group.id ?? 0;
    const inspectLatest = useQuery({
        queryKey: ['deployments', s.key, id, 'latest-status', app?.latest_deployment?.id], queryFn: async ({ signal }) => { const h = await getHistory(s.owner, id, 'deployment', 0, signal); const a = h.items.find(x => x.id === app?.latest_deployment?.id) as Attempt | undefined; if (!a?.release)
            return null; return getDeployment(s.owner, a.id, id, a.release.id, signal); }, enabled: read && !!app?.latest_deployment && !app.latest_deployment.release, retry: false
    });
    const refresh = async () => { await Promise.all([summary.refetch(), object.refetch(), inspectLatest.refetch()]); };
    useEffect(() => { const receipt = appUnsettled(s.owner, id); if (receipt?.deployment && receipt.release)
        void getDeployment(s.owner, receipt.deployment, id, receipt.release, s.signal).then(d => { if (d.terminal)
            settleReceipt(receipt); }).catch(() => { }); }, [s.key, id, summary.dataUpdatedAt]);
    const launchRollback = async () => { const { WebAppRollbackDialog } = await import('./WebAppRollbackDialog'); assertOwner(s.owner, s.signal); let busy = false; await modal.open(close => <WebAppRollbackDialog app={object.data!} onChanged={() => void refresh()} onClose={() => close(null)} onBusy={value => { busy = value; }}/>, {
        signal: s.signal, canDismiss: () => !busy, size: 'lg'
    }); };
    const launchKey = async (action: 'mint' | 'rotate' | 'revoke') => { const { WebAppKeyDialog } = await import('./WebAppKeyDialog'); assertOwner(s.owner, s.signal); let busy = false; await modal.open(close => <WebAppKeyDialog app={object.data!} action={action} onChanged={() => void refresh()} onClose={() => close(null)} onBusy={value => { busy = value; }}/>, { signal: s.signal, canDismiss: () => !busy }); };
    const loadSetup = async () => { const { WebAppDeploySetup } = await import('./WebAppDeploySetup'); assertOwner(s.owner, s.signal); setSetup(() => WebAppDeploySetup); };
    const resume = async () => { const { WebAppOnboardingDialog } = await import('./WebAppOnboardingDialog'); assertOwner(s.owner, s.signal); let busy = false; await modal.open(close => <WebAppOnboardingDialog resume={receiptsFor(s.owner).find(r => r.kind === 'create' && r.app === id)} onClose={() => close(null)} onBusy={value => { busy = value; }}/>, {
        signal: s.signal, canDismiss: () => !busy, size: 'lg'
    }); };
    if (!read || denied)
        return <div className="modal-pad"><p>WebApp access unavailable. Controls are closed until a successful authoritative refresh.</p><button className="btn" onClick={onClose}>Close</button></div>;
    return <DetailView title={app?.webapp.display_name || app?.webapp.slug || 'WebApp'} subtitle={app?.address?.hostname || 'No public address'} icon="bi-window" onClose={onClose} contextMenu={[{ label: 'Refresh', onSelect: () => void refresh() }, ...(authority.custom ? [{ label: 'Roll back to verified version…', onSelect: () => void launchRollback() }] : [])]} sections={[{
            key: 'overview', label: 'Overview', icon: 'bi-info-circle', render: () => <div className="panel panel-pad admin-deployments"><Facts rows={[['Current release pointer', app?.current_release?.version || 'No release'], ['Release source', app?.current_release?.source], ['Latest attempt version', app?.latest_deployment?.release?.version || inspectLatest.data?.version || 'Unobserved; current release is separate'], ['Latest attempt outcome', <Status value={app?.latest_deployment?.status || 'not started'}/>], ['Setup', `${app?.onboarding.status ?? 'unknown'} · ${app?.onboarding.cursor ?? ''}`], ['Credential', app?.deployment_key.active ? 'Active (value hidden)' : app?.deployment_key.linked ? 'Linked, inactive' : 'Not linked']]}/><p className="dim">The current pointer is desired content. A failed or rolled-back attempt does not prove that attempted version serves. Certificate and HTTPS reachability are separate evidence.</p>{app?.onboarding.status !== 'succeeded' && receiptsFor(s.owner).some(r => r.kind === 'create' && r.app === id) ? <button className="btn" onClick={() => void resume()}>Resume saved setup</button> : app?.onboarding.status !== 'succeeded' && <p className="dim">Unfinished setup has no matching actor/origin resume receipt in this browser. This diagnostic does not create a replacement app.</p>}{appUnsettled(s.owner, id) && <p role="status">A submitted app operation has an unsettled outcome. Refresh its exact status before starting another mutation.</p>}</div>
        }, {
            key: 'versions', label: 'Versions', icon: 'bi-clock-history', render: () => <HistoryContext.Provider value={{ owner: s.owner, app: id }}><ModelTable endpoint="/api/edge/release" title="Registered releases" paramsMode="local" searchable={false} defaultParams={{ size: 25 }} fixedParams={{ webapp: id, graph: 'list' }} queryAdapter={ReleaseRows} columns={[{ key: 'version', label: 'Version' }, { key: 'status', label: 'Verification' }, { key: 'source', label: 'Source' }, { key: 'created', label: 'Registered' }]}/><ModelTable endpoint="/api/edge/deployment" title="Deployment attempts" paramsMode="local" searchable={false} defaultParams={{ size: 15 }} fixedParams={{ webapp: id, graph: 'list' }} queryAdapter={AttemptRows} columns={[{ key: 'id', label: 'Attempt' }, {
                    key: 'release', label: 'Attempted release', render: r => (r as Attempt).release?.version || 'Unobserved'
                }, { key: 'status', label: 'Outcome' }, { key: 'created', label: 'Started' }]}/></HistoryContext.Provider>
        }, {
            key: 'deploy-setup', label: 'Deploy setup', icon: 'bi-github', render: () => <div className="panel panel-pad admin-deployments">{Setup ? <Setup app={object.data!} workflowAllowed={authority.workflow} releaseAllowed={authority.release} keyAllowed={authority.custom} onKey={action => void launchKey(action)}/> : <><p>Generate the GitHub workflow and add one MOJO_DEPLOY_KEY repository secret. Secondary tabs support a built artifact and other CI.</p><button className="btn" disabled={!object.data} onClick={() => void loadSetup()}>Open deploy setup</button></>}</div>
        }, {
            key: 'address', label: 'Address & serving', icon: 'bi-globe', render: () => <div className="panel panel-pad admin-deployments"><Facts rows={[['Address', app?.address?.hostname || 'Not configured'], ['Certificate', app?.address?.certificate?.status || 'Not configured'], ['Certificate expires', app?.address?.certificate?.not_after], ['Environment', app?.webapp.environment], ['HTTPS probe', health || 'Not requested']]}/><p>Custom domains, certificate changes and serving paths belong to Domains & Serving.</p>{read && destinations && <div className="deployment-toolbar">{(['domains', 'serving'] as const).map(key => { const path = destinations[key]; return path && /^\/[a-z0-9/_-]+$/i.test(path) ? <Link key={key} className="btn" to={path} onClick={onClose}>{key === 'domains' ? 'Open Domains' : 'Open Serving'}</Link> : null; })}</div>}<button className="btn" disabled={!group} onClick={() => void getHealth(s.owner, id, group, s.signal).then(r => setHealth(`${r.status}: ${r.detail} (${r.checked || 'not checked'})`)).catch(() => setHealth('Observation failed; no reachability claim'))}>Check HTTPS reachability</button></div>
        }]}/>;
}
const HistoryContext = createContext<{
    owner: DeploymentOwner;
    app: number;
} | null>(null);
function HistoryRows({ params, enabled, children, kind }: {
    kind: 'release' | 'deployment';
} & ModelTableQueryAdapterProps<Release | Attempt>) { const c = useContext(HistoryContext)!; const q = useQuery({
    queryKey: ['deployments', c.owner.actor, c.owner.session, c.app, kind, params.start, params.size], queryFn: ({ signal }) => getHistory(c.owner, c.app, kind, Number(params.start) || 0, signal, Number(params.size) || (kind === 'release' ? 25 : 15)), enabled, retry: false
}); return children({
    data: q.data ? { rows: q.data.items, count: q.data.count } : undefined, status: q.status, isFetching: q.isFetching, error: q.error, refetch: q.refetch
}); }
function ReleaseRows(props: ModelTableQueryAdapterProps<Release | Attempt>) { return <HistoryRows {...props} kind="release"/>; }
function AttemptRows(props: ModelTableQueryAdapterProps<Release | Attempt>) { return <HistoryRows {...props} kind="deployment"/>; }
