// The allowlist sanitizer — the ONE place in portal-mojo that produces a
// string destined for `dangerouslySetInnerHTML` (ui/MarkdownView.tsx).
//
// THE TRUST MODEL, in one line: server-rendered HTML is UNTRUSTED. django-mojo
// escapes raw HTML in the markdown source (mistune `render_safe`), but a
// portal must not be one backend regression away from stored XSS — so every
// byte of server HTML is re-derived here from an allowlist before it reaches
// the DOM. Nothing is trusted because of where it came from.
//
// How it works:
//   1. Parse with DOMParser('text/html') — an INERT document: no script runs,
//      no image loads, no `onerror` fires. (Assigning to a live element's
//      innerHTML would already have fetched `<img src=x onerror=...>`.)
//   2. Walk the tree. Every element is one of three things:
//        · allowlisted   → keep it, then scrub its attributes to an allowlist
//        · dangerous     → REMOVE it and its whole subtree (script/style/...)
//        · anything else → UNWRAP it: the element goes, its (already
//          sanitized) children stay. Text is never lost — which is what keeps
//          a server syntax-highlighted `<div class=highlight><span class=k>`
//          block readable after its markup is stripped.
//   3. Serialize with the browser's own serializer (`body.innerHTML`).
//
// Fail-closed everywhere: unknown attribute → dropped; unparseable URL →
// dropped; no DOM available → throws, and MarkdownView falls back to the
// React-element renderer, which cannot emit markup at all.

/** Elements that survive. Everything else is unwrapped or removed. */
const ALLOWED_TAGS = new Set([
    'p', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'strong', 'em', 'del', 'code', 'pre', 'blockquote',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    // Task lists (`- [x] ...`); constrained hard below to disabled checkboxes.
    'input',
    // Beyond the base set, because the backend's mistune plugin list emits
    // them (mark, footnote refs) and all three are inert — no URL-bearing
    // attribute, no scripting surface.
    'mark', 'sup', 'sub',
]);

/**
 * Removed WITH their subtree — for these, the text content is itself a payload
 * (CSS, script source) or the element is a script/navigation host.
 */
const DROP_SUBTREE = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'applet',
    'noscript', 'template', 'link', 'meta', 'base', 'title',
    'frame', 'frameset', 'form', 'button', 'select', 'textarea',
    // Namespaced content the HTML allowlist above cannot reason about.
    'svg', 'math',
]);

/** Per-tag attribute allowlist. `class` is handled separately (md- prefix). */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
    a: new Set(['href']),
    img: new Set(['src', 'alt']),
    input: new Set(['type', 'checked', 'disabled']),
};

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const IMG_SCHEMES = new Set(['http:', 'https:']);
/** Control + zero-width chars: `java&#9;script:` must not sneak past. */
const URL_NOISE_RE = /[\u0000-\u0020\u007F-\u009F\u200B-\u200D\u2060\uFEFF]/g;

export interface SanitizeDrop {
    /** What the sanitizer did: removed, unwrapped, or stripped a value. */
    kind: 'element' | 'unwrapped' | 'attribute' | 'url';
    detail: string;
}

/**
 * Vet a URL. Returns the cleaned value, or null to drop it.
 *
 * Order matters: NORMALIZE first (strip control/zero-width chars — that is how
 * `java&#9;script:` is smuggled), THEN allowlist the scheme. Anything without a
 * recognized scheme is dropped too: a relative link inside rendered markdown
 * would resolve against the hash router, which is never what the author meant.
 */
function vetUrl(raw: string | null | undefined, schemes: Set<string>, allowFragment: boolean): string | null {
    if (!raw) return null;
    const value = raw.replace(URL_NOISE_RE, '');
    if (!value) return null;
    // Same-document fragments cannot navigate off the page, and the server
    // renderer's footnote/TOC links are made of them.
    if (value.startsWith('#')) return allowFragment ? value : null;
    const scheme = SCHEME_RE.exec(value);
    if (!scheme) return null;
    return schemes.has(`${scheme[1]!.toLowerCase()}:`) ? value : null;
}

/** http / https / mailto / #fragment — anything else is dropped. */
export function safeLinkUrl(raw: string | null | undefined): string | null {
    return vetUrl(raw, LINK_SCHEMES, true);
}

/** http / https only — `data:image/svg+xml` is a script vector, not an image. */
export function safeImgUrl(raw: string | null | undefined): string | null {
    return vetUrl(raw, IMG_SCHEMES, false);
}

/** http/https links leave the portal — they get the noopener treatment. */
function isExternal(url: string): boolean {
    return /^https?:/i.test(url);
}

function scrubAttributes(el: Element, tag: string, onDrop?: (d: SanitizeDrop) => void): void {
    const allowed = ALLOWED_ATTRS[tag];
    for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name === 'class') {
            // Only `md-` classes survive, so a document can never reach for an
            // app class (`sidebar`, `panel`) and repaint the portal around it.
            const kept = attr.value.split(/\s+/).filter((c) => c.startsWith('md-'));
            if (kept.length) {
                el.setAttribute('class', kept.join(' '));
            } else {
                el.removeAttribute(attr.name);
                onDrop?.({ kind: 'attribute', detail: `${tag}[class="${attr.value}"]` });
            }
            continue;
        }
        // Everything not explicitly allowed: on* handlers, style, srcset,
        // formaction, xlink:href, data-*, id, ...
        if (!allowed?.has(name)) {
            el.removeAttribute(attr.name);
            onDrop?.({ kind: 'attribute', detail: `${tag}[${name}]` });
        }
    }
}

/** Per-tag value rules. @returns false when the element itself must go. */
function applyElementRules(el: Element, tag: string, onDrop?: (d: SanitizeDrop) => void): boolean {
    if (tag === 'a') {
        const raw = el.getAttribute('href');
        const href = safeLinkUrl(raw);
        if (!href) {
            if (raw !== null) onDrop?.({ kind: 'url', detail: `a[href="${raw}"]` });
            // The link TEXT stays — only the navigation goes.
            el.removeAttribute('href');
            return true;
        }
        el.setAttribute('href', href);
        if (isExternal(href)) {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
        }
        return true;
    }
    if (tag === 'img') {
        const raw = el.getAttribute('src');
        const src = safeImgUrl(raw);
        if (!src) {
            onDrop?.({ kind: 'url', detail: `img[src="${raw}"]` });
            return false; // no usable src → nothing to show
        }
        el.setAttribute('src', src);
        return true;
    }
    if (tag === 'input') {
        // Task-list checkboxes only, and never interactive: any other input in
        // rendered markdown is a phishing surface.
        if (el.getAttribute('type')?.toLowerCase() !== 'checkbox') {
            onDrop?.({ kind: 'element', detail: `input[type=${el.getAttribute('type') ?? 'text'}]` });
            return false;
        }
        el.setAttribute('disabled', '');
        return true;
    }
    return true;
}

function sanitizeChildren(parent: Element, onDrop?: (d: SanitizeDrop) => void): void {
    // Snapshot: the live child list mutates as elements are unwrapped/removed.
    for (const node of Array.from(parent.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) continue;
        if (node.nodeType !== Node.ELEMENT_NODE) {
            node.parentNode?.removeChild(node); // comments, processing instructions
            continue;
        }
        const el = node as Element;
        const tag = el.tagName.toLowerCase();

        // Non-HTML namespaces (SVG/MathML) go whole: their attribute and
        // element semantics are not what the allowlist above describes.
        if (DROP_SUBTREE.has(tag) || el.namespaceURI !== XHTML_NS) {
            el.remove();
            onDrop?.({ kind: 'element', detail: `<${tag}>` });
            continue;
        }
        if (!ALLOWED_TAGS.has(tag)) {
            sanitizeChildren(el, onDrop);                 // clean the subtree...
            el.replaceWith(...Array.from(el.childNodes)); // ...then unwrap it
            onDrop?.({ kind: 'unwrapped', detail: `<${tag}>` });
            continue;
        }
        scrubAttributes(el, tag, onDrop);
        if (!applyElementRules(el, tag, onDrop)) { el.remove(); continue; }
        sanitizeChildren(el, onDrop);
    }
}

/**
 * Reduce untrusted HTML to the markdown allowlist. Throws when there is no DOM
 * to parse with — callers must fall back to the React-element renderer rather
 * than ship unsanitized markup.
 */
export function sanitizeMarkdownHtml(html: string, onDrop?: (d: SanitizeDrop) => void): string {
    if (!html) return '';
    if (typeof DOMParser === 'undefined') throw new Error('sanitizeMarkdownHtml requires a DOM (DOMParser)');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    sanitizeChildren(doc.body, onDrop);
    return doc.body.innerHTML;
}
