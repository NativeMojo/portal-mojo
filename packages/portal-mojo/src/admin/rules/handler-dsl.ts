/** Lossless editor model for django-mojo's comma-delimited handler DSL. */

export const HANDLER_SCHEMES = ['job', 'email', 'sms', 'notify', 'block', 'ticket', 'maestro', 'llm', 'resolve'] as const;
export type HandlerScheme = typeof HANDLER_SCHEMES[number];

export interface HandlerDefinition {
    scheme: HandlerScheme;
    label: string;
    target: 'path' | 'targets' | 'none';
    defaults?: Record<string, string>;
}

export const HANDLER_DEFINITIONS: readonly HandlerDefinition[] = [
    { scheme: 'job', label: 'Run job', target: 'path' },
    { scheme: 'email', label: 'Email', target: 'targets' },
    { scheme: 'sms', label: 'SMS', target: 'targets' },
    { scheme: 'notify', label: 'Push notification', target: 'targets' },
    { scheme: 'block', label: 'Block source IP', target: 'none', defaults: { ttl: '3600' } },
    { scheme: 'ticket', label: 'Create ticket', target: 'none', defaults: { priority: '5', status: 'open' } },
    { scheme: 'maestro', label: 'Report to Maestro', target: 'none' },
    { scheme: 'llm', label: 'LLM triage', target: 'none' },
    { scheme: 'resolve', label: 'Resolve incident', target: 'none', defaults: { status: 'resolved' } },
] as const;

export interface HandlerParam { key: string; value: string; raw: string }
export type RuntimeDisposition = 'effective' | 'swallowed' | 'skipped';
export interface HandlerStep {
    /** Separator immediately before this step. Empty only for the first step. */
    separator: string;
    /** Exact bytes after separator. Untouched steps serialize byte-for-byte. */
    raw: string;
    scheme: string | null;
    schemeRaw: string;
    supported: boolean;
    target: string;
    targetRaw: string;
    hadQuery: boolean;
    params: HandlerParam[];
    malformedEncoding: boolean;
    runtime: RuntimeDisposition;
    runtimeOwner: number | null;
}
export interface HandlerChain { source: string; steps: HandlerStep[] }
export interface HandlerIssue { step: number; level: 'error' | 'warning'; message: string }

const SUPPORTED = new Set<string>(HANDLER_SCHEMES);
const UI_BOUNDARY = /,(?=[A-Za-z][A-Za-z0-9+.-]*:\/\/)/g;
const URI = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([\s\S]*)$/;

function safeDecode(value: string): { value: string; malformed: boolean } {
    try { return { value: decodeURIComponent(value.replace(/\+/g, ' ')), malformed: false }; }
    catch { return { value, malformed: true }; }
}

function inspect(raw: string): Omit<HandlerStep, 'separator' | 'raw' | 'runtime' | 'runtimeOwner'> {
    const content = raw.trim();
    const match = content.match(URI);
    if (!match) return { scheme: null, schemeRaw: '', supported: false, target: '', targetRaw: '', hadQuery: false, params: [], malformedEncoding: false };
    const scheme = match[1]!.toLowerCase();
    const rest = match[2]!;
    const queryAt = rest.indexOf('?');
    const targetRaw = queryAt < 0 ? rest : rest.slice(0, queryAt);
    const query = queryAt < 0 ? '' : rest.slice(queryAt + 1);
    const targetDecoded = safeDecode(targetRaw);
    let malformedEncoding = targetDecoded.malformed;
    const params = query === '' ? [] : query.split('&').map((rawEntry) => {
        const eq = rawEntry.indexOf('=');
        const keyRaw = eq < 0 ? rawEntry : rawEntry.slice(0, eq);
        const valueRaw = eq < 0 ? '' : rawEntry.slice(eq + 1);
        const key = safeDecode(keyRaw); const value = safeDecode(valueRaw);
        malformedEncoding ||= key.malformed || value.malformed;
        return { key: key.value, value: value.value, raw: rawEntry };
    });
    return { scheme, schemeRaw: match[1]!, supported: SUPPORTED.has(scheme), target: targetDecoded.value, targetRaw, hadQuery: queryAt >= 0, params, malformedEncoding };
}

export function parseHandlerChain(value: string | null | undefined): HandlerChain {
    const source = value ?? '';
    if (!source) return { source, steps: [] };
    const pieces: Array<{ separator: string; raw: string }> = [];
    let start = 0;
    for (const match of source.matchAll(UI_BOUNDARY)) {
        pieces.push({ separator: pieces.length ? ',' : '', raw: source.slice(start, match.index) });
        start = (match.index ?? 0) + 1;
    }
    pieces.push({ separator: pieces.length ? ',' : '', raw: source.slice(start) });

    let owner: number | null = null;
    const steps = pieces.map((piece, index): HandlerStep => {
        const parsed = inspect(piece.raw);
        // Python starts a new runtime spec only at comma + an immediately
        // adjacent known scheme. Whitespace and unknown schemes remain in
        // the current spec, which is why the UI projection is separate.
        const boundary = index === 0 || (piece.separator === ',' && HANDLER_SCHEMES.some((scheme) => piece.raw.startsWith(`${scheme}://`)));
        let runtime: RuntimeDisposition;
        if (boundary) {
            runtime = parsed.supported ? 'effective' : 'skipped';
            owner = parsed.supported ? index : null;
        } else {
            runtime = owner == null ? 'skipped' : 'swallowed';
        }
        return { ...piece, ...parsed, runtime, runtimeOwner: runtime === 'swallowed' ? owner : runtime === 'effective' ? index : null };
    });
    return { source, steps };
}

function encode(value: string): string { return encodeURIComponent(value).replace(/%40/g, '@').replace(/%2C/gi, ','); }

function buildRaw(step: HandlerStep, scheme: string, target: string, params: HandlerParam[]): string {
    const leading = step.raw.match(/^\s*/)?.[0] ?? '';
    const trailing = step.raw.match(/\s*$/)?.[0] ?? '';
    const query = params.length ? `?${params.map((entry) => entry.raw || `${encode(entry.key)}=${encode(entry.value)}`).join('&')}` : (step.hadQuery && step.params.length === 0 ? '?' : '');
    const schemeText = scheme === step.scheme ? step.schemeRaw : scheme;
    const targetText = target === step.target ? step.targetRaw : encode(target);
    return `${leading}${schemeText}://${targetText}${query}${trailing}`;
}

export function updateHandlerStep(chain: HandlerChain, index: number, patch: {
    scheme?: HandlerScheme; target?: string; param?: { key: string; value: string }; removeParam?: string;
}, options: { confirmBehaviorChange?: boolean } = {}): HandlerChain {
    const step = chain.steps[index];
    if (!step) throw new Error('Handler step does not exist.');
    if (step.runtime !== 'effective' && !options.confirmBehaviorChange) {
        throw new Error('This step is skipped or swallowed by the backend. Confirm the runtime behavior change before editing it.');
    }
    const scheme = patch.scheme ?? (step.supported ? step.scheme as HandlerScheme : undefined);
    if (!scheme || !SUPPORTED.has(scheme)) throw new Error('Choose a supported handler type.');
    let params = step.params.map((entry) => ({ ...entry }));
    if (patch.param) {
        const first = params.findIndex((entry) => entry.key === patch.param!.key);
        if (first >= 0) params[first] = { key: patch.param.key, value: patch.param.value, raw: '' };
        else params.push({ key: patch.param.key, value: patch.param.value, raw: '' });
    }
    if (patch.removeParam != null) {
        const first = params.findIndex((entry) => entry.key === patch.removeParam);
        if (first >= 0) params.splice(first, 1);
    }
    const definition = HANDLER_DEFINITIONS.find((item) => item.scheme === scheme)!;
    const nextTarget = patch.target ?? (patch.scheme && definition.target === 'none' ? '' : step.target);
    const raw = buildRaw(step, scheme, nextTarget, params);
    const next = chain.steps.map((candidate, i) => i === index ? { ...candidate, raw } : candidate);
    return parseHandlerChain(next.map((candidate) => candidate.separator + candidate.raw).join(''));
}

export function moveHandlerStep(chain: HandlerChain, from: number, to: number, options: { confirmBehaviorChange?: boolean } = {}): HandlerChain {
    if (from === to) return chain;
    const source = chain.steps[from]; const target = chain.steps[to];
    if (!source || !target) throw new Error('Handler step does not exist.');
    if ((source.runtime !== 'effective' || target.runtime !== 'effective') && !options.confirmBehaviorChange) {
        throw new Error('Moving skipped or swallowed content can change backend behavior. Confirm the behavior change first.');
    }
    const ordered = chain.steps.map((step) => step.raw);
    const [moved] = ordered.splice(from, 1); ordered.splice(to, 0, moved!);
    return parseHandlerChain(ordered.join(','));
}

export function removeHandlerStep(chain: HandlerChain, index: number, options: { confirmBehaviorChange?: boolean } = {}): HandlerChain {
    const step = chain.steps[index];
    if (!step) return chain;
    if (step.runtime !== 'effective' && !options.confirmBehaviorChange) throw new Error('Confirm removal of skipped or swallowed legacy content.');
    return parseHandlerChain(chain.steps.filter((_, i) => i !== index).map((candidate) => candidate.raw).join(','));
}

export function addHandlerStep(chain: HandlerChain, scheme: HandlerScheme): HandlerChain {
    const definition = HANDLER_DEFINITIONS.find((item) => item.scheme === scheme)!;
    const params = Object.entries(definition.defaults ?? {}).map(([key, value]) => `${encode(key)}=${encode(value)}`);
    const raw = `${scheme}://${params.length ? `?${params.join('&')}` : ''}`;
    return parseHandlerChain(`${serializeHandlerChain(chain)}${chain.steps.length ? ',' : ''}${raw}`);
}

export function serializeHandlerChain(chain: HandlerChain): string {
    return chain.steps.map((step) => step.separator + step.raw).join('');
}

export function runtimeEffectiveHandlerChain(chain: HandlerChain): string[] {
    // Match RuleSet.run_handler exactly: strip once, split at known adjacent
    // schemes, strip each result, then skip an unsupported parsed scheme.
    return serializeHandlerChain(chain).trim()
        .split(/,(?=(?:job|email|sms|notify|ticket|maestro|block|llm|resolve):\/\/)/)
        .map((spec) => spec.trim()).filter(Boolean)
        .filter((spec) => SUPPORTED.has(spec.match(URI)?.[1]?.toLowerCase() ?? ''));
}

export function validateHandlerChain(chain: HandlerChain): HandlerIssue[] {
    const issues: HandlerIssue[] = [];
    chain.steps.forEach((step, index) => {
        if (!step.scheme) issues.push({ step: index, level: 'error', message: 'Handler is not a URI-like scheme:// specification.' });
        else if (!step.supported) issues.push({ step: index, level: 'warning', message: `Unsupported ${step.scheme}:// content is preserved but the backend will skip or swallow it.` });
        if (step.malformedEncoding) issues.push({ step: index, level: 'error', message: 'Malformed percent encoding.' });
        if (step.runtime === 'swallowed') issues.push({ step: index, level: 'warning', message: 'The backend swallows this segment into the preceding handler.' });
        if (step.runtime === 'skipped') issues.push({ step: index, level: 'warning', message: 'The backend skips this segment.' });
        step.params.forEach((entry) => {
            if (!entry.key) issues.push({ step: index, level: 'error', message: 'Parameter keys cannot be empty.' });
            if (!entry.value) issues.push({ step: index, level: 'error', message: `Parameter “${entry.key || '(blank)'}” cannot have an empty value.` });
        });
        if (step.supported && ['job', 'email', 'sms', 'notify'].includes(step.scheme!) && !step.target.trim()) issues.push({ step: index, level: 'error', message: `${step.scheme}:// requires a target.` });
        if (step.scheme === 'job' && step.target && !/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(step.target)) issues.push({ step: index, level: 'error', message: 'Job target must be a Python module path.' });
        const first = (key: string) => step.params.find((entry) => entry.key === key)?.value;
        const integer = (key: string, min: number, max = Number.MAX_SAFE_INTEGER) => { const value = first(key); if (value != null && (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)) issues.push({ step: index, level: 'error', message: `${key} must be an integer from ${min}${Number.isFinite(max) ? ` to ${max}` : ''}.` }); };
        if (step.scheme === 'block') integer('ttl', 0);
        if (step.scheme === 'ticket') integer('priority', 1, 10);
        if (step.scheme === 'maestro') integer('board', 1);
        if (step.scheme === 'resolve') { const status = first('status'); if (status && !['resolved', 'closed', 'ignored'].includes(status)) issues.push({ step: index, level: 'error', message: 'Resolve status must be resolved, closed, or ignored.' }); }
        const seen = new Set<string>();
        step.params.forEach((entry) => { if (seen.has(entry.key)) issues.push({ step: index, level: 'warning', message: `Duplicate “${entry.key}”: django-mojo uses the first value.` }); seen.add(entry.key); });
    });
    return issues;
}
