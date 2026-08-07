import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

try {
    const [incidentPage, eventPage, incidentDetail] = await Promise.all([
        readFile(new URL('../packages/portal-mojo/src/admin/incidents/IncidentsPage.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/admin/incidents/EventsPage.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/admin/incidents/IncidentDetail.tsx', import.meta.url), 'utf8'),
    ]);
    assert.match(incidentPage, /showIncidentDetail\(row\.id\)/);
    assert.match(eventPage, /showEventDetail\(row\.id\)/);
    assert.doesNotMatch(`${incidentPage}\n${eventPage}`, /useRightPanel|RightPanelSlot|RightPanelProvider/);
    assert.match(incidentDetail, /AssistantContextLauncher model="incident\.Incident"/);

    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const incidents = await server.ssrLoadModule('/packages/portal-mojo/src/admin/incidents/models.ts');
    const sanitize = await server.ssrLoadModule('/packages/portal-mojo/src/admin/incidents/sanitize.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');

    assert.deepEqual(admin.SECURITY_VIEW_PERMS, ['sys.view_security', 'sys.security']);
    assert.deepEqual(admin.SECURITY_MANAGE_PERMS, ['sys.manage_security', 'sys.security']);
    assert.deepEqual(admin.SECURITY_DELETE_PERMS, ['sys.manage_security']);
    assert.deepEqual(admin.SECURITY_OPERATIONS_ADMIN_SECTION.routes.map((route) => route.path), ['tickets', 'incidents', 'events', 'rules']);
    assert(admin.adminSectionRoutes([admin.SECURITY_OPERATIONS_ADMIN_SECTION], { mount: '/system' }).some((route) => route.path === 'system/security/incidents'));

    const normalized = incidents.normalizeIncidentListParams({ graph: 'detailed', download_format: 'json', filename: 'leak', mode: 'raw', status: 'new', priority__gte: 5, start: 0, size: 25 });
    assert.deepEqual(normalized, { graph: 'default', status: 'new', priority__gte: 5, start: 0, size: 25, sort: '-id' });
    assert.equal(incidents.normalizeEventListParams({ sort: '-level', category__not: 'ossec' }).sort, '-created');
    assert.deepEqual(incidents.buildIncidentMerge([{ id: 1 }, { id: 2 }, { id: 3 }], 2).sourceIds, [1, 3]);
    assert.throws(() => incidents.buildIncidentMerge([{ id: 1 }], 1));

    const source = { authorization: 'Bearer abcdefghijklmnop', nested: { password: 'sentinel-password', ok: 'keep' }, url: 'https://example.test/?token=sentinel-query', trace: 'token sentinel-trace-secret' };
    const safe = sanitize.sanitizeSecurityValue(source);
    assert.equal(source.nested.password, 'sentinel-password', 'sanitizer must not mutate input');
    assert.equal(safe.authorization, '[redacted]');
    assert.equal(safe.nested.password, '[redacted]');
    assert(!JSON.stringify(safe).includes('sentinel'));
    assert.match(sanitize.boundedSecurityText('x'.repeat(40000), 100), /truncated/);
    // Best-effort boundary: an unlabeled opaque value is intentionally not
    // claimed as detectable, which is why raw metadata is never projected.
    assert.equal(sanitize.sanitizeSecurityText('opaque-value-123456789'), 'opaque-value-123456789');

    const login = async (email) => {
        const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } });
        return { Authorization: `Bearer ${response.data.access_token}` };
    };
    const manager = await login('security.manager@nativemojo.com');
    const viewer = await login('security.viewer@nativemojo.com');

    const titleMiss = await mock.mockFetch('/api/incident/incident', { headers: manager, params: { search: 'Account review requested' } });
    assert.equal(titleMiss.count, 0, 'incident search is details-only');
    const detailHit = await mock.mockFetch('/api/incident/incident', { headers: manager, params: { search: 'Automated monitor' } });
    assert.equal(detailHit.count, 1);
    const bouncer = await mock.mockFetch('/api/incident/incident', { headers: manager, params: { category__startswith: 'security:bouncer', search: 'muid-bot-003' } });
    assert.equal(bouncer.count, 1);
    const ranges = await mock.mockFetch('/api/incident/event', { headers: manager, params: { category__not: 'ossec', level__gt: 4, level__lt: 9 } });
    assert(ranges.data.every((row) => row.category !== 'ossec' && row.level > 4 && row.level < 9));

    const deniedSave = await mock.mockFetch('/api/incident/incident/601', { method: 'POST', headers: viewer, body: { status: 'open' } });
    assert.equal(deniedSave.error_code, 403);
    const saved = await mock.mockFetch('/api/incident/incident/601', { method: 'POST', headers: manager, body: { status: 'investigating', metadata: { do_not_delete: true } } });
    assert.equal(saved.data.status, 'investigating');
    const history = await mock.mockFetch('/api/incident/incident/history', { headers: manager, params: { parent: 601, size: 100 } });
    assert(history.data.some((row) => row.metadata?.new_status === 'investigating'));
    const deniedNote = await mock.mockFetch('/api/incident/incident/history', { method: 'POST', headers: viewer, body: { parent: 601, note: 'nope' } });
    assert.equal(deniedNote.error_code, 403);

    const sourceEventsBefore = await mock.mockFetch('/api/incident/event', { headers: manager, params: { incident: 603, size: 100 } });
    assert(sourceEventsBefore.count > 0);
    const secretFixture = (await mock.mockFetch('/api/incident/incident/603', { headers: manager, params: { graph: 'detailed' } })).data;
    assert(JSON.stringify(secretFixture).includes('sentinel'));
    assert(!JSON.stringify(sanitize.sanitizeIncidentRow(secretFixture)).includes('sentinel'));
    const merge = await mock.mockFetch('/api/incident/incident/601', { method: 'POST', headers: manager, body: { merge: [603] } });
    assert.equal(merge.status, true);
    const deletedSource = await mock.mockFetch('/api/incident/incident/603', { headers: manager });
    assert.equal(deletedSource.error_code, 404);
    const movedEvents = await mock.mockFetch('/api/incident/event', { headers: manager, params: { incident: 601, size: 100 } });
    assert(movedEvents.count >= sourceEventsBefore.count);
    const mergeHistory = await mock.mockFetch('/api/incident/incident/history', { headers: manager, params: { parent: 601, size: 100 } });
    assert(mergeHistory.data.some((row) => row.kind === 'merged'));
    const eventDelete = await mock.mockFetch(`/api/incident/event/${movedEvents.data[0].id}`, { method: 'DELETE', headers: manager });
    assert.equal(eventDelete.error_code, 403);
    assert.match(await readFile(new URL('../packages/portal-mojo/src/admin/dashboard/AdminDashboardPage.tsx', import.meta.url), 'utf8'), /\/security\/incidents\?status=open/);

    console.log('admin incident/event contract verified');
} finally {
    await server.close();
}
