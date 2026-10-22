import { useEffect, useState } from 'react';
import { modal } from '../../ui/modal';
import { assertOwner } from './permissions';
import { Tabs } from '../../ui/Tabs';
import { downloadBlob, useMe } from '../../client/runtime';
import { getWorkflow, resolveAppAuthority, getWebApp } from './api';
import { isInteractive } from './permissions';
import { useDeploymentOwner } from './useDeploymentObservation';
import { ErrorNotice, useWrite } from './shared';
import type { WebAppObject } from './types';
export function WebAppDeploySetup({ app, workflowAllowed, releaseAllowed, keyAllowed, onKey }: {
    app: WebAppObject;
    workflowAllowed: boolean;
    releaseAllowed: boolean;
    keyAllowed: boolean;
    onKey: (action: 'mint' | 'rotate' | 'revoke') => void;
}) {
    const s = useDeploymentOwner(), me = useMe(), w = useWrite(s.owner, s.signal);
    const [workflow, setWorkflow] = useState<{
        filename: string;
        yaml: string;
    } | null>(null), [message, setMessage] = useState('');
    useEffect(() => () => { setWorkflow(null); }, [s.key]);
    const generate = () => w.run(async () => { const object = await getWebApp(s.owner, app.id, s.signal), authority = await resolveAppAuthority(s.owner, me.data, object, 'workflow', s.signal); if (!isInteractive() || !authority.workflow)
        throw new Error('Workflow authority unavailable'); setWorkflow(await getWorkflow(s.owner, app.id, object.group.id, s.signal)); });
    const loadUpload = async () => { const { WebAppUploadPanel } = await import('./WebAppUploadPanel'); assertOwner(s.owner, s.signal); let busy = false; await modal.open(close => <div className="modal-pad admin-deployments"><h2 className="modal-title">Upload built files · {app.display_name || app.slug}</h2><WebAppUploadPanel app={app} onClose={() => close(null)} onBusy={value => { busy = value; }}/></div>, {
        signal: s.signal, canDismiss: () => !busy, size: 'lg'
    }); };
    return <Tabs items={[{
            key: 'github', label: 'GitHub (recommended)', panel: <div><p>Save the generated workflow in your repository, then create one repository Actions secret named <code>MOJO_DEPLOY_KEY</code>. The browser does not install either in GitHub.</p><button className="btn" disabled={!workflowAllowed || w.busy} onClick={() => void generate()}>Generate GitHub workflow</button>{workflow && <><pre className="deployment-code">{workflow.yaml}</pre><button className="btn" onClick={() => void navigator.clipboard.writeText(workflow.yaml).then(() => setMessage('Workflow copied')).catch(() => setMessage('Clipboard unavailable; download the workflow'))}>Copy workflow</button><button className="btn" onClick={() => downloadBlob(new Blob([workflow.yaml], { type: 'text/yaml' }), 'deploy-webapp.yml')}>Download workflow</button><p>Place at {workflow.filename}</p></>}{keyAllowed && <div className="deployment-toolbar"><button className="btn" onClick={() => onKey('mint')}>Create deployment key…</button><button className="btn" onClick={() => onKey('rotate')}>Rotate key…</button><button className="btn" onClick={() => onKey('revoke')}>Revoke key…</button></div>}{message && <p role="status">{message}</p>}{w.error && <ErrorNotice>{w.error}</ErrorNotice>}</div>
        }, {
            key: 'upload', label: 'Upload built files', panel: <div><p>Upload the build output, not source files. Storage must allow this Admin origin to PUT checksum-bound objects.</p>{<button className="btn" disabled={!releaseAllowed} onClick={() => void loadUpload()}>Choose built artifact</button>}</div>
        }, {
            key: 'other-ci', label: 'Other CI / API', panel: <div><p>Use this app's linked deployment key in CI. Register <code>POST /api/edge/release</code> with webapp {app.id}, a unique version and a SHA-256/size manifest. PUT each file anonymously to its signed URL with the exact checksum header. Call <code>POST /api/edge/release/complete</code> with the returned release ID, then read <code>/api/edge/release/deployment/ID</code> until terminal. Only status live is success.</p><p>Do not send API bearer credentials or cookies to storage. Registration and completion are not rollout proof.</p></div>
        }]}/>;
}
