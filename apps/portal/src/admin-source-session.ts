import {
    getAccessToken, getAuthSnapshot, isPackagedAdmin,
    logout, mojoCall, onAuth, subscribeAuth,
} from 'portal-mojo/client/runtime';

// Shared verbatim with Django's gate and legacy Admin. No credentials here.
export const SOURCE_PROTOCOL = Object.freeze({
    version: 1,
    lock: 'mojo:admin-source-session:v1',
    storage: 'mojo:admin-source-generation:v1',
    channel: 'mojo:admin-source-session:v1',
});
type Generation = { version: 1; generation: string; state: 'active' | 'revoked' };
export type SourceStatus = 'checking' | 'ready' | 'denied' | 'expired' | 'unavailable' | 'unsupported' | 'revoking';
export type SourceSnapshot = { status: SourceStatus; message: string };
const listeners = new Set<() => void>();
let snapshot: SourceSnapshot = { status: isPackagedAdmin() ? 'checking' : 'ready', message: '' };
let installed = false;
let disposed = false;
let channel: BroadcastChannel | undefined;
let acceptedGeneration: Generation;
let initialGeneration: Generation;
let grant: { expiresAt: number; renewAt: number; token: string; path: string } | undefined;
let flight: Promise<void> | undefined;
let revocation: Promise<void> | undefined;
let loginActivation: Promise<void> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let retryCount = 0;
const cleanup: Array<() => void> = [];

function publish(status: SourceStatus, message = ''): void {
    if (snapshot.status === status && snapshot.message === message) return;
    snapshot = { status, message };
    listeners.forEach((listener) => listener());
}
export const getAdminSourceSnapshot = (): SourceSnapshot => snapshot;
export function subscribeAdminSourceSession(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
function readGeneration(): Generation {
    const raw = localStorage.getItem(SOURCE_PROTOCOL.storage);
    if (raw === null) return { version: 1, generation: 'initial', state: 'active' };
    return parseGeneration(raw);
}
function parseGeneration(raw: string): Generation {
    const value = JSON.parse(raw) as Generation;
    if (value?.version !== 1 || !/^(initial|[a-f0-9-]{36})$/.test(value.generation)
        || !['active', 'revoked'].includes(value.state)
        || Object.keys(value).sort().join(',') !== 'generation,state,version') throw new Error('Invalid source coordination state');
    return value;
}
function matches(a: Generation, b: Generation): boolean {
    return a.generation === b.generation && a.state === b.state;
}
async function withSourceLock(action: () => Promise<void>): Promise<void> {
    await navigator.locks.request(SOURCE_PROTOCOL.lock, action);
}
function writeGeneration(state: Generation['state']): Generation {
    const value: Generation = { version: 1, generation: crypto.randomUUID(), state };
    localStorage.setItem(SOURCE_PROTOCOL.storage, JSON.stringify(value));
    channel?.postMessage({ type: 'generation', ...value });
    return value;
}
function stopTimers(): void {
    clearTimeout(timer); clearTimeout(expiryTimer);
    timer = undefined; expiryTimer = undefined;
}
function invalidate(message: string): void {
    grant = undefined; stopTimers();
    publish('expired', message);
}
function assertGeneration(): void {
    let current: Generation;
    try { current = readGeneration(); } catch (error) {
        grant = undefined; stopTimers(); publish('unsupported', 'Admin coordination storage is unavailable or invalid.');
        throw error;
    }
    if (!matches(current, acceptedGeneration) || acceptedGeneration.state !== 'active') {
        invalidate('This Admin session was signed out. Sign in again.');
        throw new Error('Admin source generation expired');
    }
}

/** data.path is the Admin root, including both slashes: /admin/ or /custom/. */
export function validateSourceGrant(data: unknown, now = Date.now()) {
    const value = data as Record<string, unknown> | null;
    const path = value?.path;
    const seconds = value?.source_session_expires_in;
    const epoch = value?.source_session_expires_at;
    if (typeof path !== 'string' || !/^\/(?:[A-Za-z0-9_-]+\/)+$/.test(path)
        || window.location.pathname !== `${path}v2/` && window.location.pathname !== `${path}v2/index.html`
        || !Number.isSafeInteger(seconds) || Number(seconds) <= 0
        || !Number.isSafeInteger(epoch) || Number(epoch) <= 0) throw new Error('Invalid Admin source-session response');
    const expiresAt = Math.min(now + Number(seconds) * 1000, Number(epoch) * 1000);
    const lifetime = expiresAt - now;
    if (lifetime < 1000) throw new Error('Admin source-session grant already expired');
    return { path, expiresAt, renewAt: now + Math.floor(lifetime * 0.7) };
}
function failure(error: unknown): void {
    const status = (error as { status?: number })?.status;
    grant = undefined; stopTimers();
    publish(status === 403 ? 'denied' : status === 401 ? 'expired' : 'unavailable',
        status === 403 ? 'Your account cannot open Admin.' : status === 401
            ? 'Your session expired. Sign in again.' : 'Admin access could not be renewed. Check your connection and retry.');
    // Two bounded retries for transport failures only. Denied/malformed grants wait for the user.
    if ((error instanceof TypeError || (status != null && status >= 500)) && retryCount < 2) {
        timer = setTimeout(() => { void ensureAdminSourceSession().catch(() => {}); }, 1000 * 2 ** retryCount++);
    }
}
function recheck(): void {
    if (disposed || snapshot.status === 'revoking') return;
    try {
        assertGeneration();
        if (document.visibilityState !== 'hidden') void ensureAdminSourceSession().catch(() => {});
    } catch { /* assertGeneration already rendered eager recovery */ }
}

/** Install synchronously BEFORE initAuth/exchange; no source request until boot explicitly ensures. */
export function initializeAdminSourceSession(): void {
    if (!isPackagedAdmin() || installed) return;
    installed = true;
    try {
        if (!navigator.locks?.request || typeof BroadcastChannel !== 'function' || !crypto.randomUUID) {
            throw new Error('Required browser coordination unavailable');
        }
        initialGeneration = readGeneration();
        const binding = sessionStorage.getItem(SOURCE_PROTOCOL.storage);
        acceptedGeneration = binding ? parseGeneration(binding) : initialGeneration;
        sessionStorage.setItem(SOURCE_PROTOCOL.storage, JSON.stringify(acceptedGeneration));
        // A read-only storage API is insufficient for the logout guarantee.
        const probe = `${SOURCE_PROTOCOL.storage}:probe:${crypto.randomUUID()}`;
        localStorage.setItem(probe, '1');
        localStorage.removeItem(probe);
        channel = new BroadcastChannel(SOURCE_PROTOCOL.channel);
        channel.onmessage = () => recheck(); // payload is advisory; persisted state is authoritative
        for (const event of ['focus', 'pageshow', 'storage']) {
            window.addEventListener(event, recheck);
            cleanup.push(() => window.removeEventListener(event, recheck));
        }
        document.addEventListener('visibilitychange', recheck);
        cleanup.push(() => document.removeEventListener('visibilitychange', recheck));
        cleanup.push(subscribeAuth(() => {
            if (grant && grant.token !== getAccessToken()) { grant = undefined; stopTimers(); }
            // Queue after auth's refresh promise settles; never recurse from setTokens.
            if (!flight && !revocation) queueMicrotask(recheck);
        }));
        cleanup.push(onAuth('login', () => {
            // Only an explicit completed login can reopen a tombstone observed at boot.
            // A later logout invalidates that captured generation, even for a late login response.
            loginActivation = withSourceLock(async () => {
                if (!matches(readGeneration(), initialGeneration) || !getAuthSnapshot().authenticated || revocation) return;
                if (initialGeneration.state === 'revoked') acceptedGeneration = writeGeneration('active');
                else acceptedGeneration = initialGeneration;
                sessionStorage.setItem(SOURCE_PROTOCOL.storage, JSON.stringify(acceptedGeneration));
                initialGeneration = acceptedGeneration;
            }).finally(() => { loginActivation = undefined; });
            void loginActivation.then(recheck).catch(failure);
        }));
        cleanup.push(onAuth('logout', () => { if (!revocation) void revokeAdminSourceSession().catch(() => {}); }));
    } catch {
        publish('unsupported', 'This browser cannot safely coordinate Admin access. Enable site storage and use a browser with Web Locks and BroadcastChannel.');
    }
}

export function ensureAdminSourceSession(): Promise<void> {
    if (!isPackagedAdmin()) return Promise.resolve();
    if (!installed) initializeAdminSourceSession();
    if (disposed || snapshot.status === 'unsupported' || revocation) return Promise.reject(new Error('Admin source access unavailable'));
    if (loginActivation) return loginActivation.then(() => ensureAdminSourceSession());
    try { assertGeneration(); } catch (error) { return Promise.reject(error); }
    if (grant && grant.token === getAccessToken() && Date.now() < grant.renewAt) return Promise.resolve();
    if (flight) return flight;
    // Background renewal keeps the mounted UI while the current grant remains
    // valid. The separate deadline timer still closes the gate if renewal stalls.
    if (!grant || Date.now() >= grant.expiresAt) publish('checking');
    flight = withSourceLock(async () => {
        assertGeneration();
        if (!getAuthSnapshot().authenticated) {
            publish('expired', 'Sign in to open Admin.');
            throw new Error('Sign in required');
        }
        let token: string | null = null;
        const response = await mojoCall('/api/account/admin/session', {
            method: 'POST',
            beforeSend: () => {
                // The client has now completed its single-flight refresh. Check
                // the tombstone again before any cookie-writing request leaves.
                assertGeneration();
                token = getAccessToken();
                if (!token) throw new Error('Sign in required');
            },
        });
        // Hold the lock until Set-Cookie has completed AND the body has been processed.
        assertGeneration();
        if (!token || token !== getAccessToken() || disposed) throw new Error('Session changed during source issuance');
        grant = { ...validateSourceGrant(response.data), token };
        retryCount = 0; stopTimers();
        timer = setTimeout(() => { void ensureAdminSourceSession().catch(() => {}); }, grant.renewAt - Date.now());
        expiryTimer = setTimeout(() => invalidate('Admin access expired. Retry to renew it.'), grant.expiresAt - Date.now());
        publish('ready');
    }).catch((error: unknown) => {
        if (!revocation && snapshot.status !== 'expired' && snapshot.status !== 'unsupported') failure(error);
        throw error;
    }).finally(() => { flight = undefined; });
    return flight;
}

export function withAdminSourceSession<T>(load: () => Promise<T>): () => Promise<T> {
    return async () => { await ensureAdminSourceSession(); return load(); };
}

/** Completes only AFTER the final DELETE response, never merely after clearing JS state. */
export function revokeAdminSourceSession(): Promise<void> {
    if (!isPackagedAdmin()) { logout(); return Promise.resolve(); }
    if (revocation) return revocation;
    if (!installed) initializeAdminSourceSession();
    if (snapshot.status === 'unsupported') return Promise.reject(new Error('Source revocation requires browser coordination'));
    const path = grant?.path ?? window.location.pathname.replace(/v2\/(?:index\.html)?$/, '');
    if (!/^\/(?:[A-Za-z0-9_-]+\/)+$/.test(path)) return Promise.reject(new Error('Invalid Admin mount'));
    let tombstone: Generation;
    try { tombstone = acceptedGeneration = writeGeneration('revoked'); } catch (error) {
        publish('unsupported', 'Site storage is unavailable. Admin sign-out could not complete.');
        return Promise.reject(error);
    }
    grant = undefined; stopTimers(); publish('revoking', 'Signing out…');
    // Assign the promise before logout emits its synchronous event.
    revocation = Promise.resolve().then(() => withSourceLock(async () => {
        // Reassert only our own tombstone. A newer explicit login is a new
        // session; its source POST queues behind this DELETE on the same lock.
        if (matches(readGeneration(), tombstone)) {
            localStorage.setItem(SOURCE_PROTOCOL.storage, JSON.stringify(tombstone));
            channel?.postMessage({ type: 'generation', ...tombstone });
        }
        const response = await fetch(`${path}_session`, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' });
        await response.text();
        if (!response.ok) throw new Error('Admin sign-out could not revoke source access');
        publish('expired', 'Signed out. Sign in to open Admin.');
    })).catch((error: unknown) => {
        publish('unavailable', 'Sign-out is incomplete. Retry to revoke Admin access.');
        throw error;
    }).finally(() => { revocation = undefined; });
    logout();
    return revocation;
}

export function disposeAdminSourceSession(): void {
    disposed = true; grant = undefined; stopTimers();
    cleanup.splice(0).forEach((remove) => remove()); channel?.close();
}
