import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMe } from '../../client/runtime';
import { getDeployment, getHistory, getRelease, resolveAppAuthority, getSummary, getWebApp, rollback } from './api';
import { assertOwner, isInteractive } from './permissions';
import { rollbackEligible } from './deployment-state';
import { makeReceipt, receiptsFor, saveReceipt, settleReceipt } from './receipts';
import { useDeploymentObservation, useDeploymentOwner } from './useDeploymentObservation';
import { ErrorNotice, Status, useWrite } from './shared';
import type { DeploymentStatus, Release, WebAppObject } from './types';
export function WebAppRollbackDialog({ app, release, onClose, onBusy, onChanged }: {
    app: WebAppObject;
    release?: Release;
    onClose: () => void;
    onBusy: (v: boolean) => void;
    onChanged: () => void;
}) {
    const s = useDeploymentOwner(), me = useMe(), w = useWrite(s.owner, s.signal, onBusy);
    const pending = receiptsFor(s.owner).find(r => r.kind === 'rollback' && r.app === app.id && r.submitted && !r.settled);
    const [start, setStart] = useState(0), [selection, setSelection] = useState<Release | undefined>(release), [confirmation, setConfirmation] = useState('');
    const [tracked, setTracked] = useState<DeploymentStatus | null>(() => pending?.deployment && pending.release ? { deployment: pending.deployment, webapp: app.id, release: pending.release, version: '', status: 'unknown', terminal: false, success: false, detail: '', created: '', started: '', finished: '', targets: [], rollback_targets: [] } : null);
    const [reconciled, setReconciled] = useState(false), [acknowledgement, setAcknowledgement] = useState('');
    const q = useQuery({ queryKey: ['deployments', s.key, app.id, 'rollback-targets', start], queryFn: async ({ signal }) => ({ summary: await getSummary(s.owner, app.id, signal), releases: await getHistory(s.owner, app.id, 'release', start, signal) }), retry: false });
    const selected = selection, target = selected?.id ?? 0;
    const observation = useDeploymentObservation(s.owner, tracked ? String(tracked.deployment) : null, signal => getDeployment(s.owner, tracked!.deployment, app.id, tracked!.release, signal), d => d.terminal);
    const execute = () => w.run(async () => {
        if (!selected || confirmation !== `${app.slug}/${selected.version}` || !q.data || q.isError) return;
        const [object, summary, fresh] = await Promise.all([getWebApp(s.owner, app.id, s.signal), getSummary(s.owner, app.id, s.signal), getRelease(s.owner, target, app.id, s.signal)]);
        if (object.group.id !== app.group.id) throw new Error('App ownership changed');
        const authority = await resolveAppAuthority(s.owner, me.data, object, 'custom', s.signal);
        if (!isInteractive() || !authority.custom) throw new Error('Exact app authority is unavailable');
        if (!rollbackEligible(fresh, summary.current_release) || fresh.version !== selected.version) throw new Error('Target changed; refresh and confirm again');
        assertOwner(s.owner, s.signal);
        const receipt = makeReceipt(s.owner, 'rollback', `${app.id}:${target}`, app.id, String(target));
        const result = await rollback(s.owner, receipt, app.id, target, app.group.id, s.signal);
        saveReceipt({ ...receipt, deployment: result.deployment, release: target });
        setTracked(result); setConfirmation(''); onChanged();
    });
    const uncertain = receiptsFor(s.owner).find(r => r.kind === 'rollback' && r.app === app.id && r.submitted && !r.settled && !r.deployment);
    const reconcile = () => w.run(async () => {
        if (!uncertain) return;
        const summary = await getSummary(s.owner, app.id, s.signal), history = await getHistory(s.owner, app.id, 'deployment', 0, s.signal);
        const matches = history.items.filter(a => (a as import('./types').Attempt).release?.id === Number(uncertain.target) && Date.parse(a.created) >= (uncertain.submittedAt ?? 0) - 1000) as import('./types').Attempt[];
        if (matches.length === 1) {
            const match = matches[0]!, status = await getDeployment(s.owner, match.id, app.id, Number(uncertain.target), s.signal);
            saveReceipt({ ...uncertain, deployment: status.deployment, release: status.release, settled: status.terminal }); setTracked(status);
        } else {
            setConfirmation('');
            if (summary.current_release?.id === Number(uncertain.target)) throw new Error('The target is already the current desired pointer. Refresh its deployment evidence instead of dispatching another rollback.');
            setReconciled(true);
        }
    });
    const acknowledge = () => {
        if (!uncertain || !reconciled || acknowledgement !== `${app.slug}/unknown-outcome`) return;
        saveReceipt({ ...uncertain, settled: true, acknowledged: true }); setReconciled(false); setAcknowledgement(''); setConfirmation('');
    };
    const outcome = observation.value ?? tracked, notified = useRef(new Set<number>());
    useEffect(() => {
        if (!outcome?.terminal) return;
        setTracked(current => current?.deployment === outcome.deployment && current !== outcome ? outcome : current);
        const receipt = receiptsFor(s.owner).find(r => r.kind === 'rollback' && r.app === app.id && r.deployment === outcome.deployment);
        if (receipt && !receipt.settled) settleReceipt(receipt);
        if (!notified.current.has(outcome.deployment)) { notified.current.add(outcome.deployment); onChanged(); }
    }, [outcome?.deployment, outcome?.terminal, onChanged]);
    const succeeded = outcome?.terminal === true && outcome.success === true && outcome.status === 'live';
    const releases = (q.data?.releases.items ?? []) as Release[], eligible = releases.filter(r => rollbackEligible(r, q.data!.summary.current_release));
    return <div className="modal-pad admin-deployments"><h2 className="modal-title">{succeeded ? 'Rollback complete' : tracked ? 'Rollback progress' : `Roll back ${app.display_name || app.slug}`}</h2>{!tracked && <p className="modal-message">Choose a verified release to deploy. A failed rollout can leave mixed nodes.</p>}
        {!tracked && <>
            {q.isError && <ErrorNotice>Release observation unavailable. Refresh before choosing a target.</ErrorNotice>}
            <label>Verified release<select value={target} disabled={w.busy || q.isFetching} onChange={e => { setSelection(releases.find(r => r.id === Number(e.target.value))); setConfirmation(''); }}><option value={0}>Choose a version</option>{selected && !eligible.some(r => r.id === target) && <option value={target}>{selected.version} · selected</option>}{eligible.map(r => <option key={r.id} value={r.id}>{r.version} · {r.status}</option>)}</select></label>
            <div className="deployment-pagination" aria-label="Release history pagination"><span className="dim">{q.data ? `${q.data.releases.count ? start + 1 : 0}–${Math.min(start + releases.length, q.data.releases.count)} of ${q.data.releases.count} registered releases` : 'Loading releases…'}</span><div className="deployment-actions"><button className="btn" disabled={w.busy || q.isFetching || start === 0} onClick={() => setStart(value => Math.max(0, value - 25))}>Newer releases</button><button className="btn" disabled={w.busy || q.isFetching || !q.data || start + 25 >= q.data.releases.count} onClick={() => setStart(value => value + 25)}>Older releases</button><button className="btn" disabled={w.busy || q.isFetching} onClick={() => void q.refetch()}>Refresh releases</button></div></div>
            {q.data && !eligible.length && <p className="dim">No eligible rollback target on this page.</p>}
            {selected && <label>Type {app.slug}/{selected.version}<input value={confirmation} disabled={w.busy} onChange={e => setConfirmation(e.target.value)}/></label>}
        </>}
        {uncertain && <div className="deployment-confirm"><p>A previous rollback may have persisted. Observe it before another decision.</p><button className="btn" disabled={w.busy} onClick={() => void reconcile()}>Observe uncertain rollback</button>{reconciled && <><p>No unique matching attempt was observed in bounded history. A new rollback can overlap the earlier operation. Acknowledge this unknown outcome, then review and type the app/version again to consent to a new operation.</p><label>Type {app.slug}/unknown-outcome<input value={acknowledgement} disabled={w.busy} onChange={e => setAcknowledgement(e.target.value)}/></label><button className="btn" disabled={w.busy || acknowledgement !== `${app.slug}/unknown-outcome`} onClick={acknowledge}>Acknowledge unknown outcome</button></>}</div>}
        {w.error && <ErrorNotice>{w.error}</ErrorNotice>}
        {succeeded ? <div className="deployment-result" role="status"><strong>{outcome.version || selected?.version || 'Selected release'}</strong> <Status value="live"/><p>Deployment completed.</p></div> : tracked && <p role="status">Deployment {tracked.deployment}: <Status value={outcome?.status ?? 'unknown'}/></p>}
        {['error', 'stopped'].includes(observation.state) && <p className="text-warn">{succeeded ? 'Latest refresh unavailable. Showing the last observed result.' : 'Observation unavailable; outcome unconfirmed. Refresh only observes.'}</p>}
        {!succeeded && outcome?.detail && <p>{outcome.detail}</p>}
        <div className="modal-actions"><button className="btn" disabled={w.busy} onClick={onClose}>{tracked ? 'Close' : 'Cancel'}</button>{tracked ? <button className="btn" disabled={w.busy || observation.state === 'observing'} onClick={observation.refresh}>Refresh exact deployment</button> : <button className="btn btn-primary" disabled={w.busy || q.isFetching || q.isError || !q.data || !selected || !rollbackEligible(selected, q.data.summary.current_release) || confirmation !== `${app.slug}/${selected.version}`} onClick={() => void execute()}>Confirm rollback</button>}</div>
    </div>;
}
