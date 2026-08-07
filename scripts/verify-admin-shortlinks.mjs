// Targeted contract verifier for global Shortlinks Admin (#1297).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

try {
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const models = await server.ssrLoadModule('/packages/portal-mojo/src/admin/shortlinks/models.ts');
    const me = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const storage = await server.ssrLoadModule('/packages/portal-mojo/src/admin/storage/models.ts');

    assert.deepEqual(models.SHORTLINK_MANAGE_PERMISSIONS, ['sys.manage_shortlinks']);
    const section = admin.SHORTLINKS_ADMIN_SECTION;
    assert.equal(section.navigationGroup, 'communications');
    assert.deepEqual(section.routes.map((route) => route.path), ['links', 'history']);
    assert(section.routes.every((route) => route.permissions === models.SHORTLINK_MANAGE_PERMISSIONS));
    assert(admin.ADMIN_SECTIONS.includes(section));
    assert(admin.adminSectionRoutes([section]).some((route) => route.path === 'shortlinks/links'));
    assert(admin.adminSectionRoutes([section], { mount: '/system' }).some((route) => route.path === 'system/shortlinks/history'));
    assert.equal(me.hasPermission({ id: 1, permissions: { manage_shortlinks: true } }, section.permissions, null), true);
    assert.equal(me.hasPermission({ id: 1, permissions: {} }, section.permissions, { permissions: { manage_shortlinks: true } }), false);

    const canary = 'private-shortlink-canary';
    const link = models.sanitizeShortlinkRow({ id: 1, code: 'safe', url: `https://secret.test/${canary}`, metadata: { nested: canary }, source: 'docs', hit_count: 3, expires_at: null, is_active: true, created: 1, user: { id: 2, name: 'Operator', metadata: { canary } } });
    assert(!JSON.stringify(link).includes(canary));
    assert(!('url' in link));
    models.assertSafeShortlinkProjection(link);
    const human = models.sanitizeShortlinkHistoryRow({ id: 2, ip: '203.0.113.4', user_agent: `Mozilla/5.0 (Macintosh) Chrome/120 ${canary}`, referer: `https://ref.example.test/private/${canary}?token=${canary}#fragment`, is_bot: false, created: 2, metadata: { canary }, shortlink: { id: 1, code: 'safe', url: `https://${canary}.test` } });
    assert.deepEqual({ code: human.code, agent: human.agent_summary, origin: human.referer_origin }, { code: 'safe', agent: 'Chrome · macOS', origin: 'https://ref.example.test' });
    assert(!JSON.stringify(human).includes(canary));
    const bot = models.sanitizeShortlinkHistoryRow({ id: 3, user_agent: 'Slackbot-LinkExpanding 1.0', referer: 'javascript:private', is_bot: true, shortlink: { id: 1, code: 'safe' } });
    assert.equal(bot.agent_summary, 'Slackbot · automated');
    assert.equal(bot.referer_origin, null);

    assert.deepEqual(models.ShortlinkModel.normalizeListParams({ graph: 'default', url: canary, search: canary, metadata__x: canary, source: 'docs', sort: 'url' }), { graph: 'list', start: 0, size: 25, source: 'docs', sort: '-created' });
    assert.deepEqual(models.ShortlinkHistoryModel.normalizeListParams({ graph: 'basic', ip: canary, user_agent: canary, referer: canary, shortlink: 1 }), { graph: 'default', start: 0, size: 25, shortlink: 1, sort: '-created' });
    assert.equal(models.functionalShortlinkUrl('a b'), '/s/a%20b');

    const login = async (email) => { const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } }); return { Authorization: `Bearer ${response.data.access_token}` }; };
    const manager = await login('shortlink.manager@nativemojo.com');
    const storageManager = await login('storage.manager@nativemojo.com');
    const denied = await login('storage.viewer@nativemojo.com');
    assert.equal((await mock.mockFetch('/api/shortlink/link', { headers: denied, params: { graph: 'list' } })).count, 0);
    const rawLinks = await mock.mockFetch('/api/shortlink/link', { headers: manager, params: { graph: 'list' } });
    assert(rawLinks.count >= 3);
    assert.equal(typeof rawLinks.data[0].url, 'string'); // backend contract that makes the sanitizer mandatory
    assert(!('metadata' in rawLinks.data[0]));
    const rawHistory = await mock.mockFetch('/api/shortlink/history', { headers: manager, params: { graph: 'default' } });
    assert(rawHistory.count >= 3);
    assert.equal(typeof rawHistory.data[0].user_agent, 'string');
    assert.equal(typeof rawHistory.data[0].shortlink.url, 'string');
    assert.equal((await mock.mockFetch('/api/shortlink/history', { headers: storageManager })).error_code, 403);

    // File.share parity: one-shot URL, collision-safe code key, ISO expiry,
    // destination on the ShortLink row, safe options, active toggle and DELETE.
    const created = await mock.mockFetch('/api/fileman/file/5101', { method: 'POST', headers: storageManager, body: { share: { expire_days: 7, track_clicks: true, note: 'safe note' } } });
    assert.deepEqual(Object.keys(created.data).sort(), ['expires_at', 'shortlink_code', 'track_clicks', 'url']);
    assert(Number.isFinite(Date.parse(created.data.expires_at)));
    assert.equal(created.data.track_clicks, true);
    const shares = await mock.mockFetch('/api/shortlink/link', { headers: storageManager, params: { graph: 'default', source: 'fileman-share', file: 5101 } });
    const share = shares.data.find((row) => row.code === created.data.shortlink_code);
    assert(share);
    assert.equal(share.url, '/mock-storage/files/5101');
    assert.equal(share.metadata.note, 'safe note');
    assert.equal((await mock.mockFetch(`/api/shortlink/link/${share.id}`, { method: 'POST', headers: storageManager, body: { is_active: false } })).data.is_active, false);
    assert.equal((await mock.mockFetch(`/api/shortlink/link/${share.id}`, { method: 'POST', headers: storageManager, body: { is_active: true } })).data.is_active, true);
    assert.equal((await mock.mockFetch(`/api/shortlink/link/${share.id}`, { method: 'DELETE', headers: storageManager })).status, 'deleted');

    const source = await Promise.all(['models.ts', 'ShortlinksPage.tsx', 'ShortlinkHistoryPage.tsx', 'ShortlinkDetail.tsx'].map((file) => read(`packages/portal-mojo/src/admin/shortlinks/${file}`))).then((parts) => parts.join('\n'));
    assert(!source.includes('withFreshAuth'));
    assert(!source.includes('exportFormats'));
    assert(!source.includes('searchPlaceholder'));
    assert.match(source, /ShortlinkReconciliationError/);
    assert.match(source, /finally/);
    assert.match(source, /modal\.detail/);
    assert.match(source, /apiOrigin\(\)/);
    assert.match(source, /remainder: Math\.max\(0, shortlink\.hit_count - tracked\)/);
    assert.equal(storage.ShortLinkShareModel.permissions.view, undefined); // backend owner fallback remains reachable
    console.log('admin-shortlinks verifier: OK');
} finally { await server.close(); }
