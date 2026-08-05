// In-memory django-mojo mock. Speaks the EXACT wire contract the real client
// uses — envelope {status, data|rows..., message}, start/size paging, sort
// with '-' prefix, search, and Django-style lookups (field, field__in,
// field__icontains, field__gte) — so the client code below it is real, and
// pointing at a live backend is only a VITE_MOJO_API env change.
//
// Auth (Chunk A1): password / magic / passkey / reset / refresh / exchange
// endpoints mirroring django-mojo apps/account/rest/user.py + passkeys.py.
//   · any seeded ACTIVE user logs in with their email + password "mojo"
//   · tokens are real-SHAPED JWTs (decodable payload, exp/iat/uid) with a
//     fake signature — expiry logic runs authentically client-side
//   · flows that would send email return the minted token in a __mock_token
//     field so they are drivable end-to-end in dev (a real server never does)
// Data endpoints stay open (no auth required) until the portal grows login
// pages (Chunk C3) — then they 401 without a bearer, like the real backend.
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

// ── Groups ────────────────────────────────────────────────────────────
// Deterministic hierarchy: orgs → teams (2–3 each) → two projects. Team
// names repeat across orgs on purpose — the switcher's tree is what makes
// them unambiguous.
export interface MockGroup {
    id: number;
    name: string;
    kind: string;
    parent: { id: number; name: string; kind: string } | null;
    created: string;
    [field: string]: unknown;
}

const ORG_NAMES = ['Acme Corp', 'Globex', 'Initech', 'Umbrella Labs', 'Stark Industries', 'Wayne Enterprises'];
const TEAM_NAMES = ['Engineering', 'Operations', 'Support'];

function buildGroups(): MockGroup[] {
    const now = Date.now();
    const groups: MockGroup[] = [];
    let id = 1;
    const engineeringTeams: MockGroup[] = [];
    ORG_NAMES.forEach((orgName, oi) => {
        const org: MockGroup = {
            id: id++, name: orgName, kind: 'org', parent: null,
            created: new Date(now - (420 - oi * 40) * 864e5).toISOString(),
        };
        groups.push(org);
        const teamCount = 2 + (oi % 2);
        for (let t = 0; t < teamCount; t++) {
            const team: MockGroup = {
                id: id++, name: TEAM_NAMES[t]!, kind: 'team',
                parent: { id: org.id, name: org.name, kind: 'org' },
                created: new Date(now - (400 - oi * 40 - t * 5) * 864e5).toISOString(),
            };
            groups.push(team);
            if (t === 0) engineeringTeams.push(team);
        }
    });
    for (const [pi, name] of (['Project Apollo', 'Project Zephyr'] as const).entries()) {
        const team = engineeringTeams[pi]!;
        groups.push({
            id: id++, name, kind: 'project',
            parent: { id: team.id, name: team.name, kind: 'team' },
            created: new Date(now - (120 - pi * 30) * 864e5).toISOString(),
        });
    }
    return groups;
}

const db = { users: buildUsers(), groups: buildGroups() };

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

/** The shared list pipeline: search → daterange triple → lookups → sort → page. */
function listRows<T extends Record<string, unknown>>(
    all: T[],
    params: Params,
    searchText: (row: T) => string,
    defaultSort = '-created',
) {
    let rows = [...all];
    const search = params.search ? String(params.search).toLowerCase() : '';
    if (search) {
        rows = rows.filter((row) => searchText(row).toLowerCase().includes(search));
    }
    const drField = params.dr_field ? String(params.dr_field) : '';
    if (drField) {
        const s = params.dr_start ? String(params.dr_start) : '';
        const e = params.dr_end ? String(params.dr_end) : '';
        rows = rows.filter((row) => {
            const raw = row[drField];
            if (raw == null) return false;
            const day = String(raw).slice(0, 10);
            if (s && day < s) return false;
            if (e && day > e) return false;
            return true;
        });
    }
    for (const [key, value] of Object.entries(params)) {
        if (RESERVED.has(key) || value == null || value === '') continue;
        rows = applyLookup(rows, key, String(value));
    }
    const sort = String(params.sort ?? defaultSort);
    const desc = sort.startsWith('-');
    const field = desc ? sort.slice(1) : sort;
    rows.sort((a, b) => {
        const av = getField(a, field);
        const bv = getField(b, field);
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

function listUsers(params: Params) {
    return listRows(db.users as unknown as Record<string, unknown>[], params, (u) => `${u.display_name} ${u.email}`);
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

// ── Auth endpoints ────────────────────────────────────────────────────
// django-mojo contract: login → {access_token, refresh_token, user} (or an
// MFA challenge); refresh → token pair ONLY (no user; auth_time carried
// forward); errors are {status:false, error, error_code} envelopes.

const MOCK_PASSWORD = 'mojo';
const ACCESS_TTL = 21600; // JWT_TOKEN_EXPIRY default (6h)
const REFRESH_TTL = 604800; // JWT_REFRESH_TOKEN_EXPIRY default (7d)

function b64url(s: string): string {
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Real-shaped JWT (decodable header.payload) with a fake signature. */
function mintJwt(user: User, ttlSec: number, extra: Record<string, unknown> = {}): string {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({
        uid: user.id,
        email: user.email,
        name: user.display_name,
        iat: now,
        exp: now + ttlSec,
        ...extra,
    }));
    return `${header}.${payload}.mock-signature`;
}

function decodeMockJwt(token: string): Record<string, unknown> | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
        let base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
        const pad = 4 - (base64.length % 4);
        if (pad !== 4) base64 += '='.repeat(pad);
        return JSON.parse(atob(base64)) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function findByEmail(email: unknown): User | undefined {
    const needle = String(email ?? '').toLowerCase();
    return db.users.find((u) => u.email.toLowerCase() === needle);
}

function invalidCreds() {
    return { status: false, error: 'Invalid username or password', error_code: 401 };
}

/** {access_token, refresh_token} pair; auth_time carried forward on refresh. */
function tokenPair(user: User, accessTtl = ACCESS_TTL, authTime?: number) {
    const at = authTime ?? Math.floor(Date.now() / 1000);
    return {
        access_token: mintJwt(user, accessTtl, { auth_time: at }),
        refresh_token: mintJwt(user, REFRESH_TTL, { auth_time: at, token_kind: 'refresh' }),
    };
}

// Pending one-time credentials, keyed the way the server keys them.
const pendingResetCodes = new Map<string, string>(); // email → 6-digit code

function authFetch(path: string, body: Record<string, unknown>): unknown {
    // Dev knob: __mock_access_ttl mints a short-lived access token so refresh
    // paths are testable without waiting 6 hours. Mock-only; ignored by the
    // real backend (unknown params are dropped server-side).
    const accessTtl = typeof body.__mock_access_ttl === 'number' ? body.__mock_access_ttl : ACCESS_TTL;

    switch (path) {
        case '/api/login': {
            const user = findByEmail(body.username);
            if (!user || !user.is_active || body.password !== MOCK_PASSWORD) return invalidCreds();
            return { status: true, data: { ...tokenPair(user, accessTtl), user: { ...user } } };
        }
        case '/api/token/refresh': {
            const payload = decodeMockJwt(String(body.refresh_token ?? ''));
            const user = payload && db.users.find((u) => u.id === Number(payload.uid));
            const now = Math.floor(Date.now() / 1000);
            if (!payload || !user || typeof payload.exp !== 'number' || now >= payload.exp) {
                return { status: false, error: 'token is invalid or expired', error_code: 401 };
            }
            // A refresh is NOT a fresh authentication: auth_time carries forward.
            const authTime = typeof payload.auth_time === 'number' ? payload.auth_time : undefined;
            return { status: true, data: tokenPair(user, accessTtl, authTime) };
        }
        case '/api/auth/forgot': {
            const user = findByEmail(body.email);
            // Server-parity: no account-enumeration oracle — always succeeds.
            if (user && body.method !== 'link') {
                pendingResetCodes.set(user.email.toLowerCase(), '123456');
                return { status: true, data: { sent: true, method: 'code' } };
            }
            return {
                status: true,
                data: { sent: true, method: body.method ?? 'code', ...(user ? { __mock_token: `pr:mock-${user.id}` } : {}) },
            };
        }
        case '/api/auth/password/reset/code': {
            const user = findByEmail(body.email);
            const stored = user && pendingResetCodes.get(user.email.toLowerCase());
            if (!user || !stored || stored !== String(body.code)) {
                return { status: false, error: 'invalid or expired reset code', error_code: 401 };
            }
            pendingResetCodes.delete(user.email.toLowerCase());
            return { status: true, data: { ...tokenPair(user, accessTtl), user: { ...user } } };
        }
        case '/api/auth/password/reset/token': {
            const m = String(body.token ?? '').match(/^pr:mock-(\d+)$/);
            const user = m && db.users.find((u) => u.id === Number(m[1]));
            if (!user) return { status: false, error: 'invalid or expired reset token', error_code: 401 };
            return { status: true, data: { ...tokenPair(user, accessTtl), user: { ...user } } };
        }
        case '/api/auth/magic/send': {
            const user = findByEmail(body.email);
            return {
                status: true,
                data: { sent: true, ...(user ? { __mock_token: `ml:mock-${user.id}` } : {}) },
            };
        }
        case '/api/auth/magic/login': {
            const m = String(body.token ?? '').match(/^ml:mock-(\d+)$/);
            const user = m && db.users.find((u) => u.id === Number(m[1]));
            if (!user) return { status: false, error: 'invalid or expired magic link', error_code: 401 };
            return { status: true, data: { ...tokenPair(user, accessTtl), user: { ...user } } };
        }
        case '/api/auth/exchange': {
            const m = String(body.code ?? '').match(/^mock-handoff-(\d+)$/);
            const user = m && db.users.find((u) => u.id === Number(m[1]));
            if (!user) return { status: false, error: 'invalid or expired auth code', error_code: 401 };
            return { status: true, data: { ...tokenPair(user, accessTtl), user: { ...user } } };
        }
        case '/api/auth/passkeys/login/begin': {
            // Shape-level mock: a real assertion needs a registered credential
            // + authenticator; the mock validates the ceremony's plumbing.
            const user = body.username ? findByEmail(body.username) : undefined;
            if (body.username && !user) return invalidCreds();
            return {
                status: true,
                data: {
                    challenge_id: `chal-${user?.id ?? 'any'}`,
                    publicKey: {
                        challenge: b64url('mock-webauthn-challenge'),
                        rpId: 'localhost',
                        timeout: 60000,
                        userVerification: 'preferred',
                        allowCredentials: user ? [{ type: 'public-key', id: b64url(`cred-${user.id}`) }] : [],
                    },
                },
            };
        }
        case '/api/auth/passkeys/login/complete': {
            const m = String(body.challenge_id ?? '').match(/^chal-(\d+|any)$/);
            if (!m || !body.credential) return { status: false, error: 'invalid passkey assertion', error_code: 401 };
            const user = m[1] === 'any' ? db.users[0]! : db.users.find((u) => u.id === Number(m[1]));
            if (!user) return { status: false, error: 'invalid passkey assertion', error_code: 401 };
            return { status: true, data: { ...tokenPair(user, accessTtl), user: { ...user } } };
        }
        default:
            return { status: false, error: `No mock for ${path}`, error_code: 404 };
    }
}

// Per-endpoint call counts — lets dev tooling assert single-flight behavior
// (e.g. three concurrent refreshes must produce ONE '/api/token/refresh').
const callCounts = new Map<string, number>();

export function getMockCallCounts(): Record<string, number> {
    return Object.fromEntries(callCounts);
}

const LATENCY_MS = 220;

export interface MockFetchOpts {
    params?: Params;
    method?: string;
    body?: Record<string, unknown>;
    /** Forwarded by the transport; auth endpoints ignore it, data endpoints will enforce it come C3. */
    headers?: Record<string, string>;
}

/**
 * Role → permissions, the way a django-mojo deployment typically grants
 * them. The admin role carries the system `admin` wildcard as the loose `1`
 * the backend stores (exercises the `== true` compatibility); staff gets the
 * `users` CATEGORY (rollup demo: covers view_users/manage_users/view_members)
 * plus view_admin. Nobody is is_superuser — that flag would short-circuit
 * every permission path this mock exists to exercise.
 */
function meDict(user: User) {
    const permissions =
        user.role === 'admin' ? { admin: 1 }
        : user.role === 'staff' ? { users: true, view_admin: true }
        : {};
    return { ...user, is_superuser: false, permissions };
}

/** The bearer's user, when a valid unexpired mock JWT is presented. */
function userFromBearer(headers: Record<string, string> | undefined): User | undefined {
    const bearer = (headers?.['Authorization'] ?? '').replace(/^Bearer /, '');
    if (!bearer) return undefined;
    const payload = decodeMockJwt(bearer);
    const now = Math.floor(Date.now() / 1000);
    if (!payload || typeof payload.exp !== 'number' || now >= payload.exp) return undefined;
    return db.users.find((u) => u.id === Number(payload.uid));
}

/** Mock transport. Same signature the real fetch path resolves through. */
export async function mockFetch(path: string, opts: MockFetchOpts): Promise<unknown> {
    const key = `${opts.method ?? 'GET'} ${path}`;
    callCounts.set(key, (callCounts.get(key) ?? 0) + 1);
    await new Promise((r) => setTimeout(r, LATENCY_MS));
    if (path === '/api/login' || path === '/api/token/refresh' || path.startsWith('/api/auth/')) {
        return authFetch(path, opts.body ?? {});
    }
    if (path === '/api/user/me' || path === '/api/account/user/me') {
        // The first authed mock endpoint — meaningless without a session,
        // exactly like the real backend's @requires_auth.
        const user = userFromBearer(opts.headers);
        if (!user) return { status: false, error: 'permission denied', error_code: 401 };
        return { status: true, data: meDict(user) };
    }
    const memberMatch = path.match(/^\/api\/group\/(\d+)\/member$/);
    if (memberMatch) {
        // The signed-in user's membership in one group — the group-context
        // permission source (@requires_auth on the real backend).
        const user = userFromBearer(opts.headers);
        if (!user) return { status: false, error: 'permission denied', error_code: 401 };
        const groupId = Number(memberMatch[1]);
        if (!db.groups.some((g) => g.id === groupId)) {
            return { status: false, error: 'Group not found', error_code: 404 };
        }
        // Deterministic per (user, group) so group-context behavior is
        // demoable: user 1 (Ian, plain role) is GROUP ADMIN of odd-id groups
        // and a bare member of even ones — picking an odd group lights up
        // member-admin-gated UI; staff manage their groups; admin-role users
        // are group admins everywhere.
        const permissions =
            user.role === 'admin' ? { admin: 1 }
            : user.role === 'staff' ? { manage_group: true, view_members: true }
            : user.id === 1 && groupId % 2 === 1 ? { admin: true }
            : {};
        return {
            status: true,
            data: {
                id: groupId * 1000 + user.id,
                user_id: user.id,
                group_id: groupId,
                role: 'admin' in permissions ? 'admin' : 'member',
                permissions,
            },
        };
    }
    const oneGroup = path.match(/^\/api\/group\/(\d+)$/);
    if (oneGroup) {
        const group = db.groups.find((g) => g.id === Number(oneGroup[1]));
        if (!group) return { status: false, error: 'Group not found', error_code: 404 };
        return { status: true, data: { ...group } };
    }
    if (path === '/api/group') {
        return listRows(db.groups as unknown as Record<string, unknown>[], opts.params ?? {}, (g) => String(g.name), 'name');
    }
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
