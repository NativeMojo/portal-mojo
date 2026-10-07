// verify:account — the self-service account wire (AccountModal, #7184):
// passkey registration bodies (base64url decode, transports at the TOP level,
// id === rawId), one 440 retry per fresh-auth path, owner-scoped passkey
// reads, the /api/user/me owner rules, session rotation adopting the new
// login in the SAME storage, the TOTP / recovery-code shapes, phone change's
// top-level session_token, and the notification master switch ("*") + kinds.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

// JSDOM hosts both halves: the wire calls (auth client + mock) and the
// mounted module checks (dialogs, cache boundary). It does not claim native
// <dialog>/focus/layout coverage — the browser pass owns that.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'HTMLDialogElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'Node', 'localStorage', 'sessionStorage']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function close() { this.open = false; };
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

const created = [];
let nextCredential = null;
class FakePublicKeyCredential {}
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

    // ── Module: exports, boundaries, mounted flows ────────────────────
    const read = (path) => readFile(new URL(`../packages/portal-mojo/src/${path}`, import.meta.url), 'utf8');
    const sources = Object.fromEntries(await Promise.all(['account/index.ts', 'account/AccountModal.tsx', 'account/AccountSections.tsx', 'account/dialogs.tsx', 'account/models.ts', 'account/api.ts', 'account/PasskeyList.tsx', 'account/NotificationPreferences.tsx', 'account/sections/ApiKeysSection.tsx'].map(async (path) => [path, await read(path)])));
    for (const [path, source] of Object.entries(sources)) {
        assert.doesNotMatch(source, /from ['"](?:\.\.\/)+admin(?:\/index)?['"]/, `${path} must not import the admin barrel`);
    }
    assert.doesNotMatch(sources['account/dialogs.tsx'], /\buse(?:Mutation|Query)\s*\(/, 'one-time secrets never pass through a TanStack mutation/query');
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
    const dump = cacheDump();
    for (const secret of [secretShown, ...shownCodes]) assert(!dump.includes(secret), `one-time value leaked into a TanStack cache: ${secret}`);
    assert.equal(qc.getQueryState(account.accountKeys.recoveryStatus(viewer.id))?.isInvalidated, true, 'enrolment invalidates the cached status');
    await qc.fetchQuery({ queryKey: account.accountKeys.recoveryStatus(viewer.id), queryFn: account.getRecoveryCodeStatus });
    assert.deepEqual(qc.getQueryData(account.accountKeys.recoveryStatus(viewer.id)), { enrolled: true, remaining: 8 });

    // The modal: six rail tabs, each section renders; sign-out lives in the rail.
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
    await click('Close');
    await closed;
    assert.equal(openDialogs().length, 0);

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
    const viewerGrant = (await mock.mockFetch('/api/login', { method: 'POST', body: { username: 'groups.viewer@nativemojo.com', password: 'mojo' } })).data;
    await act(async () => { client.setTokens(viewerGrant.access_token, viewerGrant.refresh_token, true); });
    await wait(600);
    assert.equal(enrol.value, false, 'an identity change closes the open enrol dialog');
    assert.equal(openDialogs().length, 0);
    assert.equal(setupCalls() - before, 0, 'no setup call for the identity that replaced it');

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
