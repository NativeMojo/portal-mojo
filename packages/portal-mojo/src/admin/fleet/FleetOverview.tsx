import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { decodeJwt, getAccessToken, getAuthSessionRevision, useAuthSnapshot, useMe } from '../../client/runtime';
import { modal } from '../../ui/modal';
import { datetime } from '../../ui/format';
import { useAdminRouteContext } from '../core/route-context';
import { backendGlobalCan, FLEET_CAPACITY_GRANTS, FLEET_DASHBOARD_GRANTS, type BackendGlobalUser } from './access';
import { readCapacity, readFleetDashboard } from './api';
import { fleetOperations, fleetSessionScope } from './operations';
import type { CapacityReport, FleetFacts, FleetSource } from './types';
export type FleetLinks = Record<string, {
    to: string;
    grants: readonly string[];
    superuser?: boolean;
} | null>;
export interface FleetOverviewProps {
    mount?: string;
    links?: FleetLinks;
    showConfigurationLink?: boolean;
    headingLevel?: 1 | 2;
    capacityDetails?: 'inline' | 'modal';
}
const defaultLinks: FleetLinks = { last_deployment: { to: 'deployments', grants: ['view_platform', 'manage_platform', 'admin', 'view_dns', 'manage_dns', 'security'] }, framework: { to: 'maintenance', grants: ['manage_aws', 'view_platform', 'manage_platform', 'admin'] }, certificates: { to: 'dns/certificates', grants: ['view_dns', 'manage_dns', 'security'] }, incidents: { to: 'security/incidents?status=open', grants: ['view_security', 'manage_security', 'security'] }, tickets: { to: 'security/tickets', grants: ['view_security', 'manage_security', 'security'] }, jobs: { to: 'jobs/list', grants: ['view_jobs', 'manage_jobs', 'jobs'] }, email: { to: 'email/domains', grants: ['manage_aws', 'comms'] }, sms: { to: 'phonehub', grants: ['view_phone_config', 'manage_phone_config', 'view_sms', 'manage_sms', 'comms'] } };
export function fleetMount(pathname: string, explicit?: string): string { return (explicit ?? pathname.replace(/\/fleet\/?$/, '').replace(/\/$/, '')).replace(/\/$/, ''); }
const fact = (v: unknown, fallback = 'Unknown') => typeof v === 'string' || typeof v === 'number' ? String(v) : fallback;
const obj = (v: unknown): FleetFacts => v && typeof v === 'object' && !Array.isArray(v) ? v as FleetFacts : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const count = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? String(v) : 'Unknown';
function summary(name: string, d: FleetFacts): string {
    switch (name) {
        case 'load_balancer': return d.configured === false ? 'No load balancer configured' : `${count(d.healthy)} / ${count(d.registered)} healthy targets · ${fact(obj(d.balancer).name)}`;
        case 'compute': return `${count(d.up)} / ${count(d.total)} up · ${d.source === 'target_group' ? 'Load-balancer target evidence' : d.source === 'ec2' ? 'EC2 inventory (serving health unknown)' : 'Evidence source unknown'}`;
        case 'database':
        case 'cache': return `${d.reachable === true ? 'Reachable' : d.reachable === false ? 'Unreachable' : 'Reachability unknown'} · ${fact(d.engine)} ${fact(d.version, 'version unknown')}${name === 'cache' ? ` · memory ${fact(d.memory_used)}` : ''}`;
        case 'certificates': return `${count(d.active)} active · ${count(d.failing)} failing · ${count(d.expiring_within_30_days)} expiring within 30 days${d.soonest_expiry ? ` · next expiry ${fact(d.soonest_expiry)}` : ''}`;
        case 'public_api': return d.configured === false ? 'Public proof not configured' : `Node ${fact(d.node_version)} · public proof ${fact(obj(d.probe).version, 'version unknown')} · HTTP ${fact(obj(d.probe).http_status)} · ${obj(d.probe).ok === true ? 'Passed' : obj(d.probe).ok === false ? 'Failed' : 'Unknown'}`;
        case 'framework': return `${fact(d.installed)} installed · ${fact(d.latest)} latest${d.update_available === true ? ' · update available' : ''} · pin ${fact(obj(d.pin).mode)}`;
        case 'last_deployment': {
            const r = obj(list(d.items)[0]);
            return `${fact(r.sha, 'No deployment').slice(0, 12)} · ${fact(r.status)} · ${fact(r.finished ?? r.created)}`;
        }
        case 'jobs': return `Scheduler ${d.scheduler_active === true ? 'active' : d.scheduler_active === false ? 'inactive' : 'unknown'} · ${count(obj(d.jobs).pending)} pending · ${count(obj(d.jobs).running)} running · ${count(d.failed_recent)} recent failures`;
        case 'sanity': {
            const checks = list(d.checks);
            return checks.length ? checks.map(r => `${fact(obj(r).name)}: ${obj(r).ok === true ? 'passed' : obj(r).ok === false ? 'failed' : 'unknown'}`).join(' · ') : 'Check evidence unavailable';
        }
        case 'incidents':
        case 'tickets': return `${count(d.open)} open${d.oldest_age_days != null ? ` · oldest ${count(d.oldest_age_days)} days` : ''}`;
        case 'sms': return `${fact(d.provider)} · ${d.test_mode === true ? 'test mode' : 'live mode'} · verification ${obj(d.verified).ok === true ? 'passed' : obj(d.verified).ok === false ? 'failed' : 'unknown'}`;
        case 'email': return `${count(d.domains)} domains · ${fact(d.message, 'Inspect email configuration')}`;
        default: return 'Evidence available';
    }
}
const labels: Record<string, string> = { load_balancer: 'Load balancer', compute: 'App nodes', database: 'Database', cache: 'Redis', certificates: 'Certificates', public_api: 'Public API', framework: 'Django-MOJO', last_deployment: 'Last deployment', jobs: 'Jobs', sanity: 'Node checks', incidents: 'Incidents', tickets: 'Tickets', sms: 'SMS', email: 'Email' };
function EvidenceRow({ name, source, link }: {
    name: string;
    source: FleetSource;
    link?: string;
}) {
    const restricted = source.status === 'permission_denied';
    const details = () => modal.open(close => <div className="modal-pad fleet-source-detail"><h2 className="modal-title">{labels[name] ?? name}</h2><p>{restricted ? 'Your account cannot read this source.' : summary(name, source.data)}</p>{source.reason && <p>{source.reason.replaceAll('_', ' ')}</p>}{name === 'load_balancer' && <p>Fixed ingress addresses: {list(obj(source.data.balancer).elastic_ips).map(v => fact(v)).join(', ') || (source.data.elastic_ip_missing === true ? 'No fixed ingress allocation reported' : 'Unavailable')}. These are separate from node outbound addresses.</p>}{name === 'database' && !!source.data.drift && <p className="text-warn">Engine update {fact(obj(source.data.drift).available_major)} · {fact(obj(source.data.drift).note)} · deadline {fact(obj(source.data.drift).deadline)}</p>}<p className="dim">Observed {source.observed_at ? <time dateTime={source.observed_at}>{datetime(source.observed_at)}</time> : 'time unavailable'}{source.stale_after ? ` · stale after ${datetime(source.stale_after)}` : ''}</p>{link && <p><Link to={link} onClick={() => close(null)}>Open {labels[name]?.toLowerCase() ?? name} →</Link></p>}<div className="modal-actions"><button className="btn" onClick={() => close(null)}>Close</button></div></div>, {size: 'md'});
    const d = source.data;
    const concise = restricted ? 'Restricted' : name === 'compute' ? `${count(d.up)} / ${count(d.total)} up` : name === 'load_balancer' ? d.configured === false ? 'Not configured' : `${count(d.healthy)} / ${count(d.registered)} targets healthy` : name === 'database' || name === 'cache' ? `${d.reachable === true ? 'Reachable' : d.reachable === false ? 'Unreachable' : 'Unknown'} · ${fact(d.engine)} ${fact(d.version, '')}` : name === 'framework' ? `${fact(d.installed)}${d.update_available === true ? ' · update available' : ''}` : name === 'public_api' ? d.configured === false ? 'Not configured' : `HTTP ${fact(obj(d.probe).http_status)} · ${obj(d.probe).ok === true ? 'passed' : obj(d.probe).ok === false ? 'failed' : 'unknown'}` : name === 'certificates' ? `${count(d.active)} active · ${count(d.expiring_within_30_days)} expiring soon${d.failing ? ` · ${count(d.failing)} failing` : ''}` : name === 'jobs' && d.scheduler_active == null ? summary(name, d) : name === 'jobs' ? `${count(obj(d.jobs).pending)} pending · ${count(obj(d.jobs).running)} running` : name === 'last_deployment' ? `${fact(obj(list(d.items)[0]).sha, 'No deployment').slice(0, 12)} · ${fact(obj(list(d.items)[0]).status)}` : name === 'email' ? `${count(d.domains)} domains` : name === 'sanity' && !list(d.checks).length ? 'Check evidence unavailable' : name === 'sanity' ? `${list(d.checks).filter(v => obj(v).ok === true).length} / ${list(d.checks).length} checks passed` : summary(name, d);
    return <div className="fleet-evidence-row"><strong>{labels[name] ?? name}</strong><span className="fleet-row-value">{concise}</span><span className={`fleet-source-status fleet-status-${source.status}`}>{restricted ? 'Restricted' : source.status.replaceAll('_', ' ')}</span>{!restricted && <button type="button" className="fleet-detail-button" aria-label={`Details for ${labels[name] ?? name}`} onClick={() => void details()}>Details</button>}</div>;
}
function EvidenceSection({ title, names, sources, links, mount, user }: {
    title: string;
    names: string[];
    sources: Record<string, FleetSource>;
    links: FleetLinks;
    mount: string;
    user: BackendGlobalUser;
}) {
    const visible = names.filter(name => { const s = sources[name]; return s && !(['sms', 'email'].includes(name) && (s.status === 'unconfigured' || s.data.configured === false)) && !(name === 'tickets' && s.data.open === 0); });
    if (!visible.length)
        return null;
    return <section className="panel fleet-evidence"><h3>{title}</h3>{visible.every(name => sources[name]?.status === 'permission_denied') ? <div className="fleet-evidence-row"><strong>Restricted</strong><p>Your account cannot read these sources.</p></div> : visible.map(name => { const link = links[name]; const can = link && (!link.superuser || user.is_superuser === true) && backendGlobalCan(user, link.grants); return <EvidenceRow key={name} name={name} source={sources[name]!} link={can ? `${mount}/${link.to.replace(/^\//, '')}` : undefined}/>; })}</section>;
}
function CapacityFactsContent({ report }: {
    report: CapacityReport;
}) {
    const e = report.egress, r = report.reader_routing;
    return <><p className="dim">Observed {report.generated_at} · {report.identity ? `${report.identity.project} / ${report.identity.environment}` : 'Ownership identity unavailable'}</p>
        <div className="fleet-fact-grid"><section><h4>App nodes</h4><p>{report.nodes.inventory_available ? `${report.nodes.instances.length} owned inventory rows` : 'Instance inventory unavailable'} · {report.nodes.serving_available ? 'Serving evidence available' : 'Serving evidence unavailable'}</p><p>Serving-node identity: {report.nodes.self_check}</p>{report.nodes.instances.map(n => <p key={n.id}><b>{n.name}</b> · {n.id} · {n.instance_type ?? 'size unknown'} · {n.instance_state ?? 'provider state unknown'} / {n.state} · {n.lifecycle_state}{n.self ? ' · serving this request' : ''}</p>)}</section>
        <section><h4>Stable outbound addresses</h4><p>Policy: {e.policy_available ? (e.enabled ? 'Enabled' : 'Disabled') : 'Unavailable'}</p>{e.available && e.fleet_available && e.addresses_available ? <><p>Fleet allowlist: {e.addresses.length ? e.addresses.join(', ') : 'No attached fleet addresses'}</p>{e.attached.map(a => <p key={`${a.instance}:${a.public_ip}`}>{a.instance} · {a.public_ip} · {a.managed ? 'portal managed' : 'managed outside this portal'}</p>)}</> : <p>Fleet allowlist unavailable. An empty list would not prove there are no addresses.</p>}{e.fallback_attached.map(a => <p key={`${a.instance}:${a.public_ip}`}>{a.instance} · {a.public_ip} · managed outside this portal; not part of the fleet allowlist.</p>)}<p>Reserved addresses: {e.addresses_available ? e.reserved.map(a => a.public_ip).join(', ') || 'None' : 'Unavailable'}</p><p>Pending node addresses: {e.fleet_available ? e.pending_nodes.join(', ') || 'None' : 'Unavailable'}</p></section>
        <section><h4>Data services</h4><p>Database inventory: {report.databases_available ? `${report.databases.length} resources` : 'Unavailable'}</p>{report.databases.map(d => <p key={d.identifier}>{d.identifier} · {d.engine} · {d.status}{d.blocked_reason ? ` · ${d.blocked_reason}` : ''}{d.members.map(m => <small key={m.id} className="fleet-member">{m.id} · {m.role} · {m.status ?? 'status unknown'} / {m.lifecycle_state} · {m.instance_class ?? 'class unknown'}</small>)}</p>)}<p>Redis inventory: {report.caches_available ? `${report.caches.length} groups` : 'Unavailable'}</p>{report.caches.map(c => <p key={c.identifier}>{c.identifier} · {c.node_type} · {c.replica_count} replicas · {c.status}{c.blocked_reason ? ` · ${c.blocked_reason}` : ''}{c.members.map(m => <small key={m.id} className="fleet-member">{m.id} · {m.role} · {m.status ?? 'status unknown'} / {m.lifecycle_state}</small>)}</p>)}</section>
        <section><h4>This serving process’s reader routing</h4><p>Database: {r.database.active ? 'Active' : 'Inactive'} · {r.database.host ?? 'Host not reported'}</p>{r.database.skip_reason && <p>{r.database.skip_reason}</p>}<p>Matches reader endpoint: {r.database.matches_reader_endpoint === null ? 'Unknown' : r.database.matches_reader_endpoint ? 'Yes' : 'No'}</p><p>Redis: {r.redis.active ? 'Active' : 'Inactive'}. These observations describe this process, not every fleet node.</p></section></div>{report.warnings.map((w, i) => <p className="text-warn" key={i}>{w.code}: {w.message}{w.iam_action ? ` (${w.iam_action})` : ''}</p>)}</>;
}
export function CapacityFacts({ report }: { report: CapacityReport }) {
    return <details className="panel panel-pad fleet-capacity-facts"><summary>Capacity and addressing · {report.region} · {report.mode}</summary><CapacityFactsContent report={report}/></details>;
}
export function FleetOverview({ mount: explicitMount, links: customLinks, showConfigurationLink = true, headingLevel = 2, capacityDetails = 'inline' }: FleetOverviewProps = {}) {
    const Heading = headingLevel === 1 ? 'h1' : 'h2';
    const queryClient = useQueryClient(), fresh = useRef(false);
    const routeContext = useAdminRouteContext();
    const location = useLocation(), mount = fleetMount(location.pathname, explicitMount ?? routeContext?.mount), auth = useAuthSnapshot(), { data: me } = useMe();
    const scope = auth.authenticated && auth.uid ? `${auth.uid}:${getAuthSessionRevision()}` : null;
    const canDashboard = !!scope && backendGlobalCan(me, FLEET_DASHBOARD_GRANTS), canCapacity = !!scope && backendGlobalCan(me, FLEET_CAPACITY_GRANTS);
    const dashboard = useQuery({ queryKey: ['operational-fleet', 'dashboard', scope], queryFn: ({ signal }) => readFleetDashboard(fresh.current, { signal }), enabled: canDashboard, retry: false, refetchOnWindowFocus: false });
    const capacity = useQuery({ queryKey: ['operational-fleet', 'capacity', scope], queryFn: ({ signal }) => readCapacity(fresh.current, { signal }), enabled: canCapacity, retry: false, refetchOnWindowFocus: false });
    const operation = useSyncExternalStore(fn => scope ? fleetOperations.subscribe(scope, fn) : () => { }, () => scope ? fleetOperations.get(scope) : null, () => null);
    const owner = useRef<AbortController | null>(null), [refreshing, setRefreshing] = useState(false), [error, setError] = useState('');
    const links = { ...defaultLinks, ...customLinks };
    if (routeContext) for (const [name, link] of Object.entries(links)) {
        if (link && !routeContext.paths.includes(`${mount}/${link.to.replace(/^\//, '').split('?')[0]}`)) links[name] = null;
    }
    const configurationMounted = !routeContext || routeContext.paths.includes(`${mount}/fleet-configuration`);
    useEffect(() => () => { owner.current?.abort(); }, [scope]);
    useEffect(() => { if (!scope || !canCapacity || !operation || !['done', 'failed', 'unknown'].includes(operation.status))
        return; const expected = scope; void readCapacity(true).then(next => { if (fleetSessionScope() === expected)
        queryClient.setQueryData(['operational-fleet', 'capacity', expected], next); }).catch(() => { }); }, [scope, canCapacity, operation?.status, operation?.planId, queryClient]);
    const jwt = decodeJwt(getAccessToken());
    const interactive = !!jwt && !['api_key', 'group_scoped_token'].includes(String(jwt.credential_kind ?? ''));
    const eligible = canCapacity && me?.is_superuser === true && interactive && capacity.data?.mode === 'managed';
    const refresh = async () => { owner.current?.abort(); setRefreshing(true); setError(''); fresh.current = true; try {
        await Promise.all([...(canDashboard ? [dashboard.refetch()] : []), ...(canCapacity ? [capacity.refetch()] : [])]);
    }
    finally {
        fresh.current = false;
        setRefreshing(false);
    } };
    const openCapacity = () => {
        if (!scope || fleetSessionScope() !== scope || !canCapacity || !capacity.data) return;
        owner.current?.abort(); const controller = new AbortController(); owner.current = controller;
        const report = capacity.data;
        return modal.open(close => <div className="modal-pad fleet-capacity-dialog"><h2 className="modal-title">Capacity and addressing</h2><p className="dim">{report.region} · {report.mode}</p><div className="fleet-capacity-body"><CapacityFactsContent report={report}/></div><div className="modal-actions"><button className="btn" onClick={() => close(null)}>Close</button></div></div>, { size: 'lg', signal: controller.signal });
    };
    useEffect(() => { if (capacityDetails === 'modal' && !canCapacity) owner.current?.abort(); }, [capacityDetails, canCapacity]);
    const openScale = async () => { if (!scope || fleetSessionScope() !== scope || !eligible || !capacity.data)
        return; owner.current?.abort(); const controller = new AbortController(); owner.current = controller; try {
        const { ScaleFleetDialog } = await import('./ScaleFleetDialog');
        if (controller.signal.aborted || fleetSessionScope() !== scope)
            return;
        await modal.open(close => <ScaleFleetDialog scope={scope} initialReport={capacity.data!} close={() => close(null)} onRefresh={() => void capacity.refetch()}/>, { size: 'lg', signal: controller.signal, canDismiss: () => fleetOperations.get(scope).status !== 'submitting' });
    }
    catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Capacity editor could not load.');
    } };
    if (!canDashboard && !canCapacity)
        return null;
    const data = dashboard.data;
    return <section className="operational-fleet" aria-label="Fleet overview"><header className="fleet-heading"><div><div className="eyebrow">Operations</div><Heading>Fleet overview</Heading></div><div className="fleet-buttons"><button className="btn" disabled={refreshing || dashboard.isFetching || capacity.isFetching || operation?.status === 'submitting'} onClick={() => void refresh()}>Refresh fleet</button>{eligible && <button className="btn btn-primary" onClick={() => void openScale()}>{operation && ['submitting', 'running', 'unknown'].includes(operation.status) ? 'View capacity progress' : 'Scale fleet'}</button>}{showConfigurationLink && configurationMounted && me?.is_superuser === true && <Link className="btn" to={`${mount}/fleet-configuration`}>Configuration</Link>}</div></header>
        {canDashboard && !data && <div className="panel panel-pad" role={dashboard.error ? 'alert' : 'status'}>{dashboard.error?.message ?? 'Loading fleet health…'}</div>}
        {data && <><div className={`panel panel-pad fleet-availability fleet-availability-${data.availability.state}`}><strong>{data.availability.message}</strong><p className="dim">Observed <time dateTime={data.observed_at} title={data.observed_at}>{datetime(data.observed_at)}</time></p>{dashboard.error && <p className="text-warn">Latest observation failed: {dashboard.error.message}. The prior report is retained with its original timestamps.</p>}</div><div className="fleet-evidence-grid"><EvidenceSection title="Infrastructure" names={['load_balancer', 'compute', 'database', 'cache', 'certificates', 'public_api']} sources={data.sources} links={links} mount={mount} user={me!}/><EvidenceSection title="Software" names={['framework', 'last_deployment', 'sms', 'email']} sources={data.sources} links={links} mount={mount} user={me!}/><EvidenceSection title="Needs attention" names={['jobs', 'sanity', 'incidents', 'tickets']} sources={data.sources} links={links} mount={mount} user={me!}/></div>{data.attention.message && <p>{data.attention.message}</p>}</>}
        {canCapacity && capacity.error && <p className="form-alert" role="alert">Capacity observation unavailable: {capacity.error.message}</p>}{canCapacity && capacity.data && (capacityDetails === 'modal' ? <div className="fleet-buttons"><button className="btn" onClick={() => void openCapacity()}>Capacity and addressing</button><span className="dim">{capacity.data.region} · {capacity.data.mode}</span></div> : <CapacityFacts report={capacity.data}/>)}
        {!eligible && <p className="dim">{!canCapacity ? 'Capacity details require the global manage_aws grant.' : me?.is_superuser !== true ? 'Scaling requires a literal superuser account.' : !interactive ? 'Scaling requires an interactive user session.' : capacity.data?.mode === 'external' ? 'Infrastructure is managed externally. Capacity is read-only here.' : 'Loading capacity authority…'}</p>}
        {operation && operation.status !== 'idle' && <div className="panel panel-pad" role="status"><strong>{operation.status === 'done' ? 'Capacity batch completed' : operation.status === 'failed' ? 'Capacity batch failed' : operation.status === 'unknown' ? 'Capacity progress unknown' : 'Capacity change in progress'}</strong><p>{operation.message}</p><p className="dim">Plan {operation.planId} · batch {operation.batchId ?? 'not acknowledged'}</p>{operation.status === 'failed' && <p>Completed steps remain applied. Nothing rolls back.</p>}</div>}{error && <p className="form-alert" role="alert">{error}</p>}
    </section>;
}
