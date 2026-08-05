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
//     ensureValidToken() — throws AuthRequiredError, which the transport
//     turns into a synthetic 401 REJECT without calling fetch
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
import { apiOrigin, installAuthHooks, mojoCall } from './client';

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
    // Clear both storages first — a leftover token in the other storage must
    // never shadow this session (web-mojo wrote without clearing).
    clearTokens({ silent: true });
    const storage = persistent ? localStorage : sessionStorage;
    storage.setItem(ACCESS_KEY, access);
    if (refresh) storage.setItem(REFRESH_KEY, refresh);
    notifyAuthChanged();
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
const authListeners = new Set<() => void>();

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

function notifyAuthChanged(): void {
    computeSnapshot();
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

export type AuthEvent = 'login' | 'logout' | 'refreshed' | 'refresh-failed' | 'unauthorized';
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

let refreshPromise: Promise<boolean> | null = null;

/**
 * Refresh the access token. Single-flight: concurrent callers share one
 * in-flight POST. Always resolves to a boolean; never throws.
 */
export function refreshTokens(): Promise<boolean> {
    if (!refreshPromise) {
        refreshPromise = doRefresh().finally(() => {
            refreshPromise = null;
        });
    }
    return refreshPromise;
}

async function doRefresh(): Promise<boolean> {
    const refresh = getRefreshToken();
    const info = tokenInfo(refresh);
    if (!refresh || !info?.isValid || info.isExpired) {
        emitAuth('unauthorized');
        stopAutoRefresh();
        return false;
    }
    const persistent = sessionIsPersistent();
    try {
        const body = await mojoCall(REFRESH_PATH, { method: 'POST', body: { refresh_token: refresh } });
        const pkg = body.data as { access_token: string; refresh_token?: string };
        setTokens(pkg.access_token, pkg.refresh_token, persistent);
        emitAuth('refreshed');
        return true;
    } catch (error) {
        const status = error instanceof Error && 'status' in error ? (error as { status: number }).status : 0;
        if (status === 401 || status === 403) {
            emitAuth('unauthorized');
            stopAutoRefresh();
        } else {
            // Transient (network/5xx): keep the session, report, let the
            // watcher or the next gated request retry.
            emitAuth('refresh-failed', error);
        }
        return false;
    }
}

/**
 * Pre-request gate (TokenManager.ensureValidToken). Throws AuthRequiredError
 * when the request must not be sent; the transport short-circuits it to a
 * synthetic-401 reject without touching the network.
 */
export async function ensureValidToken(): Promise<void> {
    const status = checkTokenStatus();
    if (status.action === 'logout') {
        emitAuth('unauthorized');
        stopAutoRefresh();
        throw new AuthRequiredError('Both access and refresh tokens are invalid');
    }
    if (status.action === 'refresh') {
        const ok = await refreshTokens();
        if (!ok) throw new AuthRequiredError('Token refresh failed');
    }
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

function adoptGrant(data: TokenGrant, remember = true): AuthUser {
    setTokens(data.access_token, data.refresh_token, remember);
    startAutoRefresh();
    const user = data.user ?? {};
    emitAuth('login', user);
    return user;
}

/** Password login. `username` may be a username, email, or (if enabled) phone. */
export async function login(username: string, password: string, opts: LoginOptions = {}): Promise<LoginResult> {
    const body = await mojoCall('/api/login', { method: 'POST', body: { username, password, ...opts.extra } });
    const data = body.data as TokenGrant;
    if (data.mfa_required) {
        return { kind: 'mfa', mfaToken: data.mfa_token ?? '', methods: data.mfa_methods ?? [], expiresIn: data.expires_in ?? 300 };
    }
    return { kind: 'authenticated', user: adoptGrant(data, opts.remember ?? true) };
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
export async function loginWithPasskey(username?: string): Promise<AuthUser> {
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
    return adoptGrant(body.data as TokenGrant);
}

// ── Fresh-auth (step-up) challenges ───────────────────────────────────
// django-mojo's freshness gate (account/services/fresh_auth.py): sensitive
// operations can require that the JWT's `auth_time` claim — stamped at the
// last GENUINE login — is younger than FRESH_AUTH_WINDOW. A stale call gets
// HTTP 440 / reason 'reauth_required' (mojo/errors.py, deliberately NOT 401:
// a token refresh carries auth_time forward unchanged and can never satisfy
// the gate). The only cure is a real re-login (password / MFA / passkey),
// which the UI presents as a modal OVER the current screen — page state is
// never thrown away for a redirect.
//
// Wiring: the app registers ONE UI handler (setFreshAuthHandler → the C3
// fresh-auth modal). Call sites wrap sensitive operations in
// `withFreshAuth(fn)` — on a 440 the handler prompts, and a successful
// re-login (new tokens stored by the normal login flows) retries fn once.

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
 * the normal login flows, so the fresh tokens (and their new auth_time) are
 * stored before it resolves true; keep the session's storage by passing
 * `{remember: sessionIsPersistent()}` to the login call.
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
        freshAuthPromise = handler()
            .catch((error) => {
                // A handler bug must not wedge the single-flight forever.
                console.warn('fresh-auth handler threw', error);
                return false;
            })
            .finally(() => {
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

// ── Cross-origin auth handoff ─────────────────────────────────────────

let exchangePromise: Promise<AuthUser | null> | null = null;

/**
 * Exchange a one-time handoff code (32-hex, 60s TTL, single-use — all
 * server-enforced) for tokens. Single-flight; resolves null on failure
 * (the code is burned either way — nothing to retry).
 */
export function exchangeAuthCode(code: string): Promise<AuthUser | null> {
    if (!exchangePromise) {
        exchangePromise = doExchange(code).finally(() => {
            exchangePromise = null;
        });
    }
    return exchangePromise;
}

async function doExchange(code: string): Promise<AuthUser | null> {
    try {
        const body = await mojoCall('/api/auth/exchange', { method: 'POST', body: { code } });
        return adoptGrant(body.data as TokenGrant);
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
 * After a successful exchange the stashed return route (if any) is restored.
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
        if (qIndex === -1) return Promise.resolve(null);
        const hashParams = new URLSearchParams(hash.slice(qIndex + 1));
        code = hashParams.get(AUTH_CODE_PARAM);
        if (!code) return Promise.resolve(null);
        hashParams.delete(AUTH_CODE_PARAM);
        const rest = hashParams.toString();
        scrubUrl(params, hash.slice(0, qIndex) + (rest ? `?${rest}` : ''));
    }

    return exchangeAuthCode(code).then((user) => {
        if (user) restoreReturnRoute();
        return user;
    });
}

function scrubUrl(params: URLSearchParams, hash: string): void {
    const remaining = params.toString();
    const clean = window.location.pathname + (remaining ? `?${remaining}` : '') + hash;
    window.history.replaceState({}, '', clean);
}

// ── Hosted auth pages (the django-mojo /auth "bouncer" pages) ─────────
// The backend serves themed login/register pages at <origin>/auth. A portal
// sends the user there with ?redirect=<return url>; after sign-in the page
// mints a single-use handoff code (60s TTL) and navigates to
// <redirect>?auth_code=<code>, which handleAuthCodeFromURL() exchanges.

const RETURN_ROUTE_KEY = 'mojo:auth-return-route';

/**
 * The hosted auth page URL for this deployment, or null under the mock
 * transport (there is no page to host). `returnTo` defaults to a HASH-FREE
 * form of the current URL — the auth page appends `?auth_code=` with plain
 * string concatenation, and a hash in the redirect would swallow it.
 */
export function hostedAuthUrl(returnTo?: string): string | null {
    const origin = apiOrigin();
    if (!origin || typeof window === 'undefined') return null;
    const target = returnTo ?? window.location.origin + window.location.pathname + window.location.search;
    return `${origin}/auth?redirect=${encodeURIComponent(target)}`;
}

/**
 * Send the user to the hosted auth page, remembering the current in-app
 * (hash) route so the post-exchange boot can put them back where they were.
 */
export function redirectToHostedAuth(): boolean {
    const url = hostedAuthUrl();
    if (!url) return false;
    try {
        const route = window.location.hash;
        if (route && route !== '#/') sessionStorage.setItem(RETURN_ROUTE_KEY, route);
    } catch { /* storage denied — land on the default route */ }
    window.location.href = url;
    return true;
}

function restoreReturnRoute(): void {
    try {
        const route = sessionStorage.getItem(RETURN_ROUTE_KEY);
        if (route) {
            sessionStorage.removeItem(RETURN_ROUTE_KEY);
            window.location.hash = route;
        }
    } catch { /* storage denied */ }
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
            if (!getAccessToken()) return;
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
    });
    if (getRefreshToken()) startAutoRefresh();
}
