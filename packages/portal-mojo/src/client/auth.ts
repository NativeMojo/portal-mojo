// Auth client — ported from web-mojo TokenManager + PortalApp._installAuthGate
// + the mojo-auth endpoint contract, verified against django-mojo
// (apps/account/rest/user.py, passkeys.py).
//
// Contracts carried over exactly:
//   · storage keys `access_token` / `refresh_token` (web-mojo parity — an
//     existing web-mojo session survives a portal swap)
//   · single-flight refresh: concurrent callers share ONE in-flight POST
//   · token-status decision table incl. the proactive branch (expiring within
//     10 min, or older than 60 min, with a valid refresh token → refresh)
//   · pre-request gate: bypass /api/token/refresh exactly (recursion guard)
//     and requests made with no stored token (pre-login / public); otherwise
//     ensureValidToken() — blocks fetch on any refresh failure; only a
//     confirmed denial becomes AuthRequiredError (synthetic 401)
//   · auth-code / magic-token URL handoff: the param is scrubbed from the URL
//     *synchronously, before any network call*, so a slow exchange cannot
//     leak the one-time code to third-party scripts reading location.search
//   · logout is client-side only — django-mojo has no logout endpoint
//
// Two web-mojo traps deliberately NOT carried forward:
//   · setTokens now clears BOTH storages before writing one, so a stale
//     localStorage token can never shadow a fresh sessionStorage session
//   · a refresh re-stores into the storage the session came from — web-mojo
//     silently promoted remember-me=false sessions to localStorage
//
// C3 additions (board #1259), same wire authority (django-mojo account app):
//   · MFA completion — totp/verify, totp/recover, sms/send (which CONSUMES
//     and RE-ISSUES the mfa_token), sms/verify (account/rest/totp.py, sms.py)
//   · fresh-auth (step-up) challenge surface — HTTP 440 / 'reauth_required'
//     (mojo/errors.py ReauthRequiredException, services/fresh_auth.py). A
//     refresh can NEVER satisfy it: auth_time is carried forward unchanged
//     across refreshes by design — only a genuine re-login mints a new one.
import { AuthRequiredError, MojoError } from './errors';
import { tokenInfo } from './jwt';
import { apiOrigin, installAuthHooks, isPackagedAdmin, mojoCall } from './client';

const ACCESS_KEY = 'access_token';
const REFRESH_KEY = 'refresh_token';
const AUTH_CODE_PARAM = 'auth_code';

/** The one path the pre-request gate must never gate (recursion guard). */
export const REFRESH_PATH = '/api/token/refresh';

// ── Token storage ─────────────────────────────────────────────────────

export function getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_KEY) ?? sessionStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_KEY) ?? sessionStorage.getItem(REFRESH_KEY);
}

/**
 * Which storage the current session lives in (refresh keeps it there).
 * Public since C3: a fresh-auth re-login must keep the session in the
 * storage the user originally chose (remember-me), not silently promote it.
 */
export function sessionIsPersistent(): boolean {
    return localStorage.getItem(REFRESH_KEY) != null || localStorage.getItem(ACCESS_KEY) != null;
}

export function setTokens(access: string, refresh?: string | null, persistent = true): void {
    storeTokens(access, refresh, persistent, 'session');
}

function storeTokens(access: string, refresh: string | null | undefined, persistent: boolean, source: 'session' | 'refresh'): void {
    // Clear both storages first — a leftover token in the other storage must
    // never shadow this session (web-mojo wrote without clearing).
    clearTokens({ silent: true });
    const storage = persistent ? localStorage : sessionStorage;
    storage.setItem(ACCESS_KEY, access);
    if (refresh) storage.setItem(REFRESH_KEY, refresh);
    notifyAuthChanged(source);
}

export function clearTokens(opts: { silent?: boolean } = {}): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    sessionStorage.removeItem(ACCESS_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    if (!opts.silent) notifyAuthChanged();
}

// ── Auth state (useSyncExternalStore-compatible) ──────────────────────

export interface AuthSnapshot {
    /** A currently-valid access token OR a valid refresh token exists. */
    authenticated: boolean;
    uid: string | null;
    email: string | null;
}

let snapshotCache: AuthSnapshot = { authenticated: false, uid: null, email: null };
let snapshotKey = '∅';
let sessionRevision = 0;
/** The account an open step-up challenge re-confirms (requestFreshAuth). */
let stepUpUid: string | null = null;
const authListeners = new Set<() => void>();

/** @internal Same-tab replacement fence; ordinary renewal does not advance it. */
export function getAuthSessionRevision(): number {
    return sessionRevision;
}

function computeSnapshot(): void {
    const access = getAccessToken();
    const refresh = getRefreshToken();
    const key = `${access ?? ''}|${refresh ?? ''}`;
    if (key === snapshotKey) return;
    snapshotKey = key;
    const a = tokenInfo(access);
    const r = tokenInfo(refresh);
    snapshotCache = {
        authenticated: Boolean(a?.isValid || r?.isValid),
        uid: a?.uid ?? r?.uid ?? null,
        email: a?.email ?? r?.email ?? null,
    };
}

function notifyAuthChanged(source: 'session' | 'refresh' = 'session'): void {
    computeSnapshot();
    // A same-account re-login answering an open step-up challenge renews
    // auth_time inside the SAME session (#10670): fenced screens keep their
    // state and open dialogs. Any other sign-in, switch or sign-out replaces it.
    if (source === 'session' && !(stepUpUid !== null && snapshotCache.uid === stepUpUid)) sessionRevision += 1;
    for (const cb of authListeners) cb();
}

/** Stable snapshot — reference changes only when the stored tokens change. */
export function getAuthSnapshot(): AuthSnapshot {
    computeSnapshot();
    return snapshotCache;
}

let storageListenerInstalled = false;

/** Subscribe to auth-state changes (incl. cross-tab via the storage event). */
export function subscribeAuth(cb: () => void): () => void {
    if (!storageListenerInstalled && typeof window !== 'undefined') {
        storageListenerInstalled = true;
        window.addEventListener('storage', (e) => {
            if (e.key === null || e.key === ACCESS_KEY || e.key === REFRESH_KEY) notifyAuthChanged();
        });
    }
    authListeners.add(cb);
    return () => authListeners.delete(cb);
}

// ── Auth events ───────────────────────────────────────────────────────

/**
 * 'login' — an explicit, completed sign-in (password/MFA/passkey/magic/reset/
 * exchange). 'rotated' — the SAME user's session re-issued by a credential
 * change (sessions revoke, email-change confirm): new tokens, not a login.
 */
export type AuthEvent = 'login' | 'rotated' | 'logout' | 'refreshed' | 'refresh-failed' | 'unauthorized';
const eventListeners = new Map<AuthEvent, Set<(detail?: unknown) => void>>();

export function onAuth(event: AuthEvent, cb: (detail?: unknown) => void): () => void {
    let set = eventListeners.get(event);
    if (!set) eventListeners.set(event, (set = new Set()));
    set.add(cb);
    return () => set.delete(cb);
}

function emitAuth(event: AuthEvent, detail?: unknown): void {
    eventListeners.get(event)?.forEach((cb) => cb(detail));
}

// ── Token status + refresh (single-flight) ────────────────────────────

export type TokenAction = 'none' | 'refresh' | 'logout';

/** The TokenManager decision table, ported verbatim. */
export function checkTokenStatus(): { action: TokenAction; reason: string } {
    const access = tokenInfo(getAccessToken());
    const refresh = tokenInfo(getRefreshToken());
    const refreshUsable = Boolean(refresh?.isValid && !refresh.isExpired);

    if (!access || !access.isValid || access.isExpired) {
        if (!refreshUsable) return { action: 'logout', reason: 'Both access and refresh tokens are invalid/expired' };
        return { action: 'refresh', reason: 'Access token invalid/expired but refresh token valid' };
    }
    const age = access.ageMinutes();
    if (access.expiringSoon(10) || (age != null && age > 60)) {
        if (!refreshUsable) return { action: 'none', reason: 'Access token expiring but refresh token invalid' };
        return { action: 'refresh', reason: 'Access token expiring soon or aged' };
    }
    return { action: 'none', reason: 'All tokens valid and not expiring soon' };
}

type RefreshOutcome = { ok: true } | { ok: false; error?: unknown };
let refreshPromise: Promise<RefreshOutcome> | null = null;

/**
 * Refresh the access token. Single-flight: concurrent callers share one
 * in-flight POST. Always resolves to a boolean; never throws.
 */
export function refreshTokens(): Promise<boolean> {
    return refreshOutcome().then(result => result.ok);
}

function refreshOutcome(): Promise<RefreshOutcome> {
    if (!refreshPromise) {
        refreshPromise = doRefresh().finally(() => {
            refreshPromise = null;
        });
    }
    return refreshPromise;
}

async function doRefresh(): Promise<RefreshOutcome> {
    const refresh = getRefreshToken();
    const info = tokenInfo(refresh);
    if (!refresh || !info?.isValid || info.isExpired) {
        emitAuth('unauthorized');
        stopAutoRefresh();
        return { ok: false };
    }
    const persistent = sessionIsPersistent();
    // The answer is for the session whose refresh token was sent. When the
    // stored one is no longer that token, the session was replaced while this
    // was in flight: a save that changed the password (tokensReplaced), a new
    // sign-in, a sign-out. A late pair is signed with a key the server has
    // dropped, and a late 401 is about a token nobody holds any more; either
    // one, acted on, would undo the session that replaced it.
    const superseded = (): boolean => getRefreshToken() !== refresh;
    const sessionUsable = (): boolean => checkTokenStatus().action !== 'logout';
    try {
        const body = await mojoCall(REFRESH_PATH, {
            method: 'POST', body: { refresh_token: refresh }, signal: AbortSignal.timeout(15_000),
        });
        if (superseded()) return { ok: sessionUsable() };
        const pkg = body.data as { access_token: string; refresh_token?: string };
        storeTokens(pkg.access_token, pkg.refresh_token, persistent, 'refresh');
        emitAuth('refreshed');
        return { ok: true };
    } catch (error) {
        if (superseded()) return { ok: sessionUsable() };
        const status = error instanceof Error && 'status' in error ? (error as { status: number }).status : 0;
        if (status === 401 || status === 403) {
            emitAuth('unauthorized');
            stopAutoRefresh();
            return { ok: false };
        } else {
            // Transient (network/5xx): keep the session, report, let the
            // watcher or the next gated request retry.
            emitAuth('refresh-failed', error);
            return { ok: false, error };
        }
    }
}

/**
 * Pre-request gate (TokenManager.ensureValidToken). Throws AuthRequiredError
 * on confirmed denial. A temporary refresh failure preserves its original
 * error; both failures block the protected request without touching fetch.
 */
export async function ensureValidToken(): Promise<void> {
    const status = checkTokenStatus();
    if (status.action === 'logout') {
        emitAuth('unauthorized');
        stopAutoRefresh();
        throw new AuthRequiredError('Both access and refresh tokens are invalid');
    }
    if (status.action === 'refresh') {
        const result = await refreshOutcome();
        if (!result.ok) {
            if ('error' in result) throw result.error;
            throw new AuthRequiredError('Token refresh failed');
        }
    }
}

export type SessionVerification = 'valid' | 'denied' | 'unverified';

let sessionVerification: { revision: number; uid: string | null; result: Promise<SessionVerification> } | undefined;

/** Verify the selected account after an ambiguous API or realtime auth failure.
 * Only unusable credentials or two consecutive account denials require sign-in.
 */
export function verifyCurrentSession(): Promise<SessionVerification> {
    if (checkTokenStatus().action === 'logout') return Promise.resolve('denied');
    const revision = getAuthSessionRevision();
    const { uid } = getAuthSnapshot();
    if (sessionVerification?.revision === revision && sessionVerification.uid === uid) {
        return sessionVerification.result;
    }
    const current = () => getAuthSessionRevision() === revision && getAuthSnapshot().uid === uid;
    const result = Promise.resolve().then(async (): Promise<SessionVerification> => {
        let consecutiveDenials = 0;
        for (const delay of [0, 350, 1000]) {
            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
            if (!current()) return 'unverified';
            try {
                const response = await mojoCall('/api/user/me', {
                    signal: AbortSignal.timeout(5000),
                    beforeSend: () => {
                        if (!current()) throw new DOMException('Session changed', 'AbortError');
                    },
                });
                if (!current()) return 'unverified';
                const account = response.data as { id?: string | number } | undefined;
                if (uid !== null && account?.id != null && String(account.id) === uid) {
                    if (getRefreshToken()) startAutoRefresh();
                    return 'valid';
                }
                consecutiveDenials = 0;
            } catch (error) {
                if (!current()) return 'unverified';
                const denied = error instanceof MojoError && (error.status === 401 || error.status === 403);
                consecutiveDenials = denied ? consecutiveDenials + 1 : 0;
                if (consecutiveDenials === 2) return 'denied';
            }
        }
        return 'unverified';
    }).finally(() => {
        if (sessionVerification?.result === result) sessionVerification = undefined;
    });
    sessionVerification = { revision, uid, result };
    return result;
}

// ── Auto-refresh watcher ──────────────────────────────────────────────

let tokenWatcher: ReturnType<typeof setInterval> | null = null;

export function startAutoRefresh(): void {
    stopAutoRefresh();
    tokenWatcher = setInterval(() => {
        const status = checkTokenStatus();
        if (status.action === 'logout') {
            emitAuth('unauthorized');
            stopAutoRefresh();
        } else if (status.action === 'refresh') {
            void refreshTokens();
        }
    }, 60_000);
}

export function stopAutoRefresh(): void {
    if (tokenWatcher) {
        clearInterval(tokenWatcher);
        tokenWatcher = null;
    }
}

// ── Login flows ───────────────────────────────────────────────────────
// Every flow REJECTS (MojoError) on failure — including "Invalid username or
// password" (401) and the verification gates `email_not_verified` /
// `phone_not_verified` (403) — and stores tokens on success.

/** django-mojo user dict (`to_dict("basic")`). Typed properly in Chunk A2. */
export type AuthUser = Record<string, unknown>;

/**
 * The MFA challenge a password login can answer with. `methods` come from
 * the server's get_mfa_methods: 'totp' | 'sms' | 'passkey' (a deployment may
 * grow more — treat unknown entries as unofferable, never as fatal).
 */
export interface MfaChallenge {
    mfaToken: string;
    methods: string[];
    expiresIn: number;
}

export type LoginResult =
    | { kind: 'authenticated'; user: AuthUser }
    /** Password accepted but MFA is required — no tokens issued yet. */
    | ({ kind: 'mfa' } & MfaChallenge);

export interface LoginOptions {
    /** true (default) → localStorage; false → sessionStorage. */
    remember?: boolean;
    /** Extra payload fields, e.g. a `bouncer_token` when the deployment enforces one. */
    extra?: Record<string, unknown>;
}

interface TokenGrant {
    access_token: string;
    refresh_token?: string;
    user?: AuthUser;
    mfa_required?: boolean;
    mfa_token?: string;
    mfa_methods?: string[];
    expires_in?: number;
}

/** Copy for a grant that carries no usable session (e.g. a forced-password answer). */
export const GRANT_SIGN_IN_AGAIN = 'Sign in again to continue';

/**
 * Store a TokenGrant as THE session. Validates first — a django-mojo
 * forced_password_response, for one, answers without tokens after auth_key
 * rotated — and leaves storage untouched (rejecting) when the grant has no
 * access + refresh pair. Serialised behind any in-flight refresh so a
 * refresh that started on the old session can never land on top of it.
 */
async function adoptGrant(data: TokenGrant | null | undefined, remember = true, event: 'login' | 'rotated' = 'login', check?: () => void): Promise<AuthUser> {
    if (!data || typeof data.access_token !== 'string' || !data.access_token
        || typeof data.refresh_token !== 'string' || !data.refresh_token) {
        throw new Error(GRANT_SIGN_IN_AGAIN);
    }
    if (refreshPromise) await refreshPromise;
    check?.();
    setTokens(data.access_token, data.refresh_token, remember);
    startAutoRefresh();
    const user = data.user ?? {};
    emitAuth(event, user);
    return user;
}

/** Password login. `username` may be a username, email, or (if enabled) phone. */
export async function login(username: string, password: string, opts: LoginOptions = {}): Promise<LoginResult> {
    // A malformed/expired session must not prevent the user from replacing it.
    // The transport gate deliberately blocks authenticated requests when both
    // tokens are unusable, but /api/login is itself the recovery path. Clear
    // only that dead session; a valid session (including fresh-auth re-login)
    // remains intact until the new grant is adopted.
    if (checkTokenStatus().action === 'logout') clearTokens({ silent: true });
    const body = await mojoCall('/api/login', { method: 'POST', body: { username, password, ...opts.extra } });
    const data = body.data as TokenGrant;
    if (data.mfa_required) {
        return { kind: 'mfa', mfaToken: data.mfa_token ?? '', methods: data.mfa_methods ?? [], expiresIn: data.expires_in ?? 300 };
    }
    return { kind: 'authenticated', user: await adoptGrant(data, opts.remember ?? true) };
}

// ── MFA completion (deferred from A1; landed with the C3 pages) ───────
// Each completion consumes the mfa_token and answers with a full TokenGrant
// (django-mojo jwt_login) — adopted here exactly like a password login.
// `remember` mirrors LoginOptions: the MFA step continues the login the
// user began, so the page passes the same remember-me choice through.

export interface MfaCompletionOptions {
    /** true (default) → localStorage; false → sessionStorage. */
    remember?: boolean;
}

/** Second factor: TOTP code (`POST /api/auth/totp/verify`). */
export async function completeMfaTotp(mfaToken: string, code: string, opts: MfaCompletionOptions = {}): Promise<AuthUser> {
    const body = await mojoCall('/api/auth/totp/verify', { method: 'POST', body: { mfa_token: mfaToken, code } });
    return adoptGrant(body.data as TokenGrant, opts.remember ?? true);
}

/** Second factor: one single-use TOTP recovery code (`POST /api/auth/totp/recover`). */
export async function completeMfaRecovery(mfaToken: string, recoveryCode: string, opts: MfaCompletionOptions = {}): Promise<AuthUser> {
    const body = await mojoCall('/api/auth/totp/recover', { method: 'POST', body: { mfa_token: mfaToken, recovery_code: recoveryCode } });
    return adoptGrant(body.data as TokenGrant, opts.remember ?? true);
}

/**
 * Send the SMS one-time code for an `sms` MFA challenge. The server CONSUMES
 * the mfa_token and RE-ISSUES a fresh one in the response — the caller must
 * replace its stored token with the returned `mfaToken` or the verify step
 * will fail with "Invalid or expired MFA token".
 */
export async function sendMfaSms(mfaToken: string): Promise<{ mfaToken: string; expiresIn: number }> {
    const body = await mojoCall('/api/auth/sms/send', { method: 'POST', body: { mfa_token: mfaToken } });
    const data = body.data as { mfa_token: string; expires_in?: number };
    return { mfaToken: data.mfa_token, expiresIn: data.expires_in ?? 300 };
}

/** Second factor: the SMS code (`POST /api/auth/sms/verify` with mfa_token). */
export async function completeMfaSms(mfaToken: string, code: string, opts: MfaCompletionOptions = {}): Promise<AuthUser> {
    const body = await mojoCall('/api/auth/sms/verify', { method: 'POST', body: { mfa_token: mfaToken, code } });
    return adoptGrant(body.data as TokenGrant, opts.remember ?? true);
}

// TODO(C3-deferred) OAuth redirect flows: django-mojo ships the full wire —
//   GET  /api/auth/oauth/<provider>/begin?redirect_uri=…  → {auth_url, state}
//   (browser navigates to auth_url; provider → backend callback → 302 back
//   to redirect_uri with ?code=&state= merged into its query)
//   POST /api/auth/oauth/<provider>/complete {code, state} → TokenGrant.
// Deferred with the workspec's blessing: redirect_uri must be allowlisted
// server-side (ALLOWED_REDIRECT_URLS), providers are deployment-specific
// (GET /api/auth/config → login.methods), and the round-trip cannot be
// exercised against the mock or without real provider credentials. The
// hosted /auth pages cover OAuth deployments today. Seam: add
// `beginOAuth(provider, redirectUri)` + `completeOAuth(provider, code,
// state)` here, and an `?code=&state=` landing branch beside
// handleAuthCodeFromURL().

/** Request a reset email: `code` → 6-digit code, `link` → `pr:` token link. */
export async function forgotPassword(email: string, method: 'code' | 'link' = 'code'): Promise<void> {
    await mojoCall('/api/auth/forgot', { method: 'POST', body: { email, method } });
}

/** Complete a code reset. Logs the user in (tokens stored). */
export async function resetPasswordWithCode(email: string, code: string, newPassword: string): Promise<AuthUser> {
    const body = await mojoCall('/api/auth/password/reset/code', { method: 'POST', body: { email, code, new_password: newPassword } });
    return adoptGrant(body.data as TokenGrant);
}

/** Complete a link reset with the `pr:` token. Logs the user in. */
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<AuthUser> {
    const body = await mojoCall('/api/auth/password/reset/token', { method: 'POST', body: { token, new_password: newPassword } });
    return adoptGrant(body.data as TokenGrant);
}

/** Send a passwordless `ml:` login link. */
export async function sendMagicLink(email: string): Promise<void> {
    await mojoCall('/api/auth/magic/send', { method: 'POST', body: { email } });
}

/** Complete login with the `ml:` token from a magic link. */
export async function loginWithMagicToken(token: string): Promise<AuthUser> {
    const body = await mojoCall('/api/auth/magic/login', { method: 'POST', body: { token } });
    return adoptGrant(body.data as TokenGrant);
}

/**
 * Read `?token=ml:…` from the URL, scrub it (before any network call), and
 * log in. Null when no magic token is present. Never throws URL-side; the
 * network call rejects like any other flow.
 */
export function handleMagicTokenFromURL(): Promise<AuthUser> | null {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token || !token.startsWith('ml:')) return null;
    params.delete('token');
    scrubUrl(params, window.location.hash || '');
    return loginWithMagicToken(token);
}

// ── Passkeys (WebAuthn) ───────────────────────────────────────────────

export function isPasskeySupported(): boolean {
    return typeof window !== 'undefined'
        && typeof window.PublicKeyCredential !== 'undefined'
        && typeof navigator.credentials?.get === 'function';
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

function bufferToBase64url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

interface PasskeyBeginResponse {
    challenge_id: string;
    publicKey: PublicKeyCredentialRequestOptions & {
        challenge: unknown;
        allowCredentials?: { id: unknown; type: string; transports?: string[] }[];
    };
}

/**
 * Passkey login: begin → authenticator prompt → complete. With no username
 * the server returns empty allowCredentials and the browser offers every
 * discoverable credential for this domain.
 */
export interface PasskeyLoginOptions {
    /** true (default) → localStorage; false → sessionStorage. */
    remember?: boolean;
}

export async function loginWithPasskey(username?: string, opts: PasskeyLoginOptions = {}): Promise<AuthUser> {
    if (!isPasskeySupported()) throw new Error('Passkeys are not supported in this browser');

    const begin = await mojoCall('/api/auth/passkeys/login/begin', { method: 'POST', body: username ? { username } : {} });
    const { challenge_id, publicKey } = begin.data as unknown as PasskeyBeginResponse;

    const request: PublicKeyCredentialRequestOptions = {
        ...publicKey,
        challenge: base64urlToBuffer(String(publicKey.challenge)),
        allowCredentials: publicKey.allowCredentials?.map((c) => ({
            type: 'public-key' as const,
            id: base64urlToBuffer(String(c.id)),
            transports: c.transports as AuthenticatorTransport[] | undefined,
        })),
    };

    const credential = (await navigator.credentials.get({ publicKey: request })) as PublicKeyCredential | null;
    if (!credential) throw new Error('No credential received from authenticator');
    const assertion = credential.response as AuthenticatorAssertionResponse;

    const body = await mojoCall('/api/auth/passkeys/login/complete', {
        method: 'POST',
        body: {
            challenge_id,
            credential: {
                id: credential.id,
                rawId: bufferToBase64url(credential.rawId),
                type: credential.type,
                response: {
                    clientDataJSON: bufferToBase64url(assertion.clientDataJSON),
                    authenticatorData: bufferToBase64url(assertion.authenticatorData),
                    signature: bufferToBase64url(assertion.signature),
                    userHandle: assertion.userHandle ? bufferToBase64url(assertion.userHandle) : null,
                },
            },
        },
    });
    return adoptGrant(body.data as TokenGrant, opts.remember ?? true);
}

// ── Passkey registration (self-service, signed in) ────────────────────
// django-mojo account/rest/passkeys.py:59-150 + utils/passkeys.py:143-201.
// Both legs are @requires_fresh_auth, so each runs under withFreshAuth. The
// pair is retry-safe: complete matches on credential_id and the challenge is
// deleted only after a successful complete, so a 440 on complete re-prompts
// and replays complete with the SAME challenge and credential.

/** Registration needs `create`, not just the `get` that login checks. */
export function isPasskeyRegistrationSupported(): boolean {
    return typeof window !== 'undefined'
        && typeof window.PublicKeyCredential !== 'undefined'
        && typeof navigator.credentials?.create === 'function';
}

/**
 * A friendly default passkey name from this browser — web-mojo
 * Passkey.suggestName() (core/models/Passkeys.js:42-59), e.g. "Mac — Chrome".
 */
export function suggestPasskeyName(userAgent?: string): string {
    const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
    let device = 'Device';
    if (/iPad/.test(ua)) device = 'iPad';
    else if (/iPhone/.test(ua)) device = 'iPhone';
    else if (/Macintosh|MacIntel/.test(ua)) device = 'Mac';
    else if (/Android/.test(ua)) device = 'Android';
    else if (/Windows/.test(ua)) device = 'Windows PC';
    else if (/Linux/.test(ua)) device = 'Linux';
    let browser = '';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
    else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    return browser ? `${device} — ${browser}` : device;
}

interface PasskeyRegisterBeginResponse {
    challenge_id: string;
    publicKey: Omit<PublicKeyCredentialCreationOptions, 'challenge' | 'user' | 'excludeCredentials'> & {
        challenge: unknown;
        user: { id: unknown; name: string; displayName: string };
        excludeCredentials?: { id: unknown; type: string; transports?: string[] }[];
    };
    expiresAt?: string;
}

/** The saved Passkey row `register/complete` answers with (default graph). */
export interface RegisteredPasskey {
    id: number;
    friendly_name: string | null;
    [field: string]: unknown;
}

/**
 * Register a passkey for the signed-in user on THIS browser/authenticator.
 * `name` defaults to suggestPasskeyName(). Rejects with the authenticator's
 * DOMException (NotAllowedError, InvalidStateError, …) or the server's
 * MojoError — pass either to passkeyErrorMessage(). Callers refresh the
 * passkey list and `me` (has_passkey) afterwards.
 */
export async function registerPasskey(name?: string): Promise<RegisteredPasskey> {
    if (!isPasskeyRegistrationSupported()) throw new Error('Passkeys are not supported in this browser');

    const begin = await withFreshAuth(() => mojoCall('/api/account/passkeys/register/begin', { method: 'POST', body: {} }));
    const { challenge_id, publicKey } = begin.data as unknown as PasskeyRegisterBeginResponse;

    const options: PublicKeyCredentialCreationOptions = {
        ...publicKey,
        challenge: base64urlToBuffer(String(publicKey.challenge)),
        user: { ...publicKey.user, id: base64urlToBuffer(String(publicKey.user.id)) },
        excludeCredentials: publicKey.excludeCredentials?.map((c) => ({
            type: 'public-key' as const,
            id: base64urlToBuffer(String(c.id)),
            transports: c.transports as AuthenticatorTransport[] | undefined,
        })),
    };

    const credential = (await navigator.credentials.create({ publicKey: options })) as PublicKeyCredential | null;
    if (!credential) throw new Error('No credential received from authenticator');
    const attestation = credential.response as AuthenticatorAttestationResponse;
    const rawId = bufferToBase64url(credential.rawId);
    // The server rejects id ≠ rawId; `transports` rides at the credential's
    // TOP level (utils/passkeys.py:200), not inside `response`.
    const payload = {
        id: credential.id,
        rawId,
        type: credential.type,
        response: {
            clientDataJSON: bufferToBase64url(attestation.clientDataJSON),
            attestationObject: bufferToBase64url(attestation.attestationObject),
        },
        transports: attestation.getTransports?.() ?? [],
    };
    const friendly_name = name?.trim() || suggestPasskeyName();
    try {
        const complete = await withFreshAuth(() => mojoCall('/api/account/passkeys/register/complete', {
            method: 'POST',
            body: { challenge_id, credential: payload, friendly_name },
        }));
        return complete.data as RegisteredPasskey;
    } catch (error) {
        // The authenticator now holds a credential the server never saved
        // (complete failed, or its step-up was dismissed): tell the
        // authenticator to forget it where the browser supports that.
        signalUnknownPasskey(publicKey.rp?.id || window.location.hostname, rawId);
        throw error;
    }
}

type SignalUnknownCredential = (options: { rpId: string; credentialId: string }) => Promise<void>;

/** Best-effort WebAuthn Signal API call; never throws, never blocks. */
function signalUnknownPasskey(rpId: string, credentialId: string): void {
    try {
        const ctor = window.PublicKeyCredential as unknown as { signalUnknownCredential?: SignalUnknownCredential } | undefined;
        const signal = ctor?.signalUnknownCredential;
        if (typeof signal !== 'function') return;
        void Promise.resolve(signal.call(ctor, { rpId, credentialId })).catch(() => {});
    } catch { /* unsupported or refused — the orphan stays, as before */ }
}

/**
 * User-facing copy for a failed passkey ceremony (login, step-up or
 * registration). Authenticator DOMExceptions map to fixed copy; anything
 * else — including server refusals — is shown as written.
 */
export function passkeyErrorMessage(error: unknown): string {
    const name = error != null && typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string'
        ? (error as { name: string }).name : '';
    switch (name) {
        case 'NotAllowedError': return 'Passkey prompt was dismissed';
        case 'InvalidStateError': return 'This authenticator already holds a passkey for your account';
        case 'SecurityError': return 'Passkeys aren’t available on this domain (HTTPS and a matching domain are required)';
        case 'AbortError': return 'Passkey request was cancelled';
        default: break;
    }
    if (error instanceof Error && error.message) return error.message;
    return 'Something went wrong. Please try again.';
}

// ── Self-service credential changes that re-issue the session ─────────

/**
 * Finish a code-flow email change (`POST /api/auth/email/change/confirm
 * {code}`, rest/user.py:1953-1994). The server commits the new address,
 * rotates auth_key (every other session dies) and answers with a NEW login,
 * adopted here into the storage this session already uses. Emits 'rotated'
 * (never 'login': no explicit sign-in happened).
 */
export async function confirmEmailChange(code: string, check?: () => void): Promise<AuthUser> {
    const body = await mojoCall('/api/auth/email/change/confirm', { method: 'POST', body: { code }, beforeSend: check });
    // Account dialogs fence both dispatch and adoption of the returned login.
    check?.();
    return adoptGrant(body.data as TokenGrant, sessionIsPersistent(), 'rotated', check);
}

/**
 * Sign out every OTHER session (`POST /api/auth/sessions/revoke`,
 * rest/user.py:2331-2355, fresh-auth gated): auth_key rotates and the
 * returned login keeps THIS session alive. Never the `revoke_sessions` user
 * action — that one kills the caller's own session too.
 */
export async function revokeOtherSessions(): Promise<AuthUser> {
    const body = await withFreshAuth(() => mojoCall('/api/auth/sessions/revoke', { method: 'POST', body: {} }));
    return adoptGrant(body.data as TokenGrant, sessionIsPersistent(), 'rotated');
}

// ── Fresh-auth (step-up) challenges ───────────────────────────────────
// django-mojo's freshness gate (account/services/fresh_auth.py): sensitive
// operations can require that the JWT's `auth_time` claim — stamped at the
// last GENUINE login — is younger than FRESH_AUTH_WINDOW. A stale call gets
// HTTP 440 / reason 'reauth_required' (mojo/errors.py, deliberately NOT 401:
// a token refresh carries auth_time forward unchanged and can never satisfy
// the gate). The only cure is a real re-login (password / MFA / passkey),
// which the UI presents as a modal OVER the current screen — page state is
// never thrown away for a redirect. Hosted deployments confirm in a pop-up
// window running their normal sign-in page (openHostedStepUp), so providers
// such as Google work without the page ever navigating (#10670).
//
// Wiring: the app registers ONE UI handler (setFreshAuthHandler → the C3
// fresh-auth modal). Call sites wrap sensitive operations in
// `withFreshAuth(fn)` — on a 440 the handler prompts, and a successful
// re-login (new tokens stored by the normal login flows) retries fn once.
// While the prompt is open, a re-login of the SAME account keeps the session
// revision (see notifyAuthChanged); any other account replaces the session.

/** HTTP status + envelope error_code of a step-up challenge. */
export const REAUTH_STATUS = 440;

/** True when an error is django-mojo's fresh-auth (step-up) challenge. */
export function isReauthRequired(error: unknown): boolean {
    return error instanceof MojoError
        && (error.status === REAUTH_STATUS || error.message === 'reauth_required');
}

/**
 * Resolve true when the user completed a fresh re-login, false when they
 * dismissed the prompt (or no prompt is wired).
 */
export type FreshAuthHandler = () => Promise<boolean>;

let freshAuthHandler: FreshAuthHandler | null = null;
let freshAuthPromise: Promise<boolean> | null = null;

/**
 * Register the UI that answers step-up challenges (one per app — the C3
 * FreshAuthHost). Pass null to unregister. The handler re-authenticates via
 * the normal login flows (or openHostedStepUp), so the fresh tokens (and their
 * new auth_time) are stored before it resolves true; keep the session's storage
 * by passing `{remember: sessionIsPersistent()}` to the login call. It resolves
 * true only for the challenged account.
 */
export function setFreshAuthHandler(handler: FreshAuthHandler | null): void {
    freshAuthHandler = handler;
}

/**
 * Prompt for a fresh re-login. Single-flight: concurrent 440s (a burst of
 * gated saves) share ONE prompt and all observe its outcome. Resolves false
 * — with a console.warn, never a throw — when no handler is registered.
 */
export function requestFreshAuth(): Promise<boolean> {
    if (!freshAuthHandler) {
        console.warn('requestFreshAuth: no fresh-auth handler registered (setFreshAuthHandler) — challenge cannot be answered');
        return Promise.resolve(false);
    }
    if (!freshAuthPromise) {
        const handler = freshAuthHandler;
        const uid = getAuthSnapshot().uid;
        stepUpUid = uid;
        freshAuthPromise = handler()
            // Only the challenged account answers the challenge.
            .then((ok) => ok && uid !== null && getAuthSnapshot().uid === uid)
            .catch((error) => {
                // A handler bug must not wedge the single-flight forever.
                console.warn('fresh-auth handler threw', error);
                return false;
            })
            .finally(() => {
                stepUpUid = null;
                freshAuthPromise = null;
            });
    }
    return freshAuthPromise;
}

/**
 * Run a sensitive operation with step-up handling: on a 440 reject, prompt
 * (requestFreshAuth) and retry ONCE after a successful re-login. Any other
 * failure — and a dismissed prompt — rejects with the ORIGINAL error, so
 * failure stays unmissable at the call site.
 */
export async function withFreshAuth<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        if (!isReauthRequired(error)) throw error;
        const ok = await requestFreshAuth();
        if (!ok) throw error;
        return fn();
    }
}

/** What the signed-in account can confirm itself with. */
export interface FreshAuthMethods {
    password: boolean;
    passkey: boolean;
    /** Active provider links the deployment still offers, in its configured order. */
    providers: string[];
}

const OAUTH_PROVIDERS = ['google', 'apple', 'github'];

/**
 * Offer only what this account has: its own credentials (`has_password` /
 * `has_passkey` on the me graph) and its active OAuth links that the
 * deployment still lists in `login.methods`. A failed lookup falls back to
 * password + passkey — never to an empty prompt.
 */
export async function freshAuthMethods(): Promise<FreshAuthMethods> {
    const uid = getAuthSnapshot().uid;
    const [me, links, config] = await Promise.allSettled([
        mojoCall('/api/user/me', { unscoped: true }),
        // Admins can list everyone's links; ask for this account's only.
        mojoCall('/api/account/oauth_connection', { unscoped: true, params: { user: uid ?? '', is_active: true, size: 50 } }),
        mojoCall('/api/auth/config', { unscoped: true }),
    ]);
    const user = me.status === 'fulfilled' ? me.value.data as Record<string, unknown> | undefined : undefined;
    const methods = config.status === 'fulfilled'
        ? (config.value.data as { login?: { methods?: unknown } } | undefined)?.login?.methods : undefined;
    const offered = Array.isArray(methods) ? methods.filter((m): m is string => typeof m === 'string') : null;
    const rows = links.status === 'fulfilled' && Array.isArray(links.value.data) ? links.value.data as Record<string, unknown>[] : [];
    const linked = new Set(rows.filter(row => row.is_active !== false && typeof row.provider === 'string').map(row => String(row.provider)));
    return {
        password: typeof user?.has_password === 'boolean' ? user.has_password : true,
        passkey: typeof user?.has_passkey === 'boolean' ? user.has_passkey : true,
        providers: (offered ?? OAUTH_PROVIDERS).filter(m => OAUTH_PROVIDERS.includes(m) && linked.has(m)),
    };
}

// ── Pop-up step-up (hosted deployments) ───────────────────────────────
// The deployment's own sign-in page runs in a pop-up with force_reauth=1 and
// returns to this app with a one-time `mojo_stepup` marker. That landing
// relays completion to its opener — the single-use code when cross-origin,
// nothing when same-origin (the hosted page already stored the new pair) —
// and closes. The opener alone adopts, in its own storage choice. Tokens
// never travel by postMessage.

const STEP_UP_PARAM = 'mojo_stepup';
const STEP_UP_MESSAGE = 'mojo:stepup';

export type HostedStepUpResult = 'confirmed' | 'other-account' | 'failed';

export interface HostedStepUp {
    /** Settles once the pop-up reports back (never on its own close). */
    result: Promise<HostedStepUpResult>;
    /** True once the person closed the pop-up without finishing. */
    closed(): boolean;
    /** Bring the pop-up forward, reopening it if it was closed. False when blocked. */
    focus(): boolean;
    /** Stop listening and close the pop-up. */
    cancel(): void;
}

/**
 * Open the hosted sign-in in a pop-up to re-confirm the current account.
 * Call from the click handler (pop-up blockers). Null when there is no hosted
 * page (mock) or the browser blocked the window.
 */
export function openHostedStepUp(opts: { remember?: boolean } = {}): HostedStepUp | null {
    const uid = getAuthSnapshot().uid;
    if (!uid || typeof window.open !== 'function' || !crypto?.randomUUID) return null;
    const nonce = crypto.randomUUID();
    const back = new URL(window.location.origin + window.location.pathname + window.location.search);
    back.searchParams.set(STEP_UP_PARAM, nonce);
    const url = hostedAuthUrl(back.href, { forceReauth: true });
    if (!url) return null;
    const remember = opts.remember ?? sessionIsPersistent();
    // Same-origin hosted sign-in writes the shared keys; keep ours to undo another account.
    const previous = { access: getAccessToken(), refresh: getRefreshToken() };
    // A browser that opens the "pop-up" in this tab still comes back to this
    // exact screen and storage choice, as a full-page hosted return would.
    // Kept when window.open answers null: some embedded browsers do that and then
    // navigate this tab anyway. It expires (30 min) and only ever restores this screen.
    const stashed = stashHostedReturn(remember);
    const open = () => window.open(url, 'mojo-stepup', 'popup,width=520,height=720');
    let popup = open();
    if (!popup) return null;
    let settle: (result: HostedStepUpResult) => void = () => {};
    const result = new Promise<HostedStepUpResult>((resolve) => { settle = resolve; });
    let done = false;
    let adopting = false;
    const finish = (outcome: HostedStepUpResult) => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMessage);
        window.removeEventListener('storage', onStorage);
        try { if (stashed) sessionStorage.removeItem(RETURN_ROUTE_KEY); } catch { /* storage denied */ }
        settle(outcome);
    };
    const adopt = (code: string | null) => {
        if (done || adopting) return;
        adopting = true;
        void adoptHostedStepUp(code, uid, remember, previous).then(finish);
    };
    const onMessage = (event: MessageEvent) => {
        const data = event.data as { type?: unknown; nonce?: unknown; code?: unknown } | null;
        if (event.origin !== window.location.origin || event.source !== popup
            || data?.type !== STEP_UP_MESSAGE || data.nonce !== nonce) return;
        adopt(typeof data.code === 'string' ? data.code : null);
    };
    // Same-origin safety net: a provider that cuts the pop-up's link back here
    // (Cross-Origin-Opener-Policy) still lands this account's new pair in the
    // shared storage. Only a genuinely newer sign-in counts — another tab's
    // refresh carries auth_time unchanged. Another account is left to the relay.
    const onStorage = (event: StorageEvent) => {
        if (event.key !== ACCESS_KEY && event.key !== REFRESH_KEY) return;
        const access = localStorage.getItem(ACCESS_KEY);
        const refresh = localStorage.getItem(REFRESH_KEY);
        if (!access || !refresh || access === previous.access || refresh === previous.refresh
            || tokenInfo(access)?.uid !== uid || authTime(access) <= authTime(previous.access)) return;
        adopt(null);
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);
    return {
        result,
        closed: () => !done && Boolean(popup?.closed),
        focus: () => {
            if (done) return false;
            if (!popup || popup.closed) popup = open();
            popup?.focus();
            return Boolean(popup);
        },
        cancel: () => {
            finish('failed');
            try { popup?.close(); } catch { /* already gone */ }
        },
    };
}

/** The token's genuine-login time (epoch seconds); 0 when absent. */
function authTime(token: string | null): number {
    const value = Number(tokenInfo(token)?.payload.auth_time);
    return Number.isFinite(value) ? value : 0;
}

async function adoptHostedStepUp(code: string | null, uid: string, remember: boolean,
    previous: { access: string | null; refresh: string | null }): Promise<HostedStepUpResult> {
    if (code) {
        // Cross-origin: check the grant's account BEFORE it touches storage.
        try {
            if (checkTokenStatus().action === 'logout') clearTokens({ silent: true });
            const body = await mojoCall('/api/auth/exchange', { method: 'POST', body: { code } });
            const grant = body.data as TokenGrant | undefined;
            if (tokenInfo(grant?.access_token)?.uid !== uid) return 'other-account';
            await adoptGrant(grant, remember);
            return 'confirmed';
        } catch {
            return 'failed';
        }
    }
    // Same-origin: the hosted page stored the new pair in localStorage.
    const access = getAccessToken();
    const refresh = getRefreshToken();
    if (!access || !refresh) return 'failed';
    if (tokenInfo(access)?.uid !== uid) {
        // Another account signed in: put this tab's session back, never resume.
        if (previous.access) storeTokens(previous.access, previous.refresh, remember, 'session');
        return 'other-account';
    }
    if (access === previous.access) return 'failed';
    if (refreshPromise) await refreshPromise;
    storeTokens(access, refresh, remember, 'session');
    startAutoRefresh();
    emitAuth('login', {});
    return 'confirmed';
}

/**
 * In the sign-in pop-up's landing: relay completion to the opener and close.
 * Call FIRST at boot, before any session setup; true means this window is
 * only a relay and must not boot the app. Without an opener (it was closed,
 * or the browser cut the link) the marker is dropped and the app boots as a
 * normal hosted return.
 */
export function relayHostedStepUp(): boolean {
    if (typeof window === 'undefined' || !window.location) return false;
    const params = new URLSearchParams(window.location.search);
    const nonce = params.get(STEP_UP_PARAM);
    if (!nonce) return false;
    params.delete(STEP_UP_PARAM);
    const opener = window.opener as Window | null;
    if (!opener || opener === window) {
        scrubUrl(params, window.location.hash || '');
        return false;
    }
    const code = params.get(AUTH_CODE_PARAM);
    try {
        // Only a same-origin opener receives it; any other drops it unread.
        opener.postMessage({ type: STEP_UP_MESSAGE, nonce, code }, window.location.origin);
    } catch {
        // Not relayed: keep the code so the normal boot can still exchange it.
        scrubUrl(params, window.location.hash || '');
        return false;
    }
    params.delete(AUTH_CODE_PARAM);
    scrubUrl(params, window.location.hash || '');
    window.close();
    return true;
}

// ── Cross-origin auth handoff ─────────────────────────────────────────

let exchangePromise: Promise<AuthUser | null> | null = null;

/**
 * Exchange a one-time handoff code (32-hex, 60s TTL, single-use — all
 * server-enforced) for tokens. Single-flight; resolves null on failure
 * (the code is burned either way — nothing to retry).
 */
export function exchangeAuthCode(code: string, opts: Pick<LoginOptions, 'remember'> = {}): Promise<AuthUser | null> {
    if (!exchangePromise) {
        exchangePromise = doExchange(code, opts.remember).finally(() => {
            exchangePromise = null;
        });
    }
    return exchangePromise;
}

async function doExchange(code: string, remember = true): Promise<AuthUser | null> {
    try {
        // Hosted sign-in is also a recovery path: stale credentials must not
        // block exchanging the fresh one-time login code.
        if (checkTokenStatus().action === 'logout') clearTokens({ silent: true });
        const body = await mojoCall('/api/auth/exchange', { method: 'POST', body: { code } });
        return await adoptGrant(body.data as TokenGrant, remember);
    } catch (error) {
        emitAuth('refresh-failed', error);
        return null;
    }
}

/**
 * Read `?auth_code=` from the URL and exchange it. The scrub happens
 * synchronously, BEFORE any await, so a slow exchange cannot leak the code.
 * Resolves null when no code is present or the exchange fails.
 *
 * Two landing shapes are handled, because the hosted auth page string-appends
 * `?auth_code=` to whatever `?redirect=` carried:
 *   · the real search string (`/?auth_code=x#/route`) — what
 *     redirectToHostedAuth() produces by sending a hash-free return URL;
 *   · inside the hash query (`/#/route?auth_code=x`) — a deployment that
 *     passed a full hash-router URL as the redirect.
 * Restores the stashed return route after exchange or an authenticated
 * same-origin return (which shares storage and needs no code).
 */
export function handleAuthCodeFromURL(): Promise<AuthUser | null> {
    if (typeof window === 'undefined' || !window.location) return Promise.resolve(null);
    if (exchangePromise) return exchangePromise;

    const params = new URLSearchParams(window.location.search);
    let code = params.get(AUTH_CODE_PARAM);
    if (code) {
        params.delete(AUTH_CODE_PARAM);
        scrubUrl(params, window.location.hash || '');
    } else {
        // Hash-embedded: '#/route?auth_code=x&…'
        const hash = window.location.hash || '';
        const qIndex = hash.indexOf('?');
        if (qIndex === -1) {
            completeHostedReturn(takeHostedReturn());
            return Promise.resolve(null);
        }
        const hashParams = new URLSearchParams(hash.slice(qIndex + 1));
        code = hashParams.get(AUTH_CODE_PARAM);
        if (!code) {
            completeHostedReturn(takeHostedReturn());
            return Promise.resolve(null);
        }
        hashParams.delete(AUTH_CODE_PARAM);
        const rest = hashParams.toString();
        scrubUrl(params, hash.slice(0, qIndex) + (rest ? `?${rest}` : ''));
    }

    const returning = takeHostedReturn();
    return exchangeAuthCode(code, { remember: returning?.persistent }).then((user) => {
        if (user) completeHostedReturn(returning);
        return user;
    });
}

function scrubUrl(params: URLSearchParams, hash: string): void {
    const remaining = params.toString();
    const clean = window.location.pathname + (remaining ? `?${remaining}` : '') + hash;
    // Keep the entry's state: react-router's {usr, key, idx} lives there and
    // useBlocker needs it on Back (#5925).
    window.history.replaceState(window.history.state, '', clean);
}

// ── Hosted auth pages (the django-mojo /auth "bouncer" pages) ─────────
// The backend serves themed login/register pages at <origin>/auth. A portal
// sends the user there with ?redirect=<return url>; after sign-in the page
// mints a single-use handoff code (60s TTL) and navigates to
// <redirect>?auth_code=<code>, which handleAuthCodeFromURL() exchanges.

const RETURN_ROUTE_KEY = 'mojo:auth-return-route';
interface HostedReturn {
    route: string;
    returnTo: string;
    createdAt: number;
    persistent?: boolean;
}
export interface HostedAuthOptions {
    /** Force a genuine sign-in while preserving the session's storage choice. */
    forceReauth?: boolean;
    /** Initiating storage choice; defaults to the current session for step-up. */
    remember?: boolean;
}

/**
 * The hosted auth page URL for this deployment, or null under the mock
 * transport (there is no page to host). `returnTo` defaults to a HASH-FREE
 * form of the current URL — the auth page appends `?auth_code=` with plain
 * string concatenation, and a hash in the redirect would swallow it.
 */
export function hostedAuthUrl(returnTo?: string, opts: HostedAuthOptions = {}): string | null {
    const origin = hostedAuthOrigin();
    if (!origin || typeof window === 'undefined') return null;
    const target = returnTo ?? window.location.origin + window.location.pathname + window.location.search;
    return `${origin}/auth?redirect=${encodeURIComponent(target)}${opts.forceReauth ? '&force_reauth=1' : ''}`;
}

const AUTH_ORIGIN: string = import.meta.env.VITE_MOJO_AUTH_ORIGIN ?? '';
let authOriginWarned = false;

/**
 * The origin serving the hosted /auth pages: VITE_MOJO_AUTH_ORIGIN when it is
 * a bare https origin (http only on localhost), else the API origin. Used for
 * the hosted page links only, never for API requests. Packaged Admin is
 * same-origin and ignores it; the mock transport has no hosted page ('').
 */
function hostedAuthOrigin(): string {
    const api = apiOrigin();
    if (!api || isPackagedAdmin() || !AUTH_ORIGIN) return api;
    try {
        const url = new URL(AUTH_ORIGIN);
        const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
        if ((url.protocol === 'https:' || url.protocol === 'http:' && local) && !url.username && !url.password
            && url.pathname === '/' && !url.search && !url.hash) return url.origin;
    } catch { /* fall through to the warning */ }
    if (!authOriginWarned) {
        authOriginWarned = true;
        console.warn(`Ignoring VITE_MOJO_AUTH_ORIGIN ${JSON.stringify(AUTH_ORIGIN)}: expected an https origin (http only on localhost) — using the API origin`);
    }
    return api;
}

/**
 * The hosted page's sign-out landing (django-mojo #9568): it forgets the auth
 * host's stored session and shows the sign-in form. force_reauth=1 keeps an
 * older django that ignores signed_out from signing the user straight back in.
 */
export function hostedSignOutUrl(returnTo?: string): string | null {
    const url = hostedAuthUrl(returnTo);
    return url && `${url}&signed_out=1&force_reauth=1`;
}

/**
 * Sign out here AND on the hosted auth host: clear this origin's session,
 * then navigate to the hosted sign-out landing. Returns false (after the
 * local logout) when there is no hosted page, e.g. under the mock.
 */
let signedOutLanding: string | null = null;

export function signOutHosted(): boolean {
    const url = hostedSignOutUrl();
    signedOutLanding = url;
    logout();
    if (!url) return false;
    window.location.href = url;
    return true;
}

/**
 * Send the user to the hosted auth page, remembering the current in-app
 * (hash) route so the post-exchange boot can put them back where they were.
 */
export function redirectToHostedAuth(opts: HostedAuthOptions = {}): boolean {
    // After signOutHosted(), sign-in goes through the same signed_out landing
    // until a new session exists: a signed-out guard re-rendering behind the
    // sign-out cannot turn it into a plain /auth that signs the user back in,
    // and a canceled sign-out navigation can still be retried.
    if (signedOutLanding && !opts.forceReauth && !getAuthSnapshot().authenticated) {
        window.location.href = signedOutLanding;
        return true;
    }
    signedOutLanding = null;
    const url = hostedAuthUrl(undefined, opts);
    if (!url) return false;
    // Step-up must retain its storage choice. Ordinary login can still
    // recover on the default route when session storage is unavailable.
    if (!stashHostedReturn(opts.forceReauth ? opts.remember ?? sessionIsPersistent() : undefined) && opts.forceReauth) return false;
    window.location.href = url;
    return true;
}

/** Remember this screen (and, for step-up, the storage choice) for a full-page hosted return. */
function stashHostedReturn(persistent?: boolean): boolean {
    try {
        const returning: HostedReturn = {
            route: window.location.hash,
            returnTo: window.location.origin + window.location.pathname + window.location.search,
            createdAt: Date.now(),
            ...(persistent !== undefined ? { persistent } : {}),
        };
        sessionStorage.setItem(RETURN_ROUTE_KEY, JSON.stringify(returning));
        return true;
    } catch {
        return false;
    }
}

function takeHostedReturn(): HostedReturn | null {
    try {
        const raw = sessionStorage.getItem(RETURN_ROUTE_KEY);
        sessionStorage.removeItem(RETURN_ROUTE_KEY);
        if (!raw) return null;
        // Accept a route left by an older toolkit before this deployment.
        if (raw.startsWith('#/')) return { route: raw, returnTo: window.location.origin + window.location.pathname + window.location.search, createdAt: Date.now() };
        const value = JSON.parse(raw) as HostedReturn;
        const target = new URL(value.returnTo);
        if (target.origin !== window.location.origin || target.pathname !== window.location.pathname
            || target.searchParams.toString() !== new URLSearchParams(window.location.search).toString()
            || typeof value.route !== 'string' || value.route !== '' && !value.route.startsWith('#/')
            || typeof value.createdAt !== 'number' || Date.now() < value.createdAt || Date.now() - value.createdAt > 30 * 60_000
            || value.persistent !== undefined && typeof value.persistent !== 'boolean') return null;
        return value;
    } catch { return null; }
}

function completeHostedReturn(returning: HostedReturn | null): void {
    if (!returning || !getAuthSnapshot().authenticated) return;
    // Same-origin hosted login already stored the new pair in localStorage;
    // code exchange adopts into the requested storage above. Return metadata
    // and route restoration are never proof of fresh authentication.
    const access = getAccessToken();
    const refresh = getRefreshToken();
    if (returning.persistent !== undefined && access && refresh) {
        storeTokens(access, refresh, returning.persistent, 'refresh');
    }
    const target = new URL(returning.returnTo);
    window.history.replaceState(window.history.state, '', target.pathname + target.search + returning.route);
}

// ── Logout + boot wiring ──────────────────────────────────────────────

/** Client-side logout (django-mojo has no logout endpoint — tokens just die). */
export function logout(): void {
    clearTokens();
    stopAutoRefresh();
    emitAuth('logout');
}

/**
 * Wire auth into the transport and start session upkeep. Call once at app
 * boot. Installs the pre-request gate + Authorization header provider
 * (PortalApp._installAuthGate parity) and starts the 60s watcher when a
 * session exists. Without this call the client runs ungated (pre-login).
 */
export function initAuth(): void {
    installAuthHooks({
        async preRequest(path: string) {
            // Recursion guard: never gate the refresh call itself.
            if (path === REFRESH_PATH) return;
            // No stored token → pre-login / public flow, pass through.
            if (!getAccessToken() && !getRefreshToken()) return;
            await ensureValidToken();
            // NOTE: web-mojo had to re-stamp Authorization here because its
            // Rest snapshotted headers before the gate ran. Our transport
            // reads the token AFTER this hook, so the fresh token is picked
            // up by construction.
        },
        authHeader() {
            const token = getAccessToken();
            return token ? `Bearer ${token}` : null;
        },
        tokensReplaced(tokens) {
            // Same storage the session already lives in (remember-me), read
            // before setTokens clears both.
            setTokens(tokens.access_token, tokens.refresh_token, sessionIsPersistent());
        },
    });
    if (getRefreshToken()) startAutoRefresh();
}
