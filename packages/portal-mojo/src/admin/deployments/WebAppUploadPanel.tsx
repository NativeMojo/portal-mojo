import { useRef, useState } from 'react';
import { usingMockTransport, useMe } from '../../client/runtime';
import { completeUpload, getDeployment, reconcileUploadCompletion, resolveAppAuthority, getWebApp, registerUpload } from './api';
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
    const s = useDeploymentOwner(), me = useMe(), w = useWrite(s.owner, s.signal, onBusy);
    const files = useRef<File[]>([]);
    const existing = receiptsFor(s.owner).find(r => r.kind === 'upload' && r.app === app.id && !r.settled);
    const [version, setVersion] = useState(existing?.target ?? '');
    const [fileCount, setFileCount] = useState(0), [progress, setProgress] = useState('');
    const [tracked, setTracked] = useState<{ deployment: number; release: number } | null>(
        existing?.deployment && existing.release ? { deployment: existing.deployment, release: existing.release } : null,
    );
    const [reconciliation, setReconciliation] = useState<Awaited<ReturnType<typeof reconcileUploadCompletion>> | null>(null);
    const [consent, setConsent] = useState('');
    const observe = useDeploymentObservation(s.owner, tracked ? String(tracked.deployment) : null,
        signal => getDeployment(s.owner, tracked!.deployment, app.id, tracked!.release, signal), d => d.terminal);
    const completionSubmitted = !!existing && ['completion_submitted', 'observing'].includes(existing.uploadPhase ?? '');

    const checkAuthority = async () => {
        const object = await getWebApp(s.owner, app.id, s.signal);
        const authority = await resolveAppAuthority(s.owner, me.data, object, 'release', s.signal);
        if (!isInteractive() || object.group.id !== app.group.id || !authority.release)
            throw new Error('Exact app release authority unavailable');
    };
    const upload = () => w.run(async () => {
        if (completionSubmitted) throw new Error('Completion was already submitted. Observe its deployment before a new decision.');
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version))
            throw new Error('Use a version of 1–128 letters, numbers, dots, dashes or underscores');
        await checkAuthority();
        setProgress('Hashing selected files…');
        const manifest = await buildManifest(files.current, s.signal);
        const receipt = makeReceipt(s.owner, 'upload', `${app.id}:${version}`, app.id, version);
        if (receipt.manifest && !manifestEqual(receipt.manifest, manifest))
            throw new Error('Reselect the identical normalized files and checksums for this pending version');
        const frozen = saveReceipt({ ...receipt, manifest });
        setProgress('Registering immutable release…');
        const registration = await registerUpload(s.owner, frozen, app.id, app.group.id, version, manifest, s.signal);
        const registered = saveReceipt({ ...frozen, release: registration.release, uploadPhase: 'registered' });
        setProgress('Uploading checksum-bound files…');
        const put = usingMockTransport() ? (await import('../../client/deployments-mock')).deploymentMockStorageFetch : fetch;
        await putReleaseFiles(files.current, manifest, registration.uploads, s.signal,
            n => setProgress(`${n}/${manifest.length} files uploaded`), put);
        setProgress('Verifying release and starting deployment…');
        const result = await completeUpload(s.owner, registered, registration.release, app.id, app.group.id, s.signal);
        setTracked({ deployment: result.deployment, release: registration.release });
        files.current = []; setFileCount(0);
        setProgress('Completion accepted; observing exact deployment.');
    });
    const reconcile = () => w.run(async () => {
        const receipt = existing ?? receiptsFor(s.owner).find(r => r.kind === 'upload' && r.app === app.id && r.target === version);
        if (!receipt) throw new Error('No submitted completion receipt is available');
        const result = await reconcileUploadCompletion(s.owner, receipt, s.signal);
        setReconciliation(result); setConsent('');
        if (result.status) setTracked({ deployment: result.status.deployment, release: result.status.release });
        setProgress(result.status ? 'Matching exact deployment observed.' : 'No unique matching attempt was established. Completion outcome remains unknown.');
    });
    const renewConsent = () => w.run(async () => {
        if (!reconciliation || consent !== `${app.slug}/${version}`) return;
        await checkAuthority();
        const fresh = await reconcileUploadCompletion(s.owner, reconciliation.receipt, s.signal);
        if (fresh.signature !== reconciliation.signature || (fresh.status && !fresh.status.terminal)) {
            setReconciliation(fresh); setConsent('');
            if (fresh.status) setTracked({ deployment: fresh.status.deployment, release: fresh.status.release });
            throw new Error('Deployment evidence changed or is active. Review it before another deployment decision.');
        }
        saveReceipt({ ...fresh.receipt, operation: crypto.randomUUID(), uploadPhase: 'registered',
            completionSubmittedAt: undefined, completionBaseline: undefined, deployment: undefined,
            submitted: false, submittedAt: undefined, settled: false });
        setTracked(null); setReconciliation(null); setConsent('');
        files.current = []; setFileCount(0);
        setProgress('New deployment consent recorded. Reselect the identical artifact and deliberately upload/deploy again.');
    });
    if (observe.value?.terminal) {
        const receipt = receiptsFor(s.owner).find(r => r.kind === 'upload' && r.app === app.id && r.deployment === observe.value?.deployment);
        if (receipt && !receipt.settled) settleReceipt(receipt);
    }
    const lockedFiles = w.busy || !!tracked || completionSubmitted;
    const mayRenew = !!reconciliation && (!reconciliation.status ||
        (reconciliation.status.terminal && !reconciliation.status.success));
    return <div>
        {onClose && <button className="btn" disabled={w.busy} onClick={onClose}>Close upload</button>}
        <label>Release version<input value={version} disabled={w.busy || !!tracked || !!existing} onChange={e => setVersion(e.target.value)} /></label>
        <label>Built files<input type="file" multiple disabled={lockedFiles} onChange={e => { files.current = Array.from(e.target.files ?? []); setFileCount(files.current.length); }} /></label>
        <label>Built folder<input type="file" multiple {...{ webkitdirectory: '', directory: '' }} disabled={lockedFiles} onChange={e => {
            files.current = Array.from(e.target.files ?? []).map(file => {
                const copy = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
                Object.defineProperty(copy, 'webkitRelativePath', { value: (file.webkitRelativePath || file.name).split('/').slice(1).join('/') || file.name });
                return copy;
            }); setFileCount(files.current.length);
        }} /></label>
        <p>{fileCount} selected. Defaults: 5000 files, 1 GiB maximum; this installation may refuse lower limits. Reselect and rehash identical files to resume an upload that has not submitted completion.</p>
        {existing && !tracked && !completionSubmitted && <p>Pending version {existing.target}. Signed URLs were discarded; identical manifest registration remints them.</p>}
        {completionSubmitted && !tracked && <p role="status">Completion may already have started a deployment. Re-registering or sending completion again can start another rollout. Reconcile the recorded release first.</p>}
        {w.error && <ErrorNotice>{w.error}</ErrorNotice>}
        {progress && <p role="status">{progress}</p>}
        {tracked ? <><p>Deployment {tracked.deployment}: <Status value={observe.value?.status ?? reconciliation?.status?.status ?? 'unknown'} /> · {observe.state}{['error', 'stopped'].includes(observe.state) && ' · outcome unknown'}</p><button className="btn" disabled={w.busy} onClick={observe.refresh}>Refresh exact deployment</button></> :
            !completionSubmitted && <button className="btn btn-primary" disabled={w.busy || !fileCount || !version} onClick={() => void upload()}>Upload and deploy verified release</button>}
        {(completionSubmitted || tracked) && <button className="btn" disabled={w.busy} onClick={() => void reconcile()}>Reconcile submitted completion</button>}
        {mayRenew && <div className="deployment-confirm"><p>The prior completion may have run. Starting again is a new deployment decision and can overlap an unobserved attempt. This does not erase or retry the earlier operation.</p>
            <label>New deployment consent: type {app.slug}/{version}<input value={consent} disabled={w.busy} onChange={e => setConsent(e.target.value)} /></label>
            <button className="btn" disabled={w.busy || consent !== `${app.slug}/${version}`} onClick={() => void renewConsent()}>Consent to a new deployment attempt</button>
        </div>}
    </div>;
}
