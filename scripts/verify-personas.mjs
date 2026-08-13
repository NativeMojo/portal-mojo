import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// UI barrels feature-detect the theme media query at module load; persist.ts
// feature-detects localStorage. Map-backed storage lets the self-heal tests
// observe real clear-on-invalid behavior.
globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
    }),
};
const backing = new Map();
globalThis.localStorage = {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => { backing.set(key, String(value)); },
    removeItem: (key) => { backing.delete(key); },
};

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
    root,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
});

try {
    const menus = await server.ssrLoadModule('/packages/portal-mojo/src/ui/menu-registry.ts');
    const personas = await server.ssrLoadModule('/packages/portal-mojo/src/personas/index.ts');
    const persist = await server.ssrLoadModule('/packages/portal-mojo/src/client/persist.ts');
    const meModule = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');
    const guardedModule = await server.ssrLoadModule('/packages/portal-mojo/src/ui/Guarded.tsx');
    const requiresGroupModule = await server.ssrLoadModule('/packages/portal-mojo/src/ui/RequiresGroup.tsx');
    const membersModule = await server.ssrLoadModule('/packages/portal-mojo/src/admin/identity/members/models.ts');

    // (h) Personas must never gate permissions — the check side stays blind.
    const meSource = await readFile(new URL('../packages/portal-mojo/src/client/me.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(meSource, /persona/i,
        'client/me.ts must not mention personas — a persona is presentation, never a permission input');

    // ── Menu resolution with the persona input ────────────────────────
    const ctx = (persona, permissions = {}) => ({ me: { id: 1, permissions }, member: null, group: null, persona });
    menus.resetMenus();
    menus.registerMenus([
        { name: 'global', items: [{ label: 'Home', route: '/home' }] },
        { name: 'persona:support', personas: ['support'], items: [{ label: 'Console', route: '/support' }, { label: 'Players', route: '/players' }] },
        { name: 'persona:owner', personas: ['owner'], items: [{ label: 'Dash', route: '/brand' }, { label: 'Players', route: '/players' }] },
    ]);
    menus.setDefaultMenu('global');

    // (a) persona-scoped menus are ineligible without a matching persona…
    assert.equal(menus.resolveActiveMenu('/support', ctx(null))?.name, 'global',
        'without a persona, a persona-scoped menu must not claim its route');
    assert.equal(menus.resolveActiveMenu('/support', ctx('owner'))?.name, 'persona:owner',
        'a non-matching persona must not activate another persona\'s menu by route');
    // …and eligible with one.
    assert.equal(menus.resolveActiveMenu('/support', ctx('support'))?.name, 'persona:support');

    // (b) two personas both carry /players — the ACTIVE persona's menu wins.
    assert.equal(menus.resolveActiveMenu('/players', ctx('support'))?.name, 'persona:support');
    assert.equal(menus.resolveActiveMenu('/players', ctx('owner'))?.name, 'persona:owner');

    // (c) step 2a: on an unowned route the persona's own menu beats defaultMenu.
    assert.equal(menus.resolveActiveMenu('/nowhere', ctx('owner'))?.name, 'persona:owner');

    // (d) non-persona apps unaffected: null persona resolves exactly as before.
    assert.equal(menus.resolveActiveMenu('/home', ctx(null))?.name, 'global');
    assert.equal(menus.resolveActiveMenu('/nowhere', ctx(null))?.name, 'global');
    // Fallback chain with no defaultMenu skips persona menus entirely.
    menus.resetMenus();
    menus.registerMenus([
        { name: 'persona:support', personas: ['support'], items: [{ label: 'Console', route: '/support' }] },
        { name: 'plain', items: [{ label: 'Home', route: '/home' }] },
    ]);
    assert.equal(menus.resolveActiveMenu('/nowhere', ctx(null))?.name, 'plain',
        'a persona-less app must fall back to the first agnostic menu, never a persona menu');

    // ── availablePersonas (e) ─────────────────────────────────────────
    personas.definePersonas([
        { slug: 'support', label: 'Support', home: '/support' },
        { slug: 'owner', label: 'Owner', home: '/brand' },
        { slug: 'compliance', label: 'Compliance', home: '/compliance', gate: ['compliance.queues'] },
    ]);
    const meWith = (permissions) => ({ id: 1, permissions });
    assert.deepEqual(personas.availablePersonas(null), [], 'null me must yield no personas');
    assert.deepEqual(personas.availablePersonas(meWith({})).map((p) => p.slug), ['support', 'owner'],
        'ungated (hat) personas must always be available to an authenticated user');
    assert.deepEqual(personas.availablePersonas(meWith({ 'compliance.queues': true })).map((p) => p.slug),
        ['support', 'owner', 'compliance'], 'a gate key must unlock its persona');
    assert.equal(personas.personaHome('owner'), '/brand');

    // Duplicate slugs warn + first wins.
    const warns = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warns.push(args.join(' ')); };
    try {
        personas.definePersonas([
            { slug: 'dup', label: 'First', home: '/a' },
            { slug: 'dup', label: 'Second', home: '/b' },
        ]);
    } finally { console.warn = originalWarn; }
    assert.equal(personas.getPersonas().length, 1, 'duplicate slugs must be dropped');
    assert.equal(personas.getPersona('dup')?.label, 'First', 'the first declaration wins');
    assert(warns.some((w) => w.includes('duplicate persona slug "dup"')), 'duplicates must warn, never vanish silently');

    // ── persist self-healing (f) ──────────────────────────────────────
    const slugValidator = (raw) => (typeof raw === 'string' && ['support', 'owner'].includes(raw) ? raw : null);
    backing.set('mojo:persona', '{definitely not json');
    assert.equal(persist.readPersisted('mojo:persona', slugValidator), null, 'garbage must never become the value');
    assert.equal(backing.has('mojo:persona'), false, 'garbage must be CLEARED, not left to fail forever');
    persist.writePersisted('mojo:persona', 42);
    assert.equal(persist.readPersisted('mojo:persona', slugValidator), null, 'a wrong-typed value must be rejected');
    assert.equal(backing.has('mojo:persona'), false);
    persist.writePersisted('mojo:persona', 'owner');
    assert.equal(persist.readPersisted('mojo:persona', slugValidator), 'owner', 'valid JSON round-trips');
    backing.set('mojo:persona', 'support'); // legacy bare string, never JSON-encoded
    assert.equal(persist.readPersisted('mojo:persona', slugValidator), 'support', 'bare-string storage is tolerated on read');

    // ── presets + member-permission registration ──────────────────────
    meModule.registerPermissionCategories({ verifycat: ['verifycat.read', 'verifycat.write'] });
    personas.definePersonas([
        { slug: 'support', label: 'Support Admin', home: '/support', grants: { categories: ['verifycat'], keys: ['solo.key', 'sys.admin'] } },
        { slug: 'hat', label: 'Just a hat', home: '/' },
    ]);
    const presets = personas.personaPresets();
    assert.equal(presets.length, 1, 'hats without grants carry no preset');
    assert.deepEqual([...presets[0].keys].sort(), ['solo.key', 'sys.admin', 'verifycat.read', 'verifycat.write'],
        'preset keys = grants.keys ∪ category expansion');
    personas.registerPersonaMemberPermissions({ tooltipBySlug: { support: 'Support bundle' } });
    const memberPermNames = membersModule.getMemberPermissions().map((d) => d.name);
    assert(memberPermNames.includes('solo.key'), 'preset keys must become member-permission switches');
    assert(memberPermNames.includes('verifycat.read'), 'category-expanded keys must register too');
    assert(!memberPermNames.includes('sys.admin'), 'sys.* keys are system-pinned — never member switches');
    assert.equal(membersModule.getMemberPermissions().find((d) => d.name === 'solo.key')?.tooltip, 'Support bundle');

    // ── auditPersonas (g) ─────────────────────────────────────────────
    const wmxLikePersonas = [
        { slug: 'support', label: 'Support', home: '/s', gate: ['support.queue'] },
        { slug: 'marketing', label: 'Marketing', home: '/m', gate: ['marketing.campaigns'] },
    ];
    const cleanPresets = [
        { slug: 'support', label: 'Support', keys: ['support.queue', 'players.view'] },
        { slug: 'marketing', label: 'Marketing', keys: ['marketing.campaigns', 'players.view'] },
    ];
    assert.deepEqual(personas.auditPersonas(wmxLikePersonas, cleanPresets, { strict: 'signature-diagonal' }).findings, [],
        'signature-gated fixture must pass strict');
    const leakedPresets = [
        cleanPresets[0],
        { slug: 'marketing', label: 'Marketing', keys: ['marketing.campaigns', 'support.queue'] },
    ];
    const leak = personas.auditPersonas(wmxLikePersonas, leakedPresets);
    assert.equal(leak.findings.length >= 1, true, 'a leaked gate key must be reported even without strict');
    assert(leak.findings.some((f) => f.includes('"marketing"') && f.includes('"support"') && f.includes('support.queue')),
        'the finding must name the leaking preset, the reached persona, and the key');
    const hats = [
        { slug: 'a', label: 'A', home: '/a' },
        { slug: 'b', label: 'B', home: '/b' },
    ];
    assert.deepEqual(personas.auditPersonas(hats, cleanPresets).findings, [], 'ungated hats are skipped');

    // ── PersonaSection routes + menus (i) ─────────────────────────────
    personas.resetPersonaSections();
    const sections = [
        {
            id: 'sec:console', label: 'Console', icon: 'bi-headset', basePath: 'support',
            permissions: ['players.view', 'support.queue'], groupScoped: true,
            personas: ['support'], element: 'landing',
            children: [
                { path: 'redemptions', label: 'Redemptions', navGroup: 'Work queues', permissions: ['redemptions.view'], element: 'page' },
                { path: 'player/:id', label: 'Player', hidden: true, permissions: ['players.view'], element: 'page' },
            ],
        },
        {
            id: 'sec:reports', label: 'Reports', icon: 'bi-graph-up', basePath: 'brand',
            permissions: ['reports.view'],
            personas: { owner: { label: 'Brand reports', navGroup: 'Owner tools' }, support: {} },
            element: 'landing', children: [],
        },
    ];
    const routes = personas.personaSectionRoutes(sections);
    assert.equal(routes.length, 2);
    assert.equal(routes[0].path, 'support');
    assert.equal(routes[0].children.length, 3, 'index + every child (hidden children still route)');
    const indexRoute = routes[0].children.find((r) => r.index);
    assert(indexRoute, 'a section with an element must emit an index route');
    assert.equal(indexRoute.element.type, guardedModule.Guarded, 'every persona route is Guarded-wrapped (fail-closed)');
    assert.deepEqual(indexRoute.element.props.permission, ['players.view', 'support.queue']);
    assert.equal(indexRoute.element.props.fallback, null);
    assert.equal(indexRoute.element.props.children.type, requiresGroupModule.RequiresGroup,
        'groupScoped sections wrap pages in RequiresGroup INSIDE the guard');
    const childRoute = routes[0].children.find((r) => r.path === 'redemptions');
    assert.deepEqual(childRoute.element.props.permission, ['redemptions.view'],
        'child routes gate on the child permissions');
    const brandIndex = routes[1].children.find((r) => r.index);
    assert.notEqual(brandIndex.element.props.children?.type, requiresGroupModule.RequiresGroup,
        'non-groupScoped sections must not demand a group');

    const configs = personas.personaSectionsMenu(sections);
    assert.deepEqual(configs.map((c) => c.name).sort(), ['persona:owner', 'persona:support']);
    for (const config of configs) {
        assert.equal(config.personas.length, 1, 'one MenuConfig per persona, scoped to exactly that slug');
        assert.equal(config.name, `persona:${config.personas[0]}`);
    }
    const supportMenu = configs.find((c) => c.name === 'persona:support');
    assert(supportMenu.items.some((item) => item.divider === 'Work queues'), 'navGroups render as divider rows');
    const redemptionsItem = supportMenu.items.find((item) => item.route === '/support/redemptions');
    assert.deepEqual(redemptionsItem.permissions, ['redemptions.view'], 'menu items carry the child permissions intact');
    const consoleHome = supportMenu.items.find((item) => item.route === '/support');
    assert.deepEqual(consoleHome.permissions, ['players.view', 'support.queue'], 'the landing row carries the section permissions');
    assert(!supportMenu.items.some((item) => item.route === '/support/player/:id'), 'hidden children get no sidebar entry');
    const ownerMenu = configs.find((c) => c.name === 'persona:owner');
    const ownerReports = ownerMenu.items.find((item) => item.route === '/brand');
    assert.equal(ownerReports.label, 'Brand reports', 'per-persona label override applies');
    const supportReports = supportMenu.items.find((item) => item.route === '/brand');
    assert.equal(supportReports.label, 'Reports', 'other personas keep the section label');
    // itemVisible stays fail-closed on persona menu items regardless of persona.
    const visCtx = (permissions) => ({ me: { id: 1, permissions }, member: null, group: null, persona: 'support' });
    assert.equal(menus.itemVisible(redemptionsItem, visCtx({})), false, 'an active persona never widens visibility');
    assert.equal(menus.itemVisible(redemptionsItem, visCtx({ 'redemptions.view': true })), true);

    // Route→owners derivation feeding usePersonaFollowsRoute.
    assert.deepEqual(personas.personasOwningPath('/support/redemptions'), ['support']);
    assert.deepEqual(personas.personasOwningPath('/brand').sort(), ['owner', 'support']);
    assert.deepEqual(personas.personasOwningPath('/supportive'), [], 'prefix match is segment-aware');
    assert.deepEqual(personas.personasOwningPath('/elsewhere'), []);

    console.log('personas contract verified');
} finally {
    await server.close();
}
