// verify-admin-devices — headless contract assertions for board #1291
// (Admin: Devices, login locations, GeoIP + world map).
//
// Covers the four things a browser pass cannot cheaply prove: that every
// permission clause is system-pinned and member grants cannot satisfy it,
// that the mock speaks the exact django-mojo wire (graphs, owner scoping,
// POST_SAVE_ACTIONS, verb refusals, the aggregation shape and its traps),
// that the raw provider blob cannot reach a cache or an export, and that
// there is exactly ONE defineModel per endpoint package-wide.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = {
    addEventListener() {}, removeEventListener() {}, confirm: () => true,
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
/** Comments deliberately NAME the fields that were removed, so every
 *  "this must not appear" assertion runs against code only. */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

try {
    const me = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const devices = await server.ssrLoadModule('/packages/portal-mojo/src/admin/security/devices/models.ts');
    const geoip = await server.ssrLoadModule('/packages/portal-mojo/src/admin/security/geoip/models.ts');
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');

    // ── 1. Permissions: sys.-pinned, fail-closed, member grants rejected ──
    const CLAUSES = {
        USER_DEVICE_VIEW_PERMS: devices.USER_DEVICE_VIEW_PERMS,
        DEVICE_LOCATION_VIEW_PERMS: devices.DEVICE_LOCATION_VIEW_PERMS,
        LOGIN_EVENT_VIEW_PERMS: devices.LOGIN_EVENT_VIEW_PERMS,
        LOGIN_SUMMARY_PERMS: devices.LOGIN_SUMMARY_PERMS,
        GEOIP_VIEW_PERMS: geoip.GEOIP_VIEW_PERMS,
        GEOIP_MANAGE_PERMS: geoip.GEOIP_MANAGE_PERMS,
    };
    // A member holding EVERY unprefixed name, plus the sys.-prefixed ones as
    // member grants: none of it may satisfy a global clause.
    const memberGrants = { permissions: {} };
    for (const clause of Object.values(CLAUSES)) {
        for (const permission of clause) {
            memberGrants.permissions[permission] = true;
            memberGrants.permissions[permission.replace(/^sys\./, '')] = true;
        }
    }
    for (const [name, clause] of Object.entries(CLAUSES)) {
        assert(Array.isArray(clause) && clause.length > 0, `${name} must be a non-empty clause`);
        assert(clause.every((permission) => permission.startsWith('sys.')), `${name} must be system-pinned`);
        assert.equal(
            me.hasPermission({ id: 1, permissions: {} }, clause, memberGrants), false,
            `member grants cannot satisfy ${name}`,
        );
        assert.equal(me.hasPermission(null, clause, null), false, `${name} is fail-closed while anonymous`);
        // `sys.manage_devices` passes the /user/device/location URL decorator
        // but fails the MODEL's VIEW_PERMS, so alone it opens nothing — it
        // must therefore appear in no clause at all.
        assert(!clause.includes('sys.manage_devices'), `${name} must not offer sys.manage_devices`);
    }

    // ── 2. Section registration + route generation, both mounts ──
    const sections = [admin.DEVICE_INTEL_ADMIN_SECTION, admin.GEOIP_ADMIN_SECTION];
    assert.equal(admin.DEVICE_INTEL_ADMIN_SECTION.basePath, 'security/devices');
    assert.equal(admin.GEOIP_ADMIN_SECTION.basePath, 'security/geoip');
    for (const section of sections) {
        assert.equal(section.navigationGroup, 'security');
        assert(admin.ADMIN_SECTIONS.includes(section), `${section.id} must be registered in ADMIN_SECTIONS`);
    }
    const standalone = admin.adminSectionRoutes(sections).map((route) => route.path);
    const embedded = admin.adminSectionRoutes(sections, { mount: '/system' }).map((route) => route.path);
    for (const path of ['security/devices/user-devices', 'security/devices/login-locations', 'security/geoip/cache']) {
        assert(standalone.includes(path), `standalone route ${path}`);
        assert(embedded.includes(`system/${path}`), `embedded route system/${path}`);
    }
    // #1287 owns its own network-security section; this item reserves nothing.
    assert.equal(admin.GEOIP_ADMIN_SECTION.routes.length, 1, 'GeoIP ships exactly the cache route');

    // ── 3. Enforcement expiry is STATE, not a raw boolean ──
    const past = Math.floor(Date.now() / 1000) - 3600;
    const future = Math.floor(Date.now() / 1000) + 3600;
    assert.equal(geoip.blockActive({ is_blocked: true, blocked_until: null }), true, 'a permanent block is active');
    assert.equal(geoip.blockActive({ is_blocked: true, blocked_until: future }), true);
    assert.equal(geoip.blockActive({ is_blocked: true, blocked_until: past }), false, 'an EXPIRED block is not active');
    assert.equal(geoip.blockExpired({ is_blocked: true, blocked_until: past }), true);
    assert.equal(
        geoip.blockActive({ is_blocked: true, blocked_until: null, is_whitelisted: true, whitelisted_until: null }),
        false, 'whitelist wins over block',
    );
    assert.equal(geoip.whitelistActive({ is_whitelisted: true, whitelisted_until: past }), false);
    assert.equal(geoip.whitelistExpired({ is_whitelisted: true, whitelisted_until: past }), true);
    assert.equal(geoip.threatTone('critical'), 'danger');
    assert.equal(geoip.threatTone('medium'), 'warning');
    assert.equal(geoip.threatTone(null), 'muted');
    assert.equal(geoip.countryFlag('US'), '\u{1F1FA}\u{1F1F8}');
    assert.equal(geoip.countryFlag('USA'), '', 'three-letter codes have no flag');
    assert.equal(geoip.countryFlag(null), '');

    // ── 4. Login risk tone rides fields the wire actually sends ──
    assert.equal(devices.loginRiskTone({ is_new_country: true, is_new_region: false }), 'bad');
    assert.equal(devices.loginRiskTone({ is_new_country: false, is_new_region: true }), 'warn');
    assert.equal(devices.loginRiskTone({ is_new_country: false, is_new_region: false }), 'ok');
    assert.equal(devices.normalizeCountryCode('us'), 'US');
    assert.equal(devices.normalizeCountryCode('U'), null);
    assert.equal(devices.normalizeCountryCode('USAA'), null);

    // ── 5. The scrubber and the export projection ──
    const dirty = { id: 1, ip_address: '1.2.3.4', data: { threat_data: { firewall_hint: 'x' } }, note: 'token: abcdefghijkl' };
    const clean = geoip.sanitizeGeoIpRow(dirty);
    assert.equal('data' in clean, false, 'sanitizeGeoIpRow strips the raw provider blob');
    assert.match(clean.note, /\[redacted\]/, 'the shared security scrubber still runs');
    const exportedFields = new Set(
        (await read('packages/portal-mojo/src/admin/security/geoip/models.ts'))
            .split('geoIpSafeExporter')[1]
            .match(/key: '([^']+)'/g)
            ?.map((entry) => entry.slice(6, -1)) ?? [],
    );
    assert(exportedFields.size > 0, 'the safe exporter declares a projection');
    assert(!exportedFields.has('data'), 'the export projection excludes the raw blob');
    assert(!exportedFields.has('provider'), 'the export projection excludes the provider name');

    // ── 6. ONE defineModel per endpoint, package-wide ──
    const packageSources = await Promise.all([
        'packages/portal-mojo/src/admin/security/devices/models.ts',
        'packages/portal-mojo/src/admin/security/geoip/models.ts',
        'packages/portal-mojo/src/admin/identity/users/models.ts',
        'packages/portal-mojo/src/admin/bouncer/models.ts',
        'packages/portal-mojo/src/admin/incidents/models.ts',
        'packages/portal-mojo/src/admin/monitoring/models.ts',
        'packages/portal-mojo/src/admin/security/models.ts',
        'packages/portal-mojo/src/admin/identity/members/models.ts',
        'packages/portal-mojo/src/admin/credentials/models.ts',
        'packages/portal-mojo/src/admin/rules/models.ts',
        'packages/portal-mojo/src/admin/settings/model.ts',
    ].map(read));
    const allModelSource = packageSources.join('\n');
    for (const endpoint of ['/api/user/device', '/api/user/device/location', '/api/account/logins', '/api/system/geoip']) {
        const occurrences = allModelSource.split(`endpoint: '${endpoint}'`).length - 1;
        assert.equal(occurrences, 1, `exactly one defineModel for ${endpoint} (found ${occurrences})`);
    }
    assert.doesNotMatch(stripComments(packageSources[2]), /event_type/, 'the phantom event_type field is gone');
    const sharedSource = await read('packages/portal-mojo/src/admin/identity/users/sections/shared.tsx');
    assert.doesNotMatch(sharedSource, /export function loginTone|export const LOGIN_TONE/, 'the dead event_type tone map is deleted');
    const loginsSection = await read('packages/portal-mojo/src/admin/identity/users/sections/LoginsSection.tsx');
    assert.match(loginsSection, /<LoginLocationMap/, 'UserDetail Logins mounts the map');
    assert.match(loginsSection, /LOGIN_SUMMARY_PERMS/, 'the Map tab is gated on the aggregation grant');

    // ── 7. Absent by design ──
    const deviceDetail = await read('packages/portal-mojo/src/admin/security/devices/UserDeviceDetail.tsx');
    assert.doesNotMatch(stripComments(deviceDetail), /is_trusted|Forget device|Mark trusted/, 'no trust toggle and no Forget device');
    const dossier = await read('packages/portal-mojo/src/admin/security/geoip/GeoIpDossier.tsx');
    assert.doesNotMatch(stripComments(dossier), /useDelete|Delete record/, 'GeoLocatedIP has no delete path');
    // The six phantom KPI fields. `event_count` is checked only against the
    // GeoIP dossier: BouncerDevice really does have one, and the device
    // dossier reads it through `bouncer_device.event_count`.
    assert.doesNotMatch(
        stripComments(dossier),
        /row\.(?:event_count|incident_count|login_attempts|login_count)\b/,
        'the four phantom GeoIP KPI fields are gone',
    );
    assert.doesNotMatch(
        stripComments(deviceDetail),
        /(?:^|[^_\w])device\.(?:session_count|location_count)\b/m,
        'the two phantom device KPI fields are gone',
    );
    assert.doesNotMatch(stripComments(dossier), /reverse_dns|ip_version/, 'two fields GeoLocatedIP never had');

    // ── 8. Theme discipline ──
    const [themePortal, themeShowcase] = await Promise.all([
        read('apps/portal/src/theme/admin-devices.css'),
        read('apps/showcase/src/theme/admin-devices.css'),
    ]);
    assert.equal(themePortal, themeShowcase, 'the two theme dirs keep admin-devices.css byte-identical');
    assert.doesNotMatch(stripComments(themePortal), /#[0-9a-fA-F]{3,6}\b/, 'the stylesheet is tokens-only');
    for (const app of ['apps/portal/src/theme.css', 'apps/showcase/src/theme.css']) {
        assert.match(await read(app), /@import "\.\/theme\/admin-devices\.css";/, `${app} imports the stylesheet`);
    }
    // ReactNode slots, never HTML strings (architecture rule 6).
    const surfaces = await Promise.all([
        'packages/portal-mojo/src/admin/security/devices/LoginLocationMap.tsx',
        'packages/portal-mojo/src/admin/security/devices/LoginLocationsPage.tsx',
        'packages/portal-mojo/src/admin/security/devices/UserDeviceLocationDetail.tsx',
        'packages/portal-mojo/src/admin/security/devices/LoginEventDetail.tsx',
        'packages/portal-mojo/src/admin/security/geoip/GeoIpCachePage.tsx',
    ].map(read));
    const surfaceSource = [dossier, deviceDetail, ...surfaces].join('\n');
    assert.doesNotMatch(stripComments(surfaceSource), /dangerouslySetInnerHTML|innerHTML/, 'tooltips and slots are ReactNode, never HTML strings');
    // The map binding must stay a ONE-import coupling to #1426.
    const mapBinding = surfaces[0];
    assert.match(mapBinding, /from '\.\.\/\.\.\/\.\.\/charts'/, 'the map imports from the charts subpath');
    assert.doesNotMatch(stripComments(mapBinding), /maplibre|leaflet|equirectangular|geoArcPath/, 'no projection or map-library code lives in the binding');
    // Coastlines settled 2026-08-06: the checked-in Natural Earth outlines are
    // passed explicitly (opt-in per surface, never a WorldMap default, so
    // map-less pages do not carry 143KB of coordinates). The binding must import
    // them from the package rather than inlining any geometry of its own.
    assert.match(stripComments(mapBinding), /useWorldLand\(\)/, 'basemap geometry is loaded through the lazy hook');
    assert.match(stripComments(mapBinding), /land=\{land\}/, 'and handed to WorldMap');
    assert.doesNotMatch(stripComments(mapBinding), /coordinates\s*:/, 'no geometry is inlined into the binding');
    // The geometry must NEVER be reachable by a static import: that would put
    // ~143KB of coordinates in every bundle touching portal-mojo/charts.
    const chartsBarrel = await readFile(new URL('../packages/portal-mojo/src/charts/index.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(
        stripComments(chartsBarrel),
        /^\s*export\s[^\n]*['"]\.\/worldmap\/world-land['"]/m,
        'world-land.ts is not re-exported from the charts barrel — it must stay behind the lazy hook',
    );

    // ── 9. The wire: mock contract ──
    const login = async (email) => {
        const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } });
        assert.equal(response.status, true, `login failed for ${email}`);
        return { Authorization: `Bearer ${response.data.access_token}` };
    };
    const operator = await login('showcase.operator@nativemojo.com');   // users + manage_users + security
    const ordinary = await login('ian@mojoverify.com');                 // no global grant
    const viewerOnly = await login('security.viewer@nativemojo.com');   // view_security only

    // Anonymous is denied everywhere.
    for (const path of ['/api/user/device', '/api/user/device/location', '/api/account/logins', '/api/system/geoip', '/api/account/logins/summary']) {
        const anon = await mock.mockFetch(path, {});
        assert.equal(anon.error_code, 401, `${path} denies anonymous callers`);
    }

    // Owner scoping: without a global grant the caller sees only their own.
    const ownDevices = await mock.mockFetch('/api/user/device', { headers: ordinary, params: { size: 100 } });
    assert.equal(ownDevices.status, true);
    assert(ownDevices.data.every((row) => row.user?.id === 1), 'owner-scoped device list');
    const allDevices = await mock.mockFetch('/api/user/device', { headers: operator, params: { size: 100 } });
    assert(allDevices.count > ownDevices.count, 'a global grant widens the device list');
    const ownLogins = await mock.mockFetch('/api/account/logins', { headers: ordinary, params: { size: 200 } });
    assert(ownLogins.data.every((row) => row.user?.id === 1), 'owner-scoped login list');

    // Device locations need BOTH gates: view_security alone fails the second.
    assert.equal((await mock.mockFetch('/api/user/device/location', { headers: viewerOnly })).error_code, 403);
    const locations = await mock.mockFetch('/api/user/device/location', { headers: operator, params: { size: 100 } });
    assert.equal(locations.status, true);
    assert(locations.count > 0, 'device locations are seeded');
    const sampleLocation = locations.data[0];
    assert(sampleLocation.user_device, 'a location embeds its device');
    assert.equal('id' in sampleLocation.user_device, false, 'the embedded device basic graph carries NO id');
    assert(sampleLocation.geolocation == null || 'is_threat' in sampleLocation.geolocation, 'the embedded geolocation is the default graph');

    // DELETE is refused on all four models; POST is refused on login events.
    const oneDevice = allDevices.data[0];
    assert.equal((await mock.mockFetch(`/api/user/device/${oneDevice.id}`, { method: 'DELETE', headers: operator })).error_code, 403);
    assert.equal((await mock.mockFetch(`/api/user/device/location/${sampleLocation.id}`, { method: 'DELETE', headers: operator })).error_code, 403);
    const oneLogin = (await mock.mockFetch('/api/account/logins', { headers: operator, params: { size: 1 } })).data[0];
    assert.equal((await mock.mockFetch(`/api/account/logins/${oneLogin.id}`, { method: 'DELETE', headers: operator })).error_code, 403);
    assert.equal((await mock.mockFetch(`/api/account/logins/${oneLogin.id}`, { method: 'POST', headers: operator, body: { city: 'x' } })).error_code, 403);
    assert.equal((await mock.mockFetch('/api/account/logins', { method: 'POST', headers: operator, body: {} })).error_code, 403);
    assert.equal('event_type' in oneLogin, false, 'no graph carries event_type');

    // The sessions graph is REAL.
    const sessions = await mock.mockFetch(`/api/user/device/${oneDevice.id}`, { headers: operator, params: { graph: 'sessions' } });
    assert.equal(sessions.graph, 'sessions');
    assert('bouncer_device' in sessions.data && 'active_sessions' in sessions.data && 'recent_locations' in sessions.data,
        'the sessions graph exposes all three extras');
    assert(Array.isArray(sessions.data.active_sessions));

    // ── 10. GeoIP graphs, actions and the lookup downgrade ──
    assert.equal((await mock.mockFetch('/api/system/geoip', { headers: ordinary })).error_code, 403,
        'GeoLocatedIP has no owner clause — no self-scoped fallback exists');
    const cache = await mock.mockFetch('/api/system/geoip', { headers: operator, params: { size: 100 } });
    assert.equal(cache.status, true);
    assert(cache.count >= 12, 'the GeoIP cache is richly seeded');
    const defaultRow = cache.data[0];
    assert.equal('data' in defaultRow, false, 'graph=default carries no raw blob');
    assert.equal('provider' in defaultRow, false, 'graph=default carries no provider');
    assert(['is_threat', 'is_suspicious', 'risk_score'].every((key) => key in defaultRow), 'the three extras ride every graph');
    const detailed = await mock.mockFetch(`/api/system/geoip/${defaultRow.id}`, { headers: operator, params: { graph: 'detailed' } });
    assert('data' in detailed.data && 'provider' in detailed.data, 'graph=detailed carries both');
    const federation = await mock.mockFetch(`/api/system/geoip/${defaultRow.id}`, { headers: operator, params: { graph: 'federation' } });
    for (const forbidden of ['data', 'is_blocked', 'blocked_until', 'is_whitelisted', 'whitelisted_reason']) {
        assert.equal(forbidden in federation.data, false, `the federation graph never carries ${forbidden}`);
    }
    // /lookup is open to any authenticated identity but DOWNGRADES the graph.
    const downgraded = await mock.mockFetch('/api/system/geoip/lookup', { headers: ordinary, params: { ip: '8.8.8.8', graph: 'detailed' } });
    assert.equal(downgraded.graph, 'federation', 'a non-VIEW_PERMS caller is served the federation graph');
    assert.equal('is_blocked' in downgraded.data, false);
    const privileged = await mock.mockFetch('/api/system/geoip/lookup', { headers: operator, params: { ip: '8.8.8.8' } });
    assert.equal(privileged.graph, 'default');
    assert.equal(privileged.data.ip_address, '8.8.8.8', 'lookup creates the record when absent');
    assert.equal((await mock.mockFetch('/api/system/geoip', { method: 'POST', headers: operator, body: {} })).error_code, 403,
        'records are minted by geolocate(), never by a collection POST');

    // Fixtures the wave depends on: an expired block and an expired whitelist.
    const byIp = (ip) => cache.data.find((row) => row.ip_address === ip);
    const expiredBlock = byIp('104.28.14.33');
    assert(expiredBlock?.is_blocked === true, 'the expired-block fixture still reads is_blocked');
    assert.equal(geoip.blockActive(expiredBlock), false, '…but blockActive() reports it inactive');
    const expiredWhitelist = byIp('198.51.100.77');
    assert(expiredWhitelist?.is_whitelisted === true);
    assert.equal(geoip.whitelistActive(expiredWhitelist), false);
    assert.equal(geoip.blockActive(byIp('185.220.101.44')), true, 'the Tor exit is actively blocked');
    assert.equal(geoip.whitelistActive(byIp('203.0.113.9')), true, 'the office egress is actively whitelisted');

    // Actions. Save gates on SAVE_PERMS, not VIEW_PERMS.
    const target = byIp('196.10.52.77');
    assert.equal((await mock.mockFetch(`/api/system/geoip/${target.id}`, { method: 'POST', headers: viewerOnly, body: { block: { reason: 'x' } } })).error_code, 403);
    const beforeBlocks = target.block_count;
    const blocked = await mock.mockFetch(`/api/system/geoip/${target.id}`, {
        method: 'POST', headers: operator, body: { block: { reason: 'verifier', ttl: 3600 } },
    });
    assert.equal(blocked.data.is_blocked, true);
    assert.equal(blocked.data.block_count, beforeBlocks + 1, 'block increments block_count');
    assert(['high', 'critical'].includes(blocked.data.threat_level), 'block escalates threat_level to at least high');
    assert.equal(geoip.blockActive(blocked.data), true);
    // Whitelisting clears an active block.
    const whitelisted = await mock.mockFetch(`/api/system/geoip/${target.id}`, {
        method: 'POST', headers: operator, body: { whitelist: { reason: 'verifier' } },
    });
    assert.equal(whitelisted.data.is_blocked, false, 'whitelist clears an active block');
    assert.equal(whitelisted.data.is_whitelisted, true);
    const unwhitelisted = await mock.mockFetch(`/api/system/geoip/${target.id}`, {
        method: 'POST', headers: operator, body: { unwhitelist: 1 },
    });
    assert.equal(unwhitelisted.data.is_whitelisted, false);
    // unblock takes a STRING reason, not a dict.
    const unblocked = await mock.mockFetch(`/api/system/geoip/${target.id}`, {
        method: 'POST', headers: operator, body: { unblock: 'false positive' },
    });
    assert.equal(unblocked.data.is_blocked, false);
    assert.match(unblocked.data.blocked_reason, /^unblocked: false positive$/);
    for (const action of ['refresh', 'threat_analysis']) {
        const refreshed = await mock.mockFetch(`/api/system/geoip/${target.id}`, { method: 'POST', headers: operator, body: { [action]: 1 } });
        assert.equal(refreshed.status, true, `${action} answers the refreshed row`);
        assert.equal('data' in refreshed.data, false, `${action} still answers the default graph`);
    }
    assert.equal((await mock.mockFetch(`/api/system/geoip/${target.id}`, { method: 'DELETE', headers: operator })).error_code, 403);

    // ── 11. Login geography: shape, drill, caps and the two traps ──
    assert.equal((await mock.mockFetch('/api/account/logins/summary', { headers: ordinary })).error_code, 403);
    const summary = await mock.mockFetch('/api/account/logins/summary', { headers: operator });
    assert.equal(summary.status, true);
    assert(Array.isArray(summary.data) && summary.data.length >= 8, 'at least eight countries are plottable');
    for (const row of summary.data) {
        assert(row.country_code, '/summary excludes null and empty country codes');
        assert.equal(typeof row.count, 'number');
        assert('new_country_count' in row, 'the country branch annotates new_country_count');
        assert.equal('new_region_count' in row, false, 'the country branch does NOT annotate new_region_count');
    }
    assert.deepEqual([...summary.data].sort((a, b) => b.count - a.count).map((r) => r.count), summary.data.map((r) => r.count),
        'rows come back ordered by descending count');
    const drill = await mock.mockFetch('/api/account/logins/summary', { headers: operator, params: { country_code: 'US', region: 1 } });
    assert(drill.data.length > 0 && drill.data.every((row) => row.country_code === 'US'), 'the region drill scopes to the country');
    assert(drill.data.every((row) => 'new_region_count' in row), 'the region branch annotates new_region_count');
    assert(drill.data.length <= 500, 'the region drill is capped at MAX_REGION_RESULTS');
    // A bad country code is silently IGNORED (not an error), per _validate_country_code.
    const badCode = await mock.mockFetch('/api/account/logins/summary', { headers: operator, params: { country_code: 'nope', region: 1 } });
    assert(badCode.data.some((row) => 'new_country_count' in row), 'an invalid country code falls back to the country branch');
    // `region=false` is TRUTHY on the wire — the client must never send it.
    const regionFalse = await mock.mockFetch('/api/account/logins/summary', { headers: operator, params: { country_code: 'US', region: 'false' } });
    assert(regionFalse.data.every((row) => 'new_region_count' in row), 'region="false" still drills — the trap is real');
    // The data layer owns the wire; `region=1` is set ONLY when a country is
    // being drilled, and the literal `false` never reaches the params object.
    const dataLayer = await read('packages/portal-mojo/src/admin/security/devices/models.ts');
    assert.doesNotMatch(stripComments(dataLayer), /region:\s*(?:false|'false')|params\.region\s*=\s*false/, 'the data layer never sends region=false');
    assert.match(stripComments(dataLayer), /params\.region = 1;/, 'the data layer sends region=1 only while drilling');
    // user_id must parse as an int.
    assert.equal((await mock.mockFetch('/api/account/logins/user', { headers: operator, params: { user_id: 'abc' } })).code, 400);
    assert.equal((await mock.mockFetch('/api/account/logins/user', { headers: operator })).error_code, 400);
    const scoped = await mock.mockFetch('/api/account/logins/user', { headers: operator, params: { user_id: 1 } });
    assert.equal(scoped.status, true);
    const scopedTotal = scoped.data.reduce((sum, row) => sum + row.count, 0);
    const globalTotal = summary.data.reduce((sum, row) => sum + row.count, 0);
    assert(scopedTotal > 0 && scopedTotal < globalTotal, 'the per-user aggregation is a strict subset');
    // The two DIFFERENT date wires: /summary takes bare dr_start/dr_end.
    const bounded = await mock.mockFetch('/api/account/logins/summary', {
        headers: operator, params: { dr_start: new Date().toISOString().slice(0, 10) },
    });
    assert(bounded.data.reduce((sum, row) => sum + row.count, 0) < globalTotal, 'dr_start narrows the aggregation');
    // …while the LIST endpoint takes the dr_field triple.
    assert.match(dataLayer, /params\.dr_field = 'created'/, 'the list leg always names dr_field explicitly');
    assert.match(dataLayer, /Math\.min\(500/, 'the list leg is bounded at 500, not the source\'s 1000');

    console.log('admin devices / login locations / geoip contract verified');
} finally {
    await server.close();
}
