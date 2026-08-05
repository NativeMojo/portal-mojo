// Model definitions for the base portal — the defineModel proving ground.
// A definition carries what web-mojo scattered across Model subclasses and
// *Forms statics: endpoint, UI permission gates, form configs, and the
// POST_SAVE_ACTIONS the backend RestMeta declares. Stabilized definitions
// migrate into portal-mojo/admin section bundles alongside their pages.
//
// C4 (board #1281): ApiKey / Log / Member joined, shapes measured against
// the LIVE backend (mverify @9009, 2026-08-05) — see each row type for the
// endpoint + graph facts.
import { defineModel, type Group, type Params, type User } from 'portal-mojo/client';

export const UserModel = defineModel<User>({
    name: 'user',
    endpoint: '/api/user',
    // Category-or-granular pairs, exactly the any-of lists the backend gates
    // its user actions with (account/models/user.py: ["users", "manage_users"]).
    permissions: {
        view: ['users', 'view_users'],
        manage: ['users', 'manage_users'],
    },
    forms: {
        create: {
            title: 'Add user',
            submitText: 'Create',
            // Real save contract: username derives from the email localpart
            // server-side when omitted; there is no `role` field in mojo.
            fields: [
                { name: 'display_name', type: 'text', label: 'Display name', required: true, placeholder: 'Jane Cooper' },
                { name: 'email', type: 'email', label: 'Email', required: true, placeholder: 'jane@example.com' },
                { name: 'phone_number', type: 'tel', label: 'Phone', columns: 6 },
                { name: 'username', type: 'text', label: 'Username', columns: 6, placeholder: 'Defaults from email', help: 'Leave blank to derive from email' },
            ],
        },
        // Disable collects the reason the backend REQUIRES (services/disable.py
        // USER_REST_REASONS) + an optional audit note.
        disable: {
            title: 'Disable user',
            submitText: 'Disable',
            fields: [
                {
                    name: 'reason', type: 'select', label: 'Reason', required: true, options: [
                        { value: 'admin', label: 'Admin — block / policy violation' },
                        { value: 'abuse', label: 'Abuse — banned' },
                    ],
                },
                { name: 'note', type: 'textarea', label: 'Note', placeholder: 'Optional note about why this user is being disabled.' },
            ],
        },
    },
    // django-mojo account/models/user.py RestMeta.POST_SAVE_ACTIONS (the
    // change_username / TOTP actions join when their screens land).
    actions: {
        disable: { permissions: ['users', 'manage_users'] },
        reactivate: { permissions: ['users', 'manage_users'] },
        send_invite: {},
        revoke_sessions: { response: 'payload' },
    },
});

/** Group kinds offered in filters — union of the mock's and mverify's data. */
export const GROUP_KIND_OPTIONS = [
    { value: 'org', label: 'Org' },
    { value: 'organization', label: 'Organization' },
    { value: 'team', label: 'Team' },
    { value: 'project', label: 'Project' },
    { value: 'group', label: 'Group' },
];

/**
 * The /api/group default-graph row (measured live 2026-08-05): the shared
 * client Group type plus the list fields the screens bind. `member_count`
 * is a graph extra; `parent` embeds the basic sub-graph.
 */
export type GroupRow = Group & {
    id: number;
    uuid: string | null;
    created: number;
    modified: number;
    last_activity: number | null;
    is_active: boolean;
    auth_domain: string | null;
    metadata: Record<string, unknown>;
    member_count: number;
};

export const GroupModel = defineModel<GroupRow>({
    name: 'group',
    endpoint: '/api/group',
    permissions: {
        view: ['groups', 'view_groups'],
        manage: ['groups', 'manage_groups'],
    },
    forms: {
        create: {
            title: 'Add group',
            submitText: 'Create',
            fields: [
                { name: 'name', type: 'text', label: 'Name', required: true, placeholder: 'Acme West' },
                {
                    name: 'kind', type: 'combo', label: 'Kind', required: true,
                    options: GROUP_KIND_OPTIONS, placeholder: 'Type or pick a kind…',
                    help: 'Drives the sidebar menu context and the portal look for this group.',
                },
                {
                    name: 'parent', type: 'collection', label: 'Parent group',
                    endpoint: '/api/group', labelField: 'name', valueField: 'id',
                    placeholder: 'None — top-level', help: 'Optional. Search by name.',
                },
            ],
        },
        // Group disable mirrors the user flow but with the group reason set
        // (services/disable.py GROUP_REST_REASONS adds `archived`).
        disable: {
            title: 'Deactivate group',
            submitText: 'Deactivate',
            fields: [
                {
                    name: 'reason', type: 'select', label: 'Reason', required: true, options: [
                        { value: 'admin', label: 'Admin — manual block' },
                        { value: 'abuse', label: 'Abuse — banned' },
                        { value: 'archived', label: 'Archived — no longer in use' },
                    ],
                },
                { name: 'note', type: 'textarea', label: 'Note', placeholder: 'Optional note about why this group is being deactivated.' },
            ],
        },
    },
    // account/models/group.py POST_SAVE_ACTIONS (disable requires the
    // manage_groups tier server-side; realtime_message/revoke_group_tokens
    // join when their screens land).
    actions: {
        disable: { permissions: 'manage_groups' },
        reactivate: { permissions: 'manage_groups' },
    },
});

/**
 * /api/group/member row (measured live 2026-08-05): membership + permission
 * dict, with `user` embedded as the me-graph dict and `group` as the basic
 * graph. SEARCH_FIELDS sweep user__username/email/display_name server-side.
 */
export interface MemberRow {
    id: number;
    created: number;
    modified: number;
    is_active: boolean;
    permissions: Record<string, unknown>;
    metadata: Record<string, unknown>;
    user: (User & { requires_mfa?: boolean; has_passkey?: boolean }) | null;
    group: { id: number; name: string; kind: string } | null;
}

export const MemberModel = defineModel<MemberRow>({
    name: 'member',
    endpoint: '/api/group/member',
    permissions: {
        view: ['view_members', 'view_groups', 'manage_groups', 'manage_group', 'groups'],
        manage: ['manage_groups', 'manage_group', 'groups'],
    },
    actions: {
        resend_invite: {},
    },
});

/**
 * /api/account/api_keys row — the live UserAPIKey default graph, measured
 * 2026-08-05: {id, label, allowed_ips, expires, is_active, last_used,
 * created}. The owner FK (`user`) filters (?user=<id>) but never serializes.
 * NOTE: the group-scoped /api/group/apikey surface 500s on the live dev
 * backend — this user-key surface is the one that works, and the one this
 * portal ships.
 */
export interface ApiKeyRow {
    id: number;
    label: string;
    allowed_ips: string[];
    expires: number;
    is_active: boolean;
    last_used: number | null;
    created: number;
}

export const ApiKeyModel = defineModel<ApiKeyRow>({
    name: 'api_key',
    endpoint: '/api/account/api_keys',
    // VIEW_PERMS are owner|users|manage_users — every signed-in user sees
    // their OWN keys, so the page itself carries no gate.
    permissions: {
        manageOthers: ['users', 'manage_users'],
    },
    forms: {
        // POST /api/auth/generate_api_key — NOT a REST create on the
        // collection; the page submits this via mojoCall. expire_days is
        // server-capped at 360 (account/rest/user_api_key.py).
        generate: {
            title: 'Generate API key',
            submitText: 'Generate',
            fields: [
                { name: 'label', type: 'text', label: 'Label', required: true, placeholder: 'e.g. CI/CD pipeline, Mobile app' },
                {
                    name: 'allowed_ips', type: 'text', label: 'Allowed IPs',
                    placeholder: 'e.g. 203.0.113.0/24, 10.0.0.1',
                    help: 'Optional. Comma-separated IPs or CIDR ranges; empty allows any.',
                },
                {
                    name: 'expire_days', type: 'select', label: 'Expires in', options: [
                        { value: '30', label: '30 days' },
                        { value: '60', label: '60 days' },
                        { value: '90', label: '90 days' },
                        { value: '180', label: '180 days' },
                        { value: '360', label: '360 days (max)' },
                    ],
                },
            ],
        },
    },
    actions: {
        // on_action_revoke rotates the signing secret + deactivates — the
        // response is the handler's own {status:true}, never the row.
        revoke: { response: 'payload' },
    },
});

/**
 * /api/logs row — the live logit.Log default graph, measured 2026-08-05.
 * `graph=basic` narrows to the id/created/level/kind/method/path/ip/uid/gid/
 * username/model_name/model_id subset; default sort is `-id` (rest.py).
 */
export interface LogRow {
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
}

export const LogModel = defineModel<LogRow>({
    name: 'log',
    endpoint: '/api/logs',
    // logit rest.py VIEW_PERMS: manage_logs | view_logs | security | admin.
    permissions: {
        view: ['view_logs', 'manage_logs', 'security'],
        manage: ['manage_logs'],
    },
});

/** Log levels as the backend writes them — filter options + tone map input. */
export const LOG_LEVEL_OPTIONS = [
    { value: 'info', label: 'Info' },
    { value: 'warning', label: 'Warning' },
    { value: 'error', label: 'Error' },
    { value: 'critical', label: 'Critical' },
];

/** Query params helper: the member list for one group (GroupDetail). */
export function memberParamsFor(groupId: number, search: string): Params {
    const params: Params = { group: groupId, size: 8, sort: '-id' };
    if (search) params.search = search;
    return params;
}
