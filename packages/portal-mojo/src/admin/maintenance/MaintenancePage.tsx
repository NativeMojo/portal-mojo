import { Tabs } from '../../ui/Tabs';
import { useQueryClient } from '@tanstack/react-query';
import { SettingModel } from '../settings/model';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { getAuthSessionRevision, requestFreshAuth, useAuthSnapshot, useMe } from '../../client/runtime';
import { date, datetime } from '../../ui/format';
import { MaintenanceDialog, MaintenancePolicyDialog, MaintenanceProgressDialog } from './MaintenanceDialogs';
import { FleetHelp as MaintenanceHelp } from '../fleet/FleetHelp';
import { useAdminRouteContext } from '../core/route-context';
import {
    frameworkActionLabel, frameworkStatusLabel, supportUrgency,
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
    subscribeMaintenanceAttempts, canRequestMaintenance, requestPolicy, reconcilePolicy, observeFramework, type MaintenanceAttempt,
} from './operations';
function ObservedTime({ value, dateOnly = false }: { value: string | number | null | undefined; dateOnly?: boolean }) {
    return value != null ? <time dateTime={String(value)} title={String(value)}>{dateOnly ? date(value) : datetime(value)}</time> : <>unknown / unpublished</>;
}
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
    const location = useLocation(), route = useAdminRouteContext();
    const queryClient = useQueryClient();
    const deploymentLink = deploymentsHref ?? (route ? route.paths.includes(`${route.mount.replace(/\/$/, '')}/deployments`) ? `#${route.mount.replace(/\/$/, '')}/deployments` : undefined : maintenanceDeploymentsHref(location.pathname));
    const [policy, setPolicy] = useState<Framework | null>(null), [progress, setProgress] = useState<string | null>(null);
    const [aws, setAWS] = useState<Evidence<Report>>({}),
        [framework, setFramework] = useState<Evidence<Framework>>({}),
        [mode, setMode] = useState<Evidence<'managed' | 'external'>>({});
    const [review, setReview] = useState<Review | null>(null),
        [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const controller = useRef<AbortController | null>(null),
        inFlight = useRef(false),
        readGeneration = useRef(0);
    const currentUser = useRef(me); currentUser.current = me;
    const current = useRef({ access, mode, aws, framework, review });
    current.current = { access, mode, aws, framework, review };
    const attemptRevision = useSyncExternalStore(
        subscribeMaintenanceAttempts,
        maintenanceAttemptsRevision,
        maintenanceAttemptsRevision,
    );
    const attempts = getMaintenanceAttempts().filter(a => 'kind' in a.input ? access.aws : access.framework);
    const readScope = (a: MaintenanceAttempt, signal?: AbortSignal) => maintenanceFence({ signal, beforeSend: () => { const grants = current.current.access; if ('kind' in a.input ? !grants.aws : !grants.framework) throw new MaintenanceError('denied'); } });
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
                                  reconcilePolicy(value);
                                  if (refresh) { refreshRefusedMaintenanceAttempt('framework'); refreshRefusedMaintenanceAttempt('framework-policy'); }
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
        setReview(null); setPolicy(null); setProgress(null);
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
        if (!c || c.signal.aborted) return;
        const pending = attempts.filter(
            (a) => ('kind' in a.input || 'version' in a.input && !!a.deployment) && ['waiting', 'uncertain', 'accepted'].includes(a.state),
        );
        if (!pending.length) return;
        const timer = setTimeout(() => {
            for (const a of pending) {
                if (a.observations >= pollLimit) maintenanceObservationLimit(a);
                else if ('kind' in a.input) void observeMaintenance(a, readScope(a, c.signal));
                else void observeFramework(a, readScope(a, c.signal));
            }
        }, pollInterval);
        return () => clearTimeout(timer);
        // Registry revision schedules the next bounded observation after the previous response.
    }, [attemptRevision, access.aws, pollInterval, pollLimit, revision]);
    const canWrite = mode.value === 'managed' && !mode.loading && access.manage;
    const canPolicy = canWrite && me?.is_active === true && me?.is_superuser === true && access.framework;
    useEffect(() => { if (!canPolicy) setPolicy(null); }, [canPolicy]);
    const submitPolicy = async (value: string) => {
        const c = controller.current; if (!c || inFlight.current || !canPolicy) return;
        inFlight.current = true; setBusy(true); setError('');
        const fence = maintenanceFence({ signal: c.signal, beforeSend: () => { const st = current.current; if (!st.access.manage || !st.access.framework || st.mode.value !== 'managed' || st.mode.loading || (currentUser.current?.is_superuser !== true || currentUser.current?.is_active !== true)) throw new MaintenanceError('denied'); } });
        try {
            await requestPolicy(value, fence);
            const fresh = await readFramework(fence, true); fence.beforeSend?.(); setFramework({ value: fresh }); reconcilePolicy(fresh);
        } catch (reason) {
            if (!c.signal.aborted) { setError(message(reason)); if (reason instanceof MaintenanceError && reason.code === 'fresh_auth_required') await requestFreshAuth(); else if (getMaintenanceAttempt('framework-policy')?.state !== 'refused') setProgress('framework-policy'); }
        } finally { void queryClient.invalidateQueries({queryKey:SettingModel.keys.root}); if (!c.signal.aborted) { setPolicy(null); setBusy(false); inFlight.current = false; } }
    };
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
                      consent.framework.pin.mode !== 'latest' && (currentUser.current?.is_superuser !== true || currentUser.current?.is_active !== true) ||
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
    const observeOne = async (a: MaintenanceAttempt) => {
        const c = controller.current; if (!c || inFlight.current) return;
        inFlight.current = true; setBusy(true); setReview(null);
        try {
            const fence = readScope(a, c.signal);
            if ('kind' in a.input) await observeMaintenance(a, fence);
            else if ('version' in a.input) await observeFramework(a, fence);
            else { const value = await readFramework(fence, true); fence.beforeSend?.(); setFramework({ value }); reconcilePolicy(value); void queryClient.invalidateQueries({queryKey:SettingModel.keys.root}); }
        } catch (reason) { if (!c.signal.aborted) setError(message(reason)); }
        finally { if (!c.signal.aborted) { inFlight.current = false; setBusy(false); } }
    };
    const refreshStatus = async () => {
        for (const a of attempts) if (!['sending','refused','complete'].includes(a.state)) await observeOne(a);
    };
    const row = (f: Finding) => {
        const attempt = getMaintenanceAttempt(resourceKey({ kind: f.kind, resource: f.resource_id }));
        const live = attempt?.observation, currentVersion = live?.engine_version ?? f.current_version, urgency = supportUrgency(f);
        return (
            <article className="maintenance-resource" key={`${f.kind}:${f.resource_id}`}>
                <div>
                    <h3>{f.resource_id}</h3>
                    <p>
                        {f.engine} ·{' '}
                        <span className="mono">
                            {currentVersion}{currentVersion !== f.available_major ? ` → ${f.available_major}` : ''}
                        </span>
                    </p>
                    <p className="maintenance-resource-status">{live?.status ?? f.status ?? 'Provider status unknown'}{(live?.pending_version ?? f.pending_version) ? ` · pending ${live?.pending_version ?? f.pending_version}` : ''}</p>
                    {urgency && <p className={f.days_remaining! <= 0 ? 'text-bad' : 'maintenance-warning'}>{urgency}</p>}
                    <details className="maintenance-details"><summary>Support &amp; upgrade details</summary>
                        <p>Resource: {f.kind} · Live: {f.status ?? 'unknown'} · Pending: {f.pending_version ?? 'not reported'} · {f.settled === null ? 'Settlement unknown' : f.settled ? 'Settled' : 'Still changing'}</p>
                        {f.engine_versions && <p>Member versions: {f.engine_versions.join(', ') || 'unknown'}{f.members === undefined ? '' : ` · ${f.members} members`}</p>}
                        <p>Standard support deadline: <ObservedTime value={f.deadline} dateOnly /></p>
                        <p>Extended support deadline: <ObservedTime value={f.extended_deadline} dateOnly /></p>
                        {f.note && <p>{f.note}</p>}
                        <p>Review compatibility and snapshot-based recovery before a major upgrade. The confirmation explains restart and outage impact.</p>
                        {f.release_notes_url && <a href={f.release_notes_url} target="_blank" rel="noopener noreferrer">Release notes</a>}
                    </details>
                    {attempt && <p role="status">{attempt.state === 'complete' ? 'Upgrade observed' : 'Update submitted · '+attempt.state}</p>}
                </div>
                {canWrite && access.aws && !busy && canRequestMaintenance(resourceKey({ kind: f.kind, resource: f.resource_id }), { kind: f.kind, resource: f.resource_id, target_version: f.available_major, confirm_resource: f.resource_id, apply_immediately: true }) && aws.value?.status === 'ok' && (
                    <button
                        className="btn" aria-label={`Upgrade ${f.resource_id}`}
                        onClick={() => setReview({ finding: f, fingerprint: JSON.stringify(f) })}
                    >
                        Upgrade…
                    </button>
                )}
            </article>
        );
    };
    if (!me && auth.authenticated) return <p>Checking Maintenance permissions…</p>;
    if (!access.aws && !access.framework)
        return <p role="alert">Maintenance requires global AWS or framework read permission.</p>;
    const fw = framework.value;
    const tabs = [...(access.aws ? [{ key: 'database', label: 'Database', panel: (                    <section aria-label="Database">
                        <h2>Database</h2>
                        {aws.value?.findings.filter((f) => f.kind !== 'elasticache').map(row)}
                        {aws.value?.status === 'ok' &&
                            !aws.value.findings.some((f) => f.kind !== 'elasticache') && (
                                <p>
                                    No offered major upgrades found in this scan. Complete inventory and
                                    support coverage are unknown.
                                </p>
                            )}
                    </section>) }, { key: 'cache', label: 'Cache', panel: (                    <section aria-label="Cache">
                        <h2>Cache</h2>
                        {aws.value?.findings.filter((f) => f.kind === 'elasticache').map(row)}
                        {aws.value?.status === 'ok' &&
                            !aws.value.findings.some((f) => f.kind === 'elasticache') && (
                                <p>
                                    No offered major upgrades found in this scan. Complete inventory and
                                    support coverage are unknown.
                                </p>
                            )}
                    </section>) }] : []), ...(access.framework ? [{ key: 'framework', label: 'Django-MOJO', panel: (                <section aria-label="Framework">
                    <h2>Django-MOJO</h2>
                    {framework.loading && <p>Reading Framework evidence…</p>}
                    {framework.error && (
                        <p role="alert">Framework evidence is unavailable: {framework.error}</p>
                    )}
                    {fw && (
                        <>
                            <dl className="maintenance-framework-summary">
                                <div><dt>Installed</dt><dd>{fw.installed ?? 'unknown'}</dd></div>
                                <div><dt>Latest published</dt><dd>{fw.latest ?? 'unknown'}</dd></div>
                                <div><dt>Update policy <MaintenanceHelp label="policy permissions"><p>Policy changes require an active superuser and recent authentication. External infrastructure stays read-only here. Saving policy does not deploy it.</p></MaintenanceHelp></dt><dd>{fw.pin.mode === 'latest' ? 'Automatic updates' : fw.pin.mode === 'hold' ? 'Updates paused' : `Pinned to ${fw.pin.value ?? 'unknown version'}`}</dd></div>
                            </dl>
                            <p className={fw.source === 'unavailable' || fw.pin.mode !== 'latest' ? 'maintenance-warning' : 'dim'}>{frameworkStatusLabel(fw)} <MaintenanceHelp label="framework versions"><p>Installed is this responding node. Latest published comes from {fw.source === 'cache' ? 'cached PyPI evidence' : fw.source === 'pypi' ? 'PyPI' : 'an unavailable source'}. A paused policy can suppress the update-available flag.</p><p>Use deployment node evidence to verify the fleet.</p></MaintenanceHelp></p>
                            {fw.blocked_reason && <p className="maintenance-warning">{fw.blocked_reason.replaceAll('_', ' ')}</p>}
                            <details className="maintenance-details"><summary>Framework evidence</summary><p>Checked: <ObservedTime value={fw.checked_at} /> · Source: {fw.source}</p><p>Pin policy: {fw.pin.mode} {fw.pin.value}</p><p>An accepted framework update clears the pin and requests redeployment. Follow Deployments for fleet evidence.</p></details>
                            <div className="maintenance-actions">{canPolicy && canRequestMaintenance('framework-policy') && <button className="btn" disabled={busy} onClick={() => setPolicy(fw)}>Update policy</button>}
                            {canWrite && fw.can_update && canRequestMaintenance('framework', { version: fw.latest ?? '' }) && (
                                <button
                                    className="btn btn-primary" disabled={busy}
                                    onClick={() =>
                                        setReview({ framework: fw, fingerprint: JSON.stringify(fw) })
                                    }
                                >
                                    {frameworkActionLabel(fw)}
                                </button>
                            )}</div>
                        </>
                    )}
                </section>) }] : [])];
    return (
        <main className="admin-maintenance">
            <header>
                <div>
                    <p className="eyebrow">Operations</p>
                    <h1>Maintenance</h1>
                    <p>Keep your database, cache and Django-MOJO up to date.</p>
                </div>
                <button className="btn" disabled={busy} onClick={() => void load(true)}>
                    Refresh Maintenance
                </button>
            </header>
            {mode.value !== 'managed' && <p className="maintenance-mode">
                {mode.value === 'external'
                    ? 'External infrastructure: your infrastructure team applies upgrades through IaC. Evidence remains available here.'
                    : mode.value === 'managed'
                      ? 'Managed infrastructure confirmed.'
                      : `Infrastructure mode is unconfirmed. Upgrade controls require current managed-mode proof. ${mode.error ?? ''}`}
            </p>}
            {error && <p role="alert">{error}</p>}
            {access.aws && (
                <>
                    <section aria-label="AWS scan evidence" className="maintenance-scan">
                        {aws.loading && <p>Reading AWS evidence…</p>}
                        {aws.error && <p role="alert">AWS inventory is unavailable: {aws.error}</p>}
                        {aws.value && (
                            <>
                                <details className="ops-details"><summary>Scan details · <ObservedTime value={aws.value.generated_at} /></summary><p>
                                    Region: {aws.value.region ?? 'unknown'} · Scan time:{' '}
                                    <ObservedTime value={aws.value.generated_at} />
                                    {' · '}Scheduled scanning:{' '}
                                    {aws.value.scheduled
                                        ? 'on'
                                        : 'off — this page only reflects the current scan'}
                                </p></details>{!aws.value.scheduled && <p className="maintenance-warning">Scheduled scanning is off; results reflect this scan.</p>}
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


                </>
            )}
<Tabs items={tabs} defaultActiveKey={new URLSearchParams(location.search).get('tab')} ariaLabel="Maintenance category" />
            {attempts.length > 0 && (
                <section aria-label="Submitted operations">
                    <h2>Submitted operations</h2>
                    {attempts.map(a => <article key={a.key} className="maintenance-attempt-row"><div><strong>{'kind' in a.input ? a.input.resource : 'policy' in a.input ? 'Framework policy' : 'Django-MOJO'}</strong><p role="status">{a.state === 'complete' ? a.frameworkObservation ? `Deployment ${a.frameworkObservation.status}` : 'policy' in a.input ? 'Policy observed' : 'Upgrade observed' : a.state === 'uncertain' ? 'Outcome unknown' : a.state === 'accepted' ? 'Deployment submitted' : a.state === 'timeout' ? 'Observation paused' : a.state === 'refused' ? 'Request refused' : 'Update in progress'}</p></div><button className="btn" disabled={busy} onClick={() => setProgress(a.key)}>View progress</button></article>)}
                    {attempts.some(a => !['sending','refused','complete'].includes(a.state) && (!('version' in a.input) || !!a.deployment)) && (
                        <button className="btn" disabled={busy} onClick={() => void refreshStatus()}>
                            Refresh progress
                        </button>
                    )}
                    {access.framework && deploymentLink && (
                        <a href={deploymentLink}>
                            Open Deployments
                        </a>
                    )}
                </section>
            )}
            {policy && <MaintenancePolicyDialog framework={policy} busy={busy} error={error} onSave={value => void submitPolicy(value)} onClose={() => { if (!inFlight.current) setPolicy(null); }} />}
            {progress && attempts.find(a => a.key === progress) && <MaintenanceProgressDialog attempt={attempts.find(a => a.key === progress)!} busy={busy} deploymentsHref={deploymentLink} onClose={() => { if (!inFlight.current) setProgress(null); }} onObserve={() => { const a = attempts.find(a => a.key === progress); if (a) void observeOne(a); }} />}
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
