// MarkdownView — render markdown the platform way: django-mojo's docit
// renderer does the work, an allowlist sanitizer vets the answer, and a
// dependency-free client renderer covers everything else.
//
// The one sanctioned `dangerouslySetInnerHTML` in portal-mojo lives here, and
// the ONLY string it can ever receive is the output of `renderMarkdown`, which
// sanitizes before it resolves (client/markdown-sanitize.ts spells out the
// trust model). Everything else on screen is React elements.
//
// No loading jump, by construction:
//   1. Already rendered this exact source? The cache answers synchronously and
//      the server HTML is on the FIRST frame — no request, no transition.
//   2. Otherwise the client fallback paints immediately (real content at
//      roughly the right height, marked `aria-busy`), and the server HTML
//      swaps in underneath the same wrapper when it lands.
//   3. If the render fails, the fallback simply stays — with one console.warn
//      saying why. There is no empty state and no spinner at any point.
import { useEffect, useState } from 'react';
import { MarkdownFallback, peekMarkdown, renderMarkdown } from '../client/markdown';

export interface MarkdownViewProps {
    /** The markdown source. */
    source: string;
    /**
     * 'server' (default) asks /api/docit/render and sanitizes the answer;
     * 'client' never touches the wire — for previews of text being typed, and
     * for surfaces that must not fan out one request per item.
     */
    renderer?: 'server' | 'client';
    /**
     * Wait this long after the source stops changing before calling the server.
     * Leave at 0 for static content; set it for text that grows token by token
     * (a streaming assistant reply) so one reply is one request, not hundreds.
     */
    debounceMs?: number;
    /** Extra classes on the wrapper; `md` is always present. */
    className?: string;
}

export function MarkdownView({ source, renderer = 'server', debounceMs = 0, className }: MarkdownViewProps) {
    const [served, setServed] = useState<{ source: string; html: string } | null>(null);
    const [failedFor, setFailedFor] = useState<string | null>(null);

    // Derived, never mirrored into state: a cache hit must win on the first
    // frame, and it must re-evaluate when `source` changes. In client mode it
    // is always null — flipping to 'client' must not keep showing server HTML
    // that a previous 'server' pass had already resolved.
    const html =
        renderer === 'server'
            ? peekMarkdown(source) ?? (served?.source === source ? served.html : null)
            : null;

    useEffect(() => {
        if (renderer !== 'server' || !source.trim()) return;
        if (peekMarkdown(source) !== null) return;

        let cancelled = false;
        const run = () => {
            renderMarkdown(source).then(
                (out) => { if (!cancelled) setServed({ source, html: out }); },
                (err: unknown) => {
                    if (cancelled) return;
                    // The fallback is already on screen — this only records why
                    // it is what the reader is looking at.
                    console.warn('[MarkdownView] server render failed, keeping the client fallback:', err);
                    setFailedFor(source);
                },
            );
        };

        if (debounceMs > 0) {
            const timer = setTimeout(run, debounceMs);
            return () => { cancelled = true; clearTimeout(timer); };
        }
        run();
        return () => { cancelled = true; };
    }, [source, renderer, debounceMs]);

    const pending = renderer === 'server' && !!source.trim() && html === null && failedFor !== source;
    const cls = ['md', pending ? 'md-pending' : null, className].filter(Boolean).join(' ');

    // Sanitized at its source (renderMarkdown) — see the trust model above.
    if (html !== null) return <div className={cls} dangerouslySetInnerHTML={{ __html: html }} />;
    return (
        <div className={cls} aria-busy={pending || undefined}>
            <MarkdownFallback source={source} />
        </div>
    );
}
