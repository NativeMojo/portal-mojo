import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { getAuthSessionRevision, requestFreshAuth, useAuthSnapshot, useMe } from '../../client/runtime';
import { MaintenanceDialog } from './MaintenanceDialogs';
import {
    frameworkActionLabel,
    maintenanceAccess,
    maintenanceFence,
    MaintenanceError,
    readFramework,
    readInfrastructure,
    readMaintenance,
    type Finding,
    type Framework,
    type Report,
} from './data';
import {
    getMaintenanceAttempt,
    getMaintenanceAttempts,
    maintenanceAttemptsRevision,
    maintenanceObservationLimit,
    observeMaintenance,
    refreshRefusedMaintenanceAttempt,
    requestFramework,
    requestMaintenance,
    resourceKey,
    subscribeMaintenanceAttempts,
} from './operations';
interface Evidence<T> {
    value?: T;
    error?: string;
    loading?: boolean;
}
type Review = { finding: Finding; fingerprint: string } | { framework: Framework; fingerprint: string };
export function maintenanceDeploymentsHref(pathname: string) {
    const base = pathname.replace(/\/maintenance\/?$/, '');
    return `#${base}/deployments`;
}
export function MaintenancePage({
    pollInterval = 10_000,
    pollLimit = 180,
    deploymentsHref,
}: { pollInterval?: number; pollLimit?: number; deploymentsHref?: string } = {}) {
    const { data: me } = useMe(),
        auth = useAuthSnapshot(),
        revision = getAuthSessionRevision();
    const access = maintenanceAccess(auth.authenticated && String(me?.id) === auth.uid ? me : null);
    const location = useLocation();
    const [aws, setAWS] = useState<Evidence<Report>>({}),
        [framework, setFramework] = useState<Evidence<Framework>>({}),
        [mode, setMode] = useState<Evidence<'managed' | 'external'>>({});
    const [review, setReview] = useState<Review | null>(null),
        [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const controller = useRef<AbortController | null>(null),
        inFlight = useRef(false),
        readGeneration = useRef(0);
    const current = useRef({ access, mode, aws, framework, review });
    current.current = { access, mode, aws, framework, review };
    const attemptRevision = useSyncExternalStore(
        subscribeMaintenanceAttempts,
        maintenanceAttemptsRevision,
        maintenanceAttemptsRevision,
    );
    const attempts = getMaintenanceAttempts();
    const load = useCallback(
        async (refresh = false) => {
            const c = controller.current;
            if (!c || c.signal.aborted) return;
            const generation = ++readGeneration.current,
                fence = maintenanceFence({ signal: c.signal });
            setReview(null);
            setError('');
            const active = () =>
                !c.signal.aborted &&
                generation === readGeneration.current &&
                revision === getAuthSessionRevision();
            const permissions = current.current.access;
            await Promise.all([
                permissions.aws
                    ? (async () => {
                          setAWS({ loading: true });
                          try {
                              const value = await readMaintenance(fence, refresh);
                              if (active()) {
                                  setAWS({ value });
                                  if (refresh)
                                      for (const a of getMaintenanceAttempts())
                                          if ('kind' in a.input) refreshRefusedMaintenanceAttempt(a.key);
                              }
                          } catch (e) {
                              if (active()) setAWS({ error: message(e) });
                          }
                      })()
                    : Promise.resolve(),
                permissions.framework
                    ? (async () => {
                          setFramework({ loading: true });
                          try {
                              const value = await readFramework(fence, refresh);
                              if (active()) {
                                  setFramework({ value });
                                  if (refresh) refreshRefusedMaintenanceAttempt('framework');
                              }
                          } catch (e) {
                              if (active()) setFramework({ error: message(e) });
                          }
                      })()
                    : Promise.resolve(),
                permissions.bootstrap
                    ? (async () => {
                          setMode({ loading: true });
                          try {
                              const value = await readInfrastructure(fence);
                              if (active()) setMode({ value });
                          } catch (e) {
                              if (active()) setMode({ error: message(e) });
                          }
                      })()
                    : Promise.resolve(
                          setMode({ error: 'Mode proof requires independent bootstrap permission.' }),
                      ),
            ]);
        },
        [revision],
    );
    useEffect(() => {
        const c = new AbortController();
        controller.current = c;
        setReview(null);
        setAWS({});
        setFramework({});
        setMode({});
        setBusy(false);
        inFlight.current = false;
        void load();
        return () => {
            c.abort();
            readGeneration.current++;
            if (controller.current === c) controller.current = null;
        };
    }, [load, access.aws, access.framework, access.bootstrap]);
    useEffect(() => {
        const c = controller.current;
        if (!access.aws || !c || c.signal.aborted) return;
        const pending = attempts.filter(
            (a) => 'kind' in a.input && ['waiting', 'uncertain'].includes(a.state),
        );
        if (!pending.length) return;
        const timer = setTimeout(() => {
            for (const a of pending) {
                if (a.observations >= pollLimit) maintenanceObservationLimit(a);
                else void observeMaintenance(a, maintenanceFence({ signal: c.signal }));
            }
        }, pollInterval);
        return () => clearTimeout(timer);
        // Registry revision schedules the next bounded observation after the previous response.
    }, [attemptRevision, access.aws, pollInterval, pollLimit, revision]);
    const canWrite = mode.value === 'managed' && !mode.loading && access.manage;
    const submit = async (immediate: boolean) => {
        const consent = current.current.review,
            c = controller.current;
        if (!consent || inFlight.current || !c || c.signal.aborted) return;
        const ensure = () => {
            const state = current.current;
            if (
                state.mode.value !== 'managed' ||
                state.mode.loading ||
                !state.access.manage ||
                ('finding' in consent
                    ? !state.access.aws ||
                      !state.aws.value?.findings.some((f) => JSON.stringify(f) === consent.fingerprint)
                    : !state.access.framework ||
                      JSON.stringify(state.framework.value) !== consent.fingerprint)
            )
                throw new MaintenanceError('denied');
        };
        try {
            ensure();
        } catch (e) {
            setReview(null);
            setError(message(e));
            return;
        }
        inFlight.current = true;
        setBusy(true);
        setError('');
        const fence = maintenanceFence({ signal: c.signal, beforeSend: ensure });
        try {
            if ('finding' in consent) {
                const f = consent.finding;
                await requestMaintenance(
                    {
                        kind: f.kind,
                        resource: f.resource_id,
                        target_version: f.available_major,
                        confirm_resource: f.resource_id,
                        apply_immediately: immediate,
                    },
                    fence,
                );
            } else if (consent.framework.latest) await requestFramework(consent.framework.latest, fence);
        } catch (e) {
            if (!c.signal.aborted) {
                setError(message(e));
                if (e instanceof MaintenanceError && e.code === 'fresh_auth_required') {
                    setReview(null);
                    await requestFreshAuth();
                }
            }
        } finally {
            if (!c.signal.aborted) {
                setReview(null);
                setBusy(false);
                inFlight.current = false;
            }
        }
    };
    const refreshStatus = async () => {
        const c = controller.current;
        if (!c) return;
        setReview(null);
        for (const a of getMaintenanceAttempts())
            if ('kind' in a.input && !['sending', 'refused', 'complete'].includes(a.state))
                await observeMaintenance(a, maintenanceFence({ signal: c.signal }));
    };
    const row = (f: Finding) => {
        const attempt = getMaintenanceAttempt(resourceKey({ kind: f.kind, resource: f.resource_id }));
        return (
            <article className="maintenance-resource" key={`${f.kind}:${f.resource_id}`}>
                <div>
                    <h3>{f.resource_id}</h3>
                    <p>
                        {f.kind} · {f.engine} ·{' '}
                        <span className="mono">
                            {f.current_version} → {f.available_major}
                        </span>
                    </p>
                    <p>
                        Live: {f.status ?? 'unknown'} · Pending: {f.pending_version ?? 'unknown'} · Settled:{' '}
                        {f.settled === null ? 'unknown' : String(f.settled)}
                    </p>
                    {f.engine_versions && (
                        <p>
                            Member versions: {f.engine_versions.join(', ') || 'unknown'}
                            {f.members === undefined ? '' : ` · ${f.members} members`}
                        </p>
                    )}
                    <p>Standard support deadline: {f.deadline ?? 'unknown / unpublished'}</p>
                    <p>Extended support deadline: {f.extended_deadline ?? 'unknown / unpublished'}</p>
                    {f.note && <p>{f.note}</p>}
                    {f.release_notes_url && (
                        <a href={f.release_notes_url} target="_blank" rel="noopener noreferrer">
                            Release notes
                        </a>
                    )}
                    {attempt && <p role="status">{attempt.message}</p>}
                </div>
                {canWrite && access.aws && !attempt && aws.value?.status === 'ok' && (
                    <button
                        className="btn"
                        onClick={() => setReview({ finding: f, fingerprint: JSON.stringify(f) })}
                    >
                        Upgrade {f.resource_id}
                    </button>
                )}
            </article>
        );
    };
    if (!me && auth.authenticated) return <p>Checking Maintenance permissions…</p>;
    if (!access.aws && !access.framework)
        return <p role="alert">Maintenance requires global AWS or framework read permission.</p>;
    const fw = framework.value;
    return (
        <main className="admin-maintenance">
            <header>
                <div>
                    <p className="muted">Operations</p>
                    <h1>Maintenance</h1>
                    <p>Offered database and cache upgrades, and the framework update policy.</p>
                </div>
                <button className="btn" disabled={busy} onClick={() => void load(true)}>
                    Refresh Maintenance
                </button>
            </header>
            <p className="maintenance-mode">
                {mode.value === 'external'
                    ? 'External infrastructure: your infrastructure team applies upgrades through IaC. Evidence remains available here.'
                    : mode.value === 'managed'
                      ? 'Managed infrastructure confirmed.'
                      : `Infrastructure mode is unconfirmed. Upgrade controls require current managed-mode proof. ${mode.error ?? ''}`}
            </p>
            {error && <p role="alert">{error}</p>}
            {access.aws && (
                <>
                    <section aria-label="AWS scan evidence">
                        <h2>Scan evidence</h2>
                        {aws.loading && <p>Reading AWS evidence…</p>}
                        {aws.error && <p role="alert">AWS inventory is unavailable: {aws.error}</p>}
                        {aws.value && (
                            <>
                                <p>
                                    Region: {aws.value.region ?? 'unknown'} · Scan time:{' '}
                                    {aws.value.generated_at ?? 'unknown'}
                                </p>
                                <p>
                                    Scheduled scanning:{' '}
                                    {aws.value.scheduled
                                        ? 'on'
                                        : 'off — this page only reflects the current scan'}
                                </p>
                                {aws.value.status === 'unavailable' && (
                                    <p role="alert">
                                        AWS is unavailable. Offered upgrades are unknown. {aws.value.reason}
                                    </p>
                                )}
                                {aws.value.warnings.map((w, i) => (
                                    <p className="maintenance-warning" key={i}>
                                        Incomplete evidence: {w.iam_action}
                                        {w.aws_code ? ` (${w.aws_code})` : ''}. These resources or live states
                                        were not fully read.
                                    </p>
                                ))}
                            </>
                        )}
                    </section>
                    <section aria-label="Database">
                        <h2>Database</h2>
                        {aws.value?.findings.filter((f) => f.kind !== 'elasticache').map(row)}
                        {aws.value?.status === 'ok' &&
                            !aws.value.findings.some((f) => f.kind !== 'elasticache') && (
                                <p>
                                    No offered major upgrades found in this scan. Complete inventory and
                                    support coverage are unknown.
                                </p>
                            )}
                    </section>
                    <section aria-label="Cache">
                        <h2>Cache</h2>
                        {aws.value?.findings.filter((f) => f.kind === 'elasticache').map(row)}
                        {aws.value?.status === 'ok' &&
                            !aws.value.findings.some((f) => f.kind === 'elasticache') && (
                                <p>
                                    No offered major upgrades found in this scan. Complete inventory and
                                    support coverage are unknown.
                                </p>
                            )}
                    </section>
                </>
            )}
            {access.framework && (
                <section aria-label="Framework">
                    <h2>Framework</h2>
                    {framework.loading && <p>Reading Framework evidence…</p>}
                    {framework.error && (
                        <p role="alert">Framework evidence is unavailable: {framework.error}</p>
                    )}
                    {fw && (
                        <>
                            <dl>
                                <dt>Installed</dt>
                                <dd>{fw.installed ?? 'unknown'}</dd>
                                <dt>Latest published</dt>
                                <dd>{fw.latest ?? 'unknown'}</dd>
                                <dt>Checked</dt>
                                <dd>{fw.checked_at ?? 'unknown'}</dd>
                                <dt>Source</dt>
                                <dd>{fw.source}</dd>
                                <dt>Pin policy</dt>
                                <dd>
                                    {fw.pin.mode} {fw.pin.value}
                                </dd>
                                <dt>Update available</dt>
                                <dd>{String(fw.update_available)}</dd>
                                <dt>Can update</dt>
                                <dd>{String(fw.can_update)}</dd>
                            </dl>
                            {fw.blocked_reason && <p>Blocked: {fw.blocked_reason.replaceAll('_', ' ')}</p>}
                            {canWrite && fw.can_update && !getMaintenanceAttempt('framework') && (
                                <button
                                    className="btn"
                                    onClick={() =>
                                        setReview({ framework: fw, fingerprint: JSON.stringify(fw) })
                                    }
                                >
                                    {frameworkActionLabel(fw)}
                                </button>
                            )}
                        </>
                    )}
                </section>
            )}
            {attempts.length > 0 && (
                <section aria-label="Submitted operations">
                    <h2>Submitted operations</h2>
                    <p>
                        Requests stay guarded across refresh, navigation and authentication renewal. Unknown
                        outcomes require provider/window reconciliation; refreshing an old version does not
                        authorize another request.
                    </p>
                    {attempts.map((a) => (
                        <article key={a.key}>
                            <h3>{a.key}</h3>
                            <p role="status">{a.message}</p>
                            {'kind' in a.input ? (
                                <p>
                                    Target: {a.input.target_version} · Window:{' '}
                                    {a.input.apply_immediately ? 'immediately' : 'next maintenance window'} ·
                                    Observations: {a.observations}
                                </p>
                            ) : (
                                <>
                                    <p>
                                        Policy clearing and deployment submission are separate steps.
                                        Automatic policy does not prove a deployment was accepted.
                                    </p>
                                    {a.deployment && (
                                        <p>
                                            Deployment {a.deployment.id} · SHA {a.deployment.sha} ·{' '}
                                            {a.deployment.status}
                                        </p>
                                    )}
                                </>
                            )}
                        </article>
                    ))}
                    {access.aws && (
                        <button className="btn" disabled={busy} onClick={() => void refreshStatus()}>
                            Refresh submitted resource status
                        </button>
                    )}
                    {access.framework && (
                        <a href={deploymentsHref ?? maintenanceDeploymentsHref(location.pathname)}>
                            Open Deployments
                        </a>
                    )}
                </section>
            )}
            {review && (
                <MaintenanceDialog
                    {...('finding' in review ? { finding: review.finding } : { framework: review.framework })}
                    busy={busy}
                    onConfirm={(immediate) => void submit(immediate)}
                    onClose={() => {
                        if (!inFlight.current) setReview(null);
                    }}
                />
            )}
        </main>
    );
}
function message(e: unknown) {
    return e instanceof MaintenanceError ? e.message : 'Evidence is unavailable; refresh before continuing.';
}
