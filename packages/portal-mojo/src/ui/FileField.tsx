import { useCallback, useEffect, useRef, useState } from 'react';
import type { FieldValue } from '../client/types';
import { mojoCall } from '../client/client';
import type { StartFileUploadOptions, UploadedFileRef } from '../client/upload';
import { FileDropZone, type FileSelectionResult } from './FileDrop';
import { useUploadQueue } from './UploadQueue';
import { fileRelationId } from './field-wire';
import { toast } from './toast';

export type FileFieldState = 'keep' | 'clear' | 'replacement-in-progress' | 'replacement-failed'
    | 'completed-awaiting-attach' | 'attach-failed';

export interface FileFieldOwnerResult {
    generation: number;
    status: 'success' | 'failed';
    /** Exact relation value sent by this owner-save attempt. */
    requestedValue: unknown;
    /** Raw relation value from the authoritative owner response. */
    authoritativeValue?: unknown;
}

export interface FileFieldProps {
    value: FieldValue;
    onChange: (value: number | null) => void;
    image?: boolean;
    accept?: string | string[];
    maxFileSize?: number;
    destination?: StartFileUploadOptions;
    disabled?: boolean;
    invalid?: boolean;
    controlId?: string;
    ariaDescribedBy?: string;
    onPendingChange?: (pending: boolean) => void;
    ownerResult?: FileFieldOwnerResult;
    onOrphan?: (fileId: number) => void;
}

export function reconcileFileOwnerResult(expected: number | null, result: FileFieldOwnerResult, lastGeneration: number): 'ignore' | 'attached' | 'failed' {
    if (result.generation <= lastGeneration) return 'ignore';
    const requested = fileRelationId(result.requestedValue);
    const requestedMatches = expected == null ? result.requestedValue === null : requested === expected;
    if (!requestedMatches) return 'ignore';
    if (result.status === 'failed') return 'failed';
    const authoritative = fileRelationId(result.authoritativeValue);
    const authoritativeMatches = expected == null ? result.authoritativeValue === null : authoritative === expected;
    return authoritativeMatches ? 'attached' : 'failed';
}

interface PreviewRow { url?: unknown; thumbnail?: unknown; filename?: unknown }

function safePreviewUrl(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim() !== value || !value || value.startsWith('//')) return null;
    if (value.startsWith('/')) return /[\r\n\\]/.test(value) ? null : value;
    try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
            ? value : null;
    } catch { return null; }
}

/**
 * Controlled django-mojo File relation editor. Browser File values, object
 * URLs, upload tasks, and stored preview capabilities stay component-local.
 */
export function FileField(props: FileFieldProps) {
    const {
        image = false, disabled = false, invalid = false, destination,
        onPendingChange, ownerResult, onOrphan,
    } = props;
    const initialId = fileRelationId(props.value);
    const storedId = useRef<number | null>(initialId);
    const desired = useRef<number | null | undefined>(undefined);
    const candidate = useRef<number | null>(null);
    const candidateFilename = useRef<string | null>(null);
    const generation = useRef(0);
    const ownerGeneration = useRef(0);
    const orphaned = useRef(new Set<number>());
    const mounted = useRef(true);
    const localUrl = useRef<string | null>(null);
    const latestOrphan = useRef(onOrphan);
    latestOrphan.current = onOrphan;
    const [preview, setPreview] = useState<string | null>(null);
    const [filename, setFilename] = useState<string | null>(null);
    const [state, setState] = useState<FileFieldState>('keep');
    const queue = useUploadQueue({ concurrency: 1, capacity: 1 });

    const revokeLocal = useCallback(() => {
        if (localUrl.current) URL.revokeObjectURL(localUrl.current);
        localUrl.current = null;
    }, []);
    const reportOrphan = useCallback((id: number | null) => {
        if (id == null || orphaned.current.has(id)) return;
        orphaned.current.add(id);
        latestOrphan.current?.(id);
    }, []);
    const clearQueue = useCallback(() => {
        for (const item of queue.snapshot.items) {
            if (item.canCancel) queue.cancel(item.id);
            queue.remove(item.id);
        }
    }, [queue]);

    useEffect(() => () => {
        mounted.current = false;
        generation.current += 1;
        revokeLocal();
        if (desired.current !== undefined && candidate.current != null) reportOrphan(candidate.current);
        queue.cancelAll();
    }, [queue, reportOrphan, revokeLocal]);

    const active = queue.snapshot.activeCount > 0 || queue.snapshot.queuedCount > 0;
    useEffect(() => {
        if (disabled && active) queue.cancelAll();
    }, [active, disabled, queue]);

    useEffect(() => {
        onPendingChange?.(active);
        return () => onPendingChange?.(false);
    }, [active, onPendingChange]);

    // Stored capabilities are fetched only while mounted, never returned to a
    // caller or written through Query. Failures intentionally reveal nothing.
    useEffect(() => {
        if (!image || storedId.current == null || localUrl.current) {
            if (storedId.current == null && !localUrl.current) setPreview(null);
            return;
        }
        const controller = new AbortController();
        let live = true;
        void mojoCall(`/api/fileman/file/${storedId.current}`, { signal: controller.signal }).then((envelope) => {
            const row = envelope.data as PreviewRow;
            if (!live || controller.signal.aborted || localUrl.current) return;
            setPreview(safePreviewUrl(row.thumbnail) ?? safePreviewUrl(row.url));
            setFilename(typeof row.filename === 'string' ? row.filename : null);
        }, () => { /* capability and failure remain local and silent */ });
        return () => { live = false; controller.abort(); };
    }, [image, initialId, state]);

    useEffect(() => {
        if (!ownerResult || desired.current === undefined) return;
        const outcome = reconcileFileOwnerResult(desired.current, ownerResult, ownerGeneration.current);
        if (outcome === 'ignore') return;
        ownerGeneration.current = ownerResult.generation;
        const expected = desired.current;
        if (outcome === 'failed') {
            setState('attach-failed');
            return;
        }
        storedId.current = expected;
        desired.current = undefined;
        candidate.current = null;
        candidateFilename.current = null;
        setFilename(null);
        revokeLocal();
        setPreview(null);
        setState('keep');
        queue.clearSettled();
    }, [ownerResult, queue, revokeLocal]);

    // A genuinely external authoritative row change can refresh the stored
    // baseline, but a local draft never replaces it while attachment awaits.
    useEffect(() => {
        if (desired.current !== undefined) return;
        storedId.current = initialId;
    }, [initialId]);

    useEffect(() => {
        const item = queue.snapshot.items[0];
        if (!item) {
            if (state === 'replacement-in-progress') setState('replacement-failed');
            return;
        }
        if (active) {
            if (state === 'replacement-failed') setState('replacement-in-progress');
            return;
        }
        if (item.status === 'failed' || item.status === 'uncertain' || item.status === 'cancelled') {
            setState('replacement-failed');
        }
    }, [active, queue.snapshot.items, state]);

    const select = (selection: FileSelectionResult) => {
        selection.rejected.forEach((item) => toast.warning(item.message));
        const file = selection.accepted[0];
        if (!file) return;
        generation.current += 1;
        const acceptedGeneration = generation.current;
        reportOrphan(candidate.current);
        candidate.current = null;
        desired.current = undefined;
        clearQueue();
        revokeLocal();
        localUrl.current = URL.createObjectURL(file);
        setPreview(image ? localUrl.current : null);
        setFilename(file.name);
        setState('replacement-in-progress');
        const result = queue.enqueue([file], {
            consumerKey: `form-file:${props.controlId ?? 'field'}`,
            destination,
            onComplete: async (uploaded: UploadedFileRef) => {
                if (!mounted.current || generation.current !== acceptedGeneration) return;
                const id = fileRelationId(uploaded.id);
                if (id == null) throw new Error('Upload completion did not include an authoritative File id');
                candidate.current = id;
                candidateFilename.current = uploaded.filename;
                desired.current = id;
                setState('completed-awaiting-attach');
                props.onChange(id);
            },
        });
        result.rejected.forEach((item) => toast.warning(item.message));
        if (!result.acceptedIds.length) setState('replacement-failed');
    };

    const clear = () => {
        generation.current += 1;
        reportOrphan(candidate.current);
        candidate.current = null;
        desired.current = null;
        clearQueue();
        revokeLocal();
        setState('clear');
        props.onChange(null);
    };
    const removeCandidate = () => {
        generation.current += 1;
        reportOrphan(candidate.current);
        candidate.current = null;
        desired.current = undefined;
        clearQueue();
        revokeLocal();
        setFilename(null);
        setPreview(null);
        setState('keep');
        props.onChange(storedId.current);
    };
    const retryAttach = () => {
        if (desired.current === undefined) return;
        setState(desired.current == null ? 'clear' : 'completed-awaiting-attach');
        props.onChange(desired.current);
    };

    const item = queue.snapshot.items[0];
    const hasStored = storedId.current != null;
    const statusText = state === 'keep' ? (hasStored ? 'Keep current file' : 'No file selected')
        : state === 'clear' ? 'Clear on save'
            : state === 'replacement-in-progress' ? (item?.percent == null ? 'Uploading…' : `Uploading… ${item.percent}%`)
                : state === 'replacement-failed' ? (item?.failure?.message ?? 'Upload failed')
                    : state === 'completed-awaiting-attach' ? 'Uploaded · awaiting save'
                        : 'Uploaded · attachment failed';

    return (
        <div id={props.controlId} className={`file-field${image ? ' image-field' : ''}${invalid ? ' is-invalid' : ''}`} aria-describedby={props.ariaDescribedBy}>
            {image && <div className="file-field-preview">{preview ? <img src={preview} alt="Selected preview" referrerPolicy="no-referrer" /> : <i className="bi bi-image" aria-hidden="true" />}</div>}
            <div className="file-field-main">
                <strong>{filename ?? candidateFilename.current ?? (hasStored ? `File #${storedId.current}` : 'No file')}</strong>
                <span className={`file-field-status is-${state}`}>{statusText}</span>
                {item?.canRetry && <button type="button" className="btn btn-compact" disabled={disabled} onClick={() => queue.retry(item.id)}>Retry upload</button>}
                {state === 'attach-failed' && <button type="button" className="btn btn-compact" disabled={disabled} onClick={retryAttach}>Retry attachment</button>}
            </div>
            <div className="file-field-actions">
                <FileDropZone className="file-field-drop" label={hasStored || candidate.current ? 'Choose replacement file or drop it here' : 'Choose a file or drop it here'} multiple={false} accept={image ? props.accept ?? 'image/*' : props.accept} maxFileSize={props.maxFileSize} disabled={disabled || active} onSelection={select}>
                    <span><i className="bi bi-cloud-arrow-up" /> {hasStored || candidate.current ? 'Replace' : 'Choose file'}</span>
                </FileDropZone>
                {(hasStored || desired.current !== undefined) && <button type="button" className="btn btn-compact" disabled={disabled || active} onClick={desired.current !== undefined ? removeCandidate : clear}>{desired.current !== undefined ? 'Remove' : 'Clear'}</button>}
                {item?.canCancel && <button type="button" className="btn btn-compact" disabled={disabled} onClick={() => queue.cancel(item.id)}>Cancel</button>}
            </div>
        </div>
    );
}

export function ImageField(props: Omit<FileFieldProps, 'image'>) {
    return <FileField {...props} image />;
}
