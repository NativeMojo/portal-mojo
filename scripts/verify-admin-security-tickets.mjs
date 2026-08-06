import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

try {
    const ticketPage = await readFile(new URL('../packages/portal-mojo/src/admin/security/tickets.tsx', import.meta.url), 'utf8');
    assert.match(ticketPage, /modal\.detail\([\s\S]*<TicketDetail/, 'ticket rows must open the KISS detail modal');
    assert.match(ticketPage, /<DetailView/, 'ticket detail must use the standard DetailView chrome');
    assert.doesNotMatch(ticketPage, /useRightPanel|TicketPanel|ticket-panel-/, 'ticket detail must not retain RightPanel wiring');

    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const menus = await server.ssrLoadModule('/packages/portal-mojo/src/ui/menu-registry.ts');
    const models = await server.ssrLoadModule('/packages/portal-mojo/src/admin/security/models.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');

    const section = admin.SECURITY_OPERATIONS_ADMIN_SECTION;
    assert.equal(section.basePath, 'security');
    assert.deepEqual(section.permissions, ['sys.view_security', 'sys.security']);
    assert.equal(section.routes[0].path, 'tickets');
    assert.deepEqual(section.routes[0].permissions, ['sys.view_security', 'sys.security']);
    const generated = admin.adminSectionRoutes([section], { mount: '/system' });
    assert(generated.some((route) => route.path === 'system/security/tickets'));

    const menu = admin.adminSectionsMenu([section], { mount: '/system', grouped: true });
    const item = menu.items.find((entry) => entry.id === 'admin:security')?.children?.[0];
    assert(item);
    const context = (permissions, memberPermissions = {}) => ({
        me: { id: 12, permissions }, member: { permissions: memberPermissions }, group: { id: 1 },
    });
    assert.equal(menus.itemVisible(item, context({ view_security: true })), true);
    assert.equal(menus.itemVisible(item, context({}, { view_security: true })), false,
        'sys.* clauses must fail closed against active-group grants');

    assert.deepEqual(models.knownOptionsWithCurrent(['new', 'open'], 'vendor_state'), ['new', 'open', 'vendor_state']);
    const trustedContext = { target: 'fp-headless', nested: { keep: true } };
    const responseBody = models.buildTicketActionResponseBody(504, 1, {
        handler: 'incident.rule_approval', context: trustedContext,
    }, 'approve');
    assert.strictEqual(responseBody.metadata.action_response.context, trustedContext,
        'approval context must pass through without reconstruction');
    assert.equal(models.isTicketActionDisabled({ resolved: true }, 'open', true, false), true);
    assert.equal(models.isTicketActionDisabled({ resolved: false }, 'resolved', true, false), true);
    assert.equal(models.isTicketActionDisabled({ resolved: false }, 'open', true, false), false);
    assert.equal(models.TicketModel.endpoint, '/api/incident/ticket');
    assert.deepEqual(models.TicketModel.permissions.view, ['sys.view_security', 'sys.security']);
    assert.deepEqual(models.TicketModel.permissions.manage, ['sys.manage_security', 'sys.security']);
    assert.equal(models.MaestroItemLinkModel.endpoint, '/api/incident/maestro/item-link');
    assert.deepEqual(Object.keys(models.TicketModel.actions).sort(), ['disable_llm', 'enable_llm', 'push_to_maestro']);
    assert.deepEqual(models.TicketModel.keys.root, ['/api/incident/ticket']);

    const login = await mock.mockFetch('/api/login', {
        method: 'POST', body: { username: 'security.manager@nativemojo.com', password: 'mojo' },
    });
    assert.equal(login.status, true);
    const headers = { Authorization: `Bearer ${login.data.access_token}` };
    const list = await mock.mockFetch('/api/incident/ticket', { headers, params: { status__in: 'new,open', sort: '-priority' } });
    assert.equal(list.status, true);
    assert(list.data.length > 0);
    assert(list.data.every((row) => ['new', 'open'].includes(row.status)));
    assert.equal(typeof list.data[0].created, 'number');

    const detail = await mock.mockFetch('/api/incident/ticket/504', { headers });
    assert.equal(detail.data.id, 504);
    assert.equal(detail.data.assignee.id, 12);
    const saved = await mock.mockFetch('/api/incident/ticket/504', { method: 'POST', headers, body: { status: 'pending' } });
    assert.equal(saved.data.status, 'pending');
    const notes = await mock.mockFetch('/api/incident/ticket/note', { headers, params: { parent: 504, group: 1, size: 100 } });
    assert(notes.data.some((note) => note.metadata?.type === 'status_change' && note.metadata?.new_status === 'pending'));
    const actionNote = notes.data.find((note) => note.metadata?.action?.resolved === false);
    assert(actionNote);
    const action = actionNote.metadata.action;
    const response = await mock.mockFetch('/api/incident/ticket/note', {
        method: 'POST', headers,
        body: models.buildTicketActionResponseBody(504, 1, action, 'approve'),
    });
    assert.equal(response.status, true);
    const resolved = await mock.mockFetch('/api/incident/ticket/504', { headers });
    assert.equal(resolved.data.status, 'resolved');

    const queued = await mock.mockFetch('/api/incident/ticket/503', { method: 'POST', headers, body: { push_to_maestro: {} } });
    assert.equal(queued.status, true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const links = await mock.mockFetch('/api/incident/maestro/item-link', { headers, params: { ticket: 503, size: 1 } });
    assert.equal(links.count, 1);
    assert.equal(links.data[0].ticket.id, 503);
    assert.match(links.data[0].remote_url, /^https:/);

    console.log('admin security ticket contract verified');
} finally {
    await server.close();
}
