// Model definitions for the base portal — the defineModel proving ground.
// A definition carries what web-mojo scattered across Model subclasses and
// *Forms statics: endpoint, UI permission gates, form configs, and the
// POST_SAVE_ACTIONS the backend RestMeta declares. Stabilized definitions
// migrate into portal-mojo/admin section bundles alongside their pages.
//
// C4 (board #1281): ApiKey / Log / Member joined, shapes measured against
// the LIVE backend (mverify @9009, 2026-08-05) — see each row type for the
// endpoint + graph facts.
import { defineModel, type Group, type User } from 'portal-mojo/client';

// Canonical monitoring models live with their reusable admin package.
export {
    LogModel,
    LOG_LEVEL_OPTIONS,
    type LogRow,
} from 'portal-mojo/admin';
export { MemberModel, type MemberRow } from 'portal-mojo/admin';

/**
 * The user row as the DEFAULT (one-record) graph serializes it — measured in
 * django-mojo account/models/user.py GRAPHS 2026-08-05: `requires_mfa` and
 * `has_passkey` ride ONLY the default graph; `is_online` rides ONLY the list
 * graph (typed non-optional in the shared User type for list rows — do not
 * read it off a one-record fetch). `is_staff` is serialized by NO graph at
 * all, which is why no portal surface renders or edits it.
 */
export type UserRow = User & {
    requires_mfa?: boolean;
    has_passkey?: boolean;
};

export const UserModel = defineModel<UserRow>({
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
    // change_username / confirm_totp / regenerate_totp_codes actions join
    // when their screens land).
    actions: {
        disable: { permissions: ['users', 'manage_users'] },
        reactivate: { permissions: ['users', 'manage_users'] },
        send_invite: {},
        revoke_sessions: { response: 'payload' },
        // Clears any enrolled authenticator (on_action_disable_totp — no-ops
        // gracefully when nothing is enrolled; answers {status:true}).
        disable_totp: { permissions: ['users', 'manage_users'], response: 'payload' },
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

// ── UserView-parity models (wave: port/user-view-parity) ──────────────
// Shapes below are the LIVE graphs, measured against mverify @9009 and
// django-mojo model RestMeta on 2026-08-05 — not web-mojo's assumptions.

/** ua-parser block as django-mojo stores it on device/login rows. */
export interface UAInfo {
    os: { major: string | null; minor: string | null; patch: string | null; family: string; patch_minor: string | null };
    device: { brand: string | null; model: string | null; family: string };
    user_agent: { major: string | null; minor: string | null; patch: string | null; family: string };
    string: string;
}

/** The basic user sub-graph embedded on device/login rows. */
export interface UserBasicRef {
    id: number;
    display_name: string | null;
    username: string;
    last_login: number | null;
    last_activity: number | null;
    is_active: boolean;
    is_email_verified: boolean;
    is_phone_verified: boolean;
    is_dob_verified: boolean;
    avatar: unknown;
}

/**
 * /api/user/device row (account/models/device.py, list graph measured live):
 * browser sessions keyed by DUID. VIEW_PERMS manage_users|users|owner.
 */
export interface DeviceRow {
    id: number;
    user: UserBasicRef | null;
    muid: string | null;
    duid: string;
    device_info: UAInfo | null;
    user_agent_hash: string | null;
    last_ip: string | null;
    first_seen: number;
    last_seen: number;
}

export const DeviceModel = defineModel<DeviceRow>({
    name: 'device',
    endpoint: '/api/user/device',
    permissions: { view: ['users', 'manage_users'] },
});

/**
 * /api/account/devices/push row (account/models/push/device.py default
 * graph): NOT web-mojo's device_info/duid shape — the real RegisteredDevice
 * serializes platform/device_name/app_version/os_version/push_enabled.
 */
export interface PushDeviceRow {
    id: number;
    device_id: string;
    platform: string; // ios | android | web
    device_name: string;
    app_version: string;
    os_version: string;
    push_enabled: boolean;
    push_preferences: Record<string, unknown>;
    last_seen: number;
    user: UserBasicRef | null;
}

export const PushDeviceModel = defineModel<PushDeviceRow>({
    name: 'push_device',
    endpoint: '/api/account/devices/push',
    permissions: { view: ['view_devices', 'manage_devices', 'comms', 'manage_users'] },
});

/**
 * /api/account/logins row (account/models/login_event.py list graph).
 * NOTE: there is NO event_type on the wire — web-mojo's LOGIN_TONE keyed on
 * it and deliberately fell through to a neutral tone when absent; the field
 * stays optional here so the tone map keeps that exact degrade.
 */
export interface LoginEventRow {
    id: number;
    ip_address: string | null;
    country_code: string | null;
    region: string | null;
    region_code: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    source: string | null; // password | magic | passkey | …
    is_new_country: boolean;
    is_new_region: boolean;
    created: number;
    user: UserBasicRef | null;
    event_type?: string;
}

export const LoginEventModel = defineModel<LoginEventRow>({
    name: 'login_event',
    endpoint: '/api/account/logins',
    permissions: { view: ['manage_users', 'security', 'users'] },
});

/**
 * /api/incident/event row (incident/models/event.py default graph — all
 * concrete fields + group_id extra). The prose field is `details`, not
 * web-mojo's assumed `description`. VIEW_PERMS view_security|security.
 */
export interface IncidentEventRow {
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
}

export const IncidentEventModel = defineModel<IncidentEventRow>({
    name: 'incident_event',
    endpoint: '/api/incident/event',
    permissions: { view: ['view_security', 'security'] },
});

/**
 * /api/account/passkeys row (account/models/pkey.py default graph).
 * Editable via REST save: friendly_name + is_enabled ONLY (NO_SAVE_FIELDS
 * covers the rest); CAN_DELETE true.
 */
export interface PasskeyRow {
    id: number;
    friendly_name: string | null;
    credential_id: string;
    rp_id: string;
    is_enabled: boolean;
    sign_count: number;
    transports: string | null;
    aaguid: string | null;
    last_used: number | null;
    created: number;
}

export const PasskeyModel = defineModel<PasskeyRow>({
    name: 'passkey',
    endpoint: '/api/account/passkeys',
    permissions: { view: ['users', 'manage_users'], manage: ['users', 'manage_users'] },
});

/** /api/account/oauth_connection row (account/models/oauth.py default graph). */
export interface OAuthConnectionRow {
    id: number;
    provider: string;
    email: string | null;
    is_active: boolean;
    created: number;
}

export const OAuthConnectionModel = defineModel<OAuthConnectionRow>({
    name: 'oauth_connection',
    endpoint: '/api/account/oauth_connection',
    permissions: { view: ['users', 'manage_users'], manage: ['users', 'manage_users'] },
});
