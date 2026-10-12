// account/models — the caller-owned credential models shared by the
// self-service AccountModal and the admin User detail (defined in
// credential-models.ts, re-exported here and by admin/identity/users/models
// unchanged) so portal-mojo/account never imports an admin domain. ONE
// defineModel per endpoint: both surfaces share these cache keys.
//
// Plus MeSaveModel — the `/api/user/me` save the account forms autosave
// through — and the account-only query keys.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    mojoCall, sanitizeMe, useAuthSnapshot, withFreshAuth,
    type Me, type SaveVars,
} from '../client/runtime';
import { withAccountActor } from './actor';
import { getNotificationPreferences, getRecoveryCodeStatus, type NotificationPreferencesResponse, type RecoveryCodeStatus } from './api';

// ── /api/user/me ──────────────────────────────────────────────────────

/**
 * FormView-compatible save for the signed-in user's own row: POSTs ONLY the
 * changed fields to `/api/user/me` (never the `me` row back — the server
 * 403s email/username/is_superuser/permissions even unchanged), sanitizes
 * the answer with sanitizeMe, writes `['me', uid]` and refreshes every
 * `/api/user` cache (UserModel.useSave never touches `me`, and vice versa).
 * The endpoint is always the caller. A supplied id must match that caller;
 * actor checks fence the final send, fresh-auth retry, and cache publication.
 */
export const MeSaveModel = {
    useSave: () => {
        const qc = useQueryClient();
        const { uid } = useAuthSnapshot();
        return useMutation<Me, Error, SaveVars>({
            mutationFn: ({ id, changes }: SaveVars) => withAccountActor(async (actor) => {
                const body = await withFreshAuth(() => mojoCall('/api/user/me', {
                    method: 'POST', body: changes, beforeSend: actor.check,
                }));
                actor.check();
                const row = sanitizeMe(body.data as Me);
                qc.setQueryData(['me', actor.uid], row);
                void qc.invalidateQueries({ queryKey: ['/api/user'] });
                return row;
            }, id ?? uid),
        });
    },
};

/** Refresh `me` (e.g. after a verify/change flow that the server committed). */
export function invalidateMe(qc: ReturnType<typeof useQueryClient>): Promise<void> {
    return qc.invalidateQueries({ queryKey: ['me'] });
}

// ── Credential models (credential-models.ts) ───────────────────────────

export {
    ApiKeyModel, OAuthConnectionModel, PasskeyModel, useGenerateUserApiKey,
    type ApiKeyRow, type GeneratedKeyReceipt, type GenerateUserApiKeyVariables,
    type OAuthConnectionRow, type PasskeyRow,
} from './credential-models';

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
