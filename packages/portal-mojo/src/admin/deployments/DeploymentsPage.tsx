import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { registerNonFilterParams, useMe } from '../../client/runtime';
import { Tabs } from '../../ui/Tabs';
import { datetime } from '../../ui/format';
import { modal } from '../../ui/modal';
import { backendGlobalCan } from '../fleet/access';
import { useAdminRouteContext } from '../core/route-context';
import { canOnboard, canReadApi, canReadBootstrap, canReadWebApps, isInteractive, assertOwner } from './permissions';
import { getBootstrap, getPlatform, getWebApps } from './api';
import { useDeploymentOwner } from './useDeploymentObservation';
import { DeploymentHelp, ErrorNotice, Facts, Status } from './shared';
import type { DeploymentsDestinations } from './types';
import { platformProof } from './deployment-state';
registerNonFilterParams('deployment_lane', 'deployment_app', 'deployment_tab');
export function DeploymentsPage({ destinations }: {
    destinations?: DeploymentsDestinations;
} = {}) {
    const me = useMe(), scope = useDeploymentOwner(), queryClient = useQueryClient(), [params, setParams] = useSearchParams();
    const registered = useAdminRouteContext();
    const mount = registered?.mount === '/' ? '' : registered?.mount;
    const candidates = destinations ?? (mount !== undefined ? { domains: `${mount}/dns/domains`, serving: `${mount}/edge/vhosts` } : {});
    const admittedDestinations: DeploymentsDestinations = {};
    if (backendGlobalCan(me.data, ['view_dns', 'manage_dns', 'security'])) for (const key of ['domains', 'serving'] as const) {
        const path = candidates[key];
        if (path && (!registered || registered.paths.includes(path))) admittedDestinations[key] = path;
    }
    const interactive = isInteractive(), api = interactive && canReadApi(me.data), web = interactive && canReadWebApps(me.data);
    const lane = params.get('deployment_lane') === 'webapps' && web ? 'webapps' : api ? 'api' : 'webapps';
    const bootstrap = useQuery({
        queryKey: ['deployments', scope.key, 'bootstrap'], queryFn: ({ signal }) => getBootstrap(scope.owner, signal), enabled: web && lane === 'webapps' && canReadBootstrap(me.data), retry: false
    });
    const select = (lane: string) => { setParams({ ...Object.fromEntries([...params].filter(([name]) => name === 'demo')), deployment_lane: lane }, { replace: true }); };
    const newApp = async () => { const { WebAppOnboardingDialog } = await import('./WebAppOnboardingDialog'); assertOwner(scope.owner, scope.signal); let busy = false; await modal.open(close => <WebAppOnboardingDialog destinations={admittedDestinations} bootstrap={bootstrap.data!} onClose={() => close(null)} onBusy={value => { busy = value; }}/>, {
        signal: scope.signal, canDismiss: () => !busy, size: 'lg'
    }); await queryClient.invalidateQueries({ queryKey: ['deployments', scope.key] }); };
    if (!api && !web)
        return <div className="panel panel-pad"><h1>Deployments</h1><p>API or WebApp read authority in this global Admin workspace is required.</p></div>;
    const items = [...(api ? [{
                key: 'api', label: 'API', panel: <ApiLane key={scope.key}/>
            }] : []), ...(web ? [{
                key: 'webapps', label: 'WebApps', panel: <WebAppsLane key={scope.key} destinations={admittedDestinations}/>
            }] : [])];
    return <div className="admin-deployments"><header className="page-header"><div><h1>Deployments</h1><p className="dim">Review releases and deployment progress.</p></div>{lane === 'webapps' && web && canOnboard(bootstrap.data) && <button className="btn btn-primary" onClick={() => void newApp()}>New WebApp</button>}</header>{items.length === 1 ? items[0]!.panel : <Tabs ariaLabel="Deployment type" items={items} activeKey={lane} onActiveKeyChange={select}/>}</div>;
}
function ApiLane() {
    const me = useMe(), s = useDeploymentOwner();
    const q = useQuery({
        queryKey: ['deployments', s.key, 'platform', 'deployments,api'], queryFn: ({ signal }) => getPlatform(s.owner, signal), enabled: canReadApi(me.data) && isInteractive(), retry: false
    });
    const inspect = async (id: string) => { const { ApiDeploymentDetail } = await import('./ApiDeploymentDetail'); assertOwner(s.owner, s.signal); await modal.open(close => <ApiDeploymentDetail id={id} onClose={() => close(null)}/>, { signal: s.signal, size: 'lg' }); };
    const d = q.data?.deployments, serving = d?.data?.currently_serving;
    const stale = d?.status === 'stale' || !!d?.stale_after && Date.parse(d.stale_after) <= Date.now();
    return <section><div className="deployment-toolbar"><h2>API</h2><button className="btn" disabled={q.isFetching} onClick={() => void q.refetch()}>Refresh API</button></div>
        {q.isError && <ErrorNotice>API observation unavailable. {q.data ? 'Previous evidence is shown below.' : 'Refresh to try again.'}</ErrorNotice>}
        {q.isPending ? <p role="status">Loading API evidence…</p> : !d?.data ? <div className="panel panel-pad"><h3>Deployment observation unavailable</h3><p>{d?.reason || 'The collector did not return deployment evidence. Refresh to try again.'}</p><Status value={d?.status ?? 'unknown'}/></div> : <>
            {stale && <p className="text-warn" role="status">This deployment observation is stale. Refresh before acting.</p>}
            <div className="deployment-current"><div className="deployment-toolbar"><div className="eyebrow">Last convergence</div><DeploymentHelp label="API convergence"><Facts rows={[["Collector", <Status value={d.status}/>], ["Observed", d.observed_at ? datetime(d.observed_at) : 'Time unavailable'], ['Framework', serving?.framework_version], ['Framework mode', d.data.framework_pin.mode], ['Coordination', d.data.coordination.state]]}/><p>Last convergence is dated evidence, not fresh proof for every current node. Framework changes belong to Maintenance.</p></DeploymentHelp></div><strong className="mono" title={serving?.sha}>{serving?.sha.slice(0, 12) ?? 'No convergence recorded'}</strong><p className="dim">{serving?.converged_at ? datetime(serving.converged_at) : 'Convergence time unknown'}</p></div>
            <h3>Latest attempts</h3>{d.data.items.map((row, i) => <button className="deployment-record" key={row.id} onClick={() => void inspect(row.id)}><span><strong>{i === 0 ? 'Latest · ' : ''}{row.sha.slice(0, 12)}</strong><small>{platformProof(row)}</small></span><Status value={row.status}/></button>)}{!d.data.items.length && <p>No deployment attempts recorded.</p>}
            {d.data.items.length >= d.data.limit && d.data.limit > 0 && <p className="dim">Showing the latest {d.data.limit} attempts.</p>}
        </>}
    </section>;
}
function WebAppsLane({ destinations }: {
    destinations?: DeploymentsDestinations;
}) {
    const me = useMe(), s = useDeploymentOwner();
    const q = useQuery({
        queryKey: ['deployments', s.key, 'summaries'], queryFn: ({ signal }) => getWebApps(s.owner, signal), enabled: canReadWebApps(me.data) && isInteractive(), retry: false
    });
    const inspect = async (id: number) => { const { WebAppDetail } = await import('./WebAppDetail'); assertOwner(s.owner, s.signal); await modal.open(close => <WebAppDetail id={id} destinations={destinations} onClose={() => close(null)}/>, { signal: s.signal, size: 'lg' }); };
    return <section><div className="deployment-toolbar"><h2>WebApps</h2><button className="btn" disabled={q.isFetching} onClick={() => void q.refetch()}>Refresh WebApps</button></div>{q.isError ? <ErrorNotice>WebApp summary unavailable. Refresh to try again.</ErrorNotice> : q.isPending ? <p>Loading WebApps…</p> : <>{q.data?.truncated && <p className="text-warn">More apps exist; this list is truncated.</p>}{q.data?.items.map(row => <button className="deployment-record" key={row.webapp.id} onClick={() => void inspect(row.webapp.id)}><span><strong>{row.webapp.display_name || row.webapp.slug}</strong><small>{row.address?.hostname || 'No public address'}</small><small>Desired version: {row.current_release?.version ?? 'No release'}</small></span><span className="deployment-attempt-summary"><small>Latest attempt{row.latest_deployment?.release?.version && row.latest_deployment.release.version !== row.current_release?.version ? ` · ${row.latest_deployment.release.version}` : ''}</small><Status value={row.latest_deployment?.status ?? 'not started'}/></span></button>)}{!q.data?.items.length && <p>No WebApps yet.</p>}</>}</section>;
}
