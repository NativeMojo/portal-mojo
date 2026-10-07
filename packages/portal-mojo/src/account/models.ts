// account/models — the caller-owned credential models shared by the
// self-service AccountModal and the admin User detail. Moved down from
// admin/identity/users/models.ts (which re-exports them unchanged) so
// portal-mojo/account never imports an admin domain. ONE defineModel per
// endpoint: both surfaces share these cache keys.
//
// Plus MeSaveModel — the `/api/user/me` save the account forms autosave
// through — and the account-only query keys.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    defineModel, mojoCall, mojoSave, sanitizeMe, useAuthSnapshot, withFreshAuth,
    type Me, type SaveVars,
} from '../client/runtime';
import { getNotificationPreferences, getRecoveryCodeStatus, type NotificationPreferencesResponse, type RecoveryCodeStatus } from './api';

/** The global user-administration gate (admin's USER_MANAGE_PERMISSIONS). */
const USER_ADMIN_PERMISSIONS = ['sys.users', 'sys.manage_users'];

// ── /api/user/me ──────────────────────────────────────────────────────

/**
 * FormView-compatible save for the signed-in user's own row: POSTs ONLY the
 * changed fields to `/api/user/me` (never the `me` row back — the server
 * 403s email/username/is_superuser/permissions even unchanged), sanitizes
 * the answer with sanitizeMe, writes `['me', uid]` and refreshes every
 * `/api/user` cache (UserModel.useSave never touches `me`, and vice versa).
 * The `id` in SaveVars is ignored: the endpoint is always the caller.
 */
export const MeSaveModel = {
    useSave: () => {
        const qc = useQueryClient();
        const { uid } = useAuthSnapshot();
        return useMutation<Me, Error, SaveVars>({
            mutationFn: async ({ changes }: SaveVars) => sanitizeMe(await withFreshAuth(() => mojoSave<Me>('/api/user/me', null, changes))),
            onSuccess: (row) => {
                qc.setQueryData(['me', uid], row);
                void qc.invalidateQueries({ queryKey: ['/api/user'] });
            },
        });
    },
};

/** Refresh `me` (e.g. after a verify/change flow that the server committed). */
export function invalidateMe(qc: ReturnType<typeof useQueryClient>): Promise<void> {
    return qc.invalidateQueries({ queryKey: ['me'] });
}

// ── Passkeys ──────────────────────────────────────────────────────────

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

/**
 * `/api/account/passkeys`. Always list with `?user=<id>`: a `users` /
 * `manage_users` caller is otherwise served EVERY user's passkeys
 * (django-mojo models/rest.py:927-954). Editable: friendly_name, is_enabled.
 */
export const PasskeyModel = defineModel<PasskeyRow>({
    name: 'passkey', endpoint: '/api/account/passkeys',
    permissions: { view: USER_ADMIN_PERMISSIONS, manage: USER_ADMIN_PERMISSIONS },
});

// ── API keys ──────────────────────────────────────────────────────────

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
    permissions: { manageOthers: USER_ADMIN_PERMISSIONS },
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

// ── OAuth connections ─────────────────────────────────────────────────

export interface OAuthConnectionRow {
    id: number;
    provider: string;
    email: string | null;
    is_active: boolean;
    created: number;
}

/** `/api/account/oauth_connection` — DELETE unlinks; the server refuses the last login method (400). */
export const OAuthConnectionModel = defineModel<OAuthConnectionRow>({
    name: 'oauth_connection', endpoint: '/api/account/oauth_connection',
    permissions: { view: USER_ADMIN_PERMISSIONS, manage: USER_ADMIN_PERMISSIONS },
});

// ── Account-only queries ──────────────────────────────────────────────

export const accountKeys = {
    /** `{enrolled, remaining}` ONLY — never the masked hints (4 of 12 hex chars each). */
    recoveryStatus: (uid: number | string | null) => ['/api/account/totp/recovery-codes', 'status', uid] as const,
    /** Shared with the admin User detail's Notifications section. */
    notificationPreferences: (uid: number | string | null) => ['/api/account/notification/preferences', uid] as const,
};

export function useRecoveryCodeStatus(uid: number | null) {
    return useQuery<RecoveryCodeStatus>({
        queryKey: accountKeys.recoveryStatus(uid),
        queryFn: getRecoveryCodeStatus,
        enabled: uid != null,
    });
}

export function useNotificationPreferences(uid: number | null, enabled = true) {
    return useQuery<NotificationPreferencesResponse>({
        queryKey: accountKeys.notificationPreferences(uid),
        queryFn: getNotificationPreferences,
        enabled: uid != null && enabled,
    });
}
