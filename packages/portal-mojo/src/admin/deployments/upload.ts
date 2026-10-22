import type { ManifestEntry } from './types';
export function normalizeUploadPath(path: string): string { const p = path.normalize('NFC'); if (!p || p.length > 1024 || p.startsWith('/') || p.includes('\\') || /[\u0000-\u001f]/.test(p) || p.split('/').some(x => !x || x === '.' || x === '..') || /^[a-z]:/i.test(p))
    throw new Error('Choose normalized relative file paths without traversal or empty segments'); return p; }
export async function buildManifest(files: File[], signal?: AbortSignal, limits = { files: 5000, bytes: 1024 ** 3 }): Promise<ManifestEntry[]> { if (!files.length || files.length > limits.files || files.reduce((n, f) => n + f.size, 0) > limits.bytes)
    throw new Error(`Select 1–${limits.files} files, at most ${limits.bytes} bytes. This installation may impose lower limits.`); const seen = new Set<string>(), manifest: ManifestEntry[] = []; for (const file of files) {
    signal?.throwIfAborted();
    const path = normalizeUploadPath(file.webkitRelativePath || file.name);
    if (seen.has(path))
        throw new Error(`Duplicate normalized file path: ${path}`);
    seen.add(path);
    const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    signal?.throwIfAborted();
    manifest.push({
        path, sha256: [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join(''), size: file.size
    });
} return manifest.sort((a, b) => a.path.localeCompare(b.path)); }
export function manifestEqual(a: ManifestEntry[], b: ManifestEntry[]): boolean { return JSON.stringify(a) === JSON.stringify(b); }
export async function putReleaseFiles(files: File[], manifest: ManifestEntry[], uploads: {
    path: string;
    url: string;
    headers: Record<string, string>;
}[], signal: AbortSignal, onProgress: (n: number) => void, put: typeof fetch = fetch): Promise<void> { if (uploads.length === 0)
    return; if (uploads.length !== manifest.length)
    throw new Error('Incomplete signed upload manifest'); const source = new Map(files.map(f => [normalizeUploadPath(f.webkitRelativePath || f.name), f])), seen = new Set<string>(); let completed = 0; for (const upload of uploads) {
    signal.throwIfAborted();
    const entry = manifest.find(x => x.path === upload.path), file = source.get(upload.path);
    if (!entry || !file || seen.has(upload.path))
        throw new Error('Upload path does not match the selected manifest');
    seen.add(upload.path);
    let url: URL;
    try {
        url = new URL(upload.url);
    }
    catch {
        throw new Error('Invalid storage upload destination');
    }
    if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('Storage requires an HTTPS signed destination');
    const expected = btoa(String.fromCharCode(...Uint8Array.from(entry.sha256.match(/../g) ?? [], x => parseInt(x, 16))));
    if (Object.keys(upload.headers).length !== 1 || upload.headers['x-amz-checksum-sha256'] !== expected)
        throw new Error('Storage checksum headers do not match this file');
    try {
        const response = await put(url.href, {
            method: 'PUT', headers: upload.headers, body: file, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal
        });
        if (!response.ok)
            throw new Error('upload refused');
    }
    catch {
        throw new Error('Storage upload failed. Check the bucket CORS policy permits anonymous PUT and x-amz-checksum-sha256 from this Admin origin. Completion was not sent.');
    }
    onProgress(++completed);
} }
