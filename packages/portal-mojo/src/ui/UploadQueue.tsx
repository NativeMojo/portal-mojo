import {
    useCallback, useEffect, useId, useRef, useSyncExternalStore,
    type ReactNode,
} from 'react';
import {
    sanitizeUploadBasename, startFileUpload,
    type FileUploadFailure, type FileUploadSnapshot, type FileUploadTask,
    type StartFileUploadOptions, type UploadedFileRef,
} from '../client/upload';
import { getAuthSnapshot, subscribeAuth } from '../client/auth';
import { filesize } from './format';
import { toast, type ProgressToastHandle } from './toast';

export type UploadQueueItemStatus = 'queued' | 'initiating' | 'uploading' | 'reconciling'
    | 'completing' | 'cancelling' | 'finalizing' | 'completed' | 'completed-warning'
    | 'failed' | 'cancelled' | 'uncertain';

export interface UploadQueueFailure {
    stage: FileUploadFailure['stage'] | 'callback';
    code: FileUploadFailure['code'] | 'callback_failed';
    message: string;
    retryable: boolean;
}

export interface UploadQueueItem {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    status: UploadQueueItemStatus;
    loadedBytes: number;
    totalBytes: number | null;
    percent: number | null;
    file: UploadedFileRef | null;
    failure: UploadQueueFailure | null;
    canCancel: boolean;
    canRetry: boolean;
    canRecover: boolean;
    canRemove: boolean;
}

export interface UploadQueueSnapshot {
    items: readonly UploadQueueItem[];
    activeCount: number;
    queuedCount: number;
    completedCount: number;
    warningCount: number;
    failedCount: number;
    loadedBytes: number;
    totalBytes: number | null;
    percent: number | null;
}

export interface UploadQueueCompletionContext {
    queueItemId: string;
    signal: AbortSignal;
}

export type UploadQueueCompletion = (
    file: UploadedFileRef,
    context: UploadQueueCompletionContext,
) => void | Promise<void>;

export interface UploadQueueEnqueueOptions {
    /** A stable consumer identity, used with destination and file metadata for dedupe. */
    consumerKey: string;
    destination?: StartFileUploadOptions;
    onComplete?: UploadQueueCompletion;
}

export interface UploadQueueRejection {
    filename: string;
    code: 'capacity' | 'duplicate';
    message: string;
}

export interface UploadQueueEnqueueResult {
    acceptedIds: string[];
    rejected: UploadQueueRejection[];
}

export interface UploadQueueStore {
    getSnapshot(): UploadQueueSnapshot;
    subscribe(listener: () => void): () => void;
    enqueue(files: Iterable<File>, options: UploadQueueEnqueueOptions): UploadQueueEnqueueResult;
    cancel(id: string): void;
    retry(id: string): void;
    recover(id: string): void;
    remove(id: string): void;
    cancelAll(): void;
    retryAll(): void;
    clearSettled(): void;
    mount(): () => void;
    dispose(): void;
}

export interface UploadQueueOptions {
    concurrency?: number;
    capacity?: number;
    /** Deterministic test/demo seam. Production callers should omit this. */
    startTask?: (file: File, options: StartFileUploadOptions) => FileUploadTask;
}

interface PrivateEntry {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    dedupeKey: string;
    destination: StartFileUploadOptions;
    callbackController: AbortController | null;
    unsubscribeTask: (() => void) | null;
    status: UploadQueueItemStatus;
    loadedBytes: number;
    totalBytes: number | null;
    fileRef: UploadedFileRef | null;
    failure: UploadQueueFailure | null;
    attempt: number;
    lastToastLoaded: number;
    lastToastPercent: number;
    cancelRequested: boolean;
    removeWhenSettled: boolean;
}

type PendingOperation = { id: string; mode: 'start' | 'retry' | 'recover' };

const EMPTY_SNAPSHOT: UploadQueueSnapshot = Object.freeze({
    items: Object.freeze([]), activeCount: 0, queuedCount: 0, completedCount: 0,
    warningCount: 0, failedCount: 0, loadedBytes: 0, totalBytes: null, percent: null,
});

const ACTIVE = new Set<UploadQueueItemStatus>([
    'initiating', 'uploading', 'reconciling', 'completing', 'cancelling', 'finalizing',
]);
const SETTLED = new Set<UploadQueueItemStatus>([
    'completed', 'completed-warning', 'failed', 'cancelled', 'uncertain',
]);

const cleanInt = (value: number | undefined): number | undefined =>
    Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;

function normalizeDestination(value: StartFileUploadOptions = {}): StartFileUploadOptions {
    const use = value.use?.trim();
    return {
        ...(cleanInt(value.fileManagerId) == null ? {} : { fileManagerId: cleanInt(value.fileManagerId) }),
        ...(cleanInt(value.groupId) == null ? {} : { groupId: cleanInt(value.groupId) }),
        ...(use ? { use } : {}),
    };
}

function destinationKey(value: StartFileUploadOptions): string {
    return `${value.fileManagerId ?? ''}|${value.groupId ?? ''}|${value.use ?? ''}`;
}

function safeFailure(value: FileUploadFailure): UploadQueueFailure {
    return { stage: value.stage, code: value.code, message: value.message, retryable: value.retryable };
}

function displayedPercent(loaded: number, total: number | null): number | null {
    if (total == null || total <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
}

function itemSnapshot(entry: PrivateEntry, task: FileUploadTask | undefined): UploadQueueItem {
    const retryCallback = entry.status === 'completed-warning';
    return Object.freeze({
        id: entry.id,
        filename: entry.filename,
        contentType: entry.contentType,
        size: entry.size,
        status: entry.status,
        loadedBytes: entry.loadedBytes,
        totalBytes: entry.totalBytes,
        percent: displayedPercent(entry.loadedBytes, entry.totalBytes),
        file: entry.fileRef ? Object.freeze({ ...entry.fileRef }) : null,
        failure: entry.failure ? Object.freeze({ ...entry.failure }) : null,
        canCancel: entry.status === 'queued' || (ACTIVE.has(entry.status) && entry.status !== 'cancelling' && entry.status !== 'finalizing'),
        canRetry: retryCallback || ((entry.status === 'failed' || entry.status === 'uncertain') && Boolean(entry.failure?.retryable)),
        canRecover: entry.status === 'uncertain' && task?.getSnapshot().fileId != null,
        canRemove: entry.status === 'queued' || SETTLED.has(entry.status),
    });
}

function buildSnapshot(entries: readonly PrivateEntry[], tasks: ReadonlyMap<string, FileUploadTask>): UploadQueueSnapshot {
    const items = Object.freeze(entries.map((entry) => itemSnapshot(entry, tasks.get(entry.id))));
    const aggregate = entries.filter((entry) => entry.status !== 'cancelled');
    const known = aggregate.filter((entry) => entry.totalBytes != null && entry.totalBytes! > 0);
    const loadedBytes = known.reduce((sum, entry) => sum + Math.min(entry.loadedBytes, entry.totalBytes!), 0);
    const totalBytes = known.length ? known.reduce((sum, entry) => sum + entry.totalBytes!, 0) : null;
    return Object.freeze({
        items,
        activeCount: entries.filter((entry) => ACTIVE.has(entry.status)).length,
        queuedCount: entries.filter((entry) => entry.status === 'queued').length,
        completedCount: entries.filter((entry) => entry.status === 'completed' || entry.status === 'completed-warning').length,
        warningCount: entries.filter((entry) => entry.status === 'completed-warning' || entry.status === 'uncertain').length,
        failedCount: entries.filter((entry) => entry.status === 'failed').length,
        loadedBytes,
        totalBytes,
        percent: displayedPercent(loadedBytes, totalBytes),
    });
}

export function createUploadQueue(options: UploadQueueOptions = {}): UploadQueueStore {
    const capacity = Math.max(1, Math.min(100, Math.trunc(options.capacity ?? 6) || 6));
    const concurrency = Math.max(1, Math.min(capacity, 12, Math.trunc(options.concurrency ?? 3) || 3));
    const startTask = options.startTask ?? startFileUpload;
    const entries: PrivateEntry[] = [];
    // Browser-native/capability-bearing values stay in private maps. Public
    // snapshots are rebuilt solely from the inert fields above.
    const fileValues = new Map<string, File>();
    const tasks = new Map<string, FileUploadTask>();
    const callbacks = new Map<string, UploadQueueCompletion>();
    const progressToasts = new Map<string, ProgressToastHandle>();
    const listeners = new Set<() => void>();
    const pending: PendingOperation[] = [];
    let snapshot = EMPTY_SNAPSHOT;
    let activeTasks = 0;
    let nextId = 1;
    let disposed = false;
    let mountCount = 0;
    let disposeGeneration = 0;
    let authUid: string | null = null;
    let unsubscribeAuth: (() => void) | null = null;

    const publish = () => {
        if (disposed) return;
        snapshot = buildSnapshot(entries, tasks);
        for (const listener of listeners) listener();
    };
    const find = (id: string) => entries.find((entry) => entry.id === id);
    const removeEntry = (entry: PrivateEntry) => {
        entry.unsubscribeTask?.();
        entry.unsubscribeTask = null;
        entry.callbackController?.abort();
        entry.callbackController = null;
        progressToasts.get(entry.id)?.remove();
        fileValues.delete(entry.id);
        tasks.delete(entry.id);
        callbacks.delete(entry.id);
        progressToasts.delete(entry.id);
        const index = entries.indexOf(entry);
        if (index >= 0) entries.splice(index, 1);
        for (let i = pending.length - 1; i >= 0; i--) if (pending[i]!.id === entry.id) pending.splice(i, 1);
    };
    const ensureAuthGuard = () => {
        if (unsubscribeAuth || disposed) return;
        const auth = getAuthSnapshot();
        authUid = auth.authenticated ? auth.uid : null;
        if (authUid == null) return;
        unsubscribeAuth = subscribeAuth(() => {
            const next = getAuthSnapshot();
            if (!next.authenticated || next.uid !== authUid) store.dispose();
        });
    };
    const finishToast = (entry: PrivateEntry, kind: 'done' | 'fail', message: string) => {
        const handle = progressToasts.get(entry.id);
        progressToasts.delete(entry.id);
        handle?.[kind](message);
    };
    const beginCallback = async (entry: PrivateEntry, attempt: number, useTransferToast: boolean) => {
        if (!entry.fileRef) return;
        entry.status = 'finalizing';
        entry.failure = null;
        entry.callbackController?.abort();
        const controller = new AbortController();
        entry.callbackController = controller;
        if (useTransferToast) progressToasts.get(entry.id)?.finalizing(`Finishing ${entry.filename}`);
        publish();
        try {
            await callbacks.get(entry.id)?.(entry.fileRef, { queueItemId: entry.id, signal: controller.signal });
            if (disposed || entry.attempt !== attempt || controller.signal.aborted) return;
            entry.status = 'completed';
            fileValues.delete(entry.id);
            callbacks.delete(entry.id);
            if (useTransferToast) finishToast(entry, 'done', `${entry.filename} uploaded`);
            else toast.success(`${entry.filename} follow-up completed`);
        } catch {
            if (disposed || entry.attempt !== attempt || controller.signal.aborted) return;
            entry.status = 'completed-warning';
            entry.failure = {
                stage: 'callback', code: 'callback_failed', retryable: true,
                message: 'The file uploaded, but the follow-up action failed.',
            };
            fileValues.delete(entry.id);
            if (useTransferToast) finishToast(entry, 'fail', `${entry.filename} uploaded; follow-up failed`);
            else toast.warning(`${entry.filename} is uploaded, but its follow-up still needs attention`);
        } finally {
            if (entry.callbackController === controller) entry.callbackController = null;
            if (!disposed && entry.attempt === attempt) {
                if (entry.removeWhenSettled) removeEntry(entry);
                publish();
            }
        }
    };
    const settleTask = async (entry: PrivateEntry, attempt: number, result: ReturnType<FileUploadTask['retry']>) => {
        try {
            const outcome = await result;
            if (disposed || entry.attempt !== attempt) return;
            activeTasks = Math.max(0, activeTasks - 1);
            if (outcome.status === 'completed') {
                entry.fileRef = { ...outcome.file };
                entry.totalBytes = entry.totalBytes ?? entry.size;
                entry.loadedBytes = entry.totalBytes;
                schedule();
                await beginCallback(entry, attempt, true);
            } else {
                entry.status = outcome.status;
                entry.failure = safeFailure(outcome.failure);
                finishToast(entry, 'fail', outcome.status === 'uncertain'
                    ? `${entry.filename}: server state needs review`
                    : `${entry.filename} failed`);
                if (entry.removeWhenSettled) removeEntry(entry);
                publish();
            }
        } catch {
            if (disposed || entry.attempt !== attempt) return;
            activeTasks = Math.max(0, activeTasks - 1);
            entry.status = 'uncertain';
            entry.failure = { stage: 'reconcile', code: 'remote_state_unknown', retryable: true, message: 'The server could not confirm the upload state.' };
            finishToast(entry, 'fail', `${entry.filename}: server state needs review`);
            publish();
        } finally {
            if (!disposed) schedule();
        }
    };
    const observeTask = (entry: PrivateEntry, attempt: number, state: FileUploadSnapshot) => {
        if (disposed || entry.attempt !== attempt || entry.cancelRequested) return;
        // The result promise is the settlement authority. Ignoring terminal
        // subscription echoes avoids a removable/retryable one-microtask gap
        // before slot accounting and completion callbacks have run.
        if (state.outcome) return;
        entry.status = state.phase;
        entry.loadedBytes = Math.max(0, state.loadedBytes);
        entry.totalBytes = state.totalBytes && state.totalBytes > 0 ? state.totalBytes : null;
        const pct = displayedPercent(entry.loadedBytes, entry.totalBytes);
        if (state.phase === 'uploading' && pct != null && entry.loadedBytes !== entry.lastToastLoaded && pct !== entry.lastToastPercent) {
            entry.lastToastLoaded = entry.loadedBytes;
            entry.lastToastPercent = pct;
            progressToasts.get(entry.id)?.update(pct);
        }
        publish();
    };
    const run = (entry: PrivateEntry, mode: PendingOperation['mode']) => {
        const fileValue = fileValues.get(entry.id);
        if (!fileValue && mode === 'start') return;
        entry.attempt += 1;
        const attempt = entry.attempt;
        entry.cancelRequested = false;
        entry.failure = null;
        entry.loadedBytes = 0;
        entry.totalBytes = null;
        entry.lastToastLoaded = -1;
        entry.lastToastPercent = -1;
        activeTasks += 1;
        progressToasts.set(entry.id, toast.progress(`Uploading ${entry.filename}`, { onCancel: () => store.cancel(entry.id) }));
        let result: Promise<import('../client/upload').FileUploadOutcome>;
        if (mode === 'start') {
            const task = startTask(fileValue!, entry.destination);
            tasks.set(entry.id, task);
            entry.unsubscribeTask = task.subscribe((state) => observeTask(entry, attempt, state));
            result = task.result;
        } else {
            const task = tasks.get(entry.id)!;
            entry.unsubscribeTask?.();
            entry.unsubscribeTask = task.subscribe((state) => observeTask(entry, attempt, state));
            result = mode === 'recover' ? task.recover() : task.retry();
        }
        publish();
        void settleTask(entry, attempt, result);
    };
    function schedule() {
        if (disposed) return;
        while (activeTasks < concurrency && pending.length) {
            const operation = pending.shift()!;
            const entry = find(operation.id);
            if (!entry || entry.status !== 'queued') continue;
            run(entry, operation.mode);
        }
        publish();
    }
    const queueOperation = (entry: PrivateEntry, mode: PendingOperation['mode']) => {
        entry.status = 'queued';
        pending.push({ id: entry.id, mode });
        schedule();
    };

    const store: UploadQueueStore = {
        getSnapshot: () => snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        enqueue(files, enqueueOptions) {
            if (disposed) return { acceptedIds: [], rejected: Array.from(files, (file) => ({ filename: file.name, code: 'capacity' as const, message: 'This upload queue is no longer available.' })) };
            ensureAuthGuard();
            const acceptedIds: string[] = [];
            const rejected: UploadQueueRejection[] = [];
            const destination = normalizeDestination(enqueueOptions.destination);
            for (const file of files) {
                const filename = sanitizeUploadBasename(file.name);
                const dedupeKey = `${enqueueOptions.consumerKey}|${destinationKey(destination)}|${filename}|${file.size}|${file.type}|${file.lastModified}`;
                if (entries.some((entry) => entry.dedupeKey === dedupeKey)) {
                    rejected.push({ filename, code: 'duplicate', message: `${filename} is already in this destination's queue.` });
                    continue;
                }
                if (entries.length >= capacity) {
                    rejected.push({ filename, code: 'capacity', message: `The upload queue can hold ${capacity} files.` });
                    continue;
                }
                const id = `upload-${nextId++}`;
                const entry: PrivateEntry = {
                    id, filename, contentType: file.type || 'application/octet-stream', size: file.size,
                    dedupeKey, destination, callbackController: null,
                    unsubscribeTask: null, status: 'queued', loadedBytes: 0,
                    totalBytes: null, fileRef: null, failure: null, attempt: 0, lastToastLoaded: -1,
                    lastToastPercent: -1, cancelRequested: false, removeWhenSettled: false,
                };
                entries.push(entry);
                fileValues.set(id, file);
                if (enqueueOptions.onComplete) callbacks.set(id, enqueueOptions.onComplete);
                pending.push({ id, mode: 'start' });
                acceptedIds.push(id);
            }
            schedule();
            return { acceptedIds, rejected };
        },
        cancel(id) {
            const entry = find(id);
            if (!entry) return;
            if (entry.status === 'queued') {
                for (let i = pending.length - 1; i >= 0; i--) if (pending[i]!.id === id) pending.splice(i, 1);
                entry.status = 'cancelled';
                fileValues.delete(entry.id);
                publish();
                return;
            }
            if (!ACTIVE.has(entry.status) || entry.status === 'finalizing' || entry.status === 'cancelling') return;
            entry.cancelRequested = true;
            entry.status = 'cancelling';
            progressToasts.get(entry.id)?.finalizing(`Cancelling ${entry.filename}`);
            tasks.get(entry.id)?.cancel();
            publish();
        },
        retry(id) {
            const entry = find(id);
            if (!entry) return;
            if (entry.status === 'completed-warning' && callbacks.has(entry.id) && entry.fileRef) {
                entry.attempt += 1;
                void beginCallback(entry, entry.attempt, false);
                return;
            }
            if ((entry.status === 'failed' || entry.status === 'uncertain') && entry.failure?.retryable && tasks.has(entry.id)) queueOperation(entry, 'retry');
        },
        recover(id) {
            const entry = find(id);
            if (entry?.status === 'uncertain' && tasks.get(entry.id)?.getSnapshot().fileId != null) queueOperation(entry, 'recover');
        },
        remove(id) {
            const entry = find(id);
            if (!entry) return;
            if (ACTIVE.has(entry.status)) {
                entry.removeWhenSettled = true;
                store.cancel(id);
                return;
            }
            removeEntry(entry);
            publish();
        },
        cancelAll() { for (const entry of [...entries]) store.cancel(entry.id); },
        retryAll() { for (const entry of [...entries]) if (entry.status === 'failed' || entry.status === 'uncertain' || entry.status === 'completed-warning') store.retry(entry.id); },
        clearSettled() {
            for (const entry of [...entries]) if (SETTLED.has(entry.status)) removeEntry(entry);
            publish();
        },
        mount() {
            if (disposed) return () => {};
            mountCount += 1;
            disposeGeneration += 1;
            let released = false;
            return () => {
                if (released) return;
                released = true;
                mountCount = Math.max(0, mountCount - 1);
                const generation = ++disposeGeneration;
                queueMicrotask(() => { if (mountCount === 0 && disposeGeneration === generation) store.dispose(); });
            };
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            unsubscribeAuth?.();
            unsubscribeAuth = null;
            for (const entry of entries) {
                entry.attempt += 1;
                entry.callbackController?.abort();
                tasks.get(entry.id)?.cancel();
                entry.unsubscribeTask?.();
                progressToasts.get(entry.id)?.remove();
            }
            fileValues.clear();
            tasks.clear();
            callbacks.clear();
            progressToasts.clear();
            entries.length = 0;
            pending.length = 0;
            activeTasks = 0;
            snapshot = EMPTY_SNAPSHOT;
            for (const listener of listeners) listener();
            listeners.clear();
        },
    };
    return store;
}

export interface UseUploadQueueOptions extends UploadQueueOptions {
    consumerKey?: string;
    destination?: StartFileUploadOptions;
    onComplete?: UploadQueueCompletion;
}

export interface UploadQueueController extends UploadQueueStore {
    snapshot: UploadQueueSnapshot;
    add(files: Iterable<File>): UploadQueueEnqueueResult;
}

export function useUploadQueue(options: UseUploadQueueOptions = {}): UploadQueueController {
    const generatedKey = `upload-consumer-${useId().replace(/:/g, '')}`;
    const current = useRef(options);
    current.current = options;
    const queue = useRef<UploadQueueStore | null>(null);
    if (!queue.current) queue.current = createUploadQueue(options);
    useEffect(() => queue.current!.mount(), []);
    const snapshot = useSyncExternalStore(queue.current.subscribe, queue.current.getSnapshot, queue.current.getSnapshot);
    const add = useCallback((files: Iterable<File>) => queue.current!.enqueue(files, {
        consumerKey: current.current.consumerKey ?? generatedKey,
        destination: current.current.destination,
        onComplete: current.current.onComplete,
    }), [generatedKey]);
    return Object.assign(queue.current, { snapshot, add });
}

export interface UploadQueueProps {
    queue: Pick<UploadQueueController, 'snapshot' | 'cancel' | 'retry' | 'recover' | 'remove' | 'cancelAll' | 'retryAll' | 'clearSettled'>;
    className?: string;
    empty?: ReactNode;
}

function statusLabel(item: UploadQueueItem): string {
    const labels: Record<UploadQueueItemStatus, string> = {
        queued: 'Queued', initiating: 'Starting', uploading: 'Uploading', reconciling: 'Checking',
        completing: 'Completing', cancelling: 'Cancellation requested', finalizing: 'Finalizing',
        completed: 'Completed', 'completed-warning': 'Uploaded · follow-up failed', failed: 'Failed',
        cancelled: 'Cancelled', uncertain: 'Needs recovery',
    };
    return labels[item.status];
}

export function UploadQueue({ queue, className, empty = null }: UploadQueueProps) {
    const { snapshot } = queue;
    if (!snapshot.items.length) return <>{empty}</>;
    return (
        <section className={`upload-queue${className ? ` ${className}` : ''}`} aria-label="Upload queue">
            <header className="upload-queue-head">
                <div>
                    <strong>{snapshot.activeCount ? `${snapshot.activeCount} uploading` : `${snapshot.completedCount} completed`}</strong>
                    <span>{snapshot.queuedCount ? ` · ${snapshot.queuedCount} queued` : ''}{snapshot.failedCount ? ` · ${snapshot.failedCount} failed` : ''}</span>
                </div>
                <div className="upload-queue-actions">
                    {snapshot.items.some((item) => item.canCancel) && <button type="button" className="btn btn-compact" onClick={queue.cancelAll}>Cancel all</button>}
                    {snapshot.items.some((item) => item.canRetry) && <button type="button" className="btn btn-compact" onClick={queue.retryAll}>Retry available</button>}
                    {snapshot.items.some((item) => item.canRemove) && <button type="button" className="btn btn-compact" onClick={queue.clearSettled}>Clear settled</button>}
                </div>
            </header>
            {snapshot.totalBytes != null && (
                <div className="upload-aggregate" role="progressbar" aria-label="Overall upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={snapshot.percent ?? 0}>
                    <span style={{ width: `${snapshot.percent ?? 0}%` }} />
                </div>
            )}
            <ul className="upload-list">
                {snapshot.items.map((item) => (
                    <li key={item.id} className={`upload-item is-${item.status}`}>
                        <i className="bi bi-file-earmark upload-file-icon" aria-hidden="true" />
                        <div className="upload-item-main">
                            <div className="upload-item-title"><strong title={item.filename}>{item.filename}</strong><span>{filesize(item.size)}</span></div>
                            <div className="upload-item-status">
                                <span>{statusLabel(item)}{item.percent != null && item.status === 'uploading' ? ` · ${item.percent}%` : ''}</span>
                                {item.failure && <span className="upload-item-message">{item.failure.message}</span>}
                            </div>
                            {item.totalBytes != null && ACTIVE.has(item.status) && (
                                <div className="upload-item-progress" role="progressbar" aria-label={`${item.filename} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.percent ?? 0}>
                                    <span style={{ width: `${item.percent ?? 0}%` }} />
                                </div>
                            )}
                        </div>
                        <div className="upload-item-actions">
                            {item.canCancel && <button type="button" className="btn-icon" aria-label={`Cancel ${item.filename}`} title="Cancel" onClick={() => queue.cancel(item.id)}><i className="bi bi-x-lg" /></button>}
                            {item.canRecover && <button type="button" className="btn btn-compact" onClick={() => queue.recover(item.id)}>Recover</button>}
                            {item.canRetry && <button type="button" className="btn btn-compact" onClick={() => queue.retry(item.id)}>{item.status === 'completed-warning' ? 'Retry follow-up' : 'Retry'}</button>}
                            {item.canRemove && <button type="button" className="btn-icon" aria-label={`Remove ${item.filename}`} title="Remove" onClick={() => queue.remove(item.id)}><i className="bi bi-trash3" /></button>}
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
}
