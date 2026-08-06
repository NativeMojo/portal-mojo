// verify-admin-network — headless contract assertions for board #1287
// (Admin: Network security — blocks, IP sets, geofencing).
//
// Covers what a browser pass cannot cheaply prove: that the geofence↔form
// projection is lossless where it claims to be and refuses where it cannot,
// that every permission clause is `sys.`-pinned so a member grant can never
// open platform enforcement config, that the app shim and the package module
// are ONE module, that the deliberate omissions are absent rather than
// disabled, and that the mock speaks the exact django-mojo wire for
// /api/incident/ipset, /api/geo/* and /api/metrics/category_slugs.
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
/** Comments deliberately NAME what was removed, so every "must not appear"
 *  assertion runs against code only. */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

try {
    const me = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const gf = await server.ssrLoadModule('/packages/portal-mojo/src/admin/network/geofence/geofence-data.ts');
    const models = await server.ssrLoadModule('/packages/portal-mojo/src/admin/network/models.ts');
    const editor = await server.ssrLoadModule('/packages/portal-mojo/src/admin/network/geofence/RuleEditor.tsx');
    const firewall = await server.ssrLoadModule('/packages/portal-mojo/src/admin/network/FirewallLogPage.tsx');
    const ipsetEditor = await server.ssrLoadModule('/packages/portal-mojo/src/admin/network/IPSetEditor.tsx');
    const posture = await server.ssrLoadModule('/packages/portal-mojo/src/admin/network/geofence/PostureHeader.tsx');
    const rulesTab = await server.ssrLoadModule('/packages/portal-mojo/src/admin/network/geofence/RulesTab.tsx');
    const geoip = await server.ssrLoadModule('/packages/portal-mojo/src/admin/security/geoip/models.ts');
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const shim = await server.ssrLoadModule('/apps/portal/src/pages/group-sections/geofence-data.ts');

    // ── 1. Permissions: sys.-pinned, fail-closed, member grants rejected ──
    const CLAUSES = {
        GEOFENCE_VIEW_PERMS: gf.GEOFENCE_VIEW_PERMS,
        GEOFENCE_MANAGE_PERMS: gf.GEOFENCE_MANAGE_PERMS,
        SECURITY_EVENTS_PERMS: gf.SECURITY_EVENTS_PERMS,
        GROUP_GEOFENCE_EDIT_PERMS: gf.GROUP_GEOFENCE_EDIT_PERMS,
        IPSET_VIEW_PERMS: models.IPSET_VIEW_PERMS,
        IPSET_MANAGE_PERMS: models.IPSET_MANAGE_PERMS,
        IPSET_DELETE_PERMS: models.IPSET_DELETE_PERMS,
        METRICS_GLOBAL_VIEW_PERMS: models.METRICS_GLOBAL_VIEW_PERMS,
        FIREWALL_LOG_PERMS: firewall.FIREWALL_LOG_PERMS,
    };
    const memberGrants = { permissions: {} };
    for (const clause of Object.values(CLAUSES)) {
        for (const permission of clause) {
            memberGrants.permissions[permission] = true;
            memberGrants.permissions[permission.replace(/^sys\./, '')] = true;
        }
    }
    for (const [name, clause] of Object.entries(CLAUSES)) {
        assert(Array.isArray(clause) && clause.length > 0, `${name} must be a non-empty clause`);
        assert(clause.every((p) => p.startsWith('sys.')), `${name} must be system-pinned`);
        assert.equal(me.hasPermission({ id: 1, permissions: {} }, clause, memberGrants), false,
            `member grants cannot satisfy ${name}`);
        assert.equal(me.hasPermission(null, clause, null), false, `${name} is fail-closed while anonymous`);
    }
    // Exact backend lists (rest/geofence.py decorators, IPSet.RestMeta,
    // metrics/rest/helpers.check_view_permissions).
    assert.deepEqual([...CLAUSES.GEOFENCE_VIEW_PERMS].sort(),
        ['sys.manage_geofence', 'sys.security', 'sys.view_geofence']);
    assert.deepEqual([...CLAUSES.GEOFENCE_MANAGE_PERMS].sort(), ['sys.manage_geofence', 'sys.security']);
    assert.deepEqual([...CLAUSES.IPSET_VIEW_PERMS].sort(), ['sys.security', 'sys.view_security']);
    assert.deepEqual([...CLAUSES.IPSET_MANAGE_PERMS].sort(), ['sys.manage_security', 'sys.security']);
    // DELETE_PERMS is manage_security ONLY — the broad `security` grant is not
    // enough, and offering it would promise access the server refuses.
    assert.deepEqual([...CLAUSES.IPSET_DELETE_PERMS], ['sys.manage_security']);
    assert.deepEqual([...CLAUSES.METRICS_GLOBAL_VIEW_PERMS].sort(), ['sys.metrics', 'sys.view_metrics']);

    // ── 2. Section registration + route generation, both mounts ──
    const section = admin.NETWORK_SECURITY_ADMIN_SECTION;
    assert(admin.ADMIN_SECTIONS.includes(section), 'network-security must be registered in ADMIN_SECTIONS');
    assert.equal(section.id, 'network-security');
    assert.equal(section.basePath, 'security/network');
    assert.equal(section.navigationGroup, 'security');
    assert.deepEqual(section.routes.map((r) => r.path),
        ['blocked-ips', 'firewall-log', 'ip-sets', 'geofencing']);
    // The section gate is the ANY-of UNION of the four route gates.
    const union = new Set([
        ...geoip.GEOIP_VIEW_PERMS, ...firewall.FIREWALL_LOG_PERMS,
        ...models.IPSET_VIEW_PERMS, ...gf.GEOFENCE_VIEW_PERMS,
    ]);
    assert.deepEqual([...section.permissions].sort(), [...union].sort(), 'section gate is the union of its routes');
    assert(section.permissions.every((p) => p.startsWith('sys.')), 'the section gate is system-pinned too');
    for (const route of section.routes) {
        assert(Array.isArray(route.permissions) && route.permissions.length > 0,
            `${route.path} carries its exact backend gate`);
    }
    const standalone = admin.adminSectionRoutes([section]).map((r) => r.path);
    const embedded = admin.adminSectionRoutes([section], { mount: '/system' }).map((r) => r.path);
    for (const path of ['security/network/blocked-ips', 'security/network/firewall-log',
        'security/network/ip-sets', 'security/network/geofencing']) {
        assert(standalone.includes(path), `standalone route ${path}`);
        assert(embedded.includes(`system/${path}`), `embedded route system/${path}`);
    }
    // A geofence-only operator sees exactly ONE destination.
    const geofenceOnly = { id: 19, permissions: { view_geofence: true } };
    const visible = section.routes.filter((route) => me.hasPermission(geofenceOnly, section.permissions, null)
        && me.hasPermission(geofenceOnly, route.permissions, null));
    assert.deepEqual(visible.map((r) => r.path), ['geofencing'],
        'sys.view_geofence alone reveals Geofencing and nothing else');

    // ── 3. The geofence mapping table (the lossy projection's one definition) ──
    // isAdvancedRule truth table.
    const REPRESENTABLE = [
        null, undefined, {},
        { country: { in: ['US', 'CA'] } },
        { country: { not_in: ['CN'] } },
        { region: { not_in: ['US-CA', 'US-NY'] } },
        { abuse: { tor: false, vpn: false, proxy: false, datacenter: false } },
        { abuse: { tor: null } },
        { country: { not_in: ['CN'] }, region: { not_in: ['US-WA'] }, abuse: { vpn: false } },
    ];
    const ADVANCED = [
        [], 'x', 42,
        { country: 'US' },
        { unknown: { in: ['US'] } },
        { country: { eq: 'US' } },
        { country: { in: ['US'], not_in: ['CN'] } },
        { country: { in: 'US' } },
        { region: { in: ['US-CA'] } },
        { region: { eq: 'US-CA' } },
        { region: { not_in: ['ZZ-QQ'] } },
        { region: { not_in: 'US-CA' } },
        { abuse: { tor: true } },
        { abuse: { bogus: false } },
    ];
    for (const rule of REPRESENTABLE) assert.equal(gf.isAdvancedRule(rule), false, `representable: ${JSON.stringify(rule)}`);
    for (const rule of ADVANCED) assert.equal(gf.isAdvancedRule(rule), true, `advanced: ${JSON.stringify(rule)}`);

    // ruleToForm / formToRule round trip. `{abuse: {tor: null}}` is
    // deliberately excluded: `null` means "don't care", which the form
    // represents as an unchecked toggle, so it round-trips to ABSENT — the
    // same meaning, not the same bytes.
    const ROUND_TRIP = REPRESENTABLE.filter((r) => r && typeof r === 'object' && !JSON.stringify(r).includes('null'));
    for (const rule of ROUND_TRIP) {
        assert.deepEqual(gf.formToRule(gf.ruleToForm(rule)), rule, `round trip ${JSON.stringify(rule)}`);
    }
    assert.deepEqual(gf.formToRule(gf.ruleToForm({ abuse: { tor: null } })), {},
        'a null abuse flag means "don\'t care" and round-trips to absent');
    assert.deepEqual(gf.ruleToForm({ country: { in: ['us'] } }).countries, ['US'], 'codes uppercase');
    assert.equal(gf.ruleToForm({ country: { in: ['US'] } }).country_mode, 'allow');
    assert.equal(gf.ruleToForm({ country: { not_in: ['US'] } }).country_mode, 'block');
    assert.deepEqual(gf.formToRule({ ...gf.EMPTY_RULE_FORM, country_mode: 'allow', countries: [] }), {},
        'an empty country list emits no clause');

    // coerceRuleInput.
    assert.deepEqual(gf.coerceRuleInput(''), {});
    assert.deepEqual(gf.coerceRuleInput(null), {});
    assert.deepEqual(gf.coerceRuleInput('{"country":{"in":["US"]}}'), { country: { in: ['US'] } });
    assert.equal(gf.coerceRuleInput('{nope'), null);
    assert.equal(gf.coerceRuleInput('[1,2]'), null);
    assert.equal(gf.coerceRuleInput(7), null);

    // buildGroupRulePayload: null-out semantics + the sub-key ALLOWLIST.
    assert.equal(gf.buildGroupRulePayload({ country: { in: ['US'] } }, { country: { in: ['US'] } }), null,
        'no change returns null');
    assert.deepEqual(
        gf.buildGroupRulePayload({ country: { in: ['US'] } }, { country: { not_in: ['CN'] } }),
        { country: { not_in: ['CN'], in: null } },
        'a switched operator nulls the stale one',
    );
    assert.deepEqual(
        gf.buildGroupRulePayload({ country: { in: ['US'] }, abuse: { tor: false } }, {}),
        { country: null, abuse: null },
        'a removed constraint is nulled at the top level',
    );
    assert.deepEqual(
        gf.buildGroupRulePayload({}, { country: { in: ['US'], __replace: true, protected: 1 } }),
        { country: { in: ['US'] } },
        'sub-keys outside the DSL are DROPPED, never PATCHed into metadata',
    );
    assert.deepEqual(
        gf.buildGroupRulePayload({ abuse: { tor: false, vpn: false } }, { abuse: { tor: false } }),
        { abuse: { tor: false, vpn: null } },
        'a cleared abuse flag is nulled',
    );

    // collectScopes: enforced_endpoints ∪ fail_closed_scopes, sorted, deduped.
    assert.deepEqual(gf.collectScopes(null), []);
    assert.deepEqual(gf.collectScopes({
        enforced_endpoints: [{ scope: 'auth' }, { scope: 'ingest' }, { scope: null }, {}],
        posture: { fail_closed_scopes: ['auth', 'admin'] },
    }), ['admin', 'auth', 'ingest']);

    // describeDecision over EVERY reason code in engine._DETAIL_MAP.
    const DETAIL_MAP_KEYS = [
        'no_rules', 'disabled', 'bypass', 'ip_allowlisted', 'no_rules_strict', 'passed',
        'lookup_failed', 'private_ip', 'country_not_allowed', 'region_not_allowed',
        'tor_detected', 'vpn_detected', 'proxy_detected', 'datacenter_detected',
        'rule_invalid', 'group_inactive',
    ];
    assert.deepEqual([...gf.GEOFENCE_REASON_CODES].sort(), [...DETAIL_MAP_KEYS].sort(),
        'every _DETAIL_MAP reason code has plain-language copy');
    for (const reason of DETAIL_MAP_KEYS) {
        const text = gf.describeDecision({ reason, allowed: false });
        assert(typeof text === 'string' && text.length > 0, `${reason} has copy`);
        assert(!text.includes('reason:'), `${reason} is not the generic fallback`);
    }
    // The correction that mattered: strict posture reads as a real denial.
    assert.match(gf.describeDecision({ reason: 'no_rules_strict', allowed: false }), /^Blocked/);
    // lookup_failed is direction-aware.
    assert.match(gf.describeDecision({ reason: 'lookup_failed', allowed: false }), /fail-closed/);
    assert.match(gf.describeDecision({ reason: 'lookup_failed', allowed: true }), /fail-open/);
    // An unknown code degrades readably (and warns once — never renders nothing).
    assert.match(gf.describeDecision({ reason: 'brand_new_code', allowed: false }), /Blocked — reason: brand new code\./);
    assert.equal(gf.describeDecision(null), 'Decision.');

    // describeWouldBlock — including the NULLABLE would_block the engine emits
    // when the shadow decision was itself a lookup failure.
    assert.equal(gf.describeWouldBlock(null), '');
    assert.equal(gf.describeWouldBlock({ reason: 'passed', would_block: true }), '');
    assert.equal(gf.describeWouldBlock({ reason: 'ip_allowlisted', would_block: null }), '');
    assert.match(
        gf.describeWouldBlock({ reason: 'ip_allowlisted', would_block: true, would_block_reason: 'country_not_allowed', country_code: 'CN' }),
        /^Without this exemption the request would be blocked: CN is not allowed by the rules\.$/,
    );

    // buildSimulateBody, both modes.
    assert.deepEqual(gf.buildSimulateBody({ mode: 'ip', ip: '  203.0.113.7 ' }), { ip: '203.0.113.7' });
    assert.deepEqual(
        gf.buildSimulateBody({ mode: 'geo', country: 'us', state: 'us-ca', flags: { vpn: true, tor: false }, group_uuid: 'g1', scope: 'auth' }),
        { geo: { country_code: 'US', region_code: 'US-CA', is_vpn: true }, group_uuid: 'g1', scope: 'auth' },
    );
    assert.deepEqual(gf.buildSimulateBody({ mode: 'geo' }), { geo: {} });

    // diffRules powers the armed save label.
    const diff = gf.diffRules({ country: { not_in: ['CN'] } }, { country: { not_in: ['CN', 'RU'] }, abuse: { tor: false } });
    assert.equal(diff.added.length, 2);
    assert.equal(diff.removed.length, 1);
    assert.match(rulesTab.armedSaveLabel({ country: { not_in: ['CN'] } }, { country: { not_in: ['CN', 'RU'] } }),
        /adds 1 clause, removes 1 clause/);

    // ── 4. The editor: one projection, and its refusals ──
    const guided = editor.makeRuleEditorValue({ country: { not_in: ['CN'] } });
    assert.equal(guided.mode, 'guided');
    const forced = editor.makeRuleEditorValue({ abuse: { tor: true } });
    assert.equal(forced.mode, 'json', 'an unrepresentable rule opens in JSON');
    // Guided → JSON carries the LIVE form across.
    const carried = editor.toggleRuleEditorMode({
        ...guided,
        form: { ...guided.form, country_mode: 'allow', countries: ['US'] },
    });
    assert.equal(carried.mode, 'json');
    assert.deepEqual(JSON.parse(carried.json), { country: { in: ['US'] } });
    // JSON → guided refuses invalid JSON and unrepresentable shapes.
    assert.deepEqual(editor.toggleRuleEditorMode({ mode: 'json', form: guided.form, json: '{nope' }),
        { error: 'Fix the JSON before switching back to the guided editor.' });
    assert.deepEqual(editor.toggleRuleEditorMode({ mode: 'json', form: guided.form, json: '{"abuse":{"tor":true}}' }),
        { error: "This rule uses options the guided editor can't represent." });
    assert.equal(editor.ruleFromEditorValue({ mode: 'json', form: guided.form, json: '{nope' }), null);

    // ── 5. The app shim re-exports the SAME identities (one module, proven) ──
    const SHARED = [
        'ABUSE_FLAGS', 'COUNTRY_MODE_OPTS', 'COUNTRY_OPTIONS', 'EMPTY_RULE_FORM',
        'GEOFENCE_MANAGE_PERMS', 'GEOFENCE_VIEW_PERMS', 'GROUP_GEOFENCE_EDIT_PERMS',
        'SECURITY_EVENTS_PERMS', 'US_STATES', 'buildGroupRulePayload', 'coerceRuleInput',
        'countryName', 'describeRule', 'formToRule', 'isAdvancedRule', 'regionName', 'ruleToForm',
    ];
    for (const name of SHARED) {
        assert(shim[name] !== undefined, `the shim re-exports ${name}`);
        assert.equal(shim[name], gf[name], `${name} is the SAME identity — one projection, not a copy`);
    }
    const shimSource = await read('apps/portal/src/pages/group-sections/geofence-data.ts');
    assert.doesNotMatch(stripComments(shimSource), /\bfunction\b|COUNTRY_NAMES\s*[:=]/,
        'the app file is a pure re-export shim — no second implementation, no second country table');
    const sectionSource = await read('apps/portal/src/pages/group-sections/GeofenceSection.tsx');
    assert.doesNotMatch(stripComments(sectionSource), /FriendlyEditor/, 'the private editor is gone');
    assert.match(sectionSource, /<GeofenceRuleEditor/, 'the group panel renders the SHARED editor');
    // The group surface can only tighten: it never writes platform rules.
    assert.doesNotMatch(stripComments(sectionSource), /\/api\/geo\/rules['"]\s*,\s*\{[^}]*method:\s*'POST'/,
        'the group panel never POSTs platform rules');

    // ── 6. Source shape: KISS modals, no page-nav, deliberate omissions ──
    const TABLE_PAGES = {
        'packages/portal-mojo/src/admin/network/BlockedIPsPage.tsx': await read('packages/portal-mojo/src/admin/network/BlockedIPsPage.tsx'),
        'packages/portal-mojo/src/admin/network/FirewallLogPage.tsx': await read('packages/portal-mojo/src/admin/network/FirewallLogPage.tsx'),
        'packages/portal-mojo/src/admin/network/IPSetsPage.tsx': await read('packages/portal-mojo/src/admin/network/IPSetsPage.tsx'),
    };
    for (const [name, source] of Object.entries(TABLE_PAGES)) {
        const code = stripComments(source);
        assert.doesNotMatch(code, /RightPanel|useNavigate|useParams/, `${name}: no route/right-panel inspection (#1425)`);
    }
    for (const relative of [
        'packages/portal-mojo/src/admin/network/BlockedIpDetail.tsx',
        'packages/portal-mojo/src/admin/network/IPSetDetail.tsx',
    ]) {
        assert.match(await read(relative), /modal\.detail\(/, `${relative} inspects through modal.detail`);
    }
    // Blocked IPs never creates a block; IP Sets never batch-deletes.
    const blockedSource = stripComments(TABLE_PAGES['packages/portal-mojo/src/admin/network/BlockedIPsPage.tsx']);
    assert.doesNotMatch(blockedSource, /useAction\('block'\)|GEOIP_BLOCK_FIELDS/,
        'creating a block from the table is ABSENT, not disabled');
    const ipsetsSource = stripComments(TABLE_PAGES['packages/portal-mojo/src/admin/network/IPSetsPage.tsx']);
    assert.doesNotMatch(ipsetsSource, /useDelete|key:\s*'delete'/, 'batch delete of IP sets is ABSENT');
    assert.match(ipsetsSource, /key: 'enable'/, 'but the four safe batch actions are present');
    // `is_enabled` is never written as a plain field, anywhere in the module.
    assert(!ipsetEditor.IPSET_EDIT_FIELDS.some((f) => f.name === 'is_enabled'),
        'the edit form has no is_enabled — enabling is an ACTION');
    assert(!ipsetEditor.IPSET_CREATE_FIELDS.some((f) => f.name === 'is_enabled'),
        'the create form has no is_enabled — records are created disabled');
    // `is_enabled` never appears in a SAVE body anywhere in the module — only
    // as a read (`row.is_enabled`) or a list FILTER param. #1097 lineage.
    assert.doesNotMatch(stripComments(await read('packages/portal-mojo/src/admin/network/IPSetEditor.tsx')),
        /is_enabled/, 'the editor module never mentions is_enabled at all');
    for (const relative of [
        'packages/portal-mojo/src/admin/network/IPSetsPage.tsx',
        'packages/portal-mojo/src/admin/network/IPSetDetail.tsx',
    ]) {
        const code = stripComments(await read(relative));
        assert.doesNotMatch(code, /changes[^;]{0,200}is_enabled/,
            `${relative} never puts is_enabled in a save body`);
        assert.doesNotMatch(code, /mutateAsync\([^)]{0,200}is_enabled/,
            `${relative} never mutates is_enabled directly`);
    }
    assert(!('is_enabled' in (ipsetEditor.buildIPSetCreatePayload({ kind: 'custom', name: 'x' }) ?? {})),
        'the create payload itself carries no is_enabled — the record is created disabled');
    // The posture header is read-only — no settings writes.
    const postureSource = stripComments(await read('packages/portal-mojo/src/admin/network/geofence/PostureHeader.tsx'));
    assert.doesNotMatch(postureSource, /useSave|mutateAsync|GEOFENCE_ENABLED\s*=/,
        'the posture header edits nothing');
    // Bypass grants are never written from the exemptions tab.
    const exemptSource = stripComments(await read('packages/portal-mojo/src/admin/network/geofence/ExemptionsTab.tsx'));
    assert.doesNotMatch(exemptSource, /bypass_geofence/, 'bypass grants are managed on user records, not here');
    // The country picker is #1426's table, not a fork.
    for (const relative of [
        'packages/portal-mojo/src/admin/network/geofence/geofence-data.ts',
        'packages/portal-mojo/src/admin/network/IPSetEditor.tsx',
    ]) {
        assert.match(await read(relative), /charts\/worldmap\/countryCentroids/,
            `${relative} consumes #1426's centroid table`);
    }
    // ONE defineModel per endpoint, inside this module.
    const networkModels = await read('packages/portal-mojo/src/admin/network/models.ts');
    assert.equal(networkModels.split("endpoint: '/api/incident/ipset'").length - 1, 1);
    assert.equal(networkModels.split("endpoint: '/api/system/geoip'").length - 1, 0,
        '#1291 owns /api/system/geoip — this module imports it');
    assert.equal(models.GeofenceEventModel.endpoint, '/api/incident/event');
    // The two event models share ONE invalidation root, so a write from either
    // reaches both (they differ only in their param allowlist).
    const incidents = await server.ssrLoadModule('/packages/portal-mojo/src/admin/incidents/models.ts');
    assert.equal(models.GeofenceEventModel.keys.root[0], incidents.EventModel.keys.root[0]);

    // The three metadata keys the shared allowlist would have DROPPED.
    for (const key of ['metadata__reason', 'metadata__geofence_scope', 'metadata__region_code', 'country_code']) {
        assert.equal(models.normalizeGeofenceEventListParams({ [key]: 'x' })[key], 'x', `${key} survives normalization`);
    }
    assert.equal(models.normalizeGeofenceEventListParams({ metadata__scope: 'auth' }).metadata__scope, undefined,
        'metadata__scope is NOT a key the reporter writes and never reaches the wire');
    assert.equal(models.normalizeIPSetListParams({}).graph, 'default',
        'the ipset list graph is pinned — `data` can never ride a list response');
    assert.equal(models.normalizeIPSetListParams({ source_key: 'x' }).source_key, undefined);

    // `configChangedBy`: changed_by, then user_name — never `username`.
    assert.equal(models.configChangedBy({ changed_by: 'a', user_name: 'b', username: 'c' }), 'a');
    assert.equal(models.configChangedBy({ user_name: 'b', username: 'c' }), 'b');
    assert.equal(models.configChangedBy({ username: 'c' }), '');
    assert.equal(models.configChangedBy(null), '');
    assert.match(await read('packages/portal-mojo/src/admin/network/geofence/PostureHeader.tsx'), /configChangedBy/);
    assert.equal(typeof posture.buildPostureChips, 'function');

    // `parseCidrLines` — the list the backend's set_data() expects.
    assert.deepEqual(models.parseCidrLines('# note\n192.0.2.0/24\n\n  198.51.100.0/24  \n'),
        ['192.0.2.0/24', '198.51.100.0/24']);
    // The create payload transform (country → name/source/description).
    const country = ipsetEditor.buildIPSetCreatePayload({ kind: 'country', country_code: 'CN' });
    assert.deepEqual(country, { kind: 'country', name: 'country_cn', source: 'ipdeny', description: 'Country block: China' });
    assert.equal(ipsetEditor.buildIPSetCreatePayload({ kind: 'country', country_code: '' }), null,
        'a code the backend could not turn into an ipdeny URL is refused client-side');
    const custom = ipsetEditor.buildIPSetCreatePayload({ kind: 'custom', name: 'x', data: '10.0.0.0/8\n# c' });
    assert.deepEqual(custom.data, ['10.0.0.0/8'], 'data is posted as a LIST, never a string');
    assert.equal(ipsetEditor.buildIPSetCreatePayload({ kind: 'abuse', name: 'a', source_key: 'k' }).source, 'abuseipdb');
    assert.equal(ipsetEditor.buildIPSetCreatePayload({ kind: 'datacenter', name: 'd', source_url: 'u' }).source, 'manual');

    // The FIVE ipset sources (web-mojo listed three).
    assert.deepEqual(models.IPSET_SOURCE_OPTIONS.map((o) => o.value),
        ['ipdeny', 'abuseipdb', 'tor', 'blocklist_de', 'manual']);
    assert.deepEqual([...models.IPSET_CACHE_ONLY_NAMES], ['tor_exits', 'blocklist_de']);
    assert.equal(models.isCacheOnlyIPSet({ name: 'tor_exits' }), true);
    assert.equal(models.isCacheOnlyIPSet({ name: 'country_cn' }), false);
    // The four exact firewall kinds.
    assert.deepEqual(Object.values(models.FIREWALL_LOG_KINDS),
        ['firewall:block', 'firewall:unblock', 'firewall:whitelist', 'firewall:unwhitelist']);
    assert.deepEqual(models.firewallPayloadOf('{"ip":"1.2.3.4"}'), { ip: '1.2.3.4' });
    assert.equal(models.firewallPayloadOf('not json'), null);
    assert.equal(models.firewallPayloadOf(null), null);

    // The 404 degradation branch.
    const { MojoError } = await server.ssrLoadModule('/packages/portal-mojo/src/client/errors.ts');
    assert.equal(models.isGeofenceApiMissing(new MojoError('nope', 404)), true);
    assert.equal(models.isGeofenceApiMissing(new MojoError('boom', 500)), false);
    assert.equal(models.isGeofenceApiMissing(new Error('boom')), false);
    // The copy names the documented floor as prose and asserts no version the
    // client can verify (there is no version endpoint).
    assert.match(models.GEOFENCE_API_MISSING_MESSAGE, /v1\.2\.42/);

    // ── 7. Mock: the 403 matrix, per persona ──
    const bearer = async (email) => {
        const login = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } });
        assert.equal(login.status, true, `${email} can sign in`);
        return { Authorization: `Bearer ${login.data.access_token}` };
    };
    // manage_security + manage_geofence (but NOT view_metrics — deliberate).
    const manager = await bearer('security.manager@nativemojo.com');
    const viewer = await bearer('security.viewer@nativemojo.com');        // view_security + view_geofence
    const geofenceViewer = await bearer('geofence.viewer@nativemojo.com'); // view_geofence ONLY
    const groupsManager = await bearer('groups.manager@nativemojo.com');   // no security/geofence at all
    const operator = await bearer('showcase.operator@nativemojo.com');     // + view_metrics

    const denied = (body) => body.status === false && (body.error_code === 403 || body.error_code === 401);

    // /api/geo/* — geofence grants only.
    for (const path of ['/api/geo/rules', '/api/geo/allowlist', '/api/geo/bypass_holders']) {
        assert.equal((await mock.mockFetch(path, { headers: manager })).status, true, `manager reads ${path}`);
        assert.equal((await mock.mockFetch(path, { headers: geofenceViewer })).status, true, `geofence viewer reads ${path}`);
        assert(denied(await mock.mockFetch(path, { headers: groupsManager })), `groups manager is denied ${path}`);
        assert(denied(await mock.mockFetch(path, {})), `${path} is denied while anonymous`);
    }
    assert.equal((await mock.mockFetch('/api/geo/simulate', { method: 'POST', headers: geofenceViewer, body: { geo: { country_code: 'US' } } })).status, true);
    assert(denied(await mock.mockFetch('/api/geo/simulate', { method: 'POST', headers: groupsManager, body: { geo: { country_code: 'US' } } })));
    // Writes need MANAGE.
    assert(denied(await mock.mockFetch('/api/geo/rules', { method: 'POST', headers: geofenceViewer, body: { rule: {} } })),
        'a geofence VIEWER cannot replace the platform rule');
    assert(denied(await mock.mockFetch('/api/geo/rules', { method: 'DELETE', headers: viewer })));
    assert(denied(await mock.mockFetch('/api/geo/allowlist', { method: 'POST', headers: geofenceViewer, body: { entries: [] } })));

    // /api/incident/ipset — security grants only.
    assert.equal((await mock.mockFetch('/api/incident/ipset', { headers: viewer })).status, true);
    assert(denied(await mock.mockFetch('/api/incident/ipset', { headers: geofenceViewer })),
        'a geofence-only operator cannot read IP sets');
    assert(denied(await mock.mockFetch('/api/incident/ipset', {})));
    // /api/system/geoip — #1291's gate, re-asserted from this side.
    assert.equal((await mock.mockFetch('/api/system/geoip', { headers: viewer, params: { is_blocked: 'true' } })).status, true);
    assert(denied(await mock.mockFetch('/api/system/geoip', { headers: geofenceViewer })));

    // ── 8. Mock contract: IP sets ──
    const list = await mock.mockFetch('/api/incident/ipset', { headers: manager, params: { size: 100 } });
    assert(list.count >= 9, 'the fixture carries a real page of sets');
    for (const row of list.data) {
        assert.equal('source_key' in row, false, 'source_key is serialized by NO graph');
        assert.equal('data' in row, false, 'the default graph excludes data');
    }
    const torRow = list.data.find((row) => row.name === 'tor_exits');
    assert(torRow && torRow.is_enabled === false, 'the cache-only sets ship disabled');
    const detailed = await mock.mockFetch(`/api/incident/ipset/${torRow.id}`, { headers: manager, params: { graph: 'detailed' } });
    assert(typeof detailed.data.data === 'string' && detailed.data.data.length > 0, 'graph=detailed carries data');
    assert.equal('source_key' in detailed.data, false, '…but still never source_key');
    // An unknown graph falls back to default — no escape hatch.
    const bogusGraph = await mock.mockFetch(`/api/incident/ipset/${torRow.id}`, { headers: manager, params: { graph: 'federation' } });
    assert.equal('source_key' in bogusGraph.data, false);
    assert.equal('data' in bogusGraph.data, false);
    // `enable` on a cache-only set is a 400 that explains itself.
    const refused = await mock.mockFetch(`/api/incident/ipset/${torRow.id}`, { method: 'POST', headers: manager, body: { enable: 1 } });
    assert.equal(refused.status, false);
    assert.equal(refused.error_code, 400);
    assert.match(refused.error, /cache-only threat list for geoip detection/);
    assert.equal((await mock.mockFetch(`/api/incident/ipset/${torRow.id}`, { headers: manager })).data.is_enabled, false,
        'the refusal did not flip the flag');
    // A normal set enables and syncs.
    const kp = list.data.find((row) => row.name === 'country_kp');
    const enabled = await mock.mockFetch(`/api/incident/ipset/${kp.id}`, { method: 'POST', headers: manager, body: { enable: 1 } });
    assert.equal(enabled.data.is_enabled, true);
    assert.equal((await mock.mockFetch(`/api/incident/ipset/${kp.id}`, { method: 'POST', headers: manager, body: { disable: 1 } })).data.is_enabled, false);
    // A created set is DISABLED unless the body says otherwise (and it never does).
    const created = await mock.mockFetch('/api/incident/ipset', {
        method: 'POST', headers: manager,
        body: { name: 'verify_custom', kind: 'custom', source: 'manual', data: ['203.0.113.0/24', '198.51.100.0/24'] },
    });
    assert.equal(created.data.is_enabled, false, 'created disabled');
    assert.equal(created.data.cidr_count, 2, 'a posted LIST routes through set_data() and recomputes cidr_count');
    // The string trap, reproduced so it stays a fact rather than folklore.
    const trapped = await mock.mockFetch(`/api/incident/ipset/${created.data.id}`, {
        method: 'POST', headers: manager, body: { data: '10.0.0.0/8' },
    });
    assert.equal(trapped.data.cidr_count, 10, 'posting `data` as a STRING interleaves newlines per character');
    // Name uniqueness.
    const dup = await mock.mockFetch('/api/incident/ipset', {
        method: 'POST', headers: manager, body: { name: 'country_cn', kind: 'custom' },
    });
    assert.equal(dup.error_code, 400);
    // DELETE needs manage_security specifically.
    assert(denied(await mock.mockFetch(`/api/incident/ipset/${created.data.id}`, { method: 'DELETE', headers: viewer })));
    assert.equal((await mock.mockFetch(`/api/incident/ipset/${created.data.id}`, { method: 'DELETE', headers: manager })).status, 'deleted');

    // ── 9. Mock contract: the geofence config plane ──
    const rules = (await mock.mockFetch('/api/geo/rules', { headers: manager })).data;
    for (const key of ['system', 'posture', 'allowlist_summary', 'evaluation_order', 'enforced_endpoints']) {
        assert(key in rules, `GET /api/geo/rules carries ${key}`);
    }
    assert.equal('group' in rules, false, 'group is absent without group_uuid');
    for (const key of ['enabled', 'fail_closed', 'fail_closed_scopes', 'allow_private_ips', 'strict_posture', 'cache_ttl']) {
        assert(key in rules.posture, `posture carries ${key}`);
    }
    assert.equal(gf.isAdvancedRule(rules.system.rule), false, 'the seeded platform rule is real DSL');
    const scoped = await mock.mockFetch('/api/geo/rules', { headers: manager, params: { group_uuid: 'nope' } });
    assert.equal(scoped.error_code, 400, 'an unknown group uuid 400s');
    // POST validates like the backend.
    const badRule = await mock.mockFetch('/api/geo/rules', { method: 'POST', headers: manager, body: { rule: { country: { bogus: ['US'] } } } });
    assert.equal(badRule.error_code, 400);
    assert.match(badRule.error, /unknown operator 'bogus'/);
    assert.equal((await mock.mockFetch('/api/geo/rules', { method: 'POST', headers: manager, body: {} })).error_code, 400);
    // A valid replace round-trips.
    const saved = await mock.mockFetch('/api/geo/rules', { method: 'POST', headers: manager, body: { rule: { country: { not_in: ['CN', 'RU'] }, abuse: { tor: false } } } });
    assert.equal(saved.data.source, 'setting');

    // Allowlist: full replace, validated, expiry-aware.
    const allowlist = (await mock.mockFetch('/api/geo/allowlist', { headers: manager })).data;
    assert(Array.isArray(allowlist.setting) && Array.isArray(allowlist.geoip));
    assert(allowlist.setting.some((entry) => entry.active === false),
        'an expired range is LISTED with active=false, never hidden');
    assert(allowlist.geoip.length > 0 && allowlist.geoip.every((entry) => 'ip' in entry && 'active' in entry),
        'the geoip leg is the real whitelist projection');
    assert(allowlist.geoip.some((entry) => entry.active === false), 'an expired whitelist is listed too');
    assert.equal((await mock.mockFetch('/api/geo/allowlist', { method: 'POST', headers: manager, body: { entries: 'nope' } })).error_code, 400);
    assert.match((await mock.mockFetch('/api/geo/allowlist', {
        method: 'POST', headers: manager, body: { entries: [{ cidr: '999.1.1.1' }] },
    })).error, /invalid CIDR\/IP/);
    const cleared = await mock.mockFetch('/api/geo/allowlist', { method: 'POST', headers: manager, body: { entries: [] } });
    assert.equal(cleared.status, true, 'an empty list is a legitimate CLEAR');
    assert.equal((await mock.mockFetch('/api/geo/allowlist', { headers: manager })).data.setting.length, 0);
    await mock.mockFetch('/api/geo/allowlist', {
        method: 'POST', headers: manager,
        body: { entries: [{ cidr: '203.0.113.0/24', reason: 'Office egress' }] },
    });

    // Bypass holders.
    const bypass = (await mock.mockFetch('/api/geo/bypass_holders', { headers: manager })).data;
    assert(Array.isArray(bypass.holders) && typeof bypass.count === 'number' && typeof bypass.capped === 'boolean');
    assert(bypass.holders.some((h) => h.source === 'permission'), 'a non-superuser grant holder exists');
    assert(bypass.holders.every((h) => 'username' in h && 'is_active' in h));

    // Simulate: top-level `enabled`, the exempt shadow fields, the 400s.
    assert.equal((await mock.mockFetch('/api/geo/simulate', { method: 'POST', headers: manager, body: {} })).error_code, 400);
    assert.equal((await mock.mockFetch('/api/geo/simulate', { method: 'POST', headers: manager, body: { geo: 'x' } })).error_code, 400);
    const blocked = (await mock.mockFetch('/api/geo/simulate', { method: 'POST', headers: manager, body: { geo: { country_code: 'CN' } } })).data;
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.reason, 'country_not_allowed');
    assert.equal(blocked.rule_level, 'system');
    assert.equal(typeof blocked.enabled, 'boolean', '`enabled` is at the TOP level of a simulate decision');
    const allowedSim = (await mock.mockFetch('/api/geo/simulate', { method: 'POST', headers: manager, body: { geo: { country_code: 'US' } } })).data;
    assert.equal(allowedSim.allowed, true);
    // The exempt case carries the shadow outcome.
    const exempt = (await mock.mockFetch('/api/geo/simulate', { method: 'POST', headers: manager, body: { ip: '203.0.113.9' } })).data;
    assert.equal(exempt.reason, 'ip_allowlisted');
    assert.equal(exempt.rule_level, null, '_allowlisted_decision never copies rule_level');
    assert('would_block' in exempt && 'allowlist_source' in exempt && 'allowlist_reason' in exempt);
    assert.equal(gf.describeWouldBlock(exempt) === '' || typeof gf.describeWouldBlock(exempt) === 'string', true);
    // An abuse flag blocks on its own.
    const tor = (await mock.mockFetch('/api/geo/simulate', { method: 'POST', headers: manager, body: { geo: { country_code: 'US', is_tor: true } } })).data;
    assert.equal(tor.reason, 'tor_detected');
    // A private address never reaches the rules.
    assert.equal((await mock.mockFetch('/api/geo/simulate', { method: 'POST', headers: manager, body: { ip: '10.0.0.9' } })).data.reason, 'private_ip');

    // ── 10. Mock contract: geoip actions leave a firewall trail ──
    const blockedIps = await mock.mockFetch('/api/system/geoip', { headers: manager, params: { is_blocked: 'true', size: 100 } });
    assert(blockedIps.count >= 6, 'the fixture carries a real page of blocked addresses');
    assert(blockedIps.data.some((row) => row.blocked_until == null), 'at least one PERMANENT block');
    const target = blockedIps.data.find((row) => row.is_blocked && !row.is_whitelisted);
    const before = (await mock.mockFetch('/api/logs', { headers: manager, params: { kind__startswith: 'firewall:', size: 200 } })).count;
    const unblocked = await mock.mockFetch(`/api/system/geoip/${target.id}`, { method: 'POST', headers: manager, body: { unblock: 'verifier' } });
    assert.equal(unblocked.data.is_blocked, false);
    const after = await mock.mockFetch('/api/logs', { headers: manager, params: { kind__startswith: 'firewall:', size: 200 } });
    assert.equal(after.count, before + 1, 'an unblock appends exactly one firewall Log row');
    const row = after.data.find((entry) => entry.kind === 'firewall:unblock' && JSON.parse(entry.payload).reason === 'verifier');
    assert(row, 'the new row is a firewall:unblock');
    const payload = JSON.parse(row.payload);
    assert.deepEqual(Object.keys(payload).sort(), ['ip', 'reason', 'trigger'], 'unblock payload is exactly three keys');
    assert.equal(payload.ip, target.ip_address, 'the TARGET ip lives in the payload…');
    assert.notEqual(row.ip, target.ip_address, '…and Log.ip is the ADMIN address, not the target');
    assert.match(row.path, /^\/api\/system\/geoip\//, 'Log.path is the admin request path');
    // A whitelist takes an ISO `until` and clears an active block.
    const wl = await mock.mockFetch(`/api/system/geoip/${target.id}`, {
        method: 'POST', headers: manager, body: { whitelist: { reason: 'verifier', until: '2030-01-01T00:00:00Z' } },
    });
    assert.equal(wl.data.is_whitelisted, true);
    assert.equal(wl.data.whitelisted_until, Math.floor(Date.parse('2030-01-01T00:00:00Z') / 1000));
    assert.equal((await mock.mockFetch(`/api/system/geoip/${target.id}`, {
        method: 'POST', headers: manager, body: { whitelist: { reason: 'x', until: 'not-a-date' } },
    })).error_code, 400, "an unparseable 'until' is a 400");
    await mock.mockFetch(`/api/system/geoip/${target.id}`, { method: 'POST', headers: manager, body: { unwhitelist: 1 } });

    // ── 11. Mock contract: metrics ──
    // category_slugs is a FLAT envelope — no `data` wrapper.
    const slugs = await mock.mockFetch('/api/metrics/category_slugs', { headers: operator, params: { category: 'geofence', account: 'global' } });
    assert.equal(slugs.data, undefined, 'category_slugs answers a FLAT envelope');
    assert(Array.isArray(slugs.slugs));
    assert(slugs.slugs.includes('geofence:blocks') && slugs.slugs.includes('geofence:exempt'));
    const family = slugs.slugs.filter((slug) => slug.startsWith('geofence:blocks:country:'));
    assert(family.length >= 5, 'the per-country slug family is listed');
    assert(slugs.slugs.some((slug) => slug.startsWith('geofence:blocks:region:')),
        'the per-region family exists too (recorded, deliberately unplotted)');
    // `account=global` demands view_metrics|metrics — `manage_metrics` does
    // NOT imply either, which is exactly why security.manager is denied here
    // and the blocks tab must gate rather than fire and catch the 403.
    assert(denied(await mock.mockFetch('/api/metrics/category_slugs', { headers: manager, params: { category: 'geofence', account: 'global' } })),
        'manage_metrics alone does not open global metrics');
    assert(denied(await mock.mockFetch('/api/metrics/category_slugs', { headers: geofenceViewer, params: { category: 'geofence', account: 'global' } })),
        'a geofence-only operator is denied global metrics');
    assert.equal((await mock.mockFetch('/api/metrics/category_slugs', { headers: operator, params: {} })).error_code, 400);
    // The whole family fetches in ONE call.
    const fetched = await mock.mockFetch('/api/metrics/fetch', {
        headers: operator, params: { slugs: family.join(','), account: 'global', granularity: 'days', range: '30d' },
    });
    assert.equal(Object.keys(fetched.data.data).length, family.length, 'one fetch covers the whole family');

    // ── 12. Theme byte-identity + tokens only ──
    const portalCss = await read('apps/portal/src/theme/admin-network.css');
    const showcaseCss = await read('apps/showcase/src/theme/admin-network.css');
    assert.equal(portalCss, showcaseCss, 'the two theme files are byte-identical');
    const declarations = portalCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const literals = declarations.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bhsla?\([^)]*\)/g) ?? [];
    assert.deepEqual(literals, [], `admin-network.css must use tokens only — found ${literals.join(', ')}`);
    for (const app of ['portal', 'showcase']) {
        assert.match(await read(`apps/${app}/src/theme.css`), /@import "\.\/theme\/admin-network\.css";/,
            `apps/${app} imports the stylesheet`);
    }

    // NOTE: two console.warn lines above are EXPECTED and are themselves part
    // of the contract — the unknown-reason-code fallback and the unknown-graph
    // fallback both warn loudly rather than rendering nothing or silently
    // serving something else.
    console.log('admin network security (blocks · firewall log · IP sets · geofencing) contract verified');
} finally {
    await server.close();
}
