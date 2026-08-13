import { useQuery, type QueryClient } from '@tanstack/react-query';
import {
    MojoError, defineModel, mojoCall, mojoDelete, mojoGet, mojoSave, useCan, withFreshAuth,
    type Envelope, type Params,
} from '../../client/runtime';
import { createSafeExporter } from '../../client/safe-export';
import { USER_VIEW_PERMISSIONS } from '../identity/users/models';
import { BUCKET_MANAGE_PERMS, STORAGE_MANAGE_PERMS, STORAGE_VIEW_PERMS } from './permissions';

export { BUCKET_MANAGE_PERMS, STORAGE_MANAGE_PERMS, STORAGE_VIEW_PERMS } from './permissions';
export const GROUP_DIRECTORY_PERMS = ['sys.view_groups', 'sys.manage_groups', 'sys.manage_group', 'sys.groups'];
export const USER_DIRECTORY_PERMS = USER_VIEW_PERMISSIONS;

export interface RelationRow { id: number; name?: string | null; display_name?: string | null; email?: string | null }

export interface FileManagerRow {
    id: number;
    created: number;
    name: string;
    use: string | null;
    backend_type: string;
    backend_url: string;
    is_active: boolean;
    is_default: boolean;
    is_public: boolean;
    aws_region?: string | null;
    aws_key_masked?: string | null;
    aws_secret_masked?: string | null;
    allowed_origins?: string[];
    assume_role_arn?: string | null;
    has_external_id?: boolean;
    group?: RelationRow | number | null;
    user?: RelationRow | number | null;
}

/** Capability-free projection used only to choose an upload destination. */
export interface FileManagerUploadPolicyRow {
    id: number;
    name: string;
    use: string | null;
    is_active: boolean;
    max_file_size: number;
    allowed_extensions: string[];
    allowed_mime_types: string[];
    supports_direct_upload: boolean;
}

export interface FileRenditionRow {
    id: number;
    created: number;
    modified: number;
    filename: string;
    file_size: number | null;
    content_type: string;
    category?: string | null;
    role: string;
    upload_status: string;
    width?: number | null;
    height?: number | null;
    url?: string | null;
}

export interface FileRow {
    id: number;
    created: number;
    modified: number;
    filename: string;
    file_size: number | null;
    content_type: string;
    category: string | null;
    upload_status: 'pending' | 'uploading' | 'completed' | 'failed' | 'expired' | string;
    is_active: boolean;
    is_public: boolean;
    group?: RelationRow | number | null;
    user?: RelationRow | number | null;
    file_manager?: RelationRow | number | null;
    metadata?: Record<string, unknown>;
    url?: string | null;
    thumbnail?: string | null;
    renditions?: Record<string, FileRenditionRow>;
}

export interface ShortLinkShareRow {
    id: number;
    code: string;
    url: string;
    source: string;
    hit_count: number;
    expires_at: number | string | null;
    is_active: boolean;
    track_clicks?: boolean;
    metadata?: Record<string, unknown>;
    note?: string | null;
    created: number;
    modified?: number;
    user?: RelationRow | number | null;
    group?: RelationRow | number | null;
}

export interface S3BucketRow { id: string; name: string; created: number }
export type MutationState = 'none' | 'partial' | 'unknown' | 'complete';
export interface S3FailureEvidence {
    name?: string;
    action?: string;
    complete: false;
    mutation_state: Exclude<MutationState, 'complete'>;
    counts?: Record<string, number | null>;
    failed?: Record<string, number | null>;
    remaining?: Record<string, number | null> | null;
    failure?: { operation?: string; provider_code?: string; retryable?: boolean };
    requested_public?: boolean;
    created_new?: boolean | null;
    is_public?: boolean | null;
    configured_public?: boolean | null;
    safety_lock?: 'applied' | 'failed' | 'not_needed';
}
export interface BucketCreateResult { id: string; name: string; created_new: boolean | null }
export interface BucketAccessResult {
    name: string;
    is_public: boolean;
    configured_public?: boolean;
    complete: true;
    mutation_state: 'complete';
}
export interface BucketEmptyResult {
    name: string;
    complete: true;
    mutation_state: 'complete';
    deleted_objects: number;
    deleted_versions: number;
    deleted_markers: number;
    aborted_uploads: number;
}

const COMMON_LIST = new Set(['start', 'size', 'sort', 'search', 'dr_field', 'dr_start', 'dr_end']);
const MANAGER_FILTERS = new Set(['id', 'id__in', 'backend_type', 'backend_type__in', 'is_active', 'is_default', 'is_public', 'group', 'group__isnull', 'user', 'user__isnull']);
const FILE_FILTERS = new Set(['id', 'id__in', 'file_manager', 'group', 'group__isnull', 'user', 'category', 'category__in', 'content_type', 'content_type__icontains', 'upload_status', 'upload_status__in', 'is_active', 'is_public', 'created__gte', 'created__lte']);

function allowListParams(params: Params, filters: Set<string>, graph: string): Params {
    const out: Params = { graph };
    for (const [key, value] of Object.entries(params)) {
        if ((COMMON_LIST.has(key) || filters.has(key)) && value != null && value !== '') out[key] = value;
    }
    out.sort = String(out.sort ?? '-created');
    return out;
}

function relation(value: unknown): RelationRow | number | null {
    if (typeof value === 'number') return value;
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (typeof raw.id !== 'number') return null;
    return {
        id: raw.id,
        ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
        ...(typeof raw.display_name === 'string' ? { display_name: raw.display_name } : {}),
        ...(typeof raw.email === 'string' ? { email: raw.email } : {}),
    };
}

export function storageRelationId(value: RelationRow | number | null | undefined): number | null {
    return typeof value === 'number' ? value : value?.id ?? null;
}

/** Allowlist before any FileManager row can enter TanStack Query state. */
export function sanitizeFileManagerRow(input: FileManagerRow): FileManagerRow {
    const raw = input as unknown as Record<string, unknown>;
    return {
        id: Number(raw.id),
        created: Number(raw.created ?? 0),
        name: String(raw.name ?? ''),
        use: raw.use == null ? null : String(raw.use),
        backend_type: String(raw.backend_type ?? 'unknown'),
        backend_url: String(raw.backend_url ?? ''),
        is_active: Boolean(raw.is_active),
        is_default: Boolean(raw.is_default),
        is_public: Boolean(raw.is_public),
        aws_region: raw.aws_region == null ? null : String(raw.aws_region),
        aws_key_masked: raw.aws_key_masked == null ? null : String(raw.aws_key_masked),
        aws_secret_masked: raw.aws_secret_masked == null ? null : String(raw.aws_secret_masked),
        allowed_origins: Array.isArray(raw.allowed_origins) ? raw.allowed_origins.map(String) : [],
        assume_role_arn: raw.assume_role_arn == null ? null : String(raw.assume_role_arn),
        has_external_id: Boolean(raw.has_external_id),
        group: relation(raw.group),
        user: relation(raw.user),
    };
}

export function sanitizeFileManagerUploadPolicyRow(input: FileManagerUploadPolicyRow): FileManagerUploadPolicyRow {
    const raw = input as unknown as Record<string, unknown>;
    const id = Number(raw.id);
    const maxFileSize = Number(raw.max_file_size);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(maxFileSize) || maxFileSize < 0) {
        throw new TypeError('Invalid FileManager upload policy');
    }
    return {
        id,
        name: String(raw.name ?? ''),
        use: raw.use == null ? null : String(raw.use),
        is_active: Boolean(raw.is_active),
        max_file_size: maxFileSize,
        allowed_extensions: Array.isArray(raw.allowed_extensions) ? raw.allowed_extensions.map(String) : [],
        allowed_mime_types: Array.isArray(raw.allowed_mime_types) ? raw.allowed_mime_types.map(String) : [],
        supports_direct_upload: Boolean(raw.supports_direct_upload),
    };
}

export function sanitizeFileRow(input: FileRow): FileRow {
    const raw = input as unknown as Record<string, unknown>;
    const renditions: Record<string, FileRenditionRow> = {};
    if (raw.renditions && typeof raw.renditions === 'object' && !Array.isArray(raw.renditions)) {
        for (const [role, value] of Object.entries(raw.renditions as Record<string, unknown>)) {
            if (!value || typeof value !== 'object') continue;
            const row = value as Record<string, unknown>;
            renditions[role] = {
                id: Number(row.id), created: Number(row.created ?? 0), modified: Number(row.modified ?? 0),
                filename: String(row.filename ?? ''), file_size: row.file_size == null ? null : Number(row.file_size),
                content_type: String(row.content_type ?? 'application/octet-stream'), category: row.category == null ? null : String(row.category),
                role, upload_status: String(row.upload_status ?? 'pending'),
                width: row.width == null ? null : Number(row.width), height: row.height == null ? null : Number(row.height),
                url: row.url == null ? null : String(row.url),
            };
        }
    }
    return {
        id: Number(raw.id), created: Number(raw.created ?? 0), modified: Number(raw.modified ?? 0),
        filename: String(raw.filename ?? ''), file_size: raw.file_size == null ? null : Number(raw.file_size),
        content_type: String(raw.content_type ?? 'application/octet-stream'), category: raw.category == null ? null : String(raw.category),
        upload_status: String(raw.upload_status ?? 'pending'), is_active: Boolean(raw.is_active), is_public: Boolean(raw.is_public),
        group: relation(raw.group), user: relation(raw.user), file_manager: relation(raw.file_manager),
        metadata: raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? raw.metadata as Record<string, unknown> : {},
        url: raw.url == null ? null : String(raw.url), thumbnail: raw.thumbnail == null ? null : String(raw.thumbnail), renditions,
    };
}

export const SUPPORTED_FILE_MANAGER_BACKENDS = [
    { value: 'file', label: 'File system' },
    { value: 's3', label: 'AWS S3' },
] as const;

export const FileManagerModel = defineModel<FileManagerRow>({
    name: 'file-manager', endpoint: '/api/fileman/manager',
    permissions: { view: STORAGE_VIEW_PERMS, manage: STORAGE_MANAGE_PERMS },
    normalizeListParams: (params) => allowListParams(params, MANAGER_FILTERS, 'list'),
    sanitizeRow: sanitizeFileManagerRow,
});

export const FileManagerUploadPolicyModel = defineModel<FileManagerUploadPolicyRow>({
    name: 'file-manager-upload-policy', endpoint: '/api/fileman/manager',
    permissions: { view: STORAGE_MANAGE_PERMS },
    normalizeListParams: (params) => {
        const safe = allowListParams(params, MANAGER_FILTERS, 'upload_policy');
        safe.start = 0;
        safe.size = Math.min(50, Math.max(1, Number(safe.size) || 50));
        safe.sort = 'name';
        safe.is_active = true;
        return safe;
    },
    sanitizeRow: sanitizeFileManagerUploadPolicyRow,
});

export const FileModel = defineModel<FileRow>({
    name: 'file', endpoint: '/api/fileman/file',
    permissions: { view: STORAGE_VIEW_PERMS, manage: STORAGE_MANAGE_PERMS, delete: STORAGE_MANAGE_PERMS },
    actions: { regenerate_renditions: { permissions: STORAGE_MANAGE_PERMS, response: 'payload' } },
    normalizeListParams: (params) => allowListParams(params, FILE_FILTERS, 'list'),
    sanitizeRow: sanitizeFileRow,
});

export const ShortLinkShareModel = defineModel<ShortLinkShareRow>({
    name: 'file-share', endpoint: '/api/shortlink/link',
    normalizeListParams: (params) => ({
        graph: 'default', source: 'fileman-share', file: params.file,
        start: params.start ?? 0, size: params.size ?? 25, sort: params.sort ?? '-created',
    }),
    sanitizeRow: (input) => {
        const row = input as unknown as Record<string, unknown>;
        const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {};
        return {
            id: Number(row.id), code: String(row.code ?? '').slice(0, 10), url: String(row.url ?? ''),
            source: String(row.source ?? '').slice(0, 50), hit_count: Math.max(0, Number(row.hit_count ?? 0) || 0),
            expires_at: typeof row.expires_at === 'number' || typeof row.expires_at === 'string' ? row.expires_at : null,
            is_active: Boolean(row.is_active), track_clicks: Boolean(row.track_clicks),
            note: typeof metadata.note === 'string' ? metadata.note.slice(0, 512) : null,
            created: Number(row.created ?? 0), modified: Number(row.modified ?? 0), user: relation(row.user), group: relation(row.group),
        };
    },
});

export function scrubFileManagerChanges(changes: Record<string, unknown>): Record<string, unknown> {
    const out = { ...changes };
    for (const key of ['aws_key_masked', 'aws_secret_masked', 'mojo_secrets', 'secrets', 'upload_token']) delete out[key];
    if (typeof out.aws_key !== 'string' || out.aws_key.trim() === '') delete out.aws_key;
    if (typeof out.aws_secret !== 'string' || out.aws_secret.trim() === '') delete out.aws_secret;
    return out;
}

export async function saveFileManagerAtomic(args: {
    queryClient: QueryClient;
    id: number | null;
    changes: Record<string, unknown>;
    expectedOwner?: { group: number | null; user: number | null };
}): Promise<FileManagerRow> {
    const changes = scrubFileManagerChanges(args.changes);
    let saved: FileManagerRow | null = null;
    let authoritative: FileManagerRow | null = null;
    let mutationError: unknown;
    let refreshError: unknown;
    try {
        saved = sanitizeFileManagerRow(await withFreshAuth(() => mojoSave<FileManagerRow>(FileManagerModel.endpoint, args.id, changes)));
    } catch (error) {
        mutationError = error;
    } finally {
        const knownId = saved?.id ?? args.id;
        const retainRefreshError = (error: unknown) => { refreshError ??= error; };
        try {
            await args.queryClient.invalidateQueries({ queryKey: FileManagerModel.keys.root, refetchType: 'none' });
        } catch (error) { retainRefreshError(error); }
        if (knownId != null) {
            // A failed mutation can still have changed external state. Never let the
            // pre-mutation detail snapshot regain authority while reconciliation fails.
            args.queryClient.removeQueries({ queryKey: FileManagerModel.keys.one(knownId), exact: true });
            try {
                authoritative = sanitizeFileManagerRow(await mojoGet<FileManagerRow>(FileManagerModel.endpoint, knownId));
                args.queryClient.setQueryData(FileManagerModel.keys.one(knownId), authoritative);
            } catch (error) { retainRefreshError(error); }
        }
        try {
            await args.queryClient.refetchQueries({
                type: 'active',
                predicate: (query) => query.queryKey[0] === FileManagerModel.endpoint && query.queryKey[1] !== 'one',
            }, { throwOnError: true });
        } catch (error) { retainRefreshError(error); }
    }
    if (mutationError !== undefined) {
        if (refreshError !== undefined) attachStorageRefreshFailure(mutationError, refreshError);
        throw mutationError;
    }
    if (refreshError !== undefined || !authoritative) {
        const error = new MojoError('The backend may have changed, but authoritative refresh failed. Refresh before another action.', 0, 'storage_refresh_failed');
        attachStorageRefreshFailure(error, refreshError ?? new Error('Authoritative backend row was not returned'));
        throw error;
    }
    if (args.expectedOwner && (storageRelationId(authoritative.group) !== args.expectedOwner.group || storageRelationId(authoritative.user) !== args.expectedOwner.user)) {
        throw new MojoError('The backend did not attach the requested owner. Check your directory permissions and try again.', 403, 'fk_attach_denied');
    }
    return authoritative;
}

const STORAGE_REFRESH_FAILURE = 'storageRefreshError';
const storageRefreshFailures = new WeakMap<object, unknown>();

function attachStorageRefreshFailure(error: unknown, refreshError: unknown): void {
    if ((typeof error !== 'object' && typeof error !== 'function') || error === null) return;
    storageRefreshFailures.set(error as object, refreshError);
    try {
        Object.defineProperty(error, STORAGE_REFRESH_FAILURE, { value: refreshError, configurable: true });
    } catch { /* Preserve the primary mutation failure even when it is frozen. */ }
}

export function storageRefreshFailure(error: unknown): unknown {
    if ((typeof error !== 'object' && typeof error !== 'function') || error === null) return undefined;
    return storageRefreshFailures.get(error as object) ?? (error as Record<string, unknown>)[STORAGE_REFRESH_FAILURE];
}

// Deliberately NOT client/action-result's `mojoAction`: these per-key testers
// hand-normalize the wrapped `{data:{status:false, error}}` shape themselves
// and answer a caller-shaped `{status, id, result}` evidence dict — migrating
// would change both the thrown type and the resolved shape for no gain.
export async function runFileManagerAction(id: number, action: 'test_connection' | 'check_cors' | 'fix_cors' | 'clone', value: unknown = true): Promise<Record<string, unknown>> {
    const body = await mojoCall(`${FileManagerModel.endpoint}/${id}`, { method: 'POST', body: { [action]: value } });
    const data = body.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${action} returned no result`);
    const row = data as Record<string, unknown>;
    if (row.status === false) throw new Error(typeof row.error === 'string' ? row.error : `${action} failed`);
    return {
        status: row.status !== false,
        ...(typeof row.id === 'number' ? { id: row.id } : {}),
        ...(row.result && typeof row.result === 'object' ? { result: row.result } : {}),
    };
}

export async function saveFileAndReconcileGroup(queryClient: QueryClient, id: number, changes: Pick<FileRow, 'filename' | 'is_public'> & { group?: number | null } | Record<string, unknown>, expectedGroup?: number): Promise<FileRow> {
    await mojoSave<FileRow>(FileModel.endpoint, id, changes as Record<string, unknown>);
    await FileModel.invalidate(queryClient);
    queryClient.removeQueries({ queryKey: FileModel.keys.one(id), exact: true });
    const row = sanitizeFileRow(await mojoGet<FileRow>(FileModel.endpoint, id));
    queryClient.setQueryData(FileModel.keys.one(id), row);
    if (expectedGroup !== undefined && storageRelationId(row.group) !== expectedGroup) {
        throw new MojoError('The backend did not move the file to the requested group.', 403, 'fk_attach_denied');
    }
    return row;
}

export interface ShareOptions { expire_days?: number; track_clicks?: boolean; note?: string }
export interface ShareCreateResult { url: string; code: string; expires_at: string | null; track_clicks: boolean }
// Deliberately NOT `mojoAction`: the reply is a one-shot capability URL with
// its own strict validation (safe-URL + expiry checks), not act-toast-refresh.
export async function createFileShare(id: number, options: true | ShareOptions): Promise<ShareCreateResult> {
    const body = await mojoCall(`${FileModel.endpoint}/${id}`, { method: 'POST', body: { share: options } });
    const raw = body.data;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Share creation returned no result');
    const row = raw as Record<string, unknown>;
    if (row.status === false) throw new Error(typeof row.error === 'string' ? row.error : 'Share creation failed');
    const url = typeof row.url === 'string' ? row.url : '';
    if (!isSafeCapabilityUrl(url)) throw new Error('The share service returned an unsafe URL');
    const expiresAt = row.expires_at == null ? null : String(row.expires_at);
    if (expiresAt != null && !Number.isFinite(Date.parse(expiresAt))) throw new Error('The share service returned an invalid expiry');
    return { url, code: String(row.shortlink_code ?? ''), expires_at: expiresAt, track_clicks: Boolean(row.track_clicks) };
}

export async function revokeFileShare(id: number): Promise<ShortLinkShareRow> {
    return mojoSave<ShortLinkShareRow>(ShortLinkShareModel.endpoint, id, { is_active: false });
}

export async function setFileShareActive(id: number, isActive: boolean): Promise<ShortLinkShareRow> {
    return mojoSave<ShortLinkShareRow>(ShortLinkShareModel.endpoint, id, { is_active: isActive });
}

export async function deleteFileShare(id: number): Promise<void> {
    return mojoDelete(ShortLinkShareModel.endpoint, id);
}

export function isSafeCapabilityUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value.trim() !== value || value === '' || value.startsWith('//')) return false;
    if (value.startsWith('/')) return !value.startsWith('//') && !/[\r\n]/.test(value);
    try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
    } catch {
        return false;
    }
}

export function openCapabilityUrl(url: string, download = false): boolean {
    if (!isSafeCapabilityUrl(url)) return false;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.rel = 'noreferrer';
    if (download) anchor.download = '';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
}

export const exportFileManagers = createSafeExporter<FileManagerRow>({
    endpoint: FileManagerModel.endpoint, filename: 'storage-backends', sanitizeRow: sanitizeFileManagerRow,
    fields: [
        { key: 'id' }, { key: 'name' }, { key: 'backend_type' }, { key: 'is_active' },
        { key: 'is_default' }, { key: 'is_public' }, { key: 'created' },
        { key: 'scope', value: (row) => storageRelationId(row.group) != null ? `group:${storageRelationId(row.group)}` : storageRelationId(row.user) != null ? `user:${storageRelationId(row.user)}` : 'system' },
    ],
});

export const exportFiles = createSafeExporter<FileRow>({
    endpoint: FileModel.endpoint, filename: 'storage-files', sanitizeRow: sanitizeFileRow,
    fields: [
        { key: 'id' }, { key: 'filename' }, { key: 'content_type' }, { key: 'category' },
        { key: 'file_size' }, { key: 'upload_status' }, { key: 'is_active' },
        { key: 'is_public' }, { key: 'created' },
        { key: 'group_id', value: (row) => storageRelationId(row.group) },
        { key: 'file_manager_id', value: (row) => storageRelationId(row.file_manager) },
    ],
});

function object(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} returned an invalid payload`);
    return value as Record<string, unknown>;
}
function string(value: unknown, name: string): string {
    if (typeof value !== 'string' || value === '') throw new Error(`${name} is missing`);
    return value;
}
function boolean(value: unknown, name: string): boolean {
    if (typeof value !== 'boolean') throw new Error(`${name} is missing`);
    return value;
}
function finite(value: unknown, name: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${name} is invalid`);
    return value;
}

function safeAggregate(value: unknown): Record<string, number | null> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const aggregate: Record<string, number | null> = {};
    for (const [key, count] of Object.entries(value)) {
        if (count === null || (typeof count === 'number' && Number.isFinite(count) && count >= 0)) aggregate[key] = count;
    }
    return aggregate;
}

export function parseBucketList(body: Envelope): S3BucketRow[] {
    if (!Array.isArray(body.data)) throw new Error('Bucket inventory returned an invalid list');
    return body.data.map((value) => {
        const row = object(value, 'Bucket');
        return { id: string(row.id, 'Bucket id'), name: string(row.name, 'Bucket name'), created: finite(row.created, 'Bucket created') };
    });
}
export function parseBucketCreate(value: unknown): BucketCreateResult {
    const row = object(value, 'Bucket create');
    const created = row.created_new;
    if (created !== null && typeof created !== 'boolean') throw new Error('Bucket created_new is invalid');
    return { id: string(row.id, 'Bucket id'), name: string(row.name, 'Bucket name'), created_new: created };
}
export function parseBucketAccess(value: unknown): BucketAccessResult {
    const row = object(value, 'Bucket access');
    if (row.complete !== true || row.mutation_state !== 'complete') throw new Error('Bucket access did not report complete');
    return { name: string(row.name, 'Bucket name'), is_public: boolean(row.is_public ?? row.configured_public, 'Bucket posture'), configured_public: typeof row.configured_public === 'boolean' ? row.configured_public : undefined, complete: true, mutation_state: 'complete' };
}
export function parseBucketEmpty(value: unknown): BucketEmptyResult {
    const row = object(value, 'Bucket empty');
    if (row.complete !== true || row.mutation_state !== 'complete') throw new Error('Bucket empty did not report complete');
    return {
        name: string(row.name, 'Bucket name'), complete: true, mutation_state: 'complete',
        deleted_objects: finite(row.deleted_objects, 'deleted_objects'), deleted_versions: finite(row.deleted_versions, 'deleted_versions'),
        deleted_markers: finite(row.deleted_markers, 'deleted_markers'), aborted_uploads: finite(row.aborted_uploads, 'aborted_uploads'),
    };
}

export function parseS3Failure(error: unknown): S3FailureEvidence | null {
    if (!(error instanceof MojoError) || error.errorCode !== 's3_operation_incomplete') return null;
    const raw = object(error.data, 'S3 failure');
    if (raw.complete !== false || !['none', 'partial', 'unknown'].includes(String(raw.mutation_state))) return null;
    const state = raw.mutation_state as S3FailureEvidence['mutation_state'];
    return {
        name: typeof raw.name === 'string' ? raw.name : undefined,
        action: typeof raw.action === 'string' ? raw.action : undefined,
        complete: false, mutation_state: state,
        counts: safeAggregate(raw.counts),
        failed: safeAggregate(raw.failed),
        remaining: raw.remaining === null ? null : safeAggregate(raw.remaining),
        failure: raw.failure && typeof raw.failure === 'object' && !Array.isArray(raw.failure) ? (() => {
            const failure = raw.failure as Record<string, unknown>;
            return {
                ...(typeof failure.operation === 'string' ? { operation: failure.operation } : {}),
                ...(typeof failure.provider_code === 'string' ? { provider_code: failure.provider_code } : {}),
                ...(typeof failure.retryable === 'boolean' ? { retryable: failure.retryable } : {}),
            };
        })() : undefined,
        requested_public: typeof raw.requested_public === 'boolean' ? raw.requested_public : undefined,
        created_new: raw.created_new === null || typeof raw.created_new === 'boolean' ? raw.created_new : undefined,
        is_public: raw.is_public === null || typeof raw.is_public === 'boolean' ? raw.is_public : undefined,
        configured_public: raw.configured_public === null || typeof raw.configured_public === 'boolean' ? raw.configured_public : undefined,
        safety_lock: ['applied', 'failed', 'not_needed'].includes(String(raw.safety_lock)) ? raw.safety_lock as S3FailureEvidence['safety_lock'] : undefined,
    };
}

export const BUCKET_QUERY_KEY = ['admin-storage', 'buckets'] as const;
export async function fetchBucketInventory(): Promise<S3BucketRow[]> {
    return parseBucketList(await mojoCall('/api/aws/s3/bucket'));
}
export function useBuckets() {
    const { can } = useCan(BUCKET_MANAGE_PERMS);
    return useQuery({ queryKey: BUCKET_QUERY_KEY, queryFn: fetchBucketInventory, enabled: can, staleTime: 30_000 });
}

export interface BucketMutationOutcome<T> { data?: T; error?: unknown; evidence?: S3FailureEvidence | null; refreshError?: unknown }
export async function postBucketAndRefresh<T>(queryClient: QueryClient, name: string, body: Record<string, unknown>, parse: (value: unknown) => T, freshAuth = false): Promise<BucketMutationOutcome<T>> {
    const outcome: BucketMutationOutcome<T> = {};
    try {
        const request = () => mojoCall(`/api/aws/s3/bucket/${encodeURIComponent(name)}`, { method: 'POST', body });
        const response = freshAuth ? await withFreshAuth(request) : await request();
        outcome.data = parse(response.data);
    } catch (error) {
        outcome.error = error;
        outcome.evidence = parseS3Failure(error);
    } finally {
        await queryClient.invalidateQueries({ queryKey: BUCKET_QUERY_KEY });
        try {
            await queryClient.fetchQuery({ queryKey: BUCKET_QUERY_KEY, queryFn: fetchBucketInventory, staleTime: 0 });
        } catch (refreshError) {
            outcome.refreshError = refreshError;
        }
    }
    return outcome;
}
export function createBucket(queryClient: QueryClient, name: string) {
    return postBucketAndRefresh(queryClient, name, {}, parseBucketCreate);
}
export function setBucketPublic(queryClient: QueryClient, name: string, value: boolean) {
    return postBucketAndRefresh(queryClient, name, { set_public: value }, parseBucketAccess);
}
export function emptyBucket(queryClient: QueryClient, name: string, confirmedName: string): Promise<BucketMutationOutcome<BucketEmptyResult>> {
    if (name !== confirmedName) return Promise.resolve({ error: new MojoError('Bucket name does not match.', 400, 'invalid_request') });
    const body = { empty: { confirm_name: name } };
    return postBucketAndRefresh(queryClient, name, body, parseBucketEmpty, true);
}

export function deleteFile(id: number): Promise<void> { return mojoDelete(FileModel.endpoint, id); }
