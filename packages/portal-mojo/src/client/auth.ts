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
import { AuthRequiredError } from './errors';
import { tokenInfo } from './jwt';
import { installAuthHooks, mojoCall } from './client';

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

/** Which storage the current session lives in (refresh keeps it there). */
function sessionIsPersistent(): boolean {
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

export type LoginResult =
    | { kind: 'authenticated'; user: AuthUser }
    /** Password accepted but MFA is required — no tokens issued yet. */
    | { kind: 'mfa'; mfaToken: string; methods: string[]; expiresIn: number };

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
    scrubUrl(params);
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
 */
export function handleAuthCodeFromURL(): Promise<AuthUser | null> {
    if (typeof window === 'undefined' || !window.location) return Promise.resolve(null);
    if (exchangePromise) return exchangePromise;
    const params = new URLSearchParams(window.location.search);
    const code = params.get(AUTH_CODE_PARAM);
    if (!code) return Promise.resolve(null);
    params.delete(AUTH_CODE_PARAM);
    scrubUrl(params);
    return exchangeAuthCode(code);
}

function scrubUrl(params: URLSearchParams): void {
    const remaining = params.toString();
    const clean = window.location.pathname + (remaining ? `?${remaining}` : '') + (window.location.hash || '');
    window.history.replaceState({}, '', clean);
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
