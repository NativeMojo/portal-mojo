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
import { markdownToHtml } from './markdown-parse';
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

/**
 * Internal user record: the serialized row (real /api/user default-graph
 * shape, epoch-second datetimes) PLUS server-private fields the wire never
 * carries — `created` exists on the model (so `sort=-created` works, exactly
 * like the real backend) but is NOT in the default graph; serializeUser
 * strips it.
 */
export type MockUser = User & { created: number };

const PRIVATE_USER_FIELDS = new Set(['created']);

function serializeUser(u: MockUser): User {
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(u)) {
        if (!PRIVATE_USER_FIELDS.has(k)) row[k] = v;
    }
    return row as unknown as User;
}

function buildUsers(): MockUser[] {
    const rand = mulberry32(20260804);
    const nowSec = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    const users: MockUser[] = [];
    for (let i = 1; i <= 57; i++) {
        const fn = FIRST[Math.floor(rand() * FIRST.length)];
        const ln = LAST[Math.floor(rand() * LAST.length)];
        const createdDays = Math.floor(rand() * 380) + 3;
        const active = rand() > 0.14;
        const loggedInDays = Math.floor(rand() * createdDays);
        const lastLogin = active && rand() > 0.1 ? nowSec - loggedInDays * DAY - Math.floor(rand() * DAY) : null;
        const username = `${fn.toLowerCase()}.${ln.toLowerCase()}${i}`;
        // Permission spread mirrors a real deployment: a few superusers, a
        // band of users-category admins (staff-equivalent), most unprivileged.
        const r = rand();
        const isSuper = r > 0.95;
        // The loose `1` (not `true`) is deliberate — the backend stores both;
        // A2's `== true`-compatible checks must keep being exercised.
        const permissions = !isSuper && r > 0.8 ? { users: 1, view_admin: 1 } : {};
        users.push({
            id: i,
            first_name: fn,
            last_name: ln,
            display_name: `${fn} ${ln}`,
            username,
            email: `${username}@nativemojo.com`,
            phone_number: rand() > 0.55 ? `+1 (555) 0${String(100 + Math.floor(rand() * 899))}` : null,
            is_active: active,
            is_superuser: isSuper,
            is_email_verified: rand() > 0.18,
            is_phone_verified: rand() > 0.65,
            is_dob_verified: false,
            is_online: active && rand() > 0.85,
            last_login: lastLogin,
            last_activity: lastLogin ? lastLogin + Math.floor(rand() * DAY) : null,
            permissions,
            metadata: {},
            dob: null,
            avatar: null,
            org: null,
            created: nowSec - createdDays * DAY,
        });
    }
    // Row 1 mirrors the reference screenshot.
    users[0] = {
        ...users[0]!,
        first_name: 'Ian', last_name: 'Starnes', display_name: 'Ian Starnes',
        username: 'ian', email: 'ian@mojoverify.com', phone_number: null,
        is_active: true, is_superuser: false, is_email_verified: true,
        is_phone_verified: false, is_online: true, permissions: {},
        created: Math.floor(Date.parse('2026-07-10T14:00:00Z') / 1000),
        last_login: nowSec - 21 * DAY, last_activity: nowSec - 20 * DAY,
    };
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
    created: number; // epoch seconds, like every mojo datetime
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
            created: Math.floor((now - (420 - oi * 40) * 864e5) / 1000),
        };
        groups.push(org);
        const teamCount = 2 + (oi % 2);
        for (let t = 0; t < teamCount; t++) {
            const team: MockGroup = {
                id: id++, name: TEAM_NAMES[t]!, kind: 'team',
                parent: { id: org.id, name: org.name, kind: 'org' },
                created: Math.floor((now - (400 - oi * 40 - t * 5) * 864e5) / 1000),
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
            created: Math.floor((now - (120 - pi * 30) * 864e5) / 1000),
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
// download_format/filename are export controls (rest.py reserved_keys), not
// field lookups.
const RESERVED = new Set(['start', 'size', 'sort', 'search', 'graph', 'dr_field', 'dr_start', 'dr_end', 'download_format', 'filename']);

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
    // Search matches the model's real SEARCH_FIELDS: username, email,
    // display_name, phone_number (account/models/user.py RestMeta).
    const result = listRows(
        db.users as unknown as Record<string, unknown>[],
        params,
        (u) => `${u.username} ${u.email} ${u.display_name} ${u.phone_number ?? ''}`,
    );
    return { ...result, data: (result.data as unknown as MockUser[]).map(serializeUser) };
}

/**
 * `download_format=csv|json` on the list endpoint (mojo/models/rest.py
 * on_rest_list_response): the WHOLE filtered set — same pipeline, no paging —
 * as a file. The mock returns the file body in the envelope
 * ({filename, content, mime}); the client turns it into a Blob download.
 */
function exportUsers(params: Params) {
    const format = String(params.download_format);
    const full = listUsers({ ...params, start: 0, size: db.users.length });
    const rows = full.data as unknown as Record<string, unknown>[];
    const filename = String(params.filename ?? `User.${format}`);
    if (format === 'csv') {
        const cols = rows.length > 0 ? Object.keys(rows[0]!) : [];
        const cell = (v: unknown) => {
            const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const content = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
        return { status: true, data: { filename, content, mime: 'text/csv' } };
    }
    return { status: true, data: { filename, content: JSON.stringify(rows, null, 2), mime: 'application/json' } };
}

// ── POST_SAVE_ACTIONS (User) ──────────────────────────────────────────
// Mirrors mojo/models/rest.py on_rest_save: action keys are pulled OUT of the
// save body, plain fields save first, then each action handler runs — and the
// response is the refreshed row UNLESS a handler returned its own payload
// (action_resp wins verbatim). The mocked subset matches django-mojo
// account/models/user.py RestMeta.POST_SAVE_ACTIONS (which also declares
// change_username + the TOTP trio — unmocked until a screen needs them).
const USER_ACTIONS = new Set(['send_invite', 'disable', 'reactivate', 'revoke_sessions']);
const USER_DISABLE_REASONS = new Set(['abuse', 'admin']); // services/disable.py USER_REST_REASONS

function runUserAction(user: MockUser, action: string, value: unknown): Record<string, unknown> | null {
    const dict = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    switch (action) {
        case 'disable': {
            // Backend parity: reason is REQUIRED and validated against the
            // service's frozenset; a bad one rejects the whole save.
            const reason = String(dict.reason ?? '');
            if (!USER_DISABLE_REASONS.has(reason)) {
                return { status: false, error: `reason must be one of: ${[...USER_DISABLE_REASONS].sort().join(', ')}`, error_code: 400 };
            }
            user.is_active = false;
            return null;
        }
        case 'reactivate':
            user.is_active = true;
            return null;
        case 'send_invite':
            // Sends mail server-side; the REST-visible effect is just the row.
            return null;
        case 'revoke_sessions':
            // Handler returns its own payload — the response is NOT the row.
            return { status: true, message: 'Sessions revoked. Re-authenticate to continue.' };
        default:
            return null;
    }
}

function saveUser(user: MockUser, body: Record<string, unknown>): unknown {
    const fields: Record<string, unknown> = {};
    const actionEntries: [string, unknown][] = [];
    for (const [key, value] of Object.entries(body)) {
        if (USER_ACTIONS.has(key)) actionEntries.push([key, value]);
        else fields[key] = value;
    }
    Object.assign(user, fields);
    let actionResp: Record<string, unknown> | null = null;
    for (const [action, value] of actionEntries) {
        const resp = runUserAction(user, action, value);
        if (resp) {
            if (resp.status === false) return resp; // action error rejects the request
            actionResp = resp;
        }
    }
    return actionResp ?? { status: true, data: serializeUser(user) };
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

    if (wanted.length === 0) {
        // Backend parity: slug(s) are required, not defaulted.
        return { status: false, error: 'missing required parameter: slug, slugs, or category', error_code: 400 };
    }
    const picked = SERIES.filter((s) => wanted.includes(s.slug));
    // Longer buckets aggregate more events — scale so totals stay coherent.
    const scale = bucket / 3600e3;
    // Real wire shape (verified live): a slug-keyed series map + labels. No
    // datasets array, no granularity/range echo — the client normalizes.
    const data: Record<string, number[]> = {};
    picked.forEach((s, i) => {
        data[s.slug] = times.map((t) => Math.round(sample(i, t, s.base, s.spread) * Math.max(0.15, scale)));
    });

    return { status: true, data: { data, labels } };
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

function findByEmail(email: unknown): MockUser | undefined {
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
            return { status: true, data: { ...tokenPair(user, accessTtl), user: serializeUser(user) } };
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
            return { status: true, data: { ...tokenPair(user, accessTtl), user: serializeUser(user) } };
        }
        case '/api/auth/password/reset/token': {
            const m = String(body.token ?? '').match(/^pr:mock-(\d+)$/);
            const user = m && db.users.find((u) => u.id === Number(m[1]));
            if (!user) return { status: false, error: 'invalid or expired reset token', error_code: 401 };
            return { status: true, data: { ...tokenPair(user, accessTtl), user: serializeUser(user) } };
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
            return { status: true, data: { ...tokenPair(user, accessTtl), user: serializeUser(user) } };
        }
        case '/api/auth/exchange': {
            const m = String(body.code ?? '').match(/^mock-handoff-(\d+)$/);
            const user = m && db.users.find((u) => u.id === Number(m[1]));
            if (!user) return { status: false, error: 'invalid or expired auth code', error_code: 401 };
            return { status: true, data: { ...tokenPair(user, accessTtl), user: serializeUser(user) } };
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
            return { status: true, data: { ...tokenPair(user, accessTtl), user: serializeUser(user) } };
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
 * The `me` graph = the default row plus me-only fields (verified live:
 * has_passkey + requires_mfa ride only /api/user/me). Permissions come from
 * the row itself now — buildUsers seeds the spread (superusers, users-category
 * admins with the loose `1`-style truthy values, unprivileged rest).
 */
function meDict(user: MockUser) {
    return { ...serializeUser(user), has_passkey: false, requires_mfa: false };
}

/** The bearer's user, when a valid unexpired mock JWT is presented. */
function userFromBearer(headers: Record<string, string> | undefined): MockUser | undefined {
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
    if (path === '/api/user/me') {
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
        // demoable: user 1 (Ian, unprivileged) is GROUP ADMIN of odd-id
        // groups and a bare member of even ones — picking an odd group
        // lights up member-admin-gated UI; users-category holders manage
        // their groups; superusers are group admins everywhere.
        const permissions =
            user.is_superuser ? { admin: 1 }
            : user.permissions['users'] ? { manage_group: true, view_members: true }
            : user.id === 1 && groupId % 2 === 1 ? { admin: true }
            : {};
        return {
            status: true,
            data: {
                id: groupId * 1000 + user.id,
                created: Math.floor(Date.now() / 1000),
                modified: Math.floor(Date.now() / 1000),
                is_active: true,
                permissions,
                metadata: {},
                user: serializeUser(user),
                group: groupId,
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
    if (path === '/api/docit/render') {
        // Backend parity — mojo/apps/docit/rest/render.py: POST only, the
        // `markdown` field is required, 400KB cap, and the handler returns a
        // bare dict so the framework wraps it as {status, data:{html}}.
        // markdownToHtml is the SAME parser the client fallback renders from,
        // so mock and live differ in fidelity, not in shape — and its output
        // goes through the sanitizer on the way in like any server HTML.
        if (opts.method !== 'POST') return { status: false, error: 'Method not allowed', error_code: 405 };
        const markdown = opts.body?.markdown;
        if (typeof markdown !== 'string' || !markdown) return { status: false, error: 'markdown field is required', error_code: 400 };
        if (new TextEncoder().encode(markdown).length > 400_000) return { status: false, error: 'markdown input too large', error_code: 413 };
        return { status: true, data: { html: markdownToHtml(markdown) } };
    }
    const one = path.match(/^\/api\/user\/(\d+)$/);
    if (one) {
        const id = Number(one[1]);
        const user = db.users.find((u) => u.id === id);
        if (!user) return { status: false, error: 'User not found', error_code: 404 };
        if (opts.method === 'DELETE') {
            db.users = db.users.filter((u) => u.id !== id);
            // Backend parity (mojo/models/rest.py on_rest_delete): status is
            // the STRING "deleted" — the envelope's one non-boolean status.
            return { status: 'deleted' };
        }
        if (opts.method === 'POST' && opts.body) {
            return saveUser(user, opts.body);
        }
        return { status: true, data: serializeUser(user) };
    }
    if (path === '/api/user') {
        if (opts.params?.download_format) return exportUsers(opts.params);
        if (opts.method === 'POST' && opts.body) {
            const id = Math.max(...db.users.map((u) => u.id)) + 1;
            const email = String(opts.body.email ?? `user${id}@nativemojo.com`);
            // Backend parity: username derives from the email localpart when
            // the body omits it (verified live: portal_victim@… → portal_victim).
            const username = String(opts.body.username ?? '') || email.split('@')[0]!;
            const user: MockUser = {
                id,
                first_name: '',
                last_name: '',
                display_name: String(opts.body.display_name ?? 'New User'),
                username,
                email,
                phone_number: (opts.body.phone_number as string) || null,
                is_active: true,
                is_superuser: false,
                is_email_verified: false,
                is_phone_verified: false,
                is_dob_verified: false,
                is_online: false,
                last_login: null,
                last_activity: null,
                permissions: {},
                metadata: {},
                dob: null,
                avatar: null,
                org: null,
                created: Math.floor(Date.now() / 1000),
            };
            db.users.unshift(user);
            return { status: true, data: serializeUser(user) };
        }
        return listUsers(opts.params ?? {});
    }
    return { status: false, error: `No mock for ${path}`, error_code: 404 };
}
