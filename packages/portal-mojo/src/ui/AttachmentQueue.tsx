import { useEffect, useMemo, useRef } from 'react';
import type { StartFileUploadOptions, UploadedFileRef } from '../client/upload';
import type { FileReference } from '../client/record-feed';
import { FileDropZone, type FileSelectionResult } from './FileDrop';
import { UploadQueue, useUploadQueue } from './UploadQueue';
import { toast } from './toast';

export interface AttachmentQueueState {
    files: readonly FileReference[];
    busy: boolean;
}

export interface AttachmentQueueProps {
    consumerKey: string;
    capacity: number;
    destination: StartFileUploadOptions;
    expectedGroupId: number | null;
    disabled?: boolean;
    resetKey?: number;
    onChange(state: AttachmentQueueState): void;
}

function completedReference(file: UploadedFileRef, expectedGroupId: number | null): FileReference {
    if (!Number.isSafeInteger(file.id) || file.id <= 0
        || !Number.isSafeInteger(file.fileManagerId) || Number(file.fileManagerId) <= 0
        || file.groupId !== expectedGroupId
        || typeof file.filename !== 'string' || !file.filename
        || typeof file.contentType !== 'string' || !file.contentType
        || (file.category !== null && typeof file.category !== 'string')) {
        throw new Error('The completed upload did not match this attachment destination.');
    }
    return {
        id: file.id,
        filename: file.filename,
        content_type: file.contentType,
        category: file.category,
    };
}

/**
 * Shared reference-only attachment queue. Browser File values and transfer
 * capabilities remain inside UploadQueue; consumers receive only completed,
 * capability-free metadata rebuilt from the authoritative lifecycle response.
 */
export function AttachmentQueue({
    consumerKey, capacity, destination, expectedGroupId, disabled = false,
    resetKey = 0, onChange,
}: AttachmentQueueProps) {
    const queue = useUploadQueue({
        concurrency: Math.min(3, capacity), capacity, consumerKey, destination,
        onComplete: (file) => { completedReference(file, expectedGroupId); },
    });
    const busy = queue.snapshot.activeCount > 0 || queue.snapshot.queuedCount > 0;
    const files = useMemo(() => queue.snapshot.items.flatMap((item) => {
        if (item.status !== 'completed' || !item.file) return [];
        try { return [completedReference(item.file, expectedGroupId)]; } catch { return []; }
    }), [expectedGroupId, queue.snapshot.items]);

    const latestChange = useRef(onChange);
    latestChange.current = onChange;
    const fileSignature = files.map((file) => `${file.id}:${file.filename}:${file.content_type}:${file.category ?? ''}`).join('|');
    useEffect(() => { latestChange.current({ files, busy }); }, [busy, fileSignature]);
    useEffect(() => {
        for (const item of queue.snapshot.items) {
            if (item.canCancel) queue.cancel(item.id);
            queue.remove(item.id);
        }
    }, [queue, resetKey]);
    useEffect(() => { if (disabled) queue.cancelAll(); }, [disabled, queue]);

    const select = (selection: FileSelectionResult) => {
        selection.rejected.forEach((item) => toast.warning(item.message));
        const result = queue.add(selection.accepted);
        result.rejected.forEach((item) => toast.warning(item.message));
    };

    return (
        <div className="attachment-queue">
            <FileDropZone
                className="attachment-drop"
                label={capacity === 1 ? 'Attach a file or drop it here' : 'Attach files or drop them here'}
                multiple={capacity > 1}
                maxFiles={Math.max(1, capacity - queue.snapshot.items.length)}
                disabled={disabled || queue.snapshot.items.length >= capacity}
                onSelection={select}
            >
                <span><i className="bi bi-paperclip" aria-hidden="true" /> Attach {capacity === 1 ? 'file' : 'files'}</span>
            </FileDropZone>
            <UploadQueue queue={queue} />
        </div>
    );
}
