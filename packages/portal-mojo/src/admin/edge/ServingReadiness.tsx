import { useEffect, useRef, useState } from 'react';
import { getAuthSessionRevision, getAuthSnapshot, useAuthSnapshot, useMe } from '../../client/runtime';
import { Badge, FlatRow, modal } from '../../ui';
import { EdgeHelp } from './EdgeHelp';
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
    const owner = useRef<AbortController | null>(null);
    const evidenceAuthority = `${scope}:${admitted}:${bootstrapAllowed}:${me?.is_superuser === true}:${state.scope === scope && state.bootstrap?.user.is_superuser === true}:${state.scope === scope && state.bootstrap?.capabilities.setup === true}`;
    useEffect(() => { const controller = new AbortController(); owner.current = controller; return () => controller.abort(); }, [evidenceAuthority]);
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
    if (!bootstrapAllowed) return null;
    const visible: typeof state = state.scope === scope ? state : { scope, busy: false };
    const edge = visible.bootstrap?.edge, report = visible.report, selected = report?.sections.find(section => section.code === 'hosting_vhosts');
    const unavailable = visible.error;
    const showDetails = () => modal.open(close => <div className="modal-pad edge-check-dialog"><h2 className="modal-title">Serving configuration checks</h2><div className="edge-check-body"><FlatRow label="Public HTTP">{edge?.available && edge.http_enabled !== null ? edge.http_enabled ? 'Enabled' : 'Disabled' : 'Unknown'}</FlatRow><FlatRow label="Certificate issuance">{edge?.available && edge.dnsman_issuance === 'dns-01' ? 'DNS-01' : 'Unknown'}</FlatRow>{unavailable && <p role="status">Unavailable: {unavailable}</p>}
        {selected && report ? <><FlatRow label="Generated"><time dateTime={report.generated_at}>{datetime(report.generated_at)}</time></FlatRow><FlatRow label="Coverage">{selected.coverage.returned} of {selected.coverage.total} checks · {selected.coverage.omitted} omitted</FlatRow><FlatRow label="Report status">{report.overall} · {report.summary.pass} pass · {report.summary.warn} warn · {report.summary.fail} fail · {report.summary.pending} pending</FlatRow>{(report.truncated || selected.coverage.omitted > 0 || report.coverage.checks.omitted > 0 || report.coverage.sections.omitted > 0) && <p className="text-warn">Partial report · some checks are omitted.</p>}{selected.checks.map((check, index) => <div key={`${check.code}:${index}`} className="edge-serving-check"><b>{check.status} · {check.code}</b><p>{check.explanation}</p>{check.remediation && <p>{check.remediation}</p>}{check.details && Object.entries(check.details).map(([key, value]) => <p key={key}>{key}: {String(value)}</p>)}</div>)}</> : <p role="status">{visible.busy ? 'Loading observation…' : `Unavailable: ${visible.reportError ?? unavailable ?? 'Requires a literal superuser and successful same-identity bootstrap with setup capability.'}`}</p>}
        <p className="dim">These checks inspect domain and certificate configuration. They do not prove certificate expiry, coverage, installed material, fleet convergence, expected nodes or the running generation. HTTP is a file rendering setting; DNS-01 identifies the issuance method. A hostname absent from this bounded report has no individual verdict.</p></div><div className="modal-actions"><button type="button" className="btn" onClick={() => close(null)}>Close</button></div></div>, { size: 'md', signal: owner.current?.signal });
    return <section className="edge-serving-evidence" aria-label="Serving evidence"><div className="edge-check-summary"><div className="edge-check-status"><i className="bi bi-shield-check" aria-hidden="true" /><strong>Configuration checks</strong><Badge tone={selected?.status === 'fail' ? 'danger' : 'muted'}>{visible.busy ? 'Checking…' : selected?.status ?? 'Unavailable'}</Badge><EdgeHelp label="About configuration checks">Checks saved domain and certificate configuration. Fleet application and live serving remain unverified.</EdgeHelp></div><div className="edge-row-actions"><button type="button" className="btn btn-compact" onClick={() => void showDetails()}>Check details</button><button type="button" className="btn-icon" aria-label="Refresh serving evidence" title="Refresh" disabled={visible.busy} onClick={() => setRefresh(value => value + 1)}><i className={`bi bi-arrow-repeat${visible.busy ? ' spin' : ''}`} /></button></div></div>{report && <small className="dim">As of <time dateTime={report.generated_at}>{datetime(report.generated_at)}</time>{report.truncated || selected?.coverage.omitted || report.coverage.checks.omitted || report.coverage.sections.omitted ? ' · Partial report' : ''}</small>}{(visible.error || visible.reportError) && <p className="text-warn" role="status">Configuration check unavailable. Open Check details for the reason.</p>}</section>;
}
