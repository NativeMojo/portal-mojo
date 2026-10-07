// account/api — thin, typed wrappers over the django-mojo self-service
// account wire (the AccountModal's transport). Each function is ONE call
// through the single envelope boundary (mojoCall); every server-gated call
// (@requires_fresh_auth) runs under withFreshAuth so a 440 re-prompts over
// the current screen and retries once.
//
// One-time values (TOTP secret/uri/QR, recovery codes, the phone-change
// session_token) are RETURNED to the caller and never written to any
// TanStack cache here — callers keep them in component state for the life of
// the dialog that shows them.
//
// Wire authority: django-mojo account/rest/totp.py, rest/user.py,
// rest/verify.py, rest/notification_prefs.py (read 2026-10-07).
import { MojoError } from '../client/errors';
import { mojoCall } from '../client/client';
import { withFreshAuth } from '../client/auth';

export {
    confirmEmailChange,
    isPasskeyRegistrationSupported,
    passkeyErrorMessage,
    registerPasskey,
    revokeOtherSessions,
    suggestPasskeyName,
    type RegisteredPasskey,
} from '../client/auth';

const message = (body: { message?: string }, fallback: string) =>
    typeof body.message === 'string' && body.message ? body.message : fallback;

// ── Authenticator app (TOTP) ──────────────────────────────────────────

export interface TotpSetup {
    /** Base32 secret for manual entry. One-time: keep in dialog state only. */
    secret: string;
    /** otpauth:// provisioning URI. */
    uri: string;
    /** `data:image/…;base64,` QR of `uri`, or null when it is not a safe data image. */
    qrCode: string | null;
}

const SAFE_QR = /^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

/** Only a base64 PNG/SVG data URL may become an <img src>. */
export function safeQrDataUrl(value: unknown): string | null {
    return typeof value === 'string' && SAFE_QR.test(value) ? value : null;
}

/**
 * `POST /api/account/totp/setup` (fresh auth). Replaces any stored secret and
 * DISABLES an active authenticator until `confirmTotp` succeeds.
 */
export async function startTotpSetup(): Promise<TotpSetup> {
    const body = await withFreshAuth(() => mojoCall('/api/account/totp/setup', { method: 'POST', body: {} }));
    const data = (body.data ?? {}) as { secret?: unknown; uri?: unknown; qr_code?: unknown };
    return {
        secret: typeof data.secret === 'string' ? data.secret : '',
        uri: typeof data.uri === 'string' ? data.uri : '',
        qrCode: safeQrDataUrl(data.qr_code),
    };
}

/**
 * `POST /api/account/totp/confirm {code}` (fresh auth) → the 8 recovery codes,
 * shown ONCE. The server also sets requires_mfa.
 */
export async function confirmTotp(code: string): Promise<string[]> {
    const body = await withFreshAuth(() => mojoCall('/api/account/totp/confirm', { method: 'POST', body: { code } }));
    return recoveryCodesOf(body.data);
}

/** `DELETE /api/account/totp` (fresh auth). requires_mfa is NOT cleared. */
export async function disableTotp(): Promise<void> {
    await withFreshAuth(() => mojoCall('/api/account/totp', { method: 'DELETE' }));
}

export interface RecoveryCodeStatus {
    enrolled: boolean;
    remaining: number;
}

/**
 * Enrollment + remaining recovery codes from `GET …/totp/recovery-codes` —
 * the only self-visible "authenticator is on" signal (400 = not enrolled).
 * The masked hints are dropped here so a cached status never holds them.
 */
export async function getRecoveryCodeStatus(): Promise<RecoveryCodeStatus> {
    try {
        const body = await mojoCall('/api/account/totp/recovery-codes');
        const data = (body.data ?? {}) as { remaining?: unknown };
        return { enrolled: true, remaining: typeof data.remaining === 'number' ? data.remaining : 0 };
    } catch (error) {
        if (error instanceof MojoError && error.status === 400) return { enrolled: false, remaining: 0 };
        throw error;
    }
}

/** The masked hints (`a4k2-xxxx-xxxx`) for the View dialog — component state only. */
export async function getMaskedRecoveryCodes(): Promise<{ remaining: number; codes: string[] }> {
    const body = await mojoCall('/api/account/totp/recovery-codes');
    const data = (body.data ?? {}) as { remaining?: unknown; codes?: unknown };
    return {
        remaining: typeof data.remaining === 'number' ? data.remaining : 0,
        codes: Array.isArray(data.codes) ? data.codes.filter((c): c is string => typeof c === 'string') : [],
    };
}

/** `POST …/recovery-codes/regenerate {code}` (fresh auth) → a fresh set, shown ONCE. */
export async function regenerateRecoveryCodes(code: string): Promise<string[]> {
    const body = await withFreshAuth(() => mojoCall('/api/account/totp/recovery-codes/regenerate', { method: 'POST', body: { code } }));
    return recoveryCodesOf(body.data);
}

function recoveryCodesOf(data: unknown): string[] {
    const codes = (data as { recovery_codes?: unknown } | undefined)?.recovery_codes;
    return Array.isArray(codes) ? codes.filter((c): c is string => typeof c === 'string') : [];
}

// ── Password ──────────────────────────────────────────────────────────

/**
 * Self password change: `POST /api/user/me {current_password, new_password}`.
 * Wrong/missing current → 400 with the server's message. Not fresh-auth
 * gated and no session rotation (user.py:819-828).
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await mojoCall('/api/user/me', {
        method: 'POST',
        body: { current_password: currentPassword, new_password: newPassword },
    });
}

// ── Email / phone changes and verification ────────────────────────────

/**
 * `POST /api/auth/email/change/request {email, method:'code'}` (fresh auth).
 * A 6-digit code goes to the NEW address; finish with confirmEmailChange().
 */
export async function requestEmailChange(email: string): Promise<string> {
    const body = await withFreshAuth(() => mojoCall('/api/auth/email/change/request', {
        method: 'POST',
        body: { email, method: 'code' },
    }));
    return message(body, 'A verification code has been sent to your new email address.');
}

export interface PhoneChangeTicket {
    /** One-time token pairing the code with this request. Dialog state only. */
    sessionToken: string;
    message: string;
}

/**
 * `POST /api/auth/phone/change/request {phone_number}` (fresh auth). The
 * session_token rides at the envelope's TOP level, not under `data`.
 */
export async function requestPhoneChange(phoneNumber: string): Promise<PhoneChangeTicket> {
    const body = await withFreshAuth(() => mojoCall('/api/auth/phone/change/request', {
        method: 'POST',
        body: { phone_number: phoneNumber },
    }));
    const token = (body as { session_token?: unknown }).session_token;
    if (typeof token !== 'string' || !token) throw new MojoError('The server did not return a phone change session', 0);
    return { sessionToken: token, message: message(body, 'A verification code has been sent to your new phone number.') };
}

/** `POST /api/auth/phone/change/confirm {session_token, code}` — commits + verifies the number. */
export async function confirmPhoneChange(sessionToken: string, code: string): Promise<string> {
    const body = await mojoCall('/api/auth/phone/change/confirm', {
        method: 'POST',
        body: { session_token: sessionToken, code },
    });
    return message(body, 'Phone number updated successfully.');
}

/** `POST /api/auth/verify/{email|phone}/send` — a code (email asks for `method:'code'`). */
export async function sendVerificationCode(channel: 'email' | 'phone'): Promise<string> {
    const body = await mojoCall(`/api/auth/verify/${channel}/send`, {
        method: 'POST',
        body: channel === 'email' ? { method: 'code' } : {},
    });
    return message(body, 'Verification code sent');
}

/** `POST /api/auth/verify/{email|phone}/confirm {code}`. */
export async function confirmVerificationCode(channel: 'email' | 'phone', code: string): Promise<string> {
    const body = await mojoCall(`/api/auth/verify/${channel}/confirm`, { method: 'POST', body: { code } });
    return message(body, channel === 'email' ? 'Email verified' : 'Phone verified');
}

/** `POST /api/auth/username/change {username}` (fresh auth) → the saved username. */
export async function changeUsername(username: string): Promise<string> {
    const body = await withFreshAuth(() => mojoCall('/api/auth/username/change', { method: 'POST', body: { username } }));
    const saved = (body.data as { username?: unknown } | undefined)?.username;
    return typeof saved === 'string' ? saved : username;
}

// ── Notification preferences ──────────────────────────────────────────

export type NotificationChannel = 'email' | 'push' | 'in_app';
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['email', 'push', 'in_app'];
/** The reserved all-kinds entry: `"*".<channel> === false` silences a channel. */
export const ALL_KINDS = '*';

export type NotificationPreferences = Record<string, Partial<Record<NotificationChannel, boolean>>>;

export interface NotificationKind {
    kind: string;
    label: string;
    description?: string;
    /** Channels this kind is delivered on; null/absent = all. */
    channels?: NotificationChannel[] | null;
}

export interface NotificationPreferencesResponse {
    preferences: NotificationPreferences;
    /** The server's registered kinds, when it ships the registry. */
    kinds: NotificationKind[] | null;
}

export async function getNotificationPreferences(): Promise<NotificationPreferencesResponse> {
    const body = await mojoCall('/api/account/notification/preferences');
    const data = (body.data ?? {}) as { preferences?: unknown; kinds?: unknown };
    const preferences = data.preferences && typeof data.preferences === 'object' ? data.preferences as NotificationPreferences : {};
    const kinds = Array.isArray(data.kinds)
        ? data.kinds.filter((k): k is NotificationKind => Boolean(k) && typeof (k as NotificationKind).kind === 'string' && (k as NotificationKind).kind !== ALL_KINDS)
        : null;
    return { preferences, kinds };
}

/** Partial update `{preferences: {kind: {channel: bool}}}` → the merged map. */
export async function setNotificationPreferences(partial: NotificationPreferences): Promise<NotificationPreferences> {
    const body = await mojoCall('/api/account/notification/preferences', { method: 'POST', body: { preferences: partial } });
    const data = (body.data ?? {}) as { preferences?: unknown };
    return data.preferences && typeof data.preferences === 'object' ? data.preferences as NotificationPreferences : {};
}
