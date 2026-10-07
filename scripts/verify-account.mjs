// verify:account — the self-service account wire (AccountModal, #7184):
// passkey registration bodies (base64url decode, transports at the TOP level,
// id === rawId), one 440 retry per fresh-auth path, owner-scoped passkey
// reads, the /api/user/me owner rules, session rotation adopting the new
// login in the SAME storage, the TOTP / recovery-code shapes, phone change's
// top-level session_token, and the notification master switch ("*") + kinds.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

function memoryStorage() {
    const map = new Map();
    return {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => { map.set(key, String(value)); },
        removeItem: (key) => { map.delete(key); },
        clear: () => map.clear(),
        get length() { return map.size; },
        key: (i) => [...map.keys()][i] ?? null,
    };
}

const created = [];
let nextCredential = null;
class FakePublicKeyCredential {}
globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    location: { hash: '', pathname: '/', search: '', origin: 'http://localhost' },
    history: { replaceState() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    PublicKeyCredential: FakePublicKeyCredential,
};
globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
        credentials: {
            async get() { throw new Error('not used'); },
            async create(options) {
                created.push(options);
                if (nextCredential) { const value = nextCredential; nextCredential = null; return value(); }
                const raw = new TextEncoder().encode(`cred-${created.length}-${Date.now()}`);
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
    },
});

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
let client;
try {
    client = await server.ssrLoadModule('/packages/portal-mojo/src/client/index.ts');
    const api = await server.ssrLoadModule('/packages/portal-mojo/src/account/api.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    client.initAuth();

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
    const reLogin = (email) => async () => {
        prompts += 1;
        const remember = client.sessionIsPersistent();
        const result = await client.login(email, 'mojo', { remember });
        if (result.kind === 'mfa') await client.completeMfaTotp(result.mfaToken, '123456', { remember });
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
    const second = await gated('POST', '/api/account/passkeys/register/complete', () => client.registerPasskey());
    assert.equal(second.friendly_name, 'Mac — Chrome', 'the default name is the suggested one');

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
    await client.confirmEmailChange('123456');
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
    await gated('POST', '/api/auth/sessions/revoke', () => client.revokeOtherSessions());
    assert.notEqual(client.getAccessToken(), beforeRevoke, 'the returned login is adopted');
    assert.equal(client.sessionIsPersistent(), false);
    assert.equal((await mock.mockFetch('/api/user/me', { headers: { Authorization: `Bearer ${otherDevice.data.access_token}` } })).error_code, 401, 'other sessions die');
    assert.equal((await client.mojoCall('/api/user/me')).data.email, NEW_EMAIL, 'this session stays signed in');

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
} finally {
    // The auth client's 60s refresh watcher would otherwise hold the process open.
    client?.stopAutoRefresh();
    await server.close();
}
