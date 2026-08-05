# markdown — server-rendered markdown + the trust model

```tsx
import { MarkdownView } from 'portal-mojo/ui';
import {
    renderMarkdown, peekMarkdown, clearMarkdownCache,
    sanitizeMarkdownHtml, safeLinkUrl, safeImgUrl,
    MarkdownFallback, markdownToNodes, markdownToHtml,
    MARKDOWN_RENDER_ENDPOINT, MAX_MARKDOWN_BYTES, type SanitizeDrop,
} from 'portal-mojo/client';
```

django-mojo owns the markdown renderer. The portal asks it instead of
shipping a second one that drifts from the docs system — and keeps a
dependency-free client renderer behind it so a missing endpoint, an offline
tab or a cold first frame still shows the document.

## `<MarkdownView>`

| Prop | Default | Meaning |
|---|---|---|
| `source` | — | The markdown text. |
| `renderer` | `'server'` | `'server'` calls `/api/docit/render` and sanitizes the answer; `'client'` never touches the wire (previews of text being typed; feeds that must not fan out one request per item). |
| `debounceMs` | `0` | Wait this long after `source` stops changing before calling the server. Set it for text that grows token by token (a streaming assistant reply) so one reply is one request. |
| `className` | — | Extra classes on the wrapper. `md` is always present. |

Renders one `<div class="md">`. Styling lives in the consuming app —
`apps/portal/src/theme/markdown.css`, tokens only, both themes; both render
paths emit the same element set, so one stylesheet dresses both.

### No loading jump, by construction

1. Source already rendered? The module cache answers **synchronously** — the
   server HTML is on the first frame, no request, no transition.
2. Otherwise the **client fallback paints immediately** (real content at
   roughly the right height, `aria-busy`, class `md-pending`), and the server
   HTML swaps in under the same wrapper when it lands.
3. If the render fails, the fallback simply stays, with one `console.warn`
   saying why.

There is no spinner and no empty state at any point. `md-pending` fades in
after a 250 ms delay, so a fast answer never flickers and a slow one never
moves.

## Wire contract

`mojo/apps/docit/rest/render.py` — read, not assumed:

```
POST /api/docit/render     {markdown: string}     @requires_auth
→ {status: true, code: 200, data: {html: string}}
```

The handler returns a bare dict, so `mojo/decorators/http.py` wraps it into
the standard envelope — unwrapped at the **one boundary** (`mojoCall`). Do
not reintroduce web-mojo's `resp.data.data.html || resp.data.html` sniff; it
existed in three copies there and is on the do-not-recreate list.

Errors: `400` markdown field is required · `405` non-POST · `413` over
`MAX_MARKDOWN_BYTES` (400 000 bytes; `renderMarkdown` rejects locally rather
than spend a round trip on a guaranteed 413).

The server runs mistune with `hard_wrap=True` (a single newline is a `<br>`)
and `escape=True` (raw HTML in the SOURCE becomes text). Its plugin set adds
tables, task lists, strikethrough, footnotes, abbr, mark, math, spoiler and
pygments syntax highlighting.

The mock (`client/mock.ts`) answers the same route with the same envelope and
the same error codes, running the client parser as its renderer — so mock and
live differ in fidelity, never in shape. **The mock's HTML goes through the
sanitizer exactly like a real backend's. There is no trusted lane.**

## THE TRUST MODEL

> **Server HTML is untrusted.** django-mojo escapes raw HTML in the markdown
> source, but a portal must not be one backend regression away from stored
> XSS. Nothing is trusted because of where it came from.

Two render paths, two different guarantees:

### Path A — server HTML → `sanitizeMarkdownHtml` → `dangerouslySetInnerHTML`

`MarkdownView` is the **only** sanctioned `dangerouslySetInnerHTML` in
portal-mojo, and the only string it can ever receive is the return value of
`renderMarkdown`, which sanitizes *before it resolves*. Unsanitized server
HTML never leaves `client/markdown.ts`, so no caller can hold it.

The sanitizer (`client/markdown-sanitize.ts`):

1. Parses with `DOMParser('text/html')` — an **inert** document: no script
   runs, no image loads, no `onerror` fires. (Assigning to a live element's
   `innerHTML` would already have fetched `<img src=x onerror=…>`.)
2. Walks the tree. Every element is one of three things:
   - **allowlisted** → kept, attributes then scrubbed to an allowlist
   - **dangerous** → removed **with its whole subtree**
   - **anything else** → **unwrapped**: the element goes, its (already
     sanitized) children stay. Text is never lost — which is what keeps a
     pygments `<div class=highlight><span class=k>` block readable after its
     markup is stripped.
3. Serializes with the browser's own serializer (`body.innerHTML`).

| | Set |
|---|---|
| **Kept** | `p br hr h1-h6 ul ol li strong em del code pre blockquote a img table thead tbody tr th td input mark sup sub` |
| **Removed with subtree** | `script style iframe object embed applet noscript template link meta base title frame frameset form button select textarea svg math` — plus any element outside the XHTML namespace |
| **Unwrapped** | everything else (`div span section sup-wrappers …`) |
| **Attributes kept** | `a[href]`, `img[src alt]`, `input[type checked disabled]`, and `class` — **`md-` prefixed values only** |
| **Attributes dropped** | every other attribute, which is how `on*` handlers, `style`, `srcset`, `formaction`, `xlink:href`, `id` and `data-*` all go |

Value rules on top of the attribute allowlist:

- `a[href]` — `http:` / `https:` / `mailto:` / `#fragment` only. Rejected
  hrefs are removed but the **link text stays** (never render nothing).
  `http(s)` links are rewritten with `target="_blank" rel="noopener noreferrer"`.
- `img[src]` — `http:` / `https:` only. `data:image/svg+xml` is a script
  vector, not an image. An image with no usable `src` is dropped entirely.
- `input` — must be `type=checkbox` (task lists); anything else is a phishing
  surface and is dropped. `disabled` is forced on, `checked` is preserved.
- URL vetting **normalizes first, then allowlists**: control and zero-width
  characters are stripped (that is how `java&#9;script:` is smuggled) and
  only then is the scheme matched. Unrecognized or scheme-less → dropped.

### Path B — the client fallback → React elements

`MarkdownFallback` / `markdownToNodes` emit React elements directly. No HTML
string is produced and `innerHTML` is never touched, so there is nothing for
a sanitizer to do: the only way a `<script>` in the source could become a
script is if React rendered one, and React only renders the elements that
file names. Text is escaped by React itself.

**The one thing React does not make safe is URLs** — it will happily render
`href="javascript:…"`. Both link and image URLs on this path go through the
*same* `safeLinkUrl` / `safeImgUrl` used by the sanitizer; a rejected link
degrades to plain text, a rejected image to its alt text.

### Consequences worth knowing

- Server syntax highlighting **survives as text, not colour**: pygments
  classes are not `md-` prefixed, so they are stripped and the wrappers
  unwrapped. Shipping a monokai stylesheet would fight both themes.
- Table alignment from the server is lost (`style="text-align:…"` is an
  attribute drop).
- **Relative links and images are dropped** — inside a hash-routed portal
  they resolve against the current route, which is never what the author
  meant. Use absolute `https://` URLs in markdown that the portal renders.
- `mark`, `sup` and `sub` are on the allowlist beyond the base set because
  the backend's plugin list emits them and all three are inert.

## `renderMarkdown(source)`

Returns the **sanitized** HTML for `source`.

- **REJECTS on any failure** — endpoint missing, offline, 401, oversized
  body, a response without `html`, no DOM to sanitize with. It never resolves
  a fallback as success: the fallback path renders React *elements*, so a
  string could not say which renderer produced it. The fallback decision
  belongs to the component.
- **Cached** in a module-level `Map` keyed by an FNV-1a hash of the source
  plus its length. Every entry stores its source and is verified on hit, so a
  hash collision costs a re-render, never a wrong document. 200 entries,
  oldest evicted.
- **Single-flight**: two mounts of the same message are one request. A chat
  feed re-rendering 50 cached messages is zero.

`peekMarkdown(source)` reads the cache synchronously (`null` on a miss) —
that is what lets a cache hit paint on the first frame.
`clearMarkdownCache()` drops it.

## Files

| File | Job |
|---|---|
| `ui/MarkdownView.tsx` | the component; the one `dangerouslySetInnerHTML` |
| `client/markdown.ts` | the wire call, cache, single-flight, size guard; public re-exports |
| `client/markdown-sanitize.ts` | the allowlist sanitizer — the security boundary |
| `client/markdown-parse.ts` | markdown → block AST, plus the HTML emitter the **mock** uses |
| `client/markdown-fallback.tsx` | AST → React elements (the fallback path) |
| `apps/portal/src/theme/markdown.css` | `.md` styling, tokens only, both themes |

## Fallback coverage

One parser feeds both the React emitter and the mock's HTML emitter, so what
you see under the mock is what the fallback renders live: headings,
paragraphs (hard-wrap `<br>`), `hr`, fenced code, blockquotes, nested and
task lists, GFM tables (including escaped `\|`), bold/italic/bold-italic
(`*` and `_`, with `snake_case_words` left alone), inline code,
strikethrough, links, images, `<autolinks>` and bare URLs.

Server-only, and degrading to their literal text on the fallback path:
footnotes, math, abbr, spoiler, syntax highlighting.

## Pitfalls

- **Do not add a second `dangerouslySetInnerHTML`.** If you need to show
  rendered markdown, use `MarkdownView`; if you need to show what the
  sanitizer produced, show it as text (the playground demo does).
- **Do not pass user HTML to `MarkdownView`** — pass *markdown*. Raw HTML in
  the source is escaped to text by both renderers, deliberately.
- Don't call `renderMarkdown` in a render body; it is a promise. The
  component already owns the lifecycle.
- One request per distinct source, not per component: with a streaming
  source set `debounceMs`, or render `renderer="client"` while it streams and
  switch to `'server'` once it settles.
