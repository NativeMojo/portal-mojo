// Markdown → block AST. ONE parser, two emitters:
//
//   · `markdownToNodes` (markdown-fallback.tsx) → React elements. The client
//     fallback path — it never touches innerHTML, so nothing on it can be
//     markup at all.
//   · `markdownToHtml` (here) → an HTML STRING. Used ONLY by the mock's
//     /api/docit/render route, which stands in for django-mojo's renderer so
//     mock and live behave alike. Its output re-enters through the sanitizer
//     exactly like real server HTML — the mock does not get a trusted lane.
//
// Parity with the backend renderer (mojo/apps/docit/services/markdown.py —
// mistune, `render_safe`), which is what /api/docit/render actually runs:
//   · hard_wrap=True → a single newline inside a paragraph is a <br>.
//   · escape=True    → raw HTML in the SOURCE is escaped to text, never
//     re-emitted as markup. Both emitters here do the same by construction
//     (React escapes; markdownToHtml runs every text node through esc()).
//
// Deliberately a SUBSET of mistune: headings, paragraphs, hr, fenced code,
// blockquotes, nested/task lists, GFM tables, and inline emphasis / code /
// links / images / autolinks. Footnotes, math, abbr, spoiler and syntax
// highlighting are server-only — when the server answers you get them; on the
// fallback path they degrade to their literal text.

export type MdInline =
    | { t: 'text'; v: string }
    | { t: 'br' }
    | { t: 'code'; v: string }
    | { t: 'strong'; c: MdInline[] }
    | { t: 'em'; c: MdInline[] }
    | { t: 'del'; c: MdInline[] }
    | { t: 'link'; href: string; c: MdInline[] }
    | { t: 'img'; src: string; alt: string };

export interface MdListItem {
    /** null = a plain bullet; true/false = a `- [x]` / `- [ ]` task item. */
    task: boolean | null;
    /**
     * No blank line inside the item — its paragraphs render WITHOUT a <p>
     * wrapper, which is what keeps `- a` + a nested list on one line instead of
     * growing a paragraph's margins mid-bullet.
     */
    tight: boolean;
    blocks: MdBlock[];
}

export type MdBlock =
    | { t: 'heading'; level: number; c: MdInline[] }
    | { t: 'para'; c: MdInline[] }
    | { t: 'hr' }
    | { t: 'code'; lang: string | null; v: string }
    | { t: 'quote'; blocks: MdBlock[] }
    | { t: 'list'; ordered: boolean; start: number; items: MdListItem[] }
    | { t: 'table'; head: MdInline[][]; rows: MdInline[][][] };

// ── Block grammar ────────────────────────────────────────────────────────
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTE_RE = /^ {0,3}>[ \t]?(.*)$/;
const LIST_RE = /^([ \t]*)(?:([-*+])|(\d{1,9})[.)])[ \t]+(.*)$/;
const TABLE_DIV_RE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
/** Guards pathological nesting (a fallback must never hang the tab). */
const MAX_DEPTH = 6;

function indentOf(line: string): number {
    return line.length - line.trimStart().length;
}

/** Drop up to `n` leading spaces — list-item continuation lines. */
function dedent(line: string, n: number): string {
    let k = 0;
    while (k < n && (line[k] === ' ' || line[k] === '\t')) k++;
    return line.slice(k);
}

/**
 * What a container renders as once MAX_DEPTH is hit: its text as one
 * paragraph. Never "render nothing" — the depth guard is a performance
 * ceiling, not a reason to lose the reader's content.
 */
function depthLimitBlocks(lines: string[]): MdBlock[] {
    const text = lines.join('\n').trim();
    return text ? [{ t: 'para', c: parseInline(text) }] : [];
}

function startsBlock(line: string): boolean {
    return (
        FENCE_RE.test(line) ||
        HEADING_RE.test(line) ||
        HR_RE.test(line) ||
        QUOTE_RE.test(line) ||
        LIST_RE.test(line)
    );
}

function isTableStart(lines: string[], i: number): boolean {
    const head = lines[i]!;
    const div = lines[i + 1];
    return !!div && head.includes('|') && div.includes('-') && TABLE_DIV_RE.test(div);
}

/** Split a table row on unescaped pipes, dropping the optional outer ones. */
function splitRow(line: string): string[] {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

export function parseMarkdown(source: string, depth = 0): MdBlock[] {
    return parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'), depth);
}

function parseBlocks(lines: string[], depth: number): MdBlock[] {
    const out: MdBlock[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i]!;
        if (!line.trim()) { i++; continue; }

        const fence = FENCE_RE.exec(line);
        if (fence) {
            const closer = fence[1]![0] === '`' ? /^\s{0,3}`{3,}\s*$/ : /^\s{0,3}~{3,}\s*$/;
            const body: string[] = [];
            i++;
            while (i < lines.length && !closer.test(lines[i]!)) { body.push(lines[i]!); i++; }
            if (i < lines.length) i++; // consume the closing fence
            out.push({ t: 'code', lang: fence[2] || null, v: body.join('\n') });
            continue;
        }

        const heading = HEADING_RE.exec(line);
        if (heading) {
            out.push({ t: 'heading', level: heading[1]!.length, c: parseInline(heading[2]!) });
            i++;
            continue;
        }

        // Before the list rule: `---` is a rule, `- x` is a bullet.
        if (HR_RE.test(line)) { out.push({ t: 'hr' }); i++; continue; }

        if (QUOTE_RE.test(line)) {
            const inner: string[] = [];
            while (i < lines.length) {
                const q = QUOTE_RE.exec(lines[i]!);
                if (!q) break;
                inner.push(q[1]!);
                i++;
            }
            out.push({ t: 'quote', blocks: depth < MAX_DEPTH ? parseBlocks(inner, depth + 1) : depthLimitBlocks(inner) });
            continue;
        }

        if (isTableStart(lines, i)) {
            const head = splitRow(line).map((c) => parseInline(c));
            i += 2; // header + divider
            const rows: MdInline[][][] = [];
            while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) {
                rows.push(splitRow(lines[i]!).map((c) => parseInline(c)));
                i++;
            }
            out.push({ t: 'table', head, rows });
            continue;
        }

        const listStart = LIST_RE.exec(line);
        if (listStart) {
            const baseIndent = listStart[1]!.length;
            const ordered = !!listStart[3];
            const listLines: string[] = [];
            while (i < lines.length) {
                const cur = lines[i]!;
                if (!cur.trim()) {
                    // A blank line only ends the list when what follows it is
                    // neither a sibling marker nor indented item content.
                    let j = i + 1;
                    while (j < lines.length && !lines[j]!.trim()) j++;
                    if (j >= lines.length) break;
                    const nextMarker = LIST_RE.exec(lines[j]!);
                    const continues =
                        indentOf(lines[j]!) > baseIndent ||
                        (!!nextMarker && nextMarker[1]!.length === baseIndent);
                    if (!continues) break;
                    listLines.push('');
                    i++;
                    continue;
                }
                const marker = LIST_RE.exec(cur);
                const isSibling = !!marker && marker[1]!.length === baseIndent;
                if (!isSibling && indentOf(cur) <= baseIndent) break;
                listLines.push(cur);
                i++;
            }
            out.push({ t: 'list', ordered, start: ordered ? Number(listStart[3]) : 1, items: parseItems(listLines, baseIndent, depth) });
            continue;
        }

        // Paragraph: run to the next blank line or block start (hard_wrap
        // parity — the interior newlines become <br>, see parseInline).
        const buf: string[] = [line.trim()];
        i++;
        while (i < lines.length && lines[i]!.trim() && !startsBlock(lines[i]!) && !isTableStart(lines, i)) {
            buf.push(lines[i]!.trim());
            i++;
        }
        out.push({ t: 'para', c: parseInline(buf.join('\n')) });
    }
    return out;
}

const TASK_RE = /^\[([ xX])\]\s+(.*)$/;

function parseItems(lines: string[], baseIndent: number, depth: number): MdListItem[] {
    const items: MdListItem[] = [];
    let cur: { body: string[]; strip: number } | null = null;
    const flush = () => {
        if (!cur) return;
        const first = cur.body[0] ?? '';
        const task = TASK_RE.exec(first);
        if (task) cur.body[0] = task[2]!;
        items.push({
            task: task ? task[1]!.toLowerCase() === 'x' : null,
            tight: !cur.body.some((l) => !l.trim()),
            blocks: depth < MAX_DEPTH ? parseBlocks(cur.body, depth + 1) : depthLimitBlocks(cur.body),
        });
        cur = null;
    };
    for (const line of lines) {
        const marker = LIST_RE.exec(line);
        if (marker && marker[1]!.length === baseIndent) {
            flush();
            cur = { body: [marker[4]!], strip: marker[0]!.length - marker[4]!.length };
            continue;
        }
        if (cur) cur.body.push(dedent(line, cur.strip));
    }
    flush();
    return items;
}

// ── Inline grammar ───────────────────────────────────────────────────────
//
// Every rule is scanned over the WHOLE string (global regexes + lastIndex)
// rather than over a shrinking slice: it keeps the scan near-linear, and it
// keeps lookbehind context intact at token boundaries (`snake_case_word` must
// not become emphasis).
interface InlineRule {
    re: RegExp;
    make(m: RegExpExecArray, depth: number): MdInline;
}

const INLINE_RULES: InlineRule[] = [
    // Code first: its contents are literal, so nothing inside it is markup.
    { re: /`([^`\n]+)`/g, make: (m) => ({ t: 'code', v: m[1]! }) },
    // The URL part allows ONE level of balanced parens, so wiki-style links
    // (`.../X_(disambiguation)`) survive.
    { re: /!\[([^\]]*)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\s*\)/g, make: (m) => ({ t: 'img', src: m[2]!, alt: m[1] ?? '' }) },
    { re: /\[([^\]]*)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\s*\)/g, make: (m, d) => ({ t: 'link', href: m[2]!, c: parseInline(m[1]!, d + 1) }) },
    { re: /\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, make: (m, d) => ({ t: 'strong', c: [{ t: 'em', c: parseInline(m[1]!, d + 1) }] }) },
    { re: /\*\*(?=\S)([\s\S]*?\S)\*\*/g, make: (m, d) => ({ t: 'strong', c: parseInline(m[1]!, d + 1) }) },
    { re: /(?<![\w\\])__(?=\S)([\s\S]*?\S)__(?!\w)/g, make: (m, d) => ({ t: 'strong', c: parseInline(m[1]!, d + 1) }) },
    { re: /\*(?=\S)([^*\n]*\S|\S)\*/g, make: (m, d) => ({ t: 'em', c: parseInline(m[1]!, d + 1) }) },
    { re: /(?<![\w\\])_(?=\S)([^_\n]*\S|\S)_(?!\w)/g, make: (m, d) => ({ t: 'em', c: parseInline(m[1]!, d + 1) }) },
    { re: /~~(?=\S)([\s\S]*?\S)~~/g, make: (m, d) => ({ t: 'del', c: parseInline(m[1]!, d + 1) }) },
    { re: /<((?:https?:\/\/|mailto:)[^>\s]+)>/g, make: (m) => ({ t: 'link', href: m[1]!, c: [{ t: 'text', v: m[1]! }] }) },
    // Bare autolink (mistune's `url` plugin). The final character class keeps
    // sentence punctuation OUT of the match, so "see https://x/a." links `a`
    // and leaves the period as text.
    {
        re: /(?<![\w/@.:-])https?:\/\/[^\s<>()"']*[^\s<>()"'.,;:!?]/g,
        make: (m) => ({ t: 'link', href: m[0]!, c: [{ t: 'text', v: m[0]! }] }),
    },
];

/** Split on newlines so hard_wrap's <br> is part of the AST, not the emitter. */
function pushText(out: MdInline[], text: string): void {
    const parts = text.split('\n');
    parts.forEach((part, idx) => {
        if (idx > 0) out.push({ t: 'br' });
        if (part) out.push({ t: 'text', v: part });
    });
}

export function parseInline(text: string, depth = 0): MdInline[] {
    const out: MdInline[] = [];
    if (!text) return out;
    if (depth >= MAX_DEPTH) { pushText(out, text); return out; }

    // One live match per rule, refreshed only once the cursor passes it.
    const found: (RegExpExecArray | null)[] = INLINE_RULES.map(() => null);
    const exhausted: boolean[] = INLINE_RULES.map(() => false);
    let pos = 0;
    while (pos < text.length) {
        let bestIdx = -1;
        let best = -1;
        for (let k = 0; k < INLINE_RULES.length; k++) {
            if (exhausted[k]) continue;
            let m = found[k];
            if (!m || m.index < pos) {
                const re = INLINE_RULES[k]!.re;
                re.lastIndex = pos;
                m = re.exec(text);
                found[k] = m;
                if (!m) { exhausted[k] = true; continue; }
            }
            if (best === -1 || m.index < best) { best = m.index; bestIdx = k; }
        }
        if (bestIdx === -1) { pushText(out, text.slice(pos)); return out; }
        const m = found[bestIdx]!;
        if (m.index > pos) pushText(out, text.slice(pos, m.index));
        out.push(INLINE_RULES[bestIdx]!.make(m, depth));
        pos = m.index + m[0]!.length;
    }
    return out;
}

// ── HTML emitter (mock transport only) ───────────────────────────────────
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s: string): string {
    return s.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

function inlineHtml(nodes: MdInline[]): string {
    return nodes
        .map((n) => {
            switch (n.t) {
                case 'text': return esc(n.v);
                case 'br': return '<br>';
                case 'code': return `<code>${esc(n.v)}</code>`;
                case 'strong': return `<strong>${inlineHtml(n.c)}</strong>`;
                case 'em': return `<em>${inlineHtml(n.c)}</em>`;
                case 'del': return `<del>${inlineHtml(n.c)}</del>`;
                case 'img': return `<img src="${esc(n.src)}" alt="${esc(n.alt)}">`;
                // href is emitted verbatim (escaped) — vetting it is the
                // SANITIZER's job on the way in, same as for real server HTML.
                case 'link': return `<a href="${esc(n.href)}">${inlineHtml(n.c)}</a>`;
            }
        })
        .join('');
}

function itemHtml(item: MdListItem): string {
    const body = item.tight
        ? item.blocks.map((b) => (b.t === 'para' ? inlineHtml(b.c) : blocksHtml([b]))).join('')
        : blocksHtml(item.blocks);
    const box = item.task === null ? '' : `<input type="checkbox" disabled${item.task ? ' checked' : ''}> `;
    return `<li>${box}${body}</li>`;
}

function blocksHtml(blocks: MdBlock[]): string {
    return blocks
        .map((b) => {
            switch (b.t) {
                case 'heading': return `<h${b.level}>${inlineHtml(b.c)}</h${b.level}>`;
                case 'para': return `<p>${inlineHtml(b.c)}</p>`;
                case 'hr': return '<hr>';
                // `language-x` mirrors what a server renderer emits; the
                // sanitizer strips it (only `md-` classes survive) — see
                // markdown-sanitize.ts.
                case 'code': return `<pre><code${b.lang ? ` class="language-${esc(b.lang)}"` : ''}>${esc(b.v)}</code></pre>`;
                case 'quote': return `<blockquote>${blocksHtml(b.blocks)}</blockquote>`;
                case 'list': {
                    const tag = b.ordered ? 'ol' : 'ul';
                    const startAttr = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
                    return `<${tag}${startAttr}>${b.items.map(itemHtml).join('')}</${tag}>`;
                }
                case 'table': {
                    const head = `<thead><tr>${b.head.map((c) => `<th>${inlineHtml(c)}</th>`).join('')}</tr></thead>`;
                    const body = b.rows.map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`).join('');
                    return `<table>${head}<tbody>${body}</tbody></table>`;
                }
            }
        })
        .join('\n');
}

/**
 * Markdown → HTML string. The MOCK's stand-in for django-mojo's renderer —
 * production code never calls this: it calls `renderMarkdown` (server) or
 * renders `<MarkdownFallback>` (React elements). Raw HTML in the source is
 * escaped, matching mistune's `render_safe`.
 */
export function markdownToHtml(source: string): string {
    return blocksHtml(parseMarkdown(source));
}
