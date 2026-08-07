import { useEffect, useMemo, useState } from 'react';
import { ImageEditor, imageEditorModal, type ImageEditorResult } from 'portal-mojo/ui';

function fixture(): Blob {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
        <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#2f6bdf"/><stop offset="1" stop-color="#d9a441"/></linearGradient></defs>
        <rect width="640" height="420" fill="#11161d"/><rect x="34" y="34" width="572" height="352" rx="28" fill="url(#g)"/>
        <circle cx="210" cy="210" r="108" fill="#fff" fill-opacity=".82"/><path d="M355 310 445 126l92 184z" fill="#0a0d11" fill-opacity=".72"/>
        <text x="320" y="374" text-anchor="middle" font-family="system-ui" font-size="24" fill="#fff">source pixels · 640 × 420</text>
    </svg>`;
    return new Blob([svg], { type: 'image/svg+xml' });
}

function ResultPreview({ result }: { result: ImageEditorResult | null }) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!result) { setUrl(null); return; }
        const next = URL.createObjectURL(result.blob);
        setUrl(next);
        return () => URL.revokeObjectURL(next);
    }, [result]);
    if (!result) return <p className="dim">Save an edit to inspect the explicit PNG result.</p>;
    return <div className="image-editor-demo-result">
        {url && <img src={url} alt="Saved editor result" />}
        <div><strong>{result.filename}</strong><br /><span className="dim">{result.width} × {result.height}px · {result.operations.map((operation) => operation.kind).join(' → ') || 'original'}</span></div>
    </div>;
}

export function ImageEditorDemo() {
    const source = useMemo(fixture, []);
    const [result, setResult] = useState<ImageEditorResult | null>(null);
    const openModal = async () => {
        const edited = await imageEditorModal(source, {
            title: 'Exact avatar crop', filename: 'showcase-avatar.png', startMode: 'crop',
            crop: { aspectRatio: 1, cropAndScale: { width: 200, height: 200 } },
        });
        if (edited) setResult(edited);
    };
    return <div className="demo-stack">
        <section className="panel panel-pad">
            <div className="eyebrow">Controlled editor</div>
            <p className="dim">Transform, crop, and filters compose chronologically at full source resolution. Apply/mode-switch commits history; sliders and drags coalesce.</p>
            <ImageEditor source={source} filename="showcase-edit.png" onSave={setResult} />
        </section>
        <section className="panel panel-pad">
            <div className="eyebrow">Awaitable modal + exact avatar output</div>
            <p className="dim">Cancel returns null. Save returns a PNG Blob and metadata; it never downloads automatically.</p>
            <button type="button" className="btn btn-primary" onClick={() => void openModal()}>Open 200 × 200 crop</button>
            <ResultPreview result={result} />
        </section>
    </div>;
}
