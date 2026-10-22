import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMe } from '../../client/runtime';
import { DetailView } from '../../ui/DetailView';
import { modal } from '../../ui/modal';
import { canReadApi, canRecoverApi, isInteractive, assertOwner } from './permissions';
import { getPlatform, recoverApi } from './api';
import { apiActions, platformProof } from './deployment-state';
import { makeReceipt, settleReceipt } from './receipts';
import { useDeploymentObservation, useDeploymentOwner } from './useDeploymentObservation';
import { ErrorNotice, Facts, Status, useCloseOnOwnerChange, useWrite } from './shared';
import type { ApiAction } from './types';
export function ApiDeploymentDetail({ id, onClose }: {
    id: string;
    onClose: () => void;
}) {
    const me = useMe(), s = useDeploymentOwner();
    const [tracking, setTracking] = useState<string | null>(null);
    useCloseOnOwnerChange(s.key, onClose);
    const q = useQuery({
        queryKey: ['deployments', s.key, 'api-detail', id], queryFn: ({ signal }) => getPlatform(s.owner, signal), enabled: canReadApi(me.data) && isInteractive(), retry: false
    });
    const observed = useDeploymentObservation(s.owner, tracking, async (signal) => { const p = await getPlatform(s.owner, signal); const a = p.deployments.data?.items.find(x => x.id === tracking); if (!a)
        throw new Error('Tracked deployment not observed'); return a; }, a => ['converged', 'failed', 'superseded'].includes(a.status));
    const row = (tracking ? observed.value : null) ?? q.data?.deployments.data?.items.find(x => x.id === id), can = canRecoverApi(me.data) && isInteractive();
    const openRecovery = async (action: ApiAction) => { let busy = false; await modal.open(close => <ApiRecoveryDialog id={id} action={action} onBusy={value => { busy = value; }} onClose={() => close(null)} onResult={result => { setTracking(result); void q.refetch(); }}/>, { signal: s.signal, canDismiss: () => !busy }); };
    if (!canReadApi(me.data) || !isInteractive())
        return <div className="modal-pad"><p>API authority is no longer available.</p><button className="btn" onClick={onClose}>Close</button></div>;
    return <DetailView title="API deployment" subtitle={row?.sha || id} icon="bi-cloud-arrow-up" onClose={onClose} contextMenu={can && row ? apiActions(row.status).map(action => ({ label: action === 'retry' ? 'Retry same SHA' : action === 'verify' ? 'Verify node proof' : 'Converge fleet', onSelect: () => void openRecovery(action) })) : []} sections={[{
            key: 'overview', label: 'Overview', icon: 'bi-info-circle', render: () => <div className="panel panel-pad admin-deployments">{row ? <><Facts rows={[['Attempt', row.id], ['SHA', row.sha], ['Status', <Status value={row.status}/>], ['Evidence', platformProof(row)], ['Source', row.source], ['Actor', row.actor], ['Retry of', row.retry_of], ['Started', row.started], ['Finished', row.finished], ['Detail', row.detail]]}/><p className="dim">Reported success and restart proof are separate. Recovery never accepts an arbitrary SHA.</p></> : <p>Attempt unavailable in the bounded latest 50 records.</p>}{tracking && <p role="status">Tracking {tracking}: {observed.state}. {observed.observedAt ? `Observed ${new Date(observed.observedAt).toLocaleTimeString()}` : ''}{['stopped', 'error'].includes(observed.state) && ' Outcome unknown; Refresh only observes.'}</p>}<button className="btn" onClick={() => { void q.refetch(); observed.refresh(); }}>Refresh evidence</button></div>
        }, {
            key: 'diagnosis', label: 'Failure diagnosis', icon: 'bi-exclamation-triangle', render: () => <div className="panel panel-pad admin-deployments"><h3>Durable diagnosis</h3>{row?.diagnosis.map((d, i) => <p key={i}>{d.runner} · {d.status} · {d.detail}{d.stderr_tail && <pre>{d.stderr_tail}</pre>}</p>)}<h3>Node evidence</h3>{row?.node_evidence.map((n, i) => <p key={i}>{n.runner} · {n.status} · {n.sha || 'No SHA proof'} · {n.detail}</p>)}</div>
        }]}/>;
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
    return <div className="modal-pad"><h2 className="modal-title">Confirm {action === 'retry' ? 'same-SHA retry' : action}</h2><p className="modal-message">Apply {action} to exact API attempt {id}. The current attempt and authority are re-observed before sending. A retry preserves its source SHA and tracks the returned attempt ID.</p>{w.error && <ErrorNotice>{w.error}</ErrorNotice>}<div className="modal-actions"><button className="btn" disabled={w.busy} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={w.busy} onClick={() => void execute()}>Confirm {action}</button></div></div>;
}
