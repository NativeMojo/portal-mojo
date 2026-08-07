import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    defineModel, mojoCall, withFreshAuth,
    type User,
} from '../../../client';
// ONE defineModel per endpoint (#1291). The device / device-location /
// login-event models are DEFINED in admin/security/devices/models.ts — the
// fleet-wide owner of those three endpoints — and re-exported here so
// UserDetail's sections keep their existing import surface. Two definitions
// would mean two cache keys and therefore a double fetch of the same rows.
import {
    LoginEventModel, UserDeviceLocationModel, UserDeviceModel,
    USER_DEVICE_VIEW_PERMS, LOGIN_EVENT_VIEW_PERMS,
} from '../../security/devices/models';
export {
    PUSH_DEVICE_VIEW_PERMISSIONS as USER_PUSH_DEVICE_PERMISSIONS,
    PushDeviceModel,
} from '../../messaging/push/models';
export type { PushDeviceRow } from '../../messaging/push/models';

export {
    LoginEventModel,
    UserDeviceLocationModel,
    UserDeviceModel,
    /** Historical alias — UserDetail's Devices section imports `DeviceModel`. */
    UserDeviceModel as DeviceModel,
};
export type {
    LoginEventRow,
    UAInfo,
    UserBasicRef,
    UserDeviceLocationRow,
    UserDeviceRow,
    /** Historical alias for the row type. */
    UserDeviceRow as DeviceRow,
} from '../../security/devices/models';

/** Global Admin gates. `sys.` prevents active-member authority leaking in. */
export const USER_VIEW_PERMISSIONS = ['sys.users', 'sys.view_users', 'sys.manage_users'];
export const USER_MANAGE_PERMISSIONS = ['sys.users', 'sys.manage_users'];
/** Same clause as the canonical `USER_DEVICE_VIEW_PERMS`, kept as the name
 *  UserDetail already imports. Both derive from `UserDevice.VIEW_PERMS`. */
export const USER_DEVICE_PERMISSIONS = USER_DEVICE_VIEW_PERMS;
export const USER_LOGIN_PERMISSIONS = LOGIN_EVENT_VIEW_PERMS;
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

// LoginEventRow / LoginEventModel are re-exported from the canonical module
// above. The local copy carried a phantom `event_type?: string` field that
// `UserLoginEvent` has never had — see docs/admin-devices-geoip.md.

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
