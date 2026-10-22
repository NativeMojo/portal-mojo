import { useEffect, useRef, useState } from 'react';
import { getAuthSessionRevision, getAuthSnapshot, useAuthSnapshot, useMe } from '../../client/runtime';
import { Badge } from '../../ui';
import { datetime } from '../../ui/format';
import { backendGlobalCan, FLEET_DASHBOARD_GRANTS } from '../fleet/access';
import { readHostingReadiness, readServingBootstrap, type HostingReadiness, type ServingBootstrap } from './serving-data';

/** Read-only evidence, deliberately outside Query: raw bootstrap never enters a cache. */
export function ServingReadiness({ refreshRevision = 0 }: { refreshRevision?: number }) {
    const auth = useAuthSnapshot(), { data: me } = useMe();
    const scope = auth.authenticated && auth.uid && me?.id === Number(auth.uid) ? `${auth.uid}:${getAuthSessionRevision()}` : null;
    const admitted = !!scope && backendGlobalCan(me, ['view_dns', 'manage_dns', 'security']);
    const bootstrapAllowed = admitted && backendGlobalCan(me, FLEET_DASHBOARD_GRANTS);
    const [refresh, setRefresh] = useState(0);
    const [state, setState] = useState<{ scope: string | null; busy: boolean; bootstrap?: ServingBootstrap; report?: HostingReadiness; error?: string; reportError?: string }>({ scope: null, busy: false });
    const flight = useRef(0);
    useEffect(() => {
        const serial = ++flight.current, controller = new AbortController();
        const current = () => !controller.signal.aborted && flight.current === serial && getAuthSnapshot().authenticated && `${getAuthSnapshot().uid}:${getAuthSessionRevision()}` === scope;
        setState({ scope, busy: bootstrapAllowed });
        if (!bootstrapAllowed || !me || !scope) return () => controller.abort();
        const userId = me.id, superuser = me.is_superuser === true;
        void (async () => {
            try {
                const bootstrap = await readServingBootstrap(userId, controller.signal);
                if (!current()) return;
                setState({ scope, busy: superuser && bootstrap.user.is_superuser && bootstrap.capabilities.setup, bootstrap });
                if (superuser && bootstrap.user.is_superuser && bootstrap.capabilities.setup === true) {
                    try {
                        const report = await readHostingReadiness(controller.signal);
                        if (current()) setState({ scope, busy: false, bootstrap, report });
                    } catch (error) {
                        if (current()) setState({ scope, busy: false, bootstrap, reportError: error instanceof Error ? error.message : 'Readiness observation failed.' });
                    }
                }
            } catch (error) {
                if (current()) setState({ scope, busy: false, error: error instanceof Error ? error.message : 'Node posture observation failed.' });
            }
        })();
        return () => controller.abort();
    }, [scope, bootstrapAllowed, me?.id, me?.is_superuser, refresh, refreshRevision]);
    if (!admitted) return null;
    const visible: typeof state = state.scope === scope ? state : { scope, busy: false };
    const edge = visible.bootstrap?.edge, report = visible.report, selected = report?.sections.find(section => section.code === 'hosting_vhosts');
    const unavailable = !bootstrapAllowed ? 'Node posture and hosting readiness are unavailable to this session. A global Admin bootstrap grant is required; the Serving table remains available.' : visible.error;
    return <section className="edge-serving-evidence" aria-label="Serving evidence">
        <header className="edge-serving-heading"><p className="dim">Configuration checks · fleet application unverified.</p><button type="button" className="btn btn-compact" disabled={visible.busy} onClick={() => setRefresh(value => value + 1)}>{visible.busy ? 'Refreshing…' : 'Refresh serving evidence'}</button></header>
        <div className="edge-serving-evidence-grid">
            <section className="panel panel-pad"><h3>HTTP serving</h3>
                <p>Public HTTP vhosts on this node: <b>{edge?.available && edge.http_enabled !== null ? edge.http_enabled ? 'enabled' : 'disabled' : 'unknown'}</b></p>
                <details className="ops-details"><summary>Serving details</summary><p>DNSMAN issuance: {edge?.available && edge.dnsman_issuance === 'dns-01' ? 'DNS-01' : 'unknown'}</p>
                <p className="dim">HTTP is a file rendering setting, not an observed listener. DNS-01 describes the issuance method, not successful issuance or serving.</p></details>
                {unavailable && <p role="status">Unavailable: {unavailable}</p>}
            </section>
            <section className="panel panel-pad"><h3>Hosting readiness</h3>
                {selected && report ? <><Badge tone={selected.status === 'pass' ? 'info' : selected.status === 'fail' ? 'danger' : 'muted'}>{selected.status}</Badge>{(report.truncated || selected.coverage.omitted > 0 || report.coverage.checks.omitted > 0 || report.coverage.sections.omitted > 0) && <p className="text-warn">Partial report · some checks are omitted.</p>}<details className="ops-details"><summary>Readiness details</summary><p className="dim">Generated <time dateTime={report.generated_at} title={report.generated_at}>{datetime(report.generated_at)}</time></p>
                    <p>Coverage: {selected.coverage.returned} of {selected.coverage.total} checks · {selected.coverage.omitted} omitted{report.truncated || report.coverage.checks.omitted || report.coverage.sections.omitted ? ' · truncated report' : ''}</p>
                    <p className="dim">Domain and certificate configuration checks; fleet convergence is unverified.</p><p className="dim">Report status: {report.overall} · {report.summary.pass} pass · {report.summary.warn} warn · {report.summary.fail} fail · {report.summary.pending} pending</p>{selected.checks.map((check, index) => <div key={`${check.code}:${index}`} className="edge-serving-check"><b>{check.status} · {check.code}</b><p>{check.explanation}</p><p>{check.remediation}</p>{check.details && Object.entries(check.details).map(([key, value]) => <p key={key}>{key}: {String(value)}</p>)}</div>)}                <p className="dim">Checks enabled hostnames’ domain and certificate status only. A pass does not prove expiry, coverage, installed certificate material, fleet nodes or running generation. A hostname absent from this bounded report has no individual verdict.</p></details>
                </> : <p role="status">{visible.busy ? 'Loading observation…' : `Unavailable: ${visible.reportError ?? unavailable ?? 'Requires a literal superuser and successful same-identity bootstrap with setup capability.'}`}</p>}
            </section>
        </div>
    </section>;
}
