// DataView — point it at any record and get a sensible detail grid.
// Port of web-mojo src/core/views/data/DataView.js (1,153 lines).
//
//   CREATED                    LAST LOGIN              STORAGE USED
//   Apr 21, 2026               3 weeks ago             1.5 GB
//   EMAIL                      IS ACTIVE               PROFILE
//   ian@nativemojo.com         [ Yes ]                 ┌ nested DataView ┐
//
// Two modes:
//   · `fields` given  → an explicit schema (label, dotted path, type/format)
//   · `fields` absent → EVERY key of the record, typed by inference
//
// The ~250 lines of inference heuristics below are the institutional knowledge
// this port exists to preserve: a field NAME plus its value picks the renderer
// (`*_at`/`created` → date, `*email*` → mailto, `*_size` → filesize, …).
//
// Deviations from source, all deliberate:
//   1. The string-pipe engine is gone (do-not-recreate: `"date('MMM D')|
//      capitalize"` defeats the type checker and passed unknown formatters
//      through silently). `inferFormatter` returned pipe strings; here the same
//      branches choose TYPED `fmt.*` calls or small ReactNode renderers.
//      Consequences of that mapping, since `fmt` has one shape per concept:
//        · `date("MMM D, YYYY")` and `date("MMMM D, YYYY")` both → `fmt.date`
//        · `time` → `fmt.datetime` (a bare wall-clock time with no date is
//          ambiguous, and `fmt` deliberately ships no `time`)
//        · `capitalize` → the house `.cap` class — CSS capitalization does not
//          mutate the underlying value
//   2. Trusted HTML is gone (architecture rule 6). The source built every value
//      as an HTML string and ran a 5-regex "syntax highlighter" over escaped
//      JSON; here values are ReactNode and JSON is tokenized into real spans.
//      No `dangerouslySetInnerHTML` anywhere.
//   3. `showEmptyValues` defaults to TRUE. The source dropped a row whose value
//      was empty, so a record's shape changed with its data; the house rule
//      (KnownFieldsCard) shows `—` and hides only on an explicit opt-out.
//   4. Bug fixes over the source's inference, each marked BUGFIX below.
//
// Relationship to KnownFieldsCard: that one takes a BLOB and promotes a curated
// list of known keys (everything else stays in the raw `<details>`); this one
// takes a WHOLE RECORD and infers every field. A detail page often wants both —
// DataView for the record, KnownFieldsCard for its `metadata` column.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as fmt from '../format';
import { safeNode } from '../safe-node';
import { Badge } from '../ui';
import { toast } from '../toast';

/** The renderer vocabulary. `type` on a field names one of these directly. */
export type DataFieldType =
    | 'datetime' | 'date' | 'email' | 'url' | 'phone' | 'currency' | 'filesize'
    | 'percent' | 'number' | 'boolean' | 'text' | 'array' | 'object' | 'dataview' | 'file';

const FIELD_TYPES = new Set<string>([
    'datetime', 'date', 'email', 'url', 'phone', 'currency', 'filesize',
    'percent', 'number', 'boolean', 'text', 'array', 'object', 'dataview', 'file',
]);

export interface DataViewField {
    /**
     * Key in the record. Dotted paths traverse nested objects (`os.family`);
     * an own property of that literal name wins (same rule as KnownFieldsCard).
     */
    name: string;
    /** Row label; defaults to the humanized last path segment. */
    label?: string;
    /** Force a renderer instead of inferring one. Unknown values warn + infer. */
    type?: DataFieldType;
    /** Replaces the renderer entirely — return any node. */
    format?: (value: unknown, name: string, data: Record<string, unknown>) => ReactNode;
    /** `full` spans the grid; `auto` (default) is full only for JSON/nested. */
    span?: 'auto' | 'full';
    /** Drop the row when the value is empty (default: render `—`). */
    hideEmpty?: boolean;
    className?: string;
}

export interface DataViewProps {
    /** The record. Plain object — models are definitions here, not instances. */
    data: Record<string, unknown> | null | undefined;
    /** Explicit schema. Omit for full inference over `Object.keys(data)`. */
    fields?: DataViewField[];
    /** Keys to drop. Applies in BOTH modes. */
    exclude?: string[];
    /** Grid columns at full width (default 2); narrow containers collapse to 1. */
    columns?: number;
    /** `false` restores the source behavior: an empty value drops its row. */
    showEmptyValues?: boolean;
    /** Rendered for an empty value (default `—`). */
    emptyValueText?: string;
    /** Shown when the record has no renderable fields at all. */
    emptyText?: string;
    /**
     * How many levels of NESTED DataView to render below this one (default 2).
     * Deeper objects fall back to a collapsed JSON block, so a cyclic-looking
     * or absurdly deep payload can never blow the render stack.
     */
    maxDepth?: number;
    /** Internal — the current nesting level. Callers leave this at 0. */
    depth?: number;
}

// ============================================================ key analysis

/** snake / kebab / camel → lowercase word tokens: `lastLoginAt` → last, login, at. */
function tokenize(key: string): string[] {
    return key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((t) => t.toLowerCase());
}

/**
 * Exact-token match. BUGFIX: the source tested every needle with `includes()`,
 * so short ones matched inside unrelated words — `duration` contains "ratio"
 * (→ percent: 8040 rendered as 804,000%), `generated` contains "rate", `hotel`
 * contains "tel" (→ a tel: link). Long, unambiguous needles (`created`,
 * `email`, `website`) still use the source's substring test.
 */
function hasWord(tokens: string[], ...words: string[]): boolean {
    return words.some((w) => tokens.includes(w));
}

/** `created_at` → "Created At"; `lastLogin` → "Last Login". Source verbatim. */
export function formatLabel(name: string): string {
    return name
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b\w/g, (l) => l.toUpperCase())
        .trim();
}

const BOOL_PREFIXES = new Set(['is', 'has', 'can', 'should']);

// Warnings fire from a render path, so a 40-field record re-rendering on every
// keystroke would flood the console. One warning per distinct message — the
// same discipline format.ts uses.
const warned = new Set<string>();
function warnOnce(message: string, ...extra: unknown[]): void {
    if (warned.has(message)) return;
    warned.add(message);
    console.warn(message, ...extra);
}

/** Value shapes that read as a boolean on the wire (django-mojo sends 0/1). */
function isBooleanish(value: unknown): boolean {
    if (typeof value === 'boolean') return true;
    if (value === 0 || value === 1) return true;
    return typeof value === 'string' && /^(true|false|yes|no)$/i.test(value.trim());
}

/**
 * Objects worth a nested DataView instead of a JSON dump. Ported from the
 * source's `shouldUseDataView`, including its size window and the
 * "one deep child disqualifies the whole object" rule.
 */
export function shouldUseDataView(value: unknown, keyLower: string): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const obj = value as Record<string, unknown>;

    // Source gated this on `window.utils.isObject` — a global that is simply
    // absent in half of web-mojo's own entry points. The intent survives: an
    // object carrying an `id` is a RELATED RECORD, so it gets a record grid.
    if (obj.id != null) return true;

    const matches = DATAVIEW_KEY_PATTERNS.some((p) => keyLower.includes(p));
    if (!matches) return false;

    const keys = Object.keys(obj);
    if (keys.length < 2 || keys.length > 20) return false;
    const hasComplexNesting = keys.some((k) => {
        const child = obj[k];
        return typeof child === 'object' && child !== null && !Array.isArray(child)
            && Object.keys(child as Record<string, unknown>).length > 3;
    });
    return !hasComplexNesting;
}

const DATAVIEW_KEY_PATTERNS = [
    'permissions', 'perms', 'access', 'rights',
    'settings', 'config', 'configuration', 'options',
    'profile', 'info', 'details', 'data',
    'metadata', 'meta', 'attributes', 'props',
    'preferences', 'prefs', 'user_data',
    'contact', 'address', 'location',
    'stats', 'statistics', 'metrics', 'counts',
];

/**
 * Field NAME + value → renderer. The source's `inferFieldType`, branch for
 * branch, with the fixes noted inline. Never throws; unknown shapes → 'text'.
 */
export function inferFieldType(value: unknown, key = ''): DataFieldType {
    if (value === null || value === undefined) return 'text';

    const k = key.toLowerCase();
    const tokens = tokenize(key);
    const type = typeof value;

    // BUGFIX (hoisted): the source tested `typeof value === 'boolean'` AFTER the
    // whole name chain, so `is_email_verified: true` matched "email" and
    // rendered `mailto:true`. A boolean is never a date, an email or a URL.
    if (type === 'boolean') return 'boolean';
    // EXTENSION: `is_*` / `has_* `/ `can_*` / `should_*` carrying a wire boolean
    // (0/1, "true"/"false"). The value guard keeps `has_permissions: {…}` an
    // object and `is_expires_at: 1712…` out of the boolean bucket.
    if (tokens.length > 1 && BOOL_PREFIXES.has(tokens[0]!) && isBooleanish(value)) return 'boolean';

    // Date/time patterns. EXTENSION: a trailing `_at` token — the django-mojo
    // timestamp convention the source predates (`sent_at`, `resolved_at`).
    if (k.includes('date') || k.includes('time') || k.includes('created') || k.includes('updated')
        || k.includes('modified') || k.includes('last_login') || k.includes('expires')
        || k.includes('last_activity') || tokens[tokens.length - 1] === 'at') {
        return 'datetime';
    }
    if (k.includes('email') || k.includes('mail')) return 'email';
    if (k.includes('url') || hasWord(tokens, 'link') || k.includes('website') || k.includes('homepage')) return 'url';
    if (k.includes('phone') || hasWord(tokens, 'tel') || k.includes('mobile') || hasWord(tokens, 'cell')) return 'phone';
    if (k.includes('price') || hasWord(tokens, 'cost') || k.includes('amount') || hasWord(tokens, 'fee')
        || k.includes('salary') || k.includes('revenue')) {
        return 'currency';
    }
    if (hasWord(tokens, 'size', 'bytes', 'filesize')) return 'filesize';
    // BUGFIX: the source wrote `percent || rate || ratio && number`, and `&&`
    // binds tighter — so `rate` matched on ANY type. The number guard now
    // covers the whole branch (a percentage of a string is meaningless).
    if ((k.includes('percent') || hasWord(tokens, 'rate', 'ratio')) && type === 'number') return 'percent';

    if (type === 'number') return 'number';

    if (type === 'object') {
        if (Array.isArray(value)) return 'array';
        if ((value as Record<string, unknown>).renditions) return 'file';
        if (shouldUseDataView(value, k)) return 'dataview';
        return 'object';
    }

    if (type === 'string') {
        const s = value as string;
        if (s.includes('@') && s.includes('.')) return 'email';
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'date';
        if (/^https?:\/\//.test(s)) return 'url';
        // BUGFIX: the source's bare `/^\+?[\d\s\-()]+$/` turned "42" and "2024"
        // into tel: links. A phone number has at least 7 digits.
        if (/^\+?[\d\s\-()]+$/.test(s) && s.replace(/\D/g, '').length >= 7) return 'phone';
    }

    return 'text';
}

// ============================================================ JSON viewer

type JsonTokenClass = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'plain';
interface JsonToken { text: string; cls: JsonTokenClass }

const WS = new Set([' ', '\n', '\t', '\r']);

/**
 * Real tokenizer over pretty-printed JSON — keys, string values, numbers,
 * booleans, null; everything else is structural. The source ran five regexes
 * over an HTML-escaped string and injected `<span style>` (so `{"a": "x: 1"}`
 * mis-colored, and the whole thing was `innerHTML`). This emits React spans,
 * which is why architecture rule 6 holds here for free.
 */
export function tokenizeJson(text: string): JsonToken[] {
    const out: JsonToken[] = [];
    let plain = '';
    const flush = () => {
        if (plain) { out.push({ text: plain, cls: 'plain' }); plain = ''; }
    };

    let i = 0;
    while (i < text.length) {
        const ch = text[i]!;

        if (ch === '"') {
            let j = i + 1;
            while (j < text.length) {
                const c = text[j]!;
                if (c === '\\') { j += 2; continue; }
                j++;
                if (c === '"') break;
            }
            // A string is a KEY iff the next non-space character is a colon.
            let k = j;
            while (k < text.length && WS.has(text[k]!)) k++;
            flush();
            out.push({ text: text.slice(i, j), cls: text[k] === ':' ? 'key' : 'string' });
            i = j;
            continue;
        }

        if (ch === '-' || (ch >= '0' && ch <= '9')) {
            const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
            if (m) { flush(); out.push({ text: m[0], cls: 'number' }); i += m[0].length; continue; }
        }
        if (text.startsWith('true', i) || text.startsWith('false', i)) {
            const lit = text[i] === 't' ? 'true' : 'false';
            flush(); out.push({ text: lit, cls: 'boolean' }); i += lit.length; continue;
        }
        if (text.startsWith('null', i)) { flush(); out.push({ text: 'null', cls: 'null' }); i += 4; continue; }

        plain += ch;
        i++;
    }
    flush();
    return out;
}

function CopyButton({ text, title = 'Copy JSON' }: { text: string; title?: string }) {
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const copy = () => {
        // `navigator.clipboard` is undefined outside a secure context. The
        // source's document.execCommand fallback is deprecated and silently
        // no-ops in modern browsers — say so instead of pretending to copy.
        const clip = navigator.clipboard as Clipboard | undefined;
        if (!clip) { toast.error('Clipboard unavailable in this context'); return; }
        clip.writeText(text).then(
            () => {
                setCopied(true);
                toast.success('JSON copied to clipboard');
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(() => setCopied(false), 1200);
            },
            (err: unknown) => toast.error(`Copy failed: ${err instanceof Error ? err.message : String(err)}`),
        );
    };

    return (
        <button
            type="button"
            className={`btn-icon btn-icon-sm json-block-copy${copied ? ' json-block-copied' : ''}`}
            onClick={copy}
            title={title}
            aria-label={title}
        >
            <i className={`bi ${copied ? 'bi-check2' : 'bi-clipboard'}`} />
        </button>
    );
}

export interface JsonBlockProps {
    /** Anything JSON-serializable. Circular payloads degrade, never throw. */
    value: unknown;
    /** Overrides the caption ("Object" / "Array · 12 lines"). */
    label?: string;
    /** Force the collapse affordance. Default: >10 lines or >500 chars (source). */
    collapsible?: boolean;
    /** When collapsible, start expanded. */
    defaultOpen?: boolean;
}

/**
 * Pretty-printed JSON with syntax highlighting, copy-to-clipboard and (for big
 * payloads) a one-line preview behind a Show/Hide toggle. Exported because a
 * raw-JSON panel is useful on its own, not only as a DataView cell.
 */
export function JsonBlock({ value, label, collapsible, defaultOpen = false }: JsonBlockProps) {
    const [open, setOpen] = useState(defaultOpen);

    let json: string;
    try {
        json = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
        // Circular structures land here — the source returned a muted note too.
        return <span className="dim-italic">[{Array.isArray(value) ? 'Array' : typeof value}] — cannot display as JSON</span>;
    }

    const lines = json.split('\n').length;
    const isLarge = collapsible ?? (lines > 10 || json.length > 500);
    const caption = label ?? `${Array.isArray(value) ? 'Array' : 'Object'}${isLarge ? ` · ${lines} lines` : ''}`;
    const flat = JSON.stringify(value) ?? '';
    const preview = flat.length > 100 ? `${flat.slice(0, 100)}…` : flat;

    return (
        <div className="json-block">
            <div className="json-block-head">
                <span className="json-block-caption">{caption}</span>
                <div className="json-block-actions">
                    {isLarge && (
                        <button type="button" className="btn btn-compact json-block-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                            <i className={`bi ${open ? 'bi-eye-slash' : 'bi-eye'}`} /> {open ? 'Hide' : 'Show'}
                        </button>
                    )}
                    <CopyButton text={json} />
                </div>
            </div>
            {isLarge && !open && <div className="json-block-preview"><code>{preview}</code></div>}
            {(!isLarge || open) && (
                <pre className="json-block-body"><code>
                    {tokenizeJson(json).map((t, i) => (
                        t.cls === 'plain' ? t.text : <span key={i} className={`json-tok-${t.cls}`}>{t.text}</span>
                    ))}
                </code></pre>
            )}
        </div>
    );
}

// ============================================================ value rendering

interface RenderCtx {
    keyLower: string;
    tokens: string[];
    depth: number;
    maxDepth: number;
    emptyValueText: string;
    showEmptyValues: boolean;
}

/** Anything that reads as "no value": null, '', [], {}. */
function isEmptyValue(value: unknown): boolean {
    if (value === null || value === undefined || value === '') return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0;
    return false;
}

/** Fed straight to `fmt.*`, which coerce and never throw. */
type FmtInput = string | number | null | undefined;
const asFmt = (value: unknown): FmtInput => (typeof value === 'number' || typeof value === 'string' ? value : null);

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
    return (
        <a className="dataview-link" href={href} target="_blank" rel="noopener noreferrer">
            {children} <i className="bi bi-box-arrow-up-right" />
        </a>
    );
}

function Truncated({ text, length }: { text: string; length: number }) {
    const short = fmt.truncate(text, length);
    return short === text ? <>{text}</> : <span title={text}>{short}</span>;
}

/** `datetime` — the source's four-way split, mapped onto the `fmt` shapes. */
function renderDatetime(value: unknown, ctx: RenderCtx): ReactNode {
    const { keyLower } = ctx;
    if (keyLower.includes('time') && !keyLower.includes('date')) return fmt.datetime(asFmt(value));
    if (keyLower.includes('relative') || keyLower.includes('ago') || keyLower.includes('last_')) {
        return fmt.relative(asFmt(value), ctx.emptyValueText);
    }
    // The source's remaining two branches — created/updated/modified as
    // `date("MMM D, YYYY")` and everything else as `date("MMMM D, YYYY")` —
    // are one branch here: `fmt` ships ONE date shape by design.
    return fmt.date(asFmt(value), ctx.emptyValueText);
}

function renderText(value: unknown, ctx: RenderCtx): ReactNode {
    if (typeof value !== 'string') return String(value);
    const { keyLower, tokens } = ctx;
    const len = value.length;

    if (keyLower.includes('description') || keyLower.includes('content') || hasWord(tokens, 'body')) {
        return <Truncated text={value} length={len > 200 ? 200 : 100} />;
    }
    if (keyLower.includes('summary') || keyLower.includes('excerpt')) {
        return <Truncated text={value} length={150} />;
    }
    // BUGFIX (order): the source tested `name` first, and "username" contains
    // "name" — so every username was title-cased and the slug/handle branch
    // below was unreachable for it. Identifiers are checked first and render
    // VERBATIM in monospace: the source's `slug` pipe rewrote `ian.starnes`
    // to `ianstarnes`, corrupting the very value the row exists to show.
    if (hasWord(tokens, 'username', 'slug', 'handle', 'login')) {
        return <code className="dataview-mono">{value}</code>;
    }
    if (keyLower.includes('name') || keyLower.includes('title') || hasWord(tokens, 'label')) {
        // `capitalize` as CSS, not as string surgery — the value is untouched.
        return <span className="cap"><Truncated text={value} length={50} /></span>;
    }
    if (hasWord(tokens, 'code', 'token', 'key', 'secret')) {
        return <code className="dataview-mono">{len > 20 ? fmt.mask(value, '*', 4) : value}</code>;
    }
    return <Truncated text={value} length={100} />;
}

function renderNumber(value: unknown, ctx: RenderCtx): ReactNode {
    const { keyLower, tokens } = ctx;
    if (typeof value !== 'number') return String(value);

    if (keyLower.includes('count') || keyLower.includes('total') || keyLower.includes('followers') || keyLower.includes('views')) {
        return value >= 1000 ? fmt.compact(value) : fmt.number(value);
    }
    if (keyLower.includes('score') || keyLower.includes('rating')) {
        return fmt.number(value, value % 1 !== 0 ? 1 : 0);
    }
    // IDs and versions are identifiers, not quantities — never separated.
    if (keyLower.includes('version') || hasWord(tokens, 'id')) return String(value);
    return fmt.number(value);
}

function renderCurrency(value: unknown, ctx: RenderCtx): ReactNode {
    const { keyLower } = ctx;
    const code = keyLower.includes('eur') || keyLower.includes('euro') ? 'EUR'
        : keyLower.includes('gbp') || keyLower.includes('pound') ? 'GBP'
            : 'USD';
    // django-mojo stores money as integer MINOR units so it never touches a
    // float; a fractional value is therefore already in major units. Wire
    // decimals arrive as STRINGS ('4.75' — the DecimalField shape), so
    // coerce before classifying or they'd fall through to cents and render
    // 100x small. Pass an explicit `format` when a record breaks the
    // convention (a whole-dollar decimal string like '12.00' parses to an
    // integer and stays ambiguous — no heuristic can save it).
    const n = asFmt(value);
    const num = typeof n === 'string' ? Number(n.trim()) : n;
    const unit = typeof num === 'number' && Number.isFinite(num) && !Number.isInteger(num) ? 'major' : 'cents';
    return fmt.currency(n, code, { unit, fallback: ctx.emptyValueText });
}

function renderPercent(value: unknown, ctx: RenderCtx): ReactNode {
    const n = asFmt(value);
    // `fmt.percent` scales a 0–1 ratio by 100. A value above 1 is already a
    // percentage (`error_rate: 12`), so scaling it would read 1,200%.
    const multiply = typeof n === 'number' && Math.abs(n) <= 1;
    return fmt.percent(n, 0, multiply, ctx.emptyValueText);
}

function renderArray(value: unknown[]): ReactNode {
    const scalars = value.every((v) => v === null || typeof v !== 'object');
    if (scalars) return value.map((v) => (v === null ? 'null' : String(v))).join(', ');
    // Deviation from source (which JSON-dumped every array): an array of
    // objects leads with its COUNT, because that is the fact you read first.
    return <JsonBlock value={value} label={`Array · ${value.length} item${value.length === 1 ? '' : 's'}`} collapsible defaultOpen={false} />;
}

function renderFile(value: Record<string, unknown>): ReactNode {
    const url = typeof value.url === 'string' ? value.url : null;
    const name = typeof value.name === 'string' ? value.name
        : typeof value.filename === 'string' ? value.filename : 'File';
    // The source had no `file` renderer at all — its default branch stringified
    // the object to "[object Object]".
    return url ? <ExternalLink href={url}>{name}</ExternalLink> : <JsonBlock value={value} label="File" />;
}

function renderTyped(value: unknown, type: DataFieldType, ctx: RenderCtx): ReactNode {
    switch (type) {
        case 'datetime':
            return renderDatetime(value, ctx);
        case 'date':
            return fmt.date(asFmt(value), ctx.emptyValueText);
        case 'email': {
            const s = String(value);
            return <a className="dataview-link" href={`mailto:${s}`} rel="noopener noreferrer">{s}</a>;
        }
        case 'url': {
            const s = String(value);
            return <ExternalLink href={s}>{s}</ExternalLink>;
        }
        case 'phone': {
            const s = String(value);
            return <a className="dataview-link" href={`tel:${s.replace(/[^\d+]/g, '')}`} rel="noopener noreferrer">{fmt.phone(s)}</a>;
        }
        case 'currency':
            return renderCurrency(value, ctx);
        case 'filesize':
            return fmt.filesize(asFmt(value), false, 1, ctx.emptyValueText);
        case 'percent':
            return renderPercent(value, ctx);
        case 'number':
            return renderNumber(value, ctx);
        case 'boolean': {
            // The house yes/no treatment — Badge + inferTone, exactly what the
            // source's `badge bg-success` / `bg-secondary` meant.
            const yes = fmt.yesNo(value) === 'Yes';
            return <Badge tone={yes ? 'success' : 'muted'}>{yes ? 'Yes' : 'No'}</Badge>;
        }
        case 'array':
            return renderArray(value as unknown[]);
        case 'file':
            return renderFile(value as Record<string, unknown>);
        case 'dataview': {
            if (ctx.depth >= ctx.maxDepth) {
                // Depth cap: past it, the object still renders — as JSON.
                return <JsonBlock value={value} collapsible defaultOpen={false} />;
            }
            return (
                <div className="dataview-nested">
                    <DataView
                        data={value as Record<string, unknown>}
                        depth={ctx.depth + 1}
                        maxDepth={ctx.maxDepth}
                        emptyValueText={ctx.emptyValueText}
                        showEmptyValues={ctx.showEmptyValues}
                        columns={2}
                    />
                </div>
            );
        }
        case 'object':
            return <JsonBlock value={value} />;
        default:
            return renderText(value, ctx);
    }
}

// ============================================================ the view

/**
 * Dotted-path lookup, own property first (KnownFieldsCard's rule, so a blob
 * that literally holds the key `"os.family"` still resolves).
 */
function lookup(data: Record<string, unknown>, name: string): unknown {
    if (!name) return undefined;
    if (Object.prototype.hasOwnProperty.call(data, name)) return data[name];
    if (!name.includes('.')) return undefined;
    let cursor: unknown = data;
    for (const part of name.split('.')) {
        if (cursor == null || typeof cursor !== 'object') return undefined;
        cursor = (cursor as Record<string, unknown>)[part];
    }
    return cursor;
}

const FULL_WIDTH_TYPES = new Set<DataFieldType>(['array', 'object', 'dataview']);

export function DataView({
    data,
    fields,
    exclude,
    columns = 2,
    showEmptyValues = true,
    emptyValueText = '—',
    emptyText = 'No data.',
    maxDepth = 2,
    depth = 0,
}: DataViewProps) {
    const record = data ?? {};
    const skip = new Set(exclude ?? []);

    // Ordering is STABLE: the schema's order, or the record's own key order.
    const specs: DataViewField[] = (fields ?? Object.keys(record).map((name) => ({ name })))
        .filter((f) => !skip.has(f.name));

    const rows = specs.map((spec) => {
        const value = lookup(record, spec.name);
        const empty = isEmptyValue(value);
        if (empty && (spec.hideEmpty || !showEmptyValues)) return null;

        let type: DataFieldType;
        if (spec.type && FIELD_TYPES.has(spec.type)) {
            type = spec.type;
        } else {
            if (spec.type) {
                // Rule 4: an unknown type falls back to inference WITH a warn,
                // never to rendering nothing.
                warnOnce(`[DataView] unknown field type ${JSON.stringify(spec.type)} for "${spec.name}" — inferring instead. Valid: ${[...FIELD_TYPES].join(', ')}`);
            }
            type = inferFieldType(value, spec.name);
        }

        const ctx: RenderCtx = {
            keyLower: spec.name.toLowerCase(),
            tokens: tokenize(spec.name),
            depth, maxDepth, emptyValueText, showEmptyValues,
        };

        let node: ReactNode;
        if (empty && !spec.format) {
            node = <span className="dataview-value-empty">{emptyValueText}</span>;
        } else {
            // A formatter is the last thing allowed to take a record down: any
            // throw degrades to the plain string, loudly (same contract as fmt).
            try {
                node = safeNode(spec.format ? spec.format(value, spec.name, record) : renderTyped(value, type, ctx), `DataView field "${spec.name}"`);
            } catch (err) {
                warnOnce(`[DataView] renderer for "${spec.name}" threw — falling back to the plain value.`, err);
                node = String(value);
            }
        }

        const full = spec.span === 'full' || (spec.span !== 'auto' && FULL_WIDTH_TYPES.has(type));
        return (
            <div
                key={spec.name}
                className={`dataview-item${full ? ' dataview-item-full' : ''}${spec.className ? ` ${spec.className}` : ''}`}
                data-field={spec.name}
            >
                <div className="dataview-label">{spec.label ?? formatLabel(spec.name.split('.').pop() ?? spec.name)}</div>
                <div className="dataview-value">{node}</div>
            </div>
        );
    }).filter(Boolean);

    if (rows.length === 0) return <div className="dim dataview-empty">{emptyText}</div>;

    return (
        <div
            className="dataview"
            style={{ '--dataview-cols': Math.max(1, Math.trunc(columns)) } as CSSProperties}
        >
            {rows}
        </div>
    );
}
