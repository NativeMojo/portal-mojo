import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://portal.example.test/' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Event', 'Node', 'localStorage', 'sessionStorage']) globalThis[name] = dom.window[name];
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { renderToString } = await import('react-dom/server');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const root = createRoot(document.getElementById('root'));
const SENTINEL = 'fake-only-setup-secret-canary-8580';
const path = '/api/account/admin/assistant';
let auth;
try {
    const api = await server.ssrLoadModule('/packages/portal-mojo/src/admin/assistant/setup.ts');
    const page = await server.ssrLoadModule('/packages/portal-mojo/src/admin/assistant/AssistantSetupPage.tsx');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
    auth = await server.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
    const core = await server.ssrLoadModule('/packages/portal-mojo/src/admin/core/index.ts');
    const menus = await server.ssrLoadModule('/packages/portal-mojo/src/ui/menu-registry.ts');
    const { ASSISTANT_ADMIN_SECTION: section } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/domains/assistant.ts');
    const loginWire = async (email) => (await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } })).data;
    const owner = await loginWire('assistant.owner@nativemojo.com');
    const wildcard = await loginWire('assistant.wildcard@nativemojo.com');
    const headers = { Authorization: `Bearer ${owner.access_token}` };
    const raw = (body, extra = {}) => mock.mockFetch(path, { method: 'POST', headers, body, ...extra });
    const fakeToken = (token, patch) => { const parts = token.split('.'); parts[1] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], 'base64url').toString()), ...patch })).toString('base64url'); return parts.join('.'); };
    assert.equal((await mock.mockFetch(path, {})).error_code, 401);
    assert.equal((await mock.mockFetch(path, { headers: { Authorization: `Bearer ${wildcard.access_token}` } })).error_code, 403);
    for (const kind of ['api_key', 'group_scoped_token']) assert.equal((await raw({ action: 'activate_policy' }, { headers: { Authorization: `Bearer ${fakeToken(owner.access_token, { credential_kind: kind })}` } })).error_code, 403);
    assert.equal((await raw({ action: 'activate_policy' }, { headers: { Authorization: `Bearer ${fakeToken(owner.access_token, { auth_time: 1 })}` } })).error_code, 440);
    assert.equal((await raw({ action: 'activate_policy' }, { headers: { ...headers, Origin: 'https://other.example.test' } })).error_code, 403);
    client.installAuthHooks({ async preRequest() {}, authHeader: () => headers.Authorization });
    mock.setMockAssistantSetupScenario('missing-key');
    let state = await api.getAssistantSetup();
    assert.equal(state.route.provider, ''); assert.match(api.assistantSetupReadiness(state), /unavailable/);
    assert(!api.assistantSetupReadiness(state).includes('Assistant key is missing'), 'Unknown route must not guess its missing credential');
    assert.equal(state.mcp.discovery.ok, null, 'Passive read does not probe discovery');
    const payload = api.assistantSetupSave(state, { api_key: SENTINEL });
    assert.deepEqual(Object.keys(payload).sort(), ['action', 'api_key', 'enabled', 'model']);
    const saved = await api.mutateAssistantSetup(payload); state = saved.state;
    assert.equal(state.enabled, false); assert.equal(state.key.source, 'admin'); assert.equal(state.verify.ok, true);
    assert(!JSON.stringify(saved).includes(SENTINEL));
    const storedCheck = state.verify.at;
    const checked = await api.mutateAssistantSetup({ action: 'verify', target: 'handler', api_key: SENTINEL });
    assert.equal(checked.result.ok, true); assert.equal(checked.state.handler_verify.at, '', 'Candidate check cannot update stored-key record'); assert.equal(checked.state.verify.at, storedCheck);
    const rejected = await api.mutateAssistantSetup({ action: 'verify', target: 'assistant', api_key: 'fake-reject-key' });
    assert.equal(api.assistantSetupCredentialRefusal(new Error('The api key was not accepted. Anthropic rejected this key.')), 'The Assistant key was rejected. Check the replacement and try again. Nothing was stored.');
    assert.equal(api.assistantSetupCredentialRefusal(new Error(SENTINEL)), null);
    assert.equal(rejected.result.ok, false, 'A successful envelope can contain a failed provider check');
    await assert.rejects(api.mutateAssistantSetup(api.assistantSetupSave(state, { api_key: 'fake-reject-key' })));
    for (const body of [
        { action: 'save', api_key: SENTINEL }, { action: 'save', enabled: true, model: '', api_key: SENTINEL, clear_api_key: true },
        { action: 'verify', target: 'platform' }, { action: 'verify', target: 'assistant', unknown: true },
        { action: 'activate_policy', policy: {} }, { action: 'reset_breaker', provider: 'other' },
        { action: 'historical_triage', before: '2026-10-19T00:00:00Z', limit: 101 }, { action: 'historical_triage', before: 'bad', limit: 1 },
        { action: 'revoke_grant', grant_id: true }, { action: 'revoke_all_grants', grant_id: 1 },
    ]) assert.equal((await raw(body)).status, false, `Exact server contract rejects ${body.action}`);
    assert.throws(() => api.validateAssistantSetupAction({ action: 'save', enabled: true, model: '', api_key: SENTINEL, clear_api_key: true }));
    assert.throws(() => api.validateAssistantSetupAction({ action: 'historical_triage', before: 'bad', limit: 0 }));
    assert.throws(() => api.validateAssistantSetupAction({ action: 'verify', target: 'assistant', unknown: true }));
    mock.setMockAssistantSetupScenario('handler'); state = await api.getAssistantSetup(); assert.equal(state.route.credential, 'handler');
    mock.setMockAssistantSetupScenario('bedrock'); state = await api.getAssistantSetup(); assert.equal(state.route.credential, 'aws'); assert.equal(state.route.model, 'us.amazon.nova-2-lite-v1:0');
    assert.match(api.assistantSetupReadiness({ ...state, realtime_installed: false }), /realtime application is not installed/);
    mock.setMockAssistantSetupScenario('static-stop'); state = await api.getAssistantSetup();
    state = (await api.mutateAssistantSetup(api.assistantSetupSave(state, { emergency_stop: false }))).state;
    assert.equal(state.emergency_stop_static, true); assert.equal(state.emergency_stop_database, false); assert.equal(state.emergency_stop, true);
    const activated = await api.mutateAssistantSetup({ action: 'activate_policy' }); assert.equal(activated.activated, true); assert.equal(activated.state.emergency_stop, true);
    const reset = await api.mutateAssistantSetup({ action: 'reset_breaker', provider: 'anthropic' }); assert.equal(reset.reset, 1); assert.equal(reset.state.emergency_stop, true);
    mock.setMockAssistantSetupScenario('deployment'); state = await api.getAssistantSetup();
    state = (await api.mutateAssistantSetup(api.assistantSetupSave(state, { api_key: SENTINEL }))).state;
    state = (await api.mutateAssistantSetup(api.assistantSetupSave(state, { clear_api_key: true }))).state; assert.equal(state.key.source, 'deployment');
    mock.setMockAssistantSetupScenario('discovery-failure'); state = await api.getAssistantSetup(); assert.equal(state.mcp.discovery.ok, null);
    state = await api.getAssistantSetup({}, 'discovery'); assert.equal(state.mcp.discovery.ok, false);
    mock.setMockAssistantSetupScenario('grants'); state = await api.getAssistantSetup(); assert.equal(state.mcp.grant_count, 202); assert.equal(state.mcp.grants.length, 2);
    state = (await api.mutateAssistantSetup(api.assistantSetupSave(state, { mcp_enabled: false }))).state; assert.equal(state.mcp.grant_count, 202);
    assert.equal((await api.mutateAssistantSetup({ action: 'revoke_grant', grant_id: 1 })).revoked, 1);
    assert.equal((await api.mutateAssistantSetup({ action: 'revoke_all_grants' })).revoked, 201);
    assert.equal((await api.mutateAssistantSetup({ action: 'historical_triage', before: '2026-10-19T00:00:00Z', limit: 2 })).queued, 2);
    const rawState = (await mock.mockFetch(path, { headers })).data;
    const bounded = api.projectAssistantSetup({ ...rawState, api_key: SENTINEL, mcp: { ...rawState.mcp, grants: Array(250).fill({ id: 1, raw_token: SENTINEL, client: { name: 'Demo', secret: SENTINEL } }) }, safety: { requests: Array(250).fill({ requests: 1, raw_body: SENTINEL }), breakers: Array(150).fill({ count: 1, secret: SENTINEL }) } });
    assert.equal(bounded.mcp.grants.length, 200); assert.equal(bounded.safety.requests.length, 200); assert.equal(bounded.safety.breakers.length, 100); assert(!JSON.stringify(bounded).includes(SENTINEL));

    // Navigation/menu/embedded landing proof and denial before lazy loading.
    for (const grouped of [true, false]) {
        const menu = core.adminSectionsMenu([section], { mount: '/system', grouped });
        const walk = (items) => items.flatMap((item) => [item, ...walk(item.children ?? [])]);
        const setup = walk(menu.items).find((item) => item.route === '/system/assistant/setup'); assert(setup);
        assert.equal(menus.itemVisible(setup, { me: wildcard.user, member: { permissions: { admin: true } }, group: null }), false);
        assert.equal(menus.itemVisible(setup, { me: { ...owner.user, is_superuser: 1 }, member: null, group: null }), false);
        assert.equal(menus.itemVisible(setup, { me: owner.user, member: null, group: null }), true);
    }
    let loads = 0;
    const ownedSection = { ...section, routes: [{ path: 'setup', requireSuperuser: true, loadComponent: async () => { loads++; return { default: () => null }; } }] };
    const route = core.adminSectionRoutes([ownedSection], { mount: '/system' }).find((route) => route.path === 'system/assistant/setup');
    qc.setQueryData(['me', null], wildcard.user);
    renderToString(React.createElement(QueryClientProvider, { client: qc }, route.element)); assert.equal(loads, 0);

    // Mounted lifecycle: real auth, real mock endpoint, Query and Mutation caches inspected.
    client.installAuthHooks(null);
    auth.initAuth();
    const signIn = async (email = 'assistant.owner@nativemojo.com') => React.act(async () => {
        await auth.login(email, 'mojo'); auth.stopAutoRefresh();
        const uid = auth.getAuthSnapshot().uid;
        const me = (await client.mojoCall('/api/user/me')).data;
        qc.setQueryData(['me', uid], me);
    });
    const settle = async (ms = 25) => React.act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
    const waitFor = async (predicate, message, timeout = 2500) => {
        const deadline = Date.now() + timeout;
        while (!predicate() && Date.now() < deadline) await settle();
        assert(predicate(), message);
    };
    const button = (label) => [...document.querySelectorAll('button')].find((element) => element.textContent.trim() === label);
    const ready = () => document.body.textContent.includes('Owner access required') || (document.getElementById('assistant-replacement-key') && !button('Refresh setup')?.disabled);
    const render = async (key = 0) => {
        await React.act(async () => root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(page.AssistantSetupPage, { key }))));
        await waitFor(ready, 'Setup finishes its initial read or renders owner denial');
    };
    const click = async (label, wait = true) => {
        const element = button(label); assert(element, `Missing button ${label}`); assert(!element.disabled, `Disabled button ${label}`);
        await React.act(async () => element.click());
        if (wait) await waitFor(ready, `Operation ${label} settles`);
    };
    const input = async (id, value) => { const element = document.getElementById(id); assert(element, `Missing input ${id}`); await React.act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); };
    const cacheSafe = () => {
        assert(!JSON.stringify(qc.getQueryCache().getAll().map((query) => query.state.data)).includes(SENTINEL));
        assert.equal(qc.getMutationCache().getAll().length, 0);
        assert(!JSON.stringify([Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])), Object.fromEntries(Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)])), mock.getMockRequestHistory()]).includes(SENTINEL));
    };
    await signIn('assistant.wildcard@nativemojo.com'); mock.clearMockRequestHistory(); await render();
    assert.match(document.body.textContent, /Owner access required/); assert.equal(mock.getMockRequestHistory().filter((row) => row.path === path).length, 0, 'Denied direct mount sends no setup read');
    await signIn(); mock.setMockAssistantSetupScenario('missing-key'); await render(1);
    assert.match(document.body.textContent, /model and key selection are unavailable/);
    await input('assistant-replacement-key', SENTINEL); cacheSafe();
    await click('Check and save key'); assert.equal(document.getElementById('assistant-replacement-key').value, ''); assert.match(document.body.textContent, /Configuration saved/); cacheSafe();
    await input('assistant-replacement-key', SENTINEL);
    await React.act(async () => { await auth.refreshTokens(); }); await settle();
    assert.equal(document.getElementById('assistant-replacement-key').value, SENTINEL, 'Same-tab token renewal preserves draft');
    await React.act(async () => window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'access_token', newValue: auth.getAccessToken() }))); await waitFor(ready, 'Cross-tab replacement reload finishes');
    assert.equal(document.getElementById('assistant-replacement-key').value, '', 'Cross-tab auth change conservatively clears draft');
    await input('assistant-replacement-key', SENTINEL);
    await React.act(async () => auth.setTokens(auth.getAccessToken(), auth.getRefreshToken())); await waitFor(ready, 'Replacement session reload finishes');
    assert.equal(document.getElementById('assistant-replacement-key').value, '', 'Explicit same-person replacement clears draft');
    await input('assistant-replacement-key', SENTINEL); await React.act(async () => root.render(null)); await render(2);
    assert.equal(document.getElementById('assistant-replacement-key').value, '', 'Leaving setup destroys drafts');
    mock.setMockAssistantSetupScenario('handler'); await render(3); await click('Open Platform credential');
    assert.equal(document.querySelector('details').open, true); assert.equal(document.activeElement.textContent, 'Platform credential');
    await input('handler-replacement-key', SENTINEL); await click('Check and save Platform key'); assert.equal(document.getElementById('handler-replacement-key').value, '');
    mock.setMockAssistantSetupScenario('rejected-key'); await render(4); await click('Check current key'); assert.match(document.body.textContent, /Anthropic rejected this key/);
    await input('assistant-replacement-key', SENTINEL); await click('Check and save key'); assert.match(document.body.textContent, /rejected|could not be confirmed/); cacheSafe();
    mock.setMockAssistantSetupScenario('ready'); await render(5);
    await input('assistant-replacement-key', SENTINEL); await click('Acknowledge deployed policy', false);
    assert(button('Confirm operation')); assert.equal(document.activeElement.textContent, 'Cancel');
    await click('Cancel', false); assert(!button('Confirm operation')); assert.equal(document.getElementById('assistant-replacement-key').value, SENTINEL);
    await click('Acknowledge deployed policy', false); const postCount = () => mock.getMockRequestHistory().filter((row) => row.path === path && row.method === 'POST').length;
    const countBeforeRevoke = postCount();
    await React.act(async () => qc.setQueryData(['me', auth.getAuthSnapshot().uid], { ...owner.user, is_superuser: false })); await settle();
    assert(!button('Confirm operation')); assert(!document.querySelector('input[type=password]')); assert.equal(postCount(), countBeforeRevoke, 'Revocation while confirming sends no action');
    await signIn(); await render(6);
    let releaseAuth; auth.setFreshAuthHandler(() => new Promise((resolve) => { releaseAuth = resolve; }));
    await input('assistant-replacement-key', SENTINEL); mock.armMockReauth('POST', path); await click('Check and save key', false);
    await waitFor(() => typeof releaseAuth === 'function', '440 opens the registered fresh-auth UI');
    assert.equal(document.getElementById('assistant-replacement-key').value, '', '440 clears draft before fresh-auth UI'); assert.match(document.body.textContent, /re-enter any key/);
    const challengedCount = postCount(); await React.act(async () => qc.setQueryData(['me', auth.getAuthSnapshot().uid], { ...owner.user, is_superuser: false })); await React.act(async () => releaseAuth(true)); await settle();
    assert.equal(postCount(), challengedCount, 'Fresh-auth completion cannot replay old credentials after revocation');
    await signIn(); mock.setMockAssistantSetupScenario('ready'); await render(7); await input('assistant-replacement-key', SENTINEL);
    mock.armMockResponseOnce('POST', path, { extraDelayMs: 450 }); await click('Check and save key', false);
    let written; await React.act(async () => { written = await api.getAssistantSetup(); });
    assert.equal(written.verify.ok, true, 'Server processed the credential before the delayed response is released');
    assert(button('Refresh setup').disabled, 'Credential response remains deferred');
    await React.act(async () => auth.logout()); await settle(750);
    assert.match(document.body.textContent, /Owner access required/); assert(!document.querySelector('input[type=password]')); assert(!document.body.textContent.includes('Configuration saved')); cacheSafe();
    // A held auth preflight must recheck owner and session immediately before transmission.
    await signIn(); await render(8); await input('assistant-replacement-key', SENTINEL);
    let releaseGate; let gateCount = 0; client.installAuthHooks({ preRequest: () => gateCount++ === 0 ? new Promise((resolve) => { releaseGate = resolve; }) : Promise.resolve(), authHeader: () => `Bearer ${auth.getAccessToken()}` });
    const beforeGate = postCount(); await click('Check and save key', false);
    await React.act(async () => auth.setTokens(auth.getAccessToken(), auth.getRefreshToken()));
    await React.act(async () => releaseGate()); await waitFor(ready, 'Replacement read finishes after the stale preflight is released'); assert.equal(postCount(), beforeGate, 'Session replacement during auth wait cannot transmit the old draft');
    cacheSafe();
    const [source, release] = await Promise.all([readFile('packages/portal-mojo/src/admin/assistant/AssistantSetupPage.tsx', 'utf8'), readFile('package.json', 'utf8')]);
    assert.doesNotMatch(source, /withFreshAuth|useMutation|useQuery\(|defineModel|localStorage|sessionStorage|console\./);
    assert(JSON.parse(release).scripts['verify:release'].includes('verify:admin-assistant-setup'));
    console.log('Assistant setup: exact schema/actions, owner gates, safe projections, route truth, static stops, credential provenance, bounded connections, and mounted session/confirmation/fresh-auth/transport/cache lifecycle passed.');
} finally {
    await React.act(async () => root.unmount());
    auth?.stopAutoRefresh(); auth?.setFreshAuthHandler(null); qc.clear(); await server.close(); dom.window.close();
}
