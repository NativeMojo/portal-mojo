import {
    defineModel,
    sanitizeAvatarRelation, type User,
} from '../../../client/runtime';
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

/** UserModel's independent cache boundary (lists, detail, saves, actions). */
export function sanitizeUserRow(row: UserRow): UserRow {
    return { ...row, avatar: sanitizeAvatarRelation(row.avatar) };
}

export const UserModel = defineModel<UserRow>({
    name: 'user',
    endpoint: '/api/user',
    sanitizeRow: sanitizeUserRow,
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

// The caller-owned credential models live in portal-mojo/account (shared by
// the self-service AccountModal) and are re-exported here unchanged.
export {
    ApiKeyModel,
    OAuthConnectionModel,
    PasskeyModel,
    useGenerateUserApiKey,
} from '../../../account/credential-models';
export type {
    ApiKeyRow,
    GeneratedKeyReceipt,
    GenerateUserApiKeyVariables,
    OAuthConnectionRow,
    PasskeyRow,
} from '../../../account/credential-models';

// LoginEventRow / LoginEventModel are re-exported from the canonical module
// above. The local copy carried a phantom `event_type?: string` field that
// `UserLoginEvent` has never had — see docs/admin-devices-geoip.md.
