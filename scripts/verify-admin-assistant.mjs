import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = {
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    location: { origin: 'https://portal.example.test', hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout, clearTimeout,
};
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
    const [portalRoot, showcaseRoot, apiSource, panelSource, feedSource, streamingSource, launcherSource] = await Promise.all([
        readFile(new URL('../apps/portal/src/main.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../apps/showcase/src/main.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/admin/assistant/api.ts', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/admin/assistant/AssistantPanel.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/admin/assistant/AssistantFeed.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/admin/assistant/streaming.ts', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/admin/assistant/launchers.tsx', import.meta.url), 'utf8'),
    ]);
    assert.equal((portalRoot.match(/<mojo\.RealtimeProvider>/g) ?? []).length, 1);
    assert.equal((showcaseRoot.match(/<mojo\.RealtimeProvider/g) ?? []).length, 1);
    assert.doesNotMatch(`${apiSource}\n${panelSource}\n${feedSource}`, /defineModel|ModelTable|create.*Adapter|useQuery|useMutation|EventSource|setInterval/);
    assert.match(panelSource, /chooseAssistantTransport/);
    assert.match(panelSource, /conversation\.user\.id === me\.id/);
    assert.match(panelSource, /!canViewAdmin && stream\.current/);
    assert.match(streamingSource, /Outcome unknown/);
    assert.match(streamingSource, /listAssistantConversations/);
    assert.match(streamingSource, /getAssistantConversation/);
    assert.doesNotMatch(streamingSource, /invalidateQueries|queryClient|tool_input/);
    assert.match(launcherSource, /incident\.Incident.*incident\.Ticket/);
    assert.match(launcherSource, /SECURITY_VIEW_PERMS/);

    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const data = await server.ssrLoadModule('/packages/portal-mojo/src/admin/assistant/data.ts');
    const streaming = await server.ssrLoadModule('/packages/portal-mojo/src/admin/assistant/streaming.ts');
    const realtime = await server.ssrLoadModule('/packages/portal-mojo/src/client/realtime.ts');
    const realtimeMock = await server.ssrLoadModule('/packages/portal-mojo/src/client/realtime-mock.ts');
    const me = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');

    assert.deepEqual(admin.ASSISTANT_PERMISSIONS, ['sys.view_admin', 'sys.assistant']);
    assert.deepEqual(admin.ASSISTANT_ADMIN_SECTION.routes.map((route) => route.path), ['conversations', 'skills', 'memories']);
    assert(admin.ADMIN_SECTIONS.includes(admin.ASSISTANT_ADMIN_SECTION));
    assert.equal(me.hasPermission({ id: 42, permissions: {} }, 'sys.assistant', { permissions: { assistant: true } }), false);

    // Selection is positive and narrow: owned + text-only + view_admin + ready.
    assert.equal(streaming.chooseAssistantTransport({ owner: true, textOnly: true, hasViewAdmin: true, realtimeStatus: 'ready' }), 'websocket');
    assert.equal(streaming.chooseAssistantTransport({ owner: true, textOnly: false, hasViewAdmin: true, realtimeStatus: 'ready' }), 'rest');
    assert.equal(streaming.chooseAssistantTransport({ owner: true, textOnly: true, hasViewAdmin: false, realtimeStatus: 'ready' }), 'rest');
    assert.equal(streaming.chooseAssistantTransport({ owner: true, textOnly: true, hasViewAdmin: true, realtimeStatus: 'backoff' }), 'rest');
    assert.equal(streaming.chooseAssistantTransport({ owner: false, textOnly: true, hasViewAdmin: true, realtimeStatus: 'ready' }), 'inspect');

    // Exact positive projectors sanitize raw tool inputs and terminal tool lists.
    assert.deepEqual(streaming.projectAssistantThinking({ type: 'assistant_thinking', conversation_id: 41 }), { type: 'thinking', conversationId: 41 });
    assert.deepEqual(streaming.projectAssistantText({ type: 'assistant_text', conversation_id: 41, text: 'checking', blocks: [{ type: 'alert', level: 'info', message: 'safe' }] }), { type: 'text', conversationId: 41, text: 'checking', blocks: [{ type: 'alert', level: 'info', title: undefined, message: 'safe' }] });
    const tool = streaming.projectAssistantToolCall({ type: 'assistant_tool_call', conversation_id: 41, tool: 'query_users', input: { password: 'private' } });
    assert.deepEqual(tool, { type: 'tool', conversationId: 41, name: 'query_users', status: 'running', count: 1 });
    assert.equal(JSON.stringify(tool).includes('private'), false);
    const plan = streaming.projectAssistantPlan({ type: 'assistant_plan', conversation_id: 41, plan: { plan_id: 'p1', title: 'Plan', steps: [{ id: 1, description: 'Inspect', status: 'pending', tool: 'secret_tool', tool_input: { secret: true } }] } });
    assert.deepEqual(plan.steps, [{ id: 1, description: 'Inspect', status: 'pending' }]);
    assert.deepEqual(streaming.projectAssistantPlanUpdate({ type: 'assistant_plan_update', conversation_id: 41, plan_id: 'p1', step_id: 1, status: 'done', summary: 'Complete' }), { type: 'plan_update', conversationId: 41, planId: 'p1', stepId: 1, status: 'done', summary: 'Complete' });
    const response = streaming.projectAssistantResponse({ type: 'assistant_response', conversation_id: 41, message_id: 91, created: 123, response: 'done', tool_calls_made: [{ tool: 'one', input: { secret: 1 } }, { tool: 'two', input: { secret: 2 } }], blocks: [] });
    assert.equal(response.toolCount, 2);
    assert.equal(JSON.stringify(response).includes('tool_calls_made'), false);
    assert.equal(streaming.projectAssistantResponse({ type: 'assistant_text', conversation_id: 41, response: 'wrong type' }), null);
    assert.deepEqual(streaming.projectAssistantError({ type: 'assistant_error', conversation_id: 41, error: 'failed' }), { type: 'error', conversationId: 41, error: 'failed' });
    assert.equal(data.projectReply({ conversation_id: 2, response: 'ok', tool_calls_made: [{ input: 'private' }] }).tool_calls_made, 1);

    const readyClient = () => {
        const wire = realtimeMock.createRealtimeMock({ autoOpen: false, autoAssistant: false });
        const client = new realtime.RealtimeClient({ socketFactory: wire.factory });
        client.connect('private-token'); wire.open(1); wire.authRequired(1);
        assert.equal(client.getStatus().status, 'ready');
        return { client, wire };
    };
    const callbacks = (overrides = {}) => ({ onConversation() {}, onText() {}, onProgress() {}, onResponse() {}, onReconcile() {}, onUnknown() {}, ...overrides });

    // Correlation, direct path, and authoritative terminal dedupe.
    {
        const { client, wire } = readyClient(); const received = []; const seen = new Set();
        const turn = streaming.startAssistantRealtimeTurn(client, { message: 'hello', conversationId: 41, seenMessageIds: seen }, callbacks({ onResponse: (message) => received.push(message) }));
        wire.direct({ type: 'assistant_response', conversation_id: 99, message_id: 1, response: 'wrong', blocks: [] }, 1);
        assert.equal(received.length, 0);
        wire.direct({ type: 'assistant_response', conversation_id: 41, message_id: 501, created: 123, response: 'right', blocks: [], tool_calls_made: [{ input: 'private' }] }, 1);
        await turn.promise;
        wire.direct({ type: 'assistant_response', conversation_id: 41, message_id: 501, response: 'duplicate', blocks: [] }, 1);
        assert.deepEqual(received.map((message) => [message.id, message.content]), [[501, 'right']]);
        assert(seen.has(501));
    }

    // Wrapped application path projects once (no double unwrap).
    {
        const { client, wire } = readyClient(); const received = [];
        const turn = streaming.startAssistantRealtimeTurn(client, { message: 'wrapped', conversationId: 42, seenMessageIds: new Set() }, callbacks({ onResponse: (message) => received.push(message) }));
        wire.wrapped({ type: 'assistant_response', conversation_id: 42, message_id: 502, response: 'wrapped response', blocks: [] }, undefined, 1);
        await turn.promise;
        assert.deepEqual(received.map((message) => message.content), ['wrapped response']);
    }

    // Known-conversation disconnect waits for reauth, then REST-detail reconcile.
    {
        const { client, wire } = readyClient(); let reconciled = null;
        const authoritative = { id: 43, title: 'Known', created: 1, modified: 2, user: { id: 14, display_name: 'Operator' }, messages: [{ id: 700, role: 'assistant', content: 'authoritative', created: 2, blocks: [] }] };
        const turn = streaming.startAssistantRealtimeTurn(client, { message: 'known', conversationId: 43, seenMessageIds: new Set(), reconcile: async () => authoritative }, callbacks({ onReconcile: (value) => { reconciled = value; } }));
        wire.sockets[0].close(1006, 'network');
        assert.equal(reconciled, null);
        client.setToken('rotated-token'); wire.open(2); wire.authRequired(2);
        await turn.promise;
        assert.equal(reconciled, authoritative);
    }

    // First-send disconnect before conversation_id is explicitly unknown and never resent.
    {
        const { client, wire } = readyClient(); let unknown = 0; let refreshes = 0;
        const turn = streaming.startAssistantRealtimeTurn(client, { message: 'first send', seenMessageIds: new Set(), refreshList: async () => { refreshes += 1; } }, callbacks({ onUnknown: () => { unknown += 1; } }));
        wire.sockets[0].close(1006, 'network');
        await assert.rejects(turn.promise, streaming.AssistantOutcomeUnknownError);
        await Promise.resolve();
        assert.equal(unknown, 1); assert.equal(refreshes, 1);
        assert.equal(wire.observations.filter((entry) => entry.kind === 'assistant').length, 1, 'unknown outcome must never auto-resend');
    }

    // Retain the exact REST contract and permission/ownership fallback evidence.
    const login = async (email) => { const value = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } }); return { Authorization: `Bearer ${value.data.access_token}` }; };
    const operator = await login('showcase.operator@nativemojo.com');
    const manager = await login('assistant.manager@nativemojo.com');
    const assistantOnly = await login('assistant.operator@nativemojo.com');
    const memberOnly = await login('assistant.member@nativemojo.com');
    assert.equal((await mock.mockFetch('/api/assistant', { method: 'POST', headers: memberOnly, body: { message: 'hello' } })).error_code, 403);
    assert.equal((await mock.mockFetch('/api/assistant', { method: 'POST', headers: assistantOnly, body: { message: 'REST fallback' } })).status, true, 'sys.assistant-only remains REST-capable');
    const created = await mock.mockFetch('/api/assistant', { method: 'POST', headers: operator, body: { message: 'export a file' } });
    assert.deepEqual(Object.keys(created.data).sort(), ['blocks', 'conversation_id', 'duration_ms', 'response', 'tool_calls_made']);
    const foreignContinuation = await mock.mockFetch('/api/assistant', { method: 'POST', headers: manager, body: { message: 'continue', conversation_id: created.data.conversation_id } });
    assert.equal(foreignContinuation.error_code, 404);

    const portalCss = await readFile(new URL('../apps/portal/src/theme/admin-assistant.css', import.meta.url), 'utf8');
    const showcaseCss = await readFile(new URL('../apps/showcase/src/theme/admin-assistant.css', import.meta.url), 'utf8');
    assert.equal(showcaseCss, portalCss, 'Assistant theme copies must remain byte-identical');
    console.log('admin assistant behavioral contract verified');
} finally {
    await server.close();
}
