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
 * Internal user record: the serialized row (epoch-second datetimes) PLUS
 * server-private fields the wire never carries — `created` exists on the
 * model (so `sort=-created` works, exactly like the real backend) but is in
 * NO user graph; serializeUser strips it.
 *
 * Graph parity (django-mojo account/models/user.py GRAPHS, read 2026-08-05):
 *   list    — the row incl. `is_online`, excl. requires_mfa/has_passkey
 *   default — one-record GETs: + requires_mfa + has_passkey, NO is_online
 *   basic   — the sub-graph embedded on device/login rows
 * `is_staff` is in no graph at all — never serialized here either.
 */
export type MockUser = User & { created: number; requires_mfa: boolean };

const PRIVATE_USER_FIELDS = new Set(['created', 'requires_mfa']);

function serializeUser(u: MockUser, graph: 'list' | 'default' = 'list'): User {
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(u)) {
        if (!PRIVATE_USER_FIELDS.has(k)) row[k] = v;
    }
    if (graph === 'default') {
        delete row.is_online; // list-graph-only field
        row.requires_mfa = u.requires_mfa;
        row.has_passkey = db.passkeys.some((p) => p.user === u.id && p.is_enabled);
    }
    return row as unknown as User;
}

/** The "basic" user sub-graph other models embed (devices, logins, passkeys). */
function userBasic(u: MockUser): Record<string, unknown> {
    return {
        id: u.id,
        display_name: u.display_name,
        username: u.username,
        last_login: u.last_login,
        last_activity: u.last_activity,
        is_active: u.is_active,
        is_email_verified: u.is_email_verified,
        is_phone_verified: u.is_phone_verified,
        is_dob_verified: u.is_dob_verified,
        avatar: u.avatar ?? null,
    };
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
            requires_mfa: false,
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
// them unambiguous. Row shape mirrors the live /api/group default graph
// exactly (measured 2026-08-05): {id, uuid, name, created, modified,
// last_activity, is_active, kind, parent(basic|null), auth_domain,
// metadata, member_count, avatar}.
export interface MockGroup {
    id: number;
    uuid: string | null;
    name: string;
    kind: string;
    parent: Record<string, unknown> | null;
    created: number; // epoch seconds, like every mojo datetime
    modified: number;
    last_activity: number | null;
    is_active: boolean;
    auth_domain: string | null;
    metadata: Record<string, unknown>;
    member_count: number;
    avatar: null;
    [field: string]: unknown;
}

const ORG_NAMES = ['Acme Corp', 'Globex', 'Initech', 'Umbrella Labs', 'Stark Industries', 'Wayne Enterprises'];
const TEAM_NAMES = ['Engineering', 'Operations', 'Support'];

/** Fake uuid4().hex — 32 lowercase hex chars, deterministic per seed. */
function mockHex32(rand: () => number): string {
    let out = '';
    for (let i = 0; i < 32; i++) out += Math.floor(rand() * 16).toString(16);
    return out;
}

/** The "basic" sub-graph shape the live backend embeds for `parent`. */
function groupBasic(g: MockGroup): Record<string, unknown> {
    return {
        id: g.id, uuid: g.uuid, name: g.name, created: g.created, modified: g.modified,
        last_activity: g.last_activity, is_active: g.is_active, kind: g.kind, avatar: null,
    };
}

function buildGroups(): MockGroup[] {
    const rand = mulberry32(20260805);
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const groups: MockGroup[] = [];
    let id = 1;
    const mk = (partial: Pick<MockGroup, 'name' | 'kind' | 'created'> & Partial<MockGroup>): MockGroup => {
        const g: MockGroup = {
            id: id++,
            uuid: rand() > 0.3 ? mockHex32(rand) : null, // live rows: uuid is nullable
            parent: null,
            modified: 0,
            last_activity: rand() > 0.2 ? nowSec - Math.floor(rand() * 20) * 86400 : null,
            is_active: true,
            auth_domain: null,
            metadata: {},
            member_count: 0,
            avatar: null,
            ...partial,
        };
        g.modified = g.modified || g.created + Math.floor(rand() * 30) * 86400;
        groups.push(g);
        return g;
    };
    const engineeringTeams: MockGroup[] = [];
    ORG_NAMES.forEach((orgName, oi) => {
        const org = mk({
            name: orgName, kind: 'org',
            created: Math.floor((now - (420 - oi * 40) * 864e5) / 1000),
            metadata: oi % 2 === 0
                ? { timezone: 'America/Los_Angeles', short_name: orgName.split(' ')[0]!.toLowerCase() }
                : {},
        });
        const teamCount = 2 + (oi % 2);
        for (let t = 0; t < teamCount; t++) {
            const team = mk({
                name: TEAM_NAMES[t]!, kind: 'team',
                parent: null, // set below once org is complete
                created: Math.floor((now - (400 - oi * 40 - t * 5) * 864e5) / 1000),
                // One deterministic inactive team so Status filters/badges demo.
                is_active: !(oi === 2 && t === 1),
            });
            team.parent = groupBasic(org);
            if (t === 0) engineeringTeams.push(team);
        }
    });
    for (const [pi, name] of (['Project Apollo', 'Project Zephyr'] as const).entries()) {
        const team = engineeringTeams[pi]!;
        const project = mk({
            name, kind: 'project',
            created: Math.floor((now - (120 - pi * 30) * 864e5) / 1000),
        });
        project.parent = groupBasic(team);
    }
    return groups;
}

// ── Members ───────────────────────────────────────────────────────────
// /api/group/member rows — live shape (measured): {id, created, modified,
// is_active, permissions, metadata, user: <me-graph user dict>, group:
// <basic group>}. The `user` sub-graph on live members carries
// requires_mfa/has_passkey (same dict as /api/user/me), unlike bare list
// rows — meDict() is reused for exactly that reason.
export interface MockMember {
    id: number;
    created: number;
    modified: number;
    is_active: boolean;
    permissions: Record<string, unknown>;
    metadata: Record<string, unknown>;
    user: number;  // uid — serialized to the user dict on the way out
    group: number; // gid — serialized to the basic group dict
    [field: string]: unknown;
}

function buildMembers(users: MockUser[], groups: MockGroup[]): MockMember[] {
    const members: MockMember[] = [];
    for (const g of groups) {
        const count = 3 + (g.id % 5);
        const seen = new Set<number>();
        for (let k = 0; k < count; k++) {
            const u = users[(g.id * 7 + k * 3) % users.length]!;
            if (seen.has(u.id)) continue;
            seen.add(u.id);
            members.push({
                id: g.id * 100 + k,
                created: g.created + k * 86400,
                modified: g.created + k * 86400,
                is_active: (g.id + k) % 8 !== 5,
                permissions: k === 0 ? { admin: true } : k === 1 ? { manage_group: true, view_members: 1 } : {},
                metadata: {},
                user: u.id,
                group: g.id,
            });
        }
        g.member_count = members.filter((m) => m.group === g.id).length;
    }
    return members;
}

// ── User API keys ─────────────────────────────────────────────────────
// /api/account/api_keys rows — live default graph (measured): {id, label,
// allowed_ips, expires, is_active, last_used, created}. `user` (the owner
// FK) exists on the model — filterable via ?user=<id> — but is NOT in the
// graph; serializeApiKey strips it, exactly like MockUser.created.
export interface MockApiKey {
    id: number;
    label: string;
    allowed_ips: string[];
    expires: number;
    is_active: boolean;
    last_used: number | null;
    created: number;
    jti: string;      // server-private (SENSITIVE_FIELDS) — never serialized
    user: number;     // owner FK — filterable, not in the graph
    [field: string]: unknown;
}

const PRIVATE_APIKEY_FIELDS = new Set(['user', 'jti']);

function serializeApiKey(k: MockApiKey): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(k)) {
        if (!PRIVATE_APIKEY_FIELDS.has(key)) row[key] = v;
    }
    return row;
}

function buildApiKeys(): MockApiKey[] {
    const rand = mulberry32(20260806);
    const nowSec = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    const seeds: { user: number; label: string; ips?: string[]; ageDays: number; expireDays: number; active?: boolean; used?: number | null }[] = [
        { user: 1, label: 'CI/CD Pipeline', ips: ['203.0.113.0/24'], ageDays: 120, expireDays: 360, used: 1 },
        { user: 1, label: 'Metrics exporter', ageDays: 45, expireDays: 90, used: 3 },
        { user: 1, label: 'Legacy importer', ageDays: 400, expireDays: 360, used: 90 }, // expired
        { user: 1, label: 'Staging smoke tests', ageDays: 30, expireDays: 60, active: false, used: 12 }, // revoked
        { user: 2, label: 'Mobile app backend', ips: ['10.0.0.1'], ageDays: 80, expireDays: 180, used: 0 },
        { user: 3, label: 'Data warehouse sync', ageDays: 15, expireDays: 30, used: null },
        { user: 5, label: 'Webhook relay', ageDays: 200, expireDays: 360, used: 5 },
        { user: 8, label: '', ageDays: 10, expireDays: 90, used: null }, // label is blank-able (default "")
    ];
    return seeds.map((s, i) => {
        const created = nowSec - s.ageDays * DAY;
        return {
            id: i + 1,
            label: s.label,
            allowed_ips: s.ips ?? [],
            expires: created + s.expireDays * DAY,
            is_active: s.active ?? true,
            last_used: s.used == null ? null : nowSec - s.used * DAY - Math.floor(rand() * DAY),
            created,
            jti: mockHex32(rand),
            user: s.user,
        };
    });
}

// ── Logs ──────────────────────────────────────────────────────────────
// /api/logs rows — live default graph (measured): {id, created, level, kind,
// method, path, payload, ip, duid, uid, gid, username, user_agent, log,
// model_name, model_id}. graph=basic narrows to the id/created/level/kind/
// method/path/ip/uid/gid/username/model_name/model_id subset.
export interface MockLog {
    id: number;
    created: number;
    level: string;
    kind: string | null;
    method: string | null;
    path: string | null;
    payload: string | null;
    ip: string | null;
    duid: string | null;
    uid: number;
    gid: number;
    username: string | null;
    user_agent: string | null;
    log: string | null;
    model_name: string | null;
    model_id: number;
    [field: string]: unknown;
}

const LOG_BASIC_FIELDS = [
    'id', 'created', 'level', 'kind', 'method', 'path',
    'ip', 'uid', 'gid', 'username', 'model_name', 'model_id',
] as const;

function serializeLog(l: MockLog, graph: string): Record<string, unknown> {
    if (graph === 'basic') {
        const row: Record<string, unknown> = {};
        for (const f of LOG_BASIC_FIELDS) row[f] = l[f];
        return row;
    }
    return { ...l };
}

const LOG_PATHS = ['/api/user', '/api/group', '/api/user/me', '/api/metrics/fetch', '/api/logs', '/api/account/api_keys', '/api/login', '/favicon.ico'];
const LOG_AGENTS = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/141.0',
    'python-requests/2.32.0',
];

function buildLogs(users: MockUser[], groups: MockGroup[]): MockLog[] {
    const rand = mulberry32(20260807);
    const nowSec = Math.floor(Date.now() / 1000);
    const logs: MockLog[] = [];
    let created = nowSec - 120; // newest ~2 minutes ago
    for (let i = 0; i < 140; i++) {
        const r = rand();
        // Weighted kind mix roughly matching a real request log.
        const kind = r < 0.3 ? 'request'
            : r < 0.55 ? 'response'
            : r < 0.63 ? 'login'
            : r < 0.7 ? 'error'
            : r < 0.8 ? 'model_change'
            : r < 0.86 ? 'api_key:generated'
            : r < 0.9 ? 'user:disabled'
            : 'cron';
        const level = kind === 'error'
            ? (rand() > 0.85 ? 'critical' : 'error')
            : rand() > 0.88 ? 'warning' : 'info';
        const user = rand() > 0.4 ? users[Math.floor(rand() * users.length)]! : null;
        const group = rand() > 0.6 ? groups[Math.floor(rand() * groups.length)]! : null;
        const method = kind === 'cron' ? null : rand() > 0.55 ? 'POST' : 'GET';
        const path = kind === 'cron' ? null : LOG_PATHS[Math.floor(rand() * LOG_PATHS.length)]!;
        const isModelKind = kind === 'model_change' || kind === 'user:disabled';
        logs.push({
            id: 100000 - i, // live ids descend with age (default sort is -id)
            created,
            level,
            kind,
            method,
            path,
            payload: method === 'POST' && rand() > 0.5
                ? JSON.stringify({ size: 25, start: 0, sort: '-created' })
                : null,
            ip: rand() > 0.3 ? `10.1.2.${Math.floor(rand() * 250)}` : '127.0.0.1',
            duid: rand() > 0.7 ? mockHex32(rand).slice(0, 16) : null,
            uid: user?.id ?? 0,
            gid: group?.id ?? 0,
            username: user?.username ?? null,
            user_agent: kind === 'cron' ? 'system' : LOG_AGENTS[Math.floor(rand() * LOG_AGENTS.length)]!,
            log: kind === 'error'
                ? `Traceback (most recent call last): ValueError: invalid literal at ${path ?? 'task'}`
                : kind === 'login' ? `login ok for ${user?.username ?? 'unknown'}`
                : kind === 'user:disabled' ? `disabled reason=admin by=${user?.username ?? 'system'}`
                : kind === 'api_key:generated' ? `API Key Generated ${mockHex32(rand).slice(0, 8)} expire 90 days`
                : kind === 'cron' ? 'nightly metrics rollup completed'
                : `${method} ${path} 200`,
            model_name: isModelKind ? 'account.User' : null,
            model_id: isModelKind && user ? user.id : 0,
        });
        // Walk backwards 10min–4h per row → ~14 days of history.
        created -= 600 + Math.floor(rand() * 13800);
    }
    return logs;
}

// ── UserView-parity stores (wave: port/user-view-parity) ──────────────
// Shapes mirror the LIVE graphs measured 2026-08-05 (mverify @9009 +
// django-mojo model RestMeta) — notably: push devices are the real
// RegisteredDevice shape (platform/device_name/os_version), NOT web-mojo's
// assumed device_info block; login events carry NO event_type; incident
// events' prose field is `details`.

/** ua-parser block exactly as /api/user/device serializes it. */
interface MockUAInfo {
    os: { major: string | null; minor: string | null; patch: string | null; family: string; patch_minor: string | null };
    device: { brand: string | null; model: string | null; family: string };
    user_agent: { major: string | null; minor: string | null; patch: string | null; family: string };
    string: string;
}

interface MockDevice {
    id: number;
    user: number; // uid — serialized to the basic user sub-graph
    muid: string | null;
    duid: string;
    device_info: MockUAInfo | null;
    user_agent_hash: string | null;
    last_ip: string | null;
    first_seen: number;
    last_seen: number;
    [field: string]: unknown;
}

interface MockPushDevice {
    id: number;
    user: number;
    device_id: string;
    platform: string;
    device_name: string;
    app_version: string;
    os_version: string;
    push_enabled: boolean;
    push_preferences: Record<string, unknown>;
    last_seen: number;
    [field: string]: unknown;
}

interface MockLoginEvent {
    id: number;
    user: number;
    ip_address: string | null;
    country_code: string | null;
    region: string | null;
    region_code: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    source: string | null;
    is_new_country: boolean;
    is_new_region: boolean;
    created: number;
    [field: string]: unknown;
}

interface MockIncidentEvent {
    id: number;
    created: number;
    level: number;
    scope: string;
    category: string;
    source_ip: string | null;
    hostname: string | null;
    uid: number | null;
    country_code: string | null;
    title: string | null;
    details: string | null;
    model_name: string | null;
    model_id: number | null;
    metadata: Record<string, unknown>;
    group_id: number | null;
    [field: string]: unknown;
}

interface MockPasskey {
    id: number;
    user: number;
    friendly_name: string | null;
    credential_id: string;
    rp_id: string;
    is_enabled: boolean;
    sign_count: number;
    transports: string | null;
    aaguid: string | null;
    last_used: number | null;
    created: number;
    [field: string]: unknown;
}

interface MockOAuthConnection {
    id: number;
    user: number;
    provider: string;
    email: string | null;
    is_active: boolean;
    created: number;
    [field: string]: unknown;
}

const UA_CHROME_MAC: MockUAInfo = {
    os: { major: '10', minor: '15', patch: '7', family: 'Mac OS X', patch_minor: null },
    device: { brand: 'Apple', model: 'Mac', family: 'Mac' },
    user_agent: { major: '148', minor: '0', patch: '7778', family: 'Chrome' },
    string: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.280 Safari/537.36',
};
const UA_FIREFOX_WIN: MockUAInfo = {
    os: { major: '10', minor: null, patch: null, family: 'Windows', patch_minor: null },
    device: { brand: null, model: null, family: 'Other' },
    user_agent: { major: '141', minor: '0', patch: null, family: 'Firefox' },
    string: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0',
};
const UA_SAFARI_IPHONE: MockUAInfo = {
    os: { major: '19', minor: '2', patch: null, family: 'iOS', patch_minor: null },
    device: { brand: 'Apple', model: 'iPhone', family: 'iPhone' },
    user_agent: { major: '19', minor: '2', patch: null, family: 'Mobile Safari' },
    string: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.2 Mobile/15E148 Safari/604.1',
};
const UA_CURL: MockUAInfo = {
    os: { major: null, minor: null, patch: null, family: 'Other', patch_minor: null },
    device: { brand: null, model: null, family: 'Other' },
    user_agent: { major: '8', minor: '7', patch: '1', family: 'curl' },
    string: 'curl/8.7.1',
};

/** Fake uuid4 with dashes (live DUIDs come in this shape). */
function mockUuid(rand: () => number): string {
    const h = mockHex32(rand);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function buildDevices(): MockDevice[] {
    const rand = mulberry32(20260808);
    const nowSec = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    const seeds: { user: number; ua: MockUAInfo; lastSeenDays: number; ageDays: number; ip: string; hashDuid?: boolean }[] = [
        { user: 1, ua: UA_CHROME_MAC, lastSeenDays: 0, ageDays: 120, ip: '73.92.14.5' },
        { user: 1, ua: UA_SAFARI_IPHONE, lastSeenDays: 2, ageDays: 90, ip: '172.58.27.101' },
        { user: 1, ua: UA_FIREFOX_WIN, lastSeenDays: 34, ageDays: 200, ip: '73.92.14.5' },
        // Live parity: API-born devices get the `ua-hash-…` DUID variant.
        { user: 1, ua: UA_CURL, lastSeenDays: 5, ageDays: 5, ip: '127.0.0.1', hashDuid: true },
        { user: 2, ua: UA_CHROME_MAC, lastSeenDays: 1, ageDays: 60, ip: '98.51.100.23' },
        { user: 2, ua: UA_SAFARI_IPHONE, lastSeenDays: 0, ageDays: 30, ip: '98.51.100.23' },
        { user: 3, ua: UA_FIREFOX_WIN, lastSeenDays: 7, ageDays: 45, ip: '203.0.113.9' },
        { user: 9, ua: UA_CHROME_MAC, lastSeenDays: 80, ageDays: 300, ip: '198.51.100.77' },
    ];
    return seeds.map((s, i) => ({
        id: 1200 - i,
        user: s.user,
        muid: mockHex32(rand),
        duid: s.hashDuid ? `ua-hash-${mockHex32(rand)}${mockHex32(rand)}` : mockUuid(rand),
        device_info: s.ua,
        user_agent_hash: mockHex32(rand) + mockHex32(rand),
        last_ip: s.ip,
        first_seen: nowSec - s.ageDays * DAY,
        last_seen: nowSec - s.lastSeenDays * DAY - Math.floor(rand() * 4000),
    }));
}

function buildPushDevices(): MockPushDevice[] {
    const nowSec = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    const seeds: { user: number; platform: string; name: string; os: string; app: string; enabled?: boolean; lastSeenDays: number }[] = [
        { user: 1, platform: 'ios', name: "Ian's iPhone", os: '19.2', app: '2.4.1', lastSeenDays: 0 },
        { user: 1, platform: 'web', name: 'Chrome on Mac', os: 'macOS 15', app: '2.4.1', enabled: false, lastSeenDays: 12 },
        { user: 2, platform: 'android', name: 'Pixel 11', os: '17', app: '2.3.9', lastSeenDays: 1 },
    ];
    return seeds.map((s, i) => ({
        id: 300 + i,
        user: s.user,
        device_id: `dev-${s.user}-${i}`,
        platform: s.platform,
        device_name: s.name,
        app_version: s.app,
        os_version: s.os,
        push_enabled: s.enabled ?? true,
        push_preferences: {},
        last_seen: nowSec - s.lastSeenDays * DAY - 1800,
    }));
}

const LOGIN_GEOS: { ip: string; cc: string | null; region: string | null; rc: string | null; city: string | null; lat: number | null; lng: number | null }[] = [
    { ip: '73.92.14.5', cc: 'US', region: 'California', rc: 'CA', city: 'San Diego', lat: 32.7157, lng: -117.1611 },
    { ip: '172.58.27.101', cc: 'US', region: 'Texas', rc: 'TX', city: 'Austin', lat: 30.2672, lng: -97.7431 },
    { ip: '98.51.100.23', cc: 'DE', region: 'Berlin', rc: 'BE', city: 'Berlin', lat: 52.52, lng: 13.405 },
    // Live parity: private-range logins geolocate as region "Private".
    { ip: '127.0.0.1', cc: null, region: 'Private', rc: null, city: null, lat: null, lng: null },
    { ip: '203.0.113.9', cc: 'GB', region: 'England', rc: 'ENG', city: 'London', lat: 51.5072, lng: -0.1276 },
];
const LOGIN_SOURCES = ['password', 'password', 'magic', 'passkey'];

function buildLoginEvents(users: MockUser[]): MockLoginEvent[] {
    const rand = mulberry32(20260809);
    const nowSec = Math.floor(Date.now() / 1000);
    const events: MockLoginEvent[] = [];
    let id = 14400;
    // Dense history for the detail-view seeds, sparse for the rest.
    for (const uid of [1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 9, 10]) {
        const geo = LOGIN_GEOS[Math.floor(rand() * LOGIN_GEOS.length)]!;
        const daysAgo = events.filter((e) => e.user === uid).length * (uid === 1 ? 2 : 9) + rand() * 2;
        events.push({
            id: id--,
            user: uid,
            ip_address: geo.ip,
            country_code: geo.cc,
            region: geo.region,
            region_code: geo.rc,
            city: geo.city,
            latitude: geo.lat,
            longitude: geo.lng,
            source: LOGIN_SOURCES[Math.floor(rand() * LOGIN_SOURCES.length)]!,
            is_new_country: rand() > 0.9,
            is_new_region: rand() > 0.8,
            created: nowSec - Math.floor(daysAgo * 86400) - Math.floor(rand() * 7200),
        });
    }
    // Guard: seeds only reference seeded users.
    return events.filter((e) => users.some((u) => u.id === e.user));
}

function buildIncidentEvents(): MockIncidentEvent[] {
    const nowSec = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    const seeds: { uid: number; cat: string; title: string; details: string | null; level: number; days: number; ip?: string }[] = [
        { uid: 1, cat: 'magic_login', title: 'ian requested a magic login link via email', details: null, level: 3, days: 1 },
        { uid: 1, cat: 'invalid_password', title: 'ian entered an invalid password', details: 'Attempt from 73.92.14.5 (San Diego, US)', level: 5, days: 6, ip: '73.92.14.5' },
        { uid: 3, cat: 'login_throttled', title: 'Login attempts throttled', details: '11 failed attempts within the 15-minute window', level: 6, days: 0 },
        { uid: 4, cat: 'account.user_disabled', title: 'User disabled (reason=admin)', details: 'Disabled by ian: repeated ToS violations', level: 6, days: 12 },
        { uid: 5, cat: 'account.user_disabled', title: 'User disabled (reason=abuse)', details: 'Banned by automated abuse sweep', level: 8, days: 30 },
    ];
    return seeds.map((s, i) => ({
        id: 9000 - i,
        created: nowSec - s.days * DAY - 3600,
        level: s.level,
        scope: 'global',
        category: s.cat,
        source_ip: s.ip ?? null,
        hostname: 'mojo-1',
        uid: s.uid,
        country_code: null,
        title: s.title,
        details: s.details,
        model_name: 'account.User',
        model_id: s.uid,
        metadata: {},
        group_id: null,
    }));
}

function buildPasskeys(): MockPasskey[] {
    const rand = mulberry32(20260810);
    const nowSec = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    const seeds: { user: number; name: string | null; ageDays: number; usedDays: number | null; count: number; enabled?: boolean; transports?: string }[] = [
        { user: 1, name: 'Mac — Chrome', ageDays: 140, usedDays: 1, count: 212, transports: 'internal,hybrid' },
        { user: 2, name: 'iPhone — Safari', ageDays: 60, usedDays: 0, count: 88, transports: 'internal' },
        { user: 2, name: null, ageDays: 300, usedDays: null, count: 0, enabled: false, transports: 'usb' },
    ];
    return seeds.map((s, i) => ({
        id: 70 + i,
        user: s.user,
        friendly_name: s.name,
        credential_id: mockHex32(rand) + mockHex32(rand),
        rp_id: 'localhost',
        is_enabled: s.enabled ?? true,
        sign_count: s.count,
        transports: s.transports ?? null,
        aaguid: mockUuid(rand),
        last_used: s.usedDays == null ? null : nowSec - s.usedDays * DAY - 900,
        created: nowSec - s.ageDays * DAY,
    }));
}

function buildOAuthConnections(): MockOAuthConnection[] {
    const nowSec = Math.floor(Date.now() / 1000);
    return [
        { id: 11, user: 1, provider: 'google', email: 'ian@nativemojo.com', is_active: true, created: nowSec - 200 * 86400 },
        { id: 12, user: 2, provider: 'google', email: 'maya@nativemojo.com', is_active: true, created: nowSec - 90 * 86400 },
        { id: 13, user: 2, provider: 'github', email: 'maya-dev@users.noreply.github.com', is_active: true, created: nowSec - 40 * 86400 },
    ];
}

/**
 * Per-user notification preferences — the notification_prefs service shape:
 * kind → {in_app|email|push: bool}. Absent kinds/channels default ON in the
 * admin grid (source semantics: `!== false`).
 */
function buildNotificationPrefs(): Map<number, Record<string, Record<string, boolean>>> {
    return new Map<number, Record<string, Record<string, boolean>>>([
        [1, {
            security_alert: { in_app: true, email: true, push: false },
            system: { in_app: true, email: false, push: false },
            mentions: { in_app: true, email: true, push: true },
            marketing: { in_app: false, email: false, push: false },
        }],
        [2, {
            security_alert: { in_app: true, email: true, push: true },
            digest: { email: true },
        }],
    ]);
}

/**
 * Post-build user decoration: the disable-lifecycle seeds (reason spread +
 * history + inactivity warning, ISO `at` values per services/disable.py),
 * org links (groups exist by now), MFA/DOB/metadata variety. Deterministic
 * overrides on fixed ids so every UserView surface has a demo row.
 */
function decorateUsers(users: MockUser[], groups: MockGroup[]): void {
    const nowMs = Date.now();
    const iso = (daysAgo: number) => new Date(nowMs - daysAgo * 864e5).toISOString();
    const at = (u: number): MockUser => users[u - 1]!;

    // u1 — the reference row: org, timezone + address metadata, DOB.
    const ian = at(1);
    ian.org = { id: groups[0]!.id, name: groups[0]!.name };
    ian.metadata = {
        timezone: 'America/Los_Angeles',
        street: '400 Harbor Dr', city: 'San Diego', state: 'CA', zip: '92101', country: 'US',
    };
    ian.dob = '1988-04-12';

    // u2 — MFA + passkeys + avatar + org; verified phone (SMS-MFA eligible).
    const maya = at(2);
    maya.requires_mfa = true;
    maya.is_active = true;
    maya.phone_number = '+15555550142';
    maya.is_phone_verified = true;
    maya.is_email_verified = true;
    maya.org = { id: groups[1]?.id ?? groups[0]!.id, name: groups[1]?.name ?? groups[0]!.name };
    maya.avatar = {
        url: 'data:image/svg+xml,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#2f6bdf"/><text x="32" y="41" font-family="sans-serif" font-size="26" fill="#fff" text-anchor="middle">MC</text></svg>'),
    };

    // u3 — login-throttled (see db.throttle) but ACTIVE; unverified email.
    const throttled = at(3);
    throttled.is_active = true;
    throttled.is_email_verified = false;

    // u4 — admin-disabled with a prior reactivated cycle in history.
    const blocked = at(4);
    blocked.is_active = false;
    blocked.metadata = {
        ...blocked.metadata,
        protected: {
            disable: {
                reason: 'admin',
                at: iso(12),
                by_user_id: 1,
                by_username: 'ian',
                note: 'Repeated ToS violations after the second warning.',
                history: [{
                    at: iso(90), reason: 'admin', by_user_id: 1, by_username: 'ian',
                    note: 'First offense — 30 day suspension.',
                    reactivated_at: iso(60), reactivated_by_user_id: 1,
                    reactivated_by_username: 'ian', reactivated_note: 'Suspension served.',
                }],
            },
        },
    };

    // u5 — banned (abuse).
    const banned = at(5);
    banned.is_active = false;
    banned.metadata = {
        ...banned.metadata,
        protected: { disable: { reason: 'abuse', at: iso(30), by_user_id: null, by_username: 'system', note: 'Automated abuse sweep.', history: [] } },
    };

    // u6 — auto-disabled for inactivity.
    const idle = at(6);
    idle.is_active = false;
    idle.metadata = {
        ...idle.metadata,
        protected: { disable: { reason: 'inactive', at: iso(45), by_user_id: null, by_username: 'system', note: null, history: [] } },
    };

    // u7 — anonymized (irreversible; toggle hidden).
    const anon = at(7);
    anon.is_active = false;
    anon.display_name = null;
    anon.first_name = '';
    anon.last_name = '';
    anon.username = 'deleted-9c41f2ab77aa';
    anon.email = 'deleted-9c41f2ab77aa@deleted.local';
    anon.phone_number = null;
    anon.dob = null;
    anon.is_email_verified = false;
    anon.is_phone_verified = false;
    anon.permissions = {};
    anon.metadata = { protected: { disable: { reason: 'anonymized', at: iso(120), by_user_id: null, by_username: 'system', note: null, history: [] } } };

    // u8 — self-deactivated.
    const self = at(8);
    self.is_active = false;
    self.metadata = {
        ...self.metadata,
        protected: { disable: { reason: 'self', at: iso(9), by_user_id: 8, by_username: self.username, note: null, history: [] } },
    };

    // u9 — ACTIVE with an inactivity warning in flight (header warning row).
    const drowsy = at(9);
    drowsy.is_active = true;
    drowsy.last_login = Math.floor(nowMs / 1000) - 80 * 86400;
    drowsy.last_activity = drowsy.last_login;
    drowsy.metadata = {
        ...drowsy.metadata,
        protected: { disable: { warning: { sent_at: iso(3), days_until_disable_at_send: 14 }, history: [] } },
    };

    // u10 — invited, never signed in (Resend Invite gate).
    const invited = at(10);
    invited.is_active = true;
    invited.last_login = null;
    invited.last_activity = null;
    invited.is_email_verified = false;

    // Seed-consistency sweep: a disabled (or long-idle) account is never
    // "online" regardless of what the random spread rolled.
    for (const u of users) {
        if (!u.is_active || u === drowsy || u === invited) u.is_online = false;
    }
}

const users = buildUsers();
const groups = buildGroups();
decorateUsers(users, groups);
const db = {
    users,
    groups,
    members: buildMembers(users, groups),
    apiKeys: buildApiKeys(),
    logs: buildLogs(users, groups),
    devices: buildDevices(),
    pushDevices: buildPushDevices(),
    loginEvents: buildLoginEvents(users),
    incidentEvents: buildIncidentEvents(),
    passkeys: buildPasskeys(),
    oauthConnections: buildOAuthConnections(),
    notificationPrefs: buildNotificationPrefs(),
    // Per-user login throttle counters (auth/manage/throttle shape). u3 is
    // mid-lockout so the header badge + Clear Rate Limit are demoable.
    throttle: new Map<number, { count: number; limit: number; window: number; retry_after_seconds: number }>([
        [3, { count: 11, limit: 10, window: 900, retry_after_seconds: 412 }],
    ]),
};

function getField(row: Record<string, unknown>, field: string): unknown {
    return row[field];
}

/**
 * Django FK semantics: filtering on a relation field (`parent=3`, `group=1`,
 * `user=2`) compares the related row's PK. Mock rows embed relations as
 * objects (`{id, name, …}`), so lookups unwrap to `.id` before comparing —
 * exactly what the ORM does with `filter(parent=3)`.
 */
function fkValue(v: unknown): unknown {
    if (v != null && typeof v === 'object' && !Array.isArray(v) && 'id' in (v as Record<string, unknown>)) {
        return (v as Record<string, unknown>).id;
    }
    return v;
}

const NUMERIC_WIRE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const DATE_WIRE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
const DATETIME_WIRE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

function numericWireValue(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !NUMERIC_WIRE.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function temporalWireValue(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!DATE_WIRE.test(text) && !DATETIME_WIRE.test(text)) return null;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
}

/** Django-like coercion without treating arbitrary date-looking text as time. */
function compareWireValues(left: unknown, right: unknown): number {
    const ln = numericWireValue(left);
    const rn = numericWireValue(right);
    if (ln != null && rn != null) return ln - rn;
    const lt = temporalWireValue(left);
    const rt = temporalWireValue(right);
    if (lt != null && rt != null) return lt - rt;
    return String(left ?? '').localeCompare(String(right ?? ''));
}

/** Apply one Django-style lookup param to the row set. */
function applyLookup<T extends Record<string, unknown>>(rows: T[], key: string, raw: string): T[] {
    const parts = key.split('__');
    const lookup = parts.length > 1 ? parts[parts.length - 1] : 'exact';
    const known = ['exact', 'in', 'icontains', 'gte', 'lte', 'isnull'];
    const field = known.includes(lookup) && parts.length > 1 ? parts.slice(0, -1).join('__') : key;
    const op = known.includes(lookup) && parts.length > 1 ? lookup : 'exact';

    return rows.filter((row) => {
        const v = fkValue(getField(row, field));
        switch (op) {
            case 'in': return raw.split(',').map((s) => s.trim()).some((candidate) => compareWireValues(v, candidate) === 0);
            case 'icontains': return String(v ?? '').toLowerCase().includes(raw.toLowerCase());
            case 'gte': return v != null && compareWireValues(v, raw) >= 0;
            case 'lte': return v != null && compareWireValues(v, raw) <= 0;
            case 'isnull': return raw === 'true' ? v == null : v != null;
            default:
                if (raw === 'true' || raw === 'false') return v === (raw === 'true');
                return compareWireValues(v, raw) === 0;
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
            // dr_* bounds are canonical YYYY-MM-DD strings; mojo datetime
            // fields are epoch SECONDS — normalize to the row's calendar day
            // before comparing (the server compares real datetimes).
            const day = typeof raw === 'number'
                ? new Date(raw * 1000).toISOString().slice(0, 10)
                : String(raw).slice(0, 10);
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
        // Live parity: every list envelope names the graph it serialized
        // ("list" — models without a list graph fall back to default).
        graph: 'list',
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
    return { ...result, data: (result.data as unknown as MockUser[]).map((u) => serializeUser(u, 'list')) };
}

/**
 * `download_format=csv|json` on ANY list endpoint (mojo/models/rest.py
 * on_rest_list_response is generic): the WHOLE filtered set — same pipeline,
 * no paging — as a file. The mock returns the file body in the envelope
 * ({filename, content, mime}); the client turns it into a Blob download.
 */
function exportRows(rows: Record<string, unknown>[], params: Params, modelName: string) {
    const format = String(params.download_format);
    const filename = String(params.filename ?? `${modelName}.${format}`);
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

function exportUsers(params: Params) {
    const full = listUsers({ ...params, start: 0, size: db.users.length });
    return exportRows(full.data as unknown as Record<string, unknown>[], params, 'User');
}

// ── POST_SAVE_ACTIONS (User) ──────────────────────────────────────────
// Mirrors mojo/models/rest.py on_rest_save: action keys are pulled OUT of the
// save body, plain fields save first, then each action handler runs — and the
// response is the refreshed row UNLESS a handler returned its own payload
// (action_resp wins verbatim). The mocked subset matches django-mojo
// account/models/user.py RestMeta.POST_SAVE_ACTIONS (which also declares
// change_username + the TOTP trio — unmocked until a screen needs them).
const USER_ACTIONS = new Set(['send_invite', 'disable', 'reactivate', 'revoke_sessions', 'disable_totp']);
const USER_DISABLE_REASONS = new Set(['abuse', 'admin']); // services/disable.py USER_REST_REASONS

/** The live disable block, as a mutable dict (creates the path when absent). */
function disableBlockOf(user: MockUser): Record<string, unknown> {
    const meta = (isPlainObject(user.metadata) ? user.metadata : {}) as Record<string, unknown>;
    const protectedNs = isPlainObject(meta.protected) ? (meta.protected as Record<string, unknown>) : {};
    const block = isPlainObject(protectedNs.disable) ? (protectedNs.disable as Record<string, unknown>) : {};
    protectedNs.disable = block;
    meta.protected = protectedNs;
    user.metadata = meta;
    return block;
}

function runUserAction(user: MockUser, action: string, value: unknown, caller?: MockUser): Record<string, unknown> | null {
    const dict = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    switch (action) {
        case 'disable': {
            // Backend parity: reason is REQUIRED and validated against the
            // service's frozenset; a bad one rejects the whole save. The
            // service then records the metadata.protected.disable block
            // (ISO `at` stamps — services/disable.py schema) and clears any
            // pending inactivity warning.
            const reason = String(dict.reason ?? '');
            if (!USER_DISABLE_REASONS.has(reason)) {
                return { status: false, error: `reason must be one of: ${[...USER_DISABLE_REASONS].sort().join(', ')}`, error_code: 400 };
            }
            user.is_active = false;
            const block = disableBlockOf(user);
            const history = Array.isArray(block.history) ? block.history : [];
            delete block.warning;
            Object.assign(block, {
                reason,
                at: new Date().toISOString(),
                by_user_id: caller?.id ?? null,
                by_username: caller?.username ?? 'system',
                note: typeof dict.note === 'string' && dict.note ? dict.note : null,
                history,
            });
            return null;
        }
        case 'reactivate': {
            // Pushes the live disable block into history with reactivated_*
            // fields; the new block keeps ONLY the history list.
            user.is_active = true;
            const block = disableBlockOf(user);
            const history = Array.isArray(block.history) ? [...block.history] : [];
            if (block.reason != null || block.at != null) {
                history.push({
                    at: block.at ?? null,
                    reason: block.reason ?? null,
                    by_user_id: block.by_user_id ?? null,
                    by_username: block.by_username ?? null,
                    note: block.note ?? null,
                    reactivated_at: new Date().toISOString(),
                    reactivated_by_user_id: caller?.id ?? null,
                    reactivated_by_username: caller?.username ?? 'system',
                    reactivated_note: typeof dict.note === 'string' && dict.note ? dict.note : null,
                });
            }
            for (const key of Object.keys(block)) delete block[key];
            block.history = history.slice(-20); // HISTORY_CAP parity
            return null;
        }
        case 'send_invite':
            // Sends mail server-side; the REST-visible effect is just the row.
            return null;
        case 'revoke_sessions':
            // Handler returns its own payload — the response is NOT the row.
            return { status: true, message: 'Sessions revoked. Re-authenticate to continue.' };
        case 'disable_totp':
            // on_action_disable_totp: clears enrollment (no-ops when nothing
            // is enrolled) and answers its own {status:true} payload.
            return { status: true };
        default:
            return null;
    }
}

/**
 * Phone normalization parity — mirrors phonehub services/phonenumbers.normalize,
 * which User.set_phone_number runs on every REST save (set_<field> setter
 * dispatch in rest.py on_rest_save_field). Measured live: too-few-digit
 * "pretty" NANP values (`+1 (555) 0100`) REJECT; valid shapes normalize to
 * E.164 (`+15555550142`) and the row comes back normalized.
 */
function normalizePhone(value: string): string | null {
    const hasPlus = value.trim().startsWith('+');
    const digits = value.replace(/\D/g, '');
    if (!digits) return null;
    if (!hasPlus) {
        if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
        if (digits.length === 10) return `+1${digits}`;
        return null; // country not detectable without +
    }
    // +1… is NANP: exactly 11 digits. Other country codes: E.164 length rule.
    if (digits.startsWith('1')) return digits.length === 11 ? `+${digits}` : null;
    return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return v != null && typeof v === 'object' && !Array.isArray(v);
}

/** rest.py on_rest_update_jsonfield / objict.merge_dicts — recursive merge. */
function mergeDicts(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
    const out = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
        const prev = out[key];
        out[key] = isPlainObject(prev) && isPlainObject(value) ? mergeDicts(prev, value) : value;
    }
    return out;
}

// NO_SAVE_FIELDS parity (account/models/user.py RestMeta): silently dropped,
// never an error — matching rest.py's strip. NOTE is_dob_verified IS in this
// set live, which is why the portal ships no DOB force-verify affordance.
const USER_NO_SAVE = new Set(['id', 'pk', 'auth_key', 'last_activity', 'is_dob_verified', 'created', 'has_passkey', 'is_online']);

function saveUser(user: MockUser, body: Record<string, unknown>, caller?: MockUser): unknown {
    const fields: Record<string, unknown> = {};
    const actionEntries: [string, unknown][] = [];
    for (const [key, value] of Object.entries(body)) {
        if (USER_ACTIONS.has(key)) actionEntries.push([key, value]);
        else if (!USER_NO_SAVE.has(key)) fields[key] = value;
    }
    // set_new_password parity: admin tier may set without current_password;
    // the value never lands on the row (write-only virtual field).
    if ('new_password' in fields) {
        const pw = String(fields.new_password ?? '');
        delete fields.new_password;
        if (pw.length < 8) {
            return { status: false, error: 'Password is too weak. Use a longer password or include a mix of uppercase, lowercase, numbers, and special characters', error_code: 400 };
        }
    }
    // set_org parity: the FK arrives as an id (or null to clear), serializes
    // back as the basic sub-graph.
    if ('org' in fields) {
        const raw = fields.org;
        if (raw == null || raw === '') {
            fields.org = null;
        } else {
            const orgGroup = db.groups.find((g) => g.id === Number(raw));
            if (!orgGroup) return { status: false, error: 'Group not found', error_code: 404 };
            fields.org = { id: orgGroup.id, name: orgGroup.name };
        }
    }
    // set_phone_number parity (account/models/user.py:635): empty clears;
    // anything else must normalize to E.164 or the WHOLE save rejects with
    // the server's exact message shape.
    if ('phone_number' in fields) {
        const raw = fields.phone_number;
        if (raw == null || raw === '') {
            fields.phone_number = null;
        } else {
            const normalized = typeof raw === 'string' ? normalizePhone(raw) : null;
            if (!normalized) {
                return { status: false, error: `Invalid phone number: ${String(raw)}`, error_code: 400 };
            }
            fields.phone_number = normalized;
        }
    }
    // JSONField parity (rest.py on_rest_update_jsonfield): a dict body MERGES
    // into an existing dict field — {permissions: {x: true}} preserves the
    // other grants. Non-dict values assign as before.
    const target = user as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(fields)) {
        const existing = target[key];
        target[key] = isPlainObject(value) && isPlainObject(existing) ? mergeDicts(existing, value) : value;
    }
    let actionResp: Record<string, unknown> | null = null;
    for (const [action, value] of actionEntries) {
        const resp = runUserAction(user, action, value, caller);
        if (resp) {
            if (resp.status === false) return resp; // action error rejects the request
            actionResp = resp;
        }
    }
    return actionResp ?? { status: true, data: serializeUser(user, 'default') };
}

// ── Group save + POST_SAVE_ACTIONS ────────────────────────────────────
// django-mojo account/models/group.py RestMeta: POST_SAVE_ACTIONS include
// disable/reactivate (reason REQUIRED ∈ GROUP_REST_REASONS = admin | abuse |
// archived — one more than users get); NO_SAVE_FIELDS id/pk/created.
const GROUP_ACTIONS = new Set(['disable', 'reactivate']);
const GROUP_DISABLE_REASONS = new Set(['abuse', 'admin', 'archived']);
// NO_SAVE_FIELDS parity (id/pk/created); member_count additionally blocked
// here because it is a graph EXTRA, not a column (uuid IS savable live).
const GROUP_NO_SAVE = new Set(['id', 'pk', 'created', 'member_count']);

function serializeGroup(g: MockGroup): Record<string, unknown> {
    return { ...g };
}

function saveGroup(group: MockGroup, body: Record<string, unknown>): unknown {
    const fields: Record<string, unknown> = {};
    const actionEntries: [string, unknown][] = [];
    for (const [key, value] of Object.entries(body)) {
        if (GROUP_ACTIONS.has(key)) actionEntries.push([key, value]);
        else if (!GROUP_NO_SAVE.has(key)) fields[key] = value;
    }
    const target = group as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(fields)) {
        const existing = target[key];
        // JSONField dict-merge parity (metadata), plain assign otherwise.
        target[key] = isPlainObject(value) && isPlainObject(existing) ? mergeDicts(existing, value) : value;
    }
    for (const [action, value] of actionEntries) {
        const dict = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
        if (action === 'disable') {
            const reason = String(dict.reason ?? '');
            if (!GROUP_DISABLE_REASONS.has(reason)) {
                return { status: false, error: `reason must be one of: ${[...GROUP_DISABLE_REASONS].sort().join(', ')}`, error_code: 400 };
            }
            group.is_active = false;
        } else if (action === 'reactivate') {
            group.is_active = true;
        }
    }
    group.modified = Math.floor(Date.now() / 1000);
    return { status: true, data: serializeGroup(group), graph: 'default' };
}

// ── Member serialization ──────────────────────────────────────────────

function serializeMember(m: MockMember): Record<string, unknown> {
    const user = db.users.find((u) => u.id === m.user);
    const group = db.groups.find((g) => g.id === m.group);
    return {
        id: m.id,
        created: m.created,
        modified: m.modified,
        is_active: m.is_active,
        permissions: m.permissions,
        metadata: m.metadata,
        // Live member.user is the me-graph dict (requires_mfa/has_passkey ride
        // along) — measured 2026-08-05 against /api/group/member.
        user: user ? meDict(user) : null,
        group: group ? groupBasic(group) : null,
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
    years: 365 * 864e5,
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

function accountSalt(account: string): number {
    let hash = 2166136261;
    for (const ch of account) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    return hash >>> 0;
}

function stepMetricBucket(date: Date, granularity: string, direction = 1): Date {
    const next = new Date(date);
    if (granularity === 'months') next.setUTCMonth(next.getUTCMonth() + direction, 1);
    else if (granularity === 'years') next.setUTCFullYear(next.getUTCFullYear() + direction, 0, 1);
    else next.setTime(next.getTime() + (BUCKET_MS[granularity] ?? BUCKET_MS.hours!) * direction);
    return next;
}

function floorMetricBucket(value: number, granularity: string): Date {
    const date = new Date(value);
    if (granularity === 'years') return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    if (granularity === 'months') return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const bucket = BUCKET_MS[granularity] ?? BUCKET_MS.hours!;
    return new Date(Math.floor(value / bucket) * bucket);
}

const DEFAULT_BUCKET_SPANS: Record<string, number> = {
    minutes: 29 * 60e3,
    hours: 24 * 3600e3,
    days: 30 * 864e5,
    weeks: 11 * 7 * 864e5,
    months: 12 * 30 * 864e5,
    years: 11 * 360 * 864e5,
};

function metricTimes(params: Params, granularity: string): Date[] | { error: string } {
    const startParam = params.dt_start;
    const endParam = params.dt_end;
    const parseBound = (value: unknown): number | null => {
        if (value == null || value === '') return null;
        const seconds = numericWireValue(value);
        return seconds == null ? Number.NaN : seconds * 1000;
    };
    let start = parseBound(startParam);
    let end = parseBound(endParam);
    if (Number.isNaN(start) || Number.isNaN(end)) return { error: 'dt_start and dt_end must be epoch seconds' };

    if (start == null && end == null && params.range) {
        const span = RANGE_MS[String(params.range)] ?? RANGE_MS['24h']!;
        end = Date.now();
        start = end - span;
    } else {
        const span = DEFAULT_BUCKET_SPANS[granularity] ?? DEFAULT_BUCKET_SPANS.hours!;
        if (start == null && end == null) end = Date.now();
        if (start == null) start = end! - span;
        if (end == null) end = start + span;
    }

    const first = floorMetricBucket(start!, granularity);
    const last = floorMetricBucket(end!, granularity);
    if (first.getTime() > last.getTime()) return [];

    const times: Date[] = [];
    let cursor = first;
    // The live range is inclusive. The mock caps pathological requests so a
    // pasted multi-year minute window cannot freeze the showcase.
    while (cursor.getTime() <= last.getTime() && times.length < 400) {
        times.push(cursor);
        cursor = stepMetricBucket(cursor, granularity);
    }
    return times;
}

function fetchMetrics(params: Params) {
    const granularity = String(params.granularity ?? 'hours');
    const wanted = String(params.slugs ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const bucket = BUCKET_MS[granularity] ?? BUCKET_MS.hours!;

    if (wanted.length === 0) {
        // Backend parity: slug(s) are required, not defaulted.
        return { status: false, error: 'missing required parameter: slug, slugs, or category', error_code: 400 };
    }
    const window = metricTimes(params, granularity);
    if (!Array.isArray(window)) return { status: false, error: window.error, error_code: 400 };
    const labels = window.map((date) => bucketLabel(date, granularity));
    const times = window.map((date) => date.getTime());
    const picked = SERIES.filter((s) => wanted.includes(s.slug));
    // Longer buckets aggregate more events — scale so totals stay coherent.
    const scale = bucket / 3600e3;
    // Real wire shape (verified live): a slug-keyed series map + labels. No
    // datasets array, no granularity/range echo — the client normalizes.
    const data: Record<string, number[]> = {};
    const salt = accountSalt(String(params.account ?? 'public'));
    picked.forEach((s, i) => {
        data[s.slug] = times.map((t) => Math.round(sample(i + (salt % 997), t + salt, s.base, s.spread) * Math.max(0.15, scale)));
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

/**
 * User.lookup_from_request parity for the send flows: `email` or
 * `phone_number` body field (phone digits compared loosely, like the
 * server's normalize-then-match).
 */
function findByIdentifier(body: Record<string, unknown>): MockUser | undefined {
    if (body.email) return findByEmail(body.email);
    if (body.phone_number) {
        const digits = String(body.phone_number).replace(/\D/g, '');
        if (!digits) return undefined;
        return db.users.find((u) => (u.phone_number ?? '').replace(/\D/g, '').endsWith(digits.slice(-10)));
    }
    return undefined;
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

interface PendingMfa {
    uid: number;
    methods: string[];
    expiresAt: number;
}

const pendingMfa = new Map<string, PendingMfa>();
const pendingSms = new Map<number, { code: string; expiresAt: number }>();
let mfaSequence = 0;
const MOCK_TOTP_CODE = '123456';
const MOCK_RECOVERY_CODE = 'mock-recovery';
const MOCK_SMS_CODE = '654321';

function issueMfaToken(user: MockUser, methods: string[], ttl = 300): string {
    const token = `mfa:mock-${user.id}-${++mfaSequence}`;
    pendingMfa.set(token, { uid: user.id, methods: [...methods], expiresAt: Date.now() + ttl * 1000 });
    return token;
}

/** Runtime truth: every verify/send attempt burns its challenge before validation. */
function consumeMfaToken(value: unknown): PendingMfa | null {
    const token = String(value ?? '');
    const challenge = pendingMfa.get(token);
    pendingMfa.delete(token);
    if (!challenge || Date.now() >= challenge.expiresAt) return null;
    return challenge;
}

function mfaGrant(challenge: PendingMfa, source: 'totp' | 'recovery' | 'sms', accessTtl: number): unknown {
    const user = db.users.find((candidate) => candidate.id === challenge.uid);
    if (!user || !user.is_active) return { status: false, error: 'permission denied', error_code: 401 };
    return { status: true, data: { ...tokenPair(user, accessTtl), user: serializeUser(user), source } };
}

function authFetch(path: string, body: Record<string, unknown>): unknown {
    // Dev knob: __mock_access_ttl mints a short-lived access token so refresh
    // paths are testable without waiting 6 hours. Mock-only; ignored by the
    // real backend (unknown params are dropped server-side).
    const accessTtl = typeof body.__mock_access_ttl === 'number' ? body.__mock_access_ttl : ACCESS_TTL;

    switch (path) {
        case '/api/login': {
            const user = findByEmail(body.username);
            if (!user || !user.is_active || body.password !== MOCK_PASSWORD) return invalidCreds();
            if (user.requires_mfa) {
                const methods = ['totp', ...(user.is_phone_verified && user.phone_number ? ['sms'] : []), ...(db.passkeys.some((p) => p.user === user.id && p.is_enabled) ? ['passkey'] : [])];
                const ttl = typeof body.__mock_mfa_ttl === 'number' ? body.__mock_mfa_ttl : 300;
                return {
                    status: true,
                    data: {
                        mfa_required: true,
                        mfa_token: issueMfaToken(user, methods, ttl),
                        mfa_methods: methods,
                        expires_in: ttl,
                    },
                };
            }
            return { status: true, data: { ...tokenPair(user, accessTtl), user: serializeUser(user) } };
        }
        case '/api/auth/totp/verify': {
            const challenge = consumeMfaToken(body.mfa_token);
            if (!challenge) return { status: false, error: 'Invalid or expired MFA token', error_code: 401 };
            if (String(body.code ?? '').trim() !== MOCK_TOTP_CODE) return { status: false, error: 'Invalid code', error_code: 401 };
            return mfaGrant(challenge, 'totp', accessTtl);
        }
        case '/api/auth/totp/recover': {
            const challenge = consumeMfaToken(body.mfa_token);
            if (!challenge) return { status: false, error: 'Invalid or expired MFA token', error_code: 401 };
            if (String(body.recovery_code ?? '').trim() !== MOCK_RECOVERY_CODE) return { status: false, error: 'Invalid recovery code', error_code: 403 };
            return mfaGrant(challenge, 'recovery', accessTtl);
        }
        case '/api/auth/sms/send': {
            const challenge = consumeMfaToken(body.mfa_token);
            if (!challenge) return { status: false, error: 'Invalid or expired MFA token', error_code: 401 };
            const user = db.users.find((candidate) => candidate.id === challenge.uid);
            if (!user) return { status: false, error: 'permission denied', error_code: 401 };
            pendingSms.set(user.id, { code: MOCK_SMS_CODE, expiresAt: Date.now() + 600_000 });
            const ttl = 300;
            return {
                status: true,
                data: { mfa_token: issueMfaToken(user, challenge.methods, ttl), expires_in: ttl },
            };
        }
        case '/api/auth/sms/verify': {
            const challenge = consumeMfaToken(body.mfa_token);
            if (!challenge) return { status: false, error: 'Invalid or expired MFA token', error_code: 401 };
            const pending = pendingSms.get(challenge.uid);
            pendingSms.delete(challenge.uid);
            if (!pending || Date.now() >= pending.expiresAt || String(body.code ?? '').trim() !== pending.code) {
                return { status: false, error: 'Invalid or expired code', error_code: 401 };
            }
            return mfaGrant(challenge, 'sms', accessTtl);
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
            // Body: {email|phone_number, method: link|code, channel?: 'sms'}
            // (rest/user.py on_user_forgot). Always succeeds — no
            // account-enumeration oracle.
            const user = findByIdentifier(body);
            if (user && body.method !== 'link') {
                pendingResetCodes.set(user.email.toLowerCase(), '123456');
                return { status: true, data: { sent: true, method: 'code' } };
            }
            return {
                status: true,
                data: { sent: true, method: body.method ?? 'code', ...(user ? { __mock_token: `pr:mock-${user.id}` } : {}) },
            };
        }
        case '/api/auth/email/verify/send': {
            // rest/user.py on_email_verify_send — public, admin-targetable
            // (accepts an email/username body); always answers success.
            return { status: true, message: 'If account is in our system a verification email was sent.' };
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
            // Body: {email|phone_number, method?: 'sms'} (rest/user.py
            // on_magic_login_send) — email is the default channel.
            const user = findByIdentifier(body);
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

let armedReauth: { method: string; path: string } | null = null;

/** Mock-only one-shot fresh-auth challenge, matched by BOTH method and path. */
export function armMockReauth(method: string, path: string): void {
    armedReauth = { method: method.toUpperCase(), path };
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
 * The `me` graph = the DEFAULT one-record graph (which is where has_passkey
 * and requires_mfa live — django-mojo user.py GRAPHS). Permissions come from
 * the row itself — buildUsers seeds the spread (superusers, users-category
 * admins with the loose `1`-style truthy values, unprivileged rest).
 */
function meDict(user: MockUser) {
    return serializeUser(user, 'default') as unknown as Record<string, unknown>;
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
    const method = (opts.method ?? 'GET').toUpperCase();
    const key = `${method} ${path}`;
    callCounts.set(key, (callCounts.get(key) ?? 0) + 1);
    await new Promise((r) => setTimeout(r, LATENCY_MS));
    if (armedReauth?.method === method && armedReauth.path === path) {
        // The real @requires_fresh_auth runs after authentication. An armed
        // endpoint must still answer 401 to an anonymous caller, and that
        // failed auth must not consume the one-shot challenge.
        if (!userFromBearer(opts.headers)) return { status: false, error: 'permission denied', error_code: 401 };
        armedReauth = null;
        return { status: false, error: 'reauth_required', error_code: 440 };
    }
    if (path === '/api/auth/generate_api_key') {
        // account/rest/user_api_key.py generate_api_key: mints a long-lived
        // key for the CALLER (@requires_auth — needs the bearer, unlike the
        // other /api/auth/ flows), expire_days capped at 360. The response is
        // create_for_user's objict — {id, jti, expires, token} — the ONE time
        // the token is ever visible.
        const user = userFromBearer(opts.headers);
        if (!user) return { status: false, error: 'permission denied', error_code: 401 };
        const body = opts.body ?? {};
        const expireDays = Number(body.expire_days ?? 360);
        if (!Number.isFinite(expireDays) || expireDays > 360 || expireDays <= 0) {
            return { status: false, error: 'Invalid expire_days', error_code: 400 };
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const rand = mulberry32(nowSec ^ user.id);
        const jti = mockHex32(rand);
        const record: MockApiKey = {
            id: Math.max(0, ...db.apiKeys.map((k) => k.id)) + 1,
            label: String(body.label ?? ''),
            allowed_ips: Array.isArray(body.allowed_ips) ? (body.allowed_ips as string[]) : [],
            expires: nowSec + expireDays * 86400,
            is_active: true,
            last_used: null,
            created: nowSec,
            jti,
            user: user.id,
        };
        db.apiKeys.unshift(record);
        return {
            status: true,
            data: { id: record.id, jti, expires: record.expires, token: `mock_ak_${jti}` },
        };
    }
    if (path === '/api/auth/manage/generate_api_key') {
        // Admin-tier variant: mints a key FOR ANOTHER USER (`uid` body field)
        // — the UserView "Generate Key" surface. Gated users|manage_users.
        // NOTE: not yet mounted in django-mojo (only the caller-scoped
        // /api/auth/generate_api_key is) — the mock carries the target
        // contract; see the UserDetail report's MERGE-WIRE note.
        const caller = userFromBearer(opts.headers);
        if (!caller) return { status: false, error: 'permission denied', error_code: 401 };
        if (!caller.is_superuser && !caller.permissions['users'] && !caller.permissions['manage_users'] && !caller.permissions['admin']) {
            return { status: false, error: 'permission denied', error_code: 403 };
        }
        const body = opts.body ?? {};
        const target = db.users.find((u) => u.id === Number(body.uid));
        if (!target) return { status: false, error: 'User not found', error_code: 404 };
        const expireDays = Number(body.expire_days ?? 360);
        if (!Number.isFinite(expireDays) || expireDays > 360 || expireDays <= 0) {
            return { status: false, error: 'Invalid expire_days', error_code: 400 };
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const rand = mulberry32(nowSec ^ target.id);
        const jti = mockHex32(rand);
        db.apiKeys.unshift({
            id: Math.max(0, ...db.apiKeys.map((k) => k.id)) + 1,
            label: String(body.label ?? ''),
            allowed_ips: Array.isArray(body.allowed_ips) ? (body.allowed_ips as string[]) : [],
            expires: nowSec + expireDays * 86400,
            is_active: true,
            last_used: null,
            created: nowSec,
            jti,
            user: target.id,
        });
        return { status: true, data: { id: db.apiKeys[0]!.id, jti, expires: db.apiKeys[0]!.expires, token: `mock_ak_${jti}` } };
    }
    if (path === '/api/auth/manage/throttle') {
        // GET {user_id|username, key='login'} → the per-account attempt
        // counter (rest/user.py on_read_throttle). Admin-tier; reading never
        // mutates the counter.
        const caller = userFromBearer(opts.headers);
        if (!caller) return { status: false, error: 'permission denied', error_code: 401 };
        const params = opts.params ?? {};
        const key = String(params.key ?? 'login');
        if (key !== 'login') return { status: false, error: "only key='login' is supported", error_code: 400 };
        const uid = Number(params.user_id ?? 0);
        if (!db.users.some((u) => u.id === uid)) return { status: false, error: 'Unknown user_id', error_code: 400 };
        const state = db.throttle.get(uid) ?? { count: 0, limit: 10, window: 900, retry_after_seconds: 0 };
        return { status: true, data: state };
    }
    if (path === '/api/auth/manage/clear_rate_limit') {
        // POST {user_id, key} → {deleted:n} (rest/user.py on_clear_rate_limit).
        const caller = userFromBearer(opts.headers);
        if (!caller) return { status: false, error: 'permission denied', error_code: 401 };
        const uid = Number(opts.body?.user_id ?? 0);
        const had = db.throttle.delete(uid);
        return { status: true, data: { deleted: had ? 1 : 0 } };
    }
    if (path === '/api/login' || path === '/api/token/refresh' || path.startsWith('/api/auth/')) {
        return authFetch(path, opts.body ?? {});
    }
    // ── Browser devices — /api/user/device (account/models/device.py) ──
    if (path === '/api/user/device') {
        const result = listRows(
            db.devices as unknown as Record<string, unknown>[],
            opts.params ?? {},
            (d) => `${d.duid} ${(d as unknown as MockDevice).device_info?.string ?? ''}`,
            '-last_seen',
        );
        const rows = (result.data as unknown as MockDevice[]).map((d) => {
            const owner = db.users.find((u) => u.id === d.user);
            const { user: _uid, ...rest } = d;
            return { ...rest, user: owner ? userBasic(owner) : null };
        });
        return { ...result, data: rows };
    }
    // ── Push devices — /api/account/devices/push (RegisteredDevice) ──
    if (path === '/api/account/devices/push') {
        const result = listRows(
            db.pushDevices as unknown as Record<string, unknown>[],
            opts.params ?? {},
            (d) => `${d.device_name} ${d.platform} ${d.device_id}`,
            '-last_seen',
        );
        const rows = (result.data as unknown as MockPushDevice[]).map((d) => {
            const owner = db.users.find((u) => u.id === d.user);
            const { user: _uid, ...rest } = d;
            return { ...rest, user: owner ? userBasic(owner) : null };
        });
        return { ...result, data: rows };
    }
    // ── Login events — /api/account/logins (list graph; no event_type) ──
    if (path === '/api/account/logins') {
        const result = listRows(
            db.loginEvents as unknown as Record<string, unknown>[],
            opts.params ?? {},
            (l) => `${l.ip_address ?? ''} ${l.country_code ?? ''} ${l.region ?? ''} ${l.city ?? ''}`,
            '-created',
        );
        const rows = (result.data as unknown as MockLoginEvent[]).map((l) => {
            const owner = db.users.find((u) => u.id === l.user);
            const { user: _uid, ...rest } = l;
            return { ...rest, user: owner ? userBasic(owner) : null };
        });
        return { ...result, data: rows };
    }
    // ── Incident events — /api/incident/event (view_security-gated live) ──
    if (path === '/api/incident/event') {
        const result = listRows(
            db.incidentEvents as unknown as Record<string, unknown>[],
            opts.params ?? {},
            (e) => `${e.details ?? ''}`, // SEARCH_FIELDS = ["details"]
            '-created',
        );
        return result;
    }
    // ── Passkeys — /api/account/passkeys (save: friendly_name/is_enabled) ──
    const onePasskey = path.match(/^\/api\/account\/passkeys\/(\d+)$/);
    if (onePasskey) {
        const pk = db.passkeys.find((p) => p.id === Number(onePasskey[1]));
        if (!pk) return { status: false, error: 'Passkey not found', error_code: 404 };
        if (opts.method === 'DELETE') {
            db.passkeys = db.passkeys.filter((p) => p.id !== pk.id);
            return { status: 'deleted' };
        }
        if (opts.method === 'POST' && opts.body) {
            // NO_SAVE_FIELDS parity: everything except the two editables drops.
            if ('friendly_name' in opts.body) pk.friendly_name = opts.body.friendly_name == null ? null : String(opts.body.friendly_name);
            if ('is_enabled' in opts.body) pk.is_enabled = Boolean(opts.body.is_enabled);
        }
        const owner = db.users.find((u) => u.id === pk.user);
        const { user: _uid, ...rest } = pk;
        return { status: true, data: { ...rest, user: owner ? userBasic(owner) : null }, graph: 'default' };
    }
    if (path === '/api/account/passkeys') {
        const result = listRows(
            db.passkeys as unknown as Record<string, unknown>[],
            opts.params ?? {},
            (p) => `${p.friendly_name ?? ''} ${p.credential_id}`,
            '-created',
        );
        const rows = (result.data as unknown as MockPasskey[]).map((p) => {
            const owner = db.users.find((u) => u.id === p.user);
            const { user: _uid, ...rest } = p;
            return { ...rest, user: owner ? userBasic(owner) : null };
        });
        return { ...result, data: rows };
    }
    // ── OAuth connections — /api/account/oauth_connection ──
    const oneOAuth = path.match(/^\/api\/account\/oauth_connection\/(\d+)$/);
    if (oneOAuth) {
        const conn = db.oauthConnections.find((c) => c.id === Number(oneOAuth[1]));
        if (!conn) return { status: false, error: 'OAuthConnection not found', error_code: 404 };
        if (opts.method === 'DELETE') {
            db.oauthConnections = db.oauthConnections.filter((c) => c.id !== conn.id);
            return { status: 'deleted' };
        }
        const { user: _uid, ...rest } = conn;
        return { status: true, data: rest, graph: 'default' };
    }
    if (path === '/api/account/oauth_connection') {
        const result = listRows(
            db.oauthConnections as unknown as Record<string, unknown>[],
            opts.params ?? {},
            (c) => `${c.provider} ${c.email ?? ''}`,
            '-created',
        );
        // default graph carries no user embed — strip the FK.
        const rows = (result.data as unknown as MockOAuthConnection[]).map(({ user: _uid, ...rest }) => rest);
        return { ...result, data: rows };
    }
    // ── Notification preferences (notification_prefs.py service shape) ──
    // Live scope note: the real handler reads request.user and IGNORES
    // ?user= / body.user (admin-view-of-another-user is not yet a backend
    // surface). The mock honors the target param so the admin grid is
    // buildable now; the report carries the backend gap.
    if (path === '/api/account/notification/preferences') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return { status: false, error: 'permission denied', error_code: 401 };
        const targetId = Number(opts.body?.user ?? opts.params?.user ?? caller.id);
        if (!db.users.some((u) => u.id === targetId)) {
            return { status: false, error: 'User not found', error_code: 404 };
        }
        if (opts.method === 'POST') {
            const incoming = opts.body?.preferences;
            if (!isPlainObject(incoming)) return { status: false, error: 'preferences is required', error_code: 400 };
            const current = db.notificationPrefs.get(targetId) ?? {};
            for (const [kind, channels] of Object.entries(incoming)) {
                if (!isPlainObject(channels)) return { status: false, error: `Value for '${kind}' must be a dict of channel booleans`, error_code: 400 };
                const kindPrefs = { ...(current[kind] ?? {}) };
                for (const [channel, value] of Object.entries(channels)) {
                    if (!['in_app', 'email', 'push'].includes(channel)) continue; // unknown channels ignored
                    if (typeof value !== 'boolean') return { status: false, error: `Channel '${channel}' value must be a boolean`, error_code: 400 };
                    kindPrefs[channel] = value;
                }
                current[kind] = kindPrefs;
            }
            db.notificationPrefs.set(targetId, current);
            return { status: true, data: { preferences: current } };
        }
        return { status: true, data: { preferences: db.notificationPrefs.get(targetId) ?? {} } };
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
    // Members list/detail — /api/group/member (admin listing; the group-
    // scoped /api/group/<id>/member self-membership route stays separate
    // above). SEARCH_FIELDS parity: user__username / user__email /
    // user__display_name.
    const oneMember = path.match(/^\/api\/group\/member\/(\d+)$/);
    if (oneMember) {
        const m = db.members.find((x) => x.id === Number(oneMember[1]));
        if (!m) return { status: false, error: 'Member not found', error_code: 404 };
        return { status: true, data: serializeMember(m), graph: 'default' };
    }
    if (path === '/api/group/member') {
        const memberSearch = (m: Record<string, unknown>) => {
            const u = db.users.find((x) => x.id === Number(m.user));
            return u ? `${u.username} ${u.email} ${u.display_name}` : '';
        };
        const result = listRows(db.members as unknown as Record<string, unknown>[], opts.params ?? {}, memberSearch, '-id');
        return { ...result, data: (result.data as unknown as MockMember[]).map(serializeMember) };
    }
    const oneGroup = path.match(/^\/api\/group\/(\d+)$/);
    if (oneGroup) {
        const group = db.groups.find((g) => g.id === Number(oneGroup[1]));
        if (!group) return { status: false, error: 'Group not found', error_code: 404 };
        if (opts.method === 'POST' && opts.body) {
            return saveGroup(group, opts.body);
        }
        return { status: true, data: serializeGroup(group), graph: 'default' };
    }
    if (path === '/api/group') {
        if (opts.params?.download_format) {
            const full = listRows(db.groups as unknown as Record<string, unknown>[], { ...opts.params, start: 0, size: db.groups.length }, (g) => String(g.name), 'name');
            return exportRows(full.data as Record<string, unknown>[], opts.params, 'Group');
        }
        if (opts.method === 'POST' && opts.body) {
            // Create parity: parent arrives as an id, embeds as the basic
            // graph; uuid stays null until generated (live rows show both).
            const body = opts.body;
            const parent = body.parent != null ? db.groups.find((g) => g.id === Number(body.parent)) : undefined;
            if (body.parent != null && !parent) return { status: false, error: 'Group not found', error_code: 404 };
            const nowSec = Math.floor(Date.now() / 1000);
            const group: MockGroup = {
                id: Math.max(0, ...db.groups.map((g) => g.id)) + 1,
                uuid: null,
                name: String(body.name ?? 'New Group'),
                kind: String(body.kind ?? 'group'),
                parent: parent ? groupBasic(parent) : null,
                created: nowSec,
                modified: nowSec,
                last_activity: null,
                is_active: true,
                auth_domain: null,
                metadata: isPlainObject(body.metadata) ? body.metadata : {},
                member_count: 0,
                avatar: null,
            };
            db.groups.push(group);
            return { status: true, data: serializeGroup(group), graph: 'default' };
        }
        return listRows(db.groups as unknown as Record<string, unknown>[], opts.params ?? {}, (g) => String(g.name), 'name');
    }
    // User API keys — /api/account/api_keys (account/rest/user_api_key.py).
    // No DELETE (CAN_DELETE defaults false); the kill switch is the `revoke`
    // POST_SAVE_ACTION, which answers with its own payload {status:true},
    // NOT the row. NO_SAVE_FIELDS: jti / expires / user / last_used.
    const oneApiKey = path.match(/^\/api\/account\/api_keys\/(\d+)$/);
    if (oneApiKey) {
        const k = db.apiKeys.find((x) => x.id === Number(oneApiKey[1]));
        if (!k) return { status: false, error: 'UserAPIKey not found', error_code: 404 };
        if (opts.method === 'DELETE') {
            return { status: false, error: 'DELETE not allowed: UserAPIKey', error_code: 403 };
        }
        if (opts.method === 'POST' && opts.body) {
            let revoked = false;
            for (const [bkey, value] of Object.entries(opts.body)) {
                if (bkey === 'revoke') {
                    // on_action_revoke: rotates the signing secret + deactivates.
                    k.is_active = false;
                    revoked = true;
                } else if (bkey === 'label') {
                    k.label = String(value ?? '');
                } else if (bkey === 'allowed_ips' && Array.isArray(value)) {
                    k.allowed_ips = value as string[];
                } else if (bkey === 'is_active') {
                    k.is_active = Boolean(value);
                }
                // jti/expires/user/last_used silently ignored (NO_SAVE_FIELDS).
            }
            if (revoked) return { status: true }; // action payload, verbatim
            return { status: true, data: serializeApiKey(k), graph: 'default' };
        }
        return { status: true, data: serializeApiKey(k), graph: 'default' };
    }
    if (path === '/api/account/api_keys') {
        const params = opts.params ?? {};
        const search = (k: Record<string, unknown>) => String(k.label ?? '');
        if (params.download_format) {
            const full = listRows(db.apiKeys as unknown as Record<string, unknown>[], { ...params, start: 0, size: db.apiKeys.length }, search, '-id');
            return exportRows((full.data as unknown as MockApiKey[]).map(serializeApiKey), params, 'UserAPIKey');
        }
        const result = listRows(db.apiKeys as unknown as Record<string, unknown>[], params, search, '-id');
        return { ...result, data: (result.data as unknown as MockApiKey[]).map(serializeApiKey) };
    }
    // Logs — /api/logs (mojo/apps/logit). Read surface only from the portal;
    // default sort is -id (rest.py pops sort with that default), graph=basic
    // narrows the row, and search sweeps the text columns.
    const oneLog = path.match(/^\/api\/logs\/(\d+)$/);
    if (oneLog) {
        const l = db.logs.find((x) => x.id === Number(oneLog[1]));
        if (!l) return { status: false, error: 'Log not found', error_code: 404 };
        return { status: true, data: serializeLog(l, String(opts.params?.graph ?? 'default')), graph: String(opts.params?.graph ?? 'default') };
    }
    if (path === '/api/logs') {
        const params = opts.params ?? {};
        // Envelope-graph parity: an explicit ?graph= echoes back; otherwise
        // the envelope says "list" while rows serialize via the default
        // graph (Log declares no list graph — the fallback the live wire
        // shows: graph:"list" with full default-graph rows).
        const graphParam = params.graph ? String(params.graph) : null;
        const rowGraph = graphParam ?? 'default';
        const search = (l: Record<string, unknown>) =>
            `${l.level} ${l.kind ?? ''} ${l.method ?? ''} ${l.path ?? ''} ${l.username ?? ''} ${l.ip ?? ''} ${l.log ?? ''} ${l.model_name ?? ''}`;
        if (params.download_format) {
            const full = listRows(db.logs as unknown as Record<string, unknown>[], { ...params, start: 0, size: db.logs.length }, search, '-id');
            return exportRows((full.data as unknown as MockLog[]).map((l) => serializeLog(l, rowGraph)), params, 'Log');
        }
        const result = listRows(db.logs as unknown as Record<string, unknown>[], params, search, '-id');
        return { ...result, graph: graphParam ?? 'list', data: (result.data as unknown as MockLog[]).map((l) => serializeLog(l, rowGraph)) };
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
            return saveUser(user, opts.body, userFromBearer(opts.headers));
        }
        return { status: true, data: serializeUser(user, 'default'), graph: 'default' };
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
                requires_mfa: false,
                created: Math.floor(Date.now() / 1000),
            };
            db.users.unshift(user);
            return { status: true, data: serializeUser(user, 'default') };
        }
        return listUsers(opts.params ?? {});
    }
    return { status: false, error: `No mock for ${path}`, error_code: 404 };
}
