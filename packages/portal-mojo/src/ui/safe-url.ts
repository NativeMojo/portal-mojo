// Shared guard for server-issued preview capabilities (fileman File `url` /
// `thumbnail`). Accepts only same-origin absolute paths or credential-free
// http(s) URLs — never `javascript:`, `data:`, protocol-relative `//host`, or
// values with stray whitespace/CR/LF/backslashes. Callers keep the result in
// component-local state; it must never be written into a Query cache.
export function safePreviewUrl(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim() !== value || !value || value.startsWith('//')) return null;
    if (value.startsWith('/')) return /[\r\n\\]/.test(value) ? null : value;
    try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
            ? value : null;
    } catch { return null; }
}
