import { Badge, Eyebrow, FlatRow, fmt } from '../../ui';
import { Link, useInRouterContext, useLocation } from 'react-router-dom';
import { useMe } from '../../client/runtime';
import { fleetConnectionRoute } from '../fleet-configuration/operator-destinations';
import { useValidationPlan } from './shared-validation-api';
import type { Readiness } from './shared-validation-data';
import type { DomainRow } from './models';

const nextCopy: Record<string, string> = {
    configure_hub: 'A deployment operator must configure the server, restart application and worker processes, then Refresh Portal.',
    upgrade_hub: 'A deployment operator must enable a compatible shared-validation backend, then Refresh.',
    repair_hub_access: 'Ask the deployment operator to repair the configured project access; do not change the validation target.',
    retry_hub: 'The configured hub is unavailable. Refresh after the deployment operator restores access.',
    choose_allocation: 'Enter the existing validation target supplied by its controller.',
    prepare_connection: 'Prepare an immutable public request for the allocation controller.',
    grant_trust: 'Ask the allocation controller to review and authorize this exact connection request.',
    restart_connection: 'This reference was revoked. Prepare a fresh request explicitly; keep the existing validation target.',
    connect: 'Connect the approved validation using the same prepared request.',
    repair_alias: 'Ask the domain owner to restore the approved one-hop CNAME after checking other users of this target.',
    check: 'Check the approved validation route before requesting a certificate.',
    request: 'Validation is ready. Request this deployment’s independent apex and wildcard certificate.',
    wait_for_job: 'Issuance is queued or running. This view watches for a bounded time.',
    repair_worker: 'Ask the deployment operator to inspect and restart the certificate worker.',
    restore_custody: 'Ask the deployment operator to restore access to this local certificate’s stored material.',
    inspect_failure: 'Review the separate hub, trust, DNS and renewal facts below with the project operator.',
    unsupported_domain_scope: 'Shared setup requires a group-managed domain in this rollout. Existing direct-provider operation remains available.',
    none: 'No setup action is currently required.',
};
function OperatorLink() {
    const location = useLocation();
    return <Link className="btn" to={fleetConnectionRoute(location.pathname)} target="_blank" rel="noopener">Open deployment connection setup</Link>;
}
function OperatorHandoff({ readiness: r }: { readiness: Readiness }) {
    const { data: me } = useMe(); const routed = useInRouterContext();
    return <div className="dns-blocked"><strong>Deployment operator repair</strong><p>{r.domain.name} · hub {r.hub.state} · {r.next_action.code.replaceAll('_', ' ')} · observed {fmt.datetime(r.checked_at)}.</p>{me?.is_superuser === true && routed ? <><OperatorLink /><p>The protected Fleet form opens in a separate tab. It provides approved profiles, write-only key entry and node verification. Existing release holds and hub activation remain separate.</p></> : <p>Ask this deployment’s operator to open Fleet Configuration → Shared validation connection, review these facts and use its permitted Setup/deployment destinations. This session cannot edit protected credentials. Refresh after repair to see authoritative status.</p>}</div>;
}
export function ValidationFacts({ readiness: r }: { readiness: Readiness }) {
    const certificate = r.certificate;
    return <div className="dns-shared-facts">
        <Eyebrow>Shared validation</Eyebrow>
        <p className="dns-provider-note">{nextCopy[r.next_action.code]}</p>
        {r.next_action.actor === 'deployment_operator' && <OperatorHandoff readiness={r} />}
        <FlatRow label="Hub"><Badge tone={r.hub.state === 'ready' ? 'success' : 'warning'}>{r.hub.state}</Badge></FlatRow>
        <FlatRow label="Trust"><Badge tone={r.trust.state === 'active' ? 'success' : r.trust.state === 'revoked' ? 'danger' : 'warning'}>{r.trust.state.replaceAll('_', ' ')}</Badge></FlatRow>
        <FlatRow label="Local connection">{r.connection ? `${r.connection.mode} · ${r.connection.state}` : 'Not prepared'}</FlatRow>
        {r.connection?.mode === 'shared' && r.connection.state !== 'verified' && <p className="dns-warning">Direct local validation and renewal wait for shared authorization and checking. An existing valid certificate remains available.</p>}
        {r.trust.state === 'revoked' && <p className="dns-warning">Future validation is blocked. Certificates already issued remain valid until expiry or separate revocation. Other trusted projects keep working.</p>}
        <Eyebrow>ACME validation</Eyebrow>
        <FlatRow label="CNAME source"><code>{r.alias.source}</code></FlatRow>
        <FlatRow label="Existing target"><code>{r.alias.target ?? 'Not selected'}</code></FlatRow>
        <FlatRow label="Proof">{r.alias.state.replaceAll('_', ' ')}{r.alias.one_hop === false ? ' · chained alias' : r.alias.one_hop ? ' · one hop' : ''}</FlatRow>
        <FlatRow label="Observed target"><code>{r.alias.observed_target ?? 'Unavailable / not yet checked'}</code></FlatRow>
        <FlatRow label="DNS checked">{r.alias.checked_at ? fmt.datetime(r.alias.checked_at) : 'Not yet checked'}</FlatRow>
        <p className="dim">Keep this approved CNAME. Restore it only after checking its other consumers; do not replace or remove it as a default repair.</p>
        <Eyebrow>Traffic routing</Eyebrow>
        <p className="dim">The <code>_acme-challenge</code> record validates certificate issuance only. Apex, www, API and app A/AAAA/CNAME records follow your deployment’s separate traffic instructions.</p>
        <Eyebrow>Local certificate</Eyebrow>
        <FlatRow label="Certificate">{certificate ? `${certificate.state} · local ${certificate.id}` : 'Not requested'}</FlatRow>
        <FlatRow label="Validity">{certificate?.serving_valid === true ? `Valid until ${fmt.date(certificate.not_after)}` : certificate?.serving_valid === false ? 'No currently valid local certificate' : 'Unknown'}</FlatRow>
        <FlatRow label="Material custody">{certificate?.material_state ?? 'No certificate'}</FlatRow>
        <p className="dim">Each deployment keeps its own certificate and private key. Local custody does not prove installation or serving on an edge host.</p>
        <Eyebrow>Renewal</Eyebrow>
        <FlatRow label="Renewal state">{r.renewal.state}</FlatRow>
        <FlatRow label="Next attempt">{fmt.date(r.renewal.next_attempt_at)}</FlatRow>
        {r.renewal.error_code && <FlatRow label="Renewal reason"><code>{r.renewal.error_code}</code></FlatRow>}
        {certificate?.serving_valid === true && ['blocked', 'failed', 'retrying'].includes(r.renewal.state) && <p className="dns-warning">The local certificate is valid until {fmt.date(certificate.not_after)}; renewal needs attention.</p>}
        {r.renewal.cleanup_pending && <p className="dns-warning">Validation cleanup remains unconfirmed.</p>}
        <FlatRow label="Worker version">{r.renewal.worker_version ?? 'Unknown — confirm the worker was upgraded and restarted'}</FlatRow>
        <FlatRow label="Last plan check">{fmt.datetime(r.checked_at)}</FlatRow>
        <FlatRow label="Next action">{r.next_action.code.replaceAll('_', ' ')} · {r.next_action.actor.replaceAll('_', ' ')}</FlatRow>
    </div>;
}
export function SharedValidationPanel({ domain }: { domain: DomainRow }) {
    const plan = useValidationPlan({ domain: domain.id });
    return <div className="dns-shared-panel">{plan.error && <div className="dns-errors" role="alert">{plan.error.message}{plan.data && ' The facts below are from the last successful check.'}</div>}{plan.loading && <p className="dim">Checking validation…</p>}{plan.data && <ValidationFacts readiness={plan.data} />}{plan.timedOut && <p className="dns-warning">Automatic checks reached their limit. Refresh to inspect current status.</p>}<button className="btn" type="button" disabled={plan.loading} onClick={() => void plan.refresh()}>Refresh validation</button></div>;
}
