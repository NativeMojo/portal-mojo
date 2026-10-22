import { useRef, useState } from 'react';
import { usingMockTransport, useMe } from '../../client/runtime';
import { completeUpload, getDeployment, resolveAppAuthority, getWebApp, registerUpload } from './api';
import { isInteractive } from './permissions';
import { buildManifest, manifestEqual, putReleaseFiles } from './upload';
import { makeReceipt, receiptsFor, saveReceipt, settleReceipt } from './receipts';
import { useDeploymentObservation, useDeploymentOwner } from './useDeploymentObservation';
import { ErrorNotice, Status, useWrite } from './shared';
import type { WebAppObject } from './types';
export function WebAppUploadPanel({ app, onClose, onBusy }: {
    app: WebAppObject;
    onClose?: () => void;
    onBusy?: (v: boolean) => void;
}) {
    const s = useDeploymentOwner(), me = useMe(), w = useWrite(s.owner, s.signal, onBusy), files = useRef<File[]>([]);
    const existing = receiptsFor(s.owner).find(r => r.kind === 'upload' && r.app === app.id && !r.settled);
    const [version, setVersion] = useState(existing?.target ?? ''), [fileCount, setFileCount] = useState(0), [progress, setProgress] = useState(''), [tracked, setTracked] = useState<{
        deployment: number;
        release: number;
    } | null>(existing?.deployment && existing.release ? { deployment: existing.deployment, release: existing.release } : null);
    const observe = useDeploymentObservation(s.owner, tracked ? String(tracked.deployment) : null, signal => getDeployment(s.owner, tracked!.deployment, app.id, tracked!.release, signal), d => d.terminal);
    const upload = () => w.run(async () => { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version))
        throw new Error('Use a version of 1–128 letters, numbers, dots, dashes or underscores'); const object = await getWebApp(s.owner, app.id, s.signal), authority = await resolveAppAuthority(s.owner, me.data, object, 'release', s.signal); if (!isInteractive() || object.group.id !== app.group.id || !authority.release)
        throw new Error('Exact app release authority unavailable'); setProgress('Hashing selected files…'); const manifest = await buildManifest(files.current, s.signal), receipt = makeReceipt(s.owner, 'upload', `${app.id}:${version}`, app.id, version); if (receipt.manifest && !manifestEqual(receipt.manifest, manifest))
        throw new Error('Reselect the identical normalized files and checksums for this pending version'); const frozen = saveReceipt({ ...receipt, manifest }); setProgress('Registering immutable release…'); const registration = await registerUpload(s.owner, frozen, app.id, app.group.id, version, manifest, s.signal); const registered = saveReceipt({ ...frozen, release: registration.release }); setProgress('Uploading checksum-bound files…'); const put = usingMockTransport() ? (await import('../../client/deployments-mock')).deploymentMockStorageFetch : fetch; await putReleaseFiles(files.current, manifest, registration.uploads, s.signal, n => setProgress(`${n}/${manifest.length} files uploaded`), put); setProgress('Verifying release and starting deployment…'); const result = await completeUpload(s.owner, registered, registration.release, app.id, app.group.id, s.signal); saveReceipt({ ...registered, deployment: result.deployment }); setTracked({ deployment: result.deployment, release: registration.release }); files.current = []; setFileCount(0); setProgress('Completion accepted; observing exact deployment.'); });
    if (observe.value?.terminal) {
        const r = receiptsFor(s.owner).find(r => r.kind === 'upload' && r.app === app.id && r.deployment === observe.value?.deployment);
        if (r && !r.settled)
            settleReceipt(r);
    }
    return <div>{onClose && <button className="btn" disabled={w.busy} onClick={onClose}>Close upload</button>}<label>Release version<input value={version} disabled={w.busy || !!tracked || !!existing} onChange={e => setVersion(e.target.value)}/></label><label>Built files<input type="file" multiple disabled={w.busy || !!tracked} onChange={e => { files.current = Array.from(e.target.files ?? []); setFileCount(files.current.length); }}/></label><label>Built folder<input type="file" multiple {...{ webkitdirectory: '', directory: '' }} disabled={w.busy || !!tracked} onChange={e => { files.current = Array.from(e.target.files ?? []).map(file => { const copy = new File([file], file.name, { type: file.type, lastModified: file.lastModified }); Object.defineProperty(copy, 'webkitRelativePath', { value: (file.webkitRelativePath || file.name).split('/').slice(1).join('/') || file.name }); return copy; }); setFileCount(files.current.length); }}/></label><p>{fileCount} selected. Defaults: 5000 files, 1 GiB maximum; this installation may refuse lower limits. Reselect and rehash identical files to resume a registered release after reload.</p>{existing && !tracked && <p>Pending version {existing.target}. Signed URLs were discarded; identical manifest registration remints them.</p>}{w.error && <ErrorNotice>{w.error}</ErrorNotice>}{progress && <p role="status">{progress}</p>}{tracked ? <><p>Deployment {tracked.deployment}: <Status value={observe.value?.status ?? 'unknown'}/> · {observe.state}{['error', 'stopped'].includes(observe.state) && ' · outcome unknown'}</p><button className="btn" onClick={observe.refresh}>Refresh exact deployment</button></> : <button className="btn btn-primary" disabled={w.busy || !fileCount || !version} onClick={() => void upload()}>Upload and deploy verified release</button>}</div>;
}
