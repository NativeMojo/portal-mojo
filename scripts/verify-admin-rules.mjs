import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { addEventListener() {}, removeEventListener() {}, confirm: () => true, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

try {
    const dsl = await server.ssrLoadModule('/packages/portal-mojo/src/admin/rules/handler-dsl.ts');
    const models = await server.ssrLoadModule('/packages/portal-mojo/src/admin/rules/models.ts');
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    assert.equal(dsl.serializeHandlerChain(dsl.parseHandlerChain('')), '');
    const every = 'job://app.jobs.run?x=1,email://alice,sms://bob,notify://perm@security,block://?ttl=0,ticket://?priority=9,maestro://?board=47,llm://,resolve://?status=closed';
    assert.equal(dsl.serializeHandlerChain(dsl.parseHandlerChain(every)), every);
    assert.equal(dsl.parseHandlerChain('notify://perm@security,alice,block://?ttl=3').steps.length, 2);
    const legacy = dsl.parseHandlerChain('block://?ttl=1,custom://x, notify://alice,resolve://?status=resolved');
    assert.deepEqual(legacy.steps.map((step) => step.runtime), ['effective', 'swallowed', 'swallowed', 'effective']);
    assert.deepEqual(dsl.runtimeEffectiveHandlerChain(legacy), ['block://?ttl=1,custom://x, notify://alice', 'resolve://?status=resolved']);
    assert.throws(() => dsl.moveHandlerStep(legacy, 1, 0));
    assert.equal(dsl.moveHandlerStep(legacy, 1, 0, { confirmBehaviorChange: true }).steps[0].scheme, 'custom');
    assert.throws(() => dsl.moveHandlerStep(dsl.parseHandlerChain(' notify://alice,block://?ttl=1'), 0, 1), /changes which specs/);
    assert.throws(() => dsl.removeHandlerStep(legacy, 1));
    const duplicates = dsl.parseHandlerChain('ticket://?priority=9&priority=2&future=keep');
    const edited = dsl.updateHandlerStep(duplicates, 0, { param: { key: 'priority', value: '7' } });
    assert.equal(dsl.serializeHandlerChain(edited), 'ticket://?priority=7&priority=2&future=keep');
    assert(dsl.validateHandlerChain(duplicates).some((issue) => issue.message.includes('first value')));
    assert(dsl.validateHandlerChain(dsl.parseHandlerChain('block://?=x')).some((issue) => issue.level === 'error'));
    assert(dsl.validateHandlerChain(dsl.parseHandlerChain('job://bad%ZZ')).some((issue) => issue.message.includes('percent')));
    assert(dsl.validateHandlerChain(dsl.parseHandlerChain('resolve://?status=pending')).some((issue) => issue.level === 'error'));

    assert.equal(models.BUNDLE_BY_OPTIONS.length, 14);
    assert.equal(models.optionsWithUnknownValue(models.BUNDLE_BY_OPTIONS, 99).at(-1).label, 'Unknown (99)');
    assert.equal(models.ruleSetChanges({ name: ' New ', category: ' auth ', bundle_minutes: 30 }, true).is_active, false);
    assert.equal(models.ruleSetChanges({ name: 'N', category: 'c', bundle_by: 4, bundle_minutes: 0 }, true).bundle_minutes, 0);
    assert.equal(models.ruleSetChanges({ name: 'N', category: 'c', bundle_by: 4, bundle_minutes: null }, true).bundle_minutes, null);
    assert.throws(() => models.ruleSetChanges({ name: 'N', category: 'c', bundle_by: 0, bundle_minutes: 0, trigger_count: 2 }, true));
    assert.throws(() => models.ruleSetChanges({ name: 'N', category: 'c', bundle_by: 4, bundle_minutes: 5, trigger_count: 2, trigger_window: 10 }, true));
    assert.equal(models.ruleSetChanges({ name: 'Future', category: 'c', bundle_by: 99, bundle_minutes: 0 }, false, { bundle_by: 99, bundle_minutes: 0 }).bundle_by, 99);
    assert.throws(() => models.ruleChanges({ parent: 1, name: 'bad', index: 0, field_name: '_secret', value: '1', value_type: 'int', comparator: '==' }, true));
    assert.throws(() => models.ruleChanges({ parent: 1, name: 'bool', index: 0, field_name: 'active', value: 'false', value_type: 'bool', comparator: '==' }, true));
    assert.equal(models.ruleChanges({ parent: 1, name: 'legacy bool renamed', index: 0, field_name: 'active', value: 'false', value_type: 'bool', comparator: '==' }, false, { parent: 1, name: 'legacy bool', index: 0, field_name: 'active', value: 'false', value_type: 'bool', comparator: '==' }).value, 'false');
    assert.throws(() => models.ruleChanges({ parent: 1, name: 'int', index: 0, field_name: 'level', value: 'x', value_type: 'int', comparator: '==' }, true));
    assert.deepEqual(admin.SECURITY_OPERATIONS_ADMIN_SECTION.routes.map((route) => route.path), ['tickets', 'incidents', 'events', 'rules', 'rules/:id']);

    const login = async (email) => { const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } }); return { Authorization: `Bearer ${response.data.access_token}` }; };
    const manager = await login('security.manager@nativemojo.com'); const viewer = await login('security.viewer@nativemojo.com'); const unrelated = await login('groups.manager@nativemojo.com'); const manageOnly = await login('security.manage-only@nativemojo.com');
    assert.equal((await mock.mockFetch('/api/incident/event/ruleset', { headers: manager })).count, 3);
    assert.equal((await mock.mockFetch('/api/incident/event/ruleset', { headers: unrelated })).error_code, 403);
    assert.equal((await mock.mockFetch('/api/incident/event/ruleset', { headers: manageOnly })).error_code, 403, 'manage-only does not imply view');
    assert.equal((await mock.mockFetch('/api/incident/event/ruleset', { headers: viewer })).status, true);
    assert.equal((await mock.mockFetch('/api/incident/event/ruleset/1101', { method: 'POST', headers: viewer, body: { is_active: false } })).error_code, 403);
    const created = await mock.mockFetch('/api/incident/event/ruleset', { method: 'POST', headers: manager, body: models.ruleSetChanges({ name: 'Created safely', category: 'verify', bundle_by: 4, bundle_minutes: 30 }, true) });
    assert.equal(created.data.is_active, false);
    const child = await mock.mockFetch('/api/incident/event/ruleset/rule', { method: 'POST', headers: manager, body: models.ruleChanges({ parent: created.data.id, name: 'Level', index: 0, field_name: 'level', comparator: '>=', value: '8', value_type: 'int', is_required: true }, true) });
    assert.equal(child.data.parent, created.data.id);
    await mock.mockFetch(`/api/incident/event/ruleset/${created.data.id}`, { method: 'POST', headers: manager, body: { metadata: { known: 1 }, ignored_top: 'drop' } });
    const saved = await mock.mockFetch(`/api/incident/event/ruleset/${created.data.id}`, { headers: manager }); assert.equal(saved.data.metadata.known, 1); assert.equal(saved.data.ignored_top, undefined);
    await mock.mockFetch(`/api/incident/event/ruleset/${created.data.id}`, { method: 'DELETE', headers: manager });
    assert.equal((await mock.mockFetch(`/api/incident/event/ruleset/rule/${child.data.id}`, { headers: manager })).error_code, 404);
    console.log('admin rule engine contract verified');
} finally { await server.close(); }
