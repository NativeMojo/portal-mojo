// group-sections/models.ts — model definitions + wire helpers for the FULL
// GroupView port (web-mojo admin/account/groups/GroupView.js, read in full
// 2026-08-05). These defs live beside the group sections (NOT in the app's
// models.ts, which another wave owns) and cover the group-scoped surfaces the
// first GroupDetail pass left out.
//
// Wire facts measured live (mverify @9009, portal_test, 2026-08-05):
//   · /api/group/apikey 200 — row {id, created, modified, name, is_active,
//     permissions{}, limits{}, last_used, expires_at, metadata, override_user,
//     group:{…embedded}, user}. NOTE `name` (not the user-key surface's
//     `label`) and `expires_at` (not `expires`).
//   · Create echo carries `token` ONCE (api_key.py on_rest_get attaches
//     _raw_token). Managers can ALSO read it later via ?graph=token — the
//     token is not write-once on this backend (rotate_token docstring).
//   · POST /api/group/apikey/rotate is apikey-auth SELF-SERVICE (401 for
//     JWT callers) — deliberately NOT surfaced in this portal UI.
//   · /api/group/webhook_subscriptions 200 — row {id, created, modified,
//     url, events[], is_active, group:{…}}.
//   · POST /api/group/webhook_secret {group} → {status, data:{secret,
//     created_at, last_rotated_at}} — timestamps are ISO STRINGS
//     (dates.utcnow().isoformat()), NOT epochs. web-mojo formatted them
//     through ['epoch','relative'] (a bug not carried here).
//   · POST /api/group/member/invite {email, group} — backend perms
//     manage_users|manage_members|manage_group|manage_groups on the group.
//   · /api/incident/event 200 (empty on the instance) — columns per the
//     django model: created/category/title (+ level/details/model_*).
import { defineModel, mojoCall } from 'portal-mojo/client';

// ── Permission tiers (GroupView.js:1357-1359) ─────────────────────────
/** Admin tier — offer group-management flows. */
export const GROUP_ADMIN_PERMS = ['groups', 'manage_groups'];
/** Strict tier — disable/reactivate (backend tightening, spec line 214). */
export const GROUP_DESTRUCTIVE_PERMS = 'manage_groups';
/** Configure Auth — system-level only (sys. pins to the global dict). */
export const GROUP_AUTH_PERMS = ['sys.groups', 'sys.manage_groups'];
/**
 * ApiKey / webhook CRUD threshold (WebhookSubscription.js docs: manage_group
 * / manage_groups / groups — `groups` also covers manage_group via the
 * client category rollup, matching the backend's requires_perms list).
 */
export const GROUP_ACCESS_MANAGE_PERMS = ['manage_group', 'manage_groups', 'groups'];
/** Member invite/add threshold (rest/group.py on_group_invite_member). */
export const MEMBER_MANAGE_PERMS = ['manage_users', 'manage_members', 'manage_group', 'manage_groups'];

// ── Group kinds (Group.js GroupKinds — the FULL known-kind catalog) ───
export const GROUP_KINDS: Record<string, string> = {
    org: 'Organization',
    platform: 'Platform',
    division: 'Division',
    department: 'Department',
    team: 'Team',
    merchant: 'Merchant',
    partner: 'Partner',
    client: 'Client',
    iso: 'ISO',
    sales: 'Sales',
    reseller: 'Reseller',
    location: 'Location',
    region: 'Region',
    route: 'Route',
    project: 'Project',
    inventory: 'Inventory',
    test: 'Testing',
    misc: 'Miscellaneous',
    qa: 'Quality Assurance',
};

/** Combo options — known kinds; free-typed kinds are allowed (combo). */
export const GROUP_KIND_COMBO_OPTIONS = Object.entries(GROUP_KINDS).map(([value, label]) => ({ value, label }));

/** Kind → label: catalog name, else capitalized raw kind (GroupView.kindLabel). */
export function kindLabel(kind: string | null | undefined): string {
    if (!kind) return '';
    const known = GROUP_KINDS[kind];
    if (known) return known;
    const s = String(kind);
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Kind → header icon (GroupView.iconForKind, ported verbatim). */
export function iconForKind(kind: string | null | undefined): string {
    const k = String(kind ?? '').toLowerCase();
    if (k === 'org' || k === 'organization') return 'bi-buildings';
    if (k === 'division' || k === 'department') return 'bi-buildings';
    if (k === 'region' || k === 'location') return 'bi-geo-alt';
    if (k === 'project') return 'bi-kanban';
    if (k === 'merchant' || k === 'partner' || k === 'client' || k === 'reseller') return 'bi-shop';
    if (k === 'iso' || k === 'sales') return 'bi-briefcase';
    if (k === 'route') return 'bi-signpost-2';
    if (k === 'inventory') return 'bi-box-seam';
    if (k === 'qa' || k === 'test' || k === 'testing') return 'bi-clipboard-check';
    return 'bi-people-fill';
}

// ── Canonical option lists (Group.js) ─────────────────────────────────
/** End-of-day hour options, 0–23 with 12-hour labels (EodHourOptions port). */
export const EOD_HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => {
    let label: string;
    if (h === 0) label = 'Midnight';
    else if (h === 12) label = 'Noon';
    else label = `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
    return { value: h, label };
});

// ── Member permission catalog (Member.js BASE_PERMISSIONS) ────────────
export interface PermissionDef {
    name: string;
    label: string;
    tooltip?: string;
}

export const MEMBER_BASE_PERMISSIONS: PermissionDef[] = [
    { name: 'admin', label: 'Group Admin', tooltip: 'Full access within this group' },
    { name: 'manage_group', label: 'Manage Group' },
    { name: 'view_metrics', label: 'View Metrics' },
    { name: 'view_logs', label: 'View Logs' },
    { name: 'view_tickets', label: 'View Tickets' },
    { name: 'view_members', label: 'View Members' },
    { name: 'manage_members', label: 'Manage Members' },
    { name: 'view_billing', label: 'View Billing' },
];

/**
 * Federation permissions — offered on API KEYS ONLY (ApiKey.js:59-75; a
 * member grant of geoip_sync authorizes nothing, so it never renders there).
 */
export const APIKEY_FEDERATION_PERMISSIONS: PermissionDef[] = [
    {
        name: 'geoip_sync',
        label: 'GeoIP Federation Sync',
        tooltip: 'Lets this key push abuse signals (attacker/abuser flags, threat level) into this '
            + "fleet's shared GeoIP threat intel. Fleet-wide in effect, not limited to this group.",
    },
];

/** Who may grant a federation permission (ApiKey.FEDERATION_GRANT_PERMS). */
export const APIKEY_FEDERATION_GRANT_PERMS = ['manage_users', 'manage_groups', 'sys.geoip_sync'];

/** Loose-truthy grant list from a permissions dict (backend stores true AND 1). */
export function grantedPerms(dict: Record<string, unknown> | null | undefined): string[] {
    return Object.entries(dict ?? {})
        .filter(([, v]) => v === true || v === 1)
        .map(([k]) => k);
}

// ── Group-scoped API keys — /api/group/apikey ─────────────────────────
export interface GroupApiKeyRow {
    id: number;
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
    group: { id: number; name: string; kind?: string } | number | null;
    user: unknown | null;
    /** Present ONLY on the create echo (api_key.py attaches _raw_token). */
    token?: string;
}

export const GroupApiKeyModel = defineModel<GroupApiKeyRow>({
    name: 'group_api_key',
    endpoint: '/api/group/apikey',
    permissions: {
        view: GROUP_ACCESS_MANAGE_PERMS,
        manage: GROUP_ACCESS_MANAGE_PERMS,
    },
});

/**
 * Read a key's current token via the opt-in `token` graph (verified live:
 * managers holding manage_group/manage_groups/groups get {…row, token}).
 * Rejects (403) for callers below the threshold — surface the message.
 */
export async function fetchApiKeyToken(id: number): Promise<string> {
    const body = await mojoCall(`/api/group/apikey/${id}`, { params: { graph: 'token' } });
    const token = (body.data as GroupApiKeyRow | undefined)?.token;
    if (!token) throw new Error('The server did not return a token');
    return token;
}

// ── Webhook subscriptions — /api/group/webhook_subscriptions ──────────
export interface WebhookSubscriptionRow {
    id: number;
    created: number;
    modified: number;
    url: string;
    events: string[];
    is_active: boolean;
    group: { id: number; name: string } | number | null;
    metadata?: Record<string, unknown>;
}

export const WebhookSubscriptionModel = defineModel<WebhookSubscriptionRow>({
    name: 'webhook_subscription',
    endpoint: '/api/group/webhook_subscriptions',
    permissions: {
        view: GROUP_ACCESS_MANAGE_PERMS,
        manage: GROUP_ACCESS_MANAGE_PERMS,
    },
});

// ── Webhook signing secret (per-Group HMAC, NOT per-subscription) ─────
export interface WebhookSecretInfo {
    secret: string;
    /** ISO datetime strings (measured: dates.utcnow().isoformat()). */
    created_at: string | null;
    last_rotated_at: string | null;
}

/**
 * Reveal (or, with rotate, replace) the group's webhook signing secret.
 * POST /api/group/webhook_secret — the backend AUTO-MINTS on first call, so
 * this must never run at render time (GroupView.js:955-960): only from the
 * explicit Reveal / Rotate buttons.
 */
export async function fetchWebhookSecret(groupId: number, rotate = false): Promise<WebhookSecretInfo> {
    const body = await mojoCall('/api/group/webhook_secret', {
        method: 'POST',
        body: rotate ? { group: groupId, rotate: true } : { group: groupId },
    });
    const data = body.data as Partial<WebhookSecretInfo> | undefined;
    if (!data?.secret) throw new Error('The server did not return a secret');
    return {
        secret: data.secret,
        created_at: data.created_at ?? null,
        last_rotated_at: data.last_rotated_at ?? null,
    };
}

// ── Member invite — POST /api/group/member/invite ─────────────────────
/**
 * Email-invite flow (GroupView.js:1599-1620). The backend sends the invite
 * mail and creates the pending Member row. Rejects on failure.
 */
export async function inviteMemberByEmail(groupId: number, email: string): Promise<void> {
    await mojoCall('/api/group/member/invite', {
        method: 'POST',
        body: { group: groupId, email },
    });
}

// ── Incident events — /api/incident/event ─────────────────────────────
/** Row typed from django-mojo incident/models/event.py (live table empty). */
export interface IncidentEventRow {
    id: number;
    created: number;
    level: number;
    scope?: string;
    category: string;
    title: string | null;
    details?: string | null;
    source_ip?: string | null;
    hostname?: string | null;
    country_code?: string | null;
    model_name?: string | null;
    model_id?: number | null;
    metadata?: Record<string, unknown>;
}

export const IncidentEventModel = defineModel<IncidentEventRow>({
    name: 'incident_event',
    endpoint: '/api/incident/event',
});
