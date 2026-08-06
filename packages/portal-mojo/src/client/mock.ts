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
    securityViewer.username = 'security.viewer';
    securityViewer.email = 'security.viewer@nativemojo.com';
    securityViewer.display_name = 'Security Viewer';
    securityViewer.permissions = { view_security: true, view_geofence: true };
    const securityManager = at(12);
    securityManager.is_active = true;
    securityManager.username = 'security.manager';
    securityManager.email = 'security.manager@nativemojo.com';
    securityManager.display_name = 'Security Manager';
    securityManager.permissions = { view_security: true, manage_security: true, manage_geofence: true, manage_settings: true, manage_metrics: true };
    const groupsManager = at(13);
    groupsManager.is_active = true;
    groupsManager.username = 'groups.manager';
    groupsManager.email = 'groups.manager@nativemojo.com';
    groupsManager.display_name = 'Groups Manager';
    groupsManager.permissions = { manage_groups: true, groups: true, manage_users: true, users: true };
    const groupsViewer = at(16);
    groupsViewer.is_active = true;
    groupsViewer.username = 'groups.viewer';
    groupsViewer.email = 'groups.viewer@nativemojo.com';
    groupsViewer.display_name = 'Groups Viewer';
    groupsViewer.permissions = { view_groups: true };
    // The published showcase has no login screen, so it uses one explicit
    // mock-only operator that can exercise every data-backed admin demo. Keep
    // the narrower viewer/manager identities above intact for permission tests.
    const showcaseOperator = at(14);
    showcaseOperator.is_active = true;
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
    };
    const securityManageOnly = at(15);
    securityManageOnly.is_active = true;
    securityManageOnly.username = 'security.manage-only';
    securityManageOnly.email = 'security.manage-only@nativemojo.com';
    securityManageOnly.display_name = 'Security Manage Only';
    securityManageOnly.permissions = { manage_security: true };

    // Auth-config inheritance fixtures: defaults -> deployment -> root -> child.
    groups[0]!.metadata = mergeDicts(groups[0]!.metadata, {
        auth_config: {
            theme: { app_title: 'ACME ACCESS', hero_headline: 'Welcome to Acme' },
            login: { methods: ['password', 'passkey'] },
            private_operator_note: 'must never reach the public auth config',
        },
        geofence: { countries: { deny: ['CN'] } },
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
    groupApiKeys: buildGroupApiKeys(),
    webhooks: buildWebhookSubscriptions(),
    webhookSecrets: new Map<number, { value: string; created_at: string; last_rotated_at: string }>(),
    settings: buildSettings(),
    metricPermissions: new Map<string, { view_permissions: string | string[] | null; write_permissions: string | string[] | null }>([
        ['global', { view_permissions: 'view_metrics', write_permissions: ['write_metrics', 'metrics'] }],
        ['group-1', { view_permissions: ['view_metrics', 'metrics'], write_permissions: null }],
        ['user-1', { view_permissions: null, write_permissions: 'metrics' }],
    ]),
    geoRules: { countries: { deny: ['CN'] } } as Record<string, unknown>,
    geoAllowlist: [{ cidr: '203.0.113.0/24', reason: 'Office egress', until: null }] as unknown[],
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
    // Per-user login throttle counters (auth/manage/throttle shape). u3 is
    // mid-lockout so the header badge + Clear Rate Limit are demoable.
    throttle: new Map<number, { count: number; limit: number; window: number; retry_after_seconds: number }>([
        [3, { count: 11, limit: 10, window: 900, retry_after_seconds: 412 }],
    ]),
};

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

function hasGlobalPermission(user: MockUser | undefined, permissions: string[]): boolean {
    if (!user) return false;
    if (user.is_superuser) return true;
    return permissions.some((permission) => Boolean(user.permissions[permission]));
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

function permissionDenied(code = 403): Record<string, unknown> {
    return { status: false, error: 'permission denied', error_code: code };
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
            if (!isPlainObject(opts.body?.rule)) return { status: false, error: "'rule' must be a dict", error_code: 400 };
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
        return { status: true, data: { system: { rule: db.geoRules, source: 'setting', modified: new Date().toISOString() }, posture: { enabled: true, fail_closed: false, fail_closed_scopes: [], allow_private_ips: true, strict_posture: false, cache_ttl: 300 }, allowlist_summary: { setting_entries: db.geoAllowlist.length, geoip_active: 0 }, evaluation_order: ['system', 'group'], enforced_endpoints: [{ endpoint: 'POST /api/login', scope: 'auth', after_auth: true }] } };
    }
    if (path === '/api/geo/allowlist') {
        const caller = userFromBearer(opts.headers);
        if (!caller) return permissionDenied(401);
        const canManage = hasGlobalPermission(caller, ['manage_geofence', 'security']);
        if (opts.method === 'POST') {
            if (!canManage) return permissionDenied();
            if (!Array.isArray(opts.body?.entries)) return { status: false, error: "'entries' is required (a list; may be empty)", error_code: 400 };
            db.geoAllowlist = [...opts.body.entries];
            return { status: true, data: { entries: db.geoAllowlist } };
        }
        if (!hasGlobalPermission(caller, ['view_geofence', 'manage_geofence', 'security'])) return permissionDenied();
        return { status: true, data: { setting: db.geoAllowlist.map((entry) => isPlainObject(entry) ? { cidr: entry.cidr ?? entry.ip, reason: entry.reason ?? null, until: entry.until ?? null, active: true } : { cidr: entry, reason: null, until: null, active: true }), geoip: [] } };
    }
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
