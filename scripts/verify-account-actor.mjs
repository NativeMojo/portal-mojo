// Mounted profile save regression, using the real auth gate + transport.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://verify.invalid/' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'Node', 'localStorage', 'sessionStorage']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), appType: 'custom', logLevel: 'silent', define: { 'import.meta.env.VITE_MOJO_API': JSON.stringify('https://verify.invalid') }, server: { middlewareMode: true } });
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const token = uid => `e30.${Buffer.from(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + 86400, iat: Math.floor(Date.now() / 1000) })).toString('base64url')}.test`;
const ok = data => ({ ok: true, status: 200, json: async () => ({ status: true, data }) });
let root;
let qc;
try {
    const auth = await server.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
    const api = await server.ssrLoadModule('/packages/portal-mojo/src/account/api.ts');
    const { captureAccountActor } = await server.ssrLoadModule('/packages/portal-mojo/src/account/actor.ts');
    const { MeSaveModel } = await server.ssrLoadModule('/packages/portal-mojo/src/account/models.ts');
    let save;
    function Probe() { save = MeSaveModel.useSave(); return null; }
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
    auth.setTokens(token(1));
    root = createRoot(document.getElementById('root'));
    await React.act(async () => root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Probe))));
    const gate = deferred();
    const started = deferred();
    const calls = [];
    client.installAuthHooks({ preRequest: async () => { started.resolve(); await gate.promise; }, authHeader: () => `Bearer ${auth.getAccessToken()}` });
    globalThis.fetch = async (url, opts) => { calls.push({ url, bearer: opts.headers.Authorization }); return ok({ id: Number(auth.getAuthSnapshot().uid), display_name: 'Old draft' }); };
    let result;
    await React.act(async () => {
        const saving = save.mutateAsync({ id: 1, changes: { display_name: 'Old draft' } }).then(value => ({ value }), error => ({ error }));
        await started.promise;
        auth.setTokens(token(2));
        gate.resolve();
        result = await saving;
    });
    assert.equal(calls.length, 0, 'the old profile draft must not be sent with the next caller bearer after a delayed auth gate');
    assert(result.error, 'the old save rejects');
    assert.equal(qc.getQueryData(['me', '1']), undefined, 'no old response is cached');
    assert.equal(qc.getQueryData(['me', '2']), undefined, 'no new caller cache is contaminated');

    const reset = async () => {
        await React.act(async () => { auth.setTokens(token(1)); qc.clear(); });
        calls.length = 0;
        client.installAuthHooks({ preRequest: async () => {}, authHeader: () => `Bearer ${auth.getAccessToken()}` });
    };
    const attempt = async run => {
        let answer;
        await React.act(async () => { answer = await run().then(value => ({ value }), error => ({ error })); });
        return answer;
    };
    // A response already in flight cannot publish after A → B → A either.
    await reset();
    const response = deferred();
    const sent = deferred();
    globalThis.fetch = async () => { calls.push({}); sent.resolve(); return response.promise; };
    await React.act(async () => {
        const saving = save.mutateAsync({ id: 1, changes: { display_name: 'Old response' } }).then(value => ({ value }), error => ({ error }));
        await sent.promise;
        auth.setTokens(token(2));
        auth.setTokens(token(1));
        response.resolve(ok({ id: 1, display_name: 'Old response' }));
        result = await saving;
    });
    assert(result.error, 'an actor switch permanently retires an in-flight action');
    assert.equal(qc.getQueryData(['me', '1']), undefined, 'late response never enters me cache');

    // The existing fresh-auth flow retries once, with the same captured actor.
    const reauth = () => ({ ok: false, status: 440, json: async () => ({ status: false, error: 'reauth_required' }) });
    for (const nextUid of [2, 1]) {
        await reset();
        let prompts = 0;
        auth.setFreshAuthHandler(async () => { prompts++; auth.setTokens(token(nextUid)); return true; });
        globalThis.fetch = async (_url, opts) => { calls.push(opts); return calls.length === 1 ? reauth() : ok({ id: 1, display_name: 'Fresh save' }); };
        result = await attempt(() => save.mutateAsync({ id: 1, changes: { display_name: 'Fresh save' } }));
        assert.equal(prompts, 1);
        assert.equal(calls.length, nextUid === 1 ? 2 : 1, 'the retry never sends under a different caller');
        if (nextUid === 2) assert(result.error);
        else {
            assert.equal(result.value.display_name, 'Fresh save');
            assert.equal(qc.getQueryData(['me', '1']).display_name, 'Fresh save');
        }
    }
    await reset();
    globalThis.fetch = async (_url, opts) => { calls.push(opts); return ok({ id: 1, avatar: { id: 9, url: 'private-avatar-url' } }); };
    result = await attempt(() => save.mutateAsync({ id: 2, changes: { avatar: 9 } }));
    assert(result.error, 'a stale row id is rejected even if a hook has already re-rendered');
    assert.equal(calls.length, 0);
    result = await attempt(() => save.mutateAsync({ id: 1, changes: { avatar: 9 } }));
    assert.deepEqual(result.value.avatar, { id: 9 });
    assert(!JSON.stringify(qc.getQueryData(['me', '1'])).includes('private-avatar-url'));

    // Every enabled Profile request is fenced after a delayed auth gate.
    const profileActions = [
        () => api.requestEmailChange('next@example.test'),
        () => api.requestPhoneChange('+15555550123'),
        () => api.confirmPhoneChange('private-ticket', '123456'),
        () => api.sendVerificationCode('email'),
        () => api.sendVerificationCode('phone'),
        () => api.confirmVerificationCode('email', '123456'),
        () => api.confirmVerificationCode('phone', '123456'),
        () => api.confirmEmailChange('123456'),
    ];
    for (const action of profileActions) {
        await reset();
        const gate = deferred();
        const waiting = deferred();
        client.installAuthHooks({ preRequest: async () => { waiting.resolve(); await gate.promise; }, authHeader: () => `Bearer ${auth.getAccessToken()}` });
        await React.act(async () => {
            const pending = action().then(value => ({ value }), error => ({ error }));
            await waiting.promise;
            auth.setTokens(token(2));
            gate.resolve();
            result = await pending;
        });
        assert(result.error, 'Profile action rejects account switch at send');
        assert.equal(calls.length, 0, 'Profile action sends nothing under the replacement caller');
    }
    // A dialog's opening actor also protects the gap between two-step calls.
    await reset();
    const dialogActor = captureAccountActor();
    await React.act(async () => { auth.setTokens(token(2)); auth.setTokens(token(1)); });
    result = await attempt(() => api.confirmPhoneChange('private-ticket', '123456', dialogActor.check));
    assert(result.error);
    assert.equal(calls.length, 0);
    dialogActor.dispose();

    // Email confirmation must fence adoption as well as the request itself.
    await reset();
    const emailResponse = deferred();
    const emailSent = deferred();
    globalThis.fetch = async () => { emailSent.resolve(); return emailResponse.promise; };
    await React.act(async () => {
        const pending = api.confirmEmailChange('123456').then(value => ({ value }), error => ({ error }));
        await emailSent.promise;
        auth.setTokens(token(2));
        emailResponse.resolve(ok({ access_token: token(1), refresh_token: token(1), user: { id: 1 } }));
        result = await pending;
    });
    assert(result.error);
    assert.equal(auth.getAuthSnapshot().uid, '2', 'old email confirmation cannot adopt over the new session');

    // Adoption can itself wait for an existing refresh; recheck after that wait.
    await reset();
    await React.act(async () => auth.setTokens(token(1), token(1)));
    const refreshResponse = deferred();
    const refreshSent = deferred();
    const confirming = deferred();
    globalThis.fetch = async url => {
        if (String(url).endsWith('/api/token/refresh')) { refreshSent.resolve(); return refreshResponse.promise; }
        confirming.resolve();
        return ok({ access_token: token(1), refresh_token: token(1), user: { id: 1 } });
    };
    await React.act(async () => {
        const refreshing = auth.refreshTokens();
        await refreshSent.promise;
        const pending = api.confirmEmailChange('123456').then(value => ({ value }), error => ({ error }));
        await confirming.promise;
        await new Promise(resolve => setTimeout(resolve, 0));
        auth.setTokens(token(2));
        refreshResponse.resolve(ok({ access_token: token(1), refresh_token: token(1) }));
        await refreshing;
        result = await pending;
    });
    assert(result.error);
    assert.equal(auth.getAuthSnapshot().uid, '2', 'actor guard is checked after the adoption refresh wait');

    // Linked-sign-in unlink uses its real mounted action and final-send guard.
    const { LinkedSignIns } = await server.ssrLoadModule('/packages/portal-mojo/src/account/AccountSections.tsx');
    const { modal } = await server.ssrLoadModule('/packages/portal-mojo/src/ui/modal.tsx');
    const originalConfirm = modal.confirm;
    try {
        for (const stage of ['confirmation', 'auth']) {
            await reset();
            const pause = deferred();
            const waiting = deferred();
            modal.confirm = async () => { if (stage === 'confirmation') { waiting.resolve(); await pause.promise; } return true; };
            client.installAuthHooks({ preRequest: async path => { if (path.endsWith('/9') && stage === 'auth') { waiting.resolve(); await pause.promise; } }, authHeader: () => `Bearer ${auth.getAccessToken()}` });
            globalThis.fetch = async (_url, opts) => {
                calls.push(opts);
                return ok(opts.method === 'GET' ? [{ id: 9, provider: 'google', email: 'owner@example.test' }] : {});
            };
            await React.act(async () => {
                root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LinkedSignIns, { userId: 1 })));
                await new Promise(resolve => setTimeout(resolve, 10));
            });
            await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
            const unlink = [...document.querySelectorAll('button')].find(button => button.textContent === 'Unlink');
            assert(unlink, 'linked sign-in row mounted');
            await React.act(async () => {
                unlink.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await waiting.promise;
                auth.setTokens(token(2));
                pause.resolve();
                await new Promise(resolve => setTimeout(resolve, 10));
            });
            assert.equal(calls.filter(call => call.method === 'DELETE').length, 0, `unlink blocks actor switch during ${stage}`);
        }
    } finally { modal.confirm = originalConfirm; }
    auth.setFreshAuthHandler(null);
    auth.stopAutoRefresh();
    console.log('PASS profile actor: mounted save delayed-auth regression, late A/B/A response, fresh-auth retry change/same actor, stale id, avatar sanitation, all eight Profile request paths, two-step dialog lifetime, email-session adoption/refresh wait, and mounted unlink confirmation/auth waits');

} finally {
    if (root) await React.act(async () => root.unmount());
    qc?.clear();
    await server.close();
    dom.window.close();
}
