// Markdown rendering, the platform way: django-mojo owns the renderer, so the
// portal asks it instead of shipping a second one that drifts.
//
// Wire contract — mojo/apps/docit/rest/render.py, verified against the source:
//   POST /api/docit/render   {markdown: string}     (@requires_auth)
//   → the handler returns a bare dict, so mojo/decorators/http.py wraps it:
//     {status: true, code: 200, data: {html: string}}
//   → errors: 400 `markdown field is required`, 405 non-POST,
//     413 over MAX_MARKDOWN_BYTES.
// Unwrapped at the ONE boundary (mojoCall) like every other endpoint — no
// `resp.data.data.html || resp.data.html` sniffing, which is what web-mojo's
// three copies of this call did (do-not-recreate list).
//
// What this module guarantees to its callers:
//   · The string it resolves is SANITIZED (markdown-sanitize.ts). Unsanitized
//     server HTML never leaves this file, so there is no way to hold it.
//   · A failure REJECTS. The fallback decision belongs to the component,
//     because the fallback path renders React ELEMENTS, not a string —
//     "resolve the fallback as success" would hand back a string that no
//     longer says which renderer produced it.
//   · Identical sources are rendered once: an in-memory cache plus in-flight
//     de-duplication, so a chat feed re-rendering 50 messages is 0 requests
//     and two mounts of the same message are 1.
import { mojoCall } from './client';
import { MojoError } from './errors';
import { sanitizeMarkdownHtml } from './markdown-sanitize';

export { sanitizeMarkdownHtml, safeLinkUrl, safeImgUrl, type SanitizeDrop } from './markdown-sanitize';
export { MarkdownFallback, markdownToNodes } from './markdown-fallback';
export { markdownToHtml, parseMarkdown, type MdBlock, type MdInline } from './markdown-parse';

export const MARKDOWN_RENDER_ENDPOINT = '/api/docit/render';
/** The server's own cap (rest/render.py) — over it, skip a guaranteed 413. */
export const MAX_MARKDOWN_BYTES = 400_000;
/** Enough for a long chat scrollback; oldest entries fall off the end. */
const CACHE_LIMIT = 200;

interface CacheEntry { source: string; html: string }

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, { source: string; p: Promise<string> }>();

/**
 * FNV-1a over the source, suffixed with its length. The key is only an index:
 * every entry stores its source and is verified on hit, so a hash collision
 * costs a re-render, never a wrong document.
 */
function cacheKey(source: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < source.length; i++) {
        h ^= source.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return `${(h >>> 0).toString(36)}:${source.length}`;
}

function remember(key: string, source: string, html: string): void {
    if (cache.size >= CACHE_LIMIT) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, { source, html });
}

function utf8Bytes(source: string): number {
    // UTF-8 is at most 4 bytes per UTF-16 code unit — skip the encode when the
    // answer cannot possibly exceed the cap.
    if (source.length * 4 <= MAX_MARKDOWN_BYTES) return source.length;
    return new TextEncoder().encode(source).length;
}

/** Sanitized HTML for this source if it has already been rendered — else null. */
export function peekMarkdown(source: string): string | null {
    if (!source) return null;
    const hit = cache.get(cacheKey(source));
    return hit && hit.source === source ? hit.html : null;
}

/** Drop the memo (demos, tests, a backend swap mid-session). */
export function clearMarkdownCache(): void {
    cache.clear();
}

/**
 * Render markdown on the server and sanitize the result.
 *
 * REJECTS on any failure (endpoint missing, offline, 401, oversized body, a
 * response without `html`, or no DOM to sanitize with). Callers render
 * `<MarkdownFallback source>` instead — see ui/MarkdownView.tsx.
 */
export function renderMarkdown(source: string): Promise<string> {
    if (!source.trim()) return Promise.resolve('');

    const key = cacheKey(source);
    const hit = cache.get(key);
    if (hit && hit.source === source) return Promise.resolve(hit.html);

    const pending = inflight.get(key);
    if (pending && pending.source === source) return pending.p;

    if (utf8Bytes(source) > MAX_MARKDOWN_BYTES) {
        return Promise.reject(new MojoError('markdown input too large', 413));
    }

    const p = (async () => {
        const body = await mojoCall(MARKDOWN_RENDER_ENDPOINT, { method: 'POST', body: { markdown: source } });
        const html = (body.data as { html?: unknown } | undefined)?.html;
        if (typeof html !== 'string') throw new MojoError('docit/render returned no html', 0);
        const safe = sanitizeMarkdownHtml(html);
        remember(key, source, safe);
        return safe;
    })();

    // Only the registered promise clears the slot — a colliding key that was
    // never registered must not evict someone else's in-flight render.
    const slot = { source, p };
    inflight.set(key, slot);
    void p.catch(() => undefined).then(() => {
        if (inflight.get(key) === slot) inflight.delete(key);
    });
    return p;
}
