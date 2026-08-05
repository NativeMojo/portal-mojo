// In-memory django-mojo mock. Speaks the EXACT wire contract the real client
// uses — envelope {status, data|rows..., message}, start/size paging, sort
// with '-' prefix, search, and Django-style lookups (field, field__in,
// field__icontains, field__gte) — so the client code below it is real, and
// pointing at a live backend is only a VITE_MOJO_API env change.
import type { Params, User } from './types';

// Deterministic dataset — same 57 users on every load so the demo is stable.
function mulberry32(seed: number) {
    return () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const FIRST = ['Ian', 'Maya', 'Jordan', 'Priya', 'Marcus', 'Elena', 'Tom', 'Aisha', 'Diego', 'Nora', 'Sam', 'Lena', 'Victor', 'Ruth', 'Omar', 'Grace', 'Felix', 'Dana', 'Kai', 'June'];
const LAST = ['Starnes', 'Chen', 'Alvarez', 'Patel', 'Reed', 'Kovacs', 'Nguyen', 'Okafor', 'Ramos', 'Lindqvist', 'Barnes', 'Moreau', 'Ito', 'Novak', 'Haddad', 'Kim', 'Weber', 'Silva', 'Fontaine'];

function buildUsers(): User[] {
    const rand = mulberry32(20260804);
    const now = Date.now();
    const users: User[] = [];
    for (let i = 1; i <= 57; i++) {
        const fn = FIRST[Math.floor(rand() * FIRST.length)];
        const ln = LAST[Math.floor(rand() * LAST.length)];
        const createdDays = Math.floor(rand() * 380) + 3;
        const active = rand() > 0.14;
        const loggedInDays = Math.floor(rand() * createdDays);
        users.push({
            id: i,
            display_name: `${fn} ${ln}`,
            email: `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@nativemojo.com`,
            phone: rand() > 0.55 ? `+1 (555) 0${String(100 + Math.floor(rand() * 899))}` : null,
            role: rand() > 0.92 ? 'admin' : rand() > 0.78 ? 'staff' : 'user',
            is_active: active,
            email_verified: rand() > 0.18,
            mfa_enabled: rand() > 0.6,
            passkeys: rand() > 0.7 ? Math.ceil(rand() * 3) : 0,
            last_login: active && rand() > 0.1 ? new Date(now - loggedInDays * 864e5 - rand() * 864e5).toISOString() : null,
            created: new Date(now - createdDays * 864e5).toISOString(),
        });
    }
    // Row 1 mirrors the reference screenshot.
    users[0] = { ...users[0], display_name: 'Ian Starnes', email: 'ian@mojoverify.com', phone: null, role: 'user', is_active: true, email_verified: true, mfa_enabled: false, passkeys: 1, created: '2026-07-10T14:00:00Z', last_login: new Date(now - 21 * 864e5).toISOString() };
    return users;
}

const db = { users: buildUsers() };

function getField(row: Record<string, unknown>, field: string): unknown {
    return row[field];
}

/** Apply one Django-style lookup param to the row set. */
function applyLookup<T extends Record<string, unknown>>(rows: T[], key: string, raw: string): T[] {
    const parts = key.split('__');
    const lookup = parts.length > 1 ? parts[parts.length - 1] : 'exact';
    const known = ['exact', 'in', 'icontains', 'gte', 'lte', 'isnull'];
    const field = known.includes(lookup) && parts.length > 1 ? parts.slice(0, -1).join('__') : key;
    const op = known.includes(lookup) && parts.length > 1 ? lookup : 'exact';

    return rows.filter((row) => {
        const v = getField(row, field);
        switch (op) {
            case 'in': return raw.split(',').map((s) => s.trim()).includes(String(v));
            case 'icontains': return String(v ?? '').toLowerCase().includes(raw.toLowerCase());
            case 'gte': return v != null && String(v) >= raw;
            case 'lte': return v != null && String(v) <= raw;
            case 'isnull': return raw === 'true' ? v == null : v != null;
            default:
                if (raw === 'true' || raw === 'false') return v === (raw === 'true');
                return String(v) === raw;
        }
    });
}

// dr_* is the daterange TRIPLE: dr_field names which column the range applies
// to, dr_start/dr_end carry the bounds. One active daterange by construction.
const RESERVED = new Set(['start', 'size', 'sort', 'search', 'graph', 'dr_field', 'dr_start', 'dr_end']);

function listUsers(params: Params) {
    let rows = [...db.users];
    const search = params.search ? String(params.search).toLowerCase() : '';
    if (search) {
        rows = rows.filter((u) => u.display_name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search));
    }
    const drField = params.dr_field ? String(params.dr_field) : '';
    if (drField) {
        const s = params.dr_start ? String(params.dr_start) : '';
        const e = params.dr_end ? String(params.dr_end) : '';
        rows = rows.filter((u) => {
            const raw = (u as unknown as Record<string, unknown>)[drField];
            if (raw == null) return false;
            const day = String(raw).slice(0, 10);
            if (s && day < s) return false;
            if (e && day > e) return false;
            return true;
        });
    }
    for (const [key, value] of Object.entries(params)) {
        if (RESERVED.has(key) || value == null || value === '') continue;
        rows = applyLookup(rows as unknown as Record<string, unknown>[], key, String(value)) as unknown as User[];
    }
    const sort = String(params.sort ?? '-created');
    const desc = sort.startsWith('-');
    const field = desc ? sort.slice(1) : sort;
    rows.sort((a, b) => {
        const av = getField(a as unknown as Record<string, unknown>, field);
        const bv = getField(b as unknown as Record<string, unknown>, field);
        const cmp = av == null ? -1 : bv == null ? 1 : String(av).localeCompare(String(bv), undefined, { numeric: true });
        return desc ? -cmp : cmp;
    });
    const start = Number(params.start ?? 0);
    const size = Number(params.size ?? 25);
    return {
        status: true,
        count: rows.length,
        start,
        size,
        data: size === 0 ? [] : rows.slice(start, start + size),
    };
}

// ── /api/metrics/fetch ────────────────────────────────────────────────
// Bucketed multi-series time data. Bucket size comes from the granularity,
// count from the range — the same shape django-mojo's metrics app returns.
const RANGE_MS: Record<string, number> = {
    '1h': 3600e3,
    '24h': 24 * 3600e3,
    '7d': 7 * 864e5,
    '30d': 30 * 864e5,
    '1y': 365 * 864e5,
};
const BUCKET_MS: Record<string, number> = {
    minutes: 60e3,
    hours: 3600e3,
    days: 864e5,
    weeks: 7 * 864e5,
    months: 30 * 864e5,
};

const SERIES: { slug: string; label: string; base: number; spread: number }[] = [
    { slug: 'api_calls', label: 'API Calls', base: 240, spread: 90 },
    { slug: 'logins', label: 'Logins', base: 70, spread: 34 },
    { slug: 'errors', label: 'Errors', base: 12, spread: 10 },
];

function bucketLabel(d: Date, granularity: string): string {
    switch (granularity) {
        case 'minutes':
        case 'hours':
            return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        case 'days':
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        case 'weeks':
            return `Wk ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        default:
            return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    }
}

/** Deterministic value with daily + weekly rhythm, so charts look plausible. */
function sample(slugIndex: number, t: number, base: number, spread: number): number {
    const d = new Date(t);
    const hour = d.getHours() + d.getMinutes() / 60;
    const daily = Math.sin(((hour - 7) / 24) * Math.PI * 2) * 0.45 + 0.75; // peak mid-afternoon
    const weekly = [0.55, 1, 1.05, 1.02, 1.08, 0.9, 0.5][d.getDay()] ?? 1; // quiet weekends
    const jitter = mulberry32(Math.floor(t / 1e5) + slugIndex * 7919)();
    const v = base * daily * weekly + (jitter - 0.5) * spread;
    return Math.max(0, Math.round(v));
}

function fetchMetrics(params: Params) {
    const range = String(params.range ?? '24h');
    const granularity = String(params.granularity ?? 'hours');
    const wanted = String(params.slugs ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const span = RANGE_MS[range] ?? RANGE_MS['24h']!;
    const bucket = BUCKET_MS[granularity] ?? BUCKET_MS.hours!;
    const count = Math.min(400, Math.max(2, Math.round(span / bucket)));
    // Align the right edge to the current bucket so labels read cleanly.
    const end = Math.floor(Date.now() / bucket) * bucket;

    const labels: string[] = [];
    const times: number[] = [];
    for (let i = count - 1; i >= 0; i--) {
        const t = end - i * bucket;
        times.push(t);
        labels.push(bucketLabel(new Date(t), granularity));
    }

    const picked = wanted.length ? SERIES.filter((s) => wanted.includes(s.slug)) : SERIES;
    // Longer buckets aggregate more events — scale so totals stay coherent.
    const scale = bucket / 3600e3;
    const datasets = picked.map((s, i) => ({
        label: s.label,
        data: times.map((t) => Math.round(sample(i, t, s.base, s.spread) * Math.max(0.15, scale))),
    }));

    return { status: true, data: { labels, datasets, granularity, range } };
}

const LATENCY_MS = 220;

/** Mock transport. Same signature the real fetch path resolves through. */
export async function mockFetch(path: string, opts: { params?: Params; method?: string; body?: Record<string, unknown> }): Promise<unknown> {
    await new Promise((r) => setTimeout(r, LATENCY_MS));
    if (path === '/api/metrics/fetch') return fetchMetrics(opts.params ?? {});
    const one = path.match(/^\/api\/account\/user\/(\d+)$/);
    if (one) {
        const id = Number(one[1]);
        const user = db.users.find((u) => u.id === id);
        if (!user) return { status: false, error: 'User not found', error_code: 404 };
        if (opts.method === 'POST' && opts.body) {
            Object.assign(user, opts.body);
            return { status: true, data: { ...user } };
        }
        return { status: true, data: { ...user } };
    }
    if (path === '/api/account/user') {
        if (opts.method === 'POST' && opts.body) {
            const id = Math.max(...db.users.map((u) => u.id)) + 1;
            const user: User = {
                id,
                display_name: String(opts.body.display_name ?? 'New User'),
                email: String(opts.body.email ?? `user${id}@nativemojo.com`),
                phone: (opts.body.phone as string) || null,
                role: (opts.body.role as User['role']) ?? 'user',
                is_active: true,
                email_verified: false,
                mfa_enabled: false,
                passkeys: 0,
                last_login: null,
                created: new Date().toISOString(),
            };
            db.users.unshift(user);
            return { status: true, data: { ...user } };
        }
        return listUsers(opts.params ?? {});
    }
    return { status: false, error: `No mock for ${path}`, error_code: 404 };
}
