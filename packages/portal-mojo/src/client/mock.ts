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
import { registerDnsAdminIntegration } from '../admin/dns/dns-integration';

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

// ── Group API keys + webhooks ─────────────────────────────────────────

interface MockGroupApiKey {
    id: number;
    group: number;
    user: number | null;
    created: number;
    modified: number;
    name: string;
    is_active: boolean;
    permissions: Record<string, unknown>;
    limits: Record<string, unknown>;
    last_used: number | null;
    expires_at: number | null;
    metadata: Record<string, unknown>;
    override_user: boolean;
    token: string; // mock-private; only graph=token or create may expose it
    [field: string]: unknown;
}

interface MockWebhookSubscription {
    id: number;
    group: number;
    created: number;
    modified: number;
    url: string;
    events: string[];
    is_active: boolean;
    metadata: Record<string, unknown>;
    [field: string]: unknown;
}

interface MockSetting {
    id: number;
    created: number;
    modified: number;
    key: string;
    value: string;
    is_secret: boolean;
    group: number | null;
    secretValue: unknown; // mock-private plaintext; never serialized
    [field: string]: unknown;
}

// ── DNSMan — safe state only ─────────────────────────────────────────
// Provider plaintext, quote confirmation values, registrant/WHOIS PII and
// certificate bodies are deliberately absent. Custom handlers consume/return
// transient values without adding them to this database.
interface MockDnsCredential {
    id: number;
    created: number;
    modified: number;
    group: number;
    name: string;
    provider: string;
    is_active: boolean;
    verified: boolean;
    verified_at: number | null;
    domain_count: number;
    last_error: string | null;
    api_key_masked: string;
    api_secret_masked: string;
    [field: string]: unknown;
}

interface MockDnsDomain {
    id: number;
    created: number;
    modified: number;
    group: number | null;
    user: number | null;
    name: string;
    provider: string;
    credential: number | null;
    status: string;
    hosted_zone_id: string | null;
    auto_renew: boolean;
    privacy: boolean;
    verified: boolean;
    registered_on: number | null;
    expires: number | null;
    last_error: string | null;
    metadata: Record<string, unknown>;
    [field: string]: unknown;
}

interface MockDomainPurchase {
    id: number;
    created: number;
    modified: number;
    group: number;
    user: number | null;
    domain_name: string;
    kind: string;
    status: string;
    price: string | null;
    cost: string | null;
    currency: string;
    years: number;
    quote_expires: number | null;
    operation_id: string | null;
    error: string | null;
    metadata: Record<string, unknown>;
    [field: string]: unknown;
}

interface MockDnsCertificate {
    id: number;
    created: number;
    modified: number;
    domain: number;
    common_name: string;
    sans: string[];
    status: string;
    issuer: string | null;
    serial: string | null;
    not_before: number | null;
    not_after: number | null;
    renew_after: number | null;
    last_error: string | null;
    attempts: number;
    [field: string]: unknown;
}

interface MockDnsRecord {
    type: string;
    name: string;
    record_values: string[];
    ttl: number;
}

interface MockTicketNote {
    id: number;
    parent: number;
    created: number;
    group: number | null;
    user: number | null;
    note: string | null;
    media: null;
    metadata: Record<string, unknown>;
    [field: string]: unknown;
}

interface MockTicket {
    id: number;
    created: number;
    modified: number;
    user: number | null;
    group: number | null;
    title: string;
    description: string | null;
    status: string;
    priority: number;
    category: string;
    assignee: number | null;
    incident: number | null;
    metadata: Record<string, unknown>;
    [field: string]: unknown;
}

interface MockMaestroItemLink {
    id: number;
    created: number;
    modified: number;
    ticket: number;
    incident: number | null;
    remote_integration_id: string;
    remote_item_id: number;
    remote_board_id: number | null;
    remote_url: string;
    last_synced: number | null;
    source_kind: string;
    source_id: number;
    [field: string]: unknown;
}

interface MockIncidentHistory {
    id: number;
    parent: number;
    created: number;
    group: number | null;
    kind: string | null;
    to: number | null;
    user: number | null;
    state: number;
    priority: number;
    note: string | null;
    media: null;
    metadata: Record<string, unknown>;
    [field: string]: unknown;
}

interface MockIncident {
    id: number;
    created: number;
    priority: number;
    state: string;
    status: string;
    scope: string;
    category: string;
    country_code: string | null;
    title: string | null;
    details: string | null;
    model_name: string | null;
    model_id: number | null;
    source_ip: string | null;
    hostname: string | null;
    metadata: Record<string, unknown>;
    group_id: number | null;
    [field: string]: unknown;
}

interface MockRuleSet {
    id: number; created: number; modified: number; priority: number; category: string; name: string | null;
    bundle_minutes: number | null; bundle_by: number; bundle_by_rule_set: boolean; match_by: number;
    handler: string | null; trigger_count: number | null; trigger_window: number | null;
    retrigger_every: number | null; metadata: Record<string, unknown>; is_active: boolean;
    [field: string]: unknown;
}

interface MockRule {
    id: number; created: number; modified: number; parent: number; name: string | null; index: number;
    comparator: string; field_name: string | null; value: string; value_type: string; is_required: number;
    [field: string]: unknown;
}

interface MockBouncerDevice {
    id: number;
    muid: string;
    duid: string;
    msid: string;
    fingerprint_id: string | null;
    risk_tier: string;
    event_count: number;
    block_count: number;
    last_seen_ip: string | null;
    linked_muids: string[];
    first_seen: number;
    last_seen: number;
    [field: string]: unknown;
}

interface MockBouncerSignal {
    id: number;
    device: number | null;
    muid: string;
    duid: string;
    msid: string;
    mtab: string;
    session_id: string;
    stage: string;
    ip_address: string | null;
    page_type: string;
    raw_signals: Record<string, unknown>;
    server_signals: Record<string, unknown>;
    risk_score: number;
    decision: string;
    triggered_signals: string[];
    geo_ip: Record<string, unknown> | null;
    created: number;
    [field: string]: unknown;
}

interface MockBotSignature {
    id: number;
    sig_type: string;
    value: string;
    source: string;
    confidence: number;
    hit_count: number;
    block_count: number;
    expires_at: number | null;
    is_active: boolean;
    notes: string;
    created: number;
    modified: number;
    [field: string]: unknown;
}

function buildGroupApiKeys(): MockGroupApiKey[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 201, group: 1, user: 1, created: now - 80 * 86400, modified: now - 2 * 86400, name: 'Acme deploy', is_active: true, permissions: { member: true, view_metrics: true }, limits: { assess: { limit: 500, window: 60 } }, last_used: now - 1800, expires_at: null, metadata: { owner: 'platform' }, override_user: false, token: 'mock_gk_acme_deploy' },
        { id: 202, group: 1, user: null, created: now - 30 * 86400, modified: now - 4 * 86400, name: 'Webhook worker', is_active: true, permissions: { manage_webhooks: true }, limits: {}, last_used: now - 86400, expires_at: now + 180 * 86400, metadata: {}, override_user: false, token: 'mock_gk_webhook_worker' },
        { id: 203, group: 2, user: null, created: now - 120 * 86400, modified: now - 20 * 86400, name: 'Legacy importer', is_active: false, permissions: { member: true }, limits: {}, last_used: now - 40 * 86400, expires_at: now + 10 * 86400, metadata: {}, override_user: false, token: 'mock_gk_legacy_importer' },
    ];
}

function buildWebhookSubscriptions(): MockWebhookSubscription[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 301, group: 1, created: now - 60 * 86400, modified: now - 3 * 86400, url: 'https://hooks.example.com/mojo/accounts', events: ['user.created', 'user.updated'], is_active: true, metadata: { environment: 'production' } },
        { id: 302, group: 1, created: now - 20 * 86400, modified: now - 10 * 86400, url: 'https://audit.example.com/group-events', events: ['member.invited'], is_active: false, metadata: {} },
        { id: 303, group: 2, created: now - 7 * 86400, modified: now - 86400, url: 'https://dev.example.com/webhooks', events: [], is_active: true, metadata: {} },
    ];
}

function buildSettings(): MockSetting[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 401, created: now - 200 * 86400, modified: now - 2 * 86400, key: 'SITE_NAME', value: 'NativeMojo', is_secret: false, group: null, secretValue: null },
        { id: 402, created: now - 120 * 86400, modified: now - 6 * 86400, key: 'MAIL_API_TOKEN', value: '', is_secret: true, group: null, secretValue: 'mock-private-mail-token' },
        { id: 403, created: now - 30 * 86400, modified: now - 86400, key: 'WELCOME_MESSAGE', value: 'Welcome, Acme', is_secret: false, group: 1, secretValue: null },
        // PostgreSQL unique_together permits repeated NULL group values. Keep
        // that live quirk executable instead of enforcing a stricter mock.
        { id: 404, created: now - 5 * 86400, modified: now - 5 * 86400, key: 'SITE_NAME', value: 'NativeMojo fallback', is_secret: false, group: null, secretValue: null },
    ];
}

function buildDnsCredentials(): MockDnsCredential[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 8101, created: now - 180 * 86400, modified: now - 7 * 86400, group: 1, name: 'Acme registrar', provider: 'godaddy', is_active: true, verified: true, verified_at: now - 7 * 86400, domain_count: 12, last_error: null, api_key_masked: '********A1B2', api_secret_masked: '********C3D4' },
        { id: 8102, created: now - 90 * 86400, modified: now - 3600, group: 2, name: 'Engineering legacy', provider: 'godaddy', is_active: true, verified: false, verified_at: now - 30 * 86400, domain_count: 4, last_error: 'Provider verification failed', api_key_masked: '********E5F6', api_secret_masked: '********G7H8' },
        { id: 8103, created: now - 30 * 86400, modified: now - 3 * 86400, group: 4, name: 'Support retired', provider: 'godaddy', is_active: false, verified: true, verified_at: now - 30 * 86400, domain_count: 2, last_error: null, api_key_masked: '********J1K2', api_secret_masked: '********L3M4' },
    ];
}

function buildDnsDomains(): MockDnsDomain[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 8201, created: now - 360 * 86400, modified: now - 86400, group: 1, user: 1, name: 'acme.example', provider: 'route53', credential: null, status: 'active', hosted_zone_id: 'ZMOCKACME', auto_renew: true, privacy: true, verified: true, registered_on: now - 360 * 86400, expires: now + 365 * 86400, last_error: null, metadata: {} },
        { id: 8202, created: now - 120 * 86400, modified: now - 7200, group: 1, user: 1, name: 'acme-byo.example', provider: 'godaddy', credential: 8101, status: 'active', hosted_zone_id: null, auto_renew: false, privacy: false, verified: true, registered_on: now - 900 * 86400, expires: now + 90 * 86400, last_error: null, metadata: {} },
        { id: 8203, created: now - 3600, modified: now - 3600, group: 1, user: 1, name: 'pending-acme.example', provider: 'route53', credential: null, status: 'pending', hosted_zone_id: null, auto_renew: false, privacy: false, verified: false, registered_on: null, expires: null, last_error: null, metadata: {} },
        { id: 8204, created: now - 40 * 86400, modified: now - 86400, group: 1, user: 1, name: 'cert-only.example', provider: 'mojo', credential: null, status: 'active', hosted_zone_id: null, auto_renew: false, privacy: false, verified: true, registered_on: null, expires: null, last_error: null, metadata: {} },
        { id: 8205, created: now - 80 * 86400, modified: now - 3600, group: 2, user: 2, name: 'bad-credential.example', provider: 'godaddy', credential: 8102, status: 'active', hosted_zone_id: null, auto_renew: false, privacy: false, verified: false, registered_on: now - 80 * 86400, expires: now + 285 * 86400, last_error: 'Provider verification failed', metadata: {} },
        { id: 8206, created: now - 1800, modified: now - 900, group: 1, user: 1, name: 'registering-acme.example', provider: 'route53', credential: null, status: 'registering', hosted_zone_id: null, auto_renew: true, privacy: true, verified: false, registered_on: null, expires: null, last_error: null, metadata: {} },
        { id: 8207, created: now - 200 * 86400, modified: now - 86400, group: 1, user: 1, name: 'unknown-provider.example', provider: 'otherdns', credential: null, status: 'active', hosted_zone_id: null, auto_renew: false, privacy: false, verified: true, registered_on: null, expires: null, last_error: 'Provider adapter is unavailable', metadata: {} },
    ];
}

function buildDomainPurchases(): MockDomainPurchase[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 8301, created: now - 360 * 86400, modified: now - 360 * 86400, group: 1, user: 1, domain_name: 'acme.example', kind: 'register', status: 'completed', price: '12.00', cost: '12.00', currency: 'USD', years: 1, quote_expires: now - 360 * 86400, operation_id: 'op-mock-8301', error: null, metadata: {} },
        { id: 8302, created: now - 14 * 86400, modified: now - 14 * 86400, group: 2, user: 2, domain_name: 'failed-example.dev', kind: 'register', status: 'failed', price: '18.00', cost: '18.00', currency: 'USD', years: 1, quote_expires: now - 14 * 86400, operation_id: null, error: 'Registrar operation failed', metadata: {} },
    ];
}

function buildDnsCertificates(): MockDnsCertificate[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 8401, created: now - 60 * 86400, modified: now - 2 * 86400, domain: 8201, common_name: 'acme.example', sans: ['acme.example', '*.acme.example'], status: 'active', issuer: "Let's Encrypt", serial: 'mock-8401', not_before: now - 60 * 86400, not_after: now + 30 * 86400, renew_after: now + 5 * 86400, last_error: null, attempts: 1 },
    ];
}

function buildDnsRecords(): Map<number, MockDnsRecord[]> {
    return new Map([
        [8201, [
            { type: 'A', name: 'acme.example', record_values: ['192.0.2.10', '192.0.2.11'], ttl: 300 },
            { type: 'AAAA', name: 'ipv6.acme.example', record_values: ['2001:db8::10'], ttl: 300 },
            { type: 'TXT', name: '_status.acme.example', record_values: ['portal-mojo', 'v=spf1 -all'], ttl: 300 },
            { type: 'CNAME', name: 'www.acme.example', record_values: ['acme.example'], ttl: 300 },
            { type: 'MX', name: 'acme.example', record_values: ['10 mail.acme.example'], ttl: 1800 },
            { type: 'SRV', name: '_sip._tcp.acme.example', record_values: ['10 5 5060 sip.acme.example'], ttl: 300 },
            { type: 'CAA', name: 'acme.example', record_values: ['0 issue "letsencrypt.org"'], ttl: 3600 },
            { type: 'NS', name: 'delegated.acme.example', record_values: ['ns1.example.net', 'ns2.example.net'], ttl: 3600 },
            { type: 'HTTPS', name: 'svc.acme.example', record_values: ['1 . alpn=h2'], ttl: 300 },
            { type: 'TXT', name: '_acme-challenge.acme.example', record_values: ['live-token'], ttl: 60 },
        ]],
        [8202, [
            { type: 'CNAME', name: 'www.acme-byo.example', record_values: ['acme-byo.example'], ttl: 600 },
            { type: 'TXT', name: '_acme-challenge.acme-byo.example', record_values: ['retired'], ttl: 600 },
        ]],
    ]);
}

function buildTicketNotes(): MockTicketNote[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 705, parent: 504, created: now - 240, group: 1, user: null, note: 'Approve blocking the suspicious client fingerprint?', media: null, metadata: { action: { handler: 'incident.rule_approval', label: 'Block suspicious fingerprint', context: { target: 'fp-headless', detail: 'Apply the reviewed bot signature to future requests.' }, references: ['signal:1003'], resolved: false } } },
        { id: 704, parent: 505, created: now - 3600, group: null, user: null, note: 'Previously reviewed action.', media: null, metadata: { action: { handler: 'incident.rule_approval', label: 'Escalate alert', context: { target: 'incident:603' }, resolved: true, resolution: 'approve' } } },
        { id: 703, parent: 501, created: now - 480, group: 1, user: null, note: 'Status changed from new to open.', media: null, metadata: { type: 'status_change', old_status: 'new', new_status: 'open' } },
        { id: 701, parent: 501, created: now - 900, group: 1, user: 1, note: 'Confirmed the webhook failures began after the receiver deploy.', media: null, metadata: {} },
        { id: 700, parent: 501, created: now - 7200, group: 1, user: null, note: '[LLM Agent] Five consecutive 503 responses observed.', media: null, metadata: { origin: 'agent' } },
        { id: 699, parent: 502, created: now - 86400, group: 2, user: 2, note: 'Customer supplied a fresh trace id.', media: null, metadata: {} },
    ];
}

function buildTickets(): MockTicket[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 501, created: now - 3 * 86400, modified: now - 480, user: 1, group: 1, title: 'Webhook receiver failures', description: 'Five consecutive **503 responses** began after the receiver deploy.', status: 'open', priority: 8, category: 'incident', assignee: 12, incident: 601, metadata: { llm_enabled: true } },
        { id: 502, created: now - 2 * 86400, modified: now - 7200, user: 2, group: 2, title: 'Vendor escalation needs review', description: 'Preserves a category not present in the client catalog.', status: 'pending', priority: 6, category: 'vendor_escalation', assignee: null, incident: 602, metadata: {} },
        { id: 503, created: now - 18 * 3600, modified: now - 18 * 3600, user: 1, group: null, title: 'Unassigned login investigation', description: null, status: 'new', priority: 9, category: 'security', assignee: null, incident: 603, metadata: {} },
        { id: 504, created: now - 7 * 3600, modified: now - 240, user: 12, group: 1, title: 'Approve bot fingerprint block', description: 'An operator decision is required before applying the rule.', status: 'assistant_review', priority: 10, category: 'security', assignee: 12, incident: 603, metadata: { llm_enabled: true } },
        { id: 505, created: now - 8 * 86400, modified: now - 3600, user: 1, group: null, title: 'Resolved account escalation', description: 'Retains a resolved approval card for showcase coverage.', status: 'resolved', priority: 4, category: 'ticket', assignee: 1, incident: null, metadata: {} },
        { id: 506, created: now - 6 * 3600, modified: now - 1200, user: 1, group: 1, title: 'Incident summary linked', description: 'Demonstrates a ticket related to an active incident.', status: 'in_progress', priority: 7, category: 'incident', assignee: 1, incident: 601, metadata: {} },
        { id: 507, created: now - 5 * 86400, modified: now - 1800, user: 1, group: 1, title: 'Already tracked in Maestro', description: 'The remote work item is already linked.', status: 'open', priority: 5, category: 'feature', assignee: 12, incident: null, metadata: {} },
        { id: 508, created: now - 5 * 3600, modified: now - 600, user: 12, group: null, title: 'LLM-assisted log triage', description: 'Assistant review is active for this queue item.', status: 'llm_review', priority: 6, category: 'bug', assignee: 12, incident: null, metadata: { llm_enabled: true } },
        { id: 509, created: now - 12 * 86400, modified: now - 2 * 86400, user: 1, group: null, title: 'Closed fulfillment request', description: null, status: 'closed', priority: 2, category: 'fulfillment', assignee: 1, incident: null, metadata: {} },
    ];
}

function buildMaestroItemLinks(): MockMaestroItemLink[] {
    const now = Math.floor(Date.now() / 1000);
    return [{ id: 901, created: now - 2 * 86400, modified: now - 1800, ticket: 507, incident: null, remote_integration_id: 'mock-maestro', remote_item_id: 1413, remote_board_id: 7, remote_url: 'https://maestro.example.test/items/1413', last_synced: now - 1800, source_kind: 'ticket', source_id: 507 }];
}

function buildIncidentHistory(): MockIncidentHistory[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 801, parent: 601, created: now - 600, group: 1, kind: 'note', to: null, user: 1, state: 2, priority: 7, note: 'Escalated after the fifth failed delivery.', media: null, metadata: {} },
        { id: 800, parent: 601, created: now - 5400, group: 1, kind: 'state', to: null, user: 12, state: 1, priority: 5, note: 'Investigation opened.', media: null, metadata: { old_state: 0 } },
        { id: 799, parent: 602, created: now - 2 * 86400, group: 2, kind: 'note', to: 2, user: null, state: 1, priority: 3, note: 'Automated monitor linked related events.', media: null, metadata: {} },
        { id: 798, parent: 603, created: now - 7000, group: null, kind: 'created', to: null, user: null, state: 0, priority: 7, note: 'Bouncer created the incident. Authorization: Bearer sentinel-history-secret', media: null, metadata: { token: 'sentinel-history-token' } },
    ];
}

function buildIncidents(): MockIncident[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        {
            id: 603, created: now - 7100, priority: 7, state: 'open', status: 'investigating',
            scope: 'account', category: 'security:bouncer:block', country_code: 'CN',
            title: 'Automated client blocked at login',
            // The real reporter writes the MUID into details; it does not bind
            // the generic model_name/model_id relation to BouncerDevice.
            details: 'Bouncer blocked muid-bot-003 after webdriver, headless, and rapid-navigation signals.',
            model_name: null, model_id: null, source_ip: '198.51.100.66', hostname: 'auth.example.test',
            metadata: {
                decision: 'block', risk_score: 94, muid: 'muid-bot-003', triggered_signals: ['webdriver', 'headless'],
                http_method: 'POST', http_url: 'https://auth.example.test/login?api_key=sentinel-url-secret',
                request_headers: { authorization: 'Bearer sentinel-incident-secret', cookie: 'sid=sentinel-session-secret' },
                request_body: { username: 'bot@example.test', password: 'sentinel-body-secret' },
                stack_trace: 'Traceback (most recent call last):\n  File "bouncer.py", line 91, in assess\nValueError: Bearer sentinel-stack-secret',
                event_count: 2,
            }, group_id: null,
        },
        {
            id: 601, created: now - 600, priority: 7, state: 'open', status: 'open',
            scope: 'group', category: 'delivery:webhook', country_code: 'US',
            title: 'Webhook receiver failures', details: 'Five consecutive delivery failures.',
            model_name: null, model_id: null, source_ip: null, hostname: 'hooks.example.test',
            metadata: { event_count: 1, maestro_url: 'https://maestro.example.test/items/1601' }, group_id: 1,
        },
        {
            id: 602, created: now - 2 * 86400, priority: 3, state: 'open', status: 'new',
            scope: 'group', category: 'account:review', country_code: 'US',
            title: 'Account review requested', details: 'Automated monitor linked related events.',
            model_name: null, model_id: null, source_ip: null, hostname: null,
            metadata: { event_count: 1, maestro_url: 'https://maestro.example.test/items/1602' }, group_id: 2,
        },
    ];
}

function buildRuleSets(): MockRuleSet[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 1101, created: now - 100 * 86400, modified: now - 3600, priority: 5, category: 'security:auth', name: 'High-risk authentication', bundle_minutes: 30, bundle_by: 4, bundle_by_rule_set: true, match_by: 0, handler: 'block://?ttl=3600&fleet_wide=1,ticket://?priority=9&status=open,notify://perm@manage_security,oncall', trigger_count: 3, trigger_window: 10, retrigger_every: 5, metadata: { owner: 'security', arbitrary_future: { mode: 'retain' } }, is_active: true, future_top_level: 'retain-me' },
        { id: 1102, created: now - 50 * 86400, modified: now - 7200, priority: 5, category: 'security:auth', name: 'Legacy handler compatibility', bundle_minutes: null, bundle_by: 10, bundle_by_rule_set: true, match_by: 1, handler: 'job://myapp.jobs.inspect?window=300,email://perm@manage_security,protected@incident_emails,sms://oncall,maestro://?board=47,llm://,resolve://?status=resolved&note=Handled,custom://future?x=1', trigger_count: null, trigger_window: null, retrigger_every: null, metadata: { future: true }, is_active: false },
        { id: 1103, created: now - 20 * 86400, modified: now - 900, priority: 20, category: 'health', name: 'Future enum fixture', bundle_minutes: 0, bundle_by: 99, bundle_by_rule_set: false, match_by: 7, handler: '', trigger_count: null, trigger_window: null, retrigger_every: null, metadata: {}, is_active: false },
    ];
}

function buildRules(): MockRule[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 1201, created: now - 100 * 86400, modified: now - 3600, parent: 1101, name: 'Risk score', index: 0, comparator: '>=', field_name: 'risk_score', value: '80', value_type: 'int', is_required: 1 },
        { id: 1202, created: now - 100 * 86400, modified: now - 3500, parent: 1101, name: 'Authentication category', index: 1, comparator: 'contains', field_name: 'category', value: 'auth', value_type: 'str', is_required: 1 },
        { id: 1203, created: now - 50 * 86400, modified: now - 7000, parent: 1102, name: 'Legacy bool', index: 0, comparator: 'eq', field_name: 'metadata.suspicious', value: 'false', value_type: 'bool', is_required: 0, future_rule_field: { retain: true } },
        { id: 1204, created: now - 50 * 86400, modified: now - 6900, parent: 1102, name: 'Future comparator', index: 1, comparator: 'future-op', field_name: 'metadata.future', value: 'x', value_type: 'future-type', is_required: 0 },
    ];
}

function buildBouncerDevices(): MockBouncerDevice[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 901, muid: 'muid-human-001', duid: 'duid-browser-001', msid: 'msid-a1', fingerprint_id: 'fp-chrome-mac', risk_tier: 'low', event_count: 28, block_count: 0, last_seen_ip: '203.0.113.42', linked_muids: [], first_seen: now - 90 * 86400, last_seen: now - 300 },
        { id: 902, muid: 'muid-monitor-002', duid: 'duid-browser-002', msid: 'msid-b2', fingerprint_id: 'fp-firefox-linux', risk_tier: 'medium', event_count: 113, block_count: 1, last_seen_ip: '198.51.100.77', linked_muids: ['muid-monitor-002b'], first_seen: now - 30 * 86400, last_seen: now - 1800 },
        { id: 903, muid: 'muid-bot-003', duid: '', msid: 'msid-c3', fingerprint_id: 'fp-headless', risk_tier: 'blocked', event_count: 412, block_count: 18, last_seen_ip: '198.51.100.66', linked_muids: ['muid-bot-003b', 'muid-bot-003c'], first_seen: now - 14 * 86400, last_seen: now - 7200 },
    ];
}

function buildBouncerSignals(): MockBouncerSignal[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 1003, device: 903, muid: 'muid-bot-003', duid: '', msid: 'msid-c3', mtab: 'tab-9', session_id: 'session-bot-9', stage: 'assess', ip_address: '198.51.100.66', page_type: 'login', raw_signals: { webdriver: true, languages: [], timing_ms: 12 }, server_signals: { user_agent: 'HeadlessChrome', header_order: 'automation' }, risk_score: 94, decision: 'block', triggered_signals: ['webdriver', 'headless', 'rapid_navigation'], geo_ip: { id: 3103, ip_address: '198.51.100.66', country_code: 'CN', region_code: 'CN-BJ', city: 'Beijing', is_vpn: true, is_proxy: true, is_datacenter: true }, created: now - 7200 },
        { id: 1002, device: 902, muid: 'muid-monitor-002', duid: 'duid-browser-002', msid: 'msid-b2', mtab: 'tab-4', session_id: 'session-monitor-4', stage: 'submit', ip_address: '198.51.100.77', page_type: 'registration', raw_signals: { canvas: 'stable', focus_changes: 14 }, server_signals: { user_agent: 'Firefox/141' }, risk_score: 51, decision: 'monitor', triggered_signals: ['focus_churn'], geo_ip: { id: 3102, ip_address: '198.51.100.77', country_code: 'US', region_code: 'US-VA', city: 'Ashburn', is_vpn: false, is_proxy: false, is_datacenter: true }, created: now - 1800 },
        { id: 1001, device: 901, muid: 'muid-human-001', duid: 'duid-browser-001', msid: 'msid-a1', mtab: 'tab-1', session_id: 'session-human-1', stage: 'assess', ip_address: '203.0.113.42', page_type: 'login', raw_signals: { webdriver: false, languages: ['en-US'], timing_ms: 1840 }, server_signals: { user_agent: 'Chrome/148' }, risk_score: 4, decision: 'allow', triggered_signals: [], geo_ip: { id: 3101, ip_address: '203.0.113.42', country_code: 'US', region_code: 'US-CA', city: 'San Diego', is_vpn: false, is_proxy: false, is_datacenter: false }, created: now - 300 },
    ];
}

function buildBotSignatures(): MockBotSignature[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 1101, sig_type: 'fingerprint', value: 'fp-headless', source: 'auto', confidence: 96, hit_count: 412, block_count: 18, expires_at: now + 20 * 86400, is_active: true, notes: 'Learned from repeated high-confidence blocks.', created: now - 10 * 86400, modified: now - 7200 },
        { id: 1102, sig_type: 'subnet_24', value: '198.51.100.0/24', source: 'manual', confidence: 85, hit_count: 39, block_count: 9, expires_at: null, is_active: true, notes: 'Operations-reviewed campaign subnet.', created: now - 40 * 86400, modified: now - 2 * 86400 },
        { id: 1103, sig_type: 'user_agent', value: 'BadCrawler/1.0', source: 'auto', confidence: 72, hit_count: 17, block_count: 3, expires_at: now - 86400, is_active: false, notes: '', created: now - 60 * 86400, modified: now - 8 * 86400 },
    ];
}

function serializeGroupApiKey(key: MockGroupApiKey, graph = 'default', includeCreateToken = false): Record<string, unknown> {
    const group = db.groups.find((candidate) => candidate.id === key.group);
    const user = key.user == null ? null : db.users.find((candidate) => candidate.id === key.user);
    const row: Record<string, unknown> = {
        id: key.id, created: key.created, modified: key.modified, name: key.name,
        is_active: key.is_active, permissions: key.permissions, limits: key.limits,
        last_used: key.last_used, expires_at: key.expires_at, metadata: key.metadata,
        override_user: key.override_user,
        group: group ? groupBasic(group) : null,
        user: user ? userBasic(user) : null,
    };
    if (graph === 'token' || includeCreateToken) row.token = key.token;
    return row;
}

function serializeWebhook(row: MockWebhookSubscription, graph = 'default'): Record<string, unknown> {
    const group = db.groups.find((candidate) => candidate.id === row.group);
    return {
        id: row.id, created: row.created, modified: row.modified, url: row.url,
        events: row.events, is_active: row.is_active,
        ...(graph === 'detail' ? { metadata: row.metadata } : {}),
        group: group ? groupBasic(group) : null,
    };
}

function serializeSetting(row: MockSetting): Record<string, unknown> {
    const group = row.group == null ? null : db.groups.find((candidate) => candidate.id === row.group);
    return {
        id: row.id, created: row.created, modified: row.modified, key: row.key,
        value: row.is_secret ? '' : row.value,
        is_secret: row.is_secret,
        group: group ? groupBasic(group) : null,
        display_value: row.is_secret ? '******' : row.value,
    };
}

function serializeDnsCredential(row: MockDnsCredential): Record<string, unknown> {
    const group = db.groups.find((candidate) => candidate.id === row.group);
    return {
        id: row.id, created: row.created, modified: row.modified,
        name: row.name, provider: row.provider, is_active: row.is_active,
        verified: row.verified, verified_at: row.verified_at,
        domain_count: row.domain_count, last_error: row.last_error,
        api_key_masked: row.api_key_masked, api_secret_masked: row.api_secret_masked,
        group: group ? groupBasic(group) : null,
    };
}

function serializeDnsDomain(row: MockDnsDomain, graph = 'default'): Record<string, unknown> {
    const group = row.group == null ? null : db.groups.find((candidate) => candidate.id === row.group);
    const credential = row.credential == null ? null : db.dnsCredentials.find((candidate) => candidate.id === row.credential);
    if (graph === 'list') {
        return {
            id: row.id, created: row.created, name: row.name, provider: row.provider,
            status: row.status, expires: row.expires, group: group ? groupBasic(group) : null,
        };
    }
    const user = row.user == null ? null : db.users.find((candidate) => candidate.id === row.user);
    return {
        id: row.id, created: row.created, modified: row.modified,
        name: row.name, provider: row.provider, status: row.status,
        hosted_zone_id: row.hosted_zone_id, auto_renew: row.auto_renew,
        privacy: row.privacy, verified: row.verified, registered_on: row.registered_on,
        expires: row.expires, last_error: row.last_error,
        group: group ? groupBasic(group) : null,
        user: user ? userBasic(user) : null,
        credential: credential ? {
            id: credential.id, name: credential.name, provider: credential.provider,
            is_active: credential.is_active, verified: credential.verified,
        } : null,
    };
}

function serializeDomainPurchase(row: MockDomainPurchase): Record<string, unknown> {
    const group = db.groups.find((candidate) => candidate.id === row.group);
    const user = row.user == null ? null : db.users.find((candidate) => candidate.id === row.user);
    return {
        id: row.id, created: row.created, modified: row.modified,
        domain_name: row.domain_name, kind: row.kind, status: row.status,
        price: row.price, cost: row.cost, currency: row.currency, years: row.years,
        quote_expires: row.quote_expires, operation_id: row.operation_id, error: row.error,
        group: group ? groupBasic(group) : null, user: user ? userBasic(user) : null,
    };
}

function serializeDnsCertificate(row: MockDnsCertificate): Record<string, unknown> {
    const domain = db.dnsDomains.find((candidate) => candidate.id === row.domain);
    const now = Math.floor(Date.now() / 1000);
    return {
        id: row.id, created: row.created, modified: row.modified,
        common_name: row.common_name, sans: [...row.sans], status: row.status,
        issuer: row.issuer, serial: row.serial, not_before: row.not_before,
        not_after: row.not_after, renew_after: row.renew_after,
        last_error: row.last_error, attempts: row.attempts,
        days_remaining: row.not_after == null ? null : Math.floor((row.not_after - now) / 86400),
        domain: domain ? {
            id: domain.id, name: domain.name, provider: domain.provider,
            status: domain.status, expires: domain.expires,
        } : null,
    };
}

function serializeFeedUser(userId: number | null): Record<string, unknown> | null {
    if (userId == null) return null;
    const user = db.users.find((candidate) => candidate.id === userId);
    return user ? userBasic(user) : null;
}

function serializeTicketNote(row: MockTicketNote): Record<string, unknown> {
    return { ...row, user: serializeFeedUser(row.user), media: null };
}

function serializeTicket(row: MockTicket): Record<string, unknown> {
    const group = row.group == null ? null : db.groups.find((candidate) => candidate.id === row.group);
    const user = row.user == null ? null : db.users.find((candidate) => candidate.id === row.user);
    const assignee = row.assignee == null ? null : db.users.find((candidate) => candidate.id === row.assignee);
    const incident = row.incident == null ? null : db.incidentRecords.find((candidate) => candidate.id === row.incident);
    return {
        ...row,
        group: group ? groupBasic(group) : null,
        user: user ? userBasic(user) : null,
        assignee: assignee ? userBasic(assignee) : null,
        incident: incident ? { id: incident.id, title: incident.title, status: incident.status, priority: incident.priority } : null,
    };
}

function serializeMaestroItemLink(row: MockMaestroItemLink): Record<string, unknown> {
    const ticket = db.tickets.find((candidate) => candidate.id === row.ticket);
    const incident = row.incident == null ? null : db.incidentRecords.find((candidate) => candidate.id === row.incident);
    return {
        ...row,
        ticket: ticket ? { id: ticket.id, title: ticket.title, status: ticket.status, priority: ticket.priority } : row.ticket,
        incident: incident ? { id: incident.id, title: incident.title, status: incident.status, priority: incident.priority } : null,
    };
}

function serializeIncidentHistory(row: MockIncidentHistory): Record<string, unknown> {
    const stateLabels: Record<number, string> = { 0: 'New', 1: 'Open', 2: 'Escalated', 3: 'Resolved' };
    const priorityLabels: Record<number, string> = { 0: 'None', 1: 'Low', 3: 'Normal', 5: 'High', 7: 'Critical' };
    return {
        ...row,
        user: serializeFeedUser(row.user),
        media: null,
        state_display: stateLabels[row.state] ?? String(row.state),
        priority_display: priorityLabels[row.priority] ?? String(row.priority),
    };
}

function serializeIncidentEvent(row: MockIncidentEvent): Record<string, unknown> {
    const incident = row.incident == null ? null : db.incidentRecords.find((candidate) => candidate.id === row.incident);
    return { ...row, incident: incident ? { id: incident.id, title: incident.title, status: incident.status, priority: incident.priority } : null };
}

function serializeBouncerDevice(row: MockBouncerDevice, graph: string): Record<string, unknown> {
    if (graph === 'list') {
        return { id: row.id, muid: row.muid, duid: row.duid, risk_tier: row.risk_tier, event_count: row.event_count, block_count: row.block_count, last_seen_ip: row.last_seen_ip, last_seen: row.last_seen };
    }
    return { ...row };
}

function serializeBouncerSignal(row: MockBouncerSignal, graph: string): Record<string, unknown> {
    const device = row.device == null ? null : db.bouncerDevices.find((candidate) => candidate.id === row.device);
    if (graph === 'list') {
        return { id: row.id, muid: row.muid, msid: row.msid, stage: row.stage, ip_address: row.ip_address, page_type: row.page_type, risk_score: row.risk_score, decision: row.decision, created: row.created };
    }
    if (graph === 'detail') {
        return {
            id: row.id, muid: row.muid, duid: row.duid, msid: row.msid, mtab: row.mtab,
            session_id: row.session_id, stage: row.stage, ip_address: row.ip_address,
            page_type: row.page_type, risk_score: row.risk_score, decision: row.decision,
            triggered_signals: row.triggered_signals, raw_signals: row.raw_signals,
            server_signals: row.server_signals, created: row.created,
            device: device ? serializeBouncerDevice(device, 'default') : null,
            geo_ip: row.geo_ip,
            // Deliberately no token_nonce. The backend cleanup is tracked
            // separately; the portal mock never types, stores, or caches it.
        };
    }
    return {
        id: row.id, muid: row.muid, duid: row.duid, msid: row.msid, mtab: row.mtab,
        stage: row.stage, ip_address: row.ip_address, page_type: row.page_type,
        risk_score: row.risk_score, decision: row.decision,
        triggered_signals: row.triggered_signals, created: row.created,
        device: device ? serializeBouncerDevice(device, 'list') : null,
    };
}

function serializeBotSignature(row: MockBotSignature, graph: string): Record<string, unknown> {
    if (graph === 'list') {
        return { id: row.id, sig_type: row.sig_type, value: row.value, source: row.source, confidence: row.confidence, hit_count: row.hit_count, is_active: row.is_active, expires_at: row.expires_at, modified: row.modified };
    }
    return { ...row };
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
    logs.unshift(
        {
            id: 100101, created: nowSec - 90, level: 'info', kind: 'model_change',
            method: 'POST', path: '/api/group/member/100', payload: null,
            ip: '127.0.0.1', duid: null, uid: 13, gid: 1,
            username: 'groups.manager', user_agent: 'mock-verifier',
            log: 'Membership role label updated', model_name: 'account.GroupMember', model_id: 100,
        },
        {
            id: 100102, created: nowSec - 180, level: 'info', kind: 'member:invited',
            method: 'POST', path: '/api/group/member/invite', payload: null,
            ip: '127.0.0.1', duid: null, uid: 13, gid: 1,
            username: 'groups.manager', user_agent: 'mock-verifier',
            log: 'Membership invitation sent', model_name: 'account.GroupMember', model_id: 100,
        },
    );
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
    incident: number | null;
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

/**
 * Login origins. WIDENED for #1291: the login-location map aggregates by
 * country, so a three-country fixture produced a map with nothing to draw.
 * Nine countries across five continents, plus the private-range row the live
 * wire really does produce.
 */
const LOGIN_GEOS: { ip: string; cc: string | null; region: string | null; rc: string | null; city: string | null; lat: number | null; lng: number | null }[] = [
    { ip: '73.92.14.5', cc: 'US', region: 'California', rc: 'CA', city: 'San Diego', lat: 32.7157, lng: -117.1611 },
    { ip: '172.58.27.101', cc: 'US', region: 'Texas', rc: 'TX', city: 'Austin', lat: 30.2672, lng: -97.7431 },
    { ip: '64.18.22.90', cc: 'US', region: 'New York', rc: 'NY', city: 'New York', lat: 40.7128, lng: -74.006 },
    { ip: '98.51.100.23', cc: 'DE', region: 'Berlin', rc: 'BE', city: 'Berlin', lat: 52.52, lng: 13.405 },
    { ip: '203.0.113.9', cc: 'GB', region: 'England', rc: 'ENG', city: 'London', lat: 51.5072, lng: -0.1276 },
    { ip: '45.83.220.14', cc: 'BR', region: 'São Paulo', rc: 'SP', city: 'São Paulo', lat: -23.5505, lng: -46.6333 },
    { ip: '103.21.244.7', cc: 'IN', region: 'Maharashtra', rc: 'MH', city: 'Mumbai', lat: 19.076, lng: 72.8777 },
    { ip: '133.242.19.58', cc: 'JP', region: 'Tokyo', rc: '13', city: 'Tokyo', lat: 35.6762, lng: 139.6503 },
    { ip: '196.10.52.77', cc: 'ZA', region: 'Gauteng', rc: 'GP', city: 'Johannesburg', lat: -26.2041, lng: 28.0473 },
    { ip: '1.128.44.201', cc: 'AU', region: 'New South Wales', rc: 'NSW', city: 'Sydney', lat: -33.8688, lng: 151.2093 },
    { ip: '185.220.101.44', cc: 'NL', region: 'North Holland', rc: 'NH', city: 'Amsterdam', lat: 52.3676, lng: 4.9041 },
    // Live parity: private-range logins geolocate as region "Private" and
    // carry NO coordinates — invisible on the map by construction, visible
    // in the Logins tab. The map's status line says so.
    { ip: '127.0.0.1', cc: null, region: 'Private', rc: null, city: null, lat: null, lng: null },
];
const LOGIN_SOURCES = ['password', 'password', 'magic', 'passkey'];

function buildLoginEvents(users: MockUser[]): MockLoginEvent[] {
    const rand = mulberry32(20260809);
    const nowSec = Math.floor(Date.now() / 1000);
    const events: MockLoginEvent[] = [];
    let id = 14400;
    // Dense history for the detail-view seeds, sparse for the rest. Widened
    // with #1291 so the country aggregation has real mass to plot.
    const owners = [
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        2, 2, 2, 2, 2, 2,
        3, 3, 3, 3, 3,
        9, 9, 10, 10, 11, 12, 13, 14, 16,
    ];
    for (const uid of owners) {
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

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ #1291 — GeoIP cache + device locations (fixtures)                    ║
// ║                                                                      ║
// ║ Shapes mirror django-mojo `account/models/geolocated_ip.py` and      ║
// ║ `account/models/device.py` exactly, including the four GeoLocatedIP  ║
// ║ graphs and the computed `is_threat` / `is_suspicious` / `risk_score` ║
// ║ / `block_active` / `whitelist_active` properties. This block is the  ║
// ║ executable spec for the wire the admin surfaces speak.               ║
// ╚══════════════════════════════════════════════════════════════════════╝

interface MockGeoIp {
    id: number;
    created: number;
    modified: number;
    last_seen: number;
    ip_address: string;
    subnet: string | null;
    country_code: string | null;
    country_name: string | null;
    region: string | null;
    region_code: string | null;
    city: string | null;
    postal_code: string | null;
    latitude: number | null;
    longitude: number | null;
    timezone: string | null;
    is_tor: boolean;
    is_vpn: boolean;
    is_proxy: boolean;
    is_cloud: boolean;
    is_datacenter: boolean;
    is_mobile: boolean;
    is_known_attacker: boolean;
    is_known_abuser: boolean;
    threat_level: string | null;
    asn: string | null;
    asn_org: string | null;
    isp: string | null;
    mobile_carrier: string | null;
    connection_type: string | null;
    is_blocked: boolean;
    blocked_at: number | null;
    blocked_until: number | null;
    blocked_reason: string | null;
    block_count: number;
    is_whitelisted: boolean;
    whitelisted_reason: string | null;
    whitelisted_until: number | null;
    expires_at: number | null;
    /** Excluded from the `default` graph — the raw provider blob. */
    provider: string | null;
    data: Record<string, unknown>;
    [field: string]: unknown;
}

interface MockDeviceLocation {
    id: number;
    user: number;
    user_device: number;
    ip_address: string;
    /** FK to a MockGeoIp id, or null while the row is unenriched. */
    geolocation: number | null;
    first_seen: number;
    last_seen: number;
    [field: string]: unknown;
}

/** IPv4 keeps the historical string-prefix subnet; IPv6 would use the /64. */
function mockSubnetOf(ip: string): string {
    return ip.includes(':') ? ip : ip.slice(0, ip.lastIndexOf('.'));
}

interface GeoIpSeed {
    ip: string;
    cc?: string | null;
    country?: string | null;
    region?: string | null;
    rc?: string | null;
    city?: string | null;
    postal?: string | null;
    lat?: number | null;
    lng?: number | null;
    tz?: string | null;
    asn?: string | null;
    asnOrg?: string | null;
    isp?: string | null;
    connection?: string | null;
    mobileCarrier?: string | null;
    threat?: string | null;
    tor?: boolean;
    vpn?: boolean;
    proxy?: boolean;
    cloud?: boolean;
    datacenter?: boolean;
    mobile?: boolean;
    attacker?: boolean;
    abuser?: boolean;
    /** Enforcement. `blockedInDays` in the PAST produces an expired block. */
    blockedReason?: string;
    blockedInDays?: number | null;
    blockCount?: number;
    whitelistReason?: string;
    whitelistInDays?: number | null;
    provider?: string;
    lastSeenHours?: number;
}

const GEOIP_SEEDS: GeoIpSeed[] = [
    // ── Ordinary residential/business origins, mirroring LOGIN_GEOS ──
    { ip: '73.92.14.5', cc: 'US', country: 'United States', region: 'California', rc: 'US-CA', city: 'San Diego', postal: '92101', lat: 32.7157, lng: -117.1611, tz: 'America/Los_Angeles', asn: 'AS20001', asnOrg: 'Charter Communications', isp: 'Spectrum', connection: 'residential', lastSeenHours: 1 },
    { ip: '172.58.27.101', cc: 'US', country: 'United States', region: 'Texas', rc: 'US-TX', city: 'Austin', postal: '73301', lat: 30.2672, lng: -97.7431, tz: 'America/Chicago', asn: 'AS21928', asnOrg: 'T-Mobile USA', isp: 'T-Mobile', connection: 'cellular', mobile: true, mobileCarrier: 'T-Mobile', lastSeenHours: 6 },
    { ip: '64.18.22.90', cc: 'US', country: 'United States', region: 'New York', rc: 'US-NY', city: 'New York', postal: '10001', lat: 40.7128, lng: -74.006, tz: 'America/New_York', asn: 'AS13444', asnOrg: 'Google', isp: 'Google Fiber', connection: 'business', lastSeenHours: 20 },
    { ip: '98.51.100.23', cc: 'DE', country: 'Germany', region: 'Berlin', rc: 'DE-BE', city: 'Berlin', postal: '10115', lat: 52.52, lng: 13.405, tz: 'Europe/Berlin', asn: 'AS3320', asnOrg: 'Deutsche Telekom AG', isp: 'Telekom', connection: 'residential', lastSeenHours: 3 },
    { ip: '103.21.244.7', cc: 'IN', country: 'India', region: 'Maharashtra', rc: 'IN-MH', city: 'Mumbai', lat: 19.076, lng: 72.8777, tz: 'Asia/Kolkata', asn: 'AS13335', asnOrg: 'Cloudflare', isp: 'Cloudflare', connection: 'hosting', cloud: true, datacenter: true, threat: 'low', lastSeenHours: 11 },
    { ip: '133.242.19.58', cc: 'JP', country: 'Japan', region: 'Tokyo', rc: 'JP-13', city: 'Tokyo', lat: 35.6762, lng: 139.6503, tz: 'Asia/Tokyo', asn: 'AS9370', asnOrg: 'SAKURA Internet', isp: 'SAKURA', connection: 'hosting', datacenter: true, lastSeenHours: 30 },
    { ip: '196.10.52.77', cc: 'ZA', country: 'South Africa', region: 'Gauteng', rc: 'ZA-GP', city: 'Johannesburg', lat: -26.2041, lng: 28.0473, tz: 'Africa/Johannesburg', asn: 'AS2018', asnOrg: 'TENET', isp: 'TENET', connection: 'business', lastSeenHours: 52 },
    { ip: '1.128.44.201', cc: 'AU', country: 'Australia', region: 'New South Wales', rc: 'AU-NSW', city: 'Sydney', lat: -33.8688, lng: 151.2093, tz: 'Australia/Sydney', asn: 'AS1221', asnOrg: 'Telstra', isp: 'Telstra', connection: 'residential', lastSeenHours: 40 },

    // ── A Tor exit: the maximum-signal row ──
    { ip: '185.220.101.44', cc: 'NL', country: 'Netherlands', region: 'North Holland', rc: 'NL-NH', city: 'Amsterdam', lat: 52.3676, lng: 4.9041, tz: 'Europe/Amsterdam', asn: 'AS205100', asnOrg: 'F3 Netze e.V.', isp: 'Tor Exit Relay', connection: 'hosting', tor: true, proxy: true, datacenter: true, attacker: true, threat: 'critical', blockedReason: 'auto:threat_escalation', blockedInDays: null, blockCount: 4, lastSeenHours: 2 },

    // ── A datacenter VPN, blocked with a live TTL ──
    { ip: '45.33.32.156', cc: 'US', country: 'United States', region: 'California', rc: 'US-CA', city: 'Fremont', lat: 37.5483, lng: -121.9886, tz: 'America/Los_Angeles', asn: 'AS63949', asnOrg: 'Akamai Connected Cloud', isp: 'Linode', connection: 'hosting', vpn: true, cloud: true, datacenter: true, threat: 'high', blockedReason: 'Credential stuffing from a VPN exit', blockedInDays: 6, blockCount: 2, lastSeenHours: 4 },

    // ── An EXPIRED block: is_blocked is still true, blocked_until is past.
    //    web-mojo rendered this as "Blocked". block_active() says otherwise.
    { ip: '104.28.14.33', cc: 'BR', country: 'Brazil', region: 'São Paulo', rc: 'BR-SP', city: 'São Paulo', lat: -23.5505, lng: -46.6333, tz: 'America/Sao_Paulo', asn: 'AS13335', asnOrg: 'Cloudflare', isp: 'Cloudflare', connection: 'hosting', proxy: true, cloud: true, threat: 'medium', blockedReason: 'Scraper burst', blockedInDays: -3, blockCount: 1, lastSeenHours: 9 },

    // ── An ACTIVE whitelist (office egress) ──
    { ip: '203.0.113.9', cc: 'GB', country: 'United Kingdom', region: 'England', rc: 'GB-ENG', city: 'London', postal: 'EC2A', lat: 51.5072, lng: -0.1276, tz: 'Europe/London', asn: 'AS2856', asnOrg: 'British Telecommunications', isp: 'BT Business', connection: 'business', whitelistReason: 'London office egress', whitelistInDays: null, lastSeenHours: 1 },

    // ── An EXPIRED whitelist: is_whitelisted true, whitelisted_until past ──
    { ip: '198.51.100.77', cc: 'US', country: 'United States', region: 'Virginia', rc: 'US-VA', city: 'Ashburn', lat: 39.0438, lng: -77.4874, tz: 'America/New_York', asn: 'AS14618', asnOrg: 'Amazon.com', isp: 'AWS', connection: 'hosting', cloud: true, datacenter: true, whitelistReason: 'Temporary contractor egress', whitelistInDays: -10, threat: 'low', lastSeenHours: 26 },

    // ── A known abuser that is deliberately NOT blocked ──
    { ip: '45.83.220.14', cc: 'BR', country: 'Brazil', region: 'São Paulo', rc: 'BR-SP', city: 'São Paulo', lat: -23.5505, lng: -46.6333, tz: 'America/Sao_Paulo', asn: 'AS262287', asnOrg: 'Maxihost', isp: 'Maxihost', connection: 'hosting', abuser: true, datacenter: true, threat: 'high', lastSeenHours: 14 },

    // ── The private-range row the live wire really produces: created by
    //    geolocate(), never enriched, provider 'internal', never expires. ──
    { ip: '127.0.0.1', cc: null, country: null, region: 'Private', rc: null, city: null, lat: null, lng: null, tz: null, provider: 'internal', lastSeenHours: 5 },

    // ── #1287 additions: enough BLOCKED rows for the Blocked IPs table to
    //    show its presets and batch actions with a real page of data. ──
    { ip: '223.5.5.5', cc: 'CN', country: 'China', region: 'Zhejiang', rc: 'CN-33', city: 'Hangzhou', lat: 30.2741, lng: 120.1551, tz: 'Asia/Shanghai', asn: 'AS37963', asnOrg: 'Alibaba Cloud', isp: 'Aliyun', connection: 'hosting', cloud: true, datacenter: true, attacker: true, threat: 'critical', blockedReason: 'Geofence: country not allowed', blockedInDays: null, blockCount: 9, lastSeenHours: 1 },
    { ip: '95.24.7.9', cc: 'RU', country: 'Russian Federation', region: 'Moscow', rc: 'RU-MOW', city: 'Moscow', lat: 55.7558, lng: 37.6173, tz: 'Europe/Moscow', asn: 'AS8402', asnOrg: 'Corbina Telecom', isp: 'Beeline', connection: 'residential', threat: 'high', blockedReason: 'Repeated login failures', blockedInDays: 3, blockCount: 5, lastSeenHours: 3 },
    { ip: '91.121.88.7', cc: 'FR', country: 'France', region: 'Hauts-de-France', rc: 'FR-HDF', city: 'Roubaix', lat: 50.6942, lng: 3.1746, tz: 'Europe/Paris', asn: 'AS16276', asnOrg: 'OVH SAS', isp: 'OVH', connection: 'hosting', datacenter: true, abuser: true, threat: 'high', blockedReason: 'auto:ruleset', blockedInDays: null, blockCount: 3, lastSeenHours: 8 },
    { ip: '41.90.12.66', cc: 'KE', country: 'Kenya', region: 'Nairobi', rc: 'KE-30', city: 'Nairobi', lat: -1.2921, lng: 36.8219, tz: 'Africa/Nairobi', asn: 'AS36866', asnOrg: 'Jamii Telecom', isp: 'Jamii', connection: 'business', threat: 'medium', blockedReason: 'Credential stuffing', blockedInDays: 12, blockCount: 1, lastSeenHours: 16 },
    // Blocked AND whitelisted: `block_active` must answer NOT blocked.
    { ip: '203.0.113.14', cc: 'GB', country: 'United Kingdom', region: 'England', rc: 'GB-ENG', city: 'Manchester', lat: 53.4808, lng: -2.2426, tz: 'Europe/London', asn: 'AS5089', asnOrg: 'Virgin Media', isp: 'Virgin', connection: 'business', threat: 'medium', blockedReason: 'Rate limit tripped', blockedInDays: 9, blockCount: 2, whitelistReason: 'Partner integration — reviewed', whitelistInDays: 60, lastSeenHours: 2 },
];

function buildGeoIps(): MockGeoIp[] {
    const nowSec = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    const HOUR = 3600;
    return GEOIP_SEEDS.map((seed, index) => {
        const provider = seed.provider ?? 'maxmind';
        const lastSeen = nowSec - Math.round((seed.lastSeenHours ?? 12) * HOUR);
        const blocked = seed.blockedReason != null;
        const whitelisted = seed.whitelistReason != null;
        return {
            id: 4100 + index,
            created: nowSec - 120 * DAY,
            modified: lastSeen,
            last_seen: lastSeen,
            ip_address: seed.ip,
            subnet: mockSubnetOf(seed.ip),
            country_code: seed.cc ?? null,
            country_name: seed.country ?? null,
            region: seed.region ?? null,
            region_code: seed.rc ?? null,
            city: seed.city ?? null,
            postal_code: seed.postal ?? null,
            latitude: seed.lat ?? null,
            longitude: seed.lng ?? null,
            timezone: seed.tz ?? null,
            is_tor: seed.tor ?? false,
            is_vpn: seed.vpn ?? false,
            is_proxy: seed.proxy ?? false,
            is_cloud: seed.cloud ?? false,
            is_datacenter: seed.datacenter ?? false,
            is_mobile: seed.mobile ?? false,
            is_known_attacker: seed.attacker ?? false,
            is_known_abuser: seed.abuser ?? false,
            threat_level: seed.threat ?? null,
            asn: seed.asn ?? null,
            asn_org: seed.asnOrg ?? null,
            isp: seed.isp ?? null,
            mobile_carrier: seed.mobileCarrier ?? null,
            connection_type: seed.connection ?? null,
            is_blocked: blocked,
            blocked_at: blocked ? nowSec - 2 * DAY : null,
            blocked_until: blocked && seed.blockedInDays != null ? nowSec + seed.blockedInDays * DAY : null,
            blocked_reason: seed.blockedReason ?? null,
            block_count: seed.blockCount ?? 0,
            is_whitelisted: whitelisted,
            whitelisted_reason: seed.whitelistReason ?? null,
            whitelisted_until: whitelisted && seed.whitelistInDays != null ? nowSec + seed.whitelistInDays * DAY : null,
            // `is_expired`: internal records never expire.
            expires_at: provider === 'internal' ? null : nowSec + 60 * DAY,
            provider,
            // The raw provider blob the `default` graph EXCLUDES. It carries
            // firewall hints on purpose so the scrubbing rule is testable.
            data: {
                threat_data: {
                    is_blocklisted: seed.attacker === true || seed.abuser === true,
                    sources: seed.attacker ? ['abuseipdb', 'firehol'] : [],
                    firewall_hint: blocked ? 'mojo_blocked ipset member' : 'none',
                },
                threat_checked_at: new Date((lastSeen - HOUR) * 1000).toISOString(),
                raw: { queried: seed.ip, provider },
            },
        } satisfies MockGeoIp;
    });
}

/** Every device location the fleet has recorded, linked to its GeoIP row. */
function buildDeviceLocations(devices: MockDevice[], geoIps: MockGeoIp[]): MockDeviceLocation[] {
    const nowSec = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    const geoFor = (ip: string) => geoIps.find((row) => row.ip_address === ip)?.id ?? null;
    // Deterministic secondary addresses so at least one device has travelled
    // and at least one has been seen from the Tor exit.
    const EXTRA: Record<number, string[]> = {
        0: ['203.0.113.9', '133.242.19.58'],
        1: ['172.58.27.101'],
        4: ['185.220.101.44'],
        6: ['45.33.32.156', '104.28.14.33'],
    };
    const out: MockDeviceLocation[] = [];
    let id = 7300;
    devices.forEach((device, index) => {
        const addresses = [device.last_ip, ...(EXTRA[index] ?? [])].filter((ip): ip is string => Boolean(ip));
        addresses.forEach((ip, position) => {
            out.push({
                id: id--,
                user: device.user,
                user_device: device.id,
                ip_address: ip,
                geolocation: geoFor(ip),
                first_seen: device.first_seen + position * DAY,
                last_seen: nowSec - (position * 3 + 1) * DAY - index * 900,
            });
        });
    });
    return out;
}

/**
 * `UserLoginEvent.device` is a real FK the backend sets on every tracked
 * login, and web-mojo never used it. Link each event to a device of the same
 * user — preferring one whose `last_ip` matches, so the device dossier's
 * Logins tab tells a coherent story.
 */
function linkLoginDevices(events: MockLoginEvent[], devices: MockDevice[]): MockLoginEvent[] {
    for (const event of events) {
        const owned = devices.filter((device) => device.user === event.user);
        if (!owned.length) { event.device = null; continue; }
        const matched = owned.find((device) => device.last_ip === event.ip_address);
        event.device = (matched ?? owned[0]!).id;
    }
    return events;
}

// ── GeoLocatedIP: the computed properties, ported verbatim ────────────

const GEOIP_VIEW_PERMS_MOCK = ['manage_users', 'view_security', 'manage_security', 'security', 'users'];
const GEOIP_SAVE_PERMS_MOCK = ['manage_users', 'manage_security', 'security'];
const GEOIP_THREAT_ORDER: (string | null)[] = [null, 'low', 'medium', 'high', 'critical'];
/** `@md.rate_limit("geoip_lookup", ip_limit=30)`. */
const GEOIP_LOOKUP_LIMIT = 30;
let geoIpLookupCount = 0;

function mockIsThreat(row: MockGeoIp): boolean {
    return Boolean(row.is_known_attacker || row.is_known_abuser);
}

function mockIsSuspicious(row: MockGeoIp): boolean {
    return Boolean(row.is_tor || row.is_vpn || row.is_proxy
        || row.threat_level === 'high' || row.threat_level === 'critical');
}

function mockRiskScore(row: MockGeoIp): number {
    let score = 0;
    if (row.is_tor) score += 40;
    if (row.is_vpn) score += 20;
    if (row.is_proxy) score += 25;
    if (row.threat_level === 'critical') score += 30;
    else if (row.threat_level === 'high') score += 20;
    else if (row.threat_level === 'medium') score += 10;
    return Math.min(score, 100);
}

function mockWhitelistActive(row: MockGeoIp): boolean {
    if (!row.is_whitelisted) return false;
    const now = Math.floor(Date.now() / 1000);
    if (row.whitelisted_until != null && now > row.whitelisted_until) return false;
    return true;
}

function mockBlockActive(row: MockGeoIp): boolean {
    if (!row.is_blocked) return false;
    if (mockWhitelistActive(row)) return false;
    const now = Math.floor(Date.now() / 1000);
    if (row.blocked_until != null && now > row.blocked_until) return false;
    return true;
}

/** The `basic` graph's exact field list (GeoLocatedIP.RestMeta.GRAPHS). */
const GEOIP_BASIC_FIELDS = [
    'id', 'ip_address', 'country_code', 'country_name', 'city', 'region',
    'is_tor', 'is_vpn', 'is_proxy', 'is_known_attacker', 'is_known_abuser',
    'threat_level', 'is_blocked', 'blocked_at', 'blocked_until', 'provider',
    'blocked_reason', 'block_count', 'is_whitelisted', 'whitelisted_reason',
    'whitelisted_until',
];

/** The `federation` graph: NO enforcement state and NO raw provider blob. */
const GEOIP_FEDERATION_FIELDS = [
    'id', 'ip_address',
    'country_code', 'country_name', 'region', 'region_code',
    'city', 'postal_code', 'latitude', 'longitude', 'timezone',
    'asn', 'asn_org', 'isp', 'connection_type', 'mobile_carrier',
    'is_tor', 'is_vpn', 'is_proxy', 'is_cloud',
    'is_datacenter', 'is_mobile',
    'is_known_attacker', 'is_known_abuser', 'threat_level',
    'provider',
];

function serializeGeoIp(row: MockGeoIp, graph = 'default'): Record<string, unknown> {
    const extras = {
        is_threat: mockIsThreat(row),
        is_suspicious: mockIsSuspicious(row),
        risk_score: mockRiskScore(row),
    };
    const pick = (fields: string[]) => {
        const out: Record<string, unknown> = {};
        for (const field of fields) out[field] = row[field] ?? null;
        return out;
    };
    if (graph === 'federation') return pick(GEOIP_FEDERATION_FIELDS);
    if (graph === 'basic') {
        return {
            ...pick(GEOIP_BASIC_FIELDS),
            ...extras,
            block_active: mockBlockActive(row),
            whitelist_active: mockWhitelistActive(row),
        };
    }
    if (graph === 'detailed') return { ...row, ...extras };
    // `default`: everything EXCEPT the raw provider blob and the provider name.
    const { data: _data, provider: _provider, ...rest } = row;
    if (graph !== 'default') {
        console.warn(`mock /api/system/geoip: unknown graph "${graph}" — serving "default"`);
    }
    return { ...rest, ...extras };
}

/**
 * `on_rest_save`: plain fields save first, then each declared
 * POST_SAVE_ACTION handler runs. All six GeoLocatedIP handlers return
 * nothing, so the response is always the refreshed row.
 */
const GEOIP_ACTIONS = new Set(['refresh', 'threat_analysis', 'block', 'unblock', 'whitelist', 'unwhitelist']);
const GEOIP_WRITABLE_FIELDS = new Set([
    'subnet', 'country_code', 'country_name', 'region', 'region_code', 'city',
    'postal_code', 'latitude', 'longitude', 'timezone',
    'asn', 'asn_org', 'isp', 'connection_type', 'mobile_carrier',
    'threat_level', 'is_tor', 'is_vpn', 'is_proxy', 'is_cloud',
    'is_datacenter', 'is_mobile', 'is_known_attacker', 'is_known_abuser',
]);

function mockGeoIpBlock(row: MockGeoIp, reason: string, ttl: number): void {
    // Whitelisted IPs are never blocked — the model returns False early.
    if (mockWhitelistActive(row)) return;
    // Idempotent: an already-active block is a no-op.
    if (mockBlockActive(row)) return;
    const now = Math.floor(Date.now() / 1000);
    row.is_blocked = true;
    row.blocked_at = now;
    row.blocked_reason = reason;
    row.blocked_until = ttl > 0 ? now + ttl : null;
    row.block_count = (row.block_count ?? 0) + 1;
    // block() ALWAYS escalates threat_level to at least 'high'. Never down.
    const current = GEOIP_THREAT_ORDER.indexOf(row.threat_level);
    if (current < GEOIP_THREAT_ORDER.indexOf('high')) row.threat_level = 'high';
}

function applyGeoIpSave(row: MockGeoIp, body: Record<string, unknown>, caller: MockUser): string | null {
    const now = Math.floor(Date.now() / 1000);
    const actions: [string, unknown][] = [];
    for (const [key, value] of Object.entries(body)) {
        if (GEOIP_ACTIONS.has(key)) { actions.push([key, value]); continue; }
        if (!GEOIP_WRITABLE_FIELDS.has(key)) continue;
        if (key === 'latitude' || key === 'longitude') {
            if (value === '' || value == null) { row[key] = null; continue; }
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) return `${key} must be a number`;
            row[key] = parsed;
            continue;
        }
        if (key.startsWith('is_')) { row[key] = Boolean(value) && value !== 'false' && value !== '0'; continue; }
        if (key === 'threat_level') {
            const level = value === '' || value == null ? null : String(value);
            if (level != null && !GEOIP_THREAT_ORDER.includes(level)) return 'Invalid threat_level';
            row.threat_level = level;
            continue;
        }
        row[key] = value === '' ? null : value;
    }
    for (const [action, value] of actions) {
        if (action === 'refresh') {
            row.modified = now;
            row.last_seen = now;
            row.expires_at = row.provider === 'internal' ? null : now + 60 * 86400;
        } else if (action === 'threat_analysis') {
            const blob = isPlainObject(row.data) ? row.data : {};
            blob.threat_checked_at = new Date(now * 1000).toISOString();
            row.data = blob;
            row.modified = now;
        } else if (action === 'block') {
            const dict = isPlainObject(value) ? value : {};
            const reason = String(dict.reason ?? `manual block: by ${caller.username}`);
            const ttl = Number(dict.ttl ?? 600) || 0;
            mockGeoIpBlock(row, reason, ttl);
            // #1287: every enforcement action leaves a `firewall:*` Log row —
            // the four payload shapes are NOT uniform (geolocated_ip.py).
            recordFirewallLog(row, 'firewall:block', {
                ip: row.ip_address, reason, ttl: ttl || null,
                blocked_until: row.blocked_until == null ? null : new Date(row.blocked_until * 1000).toISOString(),
                block_count: row.block_count,
                trigger: reason === 'auto:ruleset' ? 'auto:incident_rule' : 'manual',
            }, caller, `blocked ${row.ip_address}`);
        } else if (action === 'unblock') {
            const reason = typeof value === 'string' && value ? value : `manual unblock: by ${caller.username}`;
            row.is_blocked = false;
            row.blocked_until = null;
            row.blocked_reason = `unblocked: ${reason}`;
            recordFirewallLog(row, 'firewall:unblock', {
                ip: row.ip_address, reason, trigger: 'manual',
            }, caller, `unblocked ${row.ip_address}`);
        } else if (action === 'whitelist') {
            const dict = isPlainObject(value) ? value : {};
            const reason = typeof value === 'string' && value
                ? value
                : String(dict.reason ?? `manual whitelist: by ${caller.username}`);
            const ttl = Number(dict.ttl ?? 0) || 0;
            const until = typeof dict.until === 'string' && dict.until ? dict.until : null;
            const wasBlocked = row.is_blocked;
            row.is_whitelisted = true;
            row.whitelisted_reason = reason;
            // `on_action_whitelist` accepts `ttl` OR an `until` datetime; an
            // unparseable `until` is a 400 ("Invalid 'until' datetime").
            if (until != null) {
                const parsed = Date.parse(until);
                if (!Number.isFinite(parsed)) return "Invalid 'until' datetime for whitelist";
                row.whitelisted_until = Math.floor(parsed / 1000);
            } else {
                row.whitelisted_until = ttl > 0 ? now + ttl : null;
            }
            // A whitelist CLEARS an active block.
            if (row.is_blocked) { row.is_blocked = false; row.blocked_until = null; }
            recordFirewallLog(row, 'firewall:whitelist', {
                ip: row.ip_address, reason,
                until: row.whitelisted_until == null ? null : new Date(row.whitelisted_until * 1000).toISOString(),
                was_blocked: wasBlocked, trigger: 'manual',
            }, caller, `whitelisted ${row.ip_address}`);
        } else if (action === 'unwhitelist') {
            row.is_whitelisted = false;
            row.whitelisted_reason = null;
            row.whitelisted_until = null;
            recordFirewallLog(row, 'firewall:unwhitelist', {
                ip: row.ip_address, trigger: 'manual',
            }, caller, `removed the whitelist for ${row.ip_address}`);
        }
        row.modified = now;
    }
    return null;
}

/** `_param_is_true`: the STRING "false" arrives truthy without coercion. */
function mockParamIsTrue(value: unknown): boolean {
    if (typeof value === 'string') return !['false', '0', 'no', 'off', 'n', ''].includes(value.trim().toLowerCase());
    return Boolean(value);
}

/** `GeoLocatedIP.geolocate`: get-or-create, touch last_seen, refresh if stale. */
function geolocateMock(ip: string, autoRefresh: boolean): MockGeoIp {
    const now = Math.floor(Date.now() / 1000);
    let row = db.geoIps.find((candidate) => candidate.ip_address === ip);
    if (!row) {
        row = {
            id: Math.max(0, ...db.geoIps.map((candidate) => candidate.id)) + 1,
            created: now, modified: now, last_seen: now,
            ip_address: ip, subnet: mockSubnetOf(ip),
            country_code: null, country_name: null, region: null, region_code: null,
            city: null, postal_code: null, latitude: null, longitude: null, timezone: null,
            is_tor: false, is_vpn: false, is_proxy: false, is_cloud: false,
            is_datacenter: false, is_mobile: false,
            is_known_attacker: false, is_known_abuser: false,
            threat_level: null, asn: null, asn_org: null, isp: null,
            mobile_carrier: null, connection_type: null,
            is_blocked: false, blocked_at: null, blocked_until: null,
            blocked_reason: null, block_count: 0,
            is_whitelisted: false, whitelisted_reason: null, whitelisted_until: null,
            expires_at: null, provider: null, data: {},
        };
        db.geoIps.unshift(row);
    } else {
        row.last_seen = now;
    }
    // is_expired: internal records never expire; a null expires_at DOES.
    const expired = row.provider !== 'internal' && (row.expires_at == null || now > row.expires_at);
    if (autoRefresh && expired) {
        row.provider = row.provider ?? 'maxmind';
        row.expires_at = now + 60 * 86400;
        row.modified = now;
    }
    return row;
}

// ── Device / device-location / login-event serializers ───────────────

/** The `basic` UserDevice sub-graph — note it carries NO `id`, which is why
 *  cross-links from a location or login row resolve the device by DUID. */
function deviceBasic(row: MockDevice): Record<string, unknown> {
    return {
        muid: row.muid, duid: row.duid, last_ip: row.last_ip,
        last_seen: row.last_seen, device_info: row.device_info,
    };
}

/** `bouncer_device` / `active_sessions` / `recent_locations` — the three
 *  `extra` properties the `sessions` graph exposes. All three are real. */
function deviceSessionExtras(row: MockDevice): Record<string, unknown> {
    if (!row.muid) return { bouncer_device: null, active_sessions: [], recent_locations: [] };
    const now = Math.floor(Date.now() / 1000);
    const bouncer = db.bouncerDevices.find((candidate) => candidate.muid === row.muid);
    const rand = mulberry32(row.id * 7919);
    const sessionCount = row.last_seen > now - 86400 ? 1 + Math.floor(rand() * 2) : 0;
    const sessions = Array.from({ length: sessionCount }, () => {
        const started = now - Math.floor(rand() * 20 * 3600) - 1800;
        const lastActivity = Math.min(now - 60, started + Math.floor(rand() * 5400) + 300);
        const tabCount = 1 + Math.floor(rand() * 3);
        return {
            msid: `${mockHex32(rand)}`,
            started,
            last_activity: lastActivity,
            ip: row.last_ip,
            signal_count: 4 + Math.floor(rand() * 30),
            tabs: Array.from({ length: tabCount }, (_2, tab) => ({
                mtab: `${mockHex32(rand).slice(0, 16)}`,
                started: started + tab * 120,
                last_activity: lastActivity,
                signal_count: 1 + Math.floor(rand() * 9),
            })),
        };
    });
    const locations = db.deviceLocations
        .filter((location) => location.user_device === row.id)
        .sort((a, b) => b.last_seen - a.last_seen)
        .slice(0, 10)
        .map((location) => {
            const geo = db.geoIps.find((candidate) => candidate.id === location.geolocation);
            return {
                ip_address: location.ip_address,
                first_seen: location.first_seen,
                last_seen: location.last_seen,
                ...(geo ? { city: geo.city ?? '', country: geo.country_code ?? '' } : {}),
            };
        });
    return {
        bouncer_device: bouncer
            ? {
                risk_tier: bouncer.risk_tier,
                event_count: bouncer.event_count,
                block_count: bouncer.block_count,
                fingerprint_id: bouncer.fingerprint_id ?? '',
                first_seen: bouncer.first_seen,
                last_seen: bouncer.last_seen,
            }
            : null,
        active_sessions: sessions,
        recent_locations: locations,
    };
}

function serializeDevice(row: MockDevice, graph = 'default'): Record<string, unknown> {
    const owner = db.users.find((candidate) => candidate.id === row.user);
    if (graph === 'basic') return deviceBasic(row);
    if (graph === 'locations') {
        return {
            muid: row.muid, duid: row.duid, last_ip: row.last_ip, last_seen: row.last_seen,
            locations: db.deviceLocations
                .filter((location) => location.user_device === row.id)
                .map((location) => serializeDeviceLocation(location)),
        };
    }
    if (graph === 'sessions') {
        return {
            id: row.id, muid: row.muid, duid: row.duid, last_ip: row.last_ip,
            device_info: row.device_info,
            first_seen: row.first_seen, last_seen: row.last_seen,
            user: owner ? userBasic(owner) : null,
            ...deviceSessionExtras(row),
        };
    }
    if (graph !== 'default') {
        console.warn(`mock /api/user/device: unknown graph "${graph}" — serving "default"`);
    }
    const { user: _uid, ...rest } = row;
    return { ...rest, user: owner ? userBasic(owner) : null };
}

function serializeDeviceLocation(row: MockDeviceLocation): Record<string, unknown> {
    const owner = db.users.find((candidate) => candidate.id === row.user);
    const device = db.devices.find((candidate) => candidate.id === row.user_device);
    const geo = db.geoIps.find((candidate) => candidate.id === row.geolocation);
    const { user: _uid, user_device: _did, geolocation: _gid, ...rest } = row;
    return {
        ...rest,
        user: owner ? userBasic(owner) : null,
        // The `basic` device sub-graph — no `id`, by the model's own field list.
        user_device: device ? deviceBasic(device) : null,
        geolocation: geo ? serializeGeoIp(geo, 'default') : null,
    };
}

/** UserLoginEvent graphs. NONE of them carries an `event_type` field. */
const LOGIN_EVENT_BASIC_FIELDS = [
    'id', 'ip_address', 'country_code', 'region', 'region_code', 'city',
    'latitude', 'longitude', 'source', 'is_new_country', 'is_new_region', 'created',
];

function serializeLoginEvent(row: MockLoginEvent, graph = 'list'): Record<string, unknown> {
    const owner = db.users.find((candidate) => candidate.id === row.user);
    const out: Record<string, unknown> = {};
    for (const field of LOGIN_EVENT_BASIC_FIELDS) out[field] = row[field] ?? null;
    if (graph === 'basic') return out;
    out.user = owner ? userBasic(owner) : null;
    if (graph === 'list') return out;
    if (graph !== 'default') {
        console.warn(`mock /api/account/logins: unknown graph "${graph}" — serving "default"`);
    }
    const device = db.devices.find((candidate) => candidate.id === row.device);
    out.modified = row.modified ?? row.created;
    out.user_agent_info = device?.device_info ?? null;
    out.device = device ? deviceBasic(device) : null;
    return out;
}

// ── Login geography aggregation (`_build_aggregation`) ────────────────

/** `/summary` and `/user` accept ONLY dr_start / dr_end, parsed by dates.parse
 *  — NOT the dr_field triple the list endpoint uses. */
function applyMockDateBounds(rows: MockLoginEvent[], params: Params): MockLoginEvent[] {
    const start = params.dr_start ? String(params.dr_start) : '';
    const end = params.dr_end ? String(params.dr_end) : '';
    if (!start && !end) return rows;
    return rows.filter((row) => {
        const day = new Date(row.created * 1000).toISOString().slice(0, 10);
        if (start && day < start) return false;
        if (end && day > end) return false;
        return true;
    });
}

const MOCK_COUNTRY_CODE_RE = /^[A-Z]{2,3}$/;
/** `MAX_REGION_RESULTS` — the region drill is capped server-side. */
const MOCK_MAX_REGION_RESULTS = 500;

function buildLoginAggregation(rows: MockLoginEvent[], params: Params): Record<string, unknown>[] {
    const rawCountry = params.country_code == null ? '' : String(params.country_code).toUpperCase();
    const country = MOCK_COUNTRY_CODE_RE.test(rawCountry) ? rawCountry : null;
    // `request.DATA.get('region')` with NO coercion: the STRING "false" is
    // truthy here exactly as it is on the backend. Clients must send
    // `region=1` only while drilling and never `region=false`.
    const drill = Boolean(params.region);

    const avg = (values: (number | null)[]) => {
        const usable = values.filter((value): value is number => typeof value === 'number');
        if (!usable.length) return null;
        return usable.reduce((sum, value) => sum + value, 0) / usable.length;
    };

    if (country && drill) {
        const scoped = rows.filter((row) => String(row.country_code ?? '').toUpperCase() === country);
        const buckets = new Map<string, MockLoginEvent[]>();
        for (const row of scoped) {
            const key = row.region ?? '';
            buckets.set(key, [...(buckets.get(key) ?? []), row]);
        }
        return [...buckets.entries()]
            .map(([region, group]) => ({
                country_code: group[0]!.country_code,
                region: region || null,
                count: group.length,
                latitude: avg(group.map((row) => row.latitude)),
                longitude: avg(group.map((row) => row.longitude)),
                new_region_count: group.filter((row) => row.is_new_region).length,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, MOCK_MAX_REGION_RESULTS);
    }

    const buckets = new Map<string, MockLoginEvent[]>();
    for (const row of rows) {
        const key = row.country_code ?? '';
        buckets.set(key, [...(buckets.get(key) ?? []), row]);
    }
    return [...buckets.entries()]
        .map(([code, group]) => ({
            country_code: code,
            count: group.length,
            latitude: avg(group.map((row) => row.latitude)),
            longitude: avg(group.map((row) => row.longitude)),
            new_country_count: group.filter((row) => row.is_new_country).length,
        }))
        .sort((a, b) => b.count - a.count);
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
    const rows: MockIncidentEvent[] = seeds.map((s, i) => ({
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
        group_id: null, incident: null,
    }));
    rows.push(
        {
            id: 8990, created: nowSec - 7200, level: 7, scope: 'group',
            category: 'security:webhook_delivery', source_ip: '203.0.113.44',
            hostname: 'worker-2', uid: 1, country_code: 'US',
            title: 'Repeated webhook delivery failures', details: 'Endpoint returned 503 for five attempts',
            model_name: 'account.Group', model_id: 1, metadata: { webhook_subscription_id: 301 }, group_id: 1, incident: 601,
        },
        {
            id: 8989, created: nowSec - 3 * DAY, level: 5, scope: 'group',
            category: 'security:member_invite', source_ip: '198.51.100.18',
            hostname: 'portal-1', uid: 1, country_code: 'US',
            title: 'Member invite retried', details: 'Invite resent after the original link expired',
            model_name: 'account.Group', model_id: 1, metadata: {}, group_id: 1, incident: 602,
        },
        {
            id: 8988, created: nowSec - 2 * 3600, level: 8, scope: 'global',
            category: 'security:bouncer:block', source_ip: '198.51.100.66',
            hostname: 'auth-1', uid: null, country_code: 'CN',
            title: 'Bouncer blocked a high-risk login assessment',
            details: 'muid=muid-bot-003 score=94 decision=block',
            model_name: 'account.BouncerDevice', model_id: 903,
            metadata: {
                muid: 'muid-bot-003', risk_score: 94, decision: 'block', page_type: 'login',
                triggered_signals: ['webdriver', 'headless'], server: 'auth-1',
                http_method: 'POST', http_url: 'https://auth.example.test/login?token=sentinel-query-secret',
                request_headers: { Authorization: 'Bearer sentinel-bearer-secret', Cookie: 'session=sentinel-cookie-secret' },
                request_data: { username: 'bot@example.test', password: 'sentinel-password-secret' },
                stack_trace: 'ValueError: rejected token sentinel-trace-secret\n  File "auth.py", line 42, in assess',
            }, group_id: null, incident: 603,
        },
        {
            id: 8987, created: nowSec - 1800, level: 5, scope: 'global',
            category: 'security:bouncer:monitor', source_ip: '198.51.100.77',
            hostname: 'auth-1', uid: null, country_code: 'US',
            title: 'Bouncer monitoring a medium-risk registration',
            details: 'muid=muid-monitor-002 score=51 decision=monitor',
            model_name: 'account.BouncerDevice', model_id: 902,
            metadata: { muid: 'muid-monitor-002', risk_score: 51, decision: 'monitor', server: 'auth-1' }, group_id: null, incident: 603,
        },
        {
            id: 8986, created: nowSec - 5 * 3600, level: 9, scope: 'ossec', category: 'ossec',
            source_ip: '203.0.113.90', hostname: 'edge-1', uid: null, country_code: 'US',
            title: 'OSSEC file-integrity alert', details: 'Protected file changed unexpectedly',
            model_name: null, model_id: null,
            metadata: { alert_id: 'ossec-42', rule_id: 550, logfile: '/var/log/ossec.log', text: 'Integrity alert token sentinel-ossec-secret' },
            group_id: null, incident: null,
        },
    );
    return rows;
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

    // Stable permission identities for global-vs-group admin contract demos.
    // Ian remains group-admin-only on odd group ids; these two users prove
    // global view and global manage gates independently.
    const securityViewer = at(11);
    securityViewer.is_active = true;
    securityViewer.is_superuser = false;
    securityViewer.username = 'security.viewer';
    securityViewer.email = 'security.viewer@nativemojo.com';
    securityViewer.display_name = 'Security Viewer';
    securityViewer.permissions = { view_security: true, view_geofence: true };
    const securityManager = at(12);
    securityManager.is_active = true;
    securityManager.is_superuser = false;
    securityManager.username = 'security.manager';
    securityManager.email = 'security.manager@nativemojo.com';
    securityManager.display_name = 'Security Manager';
    securityManager.permissions = { view_security: true, manage_security: true, manage_geofence: true, manage_settings: true, manage_metrics: true };
    const groupsManager = at(13);
    groupsManager.is_active = true;
    groupsManager.is_superuser = false;
    groupsManager.username = 'groups.manager';
    groupsManager.email = 'groups.manager@nativemojo.com';
    groupsManager.display_name = 'Groups Manager';
    // #1287: one non-superuser bypass holder, so /api/geo/bypass_holders has
    // both of its `source` values to serve.
    groupsManager.permissions = { manage_groups: true, groups: true, manage_users: true, users: true, bypass_geofence: true };
    // #1287: `view_geofence` and NOTHING else — the persona that proves the
    // network-security section reveals Geofencing alone, and that the metrics
    // strip, the blocks table and the Last-change chip issue NO request.
    const geofenceViewer = at(19);
    geofenceViewer.is_active = true;
    geofenceViewer.is_superuser = false;
    geofenceViewer.username = 'geofence.viewer';
    geofenceViewer.email = 'geofence.viewer@nativemojo.com';
    geofenceViewer.display_name = 'Geofence Viewer';
    geofenceViewer.permissions = { view_geofence: true };
    const groupsViewer = at(16);
    groupsViewer.is_active = true;
    groupsViewer.is_superuser = false;
    groupsViewer.username = 'groups.viewer';
    groupsViewer.email = 'groups.viewer@nativemojo.com';
    groupsViewer.display_name = 'Groups Viewer';
    groupsViewer.permissions = { view_groups: true };
    // The published showcase has no login screen, so it uses one explicit
    // mock-only operator that can exercise every data-backed admin demo. Keep
    // the narrower viewer/manager identities above intact for permission tests.
    const showcaseOperator = at(14);
    showcaseOperator.is_active = true;
    showcaseOperator.is_superuser = false;
    showcaseOperator.username = 'showcase.operator';
    showcaseOperator.email = 'showcase.operator@nativemojo.com';
    showcaseOperator.display_name = 'Showcase Operator';
    showcaseOperator.permissions = {
        security: true,
        manage_settings: true,
        manage_metrics: true,
        manage_groups: true,
        groups: true,
        manage_users: true,
        users: true,
        // The jobs catch-all grant (view + manage + scheduled tasks in one).
        jobs: true,
        // #1287: `check_view_permissions` demands view_metrics|metrics for
        // `account="global"` — `manage_metrics` does NOT imply it. Without
        // this the showcase's geofence blocks tab would render its
        // metrics-denied notice instead of the KPI strip and country list.
        view_metrics: true,
        // #1298 Storage demo: category grant covers backends/files; account
        // bucket operations retain their independent manage_aws gate.
        files: true,
        manage_aws: true,
    };
    const storageViewer = at(31);
    storageViewer.is_active = true;
    storageViewer.is_superuser = false;
    storageViewer.username = 'storage.viewer';
    storageViewer.email = 'storage.viewer@nativemojo.com';
    storageViewer.display_name = 'Storage Viewer';
    storageViewer.permissions = { view_fileman: true };
    const storageManager = at(32);
    storageManager.is_active = true;
    storageManager.is_superuser = false;
    storageManager.username = 'storage.manager';
    storageManager.email = 'storage.manager@nativemojo.com';
    storageManager.display_name = 'Storage Manager';
    storageManager.permissions = { manage_files: true, view_groups: true, view_users: true };
    const bucketManager = at(33);
    bucketManager.is_active = true;
    bucketManager.is_superuser = false;
    bucketManager.username = 'bucket.manager';
    bucketManager.email = 'bucket.manager@nativemojo.com';
    bucketManager.display_name = 'Bucket Manager';
    bucketManager.permissions = { manage_aws: true };
    const storageMember = at(34);
    storageMember.is_active = true;
    storageMember.is_superuser = false;
    storageMember.username = 'storage.member';
    storageMember.email = 'storage.member@nativemojo.com';
    storageMember.display_name = 'Storage Member Only';
    storageMember.permissions = {};
    const metricsViewer = at(24);
    metricsViewer.is_active = true;
    metricsViewer.is_superuser = false;
    metricsViewer.username = 'metrics.viewer';
    metricsViewer.email = 'metrics.viewer@nativemojo.com';
    metricsViewer.display_name = 'Metrics Viewer';
    metricsViewer.permissions = { view_metrics: true };
    const metricsManager = at(25);
    metricsManager.is_active = true;
    metricsManager.is_superuser = false;
    metricsManager.username = 'metrics.manager';
    metricsManager.email = 'metrics.manager@nativemojo.com';
    metricsManager.display_name = 'Metrics Permissions Manager';
    metricsManager.permissions = { manage_metrics: true };
    const metricsOperator = at(26);
    metricsOperator.is_active = true;
    metricsOperator.is_superuser = false;
    metricsOperator.username = 'metrics.operator';
    metricsOperator.email = 'metrics.operator@nativemojo.com';
    metricsOperator.display_name = 'Metrics Operator';
    metricsOperator.permissions = { metrics: true };
    // Jobs identities — the view/manage split for the jobs control plane.
    // jobs.viewer must be able to read every jobs surface and issue ZERO
    // denied requests; jobs.operator additionally holds the write grants.
    const jobsViewer = at(17);
    jobsViewer.is_active = true;
    jobsViewer.is_superuser = false;
    jobsViewer.username = 'jobs.viewer';
    jobsViewer.email = 'jobs.viewer@nativemojo.com';
    jobsViewer.display_name = 'Jobs Viewer';
    jobsViewer.permissions = { view_jobs: true };
    const jobsOperator = at(18);
    jobsOperator.is_active = true;
    jobsOperator.is_superuser = false;
    jobsOperator.username = 'jobs.operator';
    jobsOperator.email = 'jobs.operator@nativemojo.com';
    jobsOperator.display_name = 'Jobs Operator';
    // NOTE the pair: ScheduledTask.VIEW_PERMS is ["jobs","view_scheduled_tasks",
    // "owner"] — `manage_scheduled_tasks` does NOT imply view, and neither does
    // `manage_jobs`. An operator holding only the manage grant falls through to
    // the OWNER branch and sees just their own tasks, so a real jobs operator
    // needs the view grant explicitly.
    jobsOperator.permissions = { manage_jobs: true, view_scheduled_tasks: true, manage_scheduled_tasks: true };
    const securityManageOnly = at(15);
    securityManageOnly.is_active = true;
    securityManageOnly.is_superuser = false;
    securityManageOnly.username = 'security.manage-only';
    securityManageOnly.email = 'security.manage-only@nativemojo.com';
    securityManageOnly.display_name = 'Security Manage Only';
    securityManageOnly.permissions = { manage_security: true };

    // DNS-specific global identities keep the view/manage split executable
    // without changing the established Security personas above.
    const dnsViewer = at(20);
    dnsViewer.is_active = true;
    dnsViewer.is_superuser = false;
    dnsViewer.username = 'dns.viewer';
    dnsViewer.email = 'dns.viewer@nativemojo.com';
    dnsViewer.display_name = 'DNS Viewer';
    dnsViewer.permissions = { view_dns: true };
    const dnsManager = at(21);
    dnsManager.is_active = true;
    dnsManager.is_superuser = false;
    dnsManager.username = 'dns.manager';
    dnsManager.email = 'dns.manager@nativemojo.com';
    dnsManager.display_name = 'DNS Manager';
    dnsManager.permissions = { view_dns: true, manage_dns: true };
    const dnsPlatform = at(22);
    dnsPlatform.is_active = true;
    dnsPlatform.is_superuser = true;
    dnsPlatform.username = 'dns.platform';
    dnsPlatform.email = 'dns.platform@nativemojo.com';
    dnsPlatform.display_name = 'DNS Platform Operator';
    dnsPlatform.permissions = {};
    const dnsTenant = at(23);
    dnsTenant.is_active = true;
    dnsTenant.is_superuser = false;
    dnsTenant.username = 'dns.tenant';
    dnsTenant.email = 'dns.tenant@nativemojo.com';
    dnsTenant.display_name = 'DNS Tenant Member';
    dnsTenant.permissions = {};

    // Auth-config inheritance fixtures: defaults -> deployment -> root -> child.
    groups[0]!.metadata = mergeDicts(groups[0]!.metadata, {
        auth_config: {
            theme: { app_title: 'ACME ACCESS', hero_headline: 'Welcome to Acme' },
            login: { methods: ['password', 'passkey'] },
            private_operator_note: 'must never reach the public auth config',
        },
        // #1287 FIXTURE CORRECTION: real DSL. `{countries: {deny: [...]}}` is
        // not a shape `validate_rule` accepts, and it forced the group panel's
        // editor into "can't represent this" JSON mode on every load.
        geofence: { country: { not_in: ['KP'] } },
    });
    groups[1]!.metadata = mergeDicts(groups[1]!.metadata, {
        auth_config: {
            theme: { hero_subheadline: 'Engineering workspace' },
            registration: { extra_fields: [{ name: 'team_code', label: 'Team code' }] },
        },
    });

    // Seed-consistency sweep: a disabled (or long-idle) account is never
    // "online" regardless of what the random spread rolled.
    for (const u of users) {
        if (!u.is_active || u === drowsy || u === invited) u.is_online = false;
    }
}

// ══ Jobs engine fixtures (mojo/apps/jobs) ════════════════════════════
// Everything between this banner and the closing one is the jobs domain's
// fixture layer. The wire it feeds is documented at the endpoint block below.
//
// Two backend behaviors are baked into the SHAPE of these rows:
//   · model rows carry epoch-SECOND datetimes (the mojo serializer), runner
//     heartbeats carry ISO strings (raw Redis JSON, never serialized);
//   · a runner's `alive` flag is derived at request time from the heartbeat
//     AGE, so the fixtures store offsets rather than timestamps — a showcase
//     session left open for an hour must not turn the whole fleet red.

/** settings.JOBS_CHANNELS for this deployment. */
const JOBS_CHANNELS = ['default', 'email', 'webhooks', 'priority'];

/**
 * settings.JOBS_RUNNER_HEARTBEAT_SEC. manager.get_runners treats a runner as
 * alive while its heartbeat is younger than 3× this, and JobEngine writes the
 * heartbeat key with the same value as its TTL. 60s (a deliberately
 * conservative deployment) is what makes the slow/stale heartbeat tiers
 * reachable at all — under the 5s default the 180s window collapses to 15s.
 */
const JOBS_HEARTBEAT_SEC = 60;

const JOB_FUNCS = [
    'mojo.apps.jobs.examples.sample_jobs.send_email',
    'mojo.apps.jobs.examples.sample_jobs.process_file_upload',
    'mojo.apps.jobs.examples.sample_jobs.generate_report',
    'mojo.apps.jobs.examples.sample_jobs.fetch_external_api',
    'mojo.apps.jobs.examples.sample_jobs.simulate_long_job',
];

type MockJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled' | 'expired';

interface MockJob {
    id: string;
    channel: string;
    func: string;
    payload: Record<string, unknown>;
    status: MockJobStatus;
    run_at: number | null;
    expires_at: number | null;
    attempt: number;
    max_retries: number;
    backoff_base: number;
    backoff_max_sec: number;
    broadcast: boolean;
    cancel_requested: boolean;
    max_exec_seconds: number | null;
    runner_id: string | null;
    last_error: string;
    stack_trace: string;
    metadata: Record<string, unknown>;
    created: number;
    modified: number;
    started_at: number | null;
    finished_at: number | null;
    idempotency_key: string | null;
}

interface MockJobEvent {
    id: number;
    /** The RELATION name — `?job=` filters on this; `?job_id=` does not exist. */
    job: string;
    channel: string;
    event: string;
    at: number;
    runner_id: string | null;
    attempt: number;
    details: Record<string, unknown>;
    created: number;
    modified: number;
}

interface MockJobLog {
    id: number;
    job: string;
    channel: string;
    created: number;
    modified: number;
    kind: string;
    message: string;
    meta: Record<string, unknown>;
}

interface MockRunner {
    runner_id: string;
    hostname: string;
    channels: string[];
    jobs_processed: number;
    jobs_failed: number;
    /** Seconds since the process started — resolved to an ISO `started`. */
    uptime_sec: number;
    /** Seconds since the last heartbeat — resolved to ISO + the alive flag. */
    heartbeat_age_sec: number;
}

interface MockScheduledTask {
    id: string;
    /** OWNER_FIELD. A caller without a global grant sees only their own rows. */
    user: number;
    name: string;
    description: string;
    enabled: boolean;
    run_once: boolean;
    task_type: string;
    run_times: string[];
    run_days: number[];
    job_config: Record<string, unknown>;
    notify: string[];
    channel: string;
    max_retries: number;
    last_run: number | null;
    run_count: number;
    last_error: string;
    created: number;
    modified: number;
}

interface MockTaskResult {
    id: string;
    task: string;
    user: number;
    job: string | null;
    status: 'success' | 'error';
    output: string;
    error: string;
    created: number;
}

const JOBS_NOW = Math.floor(Date.now() / 1000);

function makeJob(rand: () => number, over: Partial<MockJob> & { channel: string; status: MockJobStatus }): MockJob {
    const created = over.created ?? JOBS_NOW - Math.floor(rand() * 6 * 3600);
    return {
        id: mockHex32(rand),
        func: JOB_FUNCS[Math.floor(rand() * JOB_FUNCS.length)]!,
        payload: { source: 'fixture' },
        run_at: null,
        expires_at: created + 900,
        attempt: 0,
        max_retries: 3,
        backoff_base: 2,
        backoff_max_sec: 3600,
        broadcast: false,
        cancel_requested: false,
        max_exec_seconds: null,
        runner_id: null,
        last_error: '',
        stack_trace: '',
        metadata: {},
        modified: created,
        started_at: null,
        finished_at: null,
        idempotency_key: null,
        ...over,
        created,
    };
}

/** The multi-line traceback-style error the failed-job fixture carries. */
const FAILED_JOB_ERROR = [
    'SMTPRecipientsRefused: {\'ops@partner.example.com\': (550, b\'5.1.1 User unknown\')}',
    '  while sending batch 3/7 (142 recipients)',
    '  retry 3 of 3 exhausted — giving up',
].join('\n');

function buildJobs(): MockJob[] {
    const rand = mulberry32(20260806);
    const jobs: MockJob[] = [];

    // ── Named fixtures — one per state the UI has to render distinctly ──
    // Running on a LIVE runner: cancel is cooperative (cancel_requested).
    jobs.push(makeJob(rand, {
        channel: 'default', status: 'running',
        func: 'mojo.apps.jobs.examples.sample_jobs.simulate_long_job',
        payload: { delay: 240 },
        runner_id: 'runner-mojo-web-01-engine',
        created: JOBS_NOW - 96, started_at: JOBS_NOW - 42, attempt: 1,
    }));
    // Running on a DEAD runner: cancel force-cancels and reports forced:true.
    // This is also what makes totals.running_stale non-zero.
    jobs.push(makeJob(rand, {
        channel: 'priority', status: 'running',
        func: 'mojo.apps.jobs.examples.sample_jobs.process_file_upload',
        payload: { file_path: '/mnt/uploads/2026-08/ledger.csv' },
        runner_id: 'runner-mojo-batch-01-engine',
        created: JOBS_NOW - 3600, started_at: JOBS_NOW - 3480, attempt: 1,
    }));
    // Failed with a multi-line error and its retries exhausted.
    jobs.push(makeJob(rand, {
        channel: 'email', status: 'failed',
        func: 'mojo.apps.jobs.examples.sample_jobs.send_email',
        payload: { recipients: ['ops@partner.example.com'], subject: 'Weekly digest' },
        runner_id: 'runner-mojo-web-02-engine',
        attempt: 3, max_retries: 3,
        last_error: FAILED_JOB_ERROR,
        stack_trace: 'Traceback (most recent call last):\n  ...',
        created: JOBS_NOW - 5400, started_at: JOBS_NOW - 5390, finished_at: JOBS_NOW - 5370,
        metadata: { batch: 3, recipients: 142 },
    }));
    // Scheduled for the future.
    jobs.push(makeJob(rand, {
        channel: 'webhooks', status: 'pending',
        func: 'mojo.apps.jobs.examples.sample_jobs.fetch_external_api',
        payload: { url: 'https://nativemojo.com/' },
        run_at: JOBS_NOW + 7200, created: JOBS_NOW - 600,
    }));
    // Scheduled and OVERDUE — pending with a run_at in the past. The true
    // state, which is why the segments split on run_at__isnull rather than on
    // comparing a datetime.
    jobs.push(makeJob(rand, {
        channel: 'default', status: 'pending',
        func: 'mojo.apps.jobs.examples.sample_jobs.generate_report',
        payload: { report_type: 'daily' },
        run_at: JOBS_NOW - 1500, created: JOBS_NOW - 7200,
    }));
    jobs.push(makeJob(rand, {
        channel: 'default', status: 'canceled',
        created: JOBS_NOW - 9000, finished_at: JOBS_NOW - 8990, cancel_requested: true,
    }));
    jobs.push(makeJob(rand, {
        channel: 'priority', status: 'expired',
        created: JOBS_NOW - 12000, expires_at: JOBS_NOW - 11100,
        last_error: 'Job expired before a runner claimed it',
    }));

    // ── Backlogs that drive the channel severity thresholds ──────────
    // email: 62 queued + 1 alive runner → over the >50 WARNING threshold.
    for (let i = 0; i < 62; i++) {
        jobs.push(makeJob(rand, {
            channel: 'email', status: 'pending',
            func: 'mojo.apps.jobs.examples.sample_jobs.send_email',
            payload: { recipients: [`user${i}@example.com`], subject: 'Notification' },
            created: JOBS_NOW - Math.floor(rand() * 1800),
        }));
    }
    // webhooks: queued work and ZERO alive runners → CRITICAL regardless of
    // depth, because nothing will ever drain it.
    for (let i = 0; i < 3; i++) {
        jobs.push(makeJob(rand, { channel: 'webhooks', status: 'pending', created: JOBS_NOW - 400 * i }));
    }
    for (let i = 0; i < 4; i++) {
        jobs.push(makeJob(rand, { channel: 'default', status: 'pending', created: JOBS_NOW - 220 * i }));
    }
    for (let i = 0; i < 2; i++) {
        jobs.push(makeJob(rand, { channel: 'priority', status: 'pending', created: JOBS_NOW - 340 * i }));
    }

    // ── History: recent completions feed the per-channel metrics block ──
    for (let i = 0; i < 24; i++) {
        const channel = JOBS_CHANNELS[Math.floor(rand() * JOBS_CHANNELS.length)]!;
        const finished = JOBS_NOW - Math.floor(rand() * 3400);
        const duration = 400 + Math.floor(rand() * 9000);
        jobs.push(makeJob(rand, {
            channel, status: 'completed',
            created: finished - 30,
            started_at: finished - Math.ceil(duration / 1000) - 1,
            finished_at: finished,
            runner_id: rand() > 0.5 ? 'runner-mojo-web-01-engine' : 'runner-mojo-web-02-engine',
            attempt: 1,
            metadata: { duration_ms: duration },
        }));
    }
    for (let i = 0; i < 6; i++) {
        const finished = JOBS_NOW - Math.floor(rand() * 3400);
        jobs.push(makeJob(rand, {
            channel: JOBS_CHANNELS[Math.floor(rand() * JOBS_CHANNELS.length)]!,
            status: 'failed',
            created: finished - 40, started_at: finished - 12, finished_at: finished,
            runner_id: 'runner-mojo-web-02-engine',
            attempt: 3, max_retries: 3,
            last_error: 'ConnectionResetError: [Errno 104] Connection reset by peer',
        }));
    }
    return jobs;
}

let jobEventSequence = 0;

function jobEvent(job: MockJob, event: string, atOffsetSec: number, details: Record<string, unknown> = {}, runnerId?: string | null): MockJobEvent {
    const at = JOBS_NOW - atOffsetSec;
    jobEventSequence += 1;
    return {
        id: jobEventSequence,
        job: job.id,
        channel: job.channel,
        event,
        at,
        runner_id: runnerId === undefined ? job.runner_id : runnerId,
        attempt: job.attempt,
        details,
        created: at,
        modified: at,
    };
}

/** A lifecycle trail for every job whose detail view is worth opening. */
function buildJobEvents(jobs: MockJob[]): MockJobEvent[] {
    const events: MockJobEvent[] = [];
    for (const job of jobs) {
        const age = JOBS_NOW - job.created;
        events.push(jobEvent(job, 'created', age, {}, null));
        if (job.run_at != null) {
            events.push(jobEvent(job, 'scheduled', age - 1, { run_at: job.run_at }, null));
        } else {
            events.push(jobEvent(job, 'queued', age - 1, {}, null));
        }
        if (job.started_at != null) {
            events.push(jobEvent(job, 'claimed', JOBS_NOW - job.started_at, {}));
            events.push(jobEvent(job, 'running', JOBS_NOW - job.started_at, { attempt: job.attempt }));
        }
        if (job.status === 'failed') {
            events.push(jobEvent(job, 'retry', JOBS_NOW - (job.finished_at ?? job.created) + 20, { attempt: 2 }));
            events.push(jobEvent(job, 'failed', JOBS_NOW - (job.finished_at ?? job.created), { error: job.last_error.split('\n')[0] }));
        } else if (job.status === 'completed') {
            events.push(jobEvent(job, 'completed', JOBS_NOW - (job.finished_at ?? job.created), { duration_ms: job.metadata.duration_ms ?? 0 }));
        } else if (job.status === 'canceled') {
            events.push(jobEvent(job, 'canceled', JOBS_NOW - (job.finished_at ?? job.created), { forced: false, previous_status: 'pending' }, null));
        } else if (job.status === 'expired') {
            events.push(jobEvent(job, 'expired', JOBS_NOW - (job.expires_at ?? job.created), {}, null));
        }
    }
    return events;
}

function buildJobLogs(jobs: MockJob[]): MockJobLog[] {
    const logs: MockJobLog[] = [];
    let id = 0;
    const push = (job: MockJob, kind: string, message: string, offset: number, meta: Record<string, unknown> = {}) => {
        id += 1;
        const created = JOBS_NOW - offset;
        logs.push({ id, job: job.id, channel: job.channel, created, modified: created, kind, message, meta });
    };
    const running = jobs.find((job) => job.status === 'running' && job.runner_id === 'runner-mojo-web-01-engine');
    if (running) {
        push(running, 'info', 'Claimed by runner-mojo-web-01-engine', 42);
        push(running, 'info', 'Sleeping for 240s to simulate a long job', 41);
        push(running, 'debug', 'Heartbeat touch — visibility timeout extended', 12, { visibility_ms: 60000 });
    }
    const failed = jobs.find((job) => job.last_error === FAILED_JOB_ERROR);
    if (failed) {
        push(failed, 'info', 'Sending batch 1/7 (142 recipients)', 5390);
        push(failed, 'warn', 'Batch 2/7 partially delivered — 3 soft bounces', 5385, { soft_bounces: 3 });
        push(failed, 'error', '550 5.1.1 User unknown: ops@partner.example.com', 5372, { code: 550 });
        push(failed, 'error', 'Retry 3 of 3 exhausted — marking job failed', 5370);
    }
    return logs;
}

/**
 * Three runners covering the three states the fleet UI must distinguish. The
 * batch runner is `alive: false` — in a healthy deployment Redis usually
 * expires the heartbeat key at the same moment the aliveness window closes, so
 * a dead runner more often VANISHES from the list than shows up dead; a
 * lingering key (clock skew, an older engine build with a longer TTL) is what
 * produces this row, and `manager.get_runners` emits it verbatim.
 */
function buildJobRunners(): MockRunner[] {
    return [
        {
            runner_id: 'runner-mojo-web-01-engine',
            hostname: 'mojo-web-01.internal',
            channels: ['default', 'email', 'priority'],
            jobs_processed: 4821, jobs_failed: 12,
            uptime_sec: Math.floor(3.2 * 86400), heartbeat_age_sec: 6,
        },
        {
            runner_id: 'runner-mojo-web-02-engine',
            hostname: 'mojo-web-02.internal',
            channels: ['default', 'email'],
            jobs_processed: 1290, jobs_failed: 47,
            uptime_sec: Math.floor(1.1 * 86400), heartbeat_age_sec: 142,
        },
        {
            runner_id: 'runner-mojo-batch-01-engine',
            hostname: 'mojo-batch-01.internal',
            channels: ['webhooks', 'priority'],
            jobs_processed: 88231, jobs_failed: 210,
            uptime_sec: 9 * 86400, heartbeat_age_sec: 1900,
        },
    ];
}

function buildScheduledTasks(): MockScheduledTask[] {
    const day = 86400;
    return [
        {
            id: 'a1c4f0b28e5d4f7c9b2a6e08d31f5a44', user: 1,
            name: 'Daily revenue digest', description: 'Summarize yesterday’s revenue and email the finance list.',
            enabled: true, run_once: false, task_type: 'llm',
            run_times: ['07:30'], run_days: [0, 1, 2, 3, 4],
            job_config: {
                system_prompt: 'You are a concise financial analyst.',
                user_prompt: 'Summarize yesterday’s revenue by product line in under 200 words.',
            },
            notify: ['email'], channel: 'default', max_retries: 1,
            last_run: JOBS_NOW - 20 * 3600, run_count: 128, last_error: '',
            created: JOBS_NOW - 190 * day, modified: JOBS_NOW - 20 * 3600,
        },
        {
            id: 'b7e2d9134a6b48c1ae03f5c7d2901b6e', user: 14,
            name: 'Nightly ledger export', description: 'Publish the export job twice a day, every day.',
            enabled: true, run_once: false, task_type: 'job',
            run_times: ['02:00', '14:00'], run_days: [],
            job_config: {
                func: 'mojo.apps.jobs.examples.sample_jobs.generate_report',
                payload: { report_type: 'ledger', format: 'csv' },
            },
            notify: ['in_app'], channel: 'priority', max_retries: 2,
            last_run: JOBS_NOW - 7 * 3600, run_count: 402, last_error: '',
            created: JOBS_NOW - 320 * day, modified: JOBS_NOW - 7 * 3600,
        },
        {
            id: 'c3f81a6d5b7e42908c14de6b7a2f0359', user: 18,
            name: 'Partner webhook ping', description: 'Health-check the partner integration.',
            enabled: false, run_once: false, task_type: 'webhook',
            run_times: ['09:00'], run_days: [0, 2, 4],
            job_config: { url: 'https://partner.example.com/hooks/mojo', data: { probe: true } },
            notify: [], channel: 'webhooks', max_retries: 0,
            last_run: JOBS_NOW - 4 * day, run_count: 61,
            last_error: 'HTTP 503 from https://partner.example.com/hooks/mojo',
            created: JOBS_NOW - 95 * day, modified: JOBS_NOW - 4 * day,
        },
        {
            id: 'd5904be71c2f4a6db83e07f1c65a2b38', user: 1,
            name: 'One-off migration kick', description: 'Runs once, then disables itself.',
            enabled: true, run_once: true, task_type: 'job',
            run_times: ['23:15'], run_days: [6],
            job_config: { func: 'mojo.apps.jobs.examples.sample_jobs.process_file_upload', payload: {} },
            notify: ['email', 'in_app'], channel: 'default', max_retries: 0,
            last_run: null, run_count: 0, last_error: '',
            created: JOBS_NOW - 2 * day, modified: JOBS_NOW - 2 * day,
        },
    ];
}

function buildTaskResults(): MockTaskResult[] {
    const hour = 3600;
    return [
        {
            id: 'e10a3c5f7b9d42e8a6c04b1f3d78e502', task: 'a1c4f0b28e5d4f7c9b2a6e08d31f5a44', user: 1, job: null,
            status: 'success',
            output: 'Revenue rose 4.2% day over day, led by the Pro tier (+9.1%). Enterprise renewals were flat.',
            error: '', created: JOBS_NOW - 20 * hour,
        },
        {
            id: 'f27b4d6a8c0e41f9b7d15c2a4e89f613', task: 'a1c4f0b28e5d4f7c9b2a6e08d31f5a44', user: 1, job: null,
            status: 'success',
            output: 'Revenue fell 1.8% day over day; the drop is concentrated in trial conversions.',
            error: '', created: JOBS_NOW - 44 * hour,
        },
        {
            id: '0a3c5e7f9b1d43a8c6e02f4b8d17e924', task: 'a1c4f0b28e5d4f7c9b2a6e08d31f5a44', user: 1, job: null,
            status: 'error', output: '',
            error: 'LLM request timed out after 60s', created: JOBS_NOW - 68 * hour,
        },
        {
            id: '1b4d6f8a0c2e45b9d7f13a5c9e28f035', task: 'b7e2d9134a6b48c1ae03f5c7d2901b6e', user: 14,
            job: null, status: 'success',
            output: 'Published job for report_type=ledger', error: '', created: JOBS_NOW - 7 * hour,
        },
        {
            id: '2c5e7a9b1d3f46c0e8a24b6d0f39a146', task: 'c3f81a6d5b7e42908c14de6b7a2f0359', user: 18,
            job: null, status: 'error', output: '',
            error: 'HTTP 503 from https://partner.example.com/hooks/mojo', created: JOBS_NOW - 4 * 86400,
        },
    ];
}

// ══ end jobs engine fixtures ═════════════════════════════════════════

// ══ Network security fixtures (board #1287) ══════════════════════════
// IP sets, geofence evidence and firewall log rows. The matching request
// handling lives in ONE block inside mockFetch, banner-marked
// "Network security — wire implementation".
//
// Sources: mojo/apps/incident/models/ipset.py, mojo/apps/account/rest/
// geofence.py, mojo/apps/account/services/geofence/{engine,evidence}.py,
// mojo/apps/account/models/geolocated_ip.py, mojo/apps/metrics/rest/
// {categories,helpers}.py.

/** `IPSet` — every model field, including the two no graph ever serializes. */
interface MockIPSet {
    id: number;
    created: number;
    modified: number;
    name: string;
    kind: string;
    description: string | null;
    source: string;
    source_url: string | null;
    /** Never serialized by ANY graph — present so the mock can prove it. */
    source_key: string | null;
    /** `detailed` graph only. */
    data: string;
    is_enabled: boolean;
    cidr_count: number;
    last_synced: number | null;
    sync_error: string | null;
    [field: string]: unknown;
}

const IPSET_VIEW_PERMS_MOCK = ['view_security', 'security'];
const IPSET_SAVE_PERMS_MOCK = ['manage_security', 'security'];
/** `DELETE_PERMS = ["manage_security"]` — deliberately WITHOUT `security`. */
const IPSET_DELETE_PERMS_MOCK = ['manage_security'];
const IPSET_ACTIONS = new Set(['sync', 'enable', 'disable', 'refresh_source']);
const IPSET_WRITABLE_FIELDS = new Set([
    'name', 'kind', 'description', 'source', 'source_url', 'source_key', 'data', 'is_enabled',
]);
/** `IPSet.THREAT_CACHE_SETS` — cache-only threat lists, never kernel sets. */
const IPSET_CACHE_ONLY_MOCK = new Set(['tor_exits', 'blocklist_de']);

function cidrBlock(prefix: string, count: number): string {
    const lines: string[] = [];
    for (let i = 0; i < count; i++) lines.push(`${prefix}.${i}.0/24`);
    return lines.join('\n');
}

/** The seed shape, spelled out: `MockIPSet`'s index signature would otherwise
 *  swallow every property in an `Omit<>` and lose the spread's inference. */
interface MockIPSetSeed {
    name: string;
    kind: string;
    description: string | null;
    source: string;
    source_url: string | null;
    source_key: string | null;
    data: string;
    is_enabled: boolean;
    cidr_count: number;
    last_synced: number | null;
    sync_error: string | null;
}

function buildIPSets(): MockIPSet[] {
    const now = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    const seed: MockIPSetSeed[] = [
        {
            name: 'country_cn', kind: 'country', description: 'Country block: China',
            source: 'ipdeny', source_url: 'https://www.ipdeny.com/ipblocks/data/countries/cn.zone',
            source_key: null, data: cidrBlock('223.0', 40), is_enabled: true, cidr_count: 40,
            last_synced: now - 2 * DAY, sync_error: null,
        },
        {
            name: 'country_ru', kind: 'country', description: 'Country block: Russia',
            source: 'ipdeny', source_url: 'https://www.ipdeny.com/ipblocks/data/countries/ru.zone',
            source_key: null, data: cidrBlock('95.24', 24), is_enabled: true, cidr_count: 24,
            last_synced: now - 2 * DAY, sync_error: null,
        },
        {
            // Staged: created but never enabled — the default this module ships.
            name: 'country_kp', kind: 'country', description: 'Country block: North Korea',
            source: 'ipdeny', source_url: null, source_key: null, data: '', is_enabled: false,
            cidr_count: 0, last_synced: null, sync_error: null,
        },
        {
            name: 'abuse_ips', kind: 'abuse', description: 'AbuseIPDB confidence-100 blacklist',
            source: 'abuseipdb', source_url: null, source_key: 'abuseipdb-sentinel-secret',
            data: cidrBlock('45.83', 12), is_enabled: true, cidr_count: 12,
            last_synced: now - 6 * 3600, sync_error: null,
        },
        {
            name: 'dc_aws', kind: 'datacenter', description: 'AWS published ranges',
            source: 'manual', source_url: 'https://example.test/aws-ranges.txt', source_key: null,
            data: '', is_enabled: false, cidr_count: 0, last_synced: null, sync_error: null,
        },
        {
            // A manual set whose stored count is real because the list was
            // written through `data` (which routes through set_data()).
            name: 'office_deny', kind: 'custom', description: 'Ranges we never want to see',
            source: 'manual', source_url: null, source_key: null,
            data: '192.0.2.0/24\n198.51.100.0/24\n203.0.113.0/24', is_enabled: false,
            cidr_count: 3, last_synced: null, sync_error: null,
        },
        {
            name: 'dc_hetzner', kind: 'datacenter', description: 'Hetzner ranges',
            source: 'manual', source_url: 'https://example.test/hetzner.txt', source_key: null,
            data: '', is_enabled: false, cidr_count: 0, last_synced: now - 9 * DAY,
            sync_error: 'HTTPSConnectionPool(host=\'example.test\'): Max retries exceeded',
        },
        // The two cache-only rows `IPSet.ensure_threat_caches()` creates.
        {
            name: 'tor_exits', kind: 'abuse', description: 'Tor exit nodes (geoip detection cache)',
            source: 'tor', source_url: null, source_key: null, data: cidrBlock('185.220', 18),
            is_enabled: false, cidr_count: 18, last_synced: now - 3600, sync_error: null,
        },
        {
            name: 'blocklist_de', kind: 'abuse', description: 'blocklist.de aggregate (geoip detection cache)',
            source: 'blocklist_de', source_url: null, source_key: null, data: cidrBlock('91.121', 30),
            is_enabled: false, cidr_count: 30, last_synced: now - 3600, sync_error: null,
        },
    ];
    return seed.map((row, index) => ({
        ...row,
        id: 7100 + index,
        created: now - 120 * DAY,
        modified: row.last_synced ?? now - 30 * DAY,
    }));
}

/**
 * `GRAPHS = {default: exclude [data, source_key], detailed: exclude [source_key]}`.
 * An unknown graph name falls back to `default` (serializer.py:185-192), so
 * `source_key` has no escape hatch at all.
 */
function serializeIPSet(row: MockIPSet, graph: string): Record<string, unknown> {
    const { source_key: _key, data, ...rest } = row;
    if (graph === 'detailed') return { ...rest, data };
    if (graph !== 'default' && graph !== 'list') {
        console.warn(`mock /api/incident/ipset: unknown graph "${graph}" — serving "default"`);
    }
    return rest;
}

/**
 * `set_data(cidr_list)` = `"\n".join(cidr_list)` + `cidr_count = len(...)`,
 * and `on_rest_save_field` prefers `set_<key>` over a plain assignment. So a
 * posted LIST is correct and a posted STRING interleaves a newline between
 * every CHARACTER — reproduced verbatim so the trap is executable, not folklore.
 */
function applyIPSetData(row: MockIPSet, value: unknown): void {
    const parts = Array.isArray(value) ? value.map(String) : [...String(value ?? '')];
    row.data = parts.join('\n');
    row.cidr_count = parts.length;
}

interface MockIPSetSaveResult { error?: string; code?: number }

function applyIPSetSave(row: MockIPSet, body: Record<string, unknown>, all: MockIPSet[]): MockIPSetSaveResult {
    const now = Math.floor(Date.now() / 1000);
    const actions: [string, unknown][] = [];
    for (const [key, value] of Object.entries(body)) {
        if (IPSET_ACTIONS.has(key)) { actions.push([key, value]); continue; }
        if (!IPSET_WRITABLE_FIELDS.has(key)) continue;
        if (key === 'data') { applyIPSetData(row, value); continue; }
        if (key === 'is_enabled') { row.is_enabled = Boolean(value); continue; }
        if (key === 'name') {
            const name = String(value);
            if (all.some((other) => other !== row && other.name === name)) {
                return { error: 'IP set with this Name already exists.', code: 400 };
            }
            row.name = name;
            continue;
        }
        row[key] = value === '' ? null : value;
    }
    for (const [action] of actions) {
        if (action === 'enable') {
            // `on_action_enable` — the ONLY path that runs this check, and the
            // whole reason `is_enabled` is never written as a plain field.
            if (IPSET_CACHE_ONLY_MOCK.has(row.name)) {
                return {
                    error: `'${row.name}' is a cache-only threat list for geoip detection — `
                        + 'enabling it would kernel-block every listed IP fleet-wide and is not permitted',
                    code: 400,
                };
            }
            row.is_enabled = true;
            row.last_synced = now;
            row.sync_error = null;
        } else if (action === 'disable') {
            row.is_enabled = false;
        } else if (action === 'sync') {
            // `sync()` is a SILENT no-op for a disabled or cache-only set.
            if (row.is_enabled && !IPSET_CACHE_ONLY_MOCK.has(row.name)) {
                row.last_synced = now;
                row.sync_error = null;
            }
        } else if (action === 'refresh_source') {
            // `refresh_from_source()` returns False immediately for manual.
            if (row.source !== 'manual') {
                row.cidr_count = Math.max(1, row.cidr_count || 12);
                row.data = row.data || cidrBlock('198.18', row.cidr_count);
                row.sync_error = null;
                row.last_synced = now;
            }
        }
        row.modified = now;
    }
    return {};
}

// ── Geofence evidence (services/geofence/evidence.py) ─────────────────
// metadata keys are the reporter's OWN: `geofence_scope` (never `scope` — the
// top-level Event column stays "global"), `changed_by` on a config change
// (never `username`), and `reason`/`region_code`/`rule_level` on a block.

function buildGeofenceEvents(): MockIncidentEvent[] {
    const now = Math.floor(Date.now() / 1000);
    const HOUR = 3600;
    const seeds: {
        cat: 'geofence_block' | 'geofence_exempt' | 'geofence_config';
        level: number; hours: number; ip: string | null; cc: string | null;
        title: string; details: string; metadata: Record<string, unknown>;
    }[] = [
        {
            cat: 'geofence_block', level: 3, hours: 1, ip: '223.5.5.5', cc: 'CN',
            title: 'Geofence block: country_not_allowed',
            details: 'Geofence blocked 223.5.5.5 (country_not_allowed) on /api/login',
            metadata: {
                reason: 'country_not_allowed', rule_level: 'system', geofence_scope: 'auth',
                country_code: 'CN', region_code: null,
                abuse: { tor: false, vpn: false, datacenter: false, proxy: false },
                detail: 'Service is not available in your country.',
            },
        },
        {
            cat: 'geofence_block', level: 5, hours: 3, ip: '185.220.101.44', cc: 'NL',
            title: 'Geofence block: tor_detected',
            details: 'Geofence blocked 185.220.101.44 (tor_detected) on /api/login',
            metadata: {
                reason: 'tor_detected', rule_level: 'system', geofence_scope: 'auth',
                country_code: 'NL', region_code: null, username: 'unknown',
                abuse: { tor: true, vpn: false, datacenter: false, proxy: false },
                detail: 'Tor traffic is not permitted.',
            },
        },
        {
            cat: 'geofence_block', level: 6, hours: 7, ip: '10.0.9.44', cc: null,
            title: 'Geofence fail-open: lookup_failed',
            details: 'Geofence fail-open 10.0.9.44 (lookup_failed) on /api/login',
            metadata: {
                reason: 'lookup_failed', rule_level: null, geofence_scope: 'auth',
                country_code: null, region_code: null,
                detail: 'Geolocation lookup failed.',
            },
        },
        {
            cat: 'geofence_block', level: 7, hours: 12, ip: '198.51.100.66', cc: 'CN',
            title: 'Geofence block: rule_invalid',
            details: 'Geofence blocked 198.51.100.66 (rule_invalid) on /api/login',
            metadata: {
                reason: 'rule_invalid', rule_level: 'system', geofence_scope: 'auth',
                country_code: 'CN', region_code: null,
                detail: 'Geofence configuration is invalid; access denied.',
            },
        },
        {
            cat: 'geofence_block', level: 5, hours: 26, ip: '95.24.7.9', cc: 'RU',
            title: 'Geofence block: country_not_allowed',
            details: 'Geofence blocked 95.24.7.9 (country_not_allowed) on /api/login',
            metadata: {
                reason: 'country_not_allowed', rule_level: 'group', geofence_scope: 'auth',
                country_code: 'RU', region_code: null,
                detail: 'Service is not available in your country.',
            },
        },
        {
            cat: 'geofence_block', level: 3, hours: 40, ip: '73.92.14.5', cc: 'US',
            title: 'Geofence block: region_not_allowed',
            details: 'Geofence blocked 73.92.14.5 (region_not_allowed) on /api/login',
            metadata: {
                reason: 'region_not_allowed', rule_level: 'system', geofence_scope: 'auth',
                country_code: 'US', region_code: 'US-CA',
                detail: 'Service is not available in your region.',
            },
        },
        {
            cat: 'geofence_exempt', level: 3, hours: 4, ip: '203.0.113.9', cc: 'GB',
            title: 'Geofence exemption used',
            details: 'Allowlisted 203.0.113.9 bypassed a geofence block on /api/login',
            metadata: {
                reason: 'ip_allowlisted', geofence_scope: 'auth',
                allowlist_source: 'geoip', allowlist_reason: 'London office egress',
                would_block_reason: 'country_not_allowed',
                country_code: 'GB', region_code: null, username: 'ian',
            },
        },
        {
            cat: 'geofence_exempt', level: 3, hours: 30, ip: '203.0.113.14', cc: 'GB',
            title: 'Geofence exemption used',
            details: 'Allowlisted 203.0.113.14 bypassed a geofence block on /api/login',
            metadata: {
                reason: 'ip_allowlisted', geofence_scope: 'auth',
                allowlist_source: 'setting', allowlist_reason: 'Office egress',
                would_block_reason: 'datacenter_detected',
                country_code: 'GB', region_code: null,
            },
        },
        {
            cat: 'geofence_config', level: 3, hours: 5, ip: null, cc: null,
            title: 'Geofence rules updated (system)',
            details: 'Platform geofence rules replaced',
            metadata: {
                target: 'system', changed_by: 'security.manager', changed_by_id: 12,
                user_name: 'Security Manager',
                old: { country: { not_in: ['CN'] } },
                new: { country: { not_in: ['CN', 'RU'] }, abuse: { tor: false } },
            },
        },
        {
            cat: 'geofence_config', level: 3, hours: 50, ip: null, cc: null,
            title: 'Geofence allowlist updated',
            details: 'Network exemption list replaced',
            metadata: {
                target: 'allowlist', changed_by: 'security.manager', changed_by_id: 12,
                user_name: 'Security Manager',
            },
        },
    ];
    return seeds.map((seed, index) => ({
        id: 8800 - index,
        created: now - seed.hours * HOUR,
        level: seed.level,
        // The reporter never passes `scope=`, so the Event COLUMN stays global.
        scope: 'global',
        category: seed.cat,
        source_ip: seed.ip,
        hostname: 'auth-1',
        uid: null,
        // Populated by Event.sync_metadata from the geolocated source IP.
        country_code: seed.cc,
        title: seed.title,
        details: seed.details,
        model_name: null,
        model_id: null,
        metadata: { server: 'auth-1', ...seed.metadata },
        group_id: null,
        incident: null,
    }));
}

// ── Firewall log rows (GeoLocatedIP.log(..., 'firewall:*')) ───────────
// `path` is the ADMIN's request path and `ip` the ADMIN's address — both come
// from the ambient request. The blocked address lives ONLY in `payload.ip`,
// and the payload shape differs per kind.

let firewallLogSeq = 100300;

function firewallLogRow(
    kind: string,
    payload: Record<string, unknown>,
    opts: { created: number; modelId: number; username: string | null; uid: number; message: string },
): MockLog {
    return {
        id: firewallLogSeq++,
        created: opts.created,
        level: 'info',
        kind,
        method: 'POST',
        path: `/api/system/geoip/${opts.modelId}`,
        payload: JSON.stringify(payload),
        ip: '10.1.2.7',
        duid: null,
        uid: opts.uid,
        gid: 0,
        username: opts.username,
        user_agent: 'Mozilla/5.0 (portal-mojo admin)',
        log: opts.message,
        model_name: 'account.GeoLocatedIP',
        model_id: opts.modelId,
    };
}

function buildFirewallLogs(): MockLog[] {
    const now = Math.floor(Date.now() / 1000);
    const HOUR = 3600;
    return [
        firewallLogRow('firewall:block', {
            ip: '185.220.101.44', reason: 'auto:threat_escalation', ttl: null,
            blocked_until: null, block_count: 4, trigger: 'auto:incident_rule',
        }, { created: now - 2 * HOUR, modelId: 4108, username: null, uid: 0, message: 'blocked 185.220.101.44 permanently (auto:threat_escalation)' }),
        firewallLogRow('firewall:block', {
            ip: '45.33.32.156', reason: 'Credential stuffing from a VPN exit', ttl: 604800,
            blocked_until: new Date((now + 6 * 86400) * 1000).toISOString(), block_count: 2, trigger: 'manual',
        }, { created: now - 5 * HOUR, modelId: 4109, username: 'security.manager', uid: 12, message: 'blocked 45.33.32.156 for 7 days' }),
        firewallLogRow('firewall:unblock', {
            ip: '104.28.14.33', reason: 'False positive — scraper was ours', trigger: 'manual',
        }, { created: now - 20 * HOUR, modelId: 4110, username: 'security.manager', uid: 12, message: 'unblocked 104.28.14.33' }),
        firewallLogRow('firewall:whitelist', {
            ip: '203.0.113.9', reason: 'London office egress', until: null, was_blocked: false, trigger: 'manual',
        }, { created: now - 30 * HOUR, modelId: 4111, username: 'ian', uid: 1, message: 'whitelisted 203.0.113.9' }),
        firewallLogRow('firewall:whitelist', {
            ip: '198.51.100.77', reason: 'Temporary contractor egress',
            until: new Date((now - 10 * 86400) * 1000).toISOString(), was_blocked: true, trigger: 'manual',
        }, { created: now - 40 * HOUR, modelId: 4112, username: 'ian', uid: 1, message: 'whitelisted 198.51.100.77 until it expired' }),
        firewallLogRow('firewall:unwhitelist', {
            ip: '198.51.100.77', trigger: 'manual',
        }, { created: now - 3 * HOUR, modelId: 4112, username: 'security.manager', uid: 12, message: 'removed the whitelist for 198.51.100.77' }),
    ];
}

/**
 * Called from `applyGeoIpSave` so a geoip enforcement action leaves the same
 * firewall trail the backend writes. #1287.
 */
function recordFirewallLog(
    row: MockGeoIp, kind: string, payload: Record<string, unknown>, caller: MockUser, message: string,
): void {
    db.logs.unshift(firewallLogRow(kind, payload, {
        created: Math.floor(Date.now() / 1000),
        modelId: row.id,
        username: caller.username,
        uid: caller.id,
        message,
    }));
}

// ── Geofence DSL validation (services/geofence/dsl.py) ────────────────
// Top-level keys {country, region, abuse}; operators {in, not_in, eq}; abuse
// flags {tor, vpn, datacenter, proxy}. The messages mirror the validator's,
// because they are what the Rules tab shows inline on a 400.

const GEO_RULE_TOP_KEYS = ['country', 'region', 'abuse'];
const GEO_RULE_OPS = ['eq', 'in', 'not_in'];
const GEO_ABUSE_FLAGS = ['tor', 'vpn', 'datacenter', 'proxy'];

function validateGeoRule(rule: Record<string, unknown>): string | null {
    for (const [key, body] of Object.entries(rule)) {
        if (!GEO_RULE_TOP_KEYS.includes(key)) {
            return `geofence rule: unknown key '${key}'; valid keys are ${JSON.stringify(GEO_RULE_TOP_KEYS)}`;
        }
        if (!isPlainObject(body)) return `geofence rule: '${key}' must be a dict`;
        if (key === 'abuse') {
            for (const [flag, value] of Object.entries(body)) {
                if (!GEO_ABUSE_FLAGS.includes(flag)) {
                    return `geofence rule: 'abuse' has unknown flag '${flag}'; valid flags are ${JSON.stringify(GEO_ABUSE_FLAGS)}`;
                }
                if (value !== true && value !== false && value !== null) {
                    return `geofence rule: 'abuse.${flag}' must be true, false or null`;
                }
            }
            continue;
        }
        for (const [op, value] of Object.entries(body)) {
            if (!GEO_RULE_OPS.includes(op)) {
                return `geofence rule: '${key}' has unknown operator '${op}'; valid operators are ${JSON.stringify(GEO_RULE_OPS)}`;
            }
            if ((op === 'in' || op === 'not_in') && !Array.isArray(value)) {
                return `geofence rule: '${key}.${op}' must be a list`;
            }
            if (op === 'eq' && typeof value !== 'string') {
                return `geofence rule: '${key}.eq' must be a string`;
            }
        }
    }
    return null;
}

const ALLOWLIST_ENTRY_KEYS = new Set(['cidr', 'ip', 'reason', 'until']);

function validateGeoAllowlist(entries: unknown[]): string | null {
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (typeof entry === 'string') {
            if (!entry.trim()) return `geofence allowlist entry ${index}: empty value`;
            continue;
        }
        if (!isPlainObject(entry)) return `geofence allowlist entry ${index}: must be a string or a dict`;
        for (const key of Object.keys(entry)) {
            if (!ALLOWLIST_ENTRY_KEYS.has(key)) {
                return `geofence allowlist entry ${index}: unknown key '${key}'`;
            }
        }
        const cidr = entry.cidr ?? entry.ip;
        if (typeof cidr !== 'string' || !cidr.trim()) {
            return `geofence allowlist entry ${index}: 'cidr' is required`;
        }
        const [network, bits] = cidr.trim().split('/');
        const validBits = bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32);
        if (ipv4ToInt(String(network)) == null || !validBits) {
            return `geofence allowlist entry ${index}: invalid CIDR/IP '${cidr}' (each octet must be 0-255)`;
        }
        if (entry.reason != null && typeof entry.reason !== 'string') {
            return `geofence allowlist entry ${index}: 'reason' must be a string`;
        }
        if (entry.until != null && !Number.isFinite(Date.parse(String(entry.until)))) {
            return `geofence allowlist entry ${index}: could not parse 'until'`;
        }
    }
    return null;
}

/** `entry_active(norm)` — expired entries are LISTED with active=false. */
function normalizeMockAllowlistEntry(entry: unknown): Record<string, unknown> {
    if (!isPlainObject(entry)) {
        return { cidr: String(entry), reason: null, until: null, active: true };
    }
    const until = entry.until == null || entry.until === '' ? null : String(entry.until);
    const parsed = until == null ? null : Date.parse(until);
    return {
        cidr: String(entry.cidr ?? entry.ip ?? ''),
        reason: entry.reason == null ? null : String(entry.reason),
        until,
        active: parsed == null || !Number.isFinite(parsed) ? true : parsed > Date.now(),
    };
}

// ── The geofence engine, at the fidelity a simulator needs ────────────

const GEO_DETAIL_MAP: Record<string, string> = {
    no_rules: 'No geofence rules configured.',
    disabled: 'Geofencing is disabled.',
    bypass: 'Bypass permission granted.',
    ip_allowlisted: 'IP is allowlisted; geofence exemption applied.',
    no_rules_strict: 'Geofencing is required but no rules are configured; access denied.',
    passed: 'Allowed.',
    lookup_failed: 'Geolocation lookup failed.',
    private_ip: 'Private or reserved IP.',
    country_not_allowed: 'Service is not available in your country.',
    region_not_allowed: 'Service is not available in your region.',
    tor_detected: 'Tor traffic is not permitted.',
    vpn_detected: 'VPN traffic is not permitted.',
    proxy_detected: 'Proxy traffic is not permitted.',
    datacenter_detected: 'Datacenter traffic is not permitted.',
    rule_invalid: 'Geofence configuration is invalid; access denied.',
    group_inactive: 'The requested group is inactive; evaluating system rules only.',
};

function ipv4ToInt(ip: string): number | null {
    const parts = ip.trim().split('.');
    if (parts.length !== 4) return null;
    let value = 0;
    for (const part of parts) {
        const octet = Number(part);
        if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
        value = value * 256 + octet;
    }
    return value;
}

function ipInCidr(ip: string, cidr: string): boolean {
    const [network, bitsRaw] = cidr.split('/');
    const bits = bitsRaw == null ? 32 : Number(bitsRaw);
    const target = ipv4ToInt(ip);
    const base = ipv4ToInt(String(network));
    if (target == null || base == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    if (bits === 0) return true;
    const mask = bits === 32 ? 0xFFFFFFFF : ~((1 << (32 - bits)) - 1) >>> 0;
    return ((target & mask) >>> 0) === ((base & mask) >>> 0);
}

function isPrivateIpv4(ip: string): boolean {
    return /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip.trim());
}

interface MockGeoInput {
    country_code?: string | null;
    region_code?: string | null;
    is_tor?: boolean;
    is_vpn?: boolean;
    is_proxy?: boolean;
    is_datacenter?: boolean;
}

/** Evaluate one rule against a geo dict; returns the failing reason or null. */
function evaluateGeoRule(rule: unknown, geo: MockGeoInput): string | null {
    if (!isPlainObject(rule)) return null;
    const cc = String(geo.country_code ?? '').toUpperCase();
    const rc = String(geo.region_code ?? '').toUpperCase();

    const country = isPlainObject(rule.country) ? rule.country : null;
    if (country) {
        const list = (values: unknown): string[] => Array.isArray(values) ? values.map((v) => String(v).toUpperCase()) : [];
        if (Array.isArray(country.in) && cc && !list(country.in).includes(cc)) return 'country_not_allowed';
        if (Array.isArray(country.not_in) && cc && list(country.not_in).includes(cc)) return 'country_not_allowed';
        if (typeof country.eq === 'string' && cc && country.eq.toUpperCase() !== cc) return 'country_not_allowed';
    }

    const region = isPlainObject(rule.region) ? rule.region : null;
    if (region && rc) {
        const list = (values: unknown): string[] => Array.isArray(values) ? values.map((v) => String(v).toUpperCase()) : [];
        if (Array.isArray(region.not_in) && list(region.not_in).includes(rc)) return 'region_not_allowed';
        if (Array.isArray(region.in) && !list(region.in).includes(rc)) return 'region_not_allowed';
        if (typeof region.eq === 'string' && region.eq.toUpperCase() !== rc) return 'region_not_allowed';
    }

    const abuse = isPlainObject(rule.abuse) ? rule.abuse : null;
    if (abuse) {
        for (const flag of GEO_ABUSE_FLAGS) {
            if (abuse[flag] === false && geo[`is_${flag}` as keyof MockGeoInput] === true) return `${flag}_detected`;
        }
    }
    return null;
}

/**
 * `GeoFenceEngine.simulate` — no bypass shortcut, no cache, no evidence, and
 * `enabled` set at the TOP LEVEL of the returned decision (engine.py:473).
 */
function simulateGeoDecision(ip: string, geoBody: Record<string, unknown> | null, group?: MockGroup): Record<string, unknown> {
    const enabled = true; // GEOFENCE_ENABLED for this fixture deployment.
    let geo: MockGeoInput = {};
    if (geoBody) {
        geo = {
            country_code: geoBody.country_code == null ? null : String(geoBody.country_code).toUpperCase(),
            region_code: geoBody.region_code == null ? null : String(geoBody.region_code).toUpperCase(),
            is_tor: geoBody.is_tor === true,
            is_vpn: geoBody.is_vpn === true,
            is_proxy: geoBody.is_proxy === true,
            is_datacenter: geoBody.is_datacenter === true,
        };
    } else if (ip) {
        const cached = db.geoIps.find((row) => row.ip_address === ip);
        geo = cached
            ? {
                country_code: cached.country_code, region_code: cached.region_code,
                is_tor: cached.is_tor, is_vpn: cached.is_vpn,
                is_proxy: cached.is_proxy, is_datacenter: cached.is_datacenter,
            }
            : {};
    }

    const abuse = {
        tor: geo.is_tor === true, vpn: geo.is_vpn === true,
        datacenter: geo.is_datacenter === true, proxy: geo.is_proxy === true,
    };
    const base = (allowed: boolean, reason: string, ruleLevel: string | null = null) => ({
        allowed, reason, detail: GEO_DETAIL_MAP[reason] ?? '',
        ip: ip || null,
        // `country` and `country_code` carry the SAME value; likewise region.
        country: geo.country_code ?? null, country_code: geo.country_code ?? null,
        region: geo.region_code ?? null, region_code: geo.region_code ?? null,
        abuse, checked_at: new Date().toISOString(),
        rule_level: ruleLevel, strict_posture: false,
        enabled,
    });

    // The shadow decision — what the rules say, ignoring exemptions.
    const shadow = (() => {
        if (ip && isPrivateIpv4(ip)) return base(true, 'private_ip');
        if (ip && !geoBody && !db.geoIps.some((row) => row.ip_address === ip)) return base(true, 'lookup_failed');
        const systemFail = evaluateGeoRule(db.geoRules, geo);
        if (systemFail) return base(false, systemFail, 'system');
        const groupRule = group?.metadata.geofence;
        if (groupRule) {
            const groupFail = evaluateGeoRule(groupRule, geo);
            if (groupFail) return base(false, groupFail, 'group');
        }
        if (!Object.keys(db.geoRules).length && !groupRule) return base(true, 'no_rules');
        return base(true, 'passed');
    })();

    // The allowlist is consulted only when an IP was supplied.
    if (ip) {
        const settingHit = db.geoAllowlist
            .map(normalizeMockAllowlistEntry)
            .find((entry) => entry.active === true && ipInCidr(ip, String(entry.cidr)));
        const geoipHit = db.geoIps.find((row) => row.ip_address === ip && mockWhitelistActive(row));
        if (settingHit || geoipHit) {
            const decision: Record<string, unknown> = base(true, 'ip_allowlisted');
            decision.rule_level = null; // `_allowlisted_decision` never copies it.
            decision.allowlist_source = settingHit ? 'setting' : 'geoip';
            decision.allowlist_reason = settingHit ? settingHit.reason : geoipHit?.whitelisted_reason ?? null;
            decision.allowlist_until = settingHit
                ? settingHit.until
                : geoipHit?.whitelisted_until == null ? null : new Date(geoipHit.whitelisted_until * 1000).toISOString();
            if (shadow.reason === 'lookup_failed') {
                // The engine genuinely does not know — both stay null.
                decision.would_block = null;
                decision.would_block_reason = null;
            } else {
                decision.would_block = shadow.allowed === false;
                decision.would_block_reason = shadow.allowed ? null : shadow.reason;
            }
            return decision;
        }
    }

    if (group && !isEffectivelyActive(group)) {
        return { ...shadow, reason: 'group_inactive', detail: GEO_DETAIL_MAP.group_inactive, group_inactive: true };
    }
    return shadow;
}

// ══ end network security fixtures ════════════════════════════════════

const users = buildUsers();
const groups = buildGroups();
decorateUsers(users, groups);
// Events and logs are keyed off the job rows, so the seed is built once here
// and shared rather than rebuilt per db field.
const jobsSeed = buildJobs();
// #1291: devices and GeoIP rows are built up-front so device locations can
// join them by id — the same FK the backend has.
const deviceRows = buildDevices();
const geoIpRows = buildGeoIps();
const loginEventRows = linkLoginDevices(buildLoginEvents(users), deviceRows);
const members = buildMembers(users, groups);
members.push({
    id: 190, created: groups[0]!.created, modified: groups[0]!.modified,
    is_active: true, permissions: { view_dns: true }, metadata: {},
    user: 23, group: 1,
});
groups[0]!.member_count += 1;

interface MockStorageBucket {
    id: string;
    name: string;
    created: number;
    is_public: boolean;
    objects: number;
    versions: number;
    markers: number;
    uploads: number;
    incompleteMode?: 'access' | 'empty';
}

interface MockFileManager {
    id: number; created: number; name: string; use: string; backend_type: string; backend_url: string;
    is_active: boolean; is_default: boolean; is_public: boolean; aws_region: string | null;
    aws_key_masked: string | null; aws_secret_masked: string | null; allowed_origins: string[];
    assume_role_arn: string | null; has_external_id: boolean; group: number | null; user: number | null;
}

interface MockStorageFile {
    id: number; created: number; modified: number; filename: string; file_size: number | null;
    content_type: string; category: string; upload_status: string; is_active: boolean; is_public: boolean;
    group: number | null; user: number | null; file_manager: number; metadata: Record<string, unknown>;
    url: string | null;
    rendition_demo?: 'initial' | 'failed' | 'expired';
    rendition_reads?: number;
}

interface MockStorageRendition {
    id: number; original_file: number; created: number; modified: number; filename: string; file_size: number | null;
    content_type: string; category: string; role: string; upload_status: string; width?: number; height?: number; url: string | null;
}

interface MockStorageShare {
    id: number; code: string; url: string; source: string; hit_count: number; expires_at: number | null;
    is_active: boolean; track_clicks: boolean; metadata: Record<string, unknown>; created: number; modified: number;
    user: number; group: number | null; file: number;
}

function buildStorageBuckets(): MockStorageBucket[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 'mojo-private-assets', name: 'mojo-private-assets', created: now - 460 * 86400, is_public: false, objects: 18, versions: 27, markers: 3, uploads: 1 },
        { id: 'mojo-public-media', name: 'mojo-public-media', created: now - 330 * 86400, is_public: true, objects: 42, versions: 52, markers: 0, uploads: 0 },
        { id: 'mojo-partial-demo', name: 'mojo-partial-demo', created: now - 20 * 86400, is_public: false, objects: 7, versions: 9, markers: 1, uploads: 1, incompleteMode: 'empty' },
    ];
}

function buildFileManagers(): MockFileManager[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 4101, created: now - 410 * 86400, name: 'Private uploads', use: 'uploads', backend_type: 's3', backend_url: 's3://mojo-private-assets/uploads', is_active: true, is_default: true, is_public: false, aws_region: 'us-west-2', aws_key_masked: 'AKIA••••7D2Q', aws_secret_masked: '••••••••••m9p', allowed_origins: ['https://admin.example.test'], assume_role_arn: null, has_external_id: false, group: 1, user: null },
        { id: 4102, created: now - 320 * 86400, name: 'Public media', use: 'media', backend_type: 's3', backend_url: 's3://mojo-public-media/media', is_active: true, is_default: false, is_public: true, aws_region: 'us-west-2', aws_key_masked: 'AKIA••••3K8M', aws_secret_masked: '••••••••••r2x', allowed_origins: ['https://example.test'], assume_role_arn: null, has_external_id: false, group: null, user: 14 },
        { id: 4103, created: now - 70 * 86400, name: 'Local archive', use: 'archive', backend_type: 'file', backend_url: '/srv/mojo/archive', is_active: false, is_default: false, is_public: false, aws_region: null, aws_key_masked: null, aws_secret_masked: null, allowed_origins: [], assume_role_arn: null, has_external_id: false, group: 2, user: null },
    ];
}

function buildStorageFiles(): MockStorageFile[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 5101, created: now - 7200, modified: now - 3600, filename: 'launch-photo.jpg', file_size: 2845312, content_type: 'image/jpeg', category: 'image', upload_status: 'completed', is_active: true, is_public: false, group: 1, user: 14, file_manager: 4101, metadata: { width: 2400, height: 1600, camera: 'Demo camera' }, url: '/mock-storage/files/5101' },
        { id: 5102, created: now - 6400, modified: now - 3200, filename: 'briefing.mp4', file_size: 18124544, content_type: 'video/mp4', category: 'video', upload_status: 'completed', is_active: true, is_public: false, group: 1, user: 14, file_manager: 4101, metadata: { duration: 42 }, url: '/mock-storage/files/5102' },
        { id: 5103, created: now - 5400, modified: now - 2500, filename: 'field-note.mp3', file_size: 4125440, content_type: 'audio/mpeg', category: 'audio', upload_status: 'completed', is_active: true, is_public: false, group: 2, user: 14, file_manager: 4101, metadata: { duration: 31 }, url: '/mock-storage/files/5103' },
        { id: 5104, created: now - 4400, modified: now - 2200, filename: 'quarterly-report.pdf', file_size: 940122, content_type: 'application/pdf', category: 'document', upload_status: 'completed', is_active: true, is_public: true, group: null, user: 14, file_manager: 4102, metadata: { pages: 14 }, url: 'https://files.example.test/report.pdf' },
        { id: 5105, created: now - 1800, modified: now - 900, filename: 'unsafe-link.txt', file_size: 112, content_type: 'text/plain', category: 'text', upload_status: 'completed', is_active: true, is_public: false, group: 1, user: 14, file_manager: 4101, metadata: {}, url: 'javascript:alert(1)' },
        { id: 5106, created: now - 600, modified: now - 600, filename: 'rendering-slides.pptx', file_size: 802114, content_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', category: 'presentation', upload_status: 'completed', is_active: true, is_public: false, group: 1, user: 14, file_manager: 4101, metadata: {}, url: '/mock-storage/files/5106', rendition_demo: 'initial' },
        { id: 5107, created: now - 500, modified: now - 500, filename: 'renderer-failure.pdf', file_size: 402114, content_type: 'application/pdf', category: 'document', upload_status: 'completed', is_active: true, is_public: false, group: 1, user: 14, file_manager: 4101, metadata: {}, url: '/mock-storage/files/5107', rendition_demo: 'failed' },
        { id: 5108, created: now - 400, modified: now - 400, filename: 'renderer-expired.pdf', file_size: 302114, content_type: 'application/pdf', category: 'document', upload_status: 'completed', is_active: true, is_public: false, group: 1, user: 14, file_manager: 4101, metadata: {}, url: '/mock-storage/files/5108', rendition_demo: 'expired' },
    ];
}

function buildStorageRenditions(): MockStorageRendition[] {
    const now = Math.floor(Date.now() / 1000);
    return [
        { id: 6101, original_file: 5101, created: now - 3500, modified: now - 3500, filename: 'launch-photo-thumb.jpg', file_size: 42811, content_type: 'image/jpeg', category: 'image', role: 'thumbnail', upload_status: 'completed', width: 320, height: 213, url: '/mock-storage/renditions/6101' },
        { id: 6102, original_file: 5101, created: now - 3400, modified: now - 3400, filename: 'launch-photo-preview.jpg', file_size: 284001, content_type: 'image/jpeg', category: 'image', role: 'preview', upload_status: 'completed', width: 1280, height: 853, url: '/mock-storage/renditions/6102' },
        { id: 6103, original_file: 5102, created: now - 3100, modified: now - 3100, filename: 'briefing-poster.jpg', file_size: 94411, content_type: 'image/jpeg', category: 'image', role: 'poster', upload_status: 'completed', width: 1280, height: 720, url: '/mock-storage/renditions/6103' },
    ];
}

const db = {
    users,
    groups,
    members,
    apiKeys: buildApiKeys(),
    // #1287: firewall rows ride the same Log table the monitoring page reads.
    logs: [...buildFirewallLogs(), ...buildLogs(users, groups)],
    devices: deviceRows,
    geoIps: geoIpRows,
    deviceLocations: buildDeviceLocations(deviceRows, geoIpRows),
    pushDevices: buildPushDevices(),
    loginEvents: loginEventRows,
    // #1287: the geofence evidence plane shares the incident Event table.
    incidentEvents: [...buildIncidentEvents(), ...buildGeofenceEvents()],
    passkeys: buildPasskeys(),
    oauthConnections: buildOAuthConnections(),
    notificationPrefs: buildNotificationPrefs(),
    groupApiKeys: buildGroupApiKeys(),
    webhooks: buildWebhookSubscriptions(),
    webhookSecrets: new Map<number, { value: string; created_at: string; last_rotated_at: string }>(),
    settings: buildSettings(),
    dnsCredentials: buildDnsCredentials(),
    dnsDomains: buildDnsDomains(),
    domainPurchases: buildDomainPurchases(),
    dnsCertificates: buildDnsCertificates(),
    dnsRecords: buildDnsRecords(),
    metricPermissions: new Map<string, { view_permissions: string | string[] | null; write_permissions: string | string[] | null }>([
        ['global', { view_permissions: 'view_metrics', write_permissions: ['write_metrics', 'metrics'] }],
        ['group-1', { view_permissions: ['view_metrics', 'metrics'], write_permissions: null }],
        ['user-1', { view_permissions: null, write_permissions: 'metrics' }],
    ]),
    // #1287 FIXTURE CORRECTION. `{countries: {deny: [...]}}` is not the DSL —
    // top-level keys are {country, region, abuse} and operators are
    // {in, not_in, eq}, so the old value would have been REJECTED by the
    // backend's own `validate_rule` (which the POST handler now enforces here).
    geoRules: { country: { not_in: ['CN', 'RU'] }, abuse: { tor: false } } as Record<string, unknown>,
    geoAllowlist: [
        { cidr: '203.0.113.0/24', reason: 'Office egress', until: null },
        { cidr: '198.51.100.0/24', reason: 'Partner VPN — expired', until: '2026-01-31T00:00:00Z' },
    ] as unknown[],
    ipSets: buildIPSets(),
    tickets: buildTickets(),
    incidentRecords: buildIncidents(),
    ticketNotes: buildTicketNotes(),
    maestroItemLinks: buildMaestroItemLinks(),
    incidentHistory: buildIncidentHistory(),
    ruleSets: buildRuleSets(),
    rules: buildRules(),
    bouncerDevices: buildBouncerDevices(),
    bouncerSignals: buildBouncerSignals(),
    botSignatures: buildBotSignatures(),
    // ── Jobs engine ───────────────────────────────────────────────────
    jobs: jobsSeed,
    jobEvents: buildJobEvents(jobsSeed),
    jobLogs: buildJobLogs(jobsSeed),
    jobRunners: buildJobRunners(),
    scheduledTasks: buildScheduledTasks(),
    taskResults: buildTaskResults(),
    storageBuckets: buildStorageBuckets(),
    fileManagers: buildFileManagers(),
    storageFiles: buildStorageFiles(),
    fileRenditions: buildStorageRenditions(),
    storageRenditionJobs: new Map<number, { roles: string[]; detailGets: number; finalStatus: 'completed' | 'failed' | 'expired' }>(),
    storageShares: [] as MockStorageShare[],
    // The scheduler lock, as `control/force-scheduler-lead` sees it: a Redis
    // string key whose VALUE is the holder. Deleting it is the whole control.
    jobsSchedulerLock: 'runner-mojo-web-01-engine' as string | null,
    // Per-user login throttle counters (auth/manage/throttle shape). u3 is
    // mid-lockout so the header badge + Clear Rate Limit are demoable.
    throttle: new Map<number, { count: number; limit: number; window: number; retry_after_seconds: number }>([
        [3, { count: 11, limit: 10, window: 900, retry_after_seconds: 412 }],
    ]),
};

registerDnsAdminIntegration({
    applyManagedDnsRecords: (domainId, records) => {
        if (!db.dnsDomains.some((domain) => domain.id === domainId)) throw new Error('Domain not found');
        db.dnsRecords.set(domainId, records.map((record) => ({ ...record, record_values: [...record.record_values] })));
    },
});

function getField(row: Record<string, unknown>, field: string): unknown {
    if (Object.prototype.hasOwnProperty.call(row, field)) return row[field];
    let cursor: unknown = row;
    for (const part of field.split('__')) {
        if (cursor == null || typeof cursor !== 'object') return undefined;
        cursor = (cursor as Record<string, unknown>)[part];
    }
    return cursor;
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
    const known = ['exact', 'in', 'not', 'not_in', 'icontains', 'startswith', 'gte', 'lte', 'gt', 'lt', 'isnull'];
    const field = known.includes(lookup) && parts.length > 1 ? parts.slice(0, -1).join('__') : key;
    const op = known.includes(lookup) && parts.length > 1 ? lookup : 'exact';

    return rows.filter((row) => {
        const v = fkValue(getField(row, field));
        switch (op) {
            case 'in': return raw.split(',').map((s) => s.trim()).some((candidate) => compareWireValues(v, candidate) === 0);
            case 'not': return compareWireValues(v, raw) !== 0;
            case 'not_in': return !raw.split(',').map((s) => s.trim()).some((candidate) => compareWireValues(v, candidate) === 0);
            case 'icontains': return String(v ?? '').toLowerCase().includes(raw.toLowerCase());
            case 'startswith': return String(v ?? '').startsWith(raw);
            case 'gte': return v != null && compareWireValues(v, raw) >= 0;
            case 'lte': return v != null && compareWireValues(v, raw) <= 0;
            case 'gt': return v != null && compareWireValues(v, raw) > 0;
            case 'lt': return v != null && compareWireValues(v, raw) < 0;
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

function listUsers(params: Params, users: MockUser[] = db.users) {
    // Search matches the model's real SEARCH_FIELDS: username, email,
    // display_name, phone_number (account/models/user.py RestMeta).
    const result = listRows(
        users as unknown as Record<string, unknown>[],
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

function exportUsers(params: Params, users: MockUser[] = db.users) {
    const full = listUsers({ ...params, start: 0, size: users.length }, users);
    return exportRows(full.data as unknown as Record<string, unknown>[], params, 'User');
}

// ── POST_SAVE_ACTIONS (User) ──────────────────────────────────────────
// Mirrors mojo/models/rest.py on_rest_save: action keys are pulled OUT of the
// save body, plain fields save first, then each action handler runs — and the
// response is the refreshed row UNLESS a handler returned its own payload
// (action_resp wins verbatim). The mocked subset matches django-mojo
// account/models/user.py RestMeta.POST_SAVE_ACTIONS (which also declares
// change_username plus the action subset exercised by the packaged Admin.
const USER_ACTIONS = new Set(['change_username', 'send_invite', 'disable', 'reactivate', 'revoke_sessions', 'disable_totp']);
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
            if (!user.is_active) {
                return { status: false, error: 'User is already inactive', error_code: 400 };
            }
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
            if (user.is_active) {
                return { status: false, error: 'User is already active', error_code: 400 };
            }
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
        case 'change_username': {
            const username = String(dict.username ?? '').toLowerCase().trim();
            if (!username) return { status: false, error: 'username is required', error_code: 400 };
            if (username === user.username) return { status: false, error: 'New username must be different from current username', error_code: 400 };
            if (db.users.some((candidate) => candidate.id !== user.id && candidate.username === username)) {
                return { status: false, error: 'A user with that username already exists', error_code: 400 };
            }
            user.username = username;
            return { status: true, data: { username } };
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

const LOGIN_METHODS = new Set(['password', 'sms', 'passkey', 'magic', 'google', 'apple', 'github']);
const REGISTRATION_METHODS = new Set(['password', 'google', 'apple', 'github']);
const DEFAULT_AUTH_CONFIG: Record<string, unknown> = {
    theme: {
        app_title: 'DJANGO MOJO', logo_url: '', favicon_url: '', hero_image_url: '',
        hero_headline: 'Welcome back', hero_subheadline: 'Admin Portal',
        back_to_website_url: '', terms_url: '', layout: 'card', api_base: '',
        success_redirect: '/', custom_css: '', custom_css_url: '',
    },
    registration: {
        enabled: true, fields: null, extra_fields: [], identity_field: '', min_age: null,
        methods: ['password', 'google', 'apple', 'github'], passkey_prompt: 'off',
    },
    login: { methods: ['password', 'sms', 'passkey', 'magic', 'google', 'apple', 'github'] },
};
const DEPLOYMENT_AUTH_CONFIG: Record<string, unknown> = {
    theme: { hero_subheadline: 'NativeMojo identity', terms_url: 'https://example.com/terms' },
    registration: { min_age: 16 },
    deployment_private_key: 'never-public',
};

function validateAuthConfig(value: unknown): string | null {
    if (!isPlainObject(value)) return 'auth config must be an object';
    if (value.theme != null) {
        if (!isPlainObject(value.theme)) return 'auth_config.theme must be an object';
        const layout = value.theme.layout;
        if (layout != null && !['card', 'fullscreen'].includes(String(layout))) return 'auth_config.theme.layout must be one of: card, fullscreen';
        const css = value.theme.custom_css;
        if (css != null && typeof css !== 'string') return 'auth_config.theme.custom_css must be a string';
        if (typeof css === 'string' && (css.includes('<') || css.toLowerCase().includes('@import') || css.includes('://'))) return 'auth_config.theme.custom_css cannot reference external content';
        const cssUrl = value.theme.custom_css_url;
        if (cssUrl && (typeof cssUrl !== 'string' || !cssUrl.startsWith('https://'))) return 'auth_config.theme.custom_css_url must be an https:// URL';
    }
    const validateMethods = (section: unknown, allowed: Set<string>, label: string, nonEmpty: boolean): string | null => {
        if (section == null) return null;
        if (!isPlainObject(section)) return `auth_config.${label.split('.')[0]} must be an object`;
        if (section.methods == null) return null;
        if (!Array.isArray(section.methods)) return `${label} must be a list`;
        if (nonEmpty && section.methods.length === 0) return `${label} cannot be empty — no way to log in`;
        const unknown = section.methods.find((method) => typeof method !== 'string' || !allowed.has(method));
        return unknown == null ? null : `${label} has an unknown method '${String(unknown)}'`;
    };
    const loginError = validateMethods(value.login, LOGIN_METHODS, 'login.methods', true);
    if (loginError) return loginError;
    const registrationError = validateMethods(value.registration, REGISTRATION_METHODS, 'registration.methods', false);
    if (registrationError) return registrationError;
    if (isPlainObject(value.registration)) {
        const prompt = value.registration.passkey_prompt;
        if (prompt != null && !['off', 'optional', 'required'].includes(String(prompt))) return 'auth_config.registration.passkey_prompt must be one of: off, optional, required';
    }
    return null;
}

function isEffectivelyActive(group: MockGroup): boolean {
    let current: MockGroup | undefined = group;
    const seen = new Set<number>();
    while (current && !seen.has(current.id)) {
        if (!current.is_active) return false;
        seen.add(current.id);
        const parentId: number | null = current.parent ? Number(current.parent.id) : null;
        current = parentId ? db.groups.find((candidate) => candidate.id === parentId) : undefined;
    }
    return true;
}

/** Group.is_effectively_active(max_depth=8), as DNS credential choices use it. */
function isDnsCredentialChoiceEligible(group: MockGroup): boolean {
    if (!group.is_active) return false;
    let current: MockGroup | undefined = group;
    for (let depth = 0; depth < 8; depth++) {
        const parentId: number | null = current.parent ? Number(current.parent.id) : null;
        if (!parentId) return true;
        current = db.groups.find((candidate) => candidate.id === parentId);
        if (!current || !current.is_active) return false;
    }
    return true;
}

function mockGroupChoiceInteger(value: unknown, fallback: number, minimum: number, maximum: number): number | null {
    const input = value == null ? fallback : value;
    if (typeof input === 'boolean' || (typeof input !== 'string' && typeof input !== 'number')) return null;
    if (typeof input === 'string' && !/^[0-9]+$/.test(input)) return null;
    const parsed = typeof input === 'number' ? input : Number(input);
    return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function resolveAuthConfig(group?: MockGroup): Record<string, unknown> {
    let config = mergeDicts(DEFAULT_AUTH_CONFIG, DEPLOYMENT_AUTH_CONFIG);
    if (group) {
        const chain: MockGroup[] = [];
        let current: MockGroup | undefined = group;
        const seen = new Set<number>();
        while (current && !seen.has(current.id)) {
            chain.unshift(current);
            seen.add(current.id);
            const parentId: number | null = current.parent ? Number(current.parent.id) : null;
            current = parentId ? db.groups.find((candidate) => candidate.id === parentId) : undefined;
        }
        for (const entry of chain) {
            const override = isPlainObject(entry.metadata.auth_config) ? entry.metadata.auth_config : {};
            config = mergeDicts(config, override);
        }
    }
    return config;
}

function publicAuthConfig(config: Record<string, unknown>): Record<string, unknown> {
    const theme = isPlainObject(config.theme) ? config.theme : {};
    const registration = isPlainObject(config.registration) ? config.registration : {};
    const login = isPlainObject(config.login) ? config.login : {};
    return {
        theme: { ...theme },
        registration: {
            enabled: registration.enabled ?? true,
            fields: registration.fields ?? null,
            extra_fields: Array.isArray(registration.extra_fields) ? registration.extra_fields : [],
            identity_field: registration.identity_field ?? '',
            min_age: registration.min_age ?? null,
            methods: Array.isArray(registration.methods) ? registration.methods : [],
            passkey_prompt: registration.passkey_prompt ?? 'off',
        },
        login: { methods: Array.isArray(login.methods) ? login.methods : [] },
    };
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
    if (isPlainObject(fields.metadata) && fields.metadata.auth_config !== null && 'auth_config' in fields.metadata) {
        const error = validateAuthConfig(fields.metadata.auth_config);
        if (error) return { status: false, error, error_code: 400 };
    }
    if ('parent' in fields) {
        const rawParent = fields.parent;
        if (rawParent == null || rawParent === '') fields.parent = null;
        else {
            const parent = db.groups.find((candidate) => candidate.id === Number(rawParent));
            if (!parent) return { status: false, error: 'Group not found', error_code: 404 };
            fields.parent = groupBasic(parent);
        }
    }
    const target = group as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(fields)) {
        const existing = target[key];
        // JSONField dict-merge parity (metadata), plain assign otherwise.
        if (key === 'metadata' && isPlainObject(value) && isPlainObject(existing)) {
            const merged = mergeDicts(existing, value);
            // objict JSON merge deletes a nested key when explicitly sent
            // as null. This is how auth overrides return to inheritance.
            if ('auth_config' in value && value.auth_config === null) delete merged.auth_config;
            target[key] = merged;
        } else {
            target[key] = isPlainObject(value) && isPlainObject(existing) ? mergeDicts(existing, value) : value;
        }
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

/**
 * Jobs metric slugs, exactly as `mojo/apps/jobs` records them. The per-channel
 * naming is ASYMMETRIC and that asymmetry is deliberate here: publishing is
 * counted as `jobs.published.<channel>`, while terminal outcomes are counted
 * as `jobs.channel.<channel>.completed` / `.failed`. A chart that assumes one
 * pattern for both silently plots nothing for half its series.
 */
const JOBS_METRIC_SERIES: { slug: string; label: string; base: number; spread: number }[] = [
    { slug: 'jobs.published', label: 'Jobs Published', base: 180, spread: 70 },
    { slug: 'jobs.completed', label: 'Jobs Completed', base: 168, spread: 66 },
    { slug: 'jobs.failed', label: 'Jobs Failed', base: 9, spread: 8 },
    { slug: 'jobs.retried', label: 'Jobs Retried', base: 5, spread: 5 },
    { slug: 'jobs.expired', label: 'Jobs Expired', base: 2, spread: 3 },
    { slug: 'jobs.local.completed', label: 'Local Completed', base: 22, spread: 12 },
    { slug: 'jobs.local.failed', label: 'Local Failed', base: 3, spread: 3 },
    { slug: 'jobs.local.duration_ms', label: 'Local Duration (ms)', base: 1400, spread: 700 },
    ...JOBS_CHANNELS.flatMap((channel, index) => {
        const weight = [1, 0.7, 0.25, 0.4][index] ?? 0.5;
        return [
            { slug: `jobs.published.${channel}`, label: `Published · ${channel}`, base: Math.round(180 * weight), spread: Math.round(60 * weight) },
            { slug: `jobs.channel.${channel}.completed`, label: `Completed · ${channel}`, base: Math.round(168 * weight), spread: Math.round(56 * weight) },
            { slug: `jobs.channel.${channel}.failed`, label: `Failed · ${channel}`, base: Math.max(1, Math.round(9 * weight)), spread: Math.max(1, Math.round(7 * weight)) },
        ];
    }),
];

/**
 * #1287: the geofence slug family, exactly as `services/geofence/evidence.py`
 * records it — the base counters plus the per-country breakdown
 * (`geofence:blocks:country:<CC>`) that `/api/metrics/category_slugs` lists
 * and the blocks tab sums server-side. The per-REGION family
 * (`geofence:blocks:region:<RC>`) is recorded by the backend too but is not
 * consumed by any surface here, so it is listed and left unplotted.
 */
const GEOFENCE_COUNTRY_WEIGHTS: [string, number][] = [
    ['CN', 34], ['RU', 21], ['BR', 12], ['NL', 9], ['IN', 7],
    ['VN', 5], ['IR', 4], ['US', 3],
];
const GEOFENCE_METRIC_SERIES: { slug: string; label: string; base: number; spread: number }[] = [
    { slug: 'geofence:blocks', label: 'Geofence Blocks', base: 96, spread: 40 },
    { slug: 'geofence:exempt', label: 'Exempt Passes', base: 11, spread: 8 },
    ...GEOFENCE_COUNTRY_WEIGHTS.map(([code, base]) => ({
        slug: `geofence:blocks:country:${code}`,
        label: `Blocks · ${code}`,
        base,
        spread: Math.max(2, Math.round(base / 3)),
    })),
];

/** The registry `/api/metrics/category_slugs` reads (a SET server-side, so the
 *  wire order is nondeterministic — the mock shuffles nothing but the client
 *  must not depend on order either). */
const METRIC_CATEGORY_SLUGS: Record<string, string[]> = {
    geofence: [
        'geofence:blocks',
        'geofence:exempt',
        ...GEOFENCE_COUNTRY_WEIGHTS.map(([code]) => `geofence:blocks:country:${code}`),
        'geofence:blocks:region:US-CA',
        'geofence:blocks:region:US-NY',
    ],
    firewall: ['firewall:blocks', 'firewall:blocks:country:CN', 'firewall:broadcasts'],
    auth: ['auth:failures', 'auth:successes'],
    collisions: ['foo:count', 'bar:count'],
    growth: ['baseline:new_users'],
};

const SERIES: { slug: string; label: string; base: number; spread: number }[] = [
    { slug: 'api_calls', label: 'API Calls', base: 240, spread: 90 },
    { slug: 'logins', label: 'Logins', base: 70, spread: 34 },
    { slug: 'errors', label: 'Errors', base: 12, spread: 10 },
    { slug: 'auth:failures', label: 'Authentication Failures', base: 18, spread: 9 },
    { slug: 'auth:successes', label: 'Authentication Successes', base: 92, spread: 31 },
    { slug: 'foo:count', label: 'Foo Count', base: 31, spread: 8 },
    { slug: 'bar:count', label: 'Bar Count', base: 74, spread: 17 },
    { slug: 'baseline:new_users', label: 'New Users', base: 7, spread: 3 },
    ...JOBS_METRIC_SERIES,
    ...GEOFENCE_METRIC_SERIES,
];

/** Live-shaped maintained registries. Discovery exposes only these names. */
const METRIC_ACCOUNT_CATEGORIES: Record<string, Record<string, string[]>> = {
    public: {
        traffic: ['api_calls'],
    },
    global: {
        auth: METRIC_CATEGORY_SLUGS.auth!,
        collisions: METRIC_CATEGORY_SLUGS.collisions!,
        growth: METRIC_CATEGORY_SLUGS.growth!,
        geofence: METRIC_CATEGORY_SLUGS.geofence!,
        jobs: JOBS_METRIC_SERIES.map((series) => series.slug),
    },
    'group-1': {
        auth: ['auth:failures', 'auth:successes'],
        collisions: ['foo:count', 'bar:count'],
    },
    'user-14': {
        activity: ['logins'],
    },
    'ops-private': {
        operations: ['errors', 'jobs.failed'],
    },
    'finance-hidden': {
        billing: ['billing:revenue'],
    },
};

/** Custom account policy is independent from the manage-only permissions table. */
const METRIC_ACCOUNT_VIEW_POLICY: Record<string, 'public' | string[]> = {
    'ops-private': ['view_metrics'],
    'finance-hidden': ['finance_metrics'],
};

const METRIC_SCALAR_VALUES: Record<string, Record<string, unknown>> = {
    public: { 'status:release': '2026.08' },
    global: { 'limits:max_users': 5000, 'feature:maintenance': false },
    'group-1': { 'limits:max_members': 250 },
    'user-14': { 'preferences:quota': 25 },
    'ops-private': { 'threshold:error_budget': 0.03 },
};

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

function metricValues(slug: string, times: readonly number[], granularity: string, account: string): number[] {
    const definition = SERIES.find((series) => series.slug === slug);
    if (!definition) return times.map(() => 0);
    const bucket = BUCKET_MS[granularity] ?? BUCKET_MS.hours!;
    const scale = bucket / 3600e3;
    const salt = accountSalt(account);
    const index = SERIES.indexOf(definition);
    return times.map((time) => Math.round(sample(index + (salt % 997), time + salt, definition.base, definition.spread) * Math.max(0.15, scale)));
}

function fetchMetrics(params: Params, caller?: MockUser) {
    const granularity = String(params.granularity ?? 'hours');
    const wanted = String(params.slugs ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const account = String(params.account ?? 'public');

    if (wanted.length === 0) {
        // Backend parity: slug(s) are required, not defaulted.
        return { status: false, error: 'missing required parameter: slug, slugs, or category', error_code: 400 };
    }
    if (!canViewMetricsAccount(caller, account)) return permissionDenied(caller ? 403 : 401);
    const window = metricTimes(params, granularity);
    if (!Array.isArray(window)) return { status: false, error: window.error, error_code: 400 };
    const labels = window.map((date) => bucketLabel(date, granularity));
    const times = window.map((date) => date.getTime());
    const data: Record<string, number[]> = {};
    const childKind = String(params.child_kind ?? '').trim();
    const breakdown = String(params.breakdown ?? 'false').toLowerCase() === 'true';

    if (childKind) {
        const match = account.match(/^group-([1-9]\d*)$/);
        if (!match) return { status: false, error: 'child_kind requires account=group-<parent_id>', error_code: 400 };
        const parentId = Number(match[1]);
        if (!db.groups.some((group) => group.id === parentId)) return { status: false, error: `${account} not found`, error_code: 400 };
        if (breakdown && wanted.length !== 1) return { status: false, error: `breakdown=true requires a single slug, got ${wanted.length}`, error_code: 400 };
        let children = db.groups
            .filter((group) => group.is_active && Number(group.parent?.id ?? 0) === parentId && group.kind === childKind)
            .map((group) => ({ id: group.id, name: group.name }));
        // Deliberate same-name siblings exercise the live `name#id` identity.
        if (parentId === 1 && childKind === 'team' && children.length >= 2) {
            children = children.map((child, index) => index < 2 ? { ...child, name: 'Operations' } : child);
        }
        if (breakdown) {
            const counts = new Map<string, number>();
            for (const child of children) counts.set(child.name, (counts.get(child.name) ?? 0) + 1);
            const groups: Record<string, number> = {};
            for (const child of children) {
                const key = counts.get(child.name)! > 1 ? `${child.name}#${child.id}` : child.name;
                data[key] = metricValues(wanted[0]!, times, granularity, `group-${child.id}`);
                groups[key] = child.id;
            }
            return { status: true, data: { data, labels, groups } };
        }
        for (const slug of wanted) {
            const tail = slug.split(':').at(-1)!;
            const sum = times.map(() => 0);
            for (const child of children) {
                const values = metricValues(slug, times, granularity, `group-${child.id}`);
                values.forEach((value, index) => { sum[index] = (sum[index] ?? 0) + value; });
            }
            data[tail] = sum;
        }
        return { status: true, data: { data, labels } };
    }

    // Live `/fetch` intentionally truncates every identity to the final colon
    // segment. A collision overwrites here; the explorer adapter must split.
    for (const slug of wanted) data[slug.split(':').at(-1)!] = metricValues(slug, times, granularity, account);

    return { status: true, data: { data, labels } };
}

function fetchMetricPoint(params: Params, caller?: MockUser) {
    const account = String(params.account ?? 'public');
    if (!canViewMetricsAccount(caller, account)) return permissionDenied(caller ? 403 : 401);
    const slugs = String(params.slugs ?? params.slug ?? '').split(',').map((slug) => slug.trim()).filter(Boolean);
    if (!slugs.length) return { status: false, error: 'missing required parameter: slug or slugs', error_code: 400 };
    const whenSeconds = numericWireValue(params.when);
    if (whenSeconds == null) return { status: false, error: 'when is required', error_code: 400 };
    const granularity = String(params.granularity ?? 'hours');
    const currentAt = floorMetricBucket(whenSeconds * 1000, granularity);
    const previousAt = stepMetricBucket(currentAt, granularity, -1);
    const data: Record<string, number> = {};
    const prev_data: Record<string, number> = {};
    const deltas: Record<string, { delta: number; delta_pct?: number }> = {};
    for (const slug of slugs) {
        const current = metricValues(slug, [currentAt.getTime()], granularity, account)[0] ?? 0;
        const previous = slug === 'baseline:new_users'
            ? 0
            : metricValues(slug, [previousAt.getTime()], granularity, account)[0] ?? 0;
        data[slug] = current;
        prev_data[slug] = previous;
        deltas[slug] = {
            delta: current - previous,
            ...(previous > 0 ? { delta_pct: Math.round((((current - previous) / previous) * 100) * 100) / 100 } : {}),
        };
    }
    return {
        status: true, data, prev_data, deltas, slugs,
        when: currentAt.toISOString(), prev_when: previousAt.toISOString(), granularity, account,
    };
}

function fetchMetricScalars(params: Params, caller?: MockUser) {
    const account = String(params.account ?? 'public');
    if (!canViewMetricsAccount(caller, account)) return permissionDenied(caller ? 403 : 401);
    const slugs = String(params.slugs ?? '').split(',').map((slug) => slug.trim()).filter(Boolean);
    if (!slugs.length) return { status: false, error: 'missing required parameter: slugs', error_code: 400 };
    const values = METRIC_SCALAR_VALUES[account] ?? {};
    const data: Record<string, unknown> = {};
    for (const slug of slugs) data[slug.split(':').at(-1)!] = values[slug] ?? params.default ?? null;
    return { status: true, data, slugs, account };
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

function authFetch(path: string, body: Record<string, unknown>, params: Params = {}): unknown {
    // Dev knob: __mock_access_ttl mints a short-lived access token so refresh
    // paths are testable without waiting 6 hours. Mock-only; ignored by the
    // real backend (unknown params are dropped server-side).
    const accessTtl = typeof body.__mock_access_ttl === 'number' ? body.__mock_access_ttl : ACCESS_TTL;

    switch (path) {
        case '/api/auth/config': {
            const uuid = String(params.group_uuid ?? body.group_uuid ?? '').trim();
            const group = uuid ? db.groups.find((candidate) => candidate.uuid === uuid) : undefined;
            // Live semantics: absent, unknown, or effectively inactive UUIDs
            // resolve no group and therefore fall back to deployment config.
            const activeGroup = group && isEffectivelyActive(group) ? group : undefined;
            return { status: true, data: publicAuthConfig(resolveAuthConfig(activeGroup)) };
        }
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

export interface MockRequestHistoryEntry {
    method: string;
    path: string;
    /** Only non-sensitive DNS/metrics query values needed by contract verification. */
    params?: Params;
}

const requestHistory: MockRequestHistoryEntry[] = [];

export function getMockRequestHistory(): MockRequestHistoryEntry[] {
    return requestHistory.map((entry) => ({ ...entry, ...(entry.params ? { params: { ...entry.params } } : {}) }));
}

export function clearMockRequestHistory(): void {
    requestHistory.length = 0;
}

export function getMockCallCounts(): Record<string, number> {
    return Object.fromEntries(callCounts);
}

let armedReauth: { method: string; path: string } | null = null;

/** Mock-only one-shot fresh-auth challenge, matched by BOTH method and path. */
export function armMockReauth(method: string, path: string): void {
    armedReauth = { method: method.toUpperCase(), path };
}

let dnsConfigMalformed = false;
let dnsWriteFault: 'reject' | 'ambiguous' | 'reconcile' | null = null;
let dnsFailNextRead = false;

/** Showcase-only fail-closed state; production transports never call this. */
export function setMockDnsConfigMalformed(value: boolean): void {
    dnsConfigMalformed = value;
}

/** Verifier-only one-shot DNS transport outcomes; all state still lives in db.dnsRecords. */
export function armMockDnsWriteFault(mode: 'reject' | 'ambiguous' | 'reconcile'): void {
    dnsWriteFault = mode;
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

function hasGlobalPermission(user: MockUser | undefined, permissions: string[]): boolean {
    if (!user) return false;
    if (user.is_superuser) return true;
    return permissions.some((permission) => Boolean(user.permissions[permission]));
}

const STORAGE_VIEW_GRANTS = ['view_fileman', 'manage_files', 'files'];
const STORAGE_MANAGE_GRANTS = ['manage_files', 'files'];
const STORAGE_BUCKET_GRANTS = ['manage_aws', 'files'];
const STORAGE_GROUP_DIRECTORY_GRANTS = ['view_groups', 'manage_groups', 'manage_group', 'groups'];
const STORAGE_USER_DIRECTORY_GRANTS = ['users', 'view_users', 'manage_users'];

function storageRelation(kind: 'group' | 'user', id: number | null): Record<string, unknown> | null {
    if (id == null) return null;
    if (kind === 'group') {
        const row = db.groups.find((candidate) => candidate.id === id);
        return row ? { id: row.id, name: row.name } : null;
    }
    const row = db.users.find((candidate) => candidate.id === id);
    return row ? { id: row.id, name: row.display_name, display_name: row.display_name, email: row.email } : null;
}

function serializeStorageManager(row: MockFileManager): Record<string, unknown> {
    return {
        id: row.id, created: row.created, name: row.name, use: row.use,
        backend_type: row.backend_type, backend_url: row.backend_url,
        is_active: row.is_active, is_default: row.is_default, is_public: row.is_public,
        aws_region: row.aws_region, aws_key_masked: row.aws_key_masked,
        aws_secret_masked: row.aws_secret_masked, allowed_origins: [...row.allowed_origins],
        assume_role_arn: row.assume_role_arn, has_external_id: row.has_external_id,
        group: storageRelation('group', row.group), user: storageRelation('user', row.user),
    };
}

function serializeStorageRendition(row: MockStorageRendition): Record<string, unknown> {
    return {
        id: row.id, created: row.created, modified: row.modified, filename: row.filename,
        file_size: row.file_size, content_type: row.content_type, category: row.category,
        role: row.role, upload_status: row.upload_status,
        ...(row.width == null ? {} : { width: row.width }), ...(row.height == null ? {} : { height: row.height }),
        url: row.url,
    };
}

function serializeStorageFile(row: MockStorageFile): Record<string, unknown> {
    const renditions: Record<string, unknown> = {};
    for (const rendition of db.fileRenditions.filter((candidate) => candidate.original_file === row.id)) {
        renditions[rendition.role] = serializeStorageRendition(rendition);
    }
    return {
        id: row.id, created: row.created, modified: row.modified, filename: row.filename,
        file_size: row.file_size, content_type: row.content_type, category: row.category,
        upload_status: row.upload_status, is_active: row.is_active, is_public: row.is_public,
        group: storageRelation('group', row.group), user: storageRelation('user', row.user),
        file_manager: (() => {
            const manager = db.fileManagers.find((candidate) => candidate.id === row.file_manager);
            return manager ? { id: manager.id, name: manager.name } : null;
        })(),
        metadata: { ...row.metadata }, url: row.url,
        thumbnail: (renditions.thumbnail as Record<string, unknown> | undefined)?.url ?? null,
        renditions,
    };
}

function serializeStorageShare(row: MockStorageShare): Record<string, unknown> {
    return {
        id: row.id, code: row.code, url: row.url, source: row.source, hit_count: row.hit_count,
        expires_at: row.expires_at, is_active: row.is_active, track_clicks: row.track_clicks,
        metadata: { ...row.metadata }, created: row.created, modified: row.modified,
        user: storageRelation('user', row.user), group: storageRelation('group', row.group),
    };
}

function maskStorageCredential(value: unknown, prefix = ''): string | null {
    if (typeof value !== 'string' || value.trim() === '') return null;
    const clean = value.trim();
    return `${prefix}${'•'.repeat(8)}${clean.slice(-3)}`;
}

function storageIncomplete(bucket: MockStorageBucket, action: 'create' | 'empty' | 'set_public', extra: Record<string, unknown> = {}) {
    return {
        status: false, code: 409, error: `S3 bucket ${action} did not reach a verified state`,
        error_code: 's3_operation_incomplete',
        data: {
            name: bucket.name, action, complete: false, mutation_state: 'partial',
            ...(action === 'empty' ? {
                counts: { deleted_objects: 2, deleted_versions: 1, deleted_markers: 0, aborted_uploads: 0 },
                failed: { objects: 0, versions: 1, markers: 0, uploads: 0 },
                remaining: { objects: null, versions: null, markers: null, uploads: null },
            } : {}),
            failure: { operation: action === 'empty' ? 'delete_objects' : 'put_public_access_block', provider_code: 'AccessDenied', retryable: false },
            ...extra,
        },
    };
}

function completeMockRendition(file: MockStorageFile, role: string): void {
    const now = Math.floor(Date.now() / 1000);
    const existing = db.fileRenditions.find((row) => row.original_file === file.id && row.role === role);
    if (existing) {
        existing.modified = Math.max(existing.modified + 1, now);
        existing.upload_status = 'completed';
        return;
    }
    db.fileRenditions.push({
        id: Math.max(6100, ...db.fileRenditions.map((row) => row.id)) + 1,
        original_file: file.id, created: now, modified: now,
        filename: `${file.filename}-${role}.jpg`, file_size: 64000,
        content_type: 'image/jpeg', category: 'image', role, upload_status: 'completed',
        width: role === 'thumbnail' ? 320 : 1280, height: role === 'thumbnail' ? 180 : 720,
        url: `/mock-storage/renditions/${file.id}-${role}`,
    });
}

/** Renderer work becomes observable only through later authoritative detail GETs. */
function advanceMockRenditionLifecycle(file: MockStorageFile): void {
    if (file.rendition_demo === 'initial') {
        file.rendition_reads = (file.rendition_reads ?? 0) + 1;
        if (file.rendition_reads >= 2) {
            completeMockRendition(file, 'thumbnail');
            completeMockRendition(file, 'preview');
            file.rendition_demo = undefined;
        }
    }
    const job = db.storageRenditionJobs.get(file.id);
    if (!job) return;
    job.detailGets += 1;
    if (job.detailGets < 2) return;
    if (job.finalStatus === 'completed') {
        for (const role of job.roles) completeMockRendition(file, role);
    } else {
        file.upload_status = job.finalStatus;
        file.modified = Math.max(file.modified + 1, Math.floor(Date.now() / 1000));
    }
    db.storageRenditionJobs.delete(file.id);
}

function storageFetch(path: string, opts: MockFetchOpts): Record<string, unknown> | undefined {
    if (!path.startsWith('/api/aws/s3/bucket')
        && !path.startsWith('/api/fileman/manager')
        && !path.startsWith('/api/fileman/file')
        && !path.startsWith('/api/shortlink/link')) return undefined;
    const caller = userFromBearer(opts.headers);
    if (!caller) return permissionDenied(401);
    const method = (opts.method ?? 'GET').toUpperCase();

    const bucketMatch = path.match(/^\/api\/aws\/s3\/bucket(?:\/(.+))?$/);
    if (bucketMatch) {
        if (!hasGlobalPermission(caller, STORAGE_BUCKET_GRANTS)) return permissionDenied();
        if (method === 'DELETE') return { status: false, code: 405, error: 'S3 bucket method is not supported', error_code: 'method_not_allowed' };
        const name = bucketMatch[1] == null ? null : decodeURIComponent(bucketMatch[1]);
        if (method === 'GET') {
            if (opts.params?.__mock_error === 'work_limit') {
                return { status: false, code: 503, error: 'S3 bucket inventory reached its work limit', error_code: 'work_limit', data: { complete: false, mutation_state: 'none', failure: { operation: 'list_buckets', provider_code: 'WorkLimit', retryable: true } } };
            }
            if (name == null) {
                const data = db.storageBuckets.map(({ id, name: bucketName, created }) => ({ id, name: bucketName, created }));
                return { status: true, code: 200, data, count: data.length, size: data.length };
            }
            const bucket = db.storageBuckets.find((candidate) => candidate.name === name);
            return bucket ? { status: true, code: 200, data: { id: bucket.id, name: bucket.name, exists: true } }
                : { status: false, code: 404, error: 'S3 bucket was not found', error_code: 's3_not_found' };
        }
        if (method !== 'POST' || name == null) return { status: false, code: 400, error: 'Bucket name is required', error_code: 'invalid_request' };
        const body = opts.body ?? {};
        const keys = Object.keys(body);
        if (keys.some((key) => !['set_public', 'empty'].includes(key)) || ('set_public' in body && 'empty' in body)) {
            return { status: false, code: 400, error: 'Unknown S3 bucket action', error_code: 'invalid_request' };
        }
        let bucket = db.storageBuckets.find((candidate) => candidate.name === name);
        if (!('set_public' in body) && !('empty' in body)) {
            const createdNew = !bucket;
            if (!bucket) {
                const now = Math.floor(Date.now() / 1000);
                bucket = { id: name, name, created: now, is_public: false, objects: 0, versions: 0, markers: 0, uploads: 0 };
                db.storageBuckets.push(bucket);
            }
            if (createdNew && name === 'mojo-create-incomplete-demo') {
                return storageIncomplete(bucket, 'create', { created_new: true, requested_public: false, configured_public: null, safety_lock: 'applied' });
            }
            return { status: true, code: 200, data: { id: name, name, created_new: createdNew } };
        }
        if (!bucket) return { status: false, code: 404, error: 'S3 bucket was not found', error_code: 's3_not_found' };
        if ('set_public' in body) {
            if (typeof body.set_public !== 'boolean') return { status: false, code: 400, error: 'set_public must be a boolean', error_code: 'invalid_request' };
            if (bucket.incompleteMode === 'access') {
                return storageIncomplete(bucket, 'set_public', { requested_public: body.set_public, is_public: null, configured_public: null, safety_lock: 'applied' });
            }
            bucket.is_public = body.set_public;
            return { status: true, code: 200, data: { name, is_public: bucket.is_public, configured_public: bucket.is_public, complete: true, mutation_state: 'complete' } };
        }
        const empty = body.empty;
        if (!isPlainObject(empty) || Object.keys(empty).length !== 1 || empty.confirm_name !== name) {
            return { status: false, code: 400, error: 'empty confirm_name must exactly match the bucket name', error_code: 'invalid_request' };
        }
        if (bucket.incompleteMode === 'empty') {
            bucket.objects = Math.max(0, bucket.objects - 2);
            bucket.versions = Math.max(0, bucket.versions - 1);
            return storageIncomplete(bucket, 'empty');
        }
        const result = { name, complete: true, mutation_state: 'complete', deleted_objects: bucket.objects, deleted_versions: bucket.versions, deleted_markers: bucket.markers, aborted_uploads: bucket.uploads };
        bucket.objects = 0; bucket.versions = 0; bucket.markers = 0; bucket.uploads = 0;
        return { status: true, code: 200, data: result };
    }

    const managerMatch = path.match(/^\/api\/fileman\/manager(?:\/(\d+))?$/);
    if (managerMatch) {
        if (!hasGlobalPermission(caller, STORAGE_VIEW_GRANTS)) return permissionDenied();
        const id = managerMatch[1] == null ? null : Number(managerMatch[1]);
        const manager = id == null ? null : db.fileManagers.find((candidate) => candidate.id === id);
        if (id != null && !manager) return { status: false, error: 'FileManager not found', error_code: 404 };
        if (method === 'DELETE') return { status: false, code: 405, error: 'FileManager deletion is unavailable', error_code: 'method_not_allowed' };
        if (method === 'GET' && manager) return { status: true, data: serializeStorageManager(manager), graph: 'default' };
        if (method === 'GET') {
            const serialized = db.fileManagers.map(serializeStorageManager);
            const result = listRows(serialized, opts.params ?? {}, (row) => `${row.name} ${row.backend_type} ${row.backend_url}`, '-created');
            return { ...result, graph: 'list' };
        }
        if (method !== 'POST' || !hasGlobalPermission(caller, STORAGE_MANAGE_GRANTS)) return permissionDenied();
        const body = opts.body ?? {};
        for (const action of ['test_connection', 'check_cors', 'fix_cors', 'clone'] as const) {
            if (!(action in body)) continue;
            if (!manager) return { status: false, error: 'FileManager not found', error_code: 404 };
            if ((action === 'check_cors' || action === 'fix_cors') && manager.backend_type !== 's3') return { status: true, data: { status: false, error: 'CORS management is only supported for S3 backends.' } };
            if (action === 'clone') {
                const clone = { ...manager, id: Math.max(...db.fileManagers.map((row) => row.id)) + 1, created: Math.floor(Date.now() / 1000), name: `Clone of ${manager.name}`, is_default: false };
                db.fileManagers.push(clone);
                return { status: true, data: { status: true, id: clone.id } };
            }
            return { status: true, data: { status: true, ...(action === 'test_connection' ? {} : { result: { ok: true, origins: [...manager.allowed_origins] } }) } };
        }
        if (!manager) {
            const requestedGroup = body.group == null ? null : Number(body.group);
            const requestedUser = body.user == null ? null : Number(body.user);
            if (requestedGroup == null && requestedUser == null && !caller.is_superuser) return permissionDenied();
            if (requestedGroup != null && !hasGlobalPermission(caller, STORAGE_GROUP_DIRECTORY_GRANTS)) return permissionDenied();
            if (requestedUser != null && !hasGlobalPermission(caller, STORAGE_USER_DIRECTORY_GRANTS)) return permissionDenied();
        }
        const target = manager ?? (() => {
            const backendType = String(body.backend_type ?? 'file');
            if (!['file', 's3'].includes(backendType)) return null;
            const created: MockFileManager = { id: Math.max(...db.fileManagers.map((row) => row.id)) + 1, created: Math.floor(Date.now() / 1000), name: String(body.name ?? 'Storage backend'), use: String(body.use ?? 'uploads'), backend_type: backendType, backend_url: String(body.backend_url ?? ''), is_active: body.is_active == null ? true : Boolean(body.is_active), is_default: Boolean(body.is_default), is_public: false, aws_region: null, aws_key_masked: null, aws_secret_masked: null, allowed_origins: [], assume_role_arn: null, has_external_id: false, group: body.group == null ? null : Number(body.group), user: body.user == null ? null : Number(body.user) };
            db.fileManagers.push(created);
            return created;
        })();
        if (!target) return { status: false, error: 'Unsupported storage backend', error_code: 400 };
        if ('name' in body) target.name = String(body.name ?? '');
        if ('use' in body) target.use = String(body.use ?? '');
        if ('backend_url' in body) target.backend_url = String(body.backend_url ?? '');
        if ('aws_region' in body) target.aws_region = body.aws_region == null ? null : String(body.aws_region);
        if ('assume_role_arn' in body) target.assume_role_arn = body.assume_role_arn == null ? null : String(body.assume_role_arn);
        for (const field of ['is_active', 'is_default', 'is_public'] as const) if (field in body) target[field] = Boolean(body[field]);
        if (Array.isArray(body.allowed_origins)) target.allowed_origins = body.allowed_origins.map(String);
        if (body.aws_key != null) target.aws_key_masked = maskStorageCredential(body.aws_key, 'AKIA');
        if (body.aws_secret != null) target.aws_secret_masked = maskStorageCredential(body.aws_secret);
        if ('group' in body && hasGlobalPermission(caller, STORAGE_GROUP_DIRECTORY_GRANTS)) target.group = body.group == null ? null : Number(body.group);
        if ('user' in body && hasGlobalPermission(caller, STORAGE_USER_DIRECTORY_GRANTS)) target.user = body.user == null ? null : Number(body.user);
        return { status: true, data: serializeStorageManager(target), graph: 'default' };
    }

    const fileMatch = path.match(/^\/api\/fileman\/file(?:\/(\d+))?$/);
    if (fileMatch) {
        if (!hasGlobalPermission(caller, STORAGE_VIEW_GRANTS)) return permissionDenied();
        const id = fileMatch[1] == null ? null : Number(fileMatch[1]);
        const file = id == null ? null : db.storageFiles.find((candidate) => candidate.id === id);
        if (id != null && !file) return { status: false, error: 'File not found', error_code: 404 };
        if (method === 'GET' && file) {
            advanceMockRenditionLifecycle(file);
            return { status: true, data: serializeStorageFile(file), graph: 'default' };
        }
        if (method === 'GET') {
            const serialized = db.storageFiles.map(serializeStorageFile);
            const result = listRows(serialized, opts.params ?? {}, (row) => `${row.filename} ${row.content_type}`, '-created');
            return { ...result, graph: 'list' };
        }
        if (!hasGlobalPermission(caller, STORAGE_MANAGE_GRANTS)) return permissionDenied();
        if (method === 'DELETE' && file) {
            db.storageFiles = db.storageFiles.filter((candidate) => candidate.id !== file.id);
            db.fileRenditions = db.fileRenditions.filter((candidate) => candidate.original_file !== file.id);
            for (const share of db.storageShares.filter((candidate) => candidate.file === file.id)) share.is_active = false;
            return { status: 'deleted' } as unknown as Record<string, unknown>;
        }
        if (method !== 'POST' || !file) return { status: false, error: 'File creation/upload is unavailable', error_code: 405 };
        const body = opts.body ?? {};
        if ('regenerate_renditions' in body) {
            const roles = Array.isArray(body.regenerate_renditions) ? [...new Set(body.regenerate_renditions.map(String).filter(Boolean))].slice(0, 20) : null;
            const existingRoles = db.fileRenditions.filter((row) => row.original_file === file.id).map((row) => row.role);
            const wanted = roles ?? (existingRoles.length > 0 ? existingRoles : ['thumbnail', 'preview']);
            const finalStatus = file.rendition_demo === 'failed' ? 'failed' : file.rendition_demo === 'expired' ? 'expired' : 'completed';
            db.storageRenditionJobs.set(file.id, { roles: wanted, detailGets: 0, finalStatus });
            return { status: true, data: { queued: true, roles } };
        }
        if ('share' in body) {
            const options = isPlainObject(body.share) ? body.share : {};
            const now = Math.floor(Date.now() / 1000);
            const days = Math.max(0, Math.min(3650, Number(options.expire_days ?? 30)));
            const id = Math.max(0, ...db.storageShares.map((row) => row.id)) + 1;
            const code = `share${id}`;
            const share: MockStorageShare = { id, code, url: `/s/${code}`, source: 'fileman-share', hit_count: 0, expires_at: days > 0 ? now + days * 86400 : null, is_active: true, track_clicks: Boolean(options.track_clicks), metadata: { note: String(options.note ?? '').slice(0, 512) }, created: now, modified: now, user: caller.id, group: file.group, file: file.id };
            db.storageShares.push(share);
            return { status: true, data: { url: share.url, code, expires_at: share.expires_at, track_clicks: share.track_clicks } };
        }
        if ('filename' in body) file.filename = String(body.filename);
        if ('is_public' in body) file.is_public = Boolean(body.is_public);
        if ('group' in body && hasGlobalPermission(caller, STORAGE_GROUP_DIRECTORY_GRANTS)) file.group = body.group == null ? null : Number(body.group);
        file.modified = Math.floor(Date.now() / 1000);
        return { status: true, data: serializeStorageFile(file), graph: 'default' };
    }

    const shareMatch = path.match(/^\/api\/shortlink\/link(?:\/(\d+))?$/);
    if (shareMatch) {
        const id = shareMatch[1] == null ? null : Number(shareMatch[1]);
        const canManageAll = hasGlobalPermission(caller, ['manage_shortlinks']);
        const requestedFile = opts.params?.file == null ? null : Number(opts.params.file);
        const requestedSource = opts.params?.source == null ? null : String(opts.params.source);
        const visible = db.storageShares.filter((row) => (canManageAll || row.user === caller.id)
            && (requestedFile == null || row.file === requestedFile)
            && (requestedSource == null || row.source === requestedSource));
        if (id != null) {
            const share = visible.find((row) => row.id === id);
            if (!share) return permissionDenied();
            if (method === 'DELETE') return { status: false, error: 'Visible shares are retained for audit', error_code: 405 };
            if (method === 'POST' && opts.body && opts.body.is_active === false) { share.is_active = false; share.modified = Math.floor(Date.now() / 1000); }
            return { status: true, data: serializeStorageShare(share), graph: 'default' };
        }
        const serialized = visible.map(serializeStorageShare);
        const params = { ...(opts.params ?? {}) };
        delete params.file;
        delete params.source;
        const result = listRows(serialized, params, (row) => `${row.code} ${row.source}`, '-created');
        return { ...result, graph: 'default' };
    }
    return undefined;
}

const METRICS_VIEW_GRANTS = ['view_metrics', 'metrics'];

/** Shared live account-policy gate for every mock metrics read surface. */
function canViewMetricsAccount(user: MockUser | undefined, account: string): boolean {
    if (account === 'public') return true;
    if (account === 'global') return hasGlobalPermission(user, METRICS_VIEW_GRANTS);
    if (account.startsWith('group-')) {
        const suffix = account.slice('group-'.length);
        if (!/^[1-9]\d*$/.test(suffix)) return false;
        const groupId = Number(suffix);
        if (!db.groups.some((group) => group.id === groupId) || !user) return false;
        if (hasGlobalPermission(user, METRICS_VIEW_GRANTS)) return true;
        const member = db.members.find((row) => row.group === groupId && row.user === user.id && row.is_active);
        return Boolean(member && ['view_metrics', 'metrics'].some((permission) => Boolean(member.permissions[permission])));
    }
    if (account.startsWith('user-')) {
        const suffix = account.slice('user-'.length);
        if (!/^[1-9]\d*$/.test(suffix) || !user) return false;
        return hasGlobalPermission(user, METRICS_VIEW_GRANTS) || user.id === Number(suffix);
    }
    const policy = METRIC_ACCOUNT_VIEW_POLICY[account];
    if (policy === 'public') return true;
    return Array.isArray(policy) && hasGlobalPermission(user, policy);
}

function metricsAccountCategories(account: string): Record<string, string[]> {
    return METRIC_ACCOUNT_CATEGORIES[account] ?? {};
}

function metricsAccountSlugs(account: string, category?: string | null): string[] {
    const categories = metricsAccountCategories(account);
    return category == null
        ? Object.values(categories).flat()
        : [...(categories[category] ?? [])];
}

function groupCanManage(user: MockUser | undefined, groupId: number): boolean {
    if (!user) return false;
    if (user.is_superuser || hasGlobalPermission(user, ['manage_groups', 'groups'])) return true;
    const member = db.members.find((row) => row.group === groupId && row.user === user.id && row.is_active);
    if (member && ['admin', 'manage_group', 'manage_members'].some((permission) => Boolean(member.permissions[permission]))) return true;
    // Same deterministic group-context identity as /api/group/<id>/member.
    return user.id === 1 && groupId % 2 === 1;
}

function groupCanRead(user: MockUser | undefined, groupId: number): boolean {
    if (!user) return false;
    if (hasGlobalPermission(user, ['view_groups', 'manage_groups', 'manage_group', 'groups'])) return true;
    const member = db.members.find((row) => row.group === groupId && row.user === user.id && row.is_active);
    if (member) return true;
    return user.id === 1 && groupId % 2 === 1;
}

function groupCanInvite(user: MockUser | undefined, groupId: number): boolean {
    return hasGlobalPermission(user, ['manage_users', 'manage_members', 'manage_group', 'manage_groups'])
        || groupCanManage(user, groupId);
}

function groupCanReadMembers(user: MockUser | undefined, groupId: number): boolean {
    if (!user) return false;
    if (hasGlobalPermission(user, ['view_members', 'view_groups', 'manage_groups', 'manage_group', 'groups'])) return true;
    const member = db.members.find((row) => row.group === groupId && row.user === user.id && row.is_active);
    if (member && ['admin', 'view_members', 'manage_group', 'manage_members', 'groups'].some((permission) => Boolean(member.permissions[permission]))) return true;
    return user.id === 1 && groupId % 2 === 1;
}

function canReadGlobalMembers(user: MockUser | undefined): boolean {
    return hasGlobalPermission(user, ['view_members', 'view_groups', 'manage_groups', 'manage_group', 'groups']);
}

function canReadUserDirectory(user: MockUser | undefined): boolean {
    return hasGlobalPermission(user, ['view_users', 'manage_users', 'users']);
}

function requestGroupId(opts: MockFetchOpts): number {
    return Number(opts.body?.group ?? opts.params?.group ?? 0);
}

const DNS_VIEW_GRANTS = ['view_dns', 'manage_dns', 'security'];
const DNS_MANAGE_GRANTS = ['manage_dns', 'security'];

function dnsMemberCan(user: MockUser | undefined, groupId: number, manage: boolean): boolean {
    if (!user) return false;
    if (hasGlobalPermission(user, manage ? DNS_MANAGE_GRANTS : DNS_VIEW_GRANTS)) return true;
    const member = db.members.find((row) => row.group === groupId && row.user === user.id && row.is_active);
    if (!member) return false;
    const grants = manage ? ['admin', 'manage_dns'] : ['admin', 'view_dns', 'manage_dns'];
    return grants.some((permission) => Boolean(member.permissions[permission]));
}

function dnsCollectionCan(user: MockUser | undefined, opts: MockFetchOpts, manage = false): boolean {
    const groupId = requestGroupId(opts);
    return groupId > 0
        ? dnsMemberCan(user, groupId, manage)
        : hasGlobalPermission(user, manage ? DNS_MANAGE_GRANTS : DNS_VIEW_GRANTS);
}

function permissionDenied(code = 403): Record<string, unknown> {
    return { status: false, error: 'permission denied', error_code: code };
}

// ══ Jobs engine — wire implementation ════════════════════════════════

/** `requires_global_perms('view_jobs','manage_jobs','jobs')`. */
const JOBS_VIEW_GRANTS = ['view_jobs', 'manage_jobs', 'jobs'];
/** `requires_global_perms('manage_jobs','jobs')` — every write control. */
const JOBS_MANAGE_GRANTS = ['manage_jobs', 'jobs'];
/** ScheduledTask/TaskResult VIEW_PERMS minus the `owner` fallback. */
const SCHEDULED_TASK_VIEW_GRANTS = ['jobs', 'view_scheduled_tasks'];
/** ScheduledTask SAVE/DELETE_PERMS minus `owner`. */
const SCHEDULED_TASK_MANAGE_GRANTS = ['jobs', 'manage_scheduled_tasks'];

/** `missing required parameters: …` — decorators/validate.py, code+status 400. */
function missingParams(...names: string[]): Record<string, unknown> {
    return { status: false, error: `missing required parameters: ${names.join(', ')}`, error_code: 400 };
}

function jobsBadRequest(error: string): Record<string, unknown> {
    return { status: false, error, error_code: 400 };
}

/**
 * Python truthiness, which is NOT JavaScript's. `{}` and `[]` are falsy in
 * Python — that is precisely why `POST /api/jobs/job/<id>` with
 * `{cancel_request: {}}` answers "cancel_request must be true" while the same
 * body looks like a valid request from JS.
 */
function pyTruthy(value: unknown): boolean {
    if (value == null || value === false || value === 0 || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
    return Boolean(value);
}

type JobsFilterParse = { ok: true; params: Params } | { ok: false; error: Record<string, unknown> };

const JOBS_FILTER_RESERVED = new Set([
    'start', 'size', 'sort', 'search', 'graph', 'dr_field', 'dr_start', 'dr_end',
    'download_format', 'filename', 'limit', 'offset',
]);

/**
 * Reproduce `mojo/models/rest.py build_rest_filters` field resolution, which
 * has THREE outcomes and only one of them is "filter":
 *
 *   · the key names a model field           → it filters;
 *   · the key names a Django FK ATTNAME
 *     (`job_id` for a `job` FK)             → `hasattr(cls, 'job_id')` is
 *     True, so the parser accepts it, but `get_model_field('job_id')` returns
 *     None and `normalize_rest_value` immediately dereferences it →
 *     AttributeError. NOT a benign unfiltered list: a server error;
 *   · anything else (e.g. `runner_id` on
 *     JobLog, which has no such field)      → SILENTLY DROPPED, so the
 *     response is the UNFILTERED list. web-mojo shipped
 *     `/api/jobs/logs?runner_id=…` and presented the whole log table as one
 *     runner's logs.
 *
 * Encoding all three is the point of the mock: a caller cannot discover the
 * difference from a summary.
 */
function jobsFilterParams(params: Params, fields: Set<string>, attnames: Set<string>): JobsFilterParse {
    const out: Params = {};
    for (const [key, value] of Object.entries(params)) {
        if (JOBS_FILTER_RESERVED.has(key)) { out[key] = value; continue; }
        if (key.startsWith('_')) continue;
        const field = key.split('__')[0]!;
        if (fields.has(field)) { out[key] = value; continue; }
        if (attnames.has(field)) {
            return {
                ok: false,
                error: {
                    status: false,
                    error: "'NoneType' object has no attribute 'get_internal_type'",
                    error_code: 500,
                },
            };
        }
        // hasattr(cls, field) is False → the key never becomes a filter.
    }
    return { ok: true, params: out };
}

const JOB_FIELDS = new Set([
    'id', 'channel', 'func', 'payload', 'status', 'run_at', 'expires_at', 'attempt',
    'max_retries', 'backoff_base', 'backoff_max_sec', 'broadcast', 'cancel_requested',
    'max_exec_seconds', 'runner_id', 'last_error', 'stack_trace', 'metadata',
    'created', 'modified', 'started_at', 'finished_at', 'idempotency_key',
    'events', 'logs', 'task_results',
]);
const JOB_EVENT_FIELDS = new Set(['id', 'job', 'channel', 'event', 'at', 'runner_id', 'attempt', 'details', 'created', 'modified']);
const JOB_EVENT_ATTNAMES = new Set(['job_id']);
const JOB_LOG_FIELDS = new Set(['id', 'job', 'channel', 'created', 'modified', 'kind', 'message', 'meta']);
const JOB_LOG_ATTNAMES = new Set(['job_id']);
const SCHEDULED_TASK_FIELDS = new Set([
    'id', 'user', 'name', 'description', 'enabled', 'run_once', 'task_type', 'run_times',
    'run_days', 'job_config', 'notify', 'channel', 'max_retries', 'last_run', 'run_count',
    'last_error', 'created', 'modified', 'results',
]);
const SCHEDULED_TASK_ATTNAMES = new Set(['user_id']);
const TASK_RESULT_FIELDS = new Set(['id', 'task', 'user', 'job', 'status', 'output', 'error', 'created']);
const TASK_RESULT_ATTNAMES = new Set(['task_id', 'user_id', 'job_id']);

// ── Serializers ───────────────────────────────────────────────────────

const JOB_DEFAULT_FIELDS = [
    'id', 'channel', 'func', 'payload', 'status', 'run_at', 'expires_at', 'attempt',
    'max_retries', 'broadcast', 'cancel_requested', 'max_exec_seconds', 'runner_id',
    'last_error', 'metadata', 'created', 'modified', 'started_at', 'finished_at',
];
const JOB_STATUS_GRAPH_FIELDS = ['id', 'status', 'runner_id', 'attempt', 'started_at', 'finished_at', 'last_error'];

/** Job.duration_ms — 0 unless BOTH start and finish are recorded. */
function jobDurationMs(job: MockJob): number {
    if (job.started_at != null && job.finished_at != null) {
        return Math.max(0, (job.finished_at - job.started_at) * 1000);
    }
    return 0;
}

function serializeJob(job: MockJob, graph: string): Record<string, unknown> {
    const source = job as unknown as Record<string, unknown>;
    if (graph === 'status') {
        return Object.fromEntries(JOB_STATUS_GRAPH_FIELDS.map((field) => [field, source[field]]));
    }
    if (graph === 'admin') {
        // `__all__` MINUS stack_trace, and no duration_ms — the admin graph
        // declares no `extra`. There is no `is_retriable` in any graph either;
        // retriability is computed client-side from the service rule.
        const { stack_trace: _omitted, ...rest } = job;
        return { ...rest };
    }
    return {
        ...Object.fromEntries(JOB_DEFAULT_FIELDS.map((field) => [field, source[field]])),
        duration_ms: jobDurationMs(job),
    };
}

function serializeJobEvent(row: MockJobEvent, graph: string): Record<string, unknown> {
    // The `timeline` graph carries NO id — the field list is exactly
    // {event, at, runner_id, details}.
    if (graph === 'timeline') {
        return { event: row.event, at: row.at, runner_id: row.runner_id, details: row.details };
    }
    if (graph === 'detail') {
        return {
            id: row.id, job_id: row.job, channel: row.channel, event: row.event,
            at: row.at, runner_id: row.runner_id, attempt: row.attempt, details: row.details,
        };
    }
    return {
        id: row.id, event: row.event, at: row.at,
        runner_id: row.runner_id, attempt: row.attempt, details: row.details,
    };
}

function serializeJobLog(row: MockJobLog, graph: string): Record<string, unknown> {
    if (graph === 'detail') {
        return {
            id: row.id, job_id: row.job, channel: row.channel, created: row.created,
            kind: row.kind, message: row.message, meta: row.meta,
        };
    }
    return { id: row.id, job_id: row.job, created: row.created, kind: row.kind, message: row.message };
}

const TASK_DEFAULT_FIELDS = [
    'id', 'name', 'description', 'enabled', 'run_once', 'task_type', 'run_times',
    'run_days', 'job_config', 'notify', 'channel', 'max_retries', 'last_run',
    'run_count', 'last_error', 'created', 'modified',
];
const TASK_LIST_FIELDS = [
    'id', 'name', 'enabled', 'run_once', 'task_type', 'run_times', 'run_days',
    'last_run', 'run_count', 'created',
];

function serializeScheduledTask(row: MockScheduledTask, graph: string): Record<string, unknown> {
    const source = row as unknown as Record<string, unknown>;
    const fields = graph === 'list' ? TASK_LIST_FIELDS : TASK_DEFAULT_FIELDS;
    return Object.fromEntries(fields.map((field) => [field, source[field]]));
}

function serializeTaskResult(row: MockTaskResult, graph: string): Record<string, unknown> {
    if (graph === 'list') return { id: row.id, task_id: row.task, status: row.status, created: row.created };
    return {
        id: row.id, task_id: row.task, job_id: row.job, status: row.status,
        output: row.output, error: row.error, created: row.created,
    };
}

// ── Runners ───────────────────────────────────────────────────────────

/**
 * One heartbeat row. `alive` is derived from the heartbeat AGE exactly as
 * manager.get_runners does (`age < JOBS_RUNNER_HEARTBEAT_SEC * 3`), and the
 * timestamps are ISO strings because this payload is raw Redis JSON that
 * never passes through the mojo serializer.
 */
function serializeRunner(runner: MockRunner, nowMs: number): Record<string, unknown> {
    return {
        runner_id: runner.runner_id,
        hostname: runner.hostname,
        channels: [...runner.channels],
        jobs_processed: runner.jobs_processed,
        jobs_failed: runner.jobs_failed,
        started: new Date(nowMs - runner.uptime_sec * 1000).toISOString(),
        last_heartbeat: new Date(nowMs - runner.heartbeat_age_sec * 1000).toISOString(),
        alive: runner.heartbeat_age_sec < JOBS_HEARTBEAT_SEC * 3,
    };
}

function jobsRunnerList(channel: string | null, nowMs: number): Record<string, unknown>[] {
    return db.jobRunners
        .filter((runner) => !channel || runner.channels.includes(channel))
        .map((runner) => serializeRunner(runner, nowMs))
        .sort((a, b) => String(a.runner_id).localeCompare(String(b.runner_id)));
}

function aliveRunnerIds(nowMs: number): Set<string> {
    return new Set(
        jobsRunnerList(null, nowMs)
            .filter((runner) => runner.alive === true)
            .map((runner) => String(runner.runner_id)),
    );
}

/**
 * Sysinfo replies, one per state the System section must render distinctly:
 * a healthy host, a runner whose collector FAILED (inner `status: 'error'`
 * inside a successful envelope), and a runner that never answers at all
 * (`get_sysinfo` returns [] → the single-runner route 404s).
 */
function runnerSysinfoReply(runnerId: string): Record<string, unknown> | null {
    const func = 'mojo.apps.jobs.services.sysinfo_task.collect_sysinfo';
    const timestamp = new Date().toISOString();
    if (runnerId === 'runner-mojo-web-01-engine') {
        return {
            runner_id: runnerId,
            func,
            status: 'success',
            timestamp,
            result: {
                time: Date.now() / 1000,
                datetime: timestamp,
                os: {
                    system: 'Linux', version: '#1 SMP Debian 6.1.99-1', hostname: 'mojo-web-01.internal',
                    release: '6.1.0-23-amd64', processor: '', machine: 'x86_64',
                },
                boot_time: Math.floor(Date.now() / 1000) - 9 * 86400,
                cpu_load: 37.4,
                cpus_load: [41.2, 33.8, 39.1, 35.5],
                memory: { total: 16_777_216_000, used: 9_965_666_304, available: 6_811_549_696, percent: 59.4 },
                disk: { total: 214_748_364_800, used: 178_257_920_000, free: 36_490_444_800, percent: 83.0 },
                cpu: { count: 4, freq: { current: 2400, min: 800, max: 3600 } },
                network: {
                    tcp_cons: 184, bytes_sent: 88_231_997_440, bytes_recv: 145_009_213_440,
                    packets_sent: 412_884_101, packets_recv: 508_112_774,
                    errin: 0, errout: 0, dropin: 0, dropout: 0,
                },
                users: [],
            },
        };
    }
    if (runnerId === 'runner-mojo-web-02-engine') {
        // get_host_info raises when psutil is missing; broadcast_execute turns
        // the raise into an error REPLY, not an HTTP failure.
        return {
            runner_id: runnerId,
            func,
            status: 'error',
            timestamp,
            error: 'psutil is not installed. Install it with: pip install psutil',
        };
    }
    return null;
}

// ── Stats ─────────────────────────────────────────────────────────────

/**
 * `GET /api/jobs/stats`, derived live from the fixture rows so a cancel, retry
 * or purge moves the dashboard. Redis counts have DB analogues here: queued =
 * pending with no run_at, in-flight = running, scheduled = pending with a
 * run_at.
 */
function jobsStats(): Record<string, unknown> {
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const lastHour = nowSec - 3600;
    const alive = aliveRunnerIds(nowMs);
    const channels: Record<string, unknown> = {};
    const totals = {
        pending: 0, queued: 0, inflight: 0, running: 0, running_active: 0, running_stale: 0,
        completed: 0, failed: 0, scheduled: 0, runners_active: alive.size,
    };

    for (const channel of JOBS_CHANNELS) {
        const rows = db.jobs.filter((job) => job.channel === channel);
        const queued = rows.filter((job) => job.status === 'pending' && job.run_at == null).length;
        const scheduled = rows.filter((job) => job.status === 'pending' && job.run_at != null).length;
        const inflight = rows.filter((job) => job.status === 'running').length;
        const completedHour = rows.filter((job) => job.status === 'completed' && (job.finished_at ?? 0) >= lastHour);
        const failedHour = rows.filter((job) => job.status === 'failed' && (job.finished_at ?? 0) >= lastHour);
        const finished = completedHour.length + failedHour.length;
        const durations = completedHour.map((job) => jobDurationMs(job)).filter((ms) => ms > 0);
        channels[channel] = {
            channel,
            queued_count: queued,
            inflight_count: inflight,
            scheduled_count: scheduled,
            runners: jobsRunnerList(channel, nowMs).filter((runner) => runner.alive === true).length,
            metrics: {
                jobs_per_minute: finished > 0 ? Math.round((finished / 60) * 100) / 100 : 0,
                success_rate: finished > 0 ? Math.round((completedHour.length / finished) * 1000) / 10 : 0,
                avg_duration_ms: durations.length > 0
                    ? Math.round(durations.reduce((sum, ms) => sum + ms, 0) / durations.length)
                    : 0,
            },
            db_running: inflight,
        };
        totals.queued += queued;
        // The backend keeps `pending` as a backwards-compatible alias of
        // `queued` — not a DB count of status='pending'.
        totals.pending += queued;
        totals.inflight += inflight;
        totals.scheduled += scheduled;
    }

    const running = db.jobs.filter((job) => job.status === 'running');
    totals.running = running.length;
    totals.running_active = running.filter((job) => job.runner_id != null && alive.has(job.runner_id)).length;
    totals.running_stale = Math.max(0, totals.running - totals.running_active);
    totals.completed = db.jobs.filter((job) => job.status === 'completed').length;
    totals.failed = db.jobs.filter((job) => job.status === 'failed').length;

    return {
        channels,
        // NOTE the asymmetry with GET /api/jobs/runners: get_stats returns
        // manager.get_runners() verbatim, WITHOUT the `id` the list view
        // stamps on. Consumers must key these rows on runner_id.
        runners: jobsRunnerList(null, nowMs),
        totals,
        scheduler: {
            active: db.jobsSchedulerLock != null,
            lock_holder: db.jobsSchedulerLock,
        },
    };
}

// ── Job POST_SAVE_ACTIONS ─────────────────────────────────────────────

const JOB_ACTIONS = new Set(['cancel_request', 'retry_request', 'get_status', 'publish_job']);
const JOB_SAVE_FIELDS = new Set([
    'channel', 'func', 'payload', 'status', 'run_at', 'expires_at', 'max_retries',
    'broadcast', 'cancel_requested', 'max_exec_seconds', 'metadata',
]);

function appendJobEvent(job: MockJob, event: string, details: Record<string, unknown>, runnerId: string | null): void {
    jobEventSequence += 1;
    const at = Math.floor(Date.now() / 1000);
    db.jobEvents.unshift({
        id: jobEventSequence, job: job.id, channel: job.channel, event, at,
        runner_id: runnerId, attempt: job.attempt, details, created: at, modified: at,
    });
}

/**
 * JobActionsService.cancel_job. The forced branch keys on whether the runner's
 * heartbeat key still exists — approximated here as "the runner is absent from
 * the fleet, or present but not alive".
 */
function runJobCancel(job: MockJob, value: unknown): Record<string, unknown> {
    if (!pyTruthy(value)) return { status: false, error: 'cancel_request must be true' };
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'canceled' || job.status === 'expired') {
        return { status: false, error: `Cannot cancel job in ${job.status} state` };
    }
    const now = Math.floor(Date.now() / 1000);
    const previous = job.status;
    const alive = aliveRunnerIds(Date.now());
    let forced = false;
    if (job.status === 'running' && job.runner_id != null && alive.has(job.runner_id)) {
        // Cooperative cancel — the runner polls check_cancel_requested().
        job.cancel_requested = true;
        job.modified = now;
    } else {
        job.status = 'canceled';
        job.finished_at = now;
        job.cancel_requested = true;
        job.runner_id = null;
        job.modified = now;
        forced = previous === 'running';
    }
    appendJobEvent(job, 'canceled', { requested_at: new Date(now * 1000).toISOString(), forced, previous_status: previous }, null);
    return {
        status: true,
        message: `Job ${job.id} ${job.status === 'canceled' ? 'canceled' : 'cancellation requested'}`,
        job_id: job.id,
        forced,
    };
}

/**
 * JobActionsService.retry_job. It ALWAYS republishes: the original row is
 * reset to pending AND a brand-new job id is created. Nothing "resumes".
 */
function runJobRetry(job: MockJob, value: unknown): Record<string, unknown> {
    let delay: number | null = null;
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
        const dict = value as Record<string, unknown>;
        if (!pyTruthy(dict.retry)) {
            return { status: false, error: 'retry_request must be true or {retry: true, delay: N}' };
        }
        delay = dict.delay == null ? null : Number(dict.delay);
    } else if (!pyTruthy(value)) {
        return { status: false, error: 'retry_request must be true or {retry: true, delay: N}' };
    }
    if (job.status !== 'failed' && job.status !== 'canceled' && job.status !== 'expired') {
        return { status: false, error: `Cannot retry job in ${job.status} state` };
    }
    const now = Math.floor(Date.now() / 1000);
    job.status = 'pending';
    job.attempt = 0;
    job.last_error = '';
    job.stack_trace = '';
    job.cancel_requested = false;
    job.runner_id = null;
    job.started_at = null;
    job.finished_at = null;
    job.run_at = delay ? now + delay : null;
    job.modified = now;

    const newJob: MockJob = {
        ...job,
        id: mockHex32(Math.random),
        created: now,
        modified: now,
        metadata: { ...job.metadata, retry_of: job.id },
    };
    db.jobs.unshift(newJob);
    appendJobEvent(job, 'retry', { retry_requested: true, new_job_id: newJob.id, delay }, null);
    appendJobEvent(newJob, 'created', { retry_of: job.id }, null);
    return {
        status: true,
        message: 'Job retry scheduled',
        original_job_id: job.id,
        new_job_id: newJob.id,
        delayed: delay != null,
    };
}

/**
 * JobActionsService.get_job_status — the ONLY place `recent_events` exists.
 * No graph carries it, which is why the lifecycle timeline is a separate
 * /api/jobs/event query rather than a field on the job row.
 */
function runJobGetStatus(job: MockJob, value: unknown): Record<string, unknown> {
    if (!pyTruthy(value)) return { status: false, error: 'get_status must be true' };
    const iso = (seconds: number | null) => (seconds == null ? null : new Date(seconds * 1000).toISOString());
    const events = db.jobEvents
        .filter((event) => event.job === job.id)
        .sort((a, b) => b.at - a.at)
        .slice(0, 10)
        .map((event) => ({
            event: event.event, at: iso(event.at), runner_id: event.runner_id, details: event.details,
        }));
    return {
        status: true,
        data: {
            id: job.id, status: job.status, channel: job.channel, func: job.func,
            created: iso(job.created), started_at: iso(job.started_at), finished_at: iso(job.finished_at),
            attempt: job.attempt, max_retries: job.max_retries, last_error: job.last_error,
            metadata: job.metadata, runner_id: job.runner_id, cancel_requested: job.cancel_requested,
            duration_ms: jobDurationMs(job),
            is_terminal: ['completed', 'failed', 'canceled', 'expired'].includes(job.status),
            // The MODEL property, which is narrower than the service rule the
            // retry endpoint actually enforces.
            is_retriable: job.status === 'failed' && job.attempt < job.max_retries,
            recent_events: events,
        },
    };
}

/** JobActionsService.publish_job_from_template. */
function runJobPublish(job: MockJob, value: unknown): Record<string, unknown> {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        return { status: false, error: 'publish_job must be a dict with job parameters' };
    }
    const overrides = value as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    const delay = overrides.delay == null ? null : Number(overrides.delay);
    const newJob: MockJob = {
        ...job,
        id: mockHex32(Math.random),
        func: String(overrides.func ?? job.func),
        payload: (overrides.payload as Record<string, unknown>) ?? job.payload,
        channel: String(overrides.channel ?? job.channel),
        status: 'pending',
        attempt: 0,
        runner_id: null,
        last_error: '',
        stack_trace: '',
        cancel_requested: false,
        started_at: null,
        finished_at: null,
        run_at: delay ? now + delay : (overrides.run_at == null ? null : Number(overrides.run_at)),
        created: now,
        modified: now,
    };
    db.jobs.unshift(newJob);
    appendJobEvent(newJob, 'created', { template_job_id: job.id }, null);
    return { status: true, message: 'Job published successfully', job_id: newJob.id, template_job_id: job.id };
}

// ── ScheduledTask validation (model._validate) ────────────────────────

const SCHEDULED_TASK_TYPES = new Set(['job', 'webhook', 'llm']);
const SCHEDULED_TASK_NOTIFY = new Set(['email', 'in_app', 'sms', 'push']);
const SCHEDULED_TASK_MAX_PER_USER = 10;

/** The exact ValueError messages ScheduledTask._validate raises, in order. */
function validateScheduledTask(row: MockScheduledTask): string | null {
    if (!Array.isArray(row.run_times)) return 'run_times must be a list';
    if (row.run_times.length > 2) return 'run_times cannot have more than 2 entries';
    for (const time of row.run_times) {
        if (typeof time !== 'string' || time.length !== 5 || time[2] !== ':') {
            return `Invalid time format: ${time}. Use HH:MM`;
        }
        const hour = Number(time.slice(0, 2));
        const minute = Number(time.slice(3));
        if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            return `Invalid time value: ${time}`;
        }
    }
    if (!Array.isArray(row.run_days)) return 'run_days must be a list';
    for (const day of row.run_days) {
        if (!Number.isInteger(day) || day < 0 || day > 6) return `Invalid weekday: ${day}. Must be 0-6 (Mon=0)`;
    }
    if (!SCHEDULED_TASK_TYPES.has(row.task_type)) return `Invalid task_type: ${row.task_type}`;
    if (!row.channel) return 'Invalid channel name';
    if (!Array.isArray(row.notify)) return 'notify must be a list';
    for (const channel of row.notify) {
        if (!SCHEDULED_TASK_NOTIFY.has(channel)) return `Invalid notify channel: ${channel}`;
    }
    return null;
}

// ── The endpoint chain ────────────────────────────────────────────────

/**
 * Every `/api/jobs/*` route. Returns `undefined` for an unrecognized path so
 * the caller falls through to the transport's 404.
 */
function jobsFetch(path: string, opts: MockFetchOpts): unknown {
    const method = (opts.method ?? 'GET').toUpperCase();
    const params = opts.params ?? {};
    const body = opts.body ?? {};
    const caller = userFromBearer(opts.headers);
    if (!caller) return permissionDenied(401);
    const canView = hasGlobalPermission(caller, JOBS_VIEW_GRANTS);
    const canManage = hasGlobalPermission(caller, JOBS_MANAGE_GRANTS);
    const nowMs = Date.now();
    const graphOf = (fallback: string) => String(params.graph ?? fallback);

    // ── Control plane: reads ──────────────────────────────────────────
    if (path === '/api/jobs/stats') {
        if (!canView) return permissionDenied();
        return { status: true, data: jobsStats() };
    }
    if (path === '/api/jobs/runners') {
        if (!canView) return permissionDenied();
        // Paging/sort/search are IGNORED — on_list_runners reads only
        // `channel` and always returns the complete list with a `count`.
        const channel = params.channel ? String(params.channel) : null;
        const rows = jobsRunnerList(channel, nowMs).map((runner) => ({ ...runner, id: runner.runner_id }));
        return { status: true, count: rows.length, data: rows };
    }
    if (path === '/api/jobs/runners/sysinfo') {
        if (!canView) return permissionDenied();
        const replies = db.jobRunners
            .map((runner) => runnerSysinfoReply(runner.runner_id))
            .filter((reply): reply is Record<string, unknown> => reply != null);
        return { status: true, count: replies.length, data: replies };
    }
    const sysinfoMatch = path.match(/^\/api\/jobs\/runners\/sysinfo\/(.+)$/);
    if (sysinfoMatch) {
        if (!canView) return permissionDenied();
        const runnerId = decodeURIComponent(sysinfoMatch[1]!);
        const reply = runnerSysinfoReply(runnerId);
        // A runner that never answers: get_sysinfo returns [] → 404.
        if (!reply) return { status: false, error: `Runner ${runnerId} did not respond`, error_code: 404 };
        return { status: true, data: reply };
    }
    if (path === '/api/jobs/control/channels') {
        if (!canView) return permissionDenied();
        // Discovered by scanning Redis for stream keys — the channels that
        // actually exist, which is not necessarily settings.JOBS_CHANNELS.
        const discovered = [...new Set(db.jobs.map((job) => job.channel))].sort((a, b) => a.localeCompare(b));
        return { status: true, data: discovered };
    }
    if (path === '/api/jobs/control/queue-sizes') {
        if (!canView) return permissionDenied();
        const sizes: Record<string, unknown> = {};
        for (const channel of JOBS_CHANNELS) {
            const rows = db.jobs.filter((job) => job.channel === channel);
            const count = (status: MockJobStatus) => rows.filter((job) => job.status === status).length;
            sizes[channel] = {
                stream: rows.filter((job) => job.status === 'pending' && job.run_at == null).length,
                scheduled: rows.filter((job) => job.status === 'pending' && job.run_at != null).length,
                db_pending: count('pending'),
                db_running: count('running'),
                db_completed: count('completed'),
                db_failed: count('failed'),
                db_canceled: count('canceled'),
                db_expired: count('expired'),
            };
        }
        return { status: true, data: sizes };
    }
    if (path === '/api/jobs/control/config') {
        // The one READ in this domain gated on manage, not view.
        if (!canManage) return permissionDenied();
        return {
            status: true,
            data: {
                redis_url: 'redis://localhost:6379/0',
                redis_prefix: 'mojo:jobs',
                engine: { max_workers: 10, claim_buffer: 2, claim_batch: 5, read_timeout: 100 },
                defaults: { channel: 'default', expires_sec: 900, max_retries: 3, backoff_base: 2.0, backoff_max: 3600 },
                limits: { payload_max_bytes: 1048576, stream_maxlen: 100000, local_queue_maxsize: 1000 },
                timeouts: {
                    idle_timeout_ms: 60000, xpending_idle_ms: 60000,
                    runner_heartbeat_sec: JOBS_HEARTBEAT_SEC, scheduler_lock_ttl_ms: 5000,
                },
                channels: [...JOBS_CHANNELS],
                allowed_channels: [],
            },
        };
    }

    // ── Control plane: writes (all manage-gated) ──────────────────────
    if (path === '/api/jobs/runners/ping') {
        if (!canManage) return permissionDenied();
        if (body.runner_id == null) return missingParams('runner_id');
        const runnerId = String(body.runner_id);
        const alive = aliveRunnerIds(nowMs);
        // Top-level fields, not a `data` block.
        return { status: true, runner_id: runnerId, responsive: alive.has(runnerId) };
    }
    if (path === '/api/jobs/runners/shutdown') {
        if (!canManage) return permissionDenied();
        if (body.runner_id == null) return missingParams('runner_id');
        const runnerId = String(body.runner_id);
        // Fire-and-forget: the command is pushed to the runner's control
        // channel and the response says nothing about compliance. The mock
        // ages the heartbeat so the fleet reflects a runner on its way out.
        const runner = db.jobRunners.find((row) => row.runner_id === runnerId);
        if (runner) runner.heartbeat_age_sec = JOBS_HEARTBEAT_SEC * 3 + 60;
        return { status: true, message: `Shutdown command sent to runner ${runnerId}` };
    }
    if (path === '/api/jobs/runners/broadcast') {
        if (!canManage) return permissionDenied();
        if (body.command == null) return missingParams('command');
        const command = String(body.command);
        if (!['status', 'shutdown', 'pause', 'resume', 'reload'].includes(command)) {
            return jobsBadRequest('Invalid command. Must be one of: status, shutdown, pause, resume, reload');
        }
        const alive = jobsRunnerList(null, nowMs).filter((runner) => runner.alive === true);
        const responses = alive.map((runner) => ({
            runner_id: runner.runner_id,
            command,
            status: 'ok',
            timestamp: new Date().toISOString(),
        }));
        return { status: true, command, responses_count: responses.length, responses };
    }
    if (path === '/api/jobs/control/clear-stuck' || path === '/api/jobs/control/manual-reclaim') {
        if (!canManage) return permissionDenied();
        // @requires_params('channel') — there is NO all-channel form. Sending
        // channel:null (web-mojo's "All Channels") is an instant 400.
        if (body.channel == null || body.channel === '') return missingParams('channel');
        const channel = String(body.channel);
        const reclaimAll = path.endsWith('manual-reclaim');
        const idleThresholdMs = reclaimAll ? 0 : Number(body.idle_threshold_ms ?? 60000);
        const cutoff = Math.floor(nowMs / 1000) - idleThresholdMs / 1000;
        const stuck = db.jobs.filter((job) => job.status === 'running' && job.channel === channel
            && (reclaimAll || (job.started_at ?? 0) <= cutoff));
        const details: { job_id: string; requeued: boolean }[] = [];
        for (const job of stuck) {
            job.status = 'pending';
            job.runner_id = null;
            job.started_at = null;
            job.modified = Math.floor(nowMs / 1000);
            appendJobEvent(job, 'retry', { reason: 'manual_clear_stuck' }, null);
            details.push({ job_id: job.id, requeued: true });
        }
        // The result key is `cleared`. There is no `count` — web-mojo read one
        // and always reported 0.
        const result = {
            channel,
            cleared: details.length,
            details,
            errors: [] as string[],
            message: details.length === 0
                ? `No in-flight jobs found in ${channel} matching threshold`
                : `Requeued ${details.length} in-flight jobs from ${channel}`,
        };
        return { status: true, message: result.message, data: result };
    }
    if (path === '/api/jobs/control/purge') {
        if (!canManage) return permissionDenied();
        if (body.days_old == null) return missingParams('days_old');
        const daysOld = Number(body.days_old);
        if (!Number.isFinite(daysOld)) return jobsBadRequest(`invalid literal for int() with base 10: '${String(body.days_old)}'`);
        const statusFilter = body.status == null ? null : String(body.status);
        const cutoffSec = Math.floor(nowMs / 1000) - daysOld * 86400;
        const doomed = db.jobs.filter((job) => job.created < cutoffSec && (!statusFilter || job.status === statusFilter));
        const cutoff = new Date(cutoffSec * 1000).toISOString();
        if (pyTruthy(body.dry_run)) {
            // A DRY RUN reports `count`…
            return { status: true, data: { status: true, dry_run: true, count: doomed.length, cutoff, status_filter: statusFilter } };
        }
        const doomedIds = new Set(doomed.map((job) => job.id));
        db.jobs = db.jobs.filter((job) => !doomedIds.has(job.id));
        // …and cascades to events and logs, exactly as qs.delete() does.
        const events = db.jobEvents.filter((event) => doomedIds.has(event.job)).length;
        const logs = db.jobLogs.filter((log) => doomedIds.has(log.job)).length;
        db.jobEvents = db.jobEvents.filter((event) => !doomedIds.has(event.job));
        db.jobLogs = db.jobLogs.filter((log) => !doomedIds.has(log.job));
        // …while a REAL run reports `deleted`. Different key, same endpoint.
        return {
            status: true,
            data: {
                status: true,
                deleted: doomed.length + events + logs,
                details: { 'jobs.Job': doomed.length, 'jobs.JobEvent': events, 'jobs.JobLog': logs },
                cutoff,
                status_filter: statusFilter,
            },
        };
    }
    if (path === '/api/jobs/control/reset-failed') {
        if (!canManage) return permissionDenied();
        // Unlike clear-stuck, this DOES have an all-channel form.
        const channel = body.channel == null || body.channel === '' ? null : String(body.channel);
        const limit = Number(body.limit ?? 100);
        const failed = db.jobs
            .filter((job) => job.status === 'failed' && (!channel || job.channel === channel))
            .sort((a, b) => b.created - a.created)
            .slice(0, Number.isFinite(limit) ? limit : 100);
        const affected = new Set(failed.map((job) => job.channel));
        for (const job of failed) {
            job.status = 'pending';
            job.attempt = 0;
            job.last_error = '';
            job.stack_trace = '';
            job.run_at = null;
            job.modified = Math.floor(nowMs / 1000);
            appendJobEvent(job, 'queued', { requeued: true }, null);
        }
        // Top-level keys, not a data block.
        return {
            status: true,
            message: `Reset ${failed.length} failed jobs to pending`,
            reset_count: failed.length,
            requeue: [...affected].map((name) => ({
                status: true,
                requeued: failed.filter((job) => job.channel === name).length,
                channel: name,
            })),
        };
    }
    if (path === '/api/jobs/control/clear-queue') {
        if (!canManage) return permissionDenied();
        if (body.channel == null || body.channel === '') return missingParams('channel');
        // The confirm token is a SERVER gate. A client that pre-satisfies it
        // (web-mojo always sent confirm:"yes") has removed the safety, not
        // honored it — this one is sent only after the armed confirmation.
        if (body.confirm !== 'yes') return jobsBadRequest('Must confirm with confirm="yes"');
        const channel = String(body.channel);
        const pending = db.jobs.filter((job) => job.channel === channel && job.status === 'pending');
        const finishedAt = Math.floor(nowMs / 1000);
        for (const job of pending) {
            job.status = 'canceled';
            job.finished_at = finishedAt;
            job.modified = finishedAt;
        }
        return {
            status: true,
            message: `Cleared queue for channel ${channel}`,
            data: {
                channel,
                deleted: { stream: true, broadcast: false, scheduled: true, scheduled_broadcast: false, queue: true, processing: true },
                db_pending_canceled: pending.length,
                status: true,
                errors: [],
            },
        };
    }
    if (path === '/api/jobs/control/cleanup-consumers') {
        if (!canManage) return permissionDenied();
        const channel = body.channel == null || body.channel === '' ? null : String(body.channel);
        const targets = channel ? [channel] : [...JOBS_CHANNELS];
        return {
            status: true,
            data: {
                status: true,
                channels: targets,
                consumers_removed: targets.length,
                groups_destroyed: 0,
                errors: [],
            },
        };
    }
    if (path === '/api/jobs/control/rebuild-scheduled') {
        if (!canManage) return permissionDenied();
        const channel = body.channel == null || body.channel === '' ? null : String(body.channel);
        const targets = channel ? [channel] : [...JOBS_CHANNELS];
        const rebuilt = db.jobs.filter((job) => job.status === 'pending' && job.run_at != null && targets.includes(job.channel)).length;
        return { status: true, data: { status: true, channels: targets, rebuilt, errors: [] } };
    }
    if (path === '/api/jobs/control/force-scheduler-lead') {
        if (!canManage) return permissionDenied();
        const previous = db.jobsSchedulerLock;
        if (previous == null) {
            return { status: true, message: 'No scheduler lock exists', previous_holder: null };
        }
        db.jobsSchedulerLock = null;
        return { status: true, message: 'Scheduler lock released', previous_holder: previous };
    }
    if (path === '/api/jobs/control/test') {
        if (!canManage) return permissionDenied();
        const channel = String(body.channel ?? 'default');
        const delay = body.delay == null ? null : Number(body.delay);
        const now = Math.floor(nowMs / 1000);
        const job: MockJob = {
            id: mockHex32(Math.random),
            channel,
            func: 'mojo.apps.jobs.examples.sample_jobs.generate_report',
            payload: { test: true, timestamp: new Date().toISOString(), channel, report_type: 'test', format: 'pdf' },
            status: 'pending',
            run_at: delay ? now + delay : null,
            expires_at: now + 900,
            attempt: 0, max_retries: 3, backoff_base: 2, backoff_max_sec: 3600,
            broadcast: false, cancel_requested: false, max_exec_seconds: null,
            runner_id: null, last_error: '', stack_trace: '', metadata: {},
            created: now, modified: now, started_at: null, finished_at: null, idempotency_key: null,
        };
        db.jobs.unshift(job);
        appendJobEvent(job, 'created', { test: true }, null);
        return { status: true, message: 'Test job published', job_id: job.id, channel, delayed: Boolean(delay) };
    }
    if (path === '/api/jobs/test' || path === '/api/jobs/tests') {
        if (!canManage) return permissionDenied();
        const now = Math.floor(nowMs / 1000);
        const suite = path === '/api/jobs/tests';
        const count = suite ? 12 : 2;
        for (let i = 0; i < count; i++) {
            const channel = JOBS_CHANNELS[i % JOBS_CHANNELS.length]!;
            const job: MockJob = {
                id: mockHex32(Math.random),
                channel,
                func: JOB_FUNCS[i % JOB_FUNCS.length]!,
                payload: { test: true },
                status: 'pending',
                run_at: suite && i % 4 === 0 ? now + 60 * (i + 1) : null,
                expires_at: now + 900,
                attempt: 0, max_retries: 3, backoff_base: 2, backoff_max_sec: 3600,
                broadcast: false, cancel_requested: false, max_exec_seconds: null,
                runner_id: null, last_error: '', stack_trace: '', metadata: {},
                created: now, modified: now, started_at: null, finished_at: null, idempotency_key: null,
            };
            db.jobs.unshift(job);
            appendJobEvent(job, 'created', { test: true }, null);
        }
        return { status: true, message: 'Test job should be running.' };
    }

    // ── Model endpoints ───────────────────────────────────────────────
    const oneJob = path.match(/^\/api\/jobs\/job\/([0-9a-fA-F]{32})$/);
    if (oneJob) {
        const job = db.jobs.find((row) => row.id === oneJob[1]);
        if (!job) return { status: false, error: 'Job not found', error_code: 404 };
        if (method === 'DELETE') {
            if (!canManage) return permissionDenied();
            db.jobs = db.jobs.filter((row) => row.id !== job.id);
            db.jobEvents = db.jobEvents.filter((event) => event.job !== job.id);
            db.jobLogs = db.jobLogs.filter((log) => log.job !== job.id);
            return { status: 'deleted' };
        }
        if (method === 'POST') {
            if (!canManage) return permissionDenied();
            const actionKey = Object.keys(body).find((key) => JOB_ACTIONS.has(key));
            // Plain fields save FIRST, then the action handler runs; when a
            // handler returns a payload, THAT payload is the whole response
            // body — verbatim, at HTTP 200, even for a refusal. The client's
            // `status === false` unwrap is what turns it into a rejection.
            for (const [key, value] of Object.entries(body)) {
                if (JOB_ACTIONS.has(key) || !JOB_SAVE_FIELDS.has(key)) continue;
                (job as unknown as Record<string, unknown>)[key] = value;
            }
            job.modified = Math.floor(nowMs / 1000);
            if (actionKey === 'cancel_request') return runJobCancel(job, body[actionKey]);
            if (actionKey === 'retry_request') return runJobRetry(job, body[actionKey]);
            if (actionKey === 'get_status') return runJobGetStatus(job, body[actionKey]);
            if (actionKey === 'publish_job') return runJobPublish(job, body[actionKey]);
        }
        if (!canView) return permissionDenied();
        const graph = graphOf('default');
        return { status: true, data: serializeJob(job, graph), graph };
    }
    if (path === '/api/jobs/job') {
        if (!canView) return permissionDenied();
        const parsed = jobsFilterParams(params, JOB_FIELDS, new Set());
        if (!parsed.ok) return parsed.error;
        const graph = graphOf('default');
        // Job declares no SEARCH_FIELDS, so the backend falls back to every
        // CharField/TextField on the model.
        const search = (row: Record<string, unknown>) =>
            `${row.id} ${row.channel} ${row.func} ${row.status} ${row.runner_id ?? ''} ${row.last_error}`;
        if (params.download_format) {
            const full = listRows(db.jobs as unknown as Record<string, unknown>[], { ...parsed.params, start: 0, size: db.jobs.length }, search, '-id');
            return exportRows((full.data as unknown as MockJob[]).map((job) => serializeJob(job, graph)), params, 'Job');
        }
        // The model default sort is `-id` over 32-char uuid hex — lexicographic
        // noise. Every caller is expected to send an explicit sort.
        const result = listRows(db.jobs as unknown as Record<string, unknown>[], parsed.params, search, '-id');
        return {
            ...result,
            graph: params.graph ? graph : 'list',
            data: (result.data as unknown as MockJob[]).map((job) => serializeJob(job, graph)),
        };
    }
    const oneEvent = path.match(/^\/api\/jobs\/event\/(\d+)$/);
    if (oneEvent) {
        if (!canView) return permissionDenied();
        const event = db.jobEvents.find((row) => row.id === Number(oneEvent[1]));
        if (!event) return { status: false, error: 'JobEvent not found', error_code: 404 };
        const graph = graphOf('default');
        return { status: true, data: serializeJobEvent(event, graph), graph };
    }
    if (path === '/api/jobs/event') {
        if (!canView) return permissionDenied();
        if (method === 'POST') return { status: false, error: 'permission denied', error_code: 403 };
        const parsed = jobsFilterParams(params, JOB_EVENT_FIELDS, JOB_EVENT_ATTNAMES);
        if (!parsed.ok) return parsed.error;
        const graph = graphOf('default');
        const result = listRows(
            db.jobEvents as unknown as Record<string, unknown>[],
            parsed.params,
            (row) => `${row.channel} ${row.event} ${row.runner_id ?? ''}`,
            '-at',
        );
        return {
            ...result,
            graph: params.graph ? graph : 'list',
            data: (result.data as unknown as MockJobEvent[]).map((row) => serializeJobEvent(row, graph)),
        };
    }
    const oneLogRow = path.match(/^\/api\/jobs\/logs\/(\d+)$/);
    if (oneLogRow) {
        if (!canView) return permissionDenied();
        const log = db.jobLogs.find((row) => row.id === Number(oneLogRow[1]));
        if (!log) return { status: false, error: 'JobLog not found', error_code: 404 };
        const graph = graphOf('default');
        return { status: true, data: serializeJobLog(log, graph), graph };
    }
    if (path === '/api/jobs/logs') {
        if (!canView) return permissionDenied();
        if (method === 'POST') return { status: false, error: 'permission denied', error_code: 403 };
        // `?job=` filters. `?runner_id=` is silently dropped (JobLog has no
        // such field) and returns the UNFILTERED table. `?job_id=` is a server
        // error. See jobsFilterParams.
        const parsed = jobsFilterParams(params, JOB_LOG_FIELDS, JOB_LOG_ATTNAMES);
        if (!parsed.ok) return parsed.error;
        const graph = graphOf('default');
        const result = listRows(
            db.jobLogs as unknown as Record<string, unknown>[],
            parsed.params,
            (row) => `${row.channel} ${row.kind} ${row.message}`,
            '-created',
        );
        return {
            ...result,
            graph: params.graph ? graph : 'list',
            data: (result.data as unknown as MockJobLog[]).map((row) => serializeJobLog(row, graph)),
        };
    }

    // ── Scheduled tasks (OWNER fallback) ──────────────────────────────
    // VIEW_PERMS includes `owner`, so a caller with NO global jobs grant still
    // gets HTTP 200 — with only their own rows. An admin page that does not
    // gate on the global grant silently renders a personal list as if it were
    // the system's; that is the hole SCHEDULED_TASK_VIEW_PERMS closes.
    const canViewTasks = hasGlobalPermission(caller, SCHEDULED_TASK_VIEW_GRANTS);
    const canManageTasks = hasGlobalPermission(caller, SCHEDULED_TASK_MANAGE_GRANTS);
    const visibleTasks = () => (canViewTasks ? db.scheduledTasks : db.scheduledTasks.filter((row) => row.user === caller.id));

    const oneTask = path.match(/^\/api\/jobs\/scheduled_task\/([0-9a-fA-F]{32})$/);
    if (oneTask) {
        const task = db.scheduledTasks.find((row) => row.id === oneTask[1]);
        if (!task) return { status: false, error: 'ScheduledTask not found', error_code: 404 };
        const owns = task.user === caller.id;
        if (method === 'DELETE') {
            if (!canManageTasks && !owns) return permissionDenied();
            db.scheduledTasks = db.scheduledTasks.filter((row) => row.id !== task.id);
            db.taskResults = db.taskResults.filter((row) => row.task !== task.id);
            return { status: 'deleted' };
        }
        if (method === 'POST') {
            if (!canManageTasks && !owns) return permissionDenied();
            const draft: MockScheduledTask = { ...task };
            for (const [key, value] of Object.entries(body)) {
                if (key === 'id' || key === 'user' || key === 'created' || key === 'run_count' || key === 'last_run') continue;
                (draft as unknown as Record<string, unknown>)[key] = value;
            }
            const invalid = validateScheduledTask(draft);
            // A model-level ValueError surfaces as a 400 with the raw message.
            if (invalid) return jobsBadRequest(invalid);
            Object.assign(task, draft, { modified: Math.floor(nowMs / 1000) });
            return { status: true, data: serializeScheduledTask(task, 'default'), graph: 'default' };
        }
        if (!canViewTasks && !owns) return permissionDenied();
        const graph = graphOf('default');
        return { status: true, data: serializeScheduledTask(task, graph), graph };
    }
    if (path === '/api/jobs/scheduled_task') {
        const parsed = jobsFilterParams(params, SCHEDULED_TASK_FIELDS, SCHEDULED_TASK_ATTNAMES);
        if (!parsed.ok) return parsed.error;
        if (method === 'POST') {
            if (!canManageTasks && !caller) return permissionDenied();
            const now = Math.floor(nowMs / 1000);
            const draft: MockScheduledTask = {
                id: mockHex32(Math.random),
                // CREATED_BY_OWNER_FIELD auto-stamp: the row is ALWAYS the
                // caller's. There is no arbitrary-owner write.
                user: caller.id,
                name: String(body.name ?? ''),
                description: String(body.description ?? ''),
                enabled: body.enabled == null ? true : Boolean(body.enabled),
                run_once: Boolean(body.run_once),
                task_type: String(body.task_type ?? ''),
                run_times: Array.isArray(body.run_times) ? (body.run_times as string[]) : [],
                run_days: Array.isArray(body.run_days) ? (body.run_days as number[]) : [],
                job_config: (body.job_config as Record<string, unknown>) ?? {},
                notify: Array.isArray(body.notify) ? (body.notify as string[]) : [],
                channel: String(body.channel ?? 'default'),
                max_retries: Number(body.max_retries ?? 0),
                last_run: null, run_count: 0, last_error: '',
                created: now, modified: now,
            };
            const owned = db.scheduledTasks.filter((row) => row.user === caller.id).length;
            if (owned >= SCHEDULED_TASK_MAX_PER_USER) {
                return jobsBadRequest(`Maximum of ${SCHEDULED_TASK_MAX_PER_USER} scheduled tasks per user`);
            }
            const invalid = validateScheduledTask(draft);
            if (invalid) return jobsBadRequest(invalid);
            db.scheduledTasks.unshift(draft);
            return { status: true, data: serializeScheduledTask(draft, 'default'), graph: 'default' };
        }
        const graph = graphOf('list');
        const rows = visibleTasks();
        const search = (row: Record<string, unknown>) =>
            `${row.id} ${row.name} ${row.description} ${row.task_type} ${row.channel} ${row.last_error}`;
        if (params.download_format) {
            const full = listRows(rows as unknown as Record<string, unknown>[], { ...parsed.params, start: 0, size: rows.length }, search, '-created');
            return exportRows((full.data as unknown as MockScheduledTask[]).map((row) => serializeScheduledTask(row, graph)), params, 'ScheduledTask');
        }
        const result = listRows(rows as unknown as Record<string, unknown>[], parsed.params, search, '-created');
        return {
            ...result,
            graph: params.graph ? graph : 'list',
            data: (result.data as unknown as MockScheduledTask[]).map((row) => serializeScheduledTask(row, graph)),
        };
    }
    const oneResult = path.match(/^\/api\/jobs\/task_result\/([0-9a-fA-F]{32})$/);
    if (oneResult) {
        const row = db.taskResults.find((candidate) => candidate.id === oneResult[1]);
        if (!row) return { status: false, error: 'TaskResult not found', error_code: 404 };
        if (method === 'POST') return { status: false, error: 'permission denied', error_code: 403 };
        if (method === 'DELETE') {
            // DELETE_PERMS drops `owner` — global grant only.
            if (!canManageTasks) return permissionDenied();
            db.taskResults = db.taskResults.filter((candidate) => candidate.id !== row.id);
            return { status: 'deleted' };
        }
        if (!canViewTasks && row.user !== caller.id) return permissionDenied();
        const graph = graphOf('default');
        return { status: true, data: serializeTaskResult(row, graph), graph };
    }
    if (path === '/api/jobs/task_result') {
        if (method === 'POST') return { status: false, error: 'permission denied', error_code: 403 };
        const parsed = jobsFilterParams(params, TASK_RESULT_FIELDS, TASK_RESULT_ATTNAMES);
        if (!parsed.ok) return parsed.error;
        const graph = graphOf('list');
        const rows = canViewTasks ? db.taskResults : db.taskResults.filter((row) => row.user === caller.id);
        const result = listRows(
            rows as unknown as Record<string, unknown>[],
            parsed.params,
            (row) => `${row.id} ${row.status} ${row.output} ${row.error}`,
            '-created',
        );
        return {
            ...result,
            graph: params.graph ? graph : 'list',
            data: (result.data as unknown as MockTaskResult[]).map((row) => serializeTaskResult(row, graph)),
        };
    }
    return undefined;
}

// ══ end jobs engine wire ═════════════════════════════════════════════

/** Mock transport. Same signature the real fetch path resolves through. */
export async function mockFetch(path: string, opts: MockFetchOpts): Promise<unknown> {
    const method = (opts.method ?? 'GET').toUpperCase();
    const key = `${method} ${path}`;
    callCounts.set(key, (callCounts.get(key) ?? 0) + 1);
    const safeDnsParams = path === '/api/dnsman/credential/group-choice'
        || path === '/api/dnsman/registrar/discover'
        || path.startsWith('/api/metrics/')
        ? { ...(opts.params ?? {}) }
        : undefined;
    requestHistory.push({ method, path, ...(safeDnsParams ? { params: safeDnsParams } : {}) });
    await new Promise((r) => setTimeout(r, LATENCY_MS));
    if (armedReauth?.method === method && armedReauth.path === path) {
        // The real @requires_fresh_auth runs after authentication. An armed
        // endpoint must still answer 401 to an anonymous caller, and that
        // failed auth must not consume the one-shot challenge.
        if (!userFromBearer(opts.headers)) return { status: false, error: 'permission denied', error_code: 401 };
        armedReauth = null;
        return { status: false, error: 'reauth_required', error_code: 440 };
    }
    const storageResult = storageFetch(path, opts);
    if (storageResult !== undefined) return storageResult;
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
    if (path === '/api/auth/manage/throttle') {
        // GET {user_id|username, key='login'} → the per-account attempt
        // counter (rest/user.py on_read_throttle). Admin-tier; reading never
        // mutates the counter.
        const caller = userFromBearer(opts.headers);
        if (!caller) return { status: false, error: 'permission denied', error_code: 401 };
        if (!hasGlobalPermission(caller, ['users', 'manage_users'])) return permissionDenied();
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
        if (!hasGlobalPermission(caller, ['users', 'manage_users'])) return permissionDenied();
        const uid = Number(opts.body?.user_id ?? 0);
        const had = db.throttle.delete(uid);
        return { status: true, data: { deleted: had ? 1 : 0 } };
    }
    if (path === '/api/login' || path === '/api/token/refresh' || path.startsWith('/api/auth/')) {
        return authFetch(path, opts.body ?? {}, opts.params ?? {});
    }
    // ── Geofence public/member/config planes ──────────────────────────
    if (path === '/api/geo/check') {
        const uuid = String(opts.params?.group_uuid ?? '').trim();
        const group = uuid ? db.groups.find((candidate) => candidate.uuid === uuid) : undefined;
        if (uuid && !group) return { status: false, error: 'Unknown group', error_code: 400 };
        const country = String(opts.params?.__mock_country ?? 'US').toUpperCase();
        const inactive = group != null && !isEffectivelyActive(group);
        const denied = country === 'CN';
        return {
            status: true,
            data: {
                allowed: inactive ? !denied : !denied,
                reason: inactive ? 'group_inactive' : denied ? 'country_not_allowed' : 'passed',
                detail: inactive ? 'Group is inactive; evaluated against system rules only.' : denied ? 'Country CN is denied by the system rule.' : 'Allowed.',
                ip: country === 'CN' ? '198.51.100.66' : '203.0.113.42',
                country, country_code: country,
                region: country === 'US' ? 'US-CA' : null,
                region_code: country === 'US' ? 'US-CA' : null,
                abuse: { tor: false, vpn: false, datacenter: false, proxy: false },
                checked_at: new Date().toISOString(),
                rule_level: denied ? 'system' : null,
                strict_posture: false,
                ...(inactive ? { group_inactive: true } : {}),
            },
        };
    }
    if (path === '/api/geo/policy') {
        const caller = userFromBearer(opts.headers);
        const groupId = requestGroupId(opts);
        const group = db.groups.find((candidate) => candidate.id === groupId);
        if (!caller) return permissionDenied(401);
        const member = db.members.find((row) => row.group === groupId && row.user === caller.id && row.is_active);
        if (!group || (!hasGlobalPermission(caller, ['view_security', 'security']) && !member && !(caller.id === 1 && groupId % 2 === 1))) return permissionDenied();
        const strict = group.metadata.geofence_strict;
        return { status: true, data: { group: { id: group.id, uuid: group.uuid, name: group.name, is_active: group.is_active }, enabled: true, evaluation_order: ['system', 'group'], system_rule: db.geoRules, group_rule: group.metadata.geofence ?? {}, strict_posture: strict ?? null, strict_posture_effective: Boolean(strict) } };
    }
    if (path === '/api/geo/rules') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const canView = hasGlobalPermission(caller, ['view_geofence', 'manage_geofence', 'security']);
        const canManage = hasGlobalPermission(caller, ['manage_geofence', 'security']);
        if (opts.method === 'POST') {
            if (!canManage) return permissionDenied();
            if (opts.body?.rule === undefined) return { status: false, error: "'rule' is required", error_code: 400 };
            if (!isPlainObject(opts.body?.rule)) return { status: false, error: "'rule' must be a dict", error_code: 400 };
            // #1287: server-side DSL validation, so an invalid rule can never
            // be stored here either — and the client's inline 400 has a real
            // message to surface.
            const invalid = validateGeoRule(opts.body.rule);
            if (invalid) return { status: false, error: invalid, error_code: 400 };
            db.geoRules = { ...opts.body.rule };
            return { status: true, data: { rule: db.geoRules, source: 'setting', modified: new Date().toISOString() } };
        }
        if (opts.method === 'DELETE') {
            if (!canManage) return permissionDenied();
            const removed = Object.keys(db.geoRules).length > 0;
            db.geoRules = {};
            return { status: true, data: { removed } };
        }
        if (!canView) return permissionDenied();
        // #1287: `group` is present ONLY when the request carried group_uuid,
        // and `geoip_active` counts real whitelist-active rows.
        const groupUuid = String(opts.params?.group_uuid ?? '').trim();
        let groupBlock: Record<string, unknown> | undefined;
        if (groupUuid) {
            const group = db.groups.find((candidate) => candidate.uuid === groupUuid);
            if (!group) return { status: false, error: 'Unknown group', error_code: 400 };
            const strict = group.metadata.geofence_strict;
            groupBlock = {
                id: group.id, uuid: group.uuid, is_active: group.is_active,
                rule: group.metadata.geofence ?? {},
                strict_posture: strict ?? null,
                strict_posture_effective: Boolean(strict),
            };
        }
        return {
            status: true,
            data: {
                system: { rule: db.geoRules, source: 'setting', modified: new Date().toISOString() },
                ...(groupBlock ? { group: groupBlock } : {}),
                posture: { enabled: true, fail_closed: false, fail_closed_scopes: ['auth'], allow_private_ips: true, strict_posture: false, cache_ttl: 300 },
                allowlist_summary: {
                    setting_entries: db.geoAllowlist.length,
                    geoip_active: db.geoIps.filter(mockWhitelistActive).length,
                },
                evaluation_order: ['system', 'group'],
                enforced_endpoints: [
                    { endpoint: 'mojo.apps.account.rest.auth.on_login', scope: 'auth', after_auth: true },
                    { endpoint: 'mojo.apps.account.rest.auth.on_request_code', scope: 'auth' },
                    { endpoint: 'mojo.apps.incident.rest.ossec.on_alert', scope: 'ingest' },
                ],
            },
        };
    }
    if (path === '/api/geo/allowlist') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const canManage = hasGlobalPermission(caller, ['manage_geofence', 'security']);
        if (opts.method === 'POST') {
            if (!canManage) return permissionDenied();
            if (opts.body?.entries === undefined) return { status: false, error: "'entries' is required (a list; may be empty)", error_code: 400 };
            if (!Array.isArray(opts.body?.entries)) return { status: false, error: "'entries' must be a list", error_code: 400 };
            const invalid = validateGeoAllowlist(opts.body.entries);
            if (invalid) return { status: false, error: invalid, error_code: 400 };
            db.geoAllowlist = [...opts.body.entries];
            return { status: true, data: { entries: db.geoAllowlist } };
        }
        if (!hasGlobalPermission(caller, ['view_geofence', 'manage_geofence', 'security'])) return permissionDenied();
        // #1287: `active` is computed from `until`, and the geoip leg is the
        // real whitelist projection — expired entries are LISTED, never hidden.
        return {
            status: true,
            data: {
                setting: db.geoAllowlist.map(normalizeMockAllowlistEntry),
                geoip: db.geoIps
                    .filter((row) => row.is_whitelisted)
                    .slice(0, 500)
                    .map((row) => ({
                        ip: row.ip_address,
                        reason: row.whitelisted_reason ?? null,
                        until: row.whitelisted_until == null ? null : new Date(row.whitelisted_until * 1000).toISOString(),
                        active: mockWhitelistActive(row),
                    })),
            },
        };
    }
    // ══ Network security — wire implementation (board #1287) ══════════
    // Fixtures live in the "Network security fixtures" block above.
    if (path === '/api/geo/simulate') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (!hasGlobalPermission(caller, ['view_geofence', 'manage_geofence', 'security'])) return permissionDenied();
        const ip = String(opts.body?.ip ?? '').trim();
        const geoBody = opts.body?.geo;
        if (!ip && geoBody === undefined) return { status: false, error: "Provide 'ip' or 'geo'", error_code: 400 };
        if (geoBody !== undefined && !isPlainObject(geoBody)) return { status: false, error: "'geo' must be a dict", error_code: 400 };
        const groupUuid = String(opts.body?.group_uuid ?? '').trim();
        let group: MockGroup | undefined;
        if (groupUuid) {
            group = db.groups.find((candidate) => candidate.uuid === groupUuid);
            // `_resolve_group_param` 400s on an UNKNOWN uuid but deliberately
            // returns an INACTIVE group — inactive is legal and is evaluated.
            if (!group) return { status: false, error: 'Unknown group', error_code: 400 };
        }
        return { status: true, data: simulateGeoDecision(ip, isPlainObject(geoBody) ? geoBody : null, group) };
    }
    if (path === '/api/geo/bypass_holders') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (!hasGlobalPermission(caller, ['view_geofence', 'manage_geofence', 'security'])) return permissionDenied();
        const matched = db.users.filter((user) => user.is_superuser || Boolean(user.permissions.bypass_geofence));
        const capped = matched.length > 200;
        const holders = matched.slice(0, 200).map((user) => ({
            id: user.id,
            username: user.username,
            is_active: user.is_active,
            source: user.permissions.bypass_geofence ? 'permission' : 'superuser',
            value: user.permissions.bypass_geofence ?? null,
        }));
        return { status: true, data: { holders, count: holders.length, capped } };
    }
    // #1438 permission-filtered registry discovery. Counts are computed only
    // after hidden accounts are removed, so pagination is not an oracle.
    if (path === '/api/metrics/discover') {
        const caller = userFromBearer(opts.headers);
        const params = opts.params ?? {};
        const allowed = new Set(['resource', 'account', 'category', 'search', 'start', 'size']);
        if (Object.keys(params).some((key) => !allowed.has(key))) return { status: false, error: 'Invalid metrics discovery query', error_code: 400 };
        const resource = String(params.resource ?? '');
        if (!['accounts', 'categories', 'slugs'].includes(resource)) return { status: false, error: 'Invalid metrics discovery query', error_code: 400 };
        const parseInteger = (value: unknown, fallback: number, minimum: number, maximum?: number): number | null => {
            const input = value == null ? fallback : value;
            if (typeof input === 'boolean' || (typeof input !== 'number' && typeof input !== 'string')) return null;
            if (typeof input === 'string' && (!input || input.trim() !== input || !/^\d+$/.test(input))) return null;
            const parsed = Number(input);
            return Number.isInteger(parsed) && parsed >= minimum && (maximum == null || parsed <= maximum) ? parsed : null;
        };
        const start = parseInteger(params.start, 0, 0);
        const size = parseInteger(params.size, 50, 1, 500);
        const search = params.search == null ? '' : params.search;
        const accountValue = params.account;
        const categoryValue = params.category;
        if (start == null || size == null || typeof search !== 'string' || search.length > 128
            || (accountValue != null && (typeof accountValue !== 'string' || accountValue.length > 256))
            || (categoryValue != null && (typeof categoryValue !== 'string' || categoryValue.length > 256))) {
            return { status: false, error: 'Invalid metrics discovery query', error_code: 400 };
        }
        if (resource === 'accounts' && (accountValue != null || categoryValue != null)) return { status: false, error: 'Invalid metrics discovery query', error_code: 400 };
        if (resource === 'categories' && (typeof accountValue !== 'string' || !accountValue || categoryValue != null)) return { status: false, error: 'Invalid metrics discovery query', error_code: 400 };
        if (resource === 'slugs' && (typeof accountValue !== 'string' || !accountValue)) return { status: false, error: 'Invalid metrics discovery query', error_code: 400 };

        let items: string[];
        let filters: Record<string, unknown>;
        if (resource === 'accounts') {
            if (!hasGlobalPermission(caller, METRICS_VIEW_GRANTS)) return permissionDenied(caller ? 403 : 401);
            items = [...new Set(['public', 'global', ...Object.keys(METRIC_ACCOUNT_CATEGORIES)])]
                .filter((candidate) => canViewMetricsAccount(caller, candidate));
            filters = { search };
        } else {
            const account = String(accountValue);
            if (!canViewMetricsAccount(caller, account)) return permissionDenied(caller ? 403 : 401);
            if (resource === 'categories') {
                items = Object.keys(metricsAccountCategories(account));
                filters = { account, search };
            } else {
                const category = categoryValue == null ? null : String(categoryValue);
                items = metricsAccountSlugs(account, category);
                filters = { account, category, search };
            }
        }
        const needle = search.toLocaleLowerCase();
        const visible = [...new Set(items)].filter((item) => !needle || item.toLocaleLowerCase().includes(needle)).sort();
        const data = visible.slice(start, start + size);
        return {
            status: true, resource, filters, data, start, size,
            count: visible.length, page_count: data.length,
            next_start: start + size < visible.length ? start + size : null,
        };
    }
    // `/api/metrics/category_slugs` answers a FLAT envelope — a raw
    // JsonResponse, so there is no `data` wrapper (categories.py:199-217).
    if (path === '/api/metrics/category_slugs') {
        const caller = userFromBearer(opts.headers);
        const category = String(opts.params?.category ?? '');
        if (!category) return { status: false, error: 'missing required parameter: category', error_code: 400 };
        const account = String(opts.params?.account ?? 'public');
        if (!canViewMetricsAccount(caller, account)) return permissionDenied(caller ? 403 : 401);
        return { status: true, slugs: metricsAccountSlugs(account, category), category, account };
    }
    // ── IP sets — /api/incident/ipset (+ /<pk>) ──
    const ipSetMatch = path.match(/^\/api\/incident\/ipset(?:\/(\d+))?$/);
    if (ipSetMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (!hasGlobalPermission(caller, IPSET_VIEW_PERMS_MOCK)) return permissionDenied();
        const canSave = hasGlobalPermission(caller, IPSET_SAVE_PERMS_MOCK);
        const canDelete = hasGlobalPermission(caller, IPSET_DELETE_PERMS_MOCK);
        const graph = String(opts.params?.graph ?? 'default');
        if (ipSetMatch[1]) {
            const row = db.ipSets.find((candidate) => candidate.id === Number(ipSetMatch[1]));
            if (!row) return { status: false, error: 'IPSet not found', error_code: 404 };
            if (method === 'DELETE') {
                // DELETE_PERMS is `manage_security` ONLY — the broader
                // `security` grant does NOT satisfy it.
                if (!canDelete) return permissionDenied();
                db.ipSets = db.ipSets.filter((candidate) => candidate.id !== row.id);
                return { status: 'deleted' };
            }
            if (method === 'POST' && opts.body) {
                if (!canSave) return permissionDenied();
                const result = applyIPSetSave(row, opts.body, db.ipSets);
                if (result.error) return { status: false, error: result.error, error_code: result.code ?? 400 };
            }
            return { status: true, data: serializeIPSet(row, graph), graph };
        }
        if (method === 'DELETE') return { status: false, error: 'DELETE not allowed on the collection', error_code: 403 };
        if (method === 'POST' && opts.body) {
            if (!canSave) return permissionDenied();
            const now = Math.floor(Date.now() / 1000);
            const created: MockIPSet = {
                id: Math.max(0, ...db.ipSets.map((candidate) => candidate.id)) + 1,
                created: now, modified: now,
                name: '', kind: 'custom', description: null, source: 'manual',
                source_url: null, source_key: null, data: '',
                // The model default is True, but this module never posts
                // `is_enabled` — a set created through the portal is staged.
                is_enabled: false, cidr_count: 0, last_synced: null, sync_error: null,
            };
            const result = applyIPSetSave(created, opts.body, db.ipSets);
            if (result.error) return { status: false, error: result.error, error_code: result.code ?? 400 };
            if (!created.name) return { status: false, error: 'name is required', error_code: 400 };
            db.ipSets.push(created);
            return { status: true, data: serializeIPSet(created, graph), graph };
        }
        const result = listRows(
            db.ipSets as unknown as Record<string, unknown>[],
            opts.params ?? {},
            // `SEARCH_FIELDS = ["name", "description"]`.
            (row) => `${row.name} ${row.description ?? ''}`,
            'name',
        );
        if (opts.params?.download_format) {
            return exportRows(
                (result.data as unknown as MockIPSet[]).map((row) => serializeIPSet(row, graph)),
                opts.params,
                'IPSet',
            );
        }
        return { ...result, graph, data: (result.data as unknown as MockIPSet[]).map((row) => serializeIPSet(row, graph)) };
    }
    // ══ end network security wire ════════════════════════════════════
    // ══ DNSMan — capabilities, safe models and custom operations ════════
    if (path === '/api/dnsman/config') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (!dnsCollectionCan(caller, opts)) return permissionDenied();
        const groupId = requestGroupId(opts);
        if (groupId > 0 && !db.groups.some((group) => group.id === groupId && group.is_active)) {
            return { status: false, error: 'The requested group does not exist or is not active', error_code: 400 };
        }
        if (dnsConfigMalformed) return { status: true, data: { providers: [] } };
        return {
            status: true,
            data: {
                purchase_enabled: true,
                registrant_contact_configured: groupId === 0 || groupId % 2 === 1,
                max_domain_price: '100.00', currency: 'USD', quote_ttl_minutes: 15,
                allowed_record_types: ['A', 'AAAA', 'CAA', 'CNAME', 'MX', 'NS', 'SRV', 'TXT'],
                search_batch_limit: 20, suggestions_enabled: true,
                providers: [
                    { name: 'route53', purchase: true, requires_credential: false },
                    { name: 'godaddy', purchase: false, requires_credential: true },
                ],
                acme: { configured: true, staging: true },
                delegated_acme: {
                    available: true, record_type: 'CNAME', target_suffix: null,
                    profile: 'apex_wildcard', requires_provider_credentials: false,
                },
                cert_renew_days: 30,
            },
        };
    }

    if (path === '/api/dnsman/credential/group-choice') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (!hasGlobalPermission(caller, DNS_MANAGE_GRANTS)) return permissionDenied();
        if (method !== 'GET') return { status: false, error: 'Method not allowed', error_code: 405 };
        const params = opts.params ?? {};
        const keys = Object.keys(params).filter((name) => params[name] != null);
        if (keys.some((name) => !['id', 'search', 'start', 'size'].includes(name))) {
            return { status: false, error: 'Invalid credential group-choice query', error_code: 400 };
        }
        let eligible = db.groups.filter((group) => isDnsCredentialChoiceEligible(group));
        if (keys.includes('id')) {
            if (keys.length !== 1) return { status: false, error: 'Invalid credential group-choice query', error_code: 400 };
            const idInput = params.id;
            if (typeof idInput === 'boolean' || (typeof idInput !== 'string' && typeof idInput !== 'number')) {
                return { status: false, error: 'Invalid credential group-choice query', error_code: 400 };
            }
            const idText = String(idInput);
            if (!/^[0-9]+$/.test(idText) || BigInt(idText) < 1n || BigInt(idText) > 9223372036854775807n) return { status: false, error: 'Invalid credential group-choice query', error_code: 400 };
            const id = Number(idText);
            const row = eligible.find((group) => group.id === id);
            return { status: true, data: row ? [{ id: row.id, name: row.name }] : [], start: 0, size: 1, count: row ? 1 : 0 };
        }
        const searchInput = params.search;
        if (searchInput != null && typeof searchInput !== 'string') return { status: false, error: 'Invalid credential group-choice query', error_code: 400 };
        const search = (searchInput ?? '').trim();
        const start = mockGroupChoiceInteger(params.start, 0, 0, 100000);
        const size = mockGroupChoiceInteger(params.size, 25, 1, 50);
        if (search.length > 100 || start == null || size == null) {
            return { status: false, error: 'Invalid credential group-choice query', error_code: 400 };
        }
        if (search) eligible = eligible.filter((group) => group.name.toLowerCase().includes(search.toLowerCase()));
        eligible.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id - right.id);
        return {
            status: true, count: eligible.length, start, size,
            data: eligible.slice(start, start + size).map((group) => ({ id: group.id, name: group.name })),
        };
    }

    if (path === '/api/dnsman/credential/link') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (method !== 'POST') return { status: false, error: 'Method not allowed', error_code: 405 };
        const body = opts.body ?? {};
        const missing = ['group', 'provider', 'api_key', 'api_secret'].filter((name) => !(name in body));
        if (missing.length) return missingParams(...missing);
        const groupId = Number(body.group);
        const group = db.groups.find((candidate) => candidate.id === groupId && candidate.is_active);
        if (!group) return { status: false, error: 'A valid group is required to link a credential', error_code: 400 };
        if (!dnsMemberCan(caller, groupId, true)) return permissionDenied();
        if (String(body.provider) !== 'godaddy') return { status: false, error: 'Unsupported DNS credential provider', error_code: 400 };
        const keyValue = String(body.api_key ?? '');
        const secretValue = String(body.api_secret ?? '');
        const verificationFails = !keyValue || !secretValue
            || keyValue.toLowerCase().includes('invalid') || secretValue.toLowerCase().includes('invalid')
            || keyValue.toLowerCase().includes('reject') || secretValue.toLowerCase().includes('reject');
        const existingId = body.credential == null ? null : Number(body.credential);
        const existing = existingId == null ? null : db.dnsCredentials.find((row) => row.id === existingId);
        if (existingId != null && !existing) return { status: false, error: 'DnsCredential not found', error_code: 404 };
        if (existing && !dnsMemberCan(caller, existing.group, true)) return permissionDenied();
        if (verificationFails) {
            if (existing) {
                existing.verified = false;
                existing.last_error = 'Provider verification failed';
                existing.modified = Math.floor(Date.now() / 1000);
            }
            return { status: false, error: 'The provider rejected those credentials', error_code: 400 };
        }
        const mask = (value: string) => value.length <= 4 ? '*'.repeat(value.length) : `${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`;
        const now = Math.floor(Date.now() / 1000);
        const row = existing ?? {
            id: Math.max(8100, ...db.dnsCredentials.map((candidate) => candidate.id)) + 1,
            created: now, modified: now, group: groupId, name: '', provider: 'godaddy',
            is_active: true, verified: false, verified_at: null,
            domain_count: 0, last_error: null, api_key_masked: '', api_secret_masked: '',
        } satisfies MockDnsCredential;
        row.name = String(body.name ?? (row.name || `${group.name} GoDaddy`));
        row.api_key_masked = mask(keyValue);
        row.api_secret_masked = mask(secretValue);
        row.verified = true;
        row.verified_at = now;
        row.domain_count = Math.max(row.domain_count, 3);
        row.last_error = null;
        row.modified = now;
        if (!existing) db.dnsCredentials.unshift(row);
        return { status: true, data: serializeDnsCredential(row), graph: 'default' };
    }

    const credentialMatch = path.match(/^\/api\/dnsman\/credential(?:\/(\d+))?$/);
    if (credentialMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const id = credentialMatch[1] ? Number(credentialMatch[1]) : null;
        if (id != null) {
            const row = db.dnsCredentials.find((candidate) => candidate.id === id);
            if (!row) return { status: false, error: 'DnsCredential not found', error_code: 404 };
            if (!dnsMemberCan(caller, row.group, method !== 'GET')) return permissionDenied();
            if (method === 'DELETE') {
                db.dnsCredentials = db.dnsCredentials.filter((candidate) => candidate.id !== row.id);
                for (const domain of db.dnsDomains) if (domain.credential === row.id) domain.credential = null;
                return { status: 'deleted' };
            }
            if (method === 'POST' && opts.body) {
                if ('name' in opts.body) row.name = String(opts.body.name ?? '');
                if ('is_active' in opts.body) row.is_active = Boolean(opts.body.is_active);
                row.modified = Math.floor(Date.now() / 1000);
            }
            return { status: true, data: serializeDnsCredential(row), graph: 'default' };
        }
        if (!dnsCollectionCan(caller, opts, method !== 'GET')) return permissionDenied();
        if (method !== 'GET') return { status: false, error: 'Credential creation requires credential/link', error_code: 403 };
        if (opts.params?.download_format || opts.params?.filename) return { status: false, error: 'Credential export is not available', error_code: 400 };
        const groupId = requestGroupId(opts);
        const rows = groupId > 0 ? db.dnsCredentials.filter((row) => row.group === groupId) : db.dnsCredentials;
        const result = listRows(rows as unknown as Record<string, unknown>[], opts.params ?? {}, (row) => `${row.name} ${row.provider}`, 'name');
        return { ...result, graph: 'default', data: (result.data as unknown as MockDnsCredential[]).map(serializeDnsCredential) };
    }

    const domainMatch = path.match(/^\/api\/dnsman\/domain(?:\/(\d+))?$/);
    if (domainMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const id = domainMatch[1] ? Number(domainMatch[1]) : null;
        if (id != null) {
            const row = db.dnsDomains.find((candidate) => candidate.id === id);
            if (!row) return { status: false, error: 'Domain not found', error_code: 404 };
            if (row.group == null ? !caller.is_superuser : !dnsMemberCan(caller, row.group, method !== 'GET')) return permissionDenied();
            if (method === 'DELETE') {
                db.dnsDomains = db.dnsDomains.filter((candidate) => candidate.id !== row.id);
                db.dnsRecords.delete(row.id);
                return { status: 'deleted' };
            }
            if (method === 'POST' && opts.body) {
                if ('auto_renew' in opts.body) row.auto_renew = Boolean(opts.body.auto_renew);
                if ('privacy' in opts.body) row.privacy = Boolean(opts.body.privacy);
                if ('credential' in opts.body) row.credential = opts.body.credential == null ? null : Number(opts.body.credential);
                row.modified = Math.floor(Date.now() / 1000);
            }
            return { status: true, data: serializeDnsDomain(row), graph: 'default' };
        }
        if (!dnsCollectionCan(caller, opts, method !== 'GET')) return permissionDenied();
        if (method !== 'GET') return { status: false, error: 'Domain creation is not allowed', error_code: 403 };
        if (opts.params?.download_format || opts.params?.filename) return { status: false, error: 'Domain export is not available', error_code: 400 };
        const groupId = requestGroupId(opts);
        const rows = groupId > 0 ? db.dnsDomains.filter((row) => row.group === groupId) : db.dnsDomains;
        const graph = String(opts.params?.graph ?? 'list');
        const result = listRows(rows as unknown as Record<string, unknown>[], opts.params ?? {}, (row) => `${row.name} ${row.provider} ${row.status}`, 'name');
        return { ...result, graph, data: (result.data as unknown as MockDnsDomain[]).map((row) => serializeDnsDomain(row, graph)) };
    }

    const purchaseMatch = path.match(/^\/api\/dnsman\/purchase(?:\/(\d+))?$/);
    if (purchaseMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const id = purchaseMatch[1] ? Number(purchaseMatch[1]) : null;
        if (method !== 'GET') return { status: false, error: 'DomainPurchase is read-only', error_code: 403 };
        if (id != null) {
            const row = db.domainPurchases.find((candidate) => candidate.id === id);
            if (!row) return { status: false, error: 'DomainPurchase not found', error_code: 404 };
            if (!dnsMemberCan(caller, row.group, false)) return permissionDenied();
            return { status: true, data: serializeDomainPurchase(row), graph: 'default' };
        }
        if (!dnsCollectionCan(caller, opts)) return permissionDenied();
        if (opts.params?.download_format || opts.params?.filename) return { status: false, error: 'Purchase export is not available', error_code: 400 };
        const groupId = requestGroupId(opts);
        const rows = groupId > 0 ? db.domainPurchases.filter((row) => row.group === groupId) : db.domainPurchases;
        const result = listRows(rows as unknown as Record<string, unknown>[], opts.params ?? {}, (row) => `${row.domain_name} ${row.status}`, '-created');
        return { ...result, graph: 'default', data: (result.data as unknown as MockDomainPurchase[]).map(serializeDomainPurchase) };
    }

    const certificateMatch = path.match(/^\/api\/dnsman\/certificate(?:\/(\d+))?$/);
    if (certificateMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (method !== 'GET') return { status: false, error: 'Certificate writes use explicit actions', error_code: 403 };
        const id = certificateMatch[1] ? Number(certificateMatch[1]) : null;
        if (id != null) {
            const row = db.dnsCertificates.find((candidate) => candidate.id === id);
            if (!row) return { status: false, error: 'Certificate not found', error_code: 404 };
            const domain = db.dnsDomains.find((candidate) => candidate.id === row.domain);
            if (!domain || (domain.group == null ? !caller.is_superuser : !dnsMemberCan(caller, domain.group, false))) return permissionDenied();
            return { status: true, data: serializeDnsCertificate(row), graph: 'default' };
        }
        if (!dnsCollectionCan(caller, opts)) return permissionDenied();
        if (opts.params?.download_format || opts.params?.filename) return { status: false, error: 'Certificate export is not available', error_code: 400 };
        const groupId = requestGroupId(opts);
        const rows = groupId > 0 ? db.dnsCertificates.filter((row) => db.dnsDomains.find((domain) => domain.id === row.domain)?.group === groupId) : db.dnsCertificates;
        const result = listRows(rows as unknown as Record<string, unknown>[], opts.params ?? {}, (row) => `${row.common_name} ${row.status}`, '-created');
        return { ...result, graph: 'default', data: (result.data as unknown as MockDnsCertificate[]).map(serializeDnsCertificate) };
    }

    if (path === '/api/dnsman/dns' || path === '/api/dnsman/dns/delete') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (!['GET', 'POST'].includes(method)) return { status: false, error: 'Method not allowed', error_code: 405 };
        const bodyOrParams = method === 'GET' ? opts.params ?? {} : opts.body ?? {};
        const domain = db.dnsDomains.find((candidate) => candidate.id === Number(bodyOrParams.domain));
        if (!domain) return { status: false, error: 'Domain not found', error_code: 404 };
        if (domain.group == null ? !caller.is_superuser : !dnsMemberCan(caller, domain.group, method !== 'GET')) return permissionDenied();
        if (domain.status !== 'active') return { status: false, error: 'DNS records are available only for active domains', error_code: 400 };
        if (!['route53', 'godaddy'].includes(domain.provider)) return { status: false, error: domain.provider === 'mojo' ? 'Mojo domains are certificate-only and do not support general DNS operations' : `Unsupported DNS provider: ${domain.provider}`, error_code: 400 };
        if (domain.provider === 'godaddy') {
            const credential = db.dnsCredentials.find((candidate) => candidate.id === domain.credential);
            if (!credential) return { status: false, error: 'Provider credential is required', error_code: 400 };
            if (!credential.is_active) return { status: false, error: 'Provider credential is inactive', error_code: 400 };
            if (!credential.verified) return { status: false, error: credential.last_error || 'Provider credential is not verified', error_code: 400 };
        }
        const records = db.dnsRecords.get(domain.id) ?? [];
        if (method === 'GET') {
            if (dnsFailNextRead) { dnsFailNextRead = false; return { status: false, error: 'Mock provider reconciliation read failed', error_code: 503 }; }
            return { status: true, data: { domain: domain.name, provider: domain.provider, records: records.map((record) => ({ ...record, record_values: [...record.record_values] })) } };
        }
        const type = String(bodyOrParams.type ?? '').toUpperCase();
        const rawName = String(bodyOrParams.name ?? '').trim().toLowerCase().replace(/\.+$/, '');
        const name = !rawName || rawName === '@' ? domain.name : rawName.includes('.') ? rawName : `${rawName}.${domain.name}`;
        if (!type || !rawName) return missingParams('type', 'name');
        const allowedTypes = ['A', 'AAAA', 'CAA', 'CNAME', 'MX', 'NS', 'SRV', 'TXT'];
        if (!allowedTypes.includes(type)) return { status: false, error: `Record type ${type} is not allowed`, error_code: 400 };
        if (!(name === domain.name || name.endsWith(`.${domain.name}`))) return { status: false, error: `Record name must be inside the ${domain.name} zone`, error_code: 400 };
        const labels = name.split('.');
        if (!labels.every((label, position) => label === '*' ? position === 0 : /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/i.test(label))) return { status: false, error: 'Invalid DNS record name', error_code: 400 };
        if (name === domain.name && ['NS', 'SOA'].includes(type)) return { status: false, error: `The apex ${type} record set cannot be changed`, error_code: 400 };
        const index = records.findIndex((record) => record.type === type && record.name.toLowerCase().replace(/\.+$/, '') === name);
        if (path.endsWith('/delete')) {
            if (dnsWriteFault === 'reject') { dnsWriteFault = null; return { status: false, error: 'Mock provider rejected the write', error_code: 503 }; }
            if ('record_values' in bodyOrParams) return { status: false, error: 'Whole-set deletion does not accept record_values', error_code: 400 };
            if (domain.provider === 'godaddy') return { status: false, error: 'GoDaddy cannot delete the last value in a record set', error_code: 400 };
            if (index >= 0) records.splice(index, 1);
        } else {
            if (dnsWriteFault === 'reject') { dnsWriteFault = null; return { status: false, error: 'Mock provider rejected the write', error_code: 503 }; }
            if (!Array.isArray(bodyOrParams.record_values) || bodyOrParams.record_values.length === 0 || bodyOrParams.record_values.some((value) => typeof value !== 'string' || value === '')) return { status: false, error: 'record_values must be a non-empty list', error_code: 400 };
            const ttl = Number(bodyOrParams.ttl);
            if (!Number.isInteger(ttl) || ttl <= 0) return { status: false, error: 'ttl must be a positive integer', error_code: 400 };
            const values = bodyOrParams.record_values.map(String);
            const colliding = records.filter((record, candidateIndex) => candidateIndex !== index && record.name.toLowerCase().replace(/\.+$/, '') === name);
            if ((type === 'CNAME' && colliding.length) || (type !== 'CNAME' && colliding.some((record) => record.type === 'CNAME'))) return { status: false, error: 'CNAME cannot coexist with another record at the same name', error_code: 400 };
            const next = { type, name, record_values: values, ttl: domain.provider === 'godaddy' ? Math.max(600, ttl) : ttl };
            if (index >= 0) records[index] = next;
            else records.push(next);
        }
        db.dnsRecords.set(domain.id, records);
        if (dnsWriteFault === 'ambiguous') { dnsWriteFault = null; return { status: false, error: 'Mock transport lost the applied response', error_code: 503 }; }
        if (dnsWriteFault === 'reconcile') { dnsWriteFault = null; dnsFailNextRead = true; }
        return { status: true, change_id: domain.provider === 'route53' ? `mock-change-${Date.now()}` : null, provider: domain.provider };
    }

    if (path === '/api/dnsman/certificate/request' || path === '/api/dnsman/certificate/revoke') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const body = opts.body ?? {};
        if (path.endsWith('/request')) {
            const domain = db.dnsDomains.find((candidate) => candidate.id === Number(body.domain));
            if (!domain) return { status: false, error: 'Domain not found', error_code: 404 };
            if (domain.group == null ? !caller.is_superuser : !dnsMemberCan(caller, domain.group, true)) return permissionDenied();
            const now = Math.floor(Date.now() / 1000);
            const row: MockDnsCertificate = {
                id: Math.max(8400, ...db.dnsCertificates.map((candidate) => candidate.id)) + 1,
                created: now, modified: now, domain: domain.id, common_name: domain.name,
                sans: Array.isArray(body.names) ? body.names.map(String) : [domain.name, `*.${domain.name}`],
                status: 'pending', issuer: null, serial: null, not_before: null,
                not_after: null, renew_after: null, last_error: null, attempts: 0,
            };
            db.dnsCertificates.unshift(row);
            return { status: true, data: serializeDnsCertificate(row) };
        }
        const row = db.dnsCertificates.find((candidate) => candidate.id === Number(body.certificate));
        if (!row) return { status: false, error: 'Certificate not found', error_code: 404 };
        const domain = db.dnsDomains.find((candidate) => candidate.id === row.domain);
        if (!domain || (domain.group == null ? !caller.is_superuser : !dnsMemberCan(caller, domain.group, true))) return permissionDenied();
        row.status = 'revoked'; row.modified = Math.floor(Date.now() / 1000);
        return { status: true, data: serializeDnsCertificate(row) };
    }

    if (path.startsWith('/api/dnsman/registrar/')) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const action = path.slice('/api/dnsman/registrar/'.length);
        const body = opts.body ?? {};
        const houseAction = ['discover', 'adopt', 'assign-group'].includes(action);
        if (houseAction && !caller.is_superuser) return permissionDenied();
        if (!houseAction) {
            const groupId = Number(body.group ?? opts.params?.group ?? 0);
            if (groupId > 0 ? !dnsMemberCan(caller, groupId, action !== 'search' && action !== 'suggest')
                : !hasGlobalPermission(caller, action === 'search' || action === 'suggest' ? DNS_VIEW_GRANTS : DNS_MANAGE_GRANTS)) return permissionDenied();
        }
        const resultRow = (name: string) => {
            const normalized = name.trim().toLowerCase().replace(/\.+$/, '');
            const tld = normalized.includes('.') ? normalized.split('.').pop()! : null;
            const available = normalized.includes('taken') ? false : normalized.includes('unknown') ? null : true;
            return { name: normalized, available, status: available === true ? 'AVAILABLE' : available === false ? 'UNAVAILABLE' : null, price: available === true ? '12.00' : null, currency: available === true ? 'USD' : null, tld, tld_supported: tld != null, privacy_supported: tld != null, reason: available === false ? 'This domain is already registered.' : available === null ? 'The registry did not answer for this name yet — try the search again in a moment.' : null };
        };
        if (action === 'search') {
            if (Array.isArray(body.domains)) return { status: true, data: { results: body.domains.map((name) => resultRow(String(name))) } };
            if (Array.isArray(body.tlds)) {
                const base = String(body.domain ?? '').split('.')[0];
                return { status: true, data: { results: body.tlds.map((tld) => resultRow(`${base}.${String(tld).replace(/^\./, '')}`)) } };
            }
            return { status: true, data: resultRow(String(body.domain ?? '')) };
        }
        if (action === 'suggest') {
            const base = String(body.domain ?? '').split('.')[0] || 'example';
            const count = Math.max(1, Math.min(Number(body.count ?? 10), 50));
            return { status: true, data: { results: Array.from({ length: count }, (_, index) => resultRow(`${base}${index + 1}.com`)) } };
        }
        if (action === 'quote') {
            const groupId = Number(body.group);
            const group = db.groups.find((candidate) => candidate.id === groupId && candidate.is_active);
            if (!group || !body.domain) return missingParams('group', 'domain');
            const now = Math.floor(Date.now() / 1000);
            const id = Math.max(8300, ...db.domainPurchases.map((candidate) => candidate.id)) + 1;
            const purchase: MockDomainPurchase = { id, created: now, modified: now, group: groupId, user: caller.id, domain_name: String(body.domain).toLowerCase(), kind: 'register', status: 'quoted', price: '12.00', cost: '12.00', currency: 'USD', years: Number(body.years ?? 1), quote_expires: now + 900, operation_id: null, error: null, metadata: {} };
            db.domainPurchases.unshift(purchase);
            return { status: true, data: { purchase: id, name: purchase.domain_name, price: purchase.price, currency: purchase.currency, years: purchase.years, token: `mock-confirm-${id}`, expires: purchase.quote_expires, privacy_supported: true } };
        }
        if (action === 'purchase') {
            const purchase = db.domainPurchases.find((candidate) => candidate.id === Number(body.purchase));
            if (!purchase || String(body.confirm_token ?? '') !== `mock-confirm-${purchase?.id}` || purchase.status !== 'quoted') return { status: false, error: 'Invalid or expired confirmation token', error_code: 400 };
            purchase.status = 'completed'; purchase.operation_id = `op-mock-${purchase.id}`; purchase.modified = Math.floor(Date.now() / 1000);
            const now = purchase.modified;
            const domain: MockDnsDomain = { id: Math.max(8200, ...db.dnsDomains.map((candidate) => candidate.id)) + 1, created: now, modified: now, group: purchase.group, user: caller.id, name: purchase.domain_name, provider: 'route53', credential: null, status: 'active', hosted_zone_id: `ZMOCK${purchase.id}`, auto_renew: true, privacy: true, verified: true, registered_on: now, expires: now + purchase.years * 365 * 86400, last_error: null, metadata: {} };
            db.dnsDomains.push(domain); db.dnsRecords.set(domain.id, []);
            return { status: true, data: serializeDnsDomain(domain) };
        }
        if (action === 'register-existing') {
            const credential = db.dnsCredentials.find((candidate) => candidate.id === Number(body.credential));
            if (!credential || !credential.is_active || !credential.verified || credential.group !== Number(body.group)) return { status: false, error: 'A verified credential is required', error_code: 400 };
            const now = Math.floor(Date.now() / 1000);
            const domain: MockDnsDomain = { id: Math.max(8200, ...db.dnsDomains.map((candidate) => candidate.id)) + 1, created: now, modified: now, group: credential.group, user: caller.id, name: String(body.domain).toLowerCase(), provider: credential.provider, credential: credential.id, status: 'active', hosted_zone_id: null, auto_renew: false, privacy: false, verified: true, registered_on: null, expires: null, last_error: null, metadata: {} };
            db.dnsDomains.push(domain); db.dnsRecords.set(domain.id, []);
            return { status: true, data: serializeDnsDomain(domain) };
        }
        if (action === 'discover') {
            const untrackedValue = opts.params?.untracked ?? false;
            const untrackedOnly = typeof untrackedValue === 'string'
                ? ['1', 'true', 'yes'].includes(untrackedValue.toLowerCase())
                : Boolean(untrackedValue);
            const domains = [
                ...db.dnsDomains.filter((domain) => domain.provider === 'route53').map((domain) => ({
                    name: domain.name, registered: domain.registered_on != null,
                    hosted_zone: domain.hosted_zone_id != null, hosted_zone_id: domain.hosted_zone_id,
                    record_count: (db.dnsRecords.get(domain.id) ?? []).length,
                    expires: domain.expires, auto_renew: domain.auto_renew,
                    tracked: true, domain: domain.id, adoptable: false,
                    reason: 'already tracked by this system',
                })),
                ...(!db.dnsDomains.some((domain) => domain.name === 'untracked-house.example') ? [{
                    name: 'untracked-house.example', registered: false, hosted_zone: true,
                    hosted_zone_id: 'ZUNTRACKEDHOUSE', record_count: 3,
                    expires: null, auto_renew: null, tracked: false, domain: null,
                    adoptable: true, reason: null,
                }] : []),
            ].filter((row) => !untrackedOnly || !row.tracked)
                .sort((left, right) => left.name.localeCompare(right.name));
            return { status: true, data: { count: domains.length, truncated: false, domains } };
        }
        if (action === 'adopt') {
            const now = Math.floor(Date.now() / 1000);
            const groupId = body.group == null ? null : Number(body.group);
            const domain: MockDnsDomain = { id: Math.max(8200, ...db.dnsDomains.map((candidate) => candidate.id)) + 1, created: now, modified: now, group: groupId, user: caller.id, name: String(body.domain).toLowerCase(), provider: 'route53', credential: null, status: 'active', hosted_zone_id: `ZADOPT${now}`, auto_renew: false, privacy: true, verified: true, registered_on: null, expires: null, last_error: null, metadata: {} };
            db.dnsDomains.push(domain); db.dnsRecords.set(domain.id, []);
            return { status: true, data: serializeDnsDomain(domain) };
        }
        if (action === 'assign-group') {
            const domain = db.dnsDomains.find((candidate) => candidate.id === Number(body.domain));
            const group = db.groups.find((candidate) => candidate.id === Number(body.group) && candidate.is_active);
            if (!domain || !group || domain.group != null) return { status: false, error: 'Domain cannot be assigned', error_code: 400 };
            domain.group = group.id; domain.modified = Math.floor(Date.now() / 1000);
            return { status: true, data: serializeDnsDomain(domain) };
        }
    }

    if (path === '/api/dnsman/registrant') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const groupId = requestGroupId(opts);
        if (groupId === 0 ? !caller.is_superuser : !dnsMemberCan(caller, groupId, true)) return permissionDenied();
        const contact = method === 'POST' && opts.body?.contact && typeof opts.body.contact === 'object'
            ? { ...opts.body.contact } : null;
        return { status: true, data: { scope: groupId > 0 ? 'group' : 'global', group: groupId || null, contact: opts.body?.clear ? null : contact, source: contact ? 'database' : 'none', inherited: groupId > 0 && !contact, effective_configured: groupId === 0 || groupId % 2 === 1 || Boolean(contact), problems: [] } };
    }

    if (path === '/api/dnsman/whois' || path === '/api/dnsman/whois/privacy') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const input = method === 'GET' ? opts.params ?? {} : opts.body ?? {};
        const domain = db.dnsDomains.find((candidate) => candidate.id === Number(input.domain));
        if (!domain) return { status: false, error: 'Domain not found', error_code: 404 };
        if (domain.provider !== 'route53') return { status: false, error: 'Registrar operations are not available for this provider', error_code: 400 };
        if (domain.group == null ? !caller.is_superuser : !dnsMemberCan(caller, domain.group, true)) return permissionDenied();
        if (path.endsWith('/privacy')) {
            domain.privacy = Boolean(input.enabled); domain.modified = Math.floor(Date.now() / 1000);
            return { status: true, data: { name: domain.name, privacy: domain.privacy, operation_id: `op-privacy-${domain.id}` } };
        }
        if (method === 'POST') return { status: true, data: { name: domain.name, operation_id: `op-contact-${domain.id}` } };
        const transientContact = { ContactType: 'COMPANY', FirstName: 'Example', LastName: 'Operator', OrganizationName: 'Example Operations', AddressLine1: '100 Example Way', City: 'Example City', State: 'CA', CountryCode: 'US', ZipCode: '90000', PhoneNumber: '+1.5555550100', Email: 'dns-contact@example.invalid' };
        return { status: true, data: { name: domain.name, registrant: transientContact, admin: transientContact, tech: transientContact, privacy: domain.privacy, admin_privacy: domain.privacy, registrant_privacy: domain.privacy, tech_privacy: domain.privacy, auto_renew: domain.auto_renew, nameservers: ['ns-1.example.invalid', 'ns-2.example.invalid'], registrar: 'Amazon Registrar, Inc.', registered_on: domain.registered_on, expires: domain.expires, status_list: ['ok'], privacy_supported: true } };
    }
    // ══ end DNSMan wire ═══════════════════════════════════════════════
    // ── Settings — plaintext stays private; secrets serialize masked ─────
    const oneSetting = path.match(/^\/api\/settings\/(\d+)$/);
    if (oneSetting || path === '/api/settings') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (!hasGlobalPermission(caller, ['manage_settings', 'groups'])) return permissionDenied();
        if (oneSetting) {
            const row = db.settings.find((candidate) => candidate.id === Number(oneSetting[1]));
            if (!row) return { status: false, error: 'Setting not found', error_code: 404 };
            if (opts.method === 'DELETE') return { status: false, error: 'DELETE not allowed: Setting', error_code: 403 };
            if (opts.method === 'POST' && opts.body) {
                for (const [field, value] of Object.entries(opts.body)) {
                    if (field === 'is_secret') row.is_secret = Boolean(value);
                    else if (field === 'value') {
                        if (row.is_secret) { row.value = ''; row.secretValue = value; }
                        else { row.value = typeof value === 'string' ? value : JSON.stringify(value); row.secretValue = null; }
                    } else if (field === 'key') row.key = String(value);
                    else if (field === 'group') row.group = value == null || value === '' ? null : Number(value);
                }
                row.modified = Math.floor(Date.now() / 1000);
            }
            return { status: true, data: serializeSetting(row), graph: 'default' };
        }
        if (opts.method === 'POST' && opts.body) {
            const now = Math.floor(Date.now() / 1000);
            const row: MockSetting = { id: Math.max(0, ...db.settings.map((candidate) => candidate.id)) + 1, created: now, modified: now, key: '', value: '', is_secret: false, group: null, secretValue: null };
            for (const [field, value] of Object.entries(opts.body)) {
                if (field === 'is_secret') row.is_secret = Boolean(value);
                else if (field === 'value') {
                    if (row.is_secret) row.secretValue = value;
                    else row.value = typeof value === 'string' ? value : JSON.stringify(value);
                } else if (field === 'key') row.key = String(value);
                else if (field === 'group') row.group = value == null || value === '' ? null : Number(value);
            }
            if (!row.key) return { status: false, error: 'key is required', error_code: 400 };
            if (row.group != null && db.settings.some((candidate) => candidate.group === row.group && candidate.key === row.key)) return { status: false, error: 'Setting with this Key and Group already exists.', error_code: 400 };
            db.settings.push(row);
            return { status: true, data: serializeSetting(row), graph: 'default' };
        }
        const result = listRows(db.settings as unknown as Record<string, unknown>[], opts.params ?? {}, (row) => String(row.key), 'key');
        return { ...result, data: (result.data as unknown as MockSetting[]).map(serializeSetting) };
    }
    // ── Metrics permission plane (top-level response, not model envelopes) ──
    const metricsPermMatch = path.match(/^\/api\/metrics\/permissions(?:\/(.+))?$/);
    if (metricsPermMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (!hasGlobalPermission(caller, ['manage_incidents', 'metrics', 'manage_metrics'])) return permissionDenied();
        let account = metricsPermMatch[1] ? decodeURIComponent(metricsPermMatch[1]) : null;
        if (opts.method === 'POST' || opts.method === 'PUT') account = account || (opts.body?.account ? String(opts.body.account) : null);
        if (opts.method === 'DELETE' && account) {
            db.metricPermissions.set(account, { view_permissions: null, write_permissions: null });
            return { status: true, account, action: 'deleted' };
        }
        if ((opts.method === 'POST' || opts.method === 'PUT') && account) {
            const split = (value: unknown) => String(value ?? '').split(',');
            const view = split(opts.body?.view_permissions);
            const write = split(opts.body?.write_permissions);
            db.metricPermissions.set(account, {
                view_permissions: view.length === 1 && view[0] === '' ? null : view.length === 1 ? view[0]! : view,
                write_permissions: write.length === 1 && write[0] === '' ? null : write.length === 1 ? write[0]! : write,
            });
            return { status: true, id: account, account, view_permissions: view, write_permissions: write, action: 'set' };
        }
        if (account) {
            const row = db.metricPermissions.get(account) ?? { view_permissions: null, write_permissions: null };
            return { status: true, id: account, account, ...row };
        }
        const data = [...db.metricPermissions.entries()].map(([id, row]) => ({ id, account: id, ...row }));
        return { status: true, data, size: 10, start: 0, count: data.length };
    }
    // ── Security tickets + queued Maestro links ───────────────────────
    const ticketMatch = path.match(/^\/api\/incident\/ticket(?:\/(\d+))?$/);
    if (ticketMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const canView = hasGlobalPermission(caller, ['view_security', 'security']);
        const canManage = hasGlobalPermission(caller, ['manage_security', 'security']);
        if (!canView) return permissionDenied();
        const detailId = ticketMatch[1] ? Number(ticketMatch[1]) : null;
        if (detailId != null) {
            const row = db.tickets.find((candidate) => candidate.id === detailId);
            if (!row) return { status: false, error: 'Ticket not found', error_code: 404 };
            if (method === 'DELETE') {
                if (!canManage) return permissionDenied();
                if (db.maestroItemLinks.some((candidate) => candidate.ticket === row.id)) {
                    return { status: false, error: 'Ticket is linked to a Maestro item', error_code: 409 };
                }
                db.tickets = db.tickets.filter((candidate) => candidate.id !== row.id);
                db.ticketNotes = db.ticketNotes.filter((candidate) => candidate.parent !== row.id);
                return { status: 'deleted' };
            }
            if (method === 'POST' && opts.body) {
                if (!canManage) return permissionDenied();
                const oldStatus = row.status;
                const body = opts.body;
                if ('title' in body) {
                    const title = String(body.title ?? '').trim();
                    if (!title) return { status: false, error: 'title is required', error_code: 400 };
                    row.title = title;
                }
                if ('priority' in body) {
                    const priority = Number(body.priority);
                    if (!Number.isInteger(priority) || priority < 1 || priority > 10) return { status: false, error: 'priority must be a whole number from 1 to 10', error_code: 400 };
                    row.priority = priority;
                }
                if ('assignee' in body) {
                    const assignee = body.assignee == null || body.assignee === '' ? null : Number(body.assignee);
                    if (assignee != null && !db.users.some((candidate) => candidate.id === assignee)) return { status: false, error: 'Assignee not found', error_code: 404 };
                    row.assignee = assignee;
                }
                if ('description' in body) row.description = body.description == null ? null : String(body.description);
                if ('category' in body) row.category = String(body.category);
                if ('status' in body) row.status = String(body.status);
                if ('enable_llm' in body) row.metadata = { ...row.metadata, llm_enabled: true };
                if ('disable_llm' in body) row.metadata = { ...row.metadata, llm_enabled: false };
                if ('push_to_maestro' in body && !db.maestroItemLinks.some((candidate) => candidate.ticket === row.id)) {
                    const queuedTicketId = row.id;
                    setTimeout(() => {
                        if (db.maestroItemLinks.some((candidate) => candidate.ticket === queuedTicketId)) return;
                        const now = Math.floor(Date.now() / 1000);
                        db.maestroItemLinks.push({
                            id: Math.max(0, ...db.maestroItemLinks.map((candidate) => candidate.id)) + 1,
                            created: now, modified: now, ticket: queuedTicketId, incident: row.incident,
                            remote_integration_id: 'mock-maestro', remote_item_id: 2000 + queuedTicketId,
                            remote_board_id: 7, remote_url: `https://maestro.example.test/items/${2000 + queuedTicketId}`,
                            last_synced: now, source_kind: 'ticket', source_id: queuedTicketId,
                        });
                    }, 250);
                }
                row.modified = Math.floor(Date.now() / 1000);
                if (row.status !== oldStatus) {
                    db.ticketNotes.unshift({
                        id: Math.max(0, ...db.ticketNotes.map((candidate) => candidate.id)) + 1,
                        parent: row.id, created: row.modified, group: row.group, user: caller.id,
                        note: `Status changed from ${oldStatus} to ${row.status}.`, media: null,
                        metadata: { type: 'status_change', old_status: oldStatus, new_status: row.status },
                    });
                }
                return { status: true, data: serializeTicket(row), graph: 'default' };
            }
            return { status: true, data: serializeTicket(row), graph: 'default' };
        }
        if (method === 'POST' && opts.body) {
            if (!canManage) return permissionDenied();
            const title = String(opts.body.title ?? '').trim();
            const priority = Number(opts.body.priority ?? 5);
            if (!title) return { status: false, error: 'title is required', error_code: 400 };
            if (!Number.isInteger(priority) || priority < 1 || priority > 10) return { status: false, error: 'priority must be a whole number from 1 to 10', error_code: 400 };
            const assignee = opts.body.assignee == null || opts.body.assignee === '' ? null : Number(opts.body.assignee);
            if (assignee != null && !db.users.some((candidate) => candidate.id === assignee)) return { status: false, error: 'Assignee not found', error_code: 404 };
            const now = Math.floor(Date.now() / 1000);
            const row: MockTicket = {
                id: Math.max(0, ...db.tickets.map((candidate) => candidate.id)) + 1,
                created: now, modified: now, user: caller.id,
                group: opts.body.group == null || opts.body.group === '' ? null : Number(opts.body.group),
                title, description: opts.body.description == null ? null : String(opts.body.description),
                status: String(opts.body.status ?? 'new'), priority,
                category: String(opts.body.category ?? 'ticket'), assignee, incident: null,
                metadata: isPlainObject(opts.body.metadata) ? { ...opts.body.metadata } : {},
            };
            db.tickets.push(row);
            return { status: true, data: serializeTicket(row), graph: 'default' };
        }
        const params = opts.params ?? {};
        const search = (row: Record<string, unknown>) => `${row.title ?? ''} ${row.description ?? ''} ${row.status ?? ''} ${row.category ?? ''}`;
        if (params.download_format) {
            const full = listRows(db.tickets as unknown as Record<string, unknown>[], { ...params, start: 0, size: db.tickets.length }, search, '-priority');
            return exportRows((full.data as unknown as MockTicket[]).map(serializeTicket), params, 'Ticket');
        }
        const result = listRows(db.tickets as unknown as Record<string, unknown>[], params, search, '-priority');
        return { ...result, data: (result.data as unknown as MockTicket[]).map(serializeTicket) };
    }
    const maestroLinkMatch = path.match(/^\/api\/incident\/maestro\/item-link(?:\/(\d+))?$/);
    if (maestroLinkMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (!hasGlobalPermission(caller, ['view_security', 'security'])) return permissionDenied();
        if (method !== 'GET') return { status: false, error: 'MaestroItemLink is read-only', error_code: 403 };
        if (maestroLinkMatch[1]) {
            const row = db.maestroItemLinks.find((candidate) => candidate.id === Number(maestroLinkMatch[1]));
            if (!row) return { status: false, error: 'MaestroItemLink not found', error_code: 404 };
            return { status: true, data: serializeMaestroItemLink(row), graph: 'default' };
        }
        const result = listRows(db.maestroItemLinks as unknown as Record<string, unknown>[], opts.params ?? {}, (row) => `${row.remote_item_id ?? ''} ${row.remote_integration_id ?? ''}`, '-modified');
        return { ...result, data: (result.data as unknown as MockMaestroItemLink[]).map(serializeMaestroItemLink) };
    }
    // ── Shared record feeds: newest 100, parent/group scoped, graph=default ──
    const ticketNoteMatch = path.match(/^\/api\/incident\/ticket\/note(?:\/(\d+))?$/);
    if (ticketNoteMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (!hasGlobalPermission(caller, ['view_security', 'security'])) return permissionDenied();
        if (ticketNoteMatch[1]) {
            const row = db.ticketNotes.find((candidate) => candidate.id === Number(ticketNoteMatch[1]));
            if (!row) return { status: false, error: 'TicketNote not found', error_code: 404 };
            return { status: true, data: serializeTicketNote(row), graph: 'default' };
        }
        if (opts.method === 'POST' && opts.body) {
            if (!hasGlobalPermission(caller, ['manage_security', 'security'])) return permissionDenied();
            const parentId = Number(opts.body.parent ?? 0);
            const parent = db.tickets.find((candidate) => candidate.id === parentId);
            if (!parent) return { status: false, error: 'Ticket not found', error_code: 404 };
            if (opts.body.group != null && Number(opts.body.group) !== parent.group) return permissionDenied();
            const now = Math.floor(Date.now() / 1000);
            const row: MockTicketNote = {
                id: Math.max(0, ...db.ticketNotes.map((candidate) => candidate.id)) + 1,
                parent: parentId, created: now, group: parent.group, user: caller.id,
                note: opts.body.note == null ? null : String(opts.body.note), media: null,
                metadata: isPlainObject(opts.body.metadata) ? { ...opts.body.metadata } : {},
            };
            db.ticketNotes.unshift(row);
            const response = isPlainObject(row.metadata.action_response) ? row.metadata.action_response : null;
            if (response) {
                const handler = response.handler;
                const source = db.ticketNotes.find((candidate) => {
                    if (candidate.parent !== parentId || candidate.id === row.id) return false;
                    const action = isPlainObject(candidate.metadata.action) ? candidate.metadata.action : null;
                    return action != null && action.handler === handler && action.resolved !== true;
                });
                if (source) {
                    const action = { ...(source.metadata.action as Record<string, unknown>) };
                    const decision = response.action === 'deny' ? 'deny' : 'approve';
                    action.resolved = true;
                    action.resolution = decision;
                    source.metadata = { ...source.metadata, action };
                    parent.status = decision === 'approve' ? 'resolved' : 'closed';
                    parent.modified = now;
                }
            }
            return { status: true, data: serializeTicketNote(row), graph: 'default' };
        }
        const requestedSize = Number(opts.params?.size ?? 100);
        const params: Params = { ...(opts.params ?? {}), start: Number(opts.params?.start ?? 0), size: Math.min(100, Math.max(0, requestedSize)), sort: '-created', graph: 'default' };
        const result = listRows(db.ticketNotes as unknown as Record<string, unknown>[], params, (row) => String(row.note ?? ''), '-created');
        return { ...result, graph: 'default', data: (result.data as unknown as MockTicketNote[]).map(serializeTicketNote) };
    }
    const incidentHistoryMatch = path.match(/^\/api\/incident\/incident(?:\/(\d+))?\/history$/);
    if (incidentHistoryMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const canView = hasGlobalPermission(caller, ['view_security', 'security']);
        const canManage = hasGlobalPermission(caller, ['manage_security', 'security']);
        if (!canView) return permissionDenied();
        if (method === 'DELETE') return { status: false, error: 'Incident history is immutable', error_code: 403 };
        const detailId = incidentHistoryMatch[1] ? Number(incidentHistoryMatch[1]) : null;
        if (detailId != null) {
            const row = db.incidentHistory.find((candidate) => candidate.id === detailId);
            if (!row) return { status: false, error: 'IncidentHistory not found', error_code: 404 };
            return { status: true, data: serializeIncidentHistory(row), graph: 'default' };
        }
        if (opts.method === 'POST' && opts.body) {
            if (!canManage) return permissionDenied();
            const parentId = Number(opts.body.parent ?? 0);
            const parent = db.incidentRecords.find((candidate) => candidate.id === parentId);
            if (!parent) return { status: false, error: 'Incident not found', error_code: 404 };
            const now = Math.floor(Date.now() / 1000);
            const row: MockIncidentHistory = {
                id: Math.max(0, ...db.incidentHistory.map((candidate) => candidate.id)) + 1,
                parent: parentId, created: now, group: parent.group_id,
                kind: opts.body.kind == null ? null : String(opts.body.kind),
                to: opts.body.to == null ? null : Number(opts.body.to), user: caller.id,
                state: Number(opts.body.state ?? 0), priority: Number(opts.body.priority ?? 0),
                note: opts.body.note == null ? null : String(opts.body.note), media: null,
                metadata: isPlainObject(opts.body.metadata) ? { ...opts.body.metadata } : {},
            };
            db.incidentHistory.unshift(row);
            return { status: true, data: serializeIncidentHistory(row), graph: 'default' };
        }
        const requestedSize = Number(opts.params?.size ?? 100);
        const params: Params = { ...(opts.params ?? {}), start: Number(opts.params?.start ?? 0), size: Math.min(100, Math.max(0, requestedSize)), sort: '-created', graph: 'default' };
        const result = listRows(db.incidentHistory as unknown as Record<string, unknown>[], params, (row) => String(row.note ?? ''), '-created');
        return { ...result, graph: 'default', data: (result.data as unknown as MockIncidentHistory[]).map(serializeIncidentHistory) };
    }
    const incidentMatch = path.match(/^\/api\/incident\/incident(?:\/(\d+))?$/);
    if (incidentMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const canView = hasGlobalPermission(caller, ['view_security', 'security']);
        const canManage = hasGlobalPermission(caller, ['manage_security', 'security']);
        if (!canView) return permissionDenied();
        const detailId = incidentMatch[1] ? Number(incidentMatch[1]) : null;
        if (detailId != null) {
            const row = db.incidentRecords.find((candidate) => candidate.id === detailId);
            if (!row) return { status: false, error: 'Incident not found', error_code: 404 };
            if (method === 'DELETE') {
                if (!hasGlobalPermission(caller, ['manage_security'])) return permissionDenied();
                if (row.metadata.do_not_delete) return { status: false, error: 'Incident is protected from deletion', error_code: 409 };
                db.incidentRecords = db.incidentRecords.filter((candidate) => candidate.id !== row.id);
                db.incidentHistory = db.incidentHistory.filter((candidate) => candidate.parent !== row.id);
                db.incidentEvents = db.incidentEvents.filter((candidate) => candidate.incident !== row.id);
                return { status: 'deleted' };
            }
            if (method === 'POST' && opts.body) {
                if (!canManage) return permissionDenied();
                if (Array.isArray(opts.body.merge)) {
                    const sourceIds = [...new Set(opts.body.merge.map(Number))].filter((sourceId) => sourceId !== row.id);
                    const sources = sourceIds.map((sourceId) => db.incidentRecords.find((candidate) => candidate.id === sourceId));
                    if (sources.some((source) => !source)) return { status: false, error: 'One or more source incidents were not found', error_code: 404 };
                    const linked = [row, ...sources as MockIncident[]].filter((candidate) => candidate.metadata.maestro_url);
                    if (linked.length > 1) return { status: false, error: 'Cannot merge incidents linked to different Maestro items', error_code: 409 };
                    let moved = 0;
                    for (const source of sources as MockIncident[]) {
                        for (const event of db.incidentEvents) if (event.incident === source.id) { event.incident = row.id; moved += 1; }
                        for (const ticket of db.tickets) if (ticket.incident === source.id) ticket.incident = row.id;
                        db.incidentHistory.unshift({
                            id: Math.max(0, ...db.incidentHistory.map((candidate) => candidate.id)) + 1,
                            parent: row.id, created: Math.floor(Date.now() / 1000), group: row.group_id,
                            kind: 'merged', to: null, user: caller.id, state: Number(row.state) || 0,
                            priority: row.priority, note: `Merged incident #${source.id}`, media: null, metadata: {},
                        });
                    }
                    row.metadata = { ...row.metadata, event_count: Number(row.metadata.event_count ?? 0) + moved };
                    db.incidentRecords = db.incidentRecords.filter((candidate) => !sourceIds.includes(candidate.id));
                    db.incidentHistory = db.incidentHistory.filter((candidate) => !sourceIds.includes(candidate.parent));
                    return { status: true };
                }
                const oldStatus = row.status;
                if ('status' in opts.body) row.status = String(opts.body.status);
                if ('priority' in opts.body) row.priority = Number(opts.body.priority);
                if ('state' in opts.body) row.state = String(opts.body.state);
                if ('metadata' in opts.body && isPlainObject(opts.body.metadata)) row.metadata = mergeDicts(row.metadata, opts.body.metadata);
                if (row.status !== oldStatus || 'priority' in opts.body || 'metadata' in opts.body) {
                    db.incidentHistory.unshift({
                        id: Math.max(0, ...db.incidentHistory.map((candidate) => candidate.id)) + 1,
                        parent: row.id, created: Math.floor(Date.now() / 1000), group: row.group_id,
                        kind: row.status !== oldStatus ? 'status_change' : 'updated', to: null, user: caller.id,
                        state: Number(row.state) || 0, priority: row.priority,
                        note: row.status !== oldStatus ? `Status changed from ${oldStatus} to ${row.status}.` : 'Incident updated.',
                        media: null, metadata: row.status !== oldStatus ? { type: 'status_change', old_status: oldStatus, new_status: row.status } : {},
                    });
                }
                return { status: true, data: { ...row }, graph: String(opts.params?.graph ?? 'default') };
            }
            const graph = String(opts.params?.graph ?? 'default');
            return { status: true, data: { ...row, ...(graph === 'detailed' ? { ip_info: { ip_address: row.source_ip, country_code: row.country_code } } : {}) }, graph };
        }
        if (method === 'POST') return { status: false, error: 'Incident creation is not available', error_code: 403 };
        const result = listRows(
            db.incidentRecords as unknown as Record<string, unknown>[],
            opts.params ?? {},
            (row) => `${row.details ?? ''}`,
            '-id',
        );
        return { ...result, graph: 'default' };
    }
    // ── Bouncer operator data ─────────────────────────────────────────
    const bouncerViewPerms = ['manage_users', 'view_security', 'manage_security', 'security', 'users'];
    const bouncerSavePerms = ['manage_users', 'manage_security', 'security', 'users'];
    const bouncerSignalMatch = path.match(/^\/api\/account\/bouncer\/signal(?:\/(\d+))?$/);
    if (bouncerSignalMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (!hasGlobalPermission(caller, bouncerViewPerms)) return permissionDenied();
        if (opts.method === 'POST' || opts.method === 'DELETE') return { status: false, error: 'BouncerSignal is read-only', error_code: 403 };
        if (bouncerSignalMatch[1]) {
            const row = db.bouncerSignals.find((candidate) => candidate.id === Number(bouncerSignalMatch[1]));
            if (!row) return { status: false, error: 'BouncerSignal not found', error_code: 404 };
            const graph = String(opts.params?.graph ?? 'default');
            return { status: true, data: serializeBouncerSignal(row, graph), graph };
        }
        const graph = String(opts.params?.graph ?? 'list');
        const result = listRows(db.bouncerSignals as unknown as Record<string, unknown>[], opts.params ?? {}, (row) => `${row.muid} ${row.duid} ${row.ip_address ?? ''} ${row.decision}`, '-created');
        return { ...result, graph: opts.params?.graph ? graph : 'list', data: (result.data as unknown as MockBouncerSignal[]).map((row) => serializeBouncerSignal(row, graph)) };
    }
    const bouncerDeviceMatch = path.match(/^\/api\/account\/bouncer\/device(?:\/(\d+))?$/);
    if (bouncerDeviceMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (!hasGlobalPermission(caller, bouncerViewPerms)) return permissionDenied();
        if (bouncerDeviceMatch[1]) {
            const row = db.bouncerDevices.find((candidate) => candidate.id === Number(bouncerDeviceMatch[1]));
            if (!row) return { status: false, error: 'BouncerDevice not found', error_code: 404 };
            if (opts.method === 'DELETE') return { status: false, error: 'DELETE not allowed: BouncerDevice', error_code: 403 };
            if (opts.method === 'POST' && opts.body) {
                if (!hasGlobalPermission(caller, bouncerSavePerms)) return permissionDenied();
                if ('risk_tier' in opts.body) row.risk_tier = String(opts.body.risk_tier);
                if ('fingerprint_id' in opts.body) row.fingerprint_id = opts.body.fingerprint_id == null ? null : String(opts.body.fingerprint_id);
                if (Array.isArray(opts.body.linked_muids)) row.linked_muids = opts.body.linked_muids.map(String);
            }
            return { status: true, data: serializeBouncerDevice(row, 'default'), graph: 'default' };
        }
        const graph = String(opts.params?.graph ?? 'list');
        const result = listRows(db.bouncerDevices as unknown as Record<string, unknown>[], opts.params ?? {}, (row) => `${row.muid} ${row.duid} ${row.fingerprint_id ?? ''} ${row.last_seen_ip ?? ''}`, '-last_seen');
        return { ...result, graph: opts.params?.graph ? graph : 'list', data: (result.data as unknown as MockBouncerDevice[]).map((row) => serializeBouncerDevice(row, graph)) };
    }
    const signatureMatch = path.match(/^\/api\/account\/bouncer\/signature(?:\/(\d+))?$/);
    if (signatureMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (!hasGlobalPermission(caller, bouncerViewPerms)) return permissionDenied();
        if (signatureMatch[1]) {
            const row = db.botSignatures.find((candidate) => candidate.id === Number(signatureMatch[1]));
            if (!row) return { status: false, error: 'BotSignature not found', error_code: 404 };
            if (opts.method === 'DELETE') return { status: false, error: 'DELETE not allowed: BotSignature', error_code: 403 };
            if (opts.method === 'POST' && opts.body) {
                if (!hasGlobalPermission(caller, bouncerSavePerms)) return permissionDenied();
                const sigType = 'sig_type' in opts.body ? String(opts.body.sig_type) : row.sig_type;
                const value = 'value' in opts.body ? String(opts.body.value) : row.value;
                if (!['ip', 'subnet_24', 'subnet_16', 'user_agent', 'fingerprint', 'signal_set'].includes(sigType)) return { status: false, error: 'invalid sig_type', error_code: 400 };
                if (db.botSignatures.some((candidate) => candidate.id !== row.id && candidate.sig_type === sigType && candidate.value === value)) return { status: false, error: 'Bot signature already exists', error_code: 400 };
                row.sig_type = sigType; row.value = value;
                if ('source' in opts.body) row.source = String(opts.body.source);
                if ('confidence' in opts.body) row.confidence = Number(opts.body.confidence);
                if ('expires_at' in opts.body) row.expires_at = opts.body.expires_at == null ? null : Number(opts.body.expires_at);
                if ('is_active' in opts.body) row.is_active = Boolean(opts.body.is_active);
                if ('notes' in opts.body) row.notes = String(opts.body.notes ?? '');
                row.modified = Math.floor(Date.now() / 1000);
            }
            return { status: true, data: serializeBotSignature(row, 'default'), graph: 'default' };
        }
        if (opts.method === 'POST' && opts.body) {
            if (!hasGlobalPermission(caller, bouncerSavePerms)) return permissionDenied();
            const sigType = String(opts.body.sig_type ?? '');
            const value = String(opts.body.value ?? '');
            if (!['ip', 'subnet_24', 'subnet_16', 'user_agent', 'fingerprint', 'signal_set'].includes(sigType)) return { status: false, error: 'invalid sig_type', error_code: 400 };
            if (!value) return { status: false, error: 'value is required', error_code: 400 };
            if (db.botSignatures.some((candidate) => candidate.sig_type === sigType && candidate.value === value)) return { status: false, error: 'Bot signature already exists', error_code: 400 };
            const now = Math.floor(Date.now() / 1000);
            const row: MockBotSignature = { id: Math.max(0, ...db.botSignatures.map((candidate) => candidate.id)) + 1, sig_type: sigType, value, source: String(opts.body.source ?? 'manual'), confidence: Number(opts.body.confidence ?? 0), hit_count: 0, block_count: 0, expires_at: opts.body.expires_at == null ? null : Number(opts.body.expires_at), is_active: opts.body.is_active == null ? true : Boolean(opts.body.is_active), notes: String(opts.body.notes ?? ''), created: now, modified: now };
            db.botSignatures.unshift(row);
            return { status: true, data: serializeBotSignature(row, 'default'), graph: 'default' };
        }
        const graph = String(opts.params?.graph ?? 'list');
        const result = listRows(db.botSignatures as unknown as Record<string, unknown>[], opts.params ?? {}, (row) => `${row.sig_type} ${row.value} ${row.source}`, '-modified');
        return { ...result, graph: opts.params?.graph ? graph : 'list', data: (result.data as unknown as MockBotSignature[]).map((row) => serializeBotSignature(row, graph)) };
    }
    // ╔══════════════════════════════════════════════════════════════════╗
    // ║ #1291 — devices · device locations · login geography · GeoIP     ║
    // ║ Nine endpoints, one contiguous block. Owner scoping, graph       ║
    // ║ selection, POST_SAVE_ACTIONS and the verb refusals are the real  ║
    // ║ ones from django-mojo `account/rest/device.py`,                  ║
    // ║ `account/rest/login_event.py` and the two model RestMetas.       ║
    // ╚══════════════════════════════════════════════════════════════════╝

    // ── Browser devices — /api/user/device (+ /<pk>, /lookup) ──
    // `on_user_device` carries NO URL decorator: the model's VIEW_PERMS
    // (`manage_users | users | owner`) is the whole gate, so a caller without
    // a global grant sees ONLY their own devices.
    const deviceMatch = path.match(/^\/api\/user\/device(?:\/(\d+))?$/);
    if (deviceMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const global = hasGlobalPermission(caller, ['manage_users', 'users']);
        if (deviceMatch[1]) {
            const row = db.devices.find((candidate) => candidate.id === Number(deviceMatch[1]));
            if (!row) return { status: false, error: 'UserDevice not found', error_code: 404 };
            if (!global && row.user !== caller.id) return permissionDenied();
            // No CAN_DELETE on UserDevice ⇒ rest.py defaults it to False.
            if (method === 'DELETE') return { status: false, error: 'DELETE not allowed: UserDevice', error_code: 403 };
            const graph = String(opts.params?.graph ?? 'default');
            return { status: true, data: serializeDevice(row, graph), graph };
        }
        const scoped = global ? db.devices : db.devices.filter((row) => row.user === caller.id);
        const graph = String(opts.params?.graph ?? 'default');
        // UserDevice declares NO SEARCH_FIELDS — only what the fallback can
        // reach (the DUID and the raw user-agent string) is searchable.
        const result = listRows(
            scoped as unknown as Record<string, unknown>[],
            opts.params ?? {},
            (d) => `${d.duid} ${(d as unknown as MockDevice).device_info?.string ?? ''}`,
            '-last_seen',
        );
        return {
            ...result,
            graph,
            data: (result.data as unknown as MockDevice[]).map((row) => serializeDevice(row, graph)),
        };
    }
    // Cross-tenant DUID lookup — requires a GLOBAL grant because on_rest_get
    // does not re-run the permission gate.
    if (path === '/api/user/device/lookup') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const duid = String(opts.params?.duid ?? '');
        if (!duid) return { status: false, error: 'duid is required', error_code: 400 };
        if (!hasGlobalPermission(caller, ['manage_users', 'manage_devices', 'users'])) return permissionDenied();
        const row = db.devices.find((candidate) => candidate.duid === duid);
        if (!row) return { status: false, error: 'Device not found', error_code: 404 };
        const graph = String(opts.params?.graph ?? 'default');
        return { status: true, data: serializeDevice(row, graph), graph };
    }
    // ── Device locations — /api/user/device/location (+ /<pk>) ──
    // TWO gates in series: the URL decorator accepts manage_devices, the
    // MODEL's VIEW_PERMS does not. A caller holding only `manage_devices`
    // therefore passes the first and is denied by the second — which is why
    // `sys.manage_devices` appears in no client permission clause.
    const deviceLocationMatch = path.match(/^\/api\/user\/device\/location(?:\/(\d+))?$/);
    if (deviceLocationMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (!hasGlobalPermission(caller, ['manage_users', 'manage_devices', 'users'])) return permissionDenied();
        if (!hasGlobalPermission(caller, ['manage_users', 'users'])) return permissionDenied();
        if (deviceLocationMatch[1]) {
            const row = db.deviceLocations.find((candidate) => candidate.id === Number(deviceLocationMatch[1]));
            if (!row) return { status: false, error: 'UserDeviceLocation not found', error_code: 404 };
            if (method === 'DELETE') return { status: false, error: 'DELETE not allowed: UserDeviceLocation', error_code: 403 };
            return { status: true, data: serializeDeviceLocation(row), graph: 'default' };
        }
        const result = listRows(
            db.deviceLocations as unknown as Record<string, unknown>[],
            opts.params ?? {},
            (row) => String(row.ip_address ?? ''),
            '-last_seen',
        );
        return {
            ...result,
            graph: 'default',
            data: (result.data as unknown as MockDeviceLocation[]).map((row) => serializeDeviceLocation(row)),
        };
    }
    // ── GeoIP cache — /api/system/geoip (+ /<pk>, /lookup) ──
    const geoIpMatch = path.match(/^\/api\/system\/geoip(?:\/(\d+))?$/);
    if (geoIpMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        // GeoLocatedIP.RestMeta — note there is NO `owner` clause: this model
        // is groupless fleet data, so no self-scoped fallback exists.
        if (!hasGlobalPermission(caller, GEOIP_VIEW_PERMS_MOCK)) return permissionDenied();
        const canSave = hasGlobalPermission(caller, GEOIP_SAVE_PERMS_MOCK);
        if (geoIpMatch[1]) {
            const row = db.geoIps.find((candidate) => candidate.id === Number(geoIpMatch[1]));
            if (!row) return { status: false, error: 'GeoLocatedIP not found', error_code: 404 };
            // GeoLocatedIP declares no CAN_DELETE.
            if (method === 'DELETE') return { status: false, error: 'DELETE not allowed: GeoLocatedIP', error_code: 403 };
            if (method === 'POST' && opts.body) {
                if (!canSave) return permissionDenied();
                const error = applyGeoIpSave(row, opts.body, caller);
                if (error) return { status: false, error, error_code: 400 };
            }
            const graph = String(opts.params?.graph ?? 'default');
            return { status: true, data: serializeGeoIp(row, graph), graph };
        }
        // GeoLocatedIP has no CAN_CREATE path through the collection either —
        // records are minted by geolocate(), i.e. by /lookup.
        if (method === 'POST') return { status: false, error: 'POST not allowed on the GeoIP collection — use /api/system/geoip/lookup', error_code: 403 };
        const graph = String(opts.params?.graph ?? 'default');
        const result = listRows(
            db.geoIps as unknown as Record<string, unknown>[],
            opts.params ?? {},
            // The model's real SEARCH_FIELDS.
            (row) => `${row.ip_address} ${row.city ?? ''} ${row.country_name ?? ''} ${row.asn_org ?? ''} ${row.isp ?? ''}`,
            '-last_seen',
        );
        if (opts.params?.download_format) {
            return exportRows(
                (result.data as unknown as MockGeoIp[]).map((row) => serializeGeoIp(row, graph) as Record<string, unknown>),
                opts.params,
                'GeoLocatedIP',
            );
        }
        return {
            ...result,
            graph,
            data: (result.data as unknown as MockGeoIp[]).map((row) => serializeGeoIp(row, graph)),
        };
    }
    // GET /api/system/geoip/lookup — the federation read path.
    // `@requires_auth()` ONLY: deliberately open to any authenticated
    // identity (a downstream instance uses this one as its GeoIP provider).
    // But the caller does not pick the payload shape — anything richer than
    // the `federation` graph needs the same VIEW_PERMS the CRUD endpoints
    // demand, and everyone else is served `federation` whatever they asked
    // for. Rate limited 30 per source.
    if (path === '/api/system/geoip/lookup') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const ip = String(opts.params?.ip ?? '');
        if (!ip) return { status: false, error: 'ip is required', error_code: 400 };
        geoIpLookupCount += 1;
        if (geoIpLookupCount > GEOIP_LOOKUP_LIMIT) {
            return { status: false, error: 'rate limit exceeded for geoip_lookup (30 per source)', error_code: 429 };
        }
        let graph = String(opts.params?.graph ?? 'default');
        if (graph !== 'federation' && !hasGlobalPermission(caller, GEOIP_VIEW_PERMS_MOCK)) graph = 'federation';
        const row = geolocateMock(ip, mockParamIsTrue(opts.params?.auto_refresh ?? true));
        return { status: true, data: serializeGeoIp(row, graph), graph };
    }
    // ── Login geography — /api/account/logins/summary and /user ──
    // Both are `@requires_global_perms('manage_users','security','users')`;
    // `/user` additionally `@requires_params('user_id')` and answers a 400
    // when it does not parse as an int.
    if (path === '/api/account/logins/summary' || path === '/api/account/logins/user') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (!hasGlobalPermission(caller, ['manage_users', 'security', 'users'])) return permissionDenied();
        let rows = db.loginEvents.filter((row) => row.country_code != null && row.country_code !== '');
        if (path === '/api/account/logins/user') {
            const raw = opts.params?.user_id;
            if (raw == null || raw === '') return { status: false, error: 'user_id is required', error_code: 400 };
            const userId = Number(raw);
            if (!Number.isInteger(userId)) return { status: false, error: 'user_id must be an integer', code: 400 };
            rows = rows.filter((row) => row.user === userId);
        }
        rows = applyMockDateBounds(rows, opts.params ?? {});
        return { status: true, data: buildLoginAggregation(rows, opts.params ?? {}) };
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
    // ── Login events — /api/account/logins (+ /<pk>) ──
    // `uses_model_security(UserLoginEvent)`: VIEW_PERMS carries `owner`, so a
    // caller without a global grant sees only their own logins. CAN_CREATE,
    // CAN_UPDATE and CAN_DELETE are ALL False — every write verb is refused.
    // The wire carries NO `event_type` field, at any graph.
    const loginEventMatch = path.match(/^\/api\/account\/logins(?:\/(\d+))?$/);
    if (loginEventMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const global = hasGlobalPermission(caller, ['manage_users', 'security', 'users']);
        if (loginEventMatch[1]) {
            const row = db.loginEvents.find((candidate) => candidate.id === Number(loginEventMatch[1]));
            if (!row) return { status: false, error: 'UserLoginEvent not found', error_code: 404 };
            if (!global && row.user !== caller.id) return permissionDenied();
            if (method === 'DELETE') return { status: false, error: 'DELETE not allowed: UserLoginEvent', error_code: 403 };
            if (method === 'POST') return { status: false, error: 'UPDATE not allowed: UserLoginEvent', error_code: 403 };
            const graph = String(opts.params?.graph ?? 'default');
            return { status: true, data: serializeLoginEvent(row, graph), graph };
        }
        if (method === 'POST') return { status: false, error: 'CREATE not allowed: UserLoginEvent', error_code: 403 };
        const scoped = global ? db.loginEvents : db.loginEvents.filter((row) => row.user === caller.id);
        const graph = String(opts.params?.graph ?? 'list');
        const result = listRows(
            scoped as unknown as Record<string, unknown>[],
            opts.params ?? {},
            // The model's real SEARCH_FIELDS — user is NOT among them.
            (l) => `${l.ip_address ?? ''} ${l.country_code ?? ''} ${l.region ?? ''} ${l.city ?? ''}`,
            '-created',
        );
        if (opts.params?.download_format) {
            return exportRows(
                (result.data as unknown as MockLoginEvent[]).map((row) => serializeLoginEvent(row, graph) as Record<string, unknown>),
                opts.params,
                'UserLoginEvent',
            );
        }
        return {
            ...result,
            graph,
            data: (result.data as unknown as MockLoginEvent[]).map((row) => serializeLoginEvent(row, graph)),
        };
    }
    // ── Rule engine — exact RuleSet/Rule CRUD and global permissions ──
    const ruleSetMatch = path.match(/^\/api\/incident\/event\/ruleset(?:\/(\d+))?$/);
    if (ruleSetMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const canView = hasGlobalPermission(caller, ['view_security', 'security']);
        const canManage = hasGlobalPermission(caller, ['manage_security', 'security']);
        if (!canView) return permissionDenied();
        const detailId = ruleSetMatch[1] ? Number(ruleSetMatch[1]) : null;
        const validate = (body: Record<string, unknown>, current?: MockRuleSet): string | null => {
            const required = (key: string) => key in body ? String(body[key] ?? '').trim() : String(current?.[key] ?? '').trim();
            if (!required('category')) return 'category is required';
            const numeric = ['priority', 'bundle_by', 'bundle_minutes', 'match_by', 'trigger_count', 'trigger_window', 'retrigger_every'];
            for (const key of numeric) if (key in body && body[key] != null && body[key] !== '' && !Number.isInteger(Number(body[key]))) return `${key} must be an integer`;
            for (const key of ['trigger_count', 'trigger_window', 'retrigger_every']) if (key in body && body[key] != null && Number(body[key]) <= 0) return `${key} must be positive`;
            return null;
        };
        const apply = (row: MockRuleSet, body: Record<string, unknown>) => {
            const target = row as Record<string, unknown>;
            for (const key of ['priority', 'bundle_minutes', 'bundle_by', 'match_by', 'trigger_count', 'trigger_window', 'retrigger_every']) if (key in body) target[key] = body[key] == null || body[key] === '' ? null : Number(body[key]);
            for (const key of ['category', 'name', 'handler']) if (key in body) target[key] = body[key] == null ? null : String(body[key]);
            for (const key of ['bundle_by_rule_set', 'is_active']) if (key in body) target[key] = Boolean(body[key]);
            if (isPlainObject(body.metadata)) row.metadata = mergeDicts(row.metadata, body.metadata);
            row.modified = Math.floor(Date.now() / 1000);
        };
        if (detailId != null) {
            const row = db.ruleSets.find((candidate) => candidate.id === detailId);
            if (!row) return { status: false, error: 'RuleSet not found', error_code: 404 };
            if (method === 'DELETE') { if (!canManage) return permissionDenied(); db.ruleSets = db.ruleSets.filter((candidate) => candidate.id !== detailId); db.rules = db.rules.filter((candidate) => candidate.parent !== detailId); return { status: 'deleted' }; }
            if (method === 'POST' && opts.body) { if (!canManage) return permissionDenied(); const error = validate(opts.body, row); if (error) return { status: false, error, error_code: 400 }; apply(row, opts.body); }
            return { status: true, data: { ...row }, graph: 'default' };
        }
        if (method === 'POST' && opts.body) {
            if (!canManage) return permissionDenied(); const error = validate(opts.body); if (error) return { status: false, error, error_code: 400 };
            const now = Math.floor(Date.now() / 1000); const row: MockRuleSet = { id: Math.max(0, ...db.ruleSets.map((candidate) => candidate.id)) + 1, created: now, modified: now, priority: 0, category: '', name: null, bundle_minutes: 0, bundle_by: 3, bundle_by_rule_set: true, match_by: 0, handler: null, trigger_count: null, trigger_window: null, retrigger_every: null, metadata: {}, is_active: true };
            apply(row, opts.body); db.ruleSets.push(row); return { status: true, data: { ...row }, graph: 'default' };
        }
        const result = listRows(db.ruleSets as unknown as Record<string, unknown>[], opts.params ?? {}, (row) => String(row.name ?? ''), 'priority');
        return { ...result, graph: 'default' };
    }
    const ruleMatch = path.match(/^\/api\/incident\/event\/ruleset\/rule(?:\/(\d+))?$/);
    if (ruleMatch) {
        const caller = userFromBearer(opts.headers); if (!caller) return permissionDenied(401);
        const canView = hasGlobalPermission(caller, ['view_security', 'security']); const canManage = hasGlobalPermission(caller, ['manage_security', 'security']); if (!canView) return permissionDenied();
        const detailId = ruleMatch[1] ? Number(ruleMatch[1]) : null;
        const validate = (body: Record<string, unknown>, current?: MockRule): string | null => {
            const parent = Number(body.parent ?? current?.parent); if (!Number.isInteger(parent) || !db.ruleSets.some((candidate) => candidate.id === parent)) return 'parent is required';
            const field = String(body.field_name ?? current?.field_name ?? '').trim(); if (!field) return 'field_name is required';
            for (const key of ['index', 'is_required']) if (key in body && !Number.isInteger(Number(body[key]))) return `${key} must be an integer`;
            return null;
        };
        const apply = (row: MockRule, body: Record<string, unknown>) => {
            const target = row as Record<string, unknown>;
            for (const key of ['parent', 'index', 'is_required']) if (key in body) target[key] = Number(body[key]);
            for (const key of ['name', 'comparator', 'field_name', 'value', 'value_type']) if (key in body) target[key] = body[key] == null ? null : String(body[key]);
            row.modified = Math.floor(Date.now() / 1000);
        };
        if (detailId != null) {
            const row = db.rules.find((candidate) => candidate.id === detailId); if (!row) return { status: false, error: 'Rule not found', error_code: 404 };
            if (method === 'DELETE') { if (!canManage) return permissionDenied(); db.rules = db.rules.filter((candidate) => candidate.id !== detailId); return { status: 'deleted' }; }
            if (method === 'POST' && opts.body) { if (!canManage) return permissionDenied(); const error = validate(opts.body, row); if (error) return { status: false, error, error_code: 400 }; apply(row, opts.body); }
            return { status: true, data: { ...row }, graph: 'default' };
        }
        if (method === 'POST' && opts.body) { if (!canManage) return permissionDenied(); const error = validate(opts.body); if (error) return { status: false, error, error_code: 400 }; const now = Math.floor(Date.now() / 1000); const row: MockRule = { id: Math.max(0, ...db.rules.map((candidate) => candidate.id)) + 1, created: now, modified: now, parent: Number(opts.body.parent), name: null, index: 0, comparator: '==', field_name: null, value: '', value_type: 'int', is_required: 0 }; apply(row, opts.body); db.rules.push(row); return { status: true, data: { ...row }, graph: 'default' }; }
        const result = listRows(db.rules as unknown as Record<string, unknown>[], opts.params ?? {}, (row) => String(row.name ?? ''), 'index'); return { ...result, graph: 'default' };
    }
    // ── Incident events — /api/incident/event (view_security-gated live) ──
    const eventMatch = path.match(/^\/api\/incident\/event(?:\/(\d+))?$/);
    if (eventMatch) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const canView = hasGlobalPermission(caller, ['view_security', 'security']);
        const canManage = hasGlobalPermission(caller, ['manage_security', 'security']);
        if (!canView) return permissionDenied();
        const detailId = eventMatch[1] ? Number(eventMatch[1]) : null;
        if (detailId != null) {
            const row = db.incidentEvents.find((candidate) => candidate.id === detailId);
            if (!row) return { status: false, error: 'Event not found', error_code: 404 };
            if (method === 'DELETE') return { status: false, error: 'Event deletion is not supported', error_code: 403 };
            if (method === 'POST' && opts.body) {
                if (!canManage) return permissionDenied();
                for (const key of ['level', 'scope', 'category', 'source_ip', 'hostname', 'title', 'details', 'model_name', 'model_id'] as const) {
                    if (key in opts.body) (row as Record<string, unknown>)[key] = opts.body[key];
                }
                if (isPlainObject(opts.body.metadata)) row.metadata = mergeDicts(row.metadata, opts.body.metadata);
            }
            return { status: true, data: serializeIncidentEvent(row), graph: String(opts.params?.graph ?? 'default') };
        }
        if (method === 'DELETE') return { status: false, error: 'Event deletion is not supported', error_code: 403 };
        const result = listRows(
            db.incidentEvents as unknown as Record<string, unknown>[],
            opts.params ?? {},
            (e) => `${e.details ?? ''}`, // SEARCH_FIELDS = ["details"]
            '-created',
        );
        return { ...result, graph: 'default', data: (result.data as unknown as MockIncidentEvent[]).map(serializeIncidentEvent) };
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
    // The real handler reads request.user and ignores ?user=/body.user.
    if (path === '/api/account/notification/preferences') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return { status: false, error: 'permission denied', error_code: 401 };
        const targetId = caller.id;
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
    // Group-scoped key inventory. Raw tokens are absent from ordinary reads;
    // create and explicit graph=token are the only disclosure paths.
    const oneGroupKey = path.match(/^\/api\/group\/apikey\/(\d+)$/);
    if (oneGroupKey || path === '/api/group/apikey') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (oneGroupKey) {
            const row = db.groupApiKeys.find((candidate) => candidate.id === Number(oneGroupKey[1]));
            if (!row) return { status: false, error: 'ApiKey not found', error_code: 404 };
            if (!groupCanManage(caller, row.group)) return permissionDenied();
            if (opts.method === 'DELETE') {
                db.groupApiKeys = db.groupApiKeys.filter((candidate) => candidate.id !== row.id);
                return { status: 'deleted' };
            }
            if (opts.method === 'POST' && opts.body) {
                if ('name' in opts.body) row.name = String(opts.body.name ?? '');
                if ('is_active' in opts.body) row.is_active = Boolean(opts.body.is_active);
                if (isPlainObject(opts.body.permissions)) row.permissions = mergeDicts(row.permissions, opts.body.permissions);
                if (isPlainObject(opts.body.limits)) row.limits = mergeDicts(row.limits, opts.body.limits);
                if (isPlainObject(opts.body.metadata)) row.metadata = mergeDicts(row.metadata, opts.body.metadata);
                row.modified = Math.floor(Date.now() / 1000);
            }
            const graph = String(opts.params?.graph ?? 'default');
            return { status: true, data: serializeGroupApiKey(row, graph), graph };
        }
        if (opts.method === 'POST' && opts.body) {
            const groupId = requestGroupId(opts);
            if (!db.groups.some((candidate) => candidate.id === groupId)) return { status: false, error: 'Group not found', error_code: 404 };
            if (!groupCanManage(caller, groupId)) return permissionDenied();
            const now = Math.floor(Date.now() / 1000);
            const id = Math.max(0, ...db.groupApiKeys.map((candidate) => candidate.id)) + 1;
            const row: MockGroupApiKey = {
                id, group: groupId, user: opts.body.user == null ? null : Number(opts.body.user),
                created: now, modified: now, name: String(opts.body.name ?? ''),
                is_active: opts.body.is_active == null ? true : Boolean(opts.body.is_active),
                permissions: isPlainObject(opts.body.permissions) ? opts.body.permissions : {},
                limits: isPlainObject(opts.body.limits) ? opts.body.limits : {},
                last_used: null, expires_at: opts.body.expires_at == null ? null : Number(opts.body.expires_at),
                metadata: isPlainObject(opts.body.metadata) ? opts.body.metadata : {},
                override_user: Boolean(opts.body.override_user), token: `mock_gk_${mockHex32(mulberry32(id))}`,
            };
            db.groupApiKeys.unshift(row);
            return { status: true, data: serializeGroupApiKey(row, 'default', true), graph: 'default' };
        }
        const groupId = requestGroupId(opts);
        if (groupId ? !groupCanManage(caller, groupId) : !hasGlobalPermission(caller, ['manage_groups', 'groups'])) return permissionDenied();
        const params = { ...(opts.params ?? {}), ...(groupId ? { group: groupId } : {}) };
        const result = listRows(db.groupApiKeys as unknown as Record<string, unknown>[], params, (row) => String(row.name), '-created');
        const graph = String(opts.params?.graph ?? 'default');
        return { ...result, graph: opts.params?.graph ? graph : 'list', data: (result.data as unknown as MockGroupApiKey[]).map((row) => serializeGroupApiKey(row, graph)) };
    }
    if (path === '/api/group/webhook_secret') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const groupId = requestGroupId(opts);
        if (!groupCanManage(caller, groupId)) return permissionDenied();
        const now = new Date().toISOString();
        const existing = db.webhookSecrets.get(groupId);
        const record = !existing || opts.body?.rotate === true
            ? { value: `wsec_${mockHex32(mulberry32(groupId + Date.now()))}`, created_at: existing?.created_at ?? now, last_rotated_at: now }
            : existing;
        db.webhookSecrets.set(groupId, record);
        return { status: true, data: { secret: record.value, created_at: record.created_at, last_rotated_at: record.last_rotated_at } };
    }
    const oneWebhook = path.match(/^\/api\/group\/webhook_subscriptions\/(\d+)$/);
    if (oneWebhook || path === '/api/group/webhook_subscriptions') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (oneWebhook) {
            const row = db.webhooks.find((candidate) => candidate.id === Number(oneWebhook[1]));
            if (!row) return { status: false, error: 'WebhookSubscription not found', error_code: 404 };
            if (!groupCanManage(caller, row.group)) return permissionDenied();
            if (opts.method === 'DELETE') {
                db.webhooks = db.webhooks.filter((candidate) => candidate.id !== row.id);
                return { status: 'deleted' };
            }
            if (opts.method === 'POST' && opts.body) {
                const url = 'url' in opts.body ? String(opts.body.url ?? '') : row.url;
                if (!url.startsWith('https://')) return { status: false, error: 'url must start with https:// (http and other schemes are not allowed)', error_code: 400 };
                try { if (new URL(url).username || new URL(url).password) return { status: false, error: 'url must not include credentials (user:pass@) — strip the userinfo component', error_code: 400 }; } catch { return { status: false, error: 'url is not a valid URL', error_code: 400 }; }
                const events = opts.body.events ?? row.events;
                if (!Array.isArray(events) || events.some((entry) => typeof entry !== 'string' || !entry)) return { status: false, error: 'events must be a list of strings', error_code: 400 };
                row.url = url; row.events = [...events] as string[];
                if ('is_active' in opts.body) row.is_active = Boolean(opts.body.is_active);
                if (isPlainObject(opts.body.metadata)) row.metadata = mergeDicts(row.metadata, opts.body.metadata);
                row.modified = Math.floor(Date.now() / 1000);
            }
            const graph = String(opts.params?.graph ?? 'default');
            return { status: true, data: serializeWebhook(row, graph), graph };
        }
        if (opts.method === 'POST' && opts.body) {
            const groupId = requestGroupId(opts);
            if (!groupCanManage(caller, groupId)) return permissionDenied();
            const url = String(opts.body.url ?? '');
            if (!url.startsWith('https://')) return { status: false, error: 'url must start with https:// (http and other schemes are not allowed)', error_code: 400 };
            try { if (new URL(url).username || new URL(url).password) return { status: false, error: 'url must not include credentials (user:pass@) — strip the userinfo component', error_code: 400 }; } catch { return { status: false, error: 'url is not a valid URL', error_code: 400 }; }
            const events = opts.body.events ?? [];
            if (!Array.isArray(events) || events.some((entry) => typeof entry !== 'string' || !entry)) return { status: false, error: 'events must be a list of strings', error_code: 400 };
            const now = Math.floor(Date.now() / 1000);
            const row: MockWebhookSubscription = { id: Math.max(0, ...db.webhooks.map((candidate) => candidate.id)) + 1, group: groupId, created: now, modified: now, url, events: [...events] as string[], is_active: opts.body.is_active == null ? true : Boolean(opts.body.is_active), metadata: isPlainObject(opts.body.metadata) ? opts.body.metadata : {} };
            if (db.webhooks.some((candidate) => candidate.group === groupId && candidate.url === url)) return { status: false, error: 'Webhook subscription already exists', error_code: 400 };
            db.webhooks.unshift(row);
            return { status: true, data: serializeWebhook(row), graph: 'default' };
        }
        const groupId = requestGroupId(opts);
        if (groupId ? !groupCanManage(caller, groupId) : !hasGlobalPermission(caller, ['manage_groups', 'groups'])) return permissionDenied();
        const params = { ...(opts.params ?? {}), ...(groupId ? { group: groupId } : {}) };
        const result = listRows(db.webhooks as unknown as Record<string, unknown>[], params, (row) => `${row.url}`, '-created');
        const graph = String(opts.params?.graph ?? 'default');
        return { ...result, data: (result.data as unknown as MockWebhookSubscription[]).map((row) => serializeWebhook(row, graph)) };
    }
    if (path === '/api/group/member/invite') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const groupId = requestGroupId(opts);
        const group = db.groups.find((candidate) => candidate.id === groupId && candidate.is_active);
        // Inactive, nonexistent, and unauthorized groups share one denial.
        if (!group) return permissionDenied();
        if (!groupCanInvite(caller, groupId)) return permissionDenied();
        const email = String(opts.body?.email ?? '').trim().toLowerCase();
        if (!email) return { status: false, error: 'email is required', error_code: 400 };
        let user = findByEmail(email);
        if (!user) {
            const id = Math.max(...db.users.map((candidate) => candidate.id)) + 1;
            const username = email.split('@')[0] || `user${id}`;
            user = { id, first_name: '', last_name: '', display_name: email, username, email, phone_number: null, is_active: true, is_superuser: false, is_email_verified: false, is_phone_verified: false, is_dob_verified: false, is_online: false, last_login: null, last_activity: null, permissions: {}, metadata: {}, dob: null, avatar: null, org: null, requires_mfa: false, created: Math.floor(Date.now() / 1000) };
            db.users.push(user);
        }
        const existing = db.members.find((candidate) => candidate.group === groupId && candidate.user === user!.id);
        if (existing) return { status: true, data: serializeMember(existing), graph: 'default' };
        const now = Math.floor(Date.now() / 1000);
        const member: MockMember = { id: Math.max(0, ...db.members.map((candidate) => candidate.id)) + 1, created: now, modified: now, is_active: true, permissions: isPlainObject(opts.body?.permissions) ? opts.body!.permissions as Record<string, unknown> : {}, metadata: {}, user: user.id, group: groupId };
        db.members.push(member);
        group.member_count += 1;
        return { status: true, data: serializeMember(member), graph: 'default' };
    }
    // Members list/detail — /api/group/member (admin listing; the group-
    // scoped /api/group/<id>/member self-membership route stays separate
    // above). SEARCH_FIELDS parity: user__username / user__email /
    // user__display_name.
    const oneMember = path.match(/^\/api\/group\/member\/(\d+)$/);
    if (oneMember) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const m = db.members.find((x) => x.id === Number(oneMember[1]));
        if (!m) return { status: false, error: 'Member not found', error_code: 404 };
        if (!groupCanReadMembers(caller, m.group)) return permissionDenied();
        if (opts.method === 'DELETE') {
            return { status: false, error: 'DELETE not allowed: GroupMember', error_code: 403 };
        }
        if (opts.method === 'POST' && opts.body) {
            if (!groupCanManage(caller, m.group)) return permissionDenied();
            if ('is_active' in opts.body) m.is_active = Boolean(opts.body.is_active);
            if (isPlainObject(opts.body.permissions)) {
                for (const [permission, value] of Object.entries(opts.body.permissions)) {
                    if (value) m.permissions[permission] = value;
                    else delete m.permissions[permission];
                }
            }
            if (isPlainObject(opts.body.metadata)) m.metadata = mergeDicts(m.metadata, opts.body.metadata);
            m.modified = Math.floor(Date.now() / 1000);
            if ('resend_invite' in opts.body) return { status: true };
        }
        return { status: true, data: serializeMember(m), graph: 'default' };
    }
    if (path === '/api/group/member') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (opts.method === 'DELETE') return { status: false, error: 'DELETE not allowed: GroupMember', error_code: 403 };
        if (opts.method === 'POST' && opts.body) {
            const groupId = Number(opts.body.group ?? 0);
            const userId = Number(opts.body.user ?? 0);
            const group = db.groups.find((candidate) => candidate.id === groupId && candidate.is_active);
            if (!group || !groupCanManage(caller, groupId)) return permissionDenied();
            const user = db.users.find((candidate) => candidate.id === userId);
            if (!user) return { status: false, error: 'User not found', error_code: 404 };
            if (db.members.some((candidate) => candidate.group === groupId && candidate.user === userId)) {
                return { status: false, error: 'Membership already exists', error_code: 400 };
            }
            const now = Math.floor(Date.now() / 1000);
            const member: MockMember = {
                id: Math.max(0, ...db.members.map((candidate) => candidate.id)) + 1,
                created: now,
                modified: now,
                is_active: opts.body.is_active == null ? true : Boolean(opts.body.is_active),
                permissions: isPlainObject(opts.body.permissions) ? { ...opts.body.permissions } : {},
                metadata: isPlainObject(opts.body.metadata) ? { ...opts.body.metadata } : {},
                user: userId,
                group: groupId,
            };
            db.members.push(member);
            group.member_count += 1;
            return { status: true, data: serializeMember(member), graph: 'default' };
        }
        const groupId = Number(opts.params?.group ?? 0);
        if (groupId > 0 ? !groupCanReadMembers(caller, groupId) : !canReadGlobalMembers(caller)) return permissionDenied();
        const hydrated = db.members.map((member) => serializeMember(member));
        const memberSearch = (member: Record<string, unknown>) => {
            const user = member.user as Record<string, unknown> | null;
            return user ? `${user.username ?? ''} ${user.email ?? ''} ${user.display_name ?? ''}` : '';
        };
        const params = opts.params ?? {};
        if (params.download_format) {
            const full = listRows(hydrated, { ...params, start: 0, size: hydrated.length }, memberSearch, '-id');
            return exportRows(full.data as Record<string, unknown>[], params, 'GroupMember');
        }
        return listRows(hydrated, params, memberSearch, '-id');
    }
    const oneGroup = path.match(/^\/api\/group\/(\d+)$/);
    if (oneGroup) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const group = db.groups.find((g) => g.id === Number(oneGroup[1]));
        if (!group) return { status: false, error: 'Group not found', error_code: 404 };
        if (!groupCanRead(caller, group.id)) return permissionDenied();
        if (opts.method === 'DELETE') {
            return { status: false, error: 'DELETE not allowed: Group', error_code: 403 };
        }
        if (opts.method === 'POST' && opts.body) {
            if (!groupCanManage(caller, group.id)) return permissionDenied();
            if (('disable' in opts.body || 'reactivate' in opts.body)
                && !hasGlobalPermission(caller, ['manage_groups', 'groups'])) return permissionDenied();
            return saveGroup(group, opts.body);
        }
        return { status: true, data: serializeGroup(group), graph: 'default' };
    }
    if (path === '/api/group') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const canViewAll = hasGlobalPermission(caller, ['view_groups', 'manage_groups', 'manage_group', 'groups']);
        const visibleGroups = canViewAll
            ? db.groups
            : db.groups.filter((group) => group.is_active && groupCanRead(caller, group.id));
        if (opts.params?.download_format) {
            const full = listRows(visibleGroups as unknown as Record<string, unknown>[], { ...opts.params, start: 0, size: visibleGroups.length }, (g) => String(g.name), 'name');
            return exportRows(full.data as Record<string, unknown>[], opts.params, 'Group');
        }
        if (opts.method === 'POST' && opts.body) {
            if (!hasGlobalPermission(caller, ['manage_groups', 'manage_group', 'groups'])) return permissionDenied();
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
        return listRows(visibleGroups as unknown as Record<string, unknown>[], opts.params ?? {}, (g) => String(g.name), 'name');
    }
    // User API keys — /api/account/api_keys (account/rest/user_api_key.py).
    // No DELETE (CAN_DELETE defaults false); the kill switch is the `revoke`
    // POST_SAVE_ACTION, which answers with its own payload {status:true},
    // NOT the row. NO_SAVE_FIELDS: jti / expires / user / last_used.
    const oneApiKey = path.match(/^\/api\/account\/api_keys\/(\d+)$/);
    if (oneApiKey) {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const k = db.apiKeys.find((x) => x.id === Number(oneApiKey[1]));
        if (!k) return { status: false, error: 'UserAPIKey not found', error_code: 404 };
        if (k.user !== caller.id && !hasGlobalPermission(caller, ['users', 'manage_users'])) return permissionDenied();
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
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const canManageOthers = hasGlobalPermission(caller, ['users', 'manage_users']);
        const requestedUser = opts.params?.user == null ? null : Number(opts.params.user);
        if (requestedUser != null && requestedUser !== caller.id && !canManageOthers) return permissionDenied();
        const params: Params = { ...(opts.params ?? {}), user: requestedUser ?? caller.id };
        const search = (k: Record<string, unknown>) => String(k.label ?? '');
        if (params.download_format) {
            const full = listRows(db.apiKeys as unknown as Record<string, unknown>[], { ...params, start: 0, size: db.apiKeys.length }, search, '-id');
            return exportRows((full.data as unknown as MockApiKey[]).map(serializeApiKey), params, 'UserAPIKey');
        }
        const result = listRows(db.apiKeys as unknown as Record<string, unknown>[], params, search, '-id');
        return { ...result, data: (result.data as unknown as MockApiKey[]).map(serializeApiKey) };
    }
    // ══ Jobs engine — /api/jobs/* (mojo/apps/jobs) ═══════════════════
    // Every endpoint below is the executable spec for one django-mojo route.
    // Gates are `requires_global_perms`, never member grants: view is
    // view_jobs|manage_jobs|jobs, write is manage_jobs|jobs, and the
    // scheduled-task pair adds the OWNER fallback the model declares.
    //
    // Deliberately ABSENT: `GET /api/jobs/health` and `health/<channel>`.
    // JobManager.get_channel_health reads state['stream_length'] /
    // state['pending_count'], which the Plan-B get_queue_state no longer
    // returns → KeyError → HTTP 400. Mocking a working /health would make the
    // spec lie about a route that cannot be called.
    if (path.startsWith('/api/jobs/')) {
        const jobsResult = jobsFetch(path, opts);
        if (jobsResult !== undefined) return jobsResult;
    }
    // ══ end jobs engine ══════════════════════════════════════════════
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
    if (path === '/api/metrics/fetch') return fetchMetrics(opts.params ?? {}, userFromBearer(opts.headers));
    if (path === '/api/metrics/series') return fetchMetricPoint(opts.params ?? {}, userFromBearer(opts.headers));
    if (path === '/api/metrics/value/get') return fetchMetricScalars(opts.params ?? {}, userFromBearer(opts.headers));
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
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        if (opts.method !== 'POST' && opts.method !== 'DELETE'
            && caller.id !== id && !canReadUserDirectory(caller)) return permissionDenied();
        const user = db.users.find((u) => u.id === id);
        if (!user) return { status: false, error: 'User not found', error_code: 404 };
        if (opts.method === 'DELETE') {
            db.users = db.users.filter((u) => u.id !== id);
            // Backend parity (mojo/models/rest.py on_rest_delete): status is
            // the STRING "deleted" — the envelope's one non-boolean status.
            return { status: 'deleted' };
        }
        if (opts.method === 'POST' && opts.body) {
            if (caller.id !== id && !hasGlobalPermission(caller, ['users', 'manage_users'])) return permissionDenied();
            if (Object.keys(opts.body).some((key) => USER_ACTIONS.has(key))
                && !hasGlobalPermission(caller, ['users', 'manage_users'])) return permissionDenied();
            return saveUser(user, opts.body, userFromBearer(opts.headers));
        }
        return { status: true, data: serializeUser(user, 'default'), graph: 'default' };
    }
    if (path === '/api/user') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const visibleUsers = canReadUserDirectory(caller) ? db.users : [caller];
        if (opts.params?.download_format) return exportUsers(opts.params, visibleUsers);
        if (opts.method === 'POST' && opts.body) {
            if (!hasGlobalPermission(caller, ['users', 'manage_users'])) return permissionDenied();
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
        return listUsers(opts.params ?? {}, visibleUsers);
    }
    return { status: false, error: `No mock for ${path}`, error_code: 404 };
}
