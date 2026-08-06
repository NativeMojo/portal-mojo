import { useEffect, useRef } from 'react';
import { openCapabilityUrl, isSafeCapabilityUrl, type FileRow } from './models';
import { normalizeRenditions } from './file-renditions';

const KNOWN = new Set(['image', 'video', 'audio', 'pdf', 'document', 'spreadsheet', 'presentation', 'archive', 'text', 'csv']);

export function filePreviewCategory(file: Pick<FileRow, 'category' | 'content_type'>): string {
    if (file.category) return file.category.toLowerCase();
    const mime = file.content_type.toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime === 'application/pdf') return 'pdf';
    if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return 'spreadsheet';
    if (mime.includes('presentation') || mime.includes('powerpoint')) return 'presentation';
    if (mime.includes('word') || mime.includes('document')) return 'document';
    if (mime.includes('zip') || mime.includes('archive') || mime.includes('tar')) return 'archive';
    if (mime.startsWith('text/')) return 'text';
    return 'unknown';
}

function SafeActions({ url, download = true }: { url: string | null | undefined; download?: boolean }) {
    if (!isSafeCapabilityUrl(url)) return <p className="storage-unsafe"><i className="bi bi-shield-exclamation" /> URL withheld: the capability value is missing or unsafe.</p>;
    return <div className="storage-action-row"><button className="btn" onClick={() => openCapabilityUrl(url)}><i className="bi bi-box-arrow-up-right" /> Open</button>{download && <button className="btn" onClick={() => openCapabilityUrl(url, true)}><i className="bi bi-download" /> Download</button>}</div>;
}

/** Captures one safe media source for this mounted File id. */
export function StableMediaPreview({ file }: { file: FileRow }) {
    const source = useRef(isSafeCapabilityUrl(file.url) ? file.url : null);
    const category = filePreviewCategory(file);
    if (!source.current) return <SafeActions url={file.url} />;
    if (category === 'video') return <video className="storage-media" controls src={source.current} preload="metadata" />;
    return <audio className="storage-media storage-audio" controls src={source.current} preload="metadata" />;
}

export function FilePreview({ file }: { file: FileRow }) {
    const category = filePreviewCategory(file);
    const warned = useRef(false);
    useEffect(() => {
        if (!KNOWN.has(category) && !warned.current) {
            warned.current = true;
            console.warn(`FilePreview: unknown category "${category}" — using safe generic actions`);
        }
    }, [category]);
    if (category === 'image') return isSafeCapabilityUrl(file.url) ? <div className="storage-preview"><img src={file.url} alt={file.filename} referrerPolicy="no-referrer" /><SafeActions url={file.url} /></div> : <SafeActions url={file.url} />;
    if (category === 'video' || category === 'audio') return <div className="storage-preview"><StableMediaPreview file={file} /><SafeActions url={file.url} /></div>;
    if (['document', 'spreadsheet', 'presentation'].includes(category)) {
        const image = normalizeRenditions(file.renditions).find((row) => row.content_type.startsWith('image/') && isSafeCapabilityUrl(row.url));
        return <div className="storage-preview">{image?.url && <img src={image.url} alt={`${file.filename} preview`} referrerPolicy="no-referrer" />}<SafeActions url={file.url} /></div>;
    }
    if (category === 'archive') return <div className="storage-generic-preview"><i className="bi bi-file-earmark-zip" /><h3>{file.filename}</h3><SafeActions url={file.url} /></div>;
    if (category === 'pdf') return <div className="storage-generic-preview"><i className="bi bi-file-earmark-pdf" /><h3>PDF document</h3><SafeActions url={file.url} download={false} /></div>;
    return <div className="storage-generic-preview"><i className="bi bi-file-earmark" /><h3>{file.filename}</h3><p>{file.content_type}</p><SafeActions url={file.url} /></div>;
}
