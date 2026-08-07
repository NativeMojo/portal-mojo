import {
    useCallback, useEffect, useMemo, useRef, useState,
    type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    CollectionSelect, FilePicker, UploadQueue, fmt, modal, toast,
    useFileDrop, useUploadQueue, validateFileSelection,
    type FileSelectionResult,
} from '../../ui';
import type { StartFileUploadOptions, UploadedFileRef } from '../../client/upload';
import {
    FileManagerUploadPolicyModel, FileModel,
    type FileManagerUploadPolicyRow, type RelationRow,
} from './models';

const MANAGER_LIMIT = 50;
const QUEUE_CAPACITY = 6;

function policyAccept(policy: FileManagerUploadPolicyRow | null): string[] {
    if (!policy) return [];
    return [
        ...policy.allowed_mime_types,
        ...policy.allowed_extensions.map((extension) => `.${extension.replace(/^\./, '').toLowerCase()}`),
    ];
}

function policySummary(policy: FileManagerUploadPolicyRow): ReactNode {
    const types = [...policy.allowed_extensions.map((value) => `.${value.replace(/^\./, '')}`), ...policy.allowed_mime_types];
    return (
        <dl className="storage-upload-policy">
            <div><dt>Maximum size</dt><dd>{policy.max_file_size > 0 ? fmt.filesize(policy.max_file_size) : 'No configured limit'}</dd></div>
            <div><dt>Accepted types</dt><dd>{types.length ? types.join(', ') : 'Any type'}</dd></div>
            <div><dt>Transfer route</dt><dd>{policy.supports_direct_upload ? 'Direct provider target' : 'Local API upload target'}</dd></div>
        </dl>
    );
}

interface DestinationDialogProps {
    initialFiles: File[];
    canChooseGroup: boolean;
    remaining: number;
    close: () => void;
    enqueue: (files: File[], destination: StartFileUploadOptions) => boolean;
}

function DestinationDialog({ initialFiles, canChooseGroup, remaining, close, enqueue }: DestinationDialogProps) {
    const [scope, setScope] = useState<'system' | 'group'>('system');
    const [groupId, setGroupId] = useState<number | null>(null);
    const [managerId, setManagerId] = useState<number | null>(null);
    const [files, setFiles] = useState<File[]>(initialFiles);
    const [rejections, setRejections] = useState<string[]>([]);
    const groupScope = scope === 'group';
    const params = groupScope
        ? { group: groupId ?? undefined, user__isnull: true, size: MANAGER_LIMIT }
        : { group__isnull: true, user__isnull: true, size: MANAGER_LIMIT };
    const managersQuery = FileManagerUploadPolicyModel.useList(params, {
        enabled: !groupScope || groupId != null,
    });
    const managers = managersQuery.data?.rows ?? [];
    const truncated = Number(managersQuery.data?.count ?? 0) > managers.length;
    const policy = managers.find((row) => row.id === managerId) ?? null;
    const accept = policyAccept(policy);

    useEffect(() => { setManagerId(null); }, [scope, groupId]);

    const validate = useCallback((selected: Iterable<File>): FileSelectionResult => validateFileSelection(selected, {
        accept,
        maxFileSize: policy && policy.max_file_size > 0 ? policy.max_file_size : undefined,
        maxFiles: Math.max(1, remaining),
    }), [accept, policy, remaining]);

    const selectFiles = (selection: FileSelectionResult) => {
        setFiles(selection.accepted);
        setRejections(selection.rejected.map((item) => item.message));
    };
    const submit = () => {
        if (!policy) return;
        const selection = validate(files);
        setRejections(selection.rejected.map((item) => item.message));
        if (!selection.accepted.length) return;
        const accepted = enqueue(selection.accepted, {
            fileManagerId: policy.id,
            ...(groupScope && groupId != null ? { groupId } : {}),
            ...(policy.use ? { use: policy.use } : {}),
        });
        if (accepted) close();
    };

    return (
        <div className="modal-pad storage-upload-dialog">
            <h2 className="modal-title">Add files</h2>
            <p className="modal-message">Choose an explicit authorized destination. Policy checks here are guidance; the server authorizes every upload.</p>
            {canChooseGroup && (
                <div className="seg storage-upload-scope" aria-label="Destination scope">
                    <button type="button" className={`seg-btn${scope === 'system' ? ' seg-active' : ''}`} onClick={() => setScope('system')}>System</button>
                    <button type="button" className={`seg-btn${scope === 'group' ? ' seg-active' : ''}`} onClick={() => setScope('group')}>Group</button>
                </div>
            )}
            {groupScope && canChooseGroup && (
                <CollectionSelect<RelationRow>
                    endpoint="/api/group" value={groupId}
                    onChange={(id) => setGroupId(id == null ? null : Number(id))}
                    defaultParams={{ is_active: true, size: 25 }} maxItems={25}
                    label="Destination group" placeholder="Search authorized active groups" required
                />
            )}
            <label className="field">
                <span>Storage backend</span>
                <select value={managerId ?? ''} disabled={managersQuery.isLoading || truncated || (groupScope && groupId == null)} onChange={(event) => setManagerId(event.target.value ? Number(event.target.value) : null)}>
                    <option value="">{managersQuery.isLoading ? 'Loading authorized backends…' : 'Choose a backend'}</option>
                    {managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}{manager.use ? ` · ${manager.use}` : ''}</option>)}
                </select>
            </label>
            {managersQuery.isError && <p className="storage-error" role="alert">Authorized upload backends could not be loaded.</p>}
            {truncated && <p className="storage-error" role="alert">More than {MANAGER_LIMIT} backends match. Narrow the destination before uploading.</p>}
            {!managersQuery.isLoading && !managersQuery.isError && !truncated && managers.length === 0 && (!groupScope || groupId != null) && <p className="storage-footnote">No active upload backend is available for this scope.</p>}
            {policy && policySummary(policy)}
            {policy && files.length === 0 && (
                <FilePicker multiple accept={accept} maxFileSize={policy.max_file_size > 0 ? policy.max_file_size : undefined} maxFiles={Math.max(1, remaining)} onSelection={selectFiles}>
                    Choose files
                </FilePicker>
            )}
            {files.length > 0 && <p className="storage-upload-selection"><strong>{files.length}</strong> file{files.length === 1 ? '' : 's'} ready · {fmt.filesize(files.reduce((sum, file) => sum + file.size, 0))}</p>}
            {rejections.length > 0 && <ul className="storage-upload-rejections" role="alert">{rejections.map((message, index) => <li key={`${index}:${message}`}>{message}</li>)}</ul>}
            <div className="modal-actions">
                <button type="button" className="btn" onClick={close}>Cancel</button>
                <button type="button" className="btn btn-primary" disabled={!policy || files.length === 0 || truncated} onClick={submit}>Upload {files.length || ''}</button>
            </div>
        </div>
    );
}

export interface FileUploadSurfaceProps {
    canManage: boolean;
    canChooseGroup: boolean;
    children: (openPicker: () => void) => ReactNode;
}

/** Admin Files upload owner. Files/tasks stay queue-private and never enter Query cache. */
export function FileUploadSurface({ canManage, canChooseGroup, children }: FileUploadSurfaceProps) {
    const queryClient = useQueryClient();
    const queue = useUploadQueue({ concurrency: 3, capacity: QUEUE_CAPACITY, consumerKey: 'admin-storage-files' });
    const modalOpen = useRef(false);
    const closeModal = useRef<(() => void) | null>(null);
    const previousPermission = useRef(canManage);
    const terminalSignature = useRef('');
    const dirty = useRef(false);
    const refreshPromise = useRef<Promise<void> | null>(null);
    const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

    const cancelDestinationQueries = useCallback(() => {
        void queryClient.cancelQueries({
            predicate: (query) => query.queryKey[0] === FileManagerUploadPolicyModel.endpoint
                && typeof query.queryKey[1] === 'object'
                && (query.queryKey[1] as Record<string, unknown>)?.graph === 'upload_policy',
        });
        void queryClient.cancelQueries({ queryKey: ['/api/group'] });
    }, [queryClient]);

    const reconcile = useCallback(() => {
        if (refreshPromise.current) return refreshPromise.current;
        const run = async () => {
            do {
                dirty.current = false;
                try {
                    await queryClient.invalidateQueries({ queryKey: FileModel.keys.root, refetchType: 'none' });
                    await queryClient.refetchQueries({ type: 'active', queryKey: FileModel.keys.root }, { throwOnError: true });
                    setRefreshMessage('Authoritative refresh complete. Current filters may hide newly uploaded files.');
                } catch {
                    setRefreshMessage('Uploads may have changed, but the authoritative Files refresh failed. Refresh the table before another action.');
                }
            } while (dirty.current);
        };
        refreshPromise.current = run().finally(() => { refreshPromise.current = null; });
        return refreshPromise.current;
    }, [queryClient]);

    const onComplete = useCallback(async (file: UploadedFileRef) => {
        if (file.id < 1) throw new Error('Upload completion did not include an authoritative File id');
        dirty.current = true;
    }, []);

    const enqueue = useCallback((files: File[], destination: StartFileUploadOptions): boolean => {
        const result = queue.enqueue(files, { consumerKey: 'admin-storage-files', destination, onComplete });
        result.rejected.forEach((item) => toast.warning(item.message));
        if (result.acceptedIds.length) setRefreshMessage(null);
        return result.acceptedIds.length > 0;
    }, [queue, onComplete]);

    const open = useCallback((files: File[] = []) => {
        if (!canManage || modalOpen.current) return;
        modalOpen.current = true;
        const remaining = Math.max(0, QUEUE_CAPACITY - queue.snapshot.items.length);
        if (remaining === 0) {
            toast.warning(`The upload queue can hold ${QUEUE_CAPACITY} files.`);
            modalOpen.current = false;
            return;
        }
        files.slice(remaining).forEach((file) => toast.warning(`${file.name} was not added because the upload queue can hold ${QUEUE_CAPACITY} files.`));
        void modal.open((close) => {
            closeModal.current = () => close(null);
            return <DestinationDialog initialFiles={files.slice(0, remaining)} canChooseGroup={canChooseGroup} remaining={remaining} enqueue={enqueue} close={() => close(null)} />;
        }, { size: 'lg' }).finally(() => {
            closeModal.current = null;
            modalOpen.current = false;
        });
    }, [canManage, canChooseGroup, enqueue, queue.snapshot.items.length]);

    const dropSelection = useCallback((selection: FileSelectionResult) => {
        selection.rejected.forEach((item) => toast.warning(item.message));
        if (selection.accepted.length) open(selection.accepted);
    }, [open]);
    const { isDragActive, dropProps } = useFileDrop({ disabled: !canManage, maxFiles: QUEUE_CAPACITY, onSelection: dropSelection });

    useEffect(() => {
        if (previousPermission.current && !canManage) {
            closeModal.current?.();
            cancelDestinationQueries();
            queue.cancelAll();
        }
        previousPermission.current = canManage;
    }, [canManage, cancelDestinationQueries, queue]);

    useEffect(() => () => {
        closeModal.current?.();
        cancelDestinationQueries();
        queue.cancelAll();
    }, [cancelDestinationQueries, queue]);

    const terminal = useMemo(() => queue.snapshot.items
        .filter((item) => ['completed', 'completed-warning', 'failed', 'cancelled', 'uncertain'].includes(item.status))
        .map((item) => `${item.id}:${item.status}:${item.file?.id ?? ''}`).join('|'), [queue.snapshot.items]);
    useEffect(() => {
        if (terminal !== terminalSignature.current) {
            terminalSignature.current = terminal;
            if (terminal) dirty.current = true;
        }
        if (dirty.current && queue.snapshot.activeCount === 0 && queue.snapshot.queuedCount === 0) void reconcile();
    }, [terminal, queue.snapshot.activeCount, queue.snapshot.queuedCount, reconcile]);

    return (
        <div className={`storage-file-upload-surface${isDragActive ? ' is-drag-active' : ''}`} {...dropProps}>
            {children(() => open())}
            {isDragActive && <div className="storage-page-drop-overlay" aria-hidden="true"><i className="bi bi-cloud-arrow-up" /><strong>Drop files to choose their destination</strong></div>}
            <UploadQueue queue={queue} className="storage-upload-queue" />
            {refreshMessage && <p className={`storage-upload-refresh${refreshMessage.includes('failed') ? ' is-error' : ''}`} role="status">{refreshMessage}</p>}
        </div>
    );
}
