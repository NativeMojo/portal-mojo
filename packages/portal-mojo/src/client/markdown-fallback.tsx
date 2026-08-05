// The client fallback renderer: markdown → REACT ELEMENTS.
//
// This path never produces an HTML string and never touches innerHTML, so
// there is nothing for a sanitizer to do on it — the only way a `<script>` in
// the source could become a script is if React rendered one, and React only
// renders elements this file names. Text is escaped by React itself.
//
// URLs are the one exception to "React makes this safe": React happily renders
// `href="javascript:..."`. Both link and image URLs go through the SAME vetting
// the sanitizer uses; a rejected link degrades to its plain text.
//
// Used whenever the server render is unavailable — offline, /api/docit/render
// missing on an older backend, an auth-gated 401, a body over the server's
// 400 KB cap, or simply not back yet (it is what MarkdownView paints on the
// first frame so the layout never jumps).
import type { ReactNode } from 'react';
import { parseMarkdown, type MdBlock, type MdInline, type MdListItem } from './markdown-parse';
import { safeImgUrl, safeLinkUrl } from './markdown-sanitize';

function inlineNodes(nodes: MdInline[], keyPrefix: string): ReactNode[] {
    return nodes.map((n, i) => {
        const key = `${keyPrefix}.${i}`;
        switch (n.t) {
            case 'text': return n.v;
            case 'br': return <br key={key} />;
            case 'code': return <code key={key}>{n.v}</code>;
            case 'strong': return <strong key={key}>{inlineNodes(n.c, key)}</strong>;
            case 'em': return <em key={key}>{inlineNodes(n.c, key)}</em>;
            case 'del': return <del key={key}>{inlineNodes(n.c, key)}</del>;
            case 'img': {
                const src = safeImgUrl(n.src);
                // Never render nothing: a rejected image keeps its alt text.
                return src ? <img key={key} src={src} alt={n.alt} /> : <span key={key}>{n.alt}</span>;
            }
            case 'link': {
                const href = safeLinkUrl(n.href);
                const children = inlineNodes(n.c, key);
                if (!href) return <span key={key}>{children}</span>;
                const external = /^https?:/i.test(href);
                return (
                    <a key={key} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                        {children}
                    </a>
                );
            }
        }
    });
}

function listItemNode(item: MdListItem, key: string): ReactNode {
    const body = item.tight
        ? item.blocks.map((b, i) => (b.t === 'para' ? inlineNodes(b.c, `${key}.${i}`) : blockNodes([b], `${key}.${i}`)))
        : blockNodes(item.blocks, key);
    return (
        <li key={key}>
            {item.task !== null && (
                // Rendered markdown is never interactive: disabled + readOnly.
                <input type="checkbox" checked={item.task} disabled readOnly />
            )}
            {item.task !== null ? ' ' : null}
            {body}
        </li>
    );
}

function blockNodes(blocks: MdBlock[], keyPrefix: string): ReactNode[] {
    return blocks.map((b, i) => {
        const key = `${keyPrefix}.${i}`;
        switch (b.t) {
            case 'heading': {
                const Tag = `h${b.level}` as 'h1';
                return <Tag key={key}>{inlineNodes(b.c, key)}</Tag>;
            }
            case 'para': return <p key={key}>{inlineNodes(b.c, key)}</p>;
            case 'hr': return <hr key={key} />;
            case 'code': return <pre key={key}><code>{b.v}</code></pre>;
            case 'quote': return <blockquote key={key}>{blockNodes(b.blocks, key)}</blockquote>;
            case 'list': {
                const items = b.items.map((item, k) => listItemNode(item, `${key}.${k}`));
                return b.ordered
                    ? <ol key={key} start={b.start !== 1 ? b.start : undefined}>{items}</ol>
                    : <ul key={key}>{items}</ul>;
            }
            case 'table':
                return (
                    <table key={key}>
                        <thead>
                            <tr>{b.head.map((cell, c) => <th key={`${key}.h${c}`}>{inlineNodes(cell, `${key}.h${c}`)}</th>)}</tr>
                        </thead>
                        <tbody>
                            {b.rows.map((row, r) => (
                                <tr key={`${key}.r${r}`}>
                                    {row.map((cell, c) => <td key={`${key}.r${r}c${c}`}>{inlineNodes(cell, `${key}.r${r}c${c}`)}</td>)}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                );
        }
    });
}

/** Markdown → React elements. No HTML string is produced anywhere on this path. */
export function markdownToNodes(source: string): ReactNode[] {
    return blockNodes(parseMarkdown(source), 'b');
}

/**
 * The fallback renderer as a component. Renders a fragment — the caller owns
 * the wrapper element (and its `md` class), so swapping in the server HTML
 * later replaces children in place rather than the container.
 */
export function MarkdownFallback({ source }: { source: string }) {
    return <>{markdownToNodes(source)}</>;
}
