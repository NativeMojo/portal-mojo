import { useRef, useState } from 'react';
import {
    FileDropZone, FilePicker, UploadQueue, toast, useUploadQueue, type FileSelectionResult,
} from '@portal-mojo/ui';
import type { FileUploadOutcome, FileUploadSnapshot, FileUploadTask } from '@portal-mojo/client';

let demoFileId = 7000;

/** Showcase-only transport fixture. Production queues use startFileUpload. */
function demoUploadTask(file: File): FileUploadTask {
    const listeners = new Set<(snapshot: FileUploadSnapshot) => void>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let generation = 1;
    let snapshot: FileUploadSnapshot = {
        phase: 'initiating', generation, fileId: ++demoFileId,
        loadedBytes: 0, totalBytes: file.size || 100, outcome: null,
    };
    let settle: ((outcome: FileUploadOutcome) => void) | null = null;
    let result = new Promise<FileUploadOutcome>((resolve) => { settle = resolve; });
    const publish = (patch: Partial<FileUploadSnapshot>) => {
        snapshot = { ...snapshot, ...patch };
        listeners.forEach((listener) => listener({ ...snapshot }));
    };
    const completed = (): FileUploadOutcome => ({
        status: 'completed',
        file: {
            id: snapshot.fileId!, filename: file.name, contentType: file.type || 'application/octet-stream',
            size: file.size, category: null, fileManagerId: 42, groupId: 1,
        },
    });
    const run = (mode: 'initial' | 'retry' | 'recover') => {
        generation += mode === 'initial' ? 0 : 1;
        publish({ phase: mode === 'recover' ? 'reconciling' : 'initiating', generation, loadedBytes: 0, outcome: null });
        let step = 0;
        const tick = () => {
            step += 1;
            if (mode === 'initial' && file.name.includes('failure')) {
                const outcome: FileUploadOutcome = {
                    status: 'failed', fileId: snapshot.fileId,
                    failure: { stage: 'transfer', code: 'request_failed', message: 'The upload request failed.', retryable: true },
                };
                publish({ phase: 'failed', outcome });
                settle?.(outcome);
                return;
            }
            if (mode === 'initial' && file.name.includes('recovery')) {
                const outcome: FileUploadOutcome = {
                    status: 'uncertain', fileId: snapshot.fileId,
                    failure: { stage: 'reconcile', code: 'remote_state_unknown', message: 'The server could not confirm the upload state.', retryable: true },
                };
                publish({ phase: 'uncertain', outcome });
                settle?.(outcome);
                return;
            }
            if (mode === 'recover' || step >= 5) {
                const outcome = completed();
                publish({ phase: 'completed', loadedBytes: file.size || 100, outcome });
                settle?.(outcome);
                return;
            }
            const total = file.size || 100;
            publish({ phase: 'uploading', loadedBytes: Math.round((total * step) / 5), totalBytes: total });
            timer = setTimeout(tick, file.name.includes('cancellable') ? 650 : 180);
        };
        timer = setTimeout(tick, 220);
    };
    const restart = (mode: 'retry' | 'recover') => {
        if (timer) clearTimeout(timer);
        result = new Promise<FileUploadOutcome>((resolve) => { settle = resolve; });
        run(mode);
        return result;
    };
    run('initial');
    return {
        get result() { return result; },
        getSnapshot: () => ({ ...snapshot }),
        subscribe(listener) { listeners.add(listener); listener({ ...snapshot }); return () => listeners.delete(listener); },
        cancel() {
            if (timer) clearTimeout(timer);
            const outcome: FileUploadOutcome = {
                status: 'uncertain', fileId: snapshot.fileId,
                failure: { stage: 'transfer', code: 'cancelled_after_initiate', message: 'Cancellation was requested after the server created the upload.', retryable: true },
            };
            publish({ phase: 'uncertain', outcome });
            settle?.(outcome);
        },
        retry: () => restart('retry'),
        recover: () => restart('recover'),
    };
}

function fixture(name: string, size = 240_000): File {
    return new File([new Uint8Array(size)], name, { type: name.endsWith('.pdf') ? 'application/pdf' : 'text/plain', lastModified: Date.now() });
}

export function FileUploadDemo() {
    const callbackFailures = useRef(new Set<string>());
    const [selectionMessage, setSelectionMessage] = useState('Drop real local files above; this Showcase uses an in-memory transport fixture.');
    const queue = useUploadQueue({
        consumerKey: 'showcase-file-upload', destination: { use: 'showcase', groupId: 1 }, startTask: demoUploadTask,
        onComplete: async (file) => {
            if (file.filename.includes('followup') && !callbackFailures.current.has(file.filename)) {
                callbackFailures.current.add(file.filename);
                throw new Error('Showcase follow-up failure');
            }
        },
    });
    const selected = (result: FileSelectionResult) => {
        if (result.accepted.length) {
            const queued = queue.add(result.accepted);
            setSelectionMessage(`${queued.acceptedIds.length} file${queued.acceptedIds.length === 1 ? '' : 's'} queued.`);
            queued.rejected.forEach((rejection) => toast.warning(rejection.message));
        }
        result.rejected.forEach((rejection) => toast.warning(rejection.message));
    };
    const add = (...files: File[]) => queue.add(files);
    return (
        <div className="demo-stack">
            <section className="panel panel-pad">
                <div className="eyebrow">Picker and drop zone</div>
                <p className="dim">Accessible controls · pure client validation</p>
                <FileDropZone accept={['text/plain', '.pdf']} maxFileSize={2_000_000} maxFiles={4} onSelection={selected} />
                <div className="demo-actions">
                    <FilePicker accept={['text/plain', '.pdf']} maxFileSize={2_000_000} maxFiles={4} onSelection={selected}>Browse files</FilePicker>
                    <span className="dim">{selectionMessage}</span>
                </div>
            </section>
            <section className="panel panel-pad">
                <div className="eyebrow">Truthful queue states</div>
                <p className="dim">Concurrency 3 · capacity 6</p>
                <div className="demo-actions">
                    <button type="button" className="btn" onClick={() => add(fixture('success.txt'))}>Success</button>
                    <button type="button" className="btn" onClick={() => add(fixture('failure.txt'))}>Failure → retry</button>
                    <button type="button" className="btn" onClick={() => add(fixture('cancellable.txt', 900_000))}>Cancellable</button>
                    <button type="button" className="btn" onClick={() => add(fixture('recovery.txt'))}>Uncertain → recover</button>
                    <button type="button" className="btn" onClick={() => add(fixture('partial-ok.pdf'), fixture('partial-followup.txt'))}>Partial follow-up</button>
                </div>
                <UploadQueue queue={queue} empty={<p className="dim">Choose a scenario to populate the queue.</p>} />
            </section>
        </div>
    );
}
