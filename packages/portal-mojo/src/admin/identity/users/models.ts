import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    defineModel, mojoCall, withFreshAuth,
    type User,
} from '../../../client';

/** Global Admin gates. `sys.` prevents active-member authority leaking in. */
export const USER_VIEW_PERMISSIONS = ['sys.users', 'sys.view_users', 'sys.manage_users'];
export const USER_MANAGE_PERMISSIONS = ['sys.users', 'sys.manage_users'];
export const USER_DEVICE_PERMISSIONS = USER_MANAGE_PERMISSIONS;
export const USER_PUSH_DEVICE_PERMISSIONS = [
    'sys.view_devices', 'sys.manage_devices', 'sys.comms', 'sys.manage_users', 'sys.users',
];
export const USER_LOGIN_PERMISSIONS = [
    'sys.manage_users', 'sys.security', 'sys.users',
];
export const USER_LOG_PERMISSIONS = ['sys.view_logs', 'sys.manage_logs', 'sys.security'];
export const USER_EVENT_PERMISSIONS = ['sys.view_security', 'sys.security'];

/** Default user graph plus fields that do not ride the list graph. */
export type UserRow = User & {
    requires_mfa?: boolean;
    has_passkey?: boolean;
};

export const UserModel = defineModel<UserRow>({
    name: 'user',
    endpoint: '/api/user',
    permissions: {
        view: USER_VIEW_PERMISSIONS,
        manage: USER_MANAGE_PERMISSIONS,
        create: USER_MANAGE_PERMISSIONS,
    },
    forms: {
        create: {
            title: 'Add user',
            submitText: 'Create',
            fields: [
                { name: 'display_name', type: 'text', label: 'Display name', required: true, placeholder: 'Jane Cooper' },
                { name: 'email', type: 'email', label: 'Email', required: true, placeholder: 'jane@example.com' },
                { name: 'phone_number', type: 'tel', label: 'Phone', columns: 6 },
                { name: 'username', type: 'text', label: 'Username', columns: 6, placeholder: 'Defaults from email', help: 'Leave blank to derive from email' },
            ],
        },
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
    actions: {
        change_username: { permissions: USER_MANAGE_PERMISSIONS, response: 'payload' },
        disable: { permissions: USER_MANAGE_PERMISSIONS },
        reactivate: { permissions: USER_MANAGE_PERMISSIONS },
        send_invite: { permissions: USER_MANAGE_PERMISSIONS },
        revoke_sessions: { permissions: USER_MANAGE_PERMISSIONS, response: 'payload' },
        disable_totp: { permissions: USER_MANAGE_PERMISSIONS, response: 'payload' },
    },
});

/** `/api/account/api_keys` never serializes its owner or signing material. */
export interface ApiKeyRow {
    id: number;
    label: string;
    allowed_ips: string[];
    expires: number;
    is_active: boolean;
    last_used: number | null;
    created: number;
}

function sanitizeApiKeyRow(row: ApiKeyRow): ApiKeyRow {
    const safe = { ...row } as ApiKeyRow & Record<string, unknown>;
    for (const key of ['token', 'jti', 'auth_key', 'secret', 'token_hash']) delete safe[key];
    return safe;
}

export const ApiKeyModel = defineModel<ApiKeyRow>({
    name: 'api_key',
    endpoint: '/api/account/api_keys',
    permissions: { manageOthers: USER_MANAGE_PERMISSIONS },
    sanitizeRow: sanitizeApiKeyRow,
    forms: {
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
    actions: { revoke: { response: 'payload' } },
});

export interface GenerateUserApiKeyVariables {
    changes: Record<string, unknown>;
    /** Receives the token while the mutation is still pending. */
    onToken?: (token: string) => void | Promise<void>;
}

interface GeneratedKeyResponse {
    id?: number;
    expires?: number;
    token?: string;
    jti?: string;
    auth_key?: string;
    secret?: string;
}

export interface GeneratedKeyReceipt {
    id: number | null;
    expires: number | null;
}

/**
 * Caller-only key generation. The raw response is split before mutation
 * resolution, so TanStack MutationCache receives only non-secret metadata.
 */
export function useGenerateUserApiKey() {
    const qc = useQueryClient();
    return useMutation<GeneratedKeyReceipt, Error, GenerateUserApiKeyVariables>({
        mutationFn: async ({ changes, onToken }) => {
            const response = await withFreshAuth(() => mojoCall('/api/auth/generate_api_key', {
                method: 'POST',
                body: changes,
            }));
            const payload = response.data as GeneratedKeyResponse | undefined;
            const created: GeneratedKeyResponse = payload && typeof payload === 'object' ? { ...payload } : {};
            let token = typeof created.token === 'string' && created.token ? created.token : null;
            try {
                if (token && onToken) await onToken(token);
            } finally {
                token = null;
                for (const key of ['token', 'jti', 'auth_key', 'secret'] as const) delete created[key];
            }
            return {
                id: typeof created.id === 'number' ? created.id : null,
                expires: typeof created.expires === 'number' ? created.expires : null,
            };
        },
        onSuccess: () => { void qc.invalidateQueries({ queryKey: ApiKeyModel.keys.root }); },
    });
}

export interface UAInfo {
    os: { major: string | null; minor: string | null; patch: string | null; family: string; patch_minor: string | null };
    device: { brand: string | null; model: string | null; family: string };
    user_agent: { major: string | null; minor: string | null; patch: string | null; family: string };
    string: string;
}

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
    name: 'device', endpoint: '/api/user/device', permissions: { view: USER_DEVICE_PERMISSIONS },
});

export interface PushDeviceRow {
    id: number;
    device_id: string;
    platform: string;
    device_name: string;
    app_version: string;
    os_version: string;
    push_enabled: boolean;
    push_preferences: Record<string, unknown>;
    last_seen: number;
    user: UserBasicRef | null;
}
export const PushDeviceModel = defineModel<PushDeviceRow>({
    name: 'push_device', endpoint: '/api/account/devices/push', permissions: { view: USER_PUSH_DEVICE_PERMISSIONS },
});

export interface LoginEventRow {
    id: number;
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
    user: UserBasicRef | null;
    event_type?: string;
}
export const LoginEventModel = defineModel<LoginEventRow>({
    name: 'login_event', endpoint: '/api/account/logins', permissions: { view: USER_LOGIN_PERMISSIONS },
});

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
    name: 'passkey', endpoint: '/api/account/passkeys',
    permissions: { view: USER_MANAGE_PERMISSIONS, manage: USER_MANAGE_PERMISSIONS },
});

export interface OAuthConnectionRow {
    id: number;
    provider: string;
    email: string | null;
    is_active: boolean;
    created: number;
}
export const OAuthConnectionModel = defineModel<OAuthConnectionRow>({
    name: 'oauth_connection', endpoint: '/api/account/oauth_connection',
    permissions: { view: USER_MANAGE_PERMISSIONS, manage: USER_MANAGE_PERMISSIONS },
});
