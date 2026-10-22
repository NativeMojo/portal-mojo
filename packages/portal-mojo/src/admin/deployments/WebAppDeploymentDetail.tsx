import { useEffect, useRef } from 'react';
import { useMe } from '../../client/runtime';
import { Tabs } from '../../ui/Tabs';
import { datetime } from '../../ui/format';
import { getAttempt, getDeployment, resolveAppAuthority } from './api';
import { assertOwner, canReadWebApps, isInteractive } from './permissions';
import { useDeploymentObservation, useDeploymentOwner } from './useDeploymentObservation';
import { DeploymentHelp, ErrorNotice, Facts, Status, useCloseOnOwnerChange } from './shared';
import type { Attempt, DeploymentStatus, WebAppObject } from './types';

const terminal = (status: string) => ['live', 'failed', 'rolled_back', 'superseded'].includes(status);
const active = (status: string) => ['requested', 'queued', 'deploying', 'canary', 'fleet', 'verifying'].includes(status);
interface Evidence { attempt: Attempt; rollout: DeploymentStatus | null }

/** Ordinary CI attempts are inspectable through viewer-safe model history. */
export function WebAppDeploymentDetail({ app, attempt, detailedAllowed, onClose, onChanged }: {
    app: WebAppObject;
    attempt: Attempt;
    detailedAllowed: boolean;
    onClose: () => void;
    onChanged: () => void;
}) {
    const s = useDeploymentOwner(), me = useMe(), notified = useRef('');
    const admitted = canReadWebApps(me.data) && isInteractive();
    useCloseOnOwnerChange(s.key, onClose);
    const observation = useDeploymentObservation<Evidence>(s.owner, admitted ? `${app.id}:${attempt.id}:${detailedAllowed}` : null, async signal => {
        const current = await getAttempt(s.owner, attempt.id, app.id, signal);
        let rollout: DeploymentStatus | null = null;
        if (detailedAllowed && current.release) {
            const authority = await resolveAppAuthority(s.owner, me.data, app, 'release', signal);
            if (authority.release) rollout = await getDeployment(s.owner, current.id, app.id, current.release.id, signal);
        }
        assertOwner(s.owner, signal);
        return { attempt: current, rollout };
    }, evidence => terminal(evidence.attempt.status), evidence => active(evidence.attempt.status));
    const current = observation.value?.attempt ?? attempt, rollout = observation.value?.rollout;
    useEffect(() => {
        if (observation.state !== 'terminal' || !observation.value) return;
        const key = `${s.key}:${observation.value.attempt.id}:${observation.value.attempt.status}`;
        if (notified.current !== key) { notified.current = key; onChanged(); }
    }, [observation.state, observation.value, s.key, onChanged]);
    if (!admitted) return <div className="modal-pad admin-deployments"><ErrorNotice>Deployment read authority is unavailable.</ErrorNotice><button className="btn" onClick={onClose}>Close</button></div>;
    const overview = <div>
        <Facts rows={[["Attempted version", current.release?.version || 'Not reported'], ["Outcome", <Status value={current.status}/>], ["Started", current.started || current.created ? datetime(current.started || current.created) : 'Not reported'], ["Finished", current.finished ? datetime(current.finished) : 'Not reported']]}/>
        {current.detail && <p>{current.detail}</p>}
        <p className="dim"><DeploymentHelp label="deployment outcome">Only live is a successful rollout. Rolled back, failed and superseded attempts are unsuccessful. The app's desired version is a separate saved pointer, and nodes can be mixed after a failed rollout.</DeploymentHelp> {observation.observedAt ? `Observed ${new Date(observation.observedAt).toLocaleTimeString()}` : 'Refreshing saved evidence…'}</p>
        {observation.state === 'observing' && <p role="status">Observing deployment progress…</p>}
        {observation.state === 'error' && <ErrorNotice>Latest observation unavailable. The displayed evidence may be stale; the outcome is unconfirmed.</ErrorNotice>}
        {observation.state === 'stopped' && <p role="status" className="text-warn">Automatic observation stopped. Refresh only reads this deployment.</p>}
    </div>;
    const nodePanel = rollout && (rollout.targets.length > 0 || rollout.rollback_targets.length > 0) ? <div>{[['Deployment nodes', rollout.targets], ['Rollback nodes', rollout.rollback_targets]].map(([title, nodes]) => {
        const entries = nodes as DeploymentStatus['targets'];
        return <section key={String(title)}><h3>{String(title)}</h3>{entries.length ? entries.map((node, index) => <div className="deployment-evidence" key={`${node.runner}:${index}`}><strong>{node.runner || 'Unnamed node'}</strong><p><Status value={node.status}/></p>{node.detail && <p>{node.detail}</p>}{node.sha && <p className="mono">{node.sha}</p>}</div>) : <p className="dim">No node evidence was returned.</p>}</section>;
    })}</div> : null;
    return <div className="modal-pad admin-deployments deployment-dialog"><header className="deployment-dialog-header"><div className="deployment-dialog-heading"><h2 className="modal-title">Deployment {current.release?.version || `#${current.id}`}</h2><p className="dim">{app.display_name || app.slug}</p></div><button className="btn" aria-label="Close deployment" onClick={onClose}><i className="bi bi-x-lg" aria-hidden="true"/></button></header>
        {nodePanel ? <Tabs ariaLabel="Deployment evidence" items={[{ key: 'overview', label: 'Overview', panel: overview }, { key: 'nodes', label: 'Nodes', panel: nodePanel }]}/> : overview}
        <div className="modal-actions"><button className="btn" onClick={onClose}>Close</button><button className="btn" disabled={observation.state === 'observing'} onClick={observation.refresh}>Refresh deployment</button></div>
    </div>;
}
