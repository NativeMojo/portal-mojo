// verify:menu-flatten — executable contract for flat menu sections (board
// #1606): run/reset/dedup semantics, section ∧ child gating, home hoist
// with exact matching, icon/keyword fallbacks, and idempotence for
// flag-less menus (grouped admin nav, personas pre-flattened menus).
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { setTimeout, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

const shape = (items) => items.map((i) => i.divider ? `|${i.divider}` : i.label ?? i.route).join(' · ');

try {
    const reg = await server.ssrLoadModule('/packages/portal-mojo/src/ui/menu-registry.ts');
    const me = { id: 1, is_superuser: false, permissions: { view_settings: true } };
    const ctx = { me, member: null, group: null, persona: null };

    // ── passthrough identity when no flat sections exist ──
    const plain = [
        { divider: 'Ops' },
        { label: 'Jobs', route: '/jobs' },
        { id: 'acc', label: 'Accordion', children: [{ label: 'A', route: '/a' }] },
    ];
    assert.equal(reg.flattenMenuItems(plain, ctx), plain, 'flag-less menus pass through by identity');

    // ── the wmx settings-lens shape: home + grouped children + nested reset ──
    const settings = {
        id: 'settings', label: 'Settings', icon: 'bi-gear', route: '/settings',
        presentation: 'flat', group: 'Brand',
        children: [
            { label: 'Brand profile', route: '/settings/brand', group: 'Brand' },
            { label: 'Members', route: '/settings/members', group: 'Access', icon: 'bi-people' },
            { label: 'API keys', route: '/settings/keys', group: 'Access' },
            { id: 'reports', label: 'Reports', group: 'Access', children: [{ label: 'Monthly', route: '/settings/reports/monthly' }] },
            { label: 'Webhooks', route: '/settings/webhooks', group: 'Access' },
            { label: 'Audit log', route: '/settings/audit', group: 'Activity' },
        ],
    };
    const flat = reg.flattenMenuItems([settings], ctx);
    assert.equal(
        shape(flat),
        '|Brand · Settings · Brand profile · |Access · Members · API keys · Reports · |Access · Webhooks · |Activity · Audit log',
        'run semantics: divider on group change; nested child hoists and RESETS the run',
    );
    const home = flat.find((i) => i.label === 'Settings');
    assert.equal(home.exact, true, 'hoisted home is exact-matched');
    assert.equal(home.children, undefined, 'home hoists without children');
    assert.equal(home.presentation, undefined, 'home hoists without the flag');
    assert.equal(reg.routesMatch('/settings', '/settings/brand', true), false, 'exact home does not prefix-light');
    assert.equal(reg.routesMatch('/settings', '/settings/brand'), true, 'non-exact prefix matching unchanged');
    assert.equal(flat.find((i) => i.label === 'API keys').icon, 'bi-gear', 'icon falls back to the parent');
    assert.equal(flat.find((i) => i.label === 'Members').icon, 'bi-people', 'own icon wins');
    assert.ok(flat.find((i) => i.label === 'Webhooks').keywords.includes('Access'), 'group label joins keywords for search');
    const dividerIds = flat.filter((i) => i.divider).map((i) => i.id);
    assert.equal(new Set(dividerIds).size, dividerIds.length, 'synthesized divider ids are unique');

    // ── gating: section ∧ child (a child's own perms never bypass the section) ──
    const gated = {
        label: 'Locked', presentation: 'flat', permissions: 'manage_secrets',
        children: [{ label: 'Child', route: '/c', permissions: 'view_settings' }],
    };
    assert.equal(reg.flattenMenuItems([gated], ctx).length, 0, 'invisible flat parent drops whole');
    const open = { ...gated, permissions: 'view_settings' };
    const openFlat = reg.flattenMenuItems([open], ctx);
    assert.ok(openFlat.some((i) => i.label === 'Child'), 'visible parent hoists children');
    assert.equal(openFlat.find((i) => i.label === 'Child').permissions, 'view_settings', 'child keeps its own gate for itemVisible');

    // ── leading/consecutive divider dedup: keep the later ──
    const withLeading = [{ divider: 'Settings' }, { ...settings, route: undefined }];
    const deduped = reg.flattenMenuItems(withLeading, ctx);
    assert.equal(deduped[0].divider, 'Brand', 'registry divider followed by first group divider collapses, later wins');

    // ── no home group fallback chain: parent.group ?? firstChild.group ?? label ──
    const noGroup = { label: 'Plain', route: '/p', presentation: 'flat', children: [{ label: 'X', route: '/x' }] };
    assert.equal(reg.flattenMenuItems([noGroup], ctx)[0].divider, 'Plain', 'ungrouped children fall to the parent label');

    console.log('verify:menu-flatten OK — runs/reset/dedup, section∧child gates, exact home, fallbacks, passthrough');
} finally {
    await server.close();
}
