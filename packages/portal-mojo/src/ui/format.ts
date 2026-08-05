// Mini DataFormatter port — pure functions instead of template pipes.
// In JSX these are plain calls: {fmt.relative(user.last_login)}.

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
const DATETIME_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function toDate(value: string | number | Date | null | undefined): Date | null {
    if (value == null || value === '') return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

export function date(value: string | null | undefined, fallback = '—'): string {
    const d = toDate(value);
    return d ? DATE_FMT.format(d) : fallback;
}

export function datetime(value: string | null | undefined, fallback = '—'): string {
    const d = toDate(value);
    return d ? DATETIME_FMT.format(d) : fallback;
}

/** '3 weeks ago' style. Ports web-mojo's `relative` pipe behavior. */
export function relative(value: string | null | undefined, fallback = 'Never'): string {
    const d = toDate(value);
    if (!d) return fallback;
    const secs = Math.round((Date.now() - d.getTime()) / 1000);
    if (secs < 60) return 'just now';
    const units: [number, string][] = [
        [60, 'minute'], [60, 'hour'], [24, 'day'], [7, 'week'], [4.348, 'month'], [12, 'year'],
    ];
    let n = secs / 60;
    let unit = 'minute';
    for (const [div, name] of units.slice(1)) {
        if (n < div) break;
        n /= div;
        unit = name;
    }
    const count = Math.floor(n);
    return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

export function initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'primary';

/** Ports DataFormatter's inferBadgeType: map common status text → tone. */
export function inferTone(value: string | boolean | null | undefined): Tone {
    if (typeof value === 'boolean') return value ? 'success' : 'muted';
    const v = String(value ?? '').toLowerCase();
    if (['active', 'verified', 'enabled', 'ok', 'online', 'completed'].includes(v)) return 'success';
    if (['pending', 'trial', 'staff', 'warning'].includes(v)) return 'warning';
    if (['inactive', 'disabled', 'failed', 'error', 'banned'].includes(v)) return 'danger';
    if (['admin'].includes(v)) return 'primary';
    return 'muted';
}
