// exportChartPng — serialize a rendered SVG chart to a PNG download.
// Ported from web-mojo src/extensions/charts/exportChart.js (77 lines, read
// in full). Framework-free and not chart-specific: pass any element that is
// or contains an <svg>.
//
// Additions over the source, both needed because portal-mojo charts style
// through theme.css CLASSES (which a serialized clone loses):
//   · computed styles are inlined onto the clone (fixed property list), so
//     token-driven fills/strokes/fonts survive serialization;
//   · the backdrop defaults to the nearest ancestor's real background color
//     (dark theme exports stay dark) instead of hardcoded white; and the
//     bitmap renders at 2x by default for crisp exports.
//
// ⚠️ Tainted-canvas caveat (carried from the source): if the SVG references
// cross-origin resources (external <image href>, remote fonts pulled in via
// <style>), the browser taints the canvas and `canvas.toDataURL` throws a
// SecurityError. portal-mojo's charts reference no external resources, so
// this only bites if you point the helper at an SVG that does — inline those
// resources before exporting.

export interface ExportChartPngOptions {
    /** Download name. Default `chart-<timestamp>.png`. */
    filename?: string;
    /**
     * Backdrop color. Default: the first non-transparent ancestor
     * background (theme-correct), falling back to white. Pass null for a
     * transparent PNG.
     */
    background?: string | null;
    /** Bitmap scale factor (2 = retina-crisp). Default 2. */
    scale?: number;
}

/** Anything that is, contains, or refs an SVG. */
export type ExportChartTarget =
    | SVGSVGElement
    | HTMLElement
    | { current: SVGSVGElement | HTMLElement | null }
    | null
    | undefined;

/** The computed properties inlined onto the clone — the set the charts use. */
const INLINE_PROPS = [
    'fill', 'fill-opacity',
    'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
    'opacity',
    'font-family', 'font-size', 'font-weight', 'letter-spacing',
    'text-anchor', 'dominant-baseline',
] as const;

function resolveSvg(target: ExportChartTarget): SVGSVGElement | null {
    const root = target != null && typeof target === 'object' && 'current' in target ? target.current : target;
    if (!root) return null;
    if (root instanceof SVGSVGElement) return root;
    return root.querySelector?.('svg') ?? null;
}

/** Walk original + clone in lockstep and stamp computed styles inline. */
function inlineComputedStyles(original: SVGSVGElement, clone: SVGSVGElement): void {
    const src: Element[] = [original, ...Array.from(original.querySelectorAll('*'))];
    const dst: Element[] = [clone, ...Array.from(clone.querySelectorAll('*'))];
    for (let i = 0; i < src.length && i < dst.length; i++) {
        const from = src[i]!;
        const to = dst[i]!;
        if (!(to instanceof SVGElement) && !(to instanceof HTMLElement)) continue;
        const computed = window.getComputedStyle(from);
        const decl: string[] = [];
        for (const prop of INLINE_PROPS) {
            const v = computed.getPropertyValue(prop);
            if (v) decl.push(`${prop}:${v}`);
        }
        if (decl.length) to.setAttribute('style', decl.join(';'));
    }
}

/** First non-transparent ancestor background, so dark exports stay dark. */
function resolveBackdrop(svg: SVGSVGElement): string {
    let node: Element | null = svg;
    while (node) {
        const bg = window.getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
        node = node.parentElement;
    }
    return '#ffffff';
}

export function exportChartPng(target: ExportChartTarget, opts: ExportChartPngOptions = {}): void {
    const svg = resolveSvg(target);
    if (!svg) {
        console.warn('exportChartPng: no <svg> found in target');
        return;
    }

    const rect = svg.getBoundingClientRect();
    const vb = svg.getAttribute('viewBox')?.split(/\s+/).map(Number);
    const width = vb && vb.length === 4 ? vb[2]! : Math.round(rect.width || 600);
    const height = vb && vb.length === 4 ? vb[3]! : Math.round(rect.height || 400);

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!clone.getAttribute('width')) clone.setAttribute('width', String(width));
    if (!clone.getAttribute('height')) clone.setAttribute('height', String(height));
    inlineComputedStyles(svg, clone);

    // data: URL (unicode-safe base64) keeps the load same-origin.
    const xml = new XMLSerializer().serializeToString(clone);
    const svg64 = btoa(unescape(encodeURIComponent(xml)));
    const dataUrl = `data:image/svg+xml;base64,${svg64}`;

    const scale = opts.scale != null && Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 2;
    const background = opts.background === undefined ? resolveBackdrop(svg) : opts.background;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.warn('exportChartPng: could not get a 2d canvas context');
            return;
        }
        if (background != null) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const png = canvas.toDataURL('image/png'); // throws here if tainted — see header note
        const a = document.createElement('a');
        a.href = png;
        a.download = opts.filename ?? `chart-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    };
    img.onerror = (err) => {
        console.error('exportChartPng: image load failed', err);
    };
    img.src = dataUrl;
}

export default exportChartPng;
