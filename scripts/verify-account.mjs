// verify:account — the self-service account wire (AccountModal, #7184):
// passkey registration bodies (base64url decode, transports at the TOP level,
// id === rawId), one 440 retry per fresh-auth path, owner-scoped passkey
// reads, the /api/user/me owner rules, session rotation adopting the new
// login in the SAME storage, the TOTP / recovery-code shapes, phone change's
// top-level session_token, and the notification master switch ("*") + kinds.
// Mounted half: no one-time value (TOTP secret, recovery codes, API token,
// phone session_token, rotated logins) in any Query/Mutation cache or in
// storage outside the session's token pair; ?user= on every owner list;
// dialogs never outlive the session; locked modals survive a native close.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

// JSDOM hosts both halves: the wire calls (auth client + mock) and the
// mounted module checks (dialogs, cache boundary). It does not claim native
// <dialog>/focus/layout coverage — the browser pass owns that.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'HTMLDialogElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'Node', 'MutationObserver', 'localStorage', 'sessionStorage']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function close() { this.open = false; };
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

const created = [];
let nextCredential = null;
let lastCredentialId = null;
const unknownSignals = [];
class FakePublicKeyCredential {
    static signalUnknownCredential(options) {
        unknownSignals.push(options);
        if (FakePublicKeyCredential.throwOnSignal) throw new Error('signal refused');
        return Promise.resolve();
    }
}
dom.window.PublicKeyCredential = FakePublicKeyCredential;
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
Object.defineProperty(dom.window.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36' });
Object.defineProperty(dom.window.navigator, 'credentials', {
    configurable: true,
    value: {
        async get() { throw new Error('not used'); },
        async create(options) {
            created.push(options);
            if (nextCredential) { const value = nextCredential; nextCredential = null; return value(); }
            const raw = new TextEncoder().encode(`cred-${created.length}-${Date.now()}`);
            lastCredentialId = b64url(raw);
            return {
                id: b64url(raw),
                rawId: raw.buffer,
                type: 'public-key',
                response: {
                    clientDataJSON: new TextEncoder().encode('{"type":"webauthn.create"}').buffer,
                    attestationObject: new Uint8Array([1, 2, 3]).buffer,
                    getTransports: () => ['internal', 'hybrid'],
                },
            };
        },
    },
});
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
let client;
// Hoisted so the catch below can restore it: a failure in the mounted half
// (console.error captured) would otherwise exit 1 with no message.
const originalError = console.error;
try {
    client = await server.ssrLoadModule('/packages/portal-mojo/src/client/index.ts');
    const api = await server.ssrLoadModule('/packages/portal-mojo/src/account/api.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    client.initAuth();

    // Rotations are not logins: record which identity events each path emits.
    const authEvents = [];
    for (const name of ['login', 'rotated']) client.onAuth(name, () => authEvents.push(name));
    const eventsOf = async (run) => { authEvents.length = 0; await run(); return [...authEvents]; };

    const EMAIL = 'ian@mojoverify.com';
    const bearer = () => ({ Authorization: `Bearer ${client.getAccessToken()}` });
    await client.login(EMAIL, 'mojo', { remember: false });
    const me = (await client.mojoCall('/api/user/me')).data;
    assert.equal(me.email, EMAIL);
    assert.equal(me.has_password, true, 'the me graph carries has_password');
    assert.equal(client.sessionIsPersistent(), false, 'remember:false keeps the session in sessionStorage');

    // ── One 440 → one prompt → one retry, on EVERY fresh-auth path ──
    let prompts = 0;
    // The handler is a real re-login (password, then the TOTP step once the
    // account requires MFA) — exactly what FreshAuthHost does.
    const signIn = async (email) => {
        const remember = client.sessionIsPersistent();
        const result = await client.login(email, 'mojo', { remember });
        if (result.kind === 'mfa') await client.completeMfaTotp(result.mfaToken, '123456', { remember });
    };
    const reLogin = (email) => async () => {
        prompts += 1;
        await signIn(email);
        return true;
    };
    client.setFreshAuthHandler(reLogin(EMAIL));
    const gated = async (method, path, run) => {
        const before = prompts;
        mock.armMockReauth(method, path);
        const counts = mock.getMockCallCounts()[`${method} ${path}`] ?? 0;
        const result = await run();
        assert.equal(prompts - before, 1, `${method} ${path}: a 440 prompts exactly once`);
        assert.equal((mock.getMockCallCounts()[`${method} ${path}`] ?? 0) - counts, 2, `${method} ${path}: retried exactly once`);
        return result;
    };

    // ── Passkey registration ──
    assert.equal(client.isPasskeyRegistrationSupported(), true);
    assert.equal(client.suggestPasskeyName(navigator.userAgent), 'Mac — Chrome');
    const registered = await gated('POST', '/api/account/passkeys/register/begin', () => client.registerPasskey('  Work laptop  '));
    const options = created.at(-1).publicKey;
    assert(options.challenge instanceof ArrayBuffer, 'publicKey.challenge is decoded to bytes');
    assert(options.user.id instanceof ArrayBuffer, 'publicKey.user.id is decoded to bytes');
    assert(options.excludeCredentials?.length > 0 && options.excludeCredentials.every((c) => c.id instanceof ArrayBuffer), 'excludeCredentials ids are decoded to bytes');
    assert.equal(registered.friendly_name, 'Work laptop', 'friendly_name is trimmed and sent');
    assert.equal(registered.transports, 'internal,hybrid', 'transports ride at the credential top level');
    // Decode by BYTES: pin known base64url values (no padding, '-' and '_'
    // in play) on begin and compare what reached navigator.credentials.create.
    const knownChallenge = Uint8Array.from({ length: 32 }, (_, i) => (251 + i * 37) & 0xff);
    const knownUserId = Uint8Array.from([0xff, 0xfe, 0xfb, 0x00, 0x3e, 0x3f, 0x01]);
    const knownExclude = Uint8Array.from([0xfb, 0xef, 0xbe, 0xff, 0xfa]);
    assert(/[-_]/.test(b64url(knownChallenge) + b64url(knownUserId) + b64url(knownExclude)), 'the known values exercise the url alphabet');
    mock.armMockResponseOnce('POST', '/api/account/passkeys/register/begin', {
        mapData: (data) => ({
            ...data,
            publicKey: {
                ...data.publicKey,
                challenge: b64url(knownChallenge),
                user: { ...data.publicKey.user, id: b64url(knownUserId) },
                excludeCredentials: [{ type: 'public-key', id: b64url(knownExclude), transports: ['internal'] }],
            },
        }),
    });
    await client.registerPasskey('Byte check');
    const pinned = created.at(-1).publicKey;
    assert.deepEqual([...new Uint8Array(pinned.challenge)], [...knownChallenge], 'publicKey.challenge decodes to the exact bytes');
    assert.deepEqual([...new Uint8Array(pinned.user.id)], [...knownUserId], 'publicKey.user.id decodes to the exact bytes');
    assert.deepEqual([...new Uint8Array(pinned.excludeCredentials[0].id)], [...knownExclude], 'excludeCredentials[].id decodes to the exact bytes');

    const second = await gated('POST', '/api/account/passkeys/register/complete', () => client.registerPasskey());
    assert.equal(second.friendly_name, 'Mac — Chrome', 'the default name is the suggested one');

    // create() succeeded but complete never saved it → signalUnknownCredential, then rethrow.
    assert.equal(unknownSignals.length, 0, 'a saved passkey is never signalled unknown');
    client.setFreshAuthHandler(async () => false);
    for (const throwOnSignal of [false, true]) {
        FakePublicKeyCredential.throwOnSignal = throwOnSignal;
        mock.armMockReauth('POST', '/api/account/passkeys/register/complete');
        await assert.rejects(client.registerPasskey('Orphan'), (error) => client.isReauthRequired(error), 'a dismissed complete step-up rethrows the original 440');
        const orphan = created.at(-1);
        assert.equal(unknownSignals.length, throwOnSignal ? 2 : 1, 'the orphaned credential is signalled unknown');
        assert.deepEqual(unknownSignals.at(-1), { rpId: orphan.publicKey.rp?.id || 'localhost', credentialId: lastCredentialId }, 'signalled with the rpId + base64url credential id');
    }
    FakePublicKeyCredential.throwOnSignal = false;
    client.setFreshAuthHandler(reLogin(EMAIL));

    const begin = await mock.mockFetch('/api/account/passkeys/register/begin', { method: 'POST', headers: bearer(), body: {} });
    const mismatched = await mock.mockFetch('/api/account/passkeys/register/complete', {
        method: 'POST', headers: bearer(),
        body: { challenge_id: begin.data.challenge_id, credential: { id: 'abc', rawId: 'abd', type: 'public-key', response: { clientDataJSON: 'x', attestationObject: 'y' } } },
    });
    assert.equal(mismatched.error_code, 403, 'complete refuses id ≠ rawId');

    nextCredential = () => { const e = new Error('The operation either timed out or was not allowed.'); e.name = 'NotAllowedError'; throw e; };
    await assert.rejects(client.registerPasskey(), (error) => client.passkeyErrorMessage(error) === 'Passkey prompt was dismissed');
    for (const [name, copy] of [['InvalidStateError', 'This authenticator already holds a passkey for your account'], ['AbortError', 'Passkey request was cancelled']]) {
        const e = new Error('x'); e.name = name;
        assert.equal(client.passkeyErrorMessage(e), copy);
    }
    assert.match(client.passkeyErrorMessage(Object.assign(new Error('x'), { name: 'SecurityError' })), /HTTPS and a matching domain/);
    assert.equal(client.passkeyErrorMessage(new client.MojoError('Credential already registered to another user', 403)), 'Credential already registered to another user', 'server text is shown as written');

    // ── Passkey reads are owner-scoped without a users grant ──
    const own = await mock.mockFetch('/api/account/passkeys', { headers: bearer(), params: { size: 100 } });
    assert(own.data.length >= 3 && own.data.every((row) => row.user?.id === me.id), 'a plain owner sees only their passkeys');
    const manager = await mock.mockFetch('/api/login', { method: 'POST', body: { username: 'showcase.operator@nativemojo.com', password: 'mojo' } });
    const managerHeaders = { Authorization: `Bearer ${manager.data.access_token}` };
    const scoped = await mock.mockFetch('/api/account/passkeys', { headers: managerHeaders, params: { user: me.id, size: 100 } });
    assert(scoped.data.every((row) => row.user?.id === me.id), '?user= scopes a users-grant caller to one owner');
    const unscoped = await mock.mockFetch('/api/account/passkeys', { headers: managerHeaders, params: { size: 100 } });
    assert(unscoped.data.some((row) => row.user?.id !== me.id), 'without ?user= a users-grant caller sees every row (why the filter is REQUIRED)');
    const foreign = unscoped.data.find((row) => row.user?.id !== me.id);
    assert.equal((await mock.mockFetch(`/api/account/passkeys/${foreign.id}`, { headers: bearer() })).error_code, 403);

    // ── /api/user/me owner rules ──
    const save = (body) => mock.mockFetch('/api/user/me', { method: 'POST', headers: bearer(), body });
    assert.equal((await save({ display_name: 'Ian S.' })).data.display_name, 'Ian S.');
    assert.equal((await save({ email: 'other@example.com' })).error, 'You are not allowed to change email or username');
    assert.equal((await save({ username: 'renamed' })).error_code, 403);
    assert.equal((await save({ is_superuser: false })).error_code, 403, 'is_superuser 403s even unchanged');
    assert.equal((await save({ permissions: { users: true } })).error_code, 403);
    assert.equal((await save({ requires_mfa: true })).error, 'You are not allowed to change requires_mfa');
    assert.equal((await save({ metadata: { protected: { x: 1 } } })).error_code, 403);
    assert.equal((await save({ dob: '1990-01-01' })).error, 'Date of birth cannot be changed after registration');
    assert.equal((await save({ phone_number: '+15555550100' })).status, true, 'first phone set is allowed');
    assert.equal((await save({ phone_number: '+15555550111' })).error, 'Use the phone change flow to update an existing phone number');
    assert.equal((await save({ new_password: 'Longer-pass-123' })).error, 'You must provide your current password');
    assert.equal((await save({ new_password: 'Longer-pass-123', current_password: 'nope' })).error, 'Incorrect current password');
    const pw = await save({ new_password: 'Longer-pass-123', current_password: 'mojo' });
    assert.equal(pw.status, true);
    assert.equal('current_password' in pw.data || 'new_password' in pw.data, false, 'password fields never land on the row');
    assert.equal((await save({ metadata: { timezone: 'America/Denver' } })).data.metadata.timezone, 'America/Denver');
    await api.changePassword('mojo', 'Another-pass-456');
    await assert.rejects(api.changePassword('wrong', 'Another-pass-456'), /Incorrect current password/);

    // ── TOTP + recovery codes ──
    assert.deepEqual(await api.getRecoveryCodeStatus(), { enrolled: false, remaining: 0 }, '400 reads as not enrolled');
    const setup = await gated('POST', '/api/account/totp/setup', () => api.startTotpSetup());
    assert.match(setup.qrCode, /^data:image\/(png|svg\+xml);base64,/);
    assert(setup.secret && setup.uri.startsWith('otpauth://'));
    for (const unsafe of ['javascript:alert(1)', 'https://example.com/qr.png', 'data:text/html;base64,PGI+', 'data:image/png;base64,abc"onerror=x']) {
        assert.equal(api.safeQrDataUrl(unsafe), null, `unsafe QR value refused: ${unsafe}`);
    }
    await assert.rejects(api.confirmTotp('000000'), /Invalid code/);
    const codes = await gated('POST', '/api/account/totp/confirm', () => api.confirmTotp('123456'));
    assert.equal(codes.length, 8);
    const status = await api.getRecoveryCodeStatus();
    assert.deepEqual(status, { enrolled: true, remaining: 8 }, 'status carries only enrolled + remaining');
    const masked = await api.getMaskedRecoveryCodes();
    assert(masked.codes.every((c) => /^[0-9a-f]{4}-xxxx-xxxx$/.test(c)));
    await assert.rejects(api.regenerateRecoveryCodes('000000'), /Invalid TOTP code/);
    const fresh = await gated('POST', '/api/account/totp/recovery-codes/regenerate', () => api.regenerateRecoveryCodes('123456'));
    assert.equal(fresh.length, 8);
    assert.notDeepEqual(fresh, codes);
    const meAfterTotp = (await client.mojoCall('/api/user/me')).data;
    assert.equal(meAfterTotp.requires_mfa, true, 'confirm sets requires_mfa');
    await gated('DELETE', '/api/account/totp', () => api.disableTotp());
    assert.equal((await api.getRecoveryCodeStatus()).enrolled, false);
    assert.equal((await client.mojoCall('/api/user/me')).data.requires_mfa, true, 'turning the app off keeps MFA required');

    // ── Email change: a NEW login, same storage, old session dead ──
    const beforeEmail = client.getAccessToken();
    await gated('POST', '/api/auth/email/change/request', () => api.requestEmailChange('ian.new@mojoverify.com'));
    await assert.rejects(client.confirmEmailChange('000000'), /Invalid or expired code/);
    await api.requestEmailChange('ian.new@mojoverify.com');
    assert.deepEqual(await eventsOf(() => client.confirmEmailChange('123456')), ['rotated'], "email-change confirm emits 'rotated', never 'login'");
    assert.notEqual(client.getAccessToken(), beforeEmail);
    assert.equal(client.sessionIsPersistent(), false, 'the adopted login stays in sessionStorage');
    assert.equal((await mock.mockFetch('/api/user/me', { headers: { Authorization: `Bearer ${beforeEmail}` } })).error_code, 401, 'auth_key rotation kills the old token');
    const emailed = (await client.mojoCall('/api/user/me')).data;
    assert.equal(emailed.email, 'ian.new@mojoverify.com');
    assert.equal(emailed.is_email_verified, true);
    const NEW_EMAIL = 'ian.new@mojoverify.com';
    client.setFreshAuthHandler(reLogin(NEW_EMAIL));

    // ── Sessions: revoke others, keep this one ──
    const otherDevice = await mock.mockFetch('/api/login', { method: 'POST', body: { username: NEW_EMAIL, password: 'mojo' } });
    const beforeRevoke = client.getAccessToken();
    assert.deepEqual(await eventsOf(() => gated('POST', '/api/auth/sessions/revoke', () => client.revokeOtherSessions())), ['login', 'rotated'], "sessions revoke emits 'rotated' (the 'login' is the step-up re-login)");
    assert.deepEqual(await eventsOf(() => client.login(NEW_EMAIL, 'mojo', { remember: false }).then((r) => (r.kind === 'mfa' ? client.completeMfaTotp(r.mfaToken, '123456', { remember: false }) : null))), ['login'], "an explicit sign-in emits 'login'");
    assert.notEqual(client.getAccessToken(), beforeRevoke, 'the returned login is adopted');
    assert.equal(client.sessionIsPersistent(), false);
    assert.equal((await mock.mockFetch('/api/user/me', { headers: { Authorization: `Bearer ${otherDevice.data.access_token}` } })).error_code, 401, 'other sessions die');
    assert.equal((await client.mojoCall('/api/user/me')).data.email, NEW_EMAIL, 'this session stays signed in');

    // ── A grant without a token pair is refused; storage stays untouched ──
    // (django-mojo's forced_password_response after auth_key rotated).
    const storageDump = () => JSON.stringify([localStorage, sessionStorage].map((store) => ['access_token', 'refresh_token'].map((key) => store.getItem(key))));
    const beforeTokenless = storageDump();
    mock.armMockResponseOnce('POST', '/api/auth/sessions/revoke', { stripGrantTokens: true });
    await assert.rejects(client.revokeOtherSessions(), (error) => error.message === 'Sign in again to continue', 'a tokenless grant rejects with the sign-in copy');
    assert.equal(storageDump(), beforeTokenless, 'a tokenless grant leaves both storages untouched');
    await signIn(NEW_EMAIL); // the server rotated auth_key: sign back in

    // ── adoptGrant waits for an in-flight refresh ──
    let refreshSettled = false;
    mock.armMockResponseOnce('POST', '/api/token/refresh', { extraDelayMs: 600 });
    const slowRefresh = client.refreshTokens().then((ok) => { refreshSettled = true; return ok; });
    await signIn(NEW_EMAIL);
    assert.equal(refreshSettled, true, 'a login adopted during a refresh waits for that refresh to settle');
    await slowRefresh;
    assert.equal(client.sessionIsPersistent(), false);
    assert.equal((await client.mojoCall('/api/user/me')).data.email, NEW_EMAIL, 'the adopted login is the live session');

    // ── A refresh that completes after the session changed never lands on it ──
    const swapped = (await mock.mockFetch('/api/login', { method: 'POST', body: { username: 'showcase.operator@nativemojo.com', password: 'mojo' } })).data;
    mock.armMockResponseOnce('POST', '/api/token/refresh', { extraDelayMs: 600 });
    const staleRefresh = client.refreshTokens();
    client.setTokens(swapped.access_token, swapped.refresh_token, false);
    await staleRefresh;
    assert.equal(client.getAccessToken(), swapped.access_token, 'a stale refresh does not overwrite the changed session');
    assert.equal(client.getRefreshToken(), swapped.refresh_token);
    client.clearTokens({ silent: true });
    await client.login(NEW_EMAIL, 'mojo', { remember: false }).then((result) => (result.kind === 'mfa' ? client.completeMfaTotp(result.mfaToken, '123456', { remember: false }) : null));

    // ── A dismissed step-up adopts nothing ──
    client.setFreshAuthHandler(async () => false);
    const beforeDismissed = storageDump();
    mock.armMockReauth('POST', '/api/auth/sessions/revoke');
    let dismissedEvents;
    await assert.rejects(async () => { dismissedEvents = await eventsOf(() => client.revokeOtherSessions()); }, (error) => client.isReauthRequired(error), 'a dismissed step-up rejects with the 440');
    assert.deepEqual(authEvents, [], 'a dismissed step-up emits no login/rotated');
    assert.equal(dismissedEvents, undefined);
    assert.equal(storageDump(), beforeDismissed, 'a dismissed step-up leaves both storages untouched');
    client.setFreshAuthHandler(reLogin(NEW_EMAIL));

    // ── Rotations adopt into the storage the session came from: localStorage too ──
    client.clearTokens({ silent: true });
    await client.login(NEW_EMAIL, 'mojo', { remember: true }).then((result) => (result.kind === 'mfa' ? client.completeMfaTotp(result.mfaToken, '123456', { remember: true }) : null));
    assert.equal(client.sessionIsPersistent(), true);
    const beforePersistent = localStorage.getItem('access_token');
    await client.revokeOtherSessions();
    assert.notEqual(localStorage.getItem('access_token'), beforePersistent, 'the rotated login is adopted');
    assert(localStorage.getItem('access_token') && localStorage.getItem('refresh_token'), 'a persistent session rotates into localStorage');
    assert.equal(sessionStorage.getItem('access_token') ?? sessionStorage.getItem('refresh_token'), null, 'nothing lands in sessionStorage');
    await api.requestEmailChange('ian.persist@mojoverify.com');
    await client.confirmEmailChange('123456');
    assert(localStorage.getItem('access_token') && sessionStorage.getItem('access_token') == null, 'email-change confirm also keeps localStorage');
    await api.requestEmailChange(NEW_EMAIL);
    await client.confirmEmailChange('123456');
    client.clearTokens({ silent: true });
    await client.login(NEW_EMAIL, 'mojo', { remember: false }).then((result) => (result.kind === 'mfa' ? client.completeMfaTotp(result.mfaToken, '123456', { remember: false }) : null));

    // ── Phone change: top-level session_token ──
    const raw = await mock.mockFetch('/api/auth/phone/change/request', { method: 'POST', headers: bearer(), body: { phone_number: '+15555550177' } });
    assert.equal(typeof raw.session_token, 'string', 'session_token is top-level');
    assert.equal(raw.data, undefined);
    const ticket = await gated('POST', '/api/auth/phone/change/request', () => api.requestPhoneChange('+15555550188'));
    await assert.rejects(api.confirmPhoneChange(ticket.sessionToken, '000000'), /Invalid or expired code/);
    const ticket2 = await api.requestPhoneChange('+15555550188');
    await api.confirmPhoneChange(ticket2.sessionToken, '123456');
    const phoned = (await client.mojoCall('/api/user/me')).data;
    assert.equal(phoned.phone_number, '+15555550188');
    assert.equal(phoned.is_phone_verified, true);

    // ── Verification codes + username ──
    await api.sendVerificationCode('phone');
    await api.sendVerificationCode('email');
    const renamed = await gated('POST', '/api/auth/username/change', () => api.changeUsername('ian.renamed'));
    assert.equal(renamed, 'ian.renamed');

    // ── Notification preferences: master switch + kinds ──
    const prefs = await api.getNotificationPreferences();
    assert(Array.isArray(prefs.kinds) && prefs.kinds.some((k) => k.kind === 'general'), 'GET carries the kinds catalogue');
    const merged = await api.setNotificationPreferences({ '*': { email: false } });
    assert.equal(merged['*'].email, false);
    assert.equal((await api.getNotificationPreferences()).preferences['*'].email, false, 'the master switch persists');

    const totalPrompts = prompts;
    assert.equal(totalPrompts, 10, 'every fresh-auth path prompted exactly once');
    client.setFreshAuthHandler(null);
    console.log(`account wire verified (${totalPrompts} fresh-auth retries, passkey ceremony, owner rules, rotation, TOTP, phone/email change, master switch)`);

    // ── Module: exports, boundaries, mounted flows ────────────────────
    const read = (path) => readFile(new URL(`../packages/portal-mojo/src/${path}`, import.meta.url), 'utf8');
    const sources = Object.fromEntries(await Promise.all(['account/index.ts', 'account/AccountModal.tsx', 'account/AccountSections.tsx', 'account/dialogs.tsx', 'account/models.ts', 'account/api.ts', 'account/PasskeyList.tsx', 'account/NotificationPreferences.tsx', 'account/sections/ApiKeysSection.tsx'].map(async (path) => [path, await read(path)])));
    for (const [path, source] of Object.entries(sources)) {
        assert.doesNotMatch(source, /from ['"](?:\.\.\/)+admin(?:\/index)?['"]/, `${path} must not import the admin barrel`);
    }
    // Direct TanStack hooks anywhere in the module — generic-typed calls
    // (`useMutation<…>(`) included. Only the reviewed model hooks may use them.
    const { readdir } = await import('node:fs/promises');
    const accountDir = new URL('../packages/portal-mojo/src/account/', import.meta.url);
    const allowedHooks = { 'models.ts': { useMutation: 2, useQuery: 2 } };
    for (const entry of await readdir(accountDir, { recursive: true })) {
        if (!/\.tsx?$/.test(entry)) continue;
        const source = await readFile(new URL(entry, accountDir), 'utf8');
        for (const hook of ['useMutation', 'useQuery']) {
            const uses = (source.match(new RegExp(`\\b${hook}\\s*[<(]`, 'g')) ?? []).length;
            assert.equal(uses, allowedHooks[entry]?.[hook] ?? 0, `account/${entry}: ${uses} direct ${hook} call(s) — one-time values must never pass through a TanStack mutation/query`);
        }
    }
    assert.match(sources['account/PasskeyList.tsx'], /PasskeyModel\.useList\(\{ user: userId/, 'passkey reads always carry ?user=');
    assert.match(sources['account/dialogs.tsx'], /safeQrDataUrl\(step\.qr\)/, 'the QR is re-checked at the <img> sink');

    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { act } = React;
    const ui = await server.ssrLoadModule('/packages/portal-mojo/src/ui/index.ts');
    const account = await server.ssrLoadModule('/packages/portal-mojo/src/account/index.ts');
    const consoleErrors = [];
    console.error = (...args) => { consoleErrors.push(args.map(String).join(' ')); };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, ...client.mojoQueryDefaults().queries } } });
    let probe = null;
    function Probe() { probe = { save: account.MeSaveModel.useSave() }; return null; }
    const root = createRoot(document.getElementById('root'));
    const wait = (ms) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
    const buttons = () => [...document.querySelectorAll('button')];
    const button = (text) => buttons().reverse().find((node) => node.textContent.trim() === text || node.getAttribute('aria-label') === text);
    const click = async (text) => { const node = button(text); assert(node, `missing button "${text}"`); assert(!node.disabled, `"${text}" is disabled`); await act(async () => { node.click(); }); };
    const type = async (input, value) => {
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };
    const openDialogs = () => [...document.querySelectorAll('dialog')].filter((node) => node.open);
    const cacheDump = () => JSON.stringify([
        qc.getQueryCache().getAll().map((query) => [query.queryKey, query.state.data]),
        qc.getMutationCache().getAll().map((mutation) => [mutation.state.variables, mutation.state.data]),
    ]);
    // Every storage entry except the session's own token pair.
    const nonTokenStorage = () => JSON.stringify([localStorage, sessionStorage].map((store) => {
        const out = {};
        for (let i = 0; i < store.length; i++) {
            const key = store.key(i);
            if (key !== 'access_token' && key !== 'refresh_token') out[key] = store.getItem(key);
        }
        return out;
    }));
    const assertNoSecrets = (label, secrets) => {
        const caches = cacheDump();
        const stored = nonTokenStorage();
        for (const secret of secrets) {
            assert(typeof secret === 'string' && secret.length >= 8, `${label}: the secret was captured for the check`);
            assert(!caches.includes(secret), `${label}: a one-time value leaked into a Query/Mutation cache`);
            assert(!stored.includes(secret), `${label}: a one-time value leaked into storage`);
        }
    };
    const clickMatch = async (pattern) => {
        const node = buttons().reverse().find((candidate) => pattern.test(candidate.textContent.trim()));
        assert(node, `missing button ${pattern}`);
        await act(async () => { node.click(); });
    };

    // A fresh, unenrolled, non-admin identity for the mounted half.
    await client.login('groups.viewer@nativemojo.com', 'mojo');
    const viewer = (await client.mojoCall('/api/user/me')).data;
    await act(async () => {
        root.render(React.createElement(QueryClientProvider, { client: qc },
            React.createElement(ui.ModalHost), React.createElement(Probe)));
    });

    // MeSaveModel: only the changes go to /api/user/me; me cache = sanitized row.
    const saved = await act(() => probe.save.mutateAsync({ id: viewer.id, changes: { display_name: 'Viewer Renamed' } }));
    assert.equal(saved.display_name, 'Viewer Renamed');
    assert.equal(qc.getQueryData(['me', client.getAuthSnapshot().uid]).display_name, 'Viewer Renamed', 'MeSaveModel writes ["me", uid]');
    await assert.rejects(async () => { await act(() => probe.save.mutateAsync({ id: viewer.id, changes: { email: 'x@example.com' } })); }, /not allowed to change email/);

    // Recovery status caches enrolled + remaining only.
    await qc.fetchQuery({ queryKey: account.accountKeys.recoveryStatus(viewer.id), queryFn: account.getRecoveryCodeStatus });
    assert.deepEqual(Object.keys(qc.getQueryData(account.accountKeys.recoveryStatus(viewer.id))).sort(), ['enrolled', 'remaining']);

    // TOTP enrolment: QR from data:, codes shown once, locked until ticked,
    // and NOTHING one-time left in any cache afterwards.
    let enrolled;
    await act(async () => { enrolled = account.openTotpEnrolDialog({ replacing: false }); });
    await wait(600);
    const qr = document.querySelector('dialog[open] img');
    assert(qr && /^data:image\/svg\+xml;base64,/.test(qr.getAttribute('src')), 'the QR renders from the data: image');
    await click('Enter a key instead');
    const secretShown = document.querySelector('[aria-label="Setup key"]').textContent.replace(/\s/g, '');
    await click('Next');
    await type(document.querySelector('dialog[open] input[autocomplete="one-time-code"]'), '123456');
    await click('Turn on');
    await wait(600);
    const shownCodes = [...document.querySelectorAll('dialog[open] [aria-label="Recovery codes"] code')].map((node) => node.textContent);
    assert.equal(shownCodes.length, 8, 'eight recovery codes are shown once');
    assert(button('Done').disabled, 'Done waits for "I saved these"');
    await act(async () => { openDialogs().at(-1).dispatchEvent(new Event('cancel', { cancelable: true })); });
    assert.equal(openDialogs().length, 1, 'Escape cannot dismiss unsaved recovery codes');
    // Chromium's second Escape (no click between) / Android back: a
    // NON-cancelable cancel, then the native dialog closes on its own.
    let enrolSettled = false;
    void enrolled.then(() => { enrolSettled = true; });
    const codesDialog = openDialogs().at(-1);
    await act(async () => { codesDialog.open = false; codesDialog.dispatchEvent(new Event('close')); });
    await wait(0);
    assert.equal(codesDialog.open, true, 'a native close of unsaved recovery codes reopens the dialog');
    assert.equal(enrolSettled, false, 'the enrol promise is still pending after a native close');
    await act(async () => { document.querySelector('dialog[open] input[type="checkbox"]').click(); });
    await click('Done');
    assert.equal(await enrolled, true);
    assert.equal(openDialogs().length, 0);
    await wait(400);
    assertNoSecrets('TOTP enrolment', [secretShown, ...shownCodes]);
    assert.equal(qc.getQueryState(account.accountKeys.recoveryStatus(viewer.id))?.isInvalidated, true, 'enrolment invalidates the cached status');
    await qc.fetchQuery({ queryKey: account.accountKeys.recoveryStatus(viewer.id), queryFn: account.getRecoveryCodeStatus });
    assert.deepEqual(qc.getQueryData(account.accountKeys.recoveryStatus(viewer.id)), { enrolled: true, remaining: 8 });

    // Regenerate: the new shown-once set never reaches a cache or storage.
    let regenerated;
    await act(async () => { regenerated = account.openRegenerateRecoveryCodes(); });
    await type(document.querySelector('dialog[open] input[autocomplete="one-time-code"]'), '123456');
    await click('Regenerate');
    await wait(600);
    const regenCodes = [...document.querySelectorAll('dialog[open] [aria-label="Recovery codes"] code')].map((node) => node.textContent);
    assert.equal(regenCodes.length, 8, 'regenerate shows a fresh set once');
    await act(async () => { document.querySelector('dialog[open] input[type="checkbox"]').click(); });
    await click('Done');
    assert.equal(await regenerated, true);
    await wait(400);
    assertNoSecrets('recovery-code regenerate', regenCodes);

    // The modal: six rail tabs, each section renders; sign-out lives in the rail.
    // Every owner-scoped list the sections make carries ?user=<me>.
    mock.clearMockRequestHistory();
    let closed;
    await act(async () => { closed = account.openAccountModal(); });
    await wait(500);
    const tabs = [...document.querySelectorAll('dialog[open] [role="tab"]')].map((node) => node.textContent.trim());
    assert.deepEqual(tabs, ['Profile', 'Passkeys', 'Security', 'Sessions', 'Notifications', 'API keys']);
    for (const tab of tabs) {
        await act(async () => { [...document.querySelectorAll('dialog[open] [role="tab"]')].find((node) => node.textContent.trim() === tab).click(); });
        await wait(500);
        assert.equal(document.querySelector('dialog[open] .acct-title-section').textContent, tab);
        assert(!document.querySelector('dialog[open] .acct-body [role="alert"].form-alert'), `${tab} renders without an error`);
    }
    const ownerLists = mock.getMockRequestHistory().filter((entry) => entry.method === 'GET' && entry.params && 'user' in entry.params);
    assert.deepEqual([...new Set(ownerLists.map((entry) => entry.path))].sort(), ['/api/account/api_keys', '/api/account/logins', '/api/account/oauth_connection', '/api/account/passkeys', '/api/user/device'], 'every owner-scoped list was exercised');
    for (const entry of ownerLists) assert.equal(String(entry.params.user), String(viewer.id), `${entry.path} carries ?user=<me>`);

    // API key generate: the token is shown once and lands in no cache/storage.
    await act(async () => { [...document.querySelectorAll('dialog[open] [role="tab"]')].find((node) => node.textContent.trim() === 'API keys').click(); });
    await wait(500);
    await clickMatch(/Generate key$/);
    await wait(50);
    await type(openDialogs().at(-1).querySelector('input'), 'CI key');
    await click('Generate');
    await wait(600);
    const apiToken = document.querySelector('dialog[open] [aria-label="Generated API key"]')?.textContent;
    await click('Close'); // the secret dialog
    await wait(600);
    assertNoSecrets('API-key generate', [apiToken]);

    await click('Close');
    await closed;
    assert.equal(openDialogs().length, 0);

    // Phone change request: the session_token stays in dialog state.
    let phoneChanged;
    await act(async () => { phoneChanged = account.openPhoneChangeDialog(); });
    await wait(300);
    await type(document.querySelector('dialog[open] input[type="tel"]'), '+15555550913');
    await click('Send code');
    await wait(600);
    assert(document.querySelector('dialog[open] input[autocomplete="one-time-code"]'), `phone change reached the code step (${document.querySelector('dialog[open] [role="alert"]')?.textContent ?? 'no alert'})`);
    const phoneTokenShape = /pc:mock-/;
    assert.doesNotMatch(cacheDump(), phoneTokenShape, 'phone change request: the session_token never reaches a cache');
    assert.doesNotMatch(nonTokenStorage(), phoneTokenShape, 'phone change request: the session_token never reaches storage');
    await type(document.querySelector('dialog[open] input[autocomplete="one-time-code"]'), '123456');
    await clickMatch(/^(Add|Change) phone$/);
    assert.equal(await act(() => phoneChanged), true);
    await wait(400);
    assert.doesNotMatch(cacheDump() + nonTokenStorage(), phoneTokenShape, 'phone change confirm: no session_token left behind');

    // ── Native close (non-cancelable cancel) honours canDismiss ──
    let locked = true;
    let lockedResult = 'pending';
    await act(async () => {
        void ui.modal.open(() => React.createElement('div', null, React.createElement('button', { type: 'button' }, 'Inside')), { canDismiss: () => !locked })
            .then((value) => { lockedResult = value; });
    });
    const nativeDialog = openDialogs().at(-1);
    await act(async () => { nativeDialog.open = false; nativeDialog.dispatchEvent(new Event('close')); });
    await wait(0);
    assert.equal(nativeDialog.open, true, 'a locked modal reopens after a native close');
    assert(nativeDialog.contains(document.activeElement), 'focus is kept inside the reopened modal');
    assert.equal(lockedResult, 'pending', 'a locked modal stays unresolved after a native close');
    locked = false;
    await act(async () => { nativeDialog.open = false; nativeDialog.dispatchEvent(new Event('close')); });
    await wait(0);
    assert.equal(lockedResult, null, 'an unlocked native close resolves null');
    assert.equal(openDialogs().length, 0, 'an unlocked native close pops the stack');

    // ── An open enrol dialog never survives a sign-out / sign-in ──
    // Mount the host the way an app's auth guard does: only while signed in.
    const setupCalls = () => mock.getMockCallCounts()['POST /api/account/totp/setup'] ?? 0;
    let setHostOn;
    function GuardedHost() {
        const auth = client.useAuthSnapshot();
        const [on, setOn] = React.useState(true);
        setHostOn = setOn;
        return auth.authenticated && on ? React.createElement(ui.ModalHost) : null;
    }
    await act(async () => {
        root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(GuardedHost), React.createElement(Probe)));
    });
    const settle = (promise) => { const box = { value: 'pending' }; void promise.then((v) => { box.value = v; }); return box; };

    // Layer 1 — the "started" flag belongs to the OPEN, not the mount.
    let before = setupCalls();
    let enrol;
    await act(async () => { enrol = settle(account.openTotpEnrolDialog({ replacing: false })); });
    await wait(600);
    assert.equal(setupCalls() - before, 1, 'opening the enrol dialog runs setup once');
    await act(async () => { setHostOn(false); });
    await act(async () => { setHostOn(true); });
    await wait(600);
    assert.equal(setupCalls() - before, 1, 'a host remount never re-runs setup');
    assert(document.querySelector('dialog[open] [role="alert"]')?.textContent.includes('Setup was interrupted'), 'a remounted enrol dialog offers Try again instead');

    // Layer 2 — setup refuses to run for a different identity than it opened for.
    const other = (await mock.mockFetch('/api/login', { method: 'POST', body: { username: 'showcase.operator@nativemojo.com', password: 'mojo' } })).data;
    const stored = { access: localStorage.getItem('access_token'), refresh: localStorage.getItem('refresh_token') };
    localStorage.setItem('access_token', other.access_token); // silent: no auth notification
    localStorage.setItem('refresh_token', other.refresh_token);
    before = setupCalls();
    await click('Try again');
    await wait(600);
    assert.equal(setupCalls() - before, 0, 'setup never runs for another uid');
    assert.equal(enrol.value, false, 'the enrol dialog resolves (false) for another uid');
    assert.equal(openDialogs().length, 0);
    localStorage.setItem('access_token', stored.access);
    localStorage.setItem('refresh_token', stored.refresh);

    // Layer 3 — logout empties the stack; signing in as someone else shows nothing.
    await act(async () => { enrol = settle(account.openTotpEnrolDialog({ replacing: false })); });
    await wait(600);
    before = setupCalls();
    await act(async () => { client.logout(); });
    await wait(0);
    assert.equal(enrol.value, false, 'logout resolves the open enrol dialog');
    await act(async () => { await client.login('showcase.operator@nativemojo.com', 'mojo'); });
    await wait(600);
    assert.equal(setupCalls() - before, 0, 'no totp/setup call after logout → login as another uid');
    assert.equal(openDialogs().length, 0, 'the modal stack is empty after logout → login');

    // Identity change seen through storage (another tab): no logout event here.
    await act(async () => { enrol = settle(account.openTotpEnrolDialog({ replacing: false })); });
    await wait(600);
    before = setupCalls();
    const operatorUid = client.getAuthSnapshot().uid;
    const otherGrant = (await mock.mockFetch('/api/login', { method: 'POST', body: { username: 'support.viewer@nativemojo.com', password: 'mojo' } })).data;
    assert(otherGrant.access_token && otherGrant.refresh_token, 'a full grant for the replacing identity');
    await act(async () => { client.setTokens(otherGrant.access_token, otherGrant.refresh_token, true); });
    assert(client.getAuthSnapshot().authenticated && client.getAuthSnapshot().uid !== operatorUid, 'still signed in, as someone else');
    await wait(600);
    assert.equal(enrol.value, false, 'an identity change closes the open enrol dialog');
    assert.equal(openDialogs().length, 0);
    assert.equal(setupCalls() - before, 0, 'no setup call for the identity that replaced it');

    // ── Rotations through the UI: the new login reaches storage only as the
    // session's token pair — never a cache — and the old token is gone ──
    const allStorage = () => JSON.stringify([localStorage, sessionStorage].map((store) => Array.from({ length: store.length }, (_, i) => store.getItem(store.key(i)))));
    let rotatedFrom = client.getAccessToken();
    let emailChanged;
    await act(async () => { emailChanged = account.openEmailChangeDialog(); });
    await wait(300);
    await type(document.querySelector('dialog[open] input[type="email"]'), 'support.viewer.renamed@nativemojo.com');
    await click('Send code');
    await wait(600);
    assert(document.querySelector('dialog[open] input[autocomplete="one-time-code"]'), `email change reached the code step (${document.querySelector('dialog[open] [role="alert"]')?.textContent ?? openDialogs().length + ' dialogs'})`);
    await type(document.querySelector('dialog[open] input[autocomplete="one-time-code"]'), '123456');
    await click('Change email');
    assert.equal(await act(() => emailChanged), true, 'the email change completes');
    await wait(400);
    assert.notEqual(client.getAccessToken(), rotatedFrom, 'email-change confirm adopted a new login');
    assertNoSecrets('email-change confirm', [client.getAccessToken(), client.getRefreshToken()]);
    assert(!allStorage().includes(rotatedFrom), 'email-change confirm: the old token is gone from storage');

    rotatedFrom = client.getAccessToken();
    let sessionsModal;
    await act(async () => { sessionsModal = account.openAccountModal({ initialSection: 'sessions' }); });
    await wait(500);
    await click('Sign out everywhere else');
    await click('Sign out others');
    await wait(600);
    assert.notEqual(client.getAccessToken(), rotatedFrom, 'sessions revoke adopted a new login');
    assertNoSecrets('sessions revoke', [client.getAccessToken(), client.getRefreshToken()]);
    assert(!allStorage().includes(rotatedFrom), 'sessions revoke: the old token is gone from storage');
    await click('Close');
    await act(() => sessionsModal);
    assert.equal(openDialogs().length, 0);

    // ── Password change offers "Sign out everywhere else" (auth_key does not rotate) ──
    await act(async () => {
        root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(GuardedHost), React.createElement(ui.ToastHost), React.createElement(Probe)));
    });
    let passwordChanged;
    await act(async () => { passwordChanged = account.openChangePasswordDialog(); });
    const passwordInputs = [...document.querySelectorAll('dialog[open] input[type="password"]')];
    await type(passwordInputs[0], 'mojo');
    await type(passwordInputs[1], 'Brand-new-pass-789');
    await type(passwordInputs[2], 'Brand-new-pass-789');
    await act(async () => { document.querySelector('dialog[open] form').requestSubmit(); });
    assert.equal(await act(() => passwordChanged), true, 'the password change completes');
    await wait(50);
    const revokes = () => mock.getMockCallCounts()['POST /api/auth/sessions/revoke'] ?? 0;
    const revokesBefore = revokes();
    rotatedFrom = client.getAccessToken();
    await click('Sign out everywhere else');
    await wait(600);
    assert.equal(revokes() - revokesBefore, 1, 'the toast action revokes the other sessions');
    assert.notEqual(client.getAccessToken(), rotatedFrom, 'and keeps this session on the rotated login');
    assert(!button('Sign out everywhere else'), 'the action toast dismisses on click');

    await act(async () => root.unmount());
    console.error = originalError;
    assert.deepEqual(consoleErrors.filter((line) => !/inert/.test(line)), [], 'no console errors while mounted');
    console.log('account module verified (no admin barrel, MeSaveModel me write, status-only cache, TOTP shown-once lock + no secret in any cache, six sections render)');
} catch (error) {
    console.error = originalError;
    console.error(error);
    process.exitCode = 1;
} finally {
    client?.stopAutoRefresh();
    await server.close();
    dom.window.close();
}
// The auth refresh watcher, Query gc timers and the React scheduler would
// otherwise hold the run open.
process.exit(process.exitCode ?? 0);
