import { useEffect, useState } from 'react';
import { modal } from '../../ui/modal';
import { assertOwner } from './permissions';
import { Tabs } from '../../ui/Tabs';
import { downloadBlob, useMe } from '../../client/runtime';
import { getWorkflow, getKeyStatus, resolveAppAuthority, getWebApp } from './api';
import { isInteractive } from './permissions';
import { useDeploymentOwner } from './useDeploymentObservation';
import { ErrorNotice, useWrite } from './shared';
import type { WebAppObject } from './types';
export function WebAppDeploySetup({ app, workflowAllowed, releaseAllowed, keyAllowed, deploymentKey, onKey, onChanged }: {
    app: WebAppObject;
    workflowAllowed: boolean;
    releaseAllowed: boolean;
    keyAllowed: boolean;
    deploymentKey?: { linked: boolean; active: boolean };
    onKey: (action: 'mint' | 'rotate' | 'revoke') => void;
    onChanged?: () => void;
}) {
    const s = useDeploymentOwner(), me = useMe(), w = useWrite(s.owner, s.signal);
    const [key, setKey] = useState(deploymentKey), [keyError, setKeyError] = useState('');
    useEffect(() => { setKey(deploymentKey); setKeyError(''); }, [deploymentKey?.linked, deploymentKey?.active, s.key]);
    const refreshKey = () => w.run(async () => { const next = await getKeyStatus(s.owner, app.id, app.group.id, s.signal); setKey(next); setKeyError(''); });
    useEffect(() => { if (!keyAllowed || deploymentKey) return; let disposed = false; void getKeyStatus(s.owner, app.id, app.group.id, s.signal).then(next => { if (!disposed) setKey(next); }).catch(() => { if (!disposed && !s.signal.aborted) setKeyError('Key status unavailable. Refresh before choosing a key action.'); }); return () => { disposed = true; }; }, [s.key, s.signal, keyAllowed, app.id, app.group.id, !!deploymentKey]);
    const generate = () => w.run(async () => {
        const object = await getWebApp(s.owner, app.id, s.signal), authority = await resolveAppAuthority(s.owner, me.data, object, 'workflow', s.signal);
        if (!isInteractive() || !authority.workflow) throw new Error('Workflow authority unavailable');
        const workflow = await getWorkflow(s.owner, app.id, object.group.id, s.signal);
        assertOwner(s.owner, s.signal);
        void modal.open(close => <WorkflowDialog workflow={workflow} onClose={() => close(null)}/>, { signal: s.signal, size: 'lg' });
    });
    const loadUpload = async () => { const { WebAppUploadPanel } = await import('./WebAppUploadPanel'); assertOwner(s.owner, s.signal); let busy = false; await modal.open(close => <div className="modal-pad admin-deployments"><h2 className="modal-title">Upload built files · {app.display_name || app.slug}</h2><WebAppUploadPanel app={app} onChanged={onChanged} onClose={() => close(null)} onBusy={value => { busy = value; }}/></div>, { signal: s.signal, canDismiss: () => !busy, size: 'lg' }); };
    const showIntegration = () => { void modal.open(close => <div className="modal-pad admin-deployments"><h2 className="modal-title">Other CI integration</h2><ol className="deployment-instructions"><li>Store this app’s deployment key in your CI secret store.</li><li>Register <code>POST /api/edge/release</code> with webapp <code>{app.id}</code>, a unique version and a SHA-256/size manifest.</li><li>PUT each file to its returned signed URL using the exact checksum header. Send no API bearer credentials or cookies to storage.</li><li>Call <code>POST /api/edge/release/complete</code> with the release ID, then read <code>/api/edge/release/deployment/ID</code> until terminal.</li></ol><p>Only <code>live</code> is a successful rollout. Registration and completion alone are not proof.</p><div className="modal-actions"><button className="btn" onClick={() => close(null)}>Close</button></div></div>, { signal: s.signal, size: 'md' }); };
    const keyControls = <section className="deployment-key-setup"><h3>Deployment key</h3><p className="dim">{key ? key.active ? 'Active key linked. Its value cannot be retrieved.' : key.linked ? 'The linked key is inactive. Rotate it to reconnect CI.' : 'Create a key for this app, then save it as a CI secret.' : 'Key status not observed.'}</p>{keyAllowed && <div className="deployment-actions">{key && (!key.linked ? <button className="btn" disabled={w.busy} onClick={() => onKey('mint')}>Create deployment key…</button> : <><button className="btn" disabled={w.busy} onClick={() => onKey('rotate')}>Rotate key…</button>{key.active && <button className="btn" disabled={w.busy} onClick={() => onKey('revoke')}>Revoke key…</button>}</>)}<button className="btn" disabled={w.busy} onClick={() => void refreshKey()}>Refresh key status</button></div>}{keyError && <ErrorNotice>{keyError}</ErrorNotice>}</section>;
    return <div className="deployment-setup"><Tabs ariaLabel="Deployment method" items={[
        { key: 'github', label: 'GitHub', panel: <div className="deployment-stack"><p>Deploy automatically when you push to your repository.</p><ol className="deployment-instructions"><li>Save the generated workflow in your repository.</li><li>Save the deployment key as the Actions secret <code>MOJO_DEPLOY_KEY</code>.</li></ol><div><button className="btn btn-primary" disabled={!workflowAllowed || w.busy} onClick={() => void generate()}>View GitHub workflow</button></div>{keyControls}</div> },
        { key: 'upload', label: 'Upload', panel: <div className="deployment-stack"><p>Deploy an already built site from a folder or selected files.</p><div><button className="btn btn-primary" disabled={!releaseAllowed} onClick={() => void loadUpload()}>Choose built artifact</button></div></div> },
        { key: 'other-ci', label: 'Other CI', panel: <div className="deployment-stack"><p>Connect another CI service using this app’s deployment key and release API.</p><div><button className="btn" onClick={showIntegration}>View integration steps</button></div>{keyControls}</div> },
    ]}/>{w.error && <ErrorNotice>{w.error}</ErrorNotice>}</div>;
}
function WorkflowDialog({ workflow, onClose }: { workflow: { filename: string; yaml: string }; onClose: () => void }) {
    const [message, setMessage] = useState('');
    return <div className="modal-pad admin-deployments"><h2 className="modal-title">GitHub workflow</h2><p>Save this file at <code>{workflow.filename}</code>.</p><pre className="deployment-code">{workflow.yaml}</pre>{message && <p role="status">{message}</p>}<div className="modal-actions"><button className="btn" onClick={onClose}>Close</button><button className="btn" onClick={() => void navigator.clipboard.writeText(workflow.yaml).then(() => setMessage('Workflow copied')).catch(() => setMessage('Clipboard unavailable; download the workflow'))}>Copy workflow</button><button className="btn btn-primary" onClick={() => downloadBlob(new Blob([workflow.yaml], { type: 'text/yaml' }), 'deploy-webapp.yml')}>Download workflow</button></div></div>;
}
