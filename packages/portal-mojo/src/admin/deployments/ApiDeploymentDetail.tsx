import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMe } from '../../client/runtime';
import { Tabs } from '../../ui/Tabs';
import { datetime } from '../../ui/format';
import { modal } from '../../ui/modal';
import { canReadApi, canRecoverApi, isInteractive, assertOwner } from './permissions';
import { getPlatform, recoverApi } from './api';
import { apiActions, platformProof } from './deployment-state';
import { makeReceipt, settleReceipt } from './receipts';
import { useDeploymentObservation, useDeploymentOwner } from './useDeploymentObservation';
import { DeploymentHelp, ErrorNotice, Facts, Status, useCloseOnOwnerChange, useWrite } from './shared';
import type { ApiAction } from './types';
export function ApiDeploymentDetail({ id, onClose }: {
    id: string;
    onClose: () => void;
}) {
    const me = useMe(), s = useDeploymentOwner(), queryClient = useQueryClient();
    const [tracking, setTracking] = useState<string | null>(null);
    useCloseOnOwnerChange(s.key, onClose);
    const q = useQuery({
        queryKey: ['deployments', s.key, 'api-detail', id], queryFn: ({ signal }) => getPlatform(s.owner, signal), enabled: canReadApi(me.data) && isInteractive(), retry: false
    });
    const selected = q.data?.deployments.data?.items.find(x => x.id === id);
    const identity = tracking ?? (selected && ['requested', 'queued', 'canary', 'fleet', 'deploying'].includes(selected.status) ? id : null);
    const observed = useDeploymentObservation(s.owner, identity, async (signal) => { const p = await getPlatform(s.owner, signal); const a = p.deployments.data?.items.find(x => x.id === identity); if (!a)
        throw new Error('Tracked deployment not observed'); return a; }, a => ['converged', 'failed', 'superseded', 'verified', 'partial', 'unknown'].includes(a.status));
    const row = observed.value ?? selected, latest = q.data?.deployments.data?.items[0]?.id === row?.id, can = canRecoverApi(me.data) && isInteractive();
    useEffect(() => { if (observed.state === 'terminal') void queryClient.invalidateQueries({ queryKey: ['deployments', s.key] }); }, [observed.state, observed.value?.id, observed.value?.status, queryClient, s.key]);
    const openRecovery = async (action: ApiAction) => { let busy = false; await modal.open(close => <ApiRecoveryDialog id={row!.id} action={action} onBusy={value => { busy = value; }} onClose={() => close(null)} onResult={result => { setTracking(result); void q.refetch(); }}/>, { signal: s.signal, canDismiss: () => !busy }); };
    if (!canReadApi(me.data) || !isInteractive())
        return <div className="modal-pad"><p>API authority is no longer available.</p><button className="btn" onClick={onClose}>Close</button></div>;
    return <div className="modal-pad admin-deployments deployment-dialog"><header className="deployment-dialog-header"><div><h2 className="modal-title">API deployment {row && <DeploymentHelp label="API attempt information"><Facts rows={[["Attempt", row.id], ["Source", row.source], ["Actor", row.actor], ["Retry of", row.retry_of]]}/><p>Reported success and restart proof are separate. Recovery applies to the latest attempt and does not accept an arbitrary commit.</p></DeploymentHelp>}</h2><p className="dim mono">{row?.sha.slice(0, 12) || 'Attempt details'}</p></div><div className="deployment-actions"><button className="btn" disabled={q.isFetching} onClick={() => { void q.refetch(); observed.refresh(); }}>Refresh evidence</button><button className="btn" aria-label="Close API deployment" onClick={onClose}>Close</button></div></header>
        {q.isError && <ErrorNotice>Deployment observation unavailable. {q.data ? 'Previous evidence is shown.' : 'Refresh to try again.'}</ErrorNotice>}
        {row && <div className="deployment-toolbar"><Status value={row.status}/>{can && latest && <div className="deployment-actions">{apiActions(row.status).map(action => <button key={action} className="btn" onClick={() => void openRecovery(action)}>{action === 'retry' ? 'Retry same commit' : action === 'verify' ? 'Verify nodes' : 'Converge fleet'}</button>)}</div>}</div>}
        <Tabs ariaLabel="API deployment details" items={[
            {key:'overview',label:'Overview',panel:<div className="deployment-tab-content">{row ? <><Facts rows={[["Commit", <code>{row.sha}</code>], ['Evidence', platformProof(row)], ['Started', row.started ? datetime(row.started) : row.created ? datetime(row.created) : 'Time unavailable'], ['Finished', row.finished ? datetime(row.finished) : 'Not finished']]}/>{row.detail && <p>{row.detail}</p>}</> : <p>{q.isPending ? 'Loading attempt…' : q.data?.deployments.data ? 'Attempt unavailable in the latest 50 records.' : 'The collector did not return deployment evidence.'}</p>}</div>},
            {key:'nodes',label:'Nodes',panel:<div className="deployment-tab-content">{row?.node_evidence.length ? row.node_evidence.map((n,i)=><article className="deployment-evidence" key={i}><strong>{n.runner}</strong><Status value={n.status}/>{n.sha && <p className="mono">{n.sha}</p>}{n.detail && <p>{n.detail}</p>}</article>) : <p>No node proof observed.</p>}</div>},
            {key:'activity',label:'Activity',panel:<div className="deployment-tab-content">{row?.diagnosis.length ? <><h3>Failure diagnosis</h3>{row.diagnosis.map((d,i)=><article className="deployment-evidence" key={i}><strong>{d.runner}</strong><Status value={d.status}/><p>{d.detail}</p>{d.stderr_tail && <pre className="deployment-code">{d.stderr_tail}</pre>}</article>)}</> : <p>No failure diagnosis recorded.</p>}{!!row?.transitions.length && <><h3>Activity</h3>{row.transitions.map((t,i)=><p key={i}>{t.runner} · {t.status}{t.detail && ` · ${t.detail}`}</p>)}</>}</div>}
        ]}/>
        {identity && <p className="dim" role="status">{observed.state === 'observing' ? 'Observing this attempt…' : observed.state === 'terminal' ? 'Observation complete.' : 'Observation stopped; outcome may be unknown. Refresh to observe again.'}</p>}
    </div>;
}
function ApiRecoveryDialog({ id, action, onClose, onBusy, onResult }: {
    id: string;
    action: ApiAction;
    onClose: () => void;
    onBusy: (v: boolean) => void;
    onResult: (id: string) => void;
}) {
    const me = useMe(), s = useDeploymentOwner(), w = useWrite(s.owner, s.signal, onBusy);
    const execute = () => w.run(async () => { if (!canRecoverApi(me.data) || !isInteractive())
        throw new Error('API recovery authority unavailable'); const fresh = await getPlatform(s.owner, s.signal), source = fresh.deployments.data?.items.find(x => x.id === id); if (!source || !apiActions(source.status).includes(action) || fresh.deployments.data?.items[0]?.id !== id)
        throw new Error('Attempt was replaced or changed. Refresh and review again.'); assertOwner(s.owner, s.signal); const receipt = makeReceipt(s.owner, 'api', `${id}:${action}`, 0, id); const result = await recoverApi(s.owner, receipt, id, action, s.signal); if (action === 'retry' && result.sha !== source.sha)
        throw new Error('Retry did not preserve source SHA'); settleReceipt(receipt); onResult(result.id); onClose(); });
    const label = { retry: 'Retry same commit', verify: 'Verify nodes', converge: 'Converge fleet' }[action];
    return <div className="modal-pad admin-deployments"><h2 className="modal-title">{label} <DeploymentHelp label="API recovery target">Attempt <code>{id}</code>. The latest attempt and authority are checked before sending. A retry preserves its commit and tracks a new attempt.</DeploymentHelp></h2><p className="modal-message">{action === 'retry' ? 'Deploy the same commit as a new attempt.' : action === 'verify' ? 'Refresh runtime proof from the nodes in this attempt.' : 'Apply the current desired serving configuration across the fleet, then verify it.'}</p>{w.error && <ErrorNotice>{w.error}</ErrorNotice>}<div className="modal-actions"><button className="btn" disabled={w.busy} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={w.busy} onClick={() => void execute()}>{label}</button></div></div>;
}
