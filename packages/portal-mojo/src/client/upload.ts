import { apiOrigin, mojoCall, usingMockTransport } from './client';
import { mockUploadBytes } from './mock';

const INITIATE_PATH = '/api/fileman/upload/initiate';
const FILE_PATH = '/api/fileman/file';
const FALLBACK_MIME = 'application/octet-stream';

export type FileUploadPhase = 'initiating' | 'uploading' | 'reconciling' | 'completing'
    | 'completed' | 'failed' | 'cancelled' | 'uncertain';
export type FileUploadFailureStage = 'initiate' | 'transfer' | 'reconcile' | 'complete';

export interface UploadedFileRef {
    id: number;
    filename: string;
    contentType: string;
    size: number | null;
    category: string | null;
    fileManagerId: number | null;
    groupId: number | null;
}

export interface FileUploadFailure {
    stage: FileUploadFailureStage;
    code: 'invalid_response' | 'request_failed' | 'cancelled_after_initiate' | 'remote_state_unknown';
    message: string;
    retryable: boolean;
}

export type FileUploadOutcome =
    | { status: 'completed'; file: UploadedFileRef }
    | { status: 'failed'; fileId: number | null; failure: FileUploadFailure }
    | { status: 'cancelled'; fileId: null }
    | { status: 'uncertain'; fileId: number; failure: FileUploadFailure };

export interface FileUploadSnapshot {
    phase: FileUploadPhase;
    generation: number;
    fileId: number | null;
    loadedBytes: number;
    totalBytes: number | null;
    outcome: FileUploadOutcome | null;
}

export interface StartFileUploadOptions {
    fileManagerId?: number;
    groupId?: number;
}

export interface FileUploadTask {
    readonly result: Promise<FileUploadOutcome>;
    getSnapshot(): FileUploadSnapshot;
    subscribe(listener: (snapshot: FileUploadSnapshot) => void): () => void;
    cancel(): void;
    retry(): Promise<FileUploadOutcome>;
    recover(): Promise<FileUploadOutcome>;
}

interface InitiatedUpload {
    id: number;
    filename: string;
    contentType: string;
    size: number;
    capability: NormalizedCapability;
}

interface NormalizedCapability {
    url: string;
    method: 'PUT' | 'POST';
    headers: Record<string, string>;
    fields: Array<[string, string]>;
}

interface WireFile {
    id?: unknown;
    filename?: unknown;
    content_type?: unknown;
    file_size?: unknown;
    category?: unknown;
    upload_status?: unknown;
    file_manager?: unknown;
    group?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function integer(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function relationId(value: unknown): number | null {
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    return isRecord(value) ? integer(value.id) : null;
}

/** Removes browser fake paths, control characters and path separators. */
export function sanitizeUploadBasename(name: string): string {
    const basename = name.split(/[\\/]/).pop() ?? '';
    const clean = basename.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/^\.+$/, '');
    return (clean || 'upload.bin').slice(0, 255);
}

function safeScalarEntries(value: unknown): Array<[string, string]> {
    if (value == null) return [];
    if (!isRecord(value)) throw new TypeError('Invalid upload provider fields');
    return Object.entries(value).map(([key, item]) => {
        if (!key || !['string', 'number', 'boolean'].includes(typeof item)) throw new TypeError('Invalid upload provider field');
        return [key, String(item)] as [string, string];
    });
}

// Authorization may itself be a backend-issued provider capability (Azure or
// GCS, for example). The client never injects its API bearer here.
const FORBIDDEN_PROVIDER_HEADERS = new Set(['cookie', 'host', 'content-length', 'x-mojo-uid']);

function safeHeaders(value: unknown): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [name, item] of safeScalarEntries(value)) {
        const lower = name.toLowerCase();
        if (FORBIDDEN_PROVIDER_HEADERS.has(lower) || lower === 'content-type') continue;
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new TypeError('Invalid upload provider header');
        headers[name] = item;
    }
    return headers;
}

function safeCapabilityUrl(value: unknown): string {
    if (typeof value !== 'string' || value.trim() !== value || !value) throw new TypeError('Invalid upload URL');
    if (value.startsWith('/')) {
        if (value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f#]/.test(value)) throw new TypeError('Invalid upload URL');
        return value;
    }
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) throw new TypeError('Invalid upload URL');
    return parsed.toString();
}

function normalizeUploadCapability(value: unknown): NormalizedCapability {
    if (typeof value === 'string') return { url: safeCapabilityUrl(value), method: 'PUT', headers: {}, fields: [] };
    if (!isRecord(value)) throw new TypeError('Invalid upload capability');
    const url = safeCapabilityUrl(value.upload_url ?? value.url);
    const method = String(value.method ?? 'PUT').toUpperCase();
    if (method !== 'PUT' && method !== 'POST') throw new TypeError('Invalid upload method');
    const fields = safeScalarEntries(value.fields);
    if (method === 'PUT' && fields.length) throw new TypeError('PUT upload fields are unsupported');
    return { url, method, headers: safeHeaders(value.headers), fields };
}

function publicUploadUrl(url: string): string {
    if (!url.startsWith('/')) return url;
    const origin = apiOrigin() || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    return new URL(url, origin).toString();
}

function xhrUpload(request: Parameters<typeof mockUploadBytes>[0]): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort();
        xhr.open(request.method, publicUploadUrl(request.url));
        for (const [name, value] of Object.entries(request.headers)) xhr.setRequestHeader(name, value);
        if (request.method === 'PUT') xhr.setRequestHeader('Content-Type', request.contentType);
        xhr.upload.onprogress = (event) => request.onProgress(event.loaded, event.lengthComputable ? event.total : 0);
        xhr.onerror = () => reject(new TypeError('Upload connection failed'));
        xhr.onabort = () => reject(new DOMException('The operation was aborted', 'AbortError'));
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload provider rejected the request (${xhr.status})`));
        request.signal.addEventListener('abort', abort, { once: true });
        xhr.onloadend = () => request.signal.removeEventListener('abort', abort);
        if (request.method === 'POST') {
            const form = new FormData();
            for (const [name, value] of request.fields) form.append(name, value);
            form.append('file', request.file);
            xhr.send(form);
        } else xhr.send(request.file);
    });
}

function safeFailure(stage: FileUploadFailureStage, code: FileUploadFailure['code'], retryable: boolean): FileUploadFailure {
    const messages: Record<FileUploadFailure['code'], string> = {
        invalid_response: 'The upload service returned an invalid response.',
        request_failed: 'The upload request failed.',
        cancelled_after_initiate: 'Cancellation was requested after the server created the upload.',
        remote_state_unknown: 'The server could not confirm the upload state.',
    };
    return { stage, code, message: messages[code], retryable };
}

function safeCompletedFile(value: unknown): UploadedFileRef {
    if (!isRecord(value)) throw new TypeError('Invalid File response');
    const row = value as WireFile;
    const id = integer(row.id);
    if (id == null || row.upload_status !== 'completed' || typeof row.filename !== 'string' || typeof row.content_type !== 'string') {
        throw new TypeError('Invalid completed File response');
    }
    return {
        id,
        filename: row.filename,
        contentType: row.content_type,
        size: row.file_size == null ? null : integer(row.file_size),
        category: typeof row.category === 'string' ? row.category : null,
        fileManagerId: relationId(row.file_manager),
        groupId: relationId(row.group),
    };
}

class UploadTask implements FileUploadTask {
    readonly #file: File;
    readonly #options: StartFileUploadOptions;
    readonly #listeners = new Set<(snapshot: FileUploadSnapshot) => void>();
    #snapshot: FileUploadSnapshot = { phase: 'initiating', generation: 0, fileId: null, loadedBytes: 0, totalBytes: null, outcome: null };
    #initiated: InitiatedUpload | null = null;
    #controller: AbortController | null = null;
    #active: Promise<FileUploadOutcome> | null = null;
    #result: Promise<FileUploadOutcome>;

    constructor(file: File, options: StartFileUploadOptions) {
        this.#file = file;
        this.#options = options;
        this.#result = this.#start('initial');
    }

    get result(): Promise<FileUploadOutcome> { return this.#result; }
    getSnapshot(): FileUploadSnapshot { return { ...this.#snapshot, outcome: this.#snapshot.outcome && structuredClone(this.#snapshot.outcome) }; }
    subscribe(listener: (snapshot: FileUploadSnapshot) => void): () => void {
        this.#listeners.add(listener);
        listener(this.getSnapshot());
        return () => this.#listeners.delete(listener);
    }
    cancel(): void { this.#controller?.abort(); }
    retry(): Promise<FileUploadOutcome> { return this.#start('retry'); }
    recover(): Promise<FileUploadOutcome> { return this.#start('recover'); }

    #publish(patch: Partial<FileUploadSnapshot>, generation: number): void {
        if (generation !== this.#snapshot.generation) return;
        this.#snapshot = { ...this.#snapshot, ...patch };
        for (const listener of this.#listeners) {
            try { listener(this.getSnapshot()); } catch { /* observers cannot change transfer truth */ }
        }
    }

    #start(mode: 'initial' | 'retry' | 'recover'): Promise<FileUploadOutcome> {
        if (this.#active) return this.#active;
        if (mode !== 'initial' && !['failed', 'uncertain', 'cancelled'].includes(this.#snapshot.phase)) return this.#result;
        const generation = this.#snapshot.generation + 1;
        this.#snapshot = { phase: this.#initiated ? 'reconciling' : 'initiating', generation, fileId: this.#initiated?.id ?? null, loadedBytes: 0, totalBytes: null, outcome: null };
        this.#controller = new AbortController();
        const running = this.#run(generation, mode, this.#controller.signal).finally(() => {
            if (this.#snapshot.generation === generation) { this.#active = null; this.#controller = null; }
        });
        this.#active = running;
        this.#result = running;
        return running;
    }

    async #run(generation: number, mode: 'initial' | 'retry' | 'recover', signal: AbortSignal): Promise<FileUploadOutcome> {
        let stage: FileUploadFailureStage = this.#initiated ? 'reconcile' : 'initiate';
        try {
            if (!this.#initiated) await this.#initiate(generation, signal);
            else {
                const row = await this.#read(generation, signal);
                if (row.upload_status === 'completed') return this.#completeOutcome(safeCompletedFile(row), generation);
                if (row.upload_status !== 'uploading') return this.#failOutcome(stage, generation);
                if (mode === 'recover') return await this.#complete(generation, signal);
            }
            stage = 'transfer';
            await this.#transfer(generation, signal);
            stage = 'reconcile';
            const row = await this.#read(generation, signal);
            if (row.upload_status === 'completed') return this.#completeOutcome(safeCompletedFile(row), generation);
            if (row.upload_status !== 'uploading') return this.#failOutcome(stage, generation);
            stage = 'complete';
            return await this.#complete(generation, signal);
        } catch (error) {
            if (generation !== this.#snapshot.generation) return this.#snapshot.outcome ?? this.#failOutcome(stage, generation);
            const aborted = error instanceof DOMException && error.name === 'AbortError';
            if (!this.#initiated) {
                const outcome: FileUploadOutcome = aborted
                    ? { status: 'cancelled', fileId: null }
                    : { status: 'failed', fileId: null, failure: safeFailure(stage, error instanceof TypeError ? 'invalid_response' : 'request_failed', true) };
                this.#publish({ phase: outcome.status, outcome }, generation);
                return outcome;
            }
            if (!aborted && (stage === 'complete' || stage === 'reconcile')) {
                try {
                    const row = await this.#read(generation, new AbortController().signal);
                    if (row.upload_status === 'completed') return this.#completeOutcome(safeCompletedFile(row), generation);
                } catch { /* state remains ambiguous */ }
            }
            const outcome: FileUploadOutcome = {
                status: 'uncertain', fileId: this.#initiated.id,
                failure: safeFailure(stage, aborted ? 'cancelled_after_initiate' : 'remote_state_unknown', true),
            };
            this.#publish({ phase: 'uncertain', outcome }, generation);
            return outcome;
        }
    }

    async #initiate(generation: number, signal: AbortSignal): Promise<void> {
        this.#publish({ phase: 'initiating' }, generation);
        const filename = sanitizeUploadBasename(this.#file.name);
        const requestedType = this.#file.type || FALLBACK_MIME;
        const body: Record<string, unknown> = { filename, content_type: requestedType, file_size: this.#file.size };
        if (this.#options.fileManagerId != null) body.file_manager = this.#options.fileManagerId;
        if (this.#options.groupId != null) body.group = this.#options.groupId;
        const envelope = await mojoCall(INITIATE_PATH, { method: 'POST', body, signal });
        if (!isRecord(envelope.data)) throw new TypeError('Invalid upload initiation response');
        const id = integer(envelope.data.id);
        const contentType = typeof envelope.data.content_type === 'string' && envelope.data.content_type ? envelope.data.content_type : null;
        const serverFilename = typeof envelope.data.filename === 'string' && envelope.data.filename ? envelope.data.filename : null;
        const size = integer(envelope.data.file_size);
        if (id == null || contentType == null || serverFilename == null || size == null) throw new TypeError('Invalid upload initiation response');
        this.#initiated = { id, filename: serverFilename, contentType, size, capability: normalizeUploadCapability(envelope.data.upload_url) };
        this.#publish({ fileId: id }, generation);
    }

    async #transfer(generation: number, signal: AbortSignal): Promise<void> {
        const initiated = this.#initiated!;
        this.#publish({ phase: 'uploading', loadedBytes: 0, totalBytes: null }, generation);
        const request = {
            ...initiated.capability,
            file: this.#file,
            contentType: initiated.contentType,
            signal,
            onProgress: (loaded: number, total: number) => this.#publish({ loadedBytes: loaded, totalBytes: total > 0 ? total : null }, generation),
        };
        await (usingMockTransport() ? mockUploadBytes(request) : xhrUpload(request));
    }

    async #read(generation: number, signal: AbortSignal): Promise<WireFile> {
        this.#publish({ phase: 'reconciling' }, generation);
        const envelope = await mojoCall(`${FILE_PATH}/${this.#initiated!.id}`, { signal });
        if (!isRecord(envelope.data)) throw new TypeError('Invalid File response');
        return envelope.data;
    }

    async #complete(generation: number, signal: AbortSignal): Promise<FileUploadOutcome> {
        this.#publish({ phase: 'completing' }, generation);
        const envelope = await mojoCall(`${FILE_PATH}/${this.#initiated!.id}`, { method: 'POST', body: { action: 'mark_as_completed' }, signal });
        return this.#completeOutcome(safeCompletedFile(envelope.data), generation);
    }

    #completeOutcome(file: UploadedFileRef, generation: number): FileUploadOutcome {
        const outcome: FileUploadOutcome = { status: 'completed', file };
        this.#publish({ phase: 'completed', outcome }, generation);
        return outcome;
    }

    #failOutcome(stage: FileUploadFailureStage, generation: number): FileUploadOutcome {
        const outcome: FileUploadOutcome = { status: 'failed', fileId: this.#initiated?.id ?? null, failure: safeFailure(stage, 'request_failed', false) };
        this.#publish({ phase: 'failed', outcome }, generation);
        return outcome;
    }
}

/** Starts the imperative three-stage django-mojo upload workflow immediately. */
export function startFileUpload(file: File, options: StartFileUploadOptions = {}): FileUploadTask {
    return new UploadTask(file, options);
}
