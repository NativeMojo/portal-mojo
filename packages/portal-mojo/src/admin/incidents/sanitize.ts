import { safeFileReference } from '../../client/record-feed';

const REDACTED = '[redacted]';
const MAX_SECURITY_TEXT = 32_000;
const SENSITIVE_KEY = /^(?:authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|password|passwd|passphrase|token|access[-_]?token|refresh[-_]?token|id[-_]?token|api[-_]?key|auth[-_]?key|client[-_]?secret|secret|credential|credentials|csrf|xsrf)(?:$|[-_])/i;
const SENSITIVE_PARAM = /([?&;](?:password|passwd|token|access_token|refresh_token|id_token|api_key|auth_key|client_secret|secret|csrf|xsrf)=)[^&#;\s]*/gi;
const HEADER_LINE = /^((?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token)\s*:\s*).+$/gim;
const AUTH_VALUE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g;
const FORM_SECRET = /(^|[&;\s])((?:password|passwd|token|access_token|refresh_token|api_key|client_secret|secret|csrf|xsrf)=)[^&;\s]*/gi;
const LABELED_SECRET = /\b(token|password|passwd|api[ _-]?key|client[ _-]?secret|secret)(\s*(?:is|:|=)?\s+)[A-Za-z0-9._~+/=-]{8,}/gi;

function sensitiveName(key: string): boolean {
    return SENSITIVE_KEY.test(key.trim().toLowerCase().replace(/\s+/g, '_'));
}

export function sanitizeSecurityText(value: string): string {
    let text = value.replace(HEADER_LINE, `$1${REDACTED}`).replace(AUTH_VALUE, `$1 ${REDACTED}`).replace(JWT, REDACTED).replace(LABELED_SECRET, `$1$2${REDACTED}`);
    text = text.replace(SENSITIVE_PARAM, `$1${REDACTED}`).replace(FORM_SECRET, `$1$2${REDACTED}`);
    const trimmed = text.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try { return JSON.stringify(sanitizeSecurityValue(JSON.parse(text))); } catch { /* conservative regex fallback above */ }
    }
    return text;
}

export function boundedSecurityText(value: unknown, limit = MAX_SECURITY_TEXT): string {
    const raw = typeof value === 'string' ? value : value == null ? '' : (JSON.stringify(value, null, 2) ?? String(value));
    const safe = sanitizeSecurityText(raw);
    if (safe.length <= limit) return safe;
    return `${safe.slice(0, limit)}\n… [truncated ${safe.length - limit} characters]`;
}

export function sanitizeSecurityValue<T>(value: T, seen = new WeakMap<object, unknown>()): T {
    if (typeof value === 'string') return sanitizeSecurityText(value) as T;
    if (value == null || typeof value !== 'object') return value;
    if (seen.has(value as object)) return '[circular]' as T;
    if (Array.isArray(value)) {
        const out: unknown[] = [];
        seen.set(value, out);
        for (const item of value) out.push(sanitizeSecurityValue(item, seen));
        return out as T;
    }
    const out: Record<string, unknown> = {};
    seen.set(value as object, out);
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        out[key] = sensitiveName(key) ? REDACTED : sanitizeSecurityValue(item, seen);
    }
    return out as T;
}

function sanitizedRow<T extends Record<string, unknown>>(row: T): T {
    // File relation objects are positively projected before recursive domain
    // sanitization so browser/capability-bearing impostors never traverse it.
    const rebuilt = 'media' in row ? { ...row, media: safeFileReference(row.media) } : row;
    const safe = sanitizeSecurityValue(rebuilt) as Record<string, unknown>;
    for (const key of ['details', 'stack_trace', 'traceback']) {
        if (key in safe && safe[key] != null) safe[key] = boundedSecurityText(safe[key]);
    }
    if (safe.metadata && typeof safe.metadata === 'object') {
        const metadata = safe.metadata as Record<string, unknown>;
        for (const key of ['text', 'request_body', 'request_data', 'response_body', 'stack_trace', 'traceback']) {
            if (key in metadata && metadata[key] != null) metadata[key] = boundedSecurityText(metadata[key]);
        }
    }
    return safe as T;
}

export const sanitizeIncidentRow = <T,>(row: T): T => sanitizedRow(row as unknown as Record<string, unknown>) as T;
export const sanitizeEventRow = <T,>(row: T): T => sanitizedRow(row as unknown as Record<string, unknown>) as T;
export const sanitizeIncidentHistoryRow = <T,>(row: T): T => sanitizedRow(row as unknown as Record<string, unknown>) as T;
