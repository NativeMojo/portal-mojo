import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { decodeJwt, getAccessToken, getAuthSessionRevision, getAuthSnapshot, isReauthRequired, requestFreshAuth, subscribeAuth, useMe } from '../../client/runtime';
import { backendGlobalCan } from './access';
import { readCapacity, requestCapacityPlan } from './api';
import { actionReason, compileFleetSteps, drainedNodeReason, monthlyPrice, newFleetDraft, nodeRemovalReason, offered, type FleetDraft } from './data';
import { fleetOperations, fleetSessionScope } from './operations';
import type { CapacityPlan, CapacityReport, CapacitySize } from './types';
export interface ScaleFleetDialogProps {
    scope: string;
    initialReport: CapacityReport;
    close: () => void;
    onRefresh?: () => void;
    debounceMs?: number;
}
function SizeChoice({ label, value, onChange, sizes, disabled }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    sizes: CapacitySize[];
    disabled?: boolean;
}) {
    return <label className="field"><span className="field-label">{label}</span><select className="input" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}><option value="">Keep current sizes</option>{sizes.map(s => <option key={s.size} value={s.size}>{s.label} · {s.type} · {s.monthly_usd == null ? 'price unknown' : `$${s.monthly_usd.toFixed(2)}/month per instance`}</option>)}</select></label>;
}
export function ScaleFleetDialog({ scope, initialReport, close, onRefresh, debounceMs = 400 }: ScaleFleetDialogProps) {
    const { data: me } = useMe();
    const [report, setReport] = useState(initialReport), [draft, setDraft] = useState(() => newFleetDraft(initialReport)), [plan, setPlan] = useState<CapacityPlan | null>(null), [consent, setConsent] = useState<string | null>(null), [error, setError] = useState(''), [planning, setPlanning] = useState(false), [refreshing, setRefreshing] = useState(false), [needsRefresh, setNeedsRefresh] = useState(false), [batchInput, setBatchInput] = useState(''), [tick, setTick] = useState(Date.now());
    const generation = useRef(0), alive = useRef(true), planBusy = useRef(false), applyBusy = useRef(false), readGeneration = useRef(0), readBusy = useRef(false), planAbort = useRef<AbortController | null>(null);
    const operation = useSyncExternalStore(fn => fleetOperations.subscribe(scope, fn), () => fleetOperations.get(scope), () => fleetOperations.get(scope));
    const blocked = ['submitting', 'running', 'unknown'].includes(operation.status);
    const invalidate = () => { generation.current++; planAbort.current?.abort(); setPlan(null); setConsent(null); setPlanning(false); setError(''); };
    const edit = (change: (d: FleetDraft) => FleetDraft) => { invalidate(); setDraft(change); };
    const authorized = () => { const jwt = decodeJwt(getAccessToken()); if (!jwt || ['api_key', 'group_scoped_token'].includes(String(jwt.credential_kind ?? '')))
        throw new Error('Scaling requires an interactive user session.'); if (fleetSessionScope() !== scope || !backendGlobalCan(me, 'manage_aws') || me?.is_superuser !== true || report.mode !== 'managed')
        throw new Error('Capacity authority changed. Refresh and review again.'); };
    const refresh = async () => { if (readBusy.current)
        return; readBusy.current = true; invalidate(); setRefreshing(true); setNeedsRefresh(true); const gen = ++readGeneration.current; try {
        authorized();
        const next = await readCapacity(true, { beforeSend: authorized });
        if (!alive.current || gen !== readGeneration.current || fleetSessionScope() !== scope)
            return;
        setReport(next);
        setDraft(newFleetDraft(next));
        setNeedsRefresh(false);
        onRefresh?.();
    }
    catch (e) {
        if (alive.current && fleetSessionScope() === scope)
            setError(e instanceof Error ? e.message : 'Inventory observation unavailable.');
    }
    finally {
        readBusy.current = false;
        if (alive.current)
            setRefreshing(false);
    } };
    useEffect(() => { alive.current = true; const startRevision = getAuthSessionRevision(); const unsubscribe = subscribeAuth(() => { if (!getAuthSnapshot().authenticated || getAuthSessionRevision() !== startRevision || fleetSessionScope() !== scope) {
        generation.current++;
        readGeneration.current++;
        planAbort.current?.abort();
        close();
    } }); return () => { alive.current = false; generation.current++; readGeneration.current++; planAbort.current?.abort(); unsubscribe(); }; }, [scope, close]);
    useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer); }, []);
    useEffect(() => { if (operation.status === 'done' || operation.status === 'failed')
        void refresh(); }, [operation.status]);
    useEffect(() => { const timer = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(timer); }, []);
    useEffect(() => { if (!backendGlobalCan(me, 'manage_aws') || me?.is_superuser !== true) {
        invalidate();
        close();
    } }, [me, close]);
    const compiled = useMemo(() => { try {
        return { steps: compileFleetSteps(report, draft), error: '' };
    }
    catch (e) {
        return { steps: [], error: e instanceof Error ? e.message : 'Invalid capacity proposal.' };
    } }, [report, draft]);
    useEffect(() => {
        if (!compiled.steps.length || compiled.error || needsRefresh || refreshing || blocked)
            return;
        const gen = ++generation.current;
        let timer: ReturnType<typeof setTimeout> | null = null, disposed = false;
        const run = async () => {
            if (disposed || gen !== generation.current)
                return;
            if (planBusy.current) {
                timer = setTimeout(() => void run(), 50);
                return;
            }
            planBusy.current = true;
            setPlanning(true);
            const abort = new AbortController();
            planAbort.current = abort;
            try {
                authorized();
                const next = await requestCapacityPlan(compiled.steps, { signal: abort.signal, beforeSend: () => { authorized(); if (disposed || gen !== generation.current)
                        throw new Error('Proposal changed.'); } });
                if (!alive.current || disposed || gen !== generation.current || fleetSessionScope() !== scope)
                    return;
                if (next.actor !== me?.id)
                    throw new Error('Plan actor does not match your account.');
                setPlan(next);
                setConsent(null);
                setError('');
            }
            catch (e) {
                if (!alive.current || disposed || gen !== generation.current)
                    return;
                setPlan(null);
                setConsent(null);
                setNeedsRefresh(true);
                setError(isReauthRequired(e) ? 'Authenticate again, refresh inventory, and review a new plan.' : e instanceof Error ? e.message : 'The plan could not be prepared.');
                if (isReauthRequired(e))
                    await requestFreshAuth();
            }
            finally {
                planBusy.current = false;
                if (alive.current && !disposed)
                    setPlanning(false);
            }
        };
        timer = setTimeout(() => void run(), debounceMs);
        return () => { disposed = true; if (timer)
            clearTimeout(timer); planAbort.current?.abort(); };
    }, [compiled, needsRefresh, refreshing, blocked, scope, debounceMs, me]);
    const apply = async () => { if (applyBusy.current || !plan || consent !== plan.id || blocked || needsRefresh || refreshing || Date.parse(plan.expires_at) <= Date.now())
        return; applyBusy.current = true; const reviewed = plan; setConsent(null); generation.current++; setError(''); try {
        authorized();
        if (reviewed.actor !== me?.id)
            throw new Error('Plan actor changed.');
        await fleetOperations.submit(scope, reviewed);
    }
    catch (e) {
        if (alive.current && fleetSessionScope() === scope)
            setError(e instanceof Error ? e.message : 'Apply was refused.');
    }
    finally {
        applyBusy.current = false;
        if (alive.current && fleetSessionScope() === scope) {
            setPlan(null);
            setNeedsRefresh(true);
            void refresh();
        }
        onRefresh?.();
    } };
    const expired = plan ? Date.parse(plan.expires_at) <= tick : false;
    const setDb = (id: string, patch: Partial<FleetDraft['databases'][string]>) => edit(d => ({ ...d, databases: { ...d.databases, [id]: { ...d.databases[id]!, ...patch } } }));
    const setCache = (id: string, patch: Partial<FleetDraft['caches'][string]>) => edit(d => ({ ...d, caches: { ...d.caches, [id]: { ...d.caches[id]!, ...patch } } }));
    const toggle = (key: 'removeNodes' | 'terminateNodes', id: string) => edit(d => ({ ...d, [key]: d[key].includes(id) ? d[key].filter(v => v !== id) : [...d[key], id] }));
    const sources = report.nodes.instances.filter(n => n.healthy && n.registered && n.instance_state === 'running');
    return <div className="modal-pad fleet-scale"><h2 className="modal-title">Scale fleet</h2><p className="modal-message">Stage capacity, review the server’s exact order and cost, then apply its stored plan once. Creates billable resources. Removed nodes and readers cannot be restored by undo; completed steps remain applied if later steps fail.</p><div className="fleet-scale-body">
        <div className="fleet-buttons"><p className="dim">Inventory observed {report.generated_at}</p><button className="btn" disabled={refreshing || operation.status === 'submitting'} onClick={() => void refresh()}>{refreshing ? 'Refreshing…' : 'Refresh inventory'}</button></div>
        {blocked && <section className="panel panel-pad" aria-label="Capacity progress"><h3>{operation.status === 'unknown' ? 'Progress unknown' : 'Capacity change in progress'}</h3><p role="status">{operation.message}</p><p>Plan: {operation.planId}<br />Batch: {operation.batchId ?? 'Not acknowledged'}</p>{operation.batch?.steps.map(s => <div className="fleet-progress-step" key={s.index}><strong>{s.index + 1}. {s.description} · {s.state}</strong><p>{s.phase}{s.message ? ` · ${s.message}` : ''}{s.error_code ? ` · ${s.error_code}` : ''}</p>{s.operation && <small>Operation {s.operation}</small>}</div>)}{operation.status === 'unknown' && !operation.batchId && <label className="field"><span className="field-label">Batch ID from server logs for this plan</span><input className="input" value={batchInput} onChange={e => setBatchInput(e.target.value)}/><span className="field-help">Inspect capacity batch logs and AWS state. Only a matching batch’s terminal evidence resolves this block; refreshing inventory or closing this dialog does not.</span></label>}<button className="btn" disabled={operation.status === 'submitting' || (!operation.batchId && !batchInput.trim())} onClick={() => void fleetOperations.observe(scope, batchInput)}>Refresh observation</button></section>}
        {!blocked && operation.status !== 'idle' && <section className="panel panel-pad" role="status"><h3>{operation.status === 'done' ? 'Batch completed' : 'Batch failed'}</h3><p>{operation.message}</p>{operation.status === 'failed' && <p>Completed steps remain applied. Nothing rolled back; refresh the actual inventory before planning recovery.</p>}{operation.batch?.steps.map(s => <p key={s.index}>{s.description} · {s.state}{s.error_code ? ` · ${s.error_code}` : ''}{s.operation ? ` · operation ${s.operation}` : ''}</p>)}</section>}
        <fieldset disabled={blocked || refreshing || needsRefresh}><h3>App nodes</h3><p className="dim">Node size is inherited from the source and shown for information. Removal drains before terminating. At least one currently healthy target must remain.</p>
            <div className="fleet-scale-fields"><label className="field"><span className="field-label">Add app nodes</span><input className="input" type="number" min={0} max={20} step={1} value={draft.addNodes} disabled={!offered(report, 'add_node')} onChange={e => edit(d => ({ ...d, addNodes: Number(e.target.value) }))}/>{!offered(report, 'add_node') && <span className="field-help">{actionReason(report, 'add_node')}</span>}</label>
            </div><details className="fleet-scale-disclosure"><summary>Advanced node placement</summary><div className="fleet-scale-fields"><label className="field"><span className="field-label">Clone source (optional)</span><select className="input" value={draft.source} onChange={e => edit(d => ({ ...d, source: e.target.value }))}><option value="">Automatic healthy source</option>{sources.map(n => <option key={n.id} value={n.id}>{n.name} · {n.id} · {n.instance_type} · {n.zone} · {n.subnet_id} · {n.groups.join(', ')}</option>)}</select></label>
            <label className="field"><span className="field-label">Subnet (optional)</span><input className="input" list="fleet-subnets" value={draft.subnet} placeholder={sources.find(n => n.id === draft.source)?.subnet_id ?? 'subnet-…'} onChange={e => edit(d => ({ ...d, subnet: e.target.value }))}/><datalist id="fleet-subnets">{[...new Set(sources.filter(n => !draft.source || n.zone === sources.find(s => s.id === draft.source)?.zone).map(n => n.subnet_id).filter(Boolean))].map(id => <option key={id} value={id!}/>)}</datalist><span className="field-help">AWS verifies VPC, same availability zone and address suitability. Empty fields are omitted.</span></label></div></details>
            <details className="fleet-scale-disclosure"><summary>Remove nodes</summary>
            {report.nodes.self_check !== 'matched' && <p className="text-warn">This serving node cannot identify itself. Node removal is unavailable until a fresh report identifies it.</p>}{report.nodes.instances.map(n => { const selected = draft.removeNodes.includes(n.id), reason = nodeRemovalReason(report, n, draft.removeNodes.filter(id => id !== n.id)); const recovery = drainedNodeReason(report, n); return <div key={n.id} className="fleet-node"><div><b>{n.name}</b><small>{n.id} · {n.instance_type ?? 'size unknown'} · {n.state} / {n.lifecycle_state}{n.self ? ' · serving this request' : ''}</small><small>{reason}</small></div>{!n.registered ? <label><input type="checkbox" checked={draft.terminateNodes.includes(n.id)} disabled={!!recovery} onChange={() => toggle('terminateNodes', n.id)}/> Terminate drained node<small>{recovery ?? 'Drain completed; server will re-prove ownership and drain before termination.'}</small></label> : <label><input type="checkbox" checked={selected} disabled={!!reason && !selected} onChange={() => toggle('removeNodes', n.id)}/> Remove node</label>}</div>; })}
            </details><details className="fleet-scale-disclosure"><summary>Database capacity</summary>{!report.databases_available && <p>Database inventory unavailable.</p>}{report.databases.map(row => { const d = draft.databases[row.identifier]!; const writer = row.kind === 'aurora' ? row.writer : row.identifier; return <section key={row.identifier} className="panel panel-pad"><h4>{row.identifier}</h4><p>{row.engine} · {row.status}{row.blocked_reason ? ` · ${row.blocked_reason}` : ''}</p><div className="fleet-scale-fields"><label className="field"><span className="field-label">Reader count for {row.identifier}</span><input className="input" type="number" min={0} max={20} step={1} value={d.readers} disabled={!!row.blocked_reason || (!offered(report, 'add_reader') && !offered(report, 'remove_reader'))} onChange={e => setDb(row.identifier, { readers: Number(e.target.value) })}/></label><SizeChoice label={`Writer size for ${row.identifier}`} value={d.writerSize} sizes={report.sizes.database} disabled={!!row.blocked_reason || !offered(report, 'resize_database') || !row.members.find(m => m.id === writer)?.can_resize} onChange={writerSize => setDb(row.identifier, { writerSize })}/><SizeChoice label={`Existing-reader size for ${row.identifier}`} value={d.readerSize} sizes={report.sizes.database} disabled={!!row.blocked_reason || !row.readers.length || !offered(report, 'resize_database') || row.members.some(m => row.readers.includes(m.id) && !m.can_resize)} onChange={readerSize => setDb(row.identifier, { readerSize })}/></div><p className="dim">Writer {writer ?? 'unknown'} · {row.writer_instance_class ?? row.instance_class ?? 'class unknown'}. Resizing the writer causes minutes offline. Existing-reader sizing changes each surviving reader independently; other readers and the writer keep serving.</p><p className="dim">New readers inherit the current writer/source class ({row.writer_instance_class ?? row.instance_class ?? 'unknown'}), even when the writer resizes in this plan. After creation, refresh their concrete IDs and review a separate resize.</p>{row.members.map(m => <small className="fleet-member" key={m.id}>{m.id} · {m.role} · {m.instance_class} · {m.status ?? 'status unknown'} / {m.lifecycle_state}</small>)}</section>; })}
            </details><details className="fleet-scale-disclosure"><summary>Redis capacity</summary>{!report.caches_available && <p>Redis inventory unavailable.</p>}{report.caches.map(row => { const d = draft.caches[row.identifier]!; return <section className="panel panel-pad" key={row.identifier}><h4>{row.identifier}</h4><p>{row.node_type} · {row.status}{row.blocked_reason ? ` · ${row.blocked_reason}` : ''}</p><div className="fleet-scale-fields"><label className="field"><span className="field-label">Replicas for {row.identifier}</span><input className="input" type="number" min={row.min_replicas} max={100} step={1} value={d.replicas} disabled={!!row.blocked_reason || !offered(report, 'set_cache_replicas')} onChange={e => setCache(row.identifier, { replicas: Number(e.target.value) })}/><span className="field-help">Server minimum: {row.min_replicas}. Replicas provide failover capacity; routing is a separate process setting.</span></label><SizeChoice label={`Group size for ${row.identifier}`} value={d.size} sizes={report.sizes.cache} disabled={!!row.blocked_reason || !offered(report, 'resize_cache')} onChange={size => setCache(row.identifier, { size })}/></div><p className="text-warn">{row.resize_impact === 'rolling' ? 'Rolling resize: replicas change first, followed by a brief primary failover interruption.' : 'Downtime resize: Redis is unavailable while its node is replaced.'} Size applies to the entire group. Downsizing risks eviction when the working set no longer fits.</p></section>; })}
            </details>
        </fieldset>
        {compiled.error && <p className="form-alert" role="alert">{compiled.error}</p>}{error && <p className="form-alert" role="alert">{error}</p>}{needsRefresh && !blocked && <p className="text-warn">Refresh inventory before staging or reviewing another plan.</p>}
        {planning && !blocked && <p role="status">Preparing the server plan…</p>}{!compiled.steps.length && !blocked && !compiled.error && <p className="dim">Choose a change to prepare a server plan.</p>}
        {plan && !blocked && <section className="panel panel-pad" aria-label="Review capacity plan"><h3>Review server plan · {plan.steps.length} steps</h3><p>{plan.order_note}</p><ol className="fleet-plan-steps">{plan.steps.map(s => <li key={s.index}><strong>{s.description}</strong><p>{monthlyPrice(s.monthly_delta_usd)}</p>{s.warnings.map((w, i) => <p className="text-warn" key={i}>{w}</p>)}</li>)}</ol><p><b>{plan.estimate_complete ? 'Estimated monthly change' : 'Partial monthly estimate'}: {monthlyPrice(plan.total_monthly_delta_usd)}</b>{!plan.estimate_complete && ' · some prices are unknown'}</p><p className="dim">Plan {plan.id} · expires {plan.expires_at}</p>{expired ? <p className="text-warn">This plan expired. Refresh inventory to prepare another review.</p> : <label><input type="checkbox" checked={consent === plan.id} onChange={e => setConsent(e.target.checked ? plan.id : null)}/> I reviewed this exact plan, its cost and interruptions, and understand removals cannot be undone.</label>}</section>}
    </div><div className="modal-actions"><button className="btn" disabled={operation.status === 'submitting'} onClick={close}>{blocked ? 'Close progress' : 'Cancel'}</button><button className="btn btn-primary" disabled={!plan || consent !== plan.id || expired || blocked || refreshing || needsRefresh || planning} onClick={() => void apply()}>Apply reviewed plan</button></div></div>;
}
