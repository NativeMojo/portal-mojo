import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { registerNonFilterParams, useMe } from '../../client/runtime';
import { Tabs } from '../../ui/Tabs';
import { modal } from '../../ui/modal';
import { backendGlobalCan } from '../fleet/access';
import { useAdminRouteContext } from '../core/route-context';
import { canOnboard, canReadApi, canReadBootstrap, canReadWebApps, isInteractive, assertOwner } from './permissions';
import { getBootstrap, getPlatform, getWebApps } from './api';
import { useDeploymentOwner } from './useDeploymentObservation';
import { ErrorNotice, Facts, Status } from './shared';
import type { DeploymentsDestinations } from './types';
import { platformProof } from './deployment-state';
registerNonFilterParams('deployment_lane', 'deployment_app', 'deployment_tab');
export function DeploymentsPage({ destinations }: {
    destinations?: DeploymentsDestinations;
} = {}) {
    const me = useMe(), scope = useDeploymentOwner(), [params, setParams] = useSearchParams();
    const registered = useAdminRouteContext();
    const mount = registered?.mount === '/' ? '' : registered?.mount;
    const candidates = destinations ?? (mount !== undefined ? { domains: `${mount}/dns/domains`, serving: `${mount}/edge/vhosts` } : {});
    const admittedDestinations: DeploymentsDestinations = {};
    if (backendGlobalCan(me.data, ['view_dns', 'manage_dns', 'security'])) for (const key of ['domains', 'serving'] as const) {
        const path = candidates[key];
        if (path && (!registered || registered.paths.includes(path))) admittedDestinations[key] = path;
    }
    const interactive = isInteractive(), api = interactive && canReadApi(me.data), web = interactive && canReadWebApps(me.data);
    const bootstrap = useQuery({
        queryKey: ['deployments', scope.key, 'bootstrap'], queryFn: ({ signal }) => getBootstrap(scope.owner, signal), enabled: interactive && canReadBootstrap(me.data), retry: false
    });
    const select = (lane: string) => { setParams({ ...Object.fromEntries([...params].filter(([name]) => name === 'demo')), deployment_lane: lane }, { replace: true }); };
    const newApp = async () => { const { WebAppOnboardingDialog } = await import('./WebAppOnboardingDialog'); assertOwner(scope.owner, scope.signal); let busy = false; await modal.open(close => <WebAppOnboardingDialog destinations={admittedDestinations} bootstrap={bootstrap.data!} onClose={() => close(null)} onBusy={value => { busy = value; }}/>, {
        signal: scope.signal, canDismiss: () => !busy, size: 'lg'
    }); };
    if (!api && !web)
        return <div className="panel panel-pad"><h1>Deployments</h1><p>API or WebApp read authority in this global Admin workspace is required.</p></div>;
    const items = [...(api ? [{
                key: 'api', label: 'API', panel: <ApiLane key={scope.key}/>
            }] : []), ...(web ? [{
                key: 'webapps', label: 'WebApps', panel: <WebAppsLane key={scope.key} destinations={admittedDestinations}/>
            }] : [])];
    return <div className="admin-deployments"><header className="page-header"><div><h1>Deployments</h1><p className="dim">What serves now, what changed, and the next recovery step.</p></div>{web && canOnboard(bootstrap.data) && <button className="btn btn-primary" onClick={() => void newApp()}>New WebApp</button>}</header>{web && !canOnboard(bootstrap.data) && <p className="dim">New WebApp setup requires the separately admitted Admin bootstrap and an eligible workspace. Existing app reads remain available.</p>}<Tabs items={items} activeKey={params.get('deployment_lane') ?? items[0]!.key} onActiveKeyChange={select}/></div>;
}
function ApiLane() {
    const me = useMe(), s = useDeploymentOwner();
    const q = useQuery({
        queryKey: ['deployments', s.key, 'platform', 'deployments,api'], queryFn: ({ signal }) => getPlatform(s.owner, signal), enabled: canReadApi(me.data) && isInteractive(), retry: false
    });
    const inspect = async (id: string) => { const { ApiDeploymentDetail } = await import('./ApiDeploymentDetail'); assertOwner(s.owner, s.signal); await modal.detail(close => <ApiDeploymentDetail id={id} onClose={() => close(null)}/>); };
    const d = q.data?.deployments, serving = d?.data?.currently_serving;
    return <section><div className="deployment-toolbar"><h2>API</h2><button className="btn" onClick={() => void q.refetch()}>Refresh API</button></div>{q.isError ? <ErrorNotice>API observation unavailable. Refresh to try again.</ErrorNotice> : q.isPending ? <p>Loading API evidence…</p> : <><Facts rows={[['Collector', <Status value={d?.status ?? 'unknown'}/>], ['Last converged serving SHA', serving?.sha ?? 'No convergence record'], ['Converged at', serving?.converged_at], ['Framework', serving?.framework_version], ['Framework mode (read-only)', d?.data?.framework_pin.mode], ['Coordination', d?.data?.coordination.state]]}/><p className="dim">Last convergence is dated evidence, not a fresh proof for every current node. Framework changes belong to Maintenance.</p><h3>Latest attempts</h3>{d?.data?.items.map((row, i) => <button className="deployment-record" key={row.id} onClick={() => void inspect(row.id)}><span><strong>{i === 0 ? 'Latest attempt · ' : ''}{row.sha}</strong><small>{platformProof(row)}</small></span><Status value={row.status}/></button>)}{!d?.data?.items.length && <p>No authorized deployment history is available.</p>}</>}</section>;
}
function WebAppsLane({ destinations }: {
    destinations?: DeploymentsDestinations;
}) {
    const me = useMe(), s = useDeploymentOwner();
    const q = useQuery({
        queryKey: ['deployments', s.key, 'summaries'], queryFn: ({ signal }) => getWebApps(s.owner, signal), enabled: canReadWebApps(me.data) && isInteractive(), retry: false
    });
    const inspect = async (id: number) => { const { WebAppDetail } = await import('./WebAppDetail'); assertOwner(s.owner, s.signal); await modal.detail(close => <WebAppDetail id={id} destinations={destinations} onClose={() => close(null)}/>); };
    return <section><div className="deployment-toolbar"><h2>WebApps</h2><button className="btn" onClick={() => void q.refetch()}>Refresh WebApps</button></div>{q.isError ? <ErrorNotice>WebApp summary unavailable. Refresh to try again.</ErrorNotice> : q.isPending ? <p>Loading WebApps…</p> : <><p className="dim">{q.data?.count ?? 0} listed apps · limit {q.data?.limit ?? 50}{q.data?.truncated ? ' · More apps exist; this list is truncated.' : ''}. Release pointers describe desired content; attempts show rollout outcomes.</p>{q.data?.items.map(row => <button className="deployment-record" key={row.webapp.id} onClick={() => void inspect(row.webapp.id)}><span><strong>{row.webapp.display_name || row.webapp.slug}</strong><small>{row.address?.hostname || 'No public address'} · Certificate {row.address?.certificate?.status || 'not configured'}</small><small>Current pointer: {row.current_release?.version ?? 'No release'} ({row.current_release?.source ?? 'unknown'})</small><small>Latest attempt: {row.latest_deployment?.release?.version ?? 'version unobserved'}</small></span><Status value={row.latest_deployment?.status ?? 'not started'}/></button>)}{!q.data?.items.length && <p>No WebApps visible to this account.</p>}</>}</section>;
}
