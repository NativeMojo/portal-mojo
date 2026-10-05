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
import { defineModel } from 'portal-mojo/client/runtime';

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
