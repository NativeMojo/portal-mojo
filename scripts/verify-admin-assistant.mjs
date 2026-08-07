import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
    const [app, apiSource, panelSource, feedSource, launcherSource] = await Promise.all([
        readFile(new URL('../apps/portal/src/App.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/admin/assistant/api.ts', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/admin/assistant/AssistantPanel.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/admin/assistant/AssistantFeed.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/admin/assistant/launchers.tsx', import.meta.url), 'utf8'),
    ]);
    assert.equal((app.match(/<RightPanelProvider>/g) ?? []).length, 1);
    assert.equal((app.match(/<RightPanelSlot/g) ?? []).length, 1);
    assert.match(app, /app-right-panel-open/);
    assert.doesNotMatch(`${apiSource}\n${panelSource}\n${feedSource}`, /defineModel|ModelTable|create.*Adapter|useQuery|useMutation|WebSocket|EventSource|setInterval|localStorage|sessionStorage/);
    assert.match(feedSource, /items=\{items\}/);
    assert.match(panelSource, /conversation\.user\.id === me\.id/);
    assert.match(launcherSource, /incident\.Incident.*incident\.Ticket/);
    assert.match(launcherSource, /SECURITY_VIEW_PERMS/);

    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const data = await server.ssrLoadModule('/packages/portal-mojo/src/admin/assistant/data.ts');
    const me = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    assert.deepEqual(admin.ASSISTANT_PERMISSIONS, ['sys.view_admin', 'sys.assistant']);
    assert.deepEqual(admin.ASSISTANT_ADMIN_SECTION.routes.map((route) => route.path), ['conversations', 'skills', 'memories']);
    assert(admin.ADMIN_SECTIONS.includes(admin.ASSISTANT_ADMIN_SECTION));
    assert.equal(me.hasPermission({ id: 42, permissions: {} }, 'sys.assistant', { permissions: { assistant: true } }), false, 'group Assistant grants must not light the global surface');
    assert.equal(data.projectBlocks([{ type: 'file', filename: 'bad', url: 'javascript:bad' }, { type: 'progress', title: 'hidden' }]).length, 1, 'schema accepts file shape; URL policy is a separate render boundary and progress must drop');
    assert.deepEqual(data.projectBlocks([{ type: 'context', references: [{ model: 'account.User', pk: 1 }] }]), []);

    const login = async (email) => { const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } }); return { Authorization: `Bearer ${response.data.access_token}` }; };
    const operator = await login('showcase.operator@nativemojo.com');
    const manager = await login('assistant.manager@nativemojo.com');
    const memberOnly = await login('assistant.member@nativemojo.com');
    const groupDenied = await mock.mockFetch('/api/assistant', { method: 'POST', headers: memberOnly, body: { message: 'hello' } });
    assert.equal(groupDenied.error_code, 403);

    const created = await mock.mockFetch('/api/assistant', { method: 'POST', headers: operator, body: { message: 'export a file' } });
    assert.deepEqual(Object.keys(created.data).sort(), ['blocks', 'conversation_id', 'duration_ms', 'response', 'tool_calls_made']);
    const detail = await mock.mockFetch(`/api/assistant/conversation/${created.data.conversation_id}`, { headers: operator, params: { graph: 'detail' } });
    assert.equal(detail.data.group, undefined);
    assert.equal(detail.data.messages.at(-1).role, 'assistant');
    const foreign = await mock.mockFetch(`/api/assistant/conversation/${created.data.conversation_id}`, { headers: manager, params: { graph: 'detail' } });
    assert.equal(foreign.status, true);
    const foreignContinuation = await mock.mockFetch('/api/assistant', { method: 'POST', headers: manager, body: { message: 'continue', conversation_id: created.data.conversation_id } });
    assert.equal(foreignContinuation.error_code, 404);

    const contextOne = await mock.mockFetch('/api/assistant/context', { method: 'POST', headers: manager, body: { model: 'incident.Incident', pk: 601 } });
    const contextTwo = await mock.mockFetch('/api/assistant/context', { method: 'POST', headers: manager, body: { model: 'incident.Incident', pk: 601 } });
    assert.equal(contextTwo.data.conversation_id, contextOne.data.conversation_id);
    assert.equal(contextTwo.data.existing, true);
    const contextDetail = await mock.mockFetch(`/api/assistant/conversation/${contextOne.data.conversation_id}`, { headers: manager, params: { graph: 'detail' } });
    assert.equal(contextDetail.data.metadata.context_model, 'incident.Incident');

    const memory = await mock.mockFetch('/api/assistant/memory/group', { method: 'POST', headers: operator, params: { group: 1 }, body: { key: 'runbook:owner', value: 'Security' } });
    assert.equal(memory.status, true);
    const bodyGroup = await mock.mockFetch('/api/assistant/memory/group', { method: 'POST', headers: operator, params: { group: 1 }, body: { key: 'bad', value: 'bad', group: 1 } });
    assert.equal(bodyGroup.error_code, 400);
    const readMemory = await mock.mockFetch('/api/assistant/memory/group', { headers: operator, params: { group: 1 } });
    assert.equal(readMemory.data['runbook:owner'], 'Security');
    const deleted = await mock.mockFetch(`/api/assistant/conversation/${created.data.conversation_id}`, { method: 'DELETE', headers: operator });
    assert.equal(deleted.status, 'deleted');
    console.log('admin assistant contract verified');
} finally { await server.close(); }
