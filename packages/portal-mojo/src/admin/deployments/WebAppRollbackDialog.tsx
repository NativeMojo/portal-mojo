import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMe } from '../../client/runtime';
import { getDeployment, getHistory, resolveAppAuthority, getSummary, getWebApp, rollback } from './api';
import { assertOwner, isInteractive } from './permissions';
import { rollbackEligible } from './deployment-state';
import { makeReceipt, receiptsFor, saveReceipt, settleReceipt } from './receipts';
import { useDeploymentObservation, useDeploymentOwner } from './useDeploymentObservation';
import { ErrorNotice, Status, useWrite } from './shared';
import type { DeploymentStatus, Release, WebAppObject } from './types';
export function WebAppRollbackDialog({ app, onClose, onBusy, onChanged }: {
    app: WebAppObject;
    onClose: () => void;
    onBusy: (v: boolean) => void;
    onChanged: () => void;
}) {
    const s = useDeploymentOwner(), me = useMe(), w = useWrite(s.owner, s.signal, onBusy);
    const [target, setTarget] = useState(0), [confirmation, setConfirmation] = useState(''), [tracked, setTracked] = useState<DeploymentStatus | null>(null), [reconciled, setReconciled] = useState(false), [acknowledgement, setAcknowledgement] = useState('');
    const q = useQuery({
        queryKey: ['deployments', s.key, app.id, 'rollback-targets'], queryFn: async ({ signal }) => ({ summary: await getSummary(s.owner, app.id, signal), releases: await getHistory(s.owner, app.id, 'release', 0, signal) }), retry: false
    });
    const selected = q.data?.releases.items.find(x => x.id === target) as Release | undefined;
    const observation = useDeploymentObservation(s.owner, tracked ? String(tracked.deployment) : null, signal => getDeployment(s.owner, tracked!.deployment, app.id, tracked!.release, signal), d => d.terminal);
    const execute = () => w.run(async () => { if (!selected || confirmation !== `${app.slug}/${selected.version}`)
        return; const [object, summary] = await Promise.all([getWebApp(s.owner, app.id, s.signal), getSummary(s.owner, app.id, s.signal)]); if (object.group.id !== app.group.id)
        throw new Error('App ownership changed'); const authority = await resolveAppAuthority(s.owner, me.data, object, 'custom', s.signal); if (!isInteractive() || !authority.custom)
        throw new Error('Exact app authority is unavailable'); const fresh = await getHistory(s.owner, app.id, 'release', 0, s.signal), release = fresh.items.find(x => x.id === target) as Release | undefined; if (!release || !rollbackEligible(release, summary.current_release) || release.version !== selected.version)
        throw new Error('Target changed; refresh and confirm again'); assertOwner(s.owner, s.signal); const receipt = makeReceipt(s.owner, 'rollback', `${app.id}:${target}`, app.id, String(target)); const result = await rollback(s.owner, receipt, app.id, target, app.group.id, s.signal); saveReceipt({
        ...receipt, deployment: result.deployment, release: target
    }); setTracked(result); setConfirmation(''); onChanged(); });
    const uncertain = receiptsFor(s.owner).find(r => r.kind === 'rollback' && r.app === app.id && r.submitted && !r.settled && !r.deployment);
    const reconcile = () => w.run(async () => { if (!uncertain)
        return; const summary = await getSummary(s.owner, app.id, s.signal), history = await getHistory(s.owner, app.id, 'deployment', 0, s.signal); const matches = history.items.filter(a => (a as import('./types').Attempt).release?.id === Number(uncertain.target) && Date.parse(a.created) >= (uncertain.submittedAt ?? 0) - 1000) as import('./types').Attempt[]; if (matches.length === 1) {
        const match = matches[0]!;
        const status = await getDeployment(s.owner, match.id, app.id, Number(uncertain.target), s.signal);
        saveReceipt({
            ...uncertain, deployment: status.deployment, release: status.release, settled: status.terminal
        });
        setTracked(status);
    }
    else {
        setConfirmation('');
        if (summary.current_release?.id === Number(uncertain.target))
            throw new Error('The target is already the current desired pointer. Refresh its deployment evidence instead of dispatching another rollback.');
        setReconciled(true);
    } });
    const acknowledge = () => { if (!uncertain || !reconciled || acknowledgement !== `${app.slug}/unknown-outcome`)
        return; saveReceipt({
        ...uncertain, settled: true, acknowledged: true
    }); setReconciled(false); setAcknowledgement(''); setConfirmation(''); };
    if (observation.value?.terminal) {
        const receipt = receiptsFor(s.owner).find(r => r.kind === 'rollback' && r.app === app.id && r.deployment === observation.value?.deployment);
        if (receipt && !receipt.settled)
            settleReceipt(receipt);
    }
    return <div className="modal-pad admin-deployments"><h2 className="modal-title">Roll back {app.display_name || app.slug}</h2><p className="modal-message">Select an earlier verified release. This changes the desired release and starts fleet deployment; a failed rollout can leave mixed nodes.</p>{q.isError && <ErrorNotice>Release observation unavailable. Refresh before choosing a target.</ErrorNotice>}<label>Verified release<select value={target} disabled={w.busy || !!tracked} onChange={e => { setTarget(Number(e.target.value)); setConfirmation(''); }}><option value={0}>Choose a version</option>{q.data?.releases.items.filter(x => rollbackEligible(x as Release, q.data!.summary.current_release)).map(r => <option key={r.id} value={r.id}>{(r as Release).version} · {r.status}</option>)}</select></label>{selected && <label>Type {app.slug}/{selected.version}<input value={confirmation} disabled={w.busy || !!tracked} onChange={e => setConfirmation(e.target.value)}/></label>}{uncertain && <div className="deployment-confirm"><p>A previous rollback may have persisted. Observe the fresh summary and deployment history before another decision.</p><button className="btn" disabled={w.busy} onClick={() => void reconcile()}>Observe uncertain rollback</button>{reconciled && <><p>No unique matching attempt was observed in bounded history. A new rollback can overlap the earlier operation. Acknowledge this unknown outcome, then review and type the app/version again to consent to a new operation.</p><label>Type {app.slug}/unknown-outcome<input value={acknowledgement} disabled={w.busy} onChange={e => setAcknowledgement(e.target.value)}/></label><button className="btn" disabled={w.busy || acknowledgement !== `${app.slug}/unknown-outcome`} onClick={acknowledge}>Acknowledge unknown outcome</button></>}</div>}{w.error && <ErrorNotice>{w.error}</ErrorNotice>}{tracked && <p role="status">Deployment {tracked.deployment}: <Status value={observation.value?.status ?? tracked.status}/> · {observation.state}. {['error', 'stopped'].includes(observation.state) && 'Outcome unknown; Refresh only reads.'}</p>}{observation.value?.detail && <p>{observation.value.detail}</p>}<div className="modal-actions"><button className="btn" disabled={w.busy} onClick={onClose}>{tracked ? 'Close' : 'Cancel'}</button>{tracked ? <button className="btn" onClick={observation.refresh}>Refresh exact deployment</button> : <button className="btn btn-primary" disabled={w.busy || !selected || confirmation !== `${app.slug}/${selected.version}`} onClick={() => void execute()}>Confirm rollback</button>}</div></div>;
}
