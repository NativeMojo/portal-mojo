// verify:preset-owned — executable contract for preset key ownership: the
// selected segment's params never pill and survive Clear all. Pins the pure
// layer (presetOwnedFilters / isPresetOwned); pill rendering, the Filter
// count and the three Clear buttons are exercised in the browser pass.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { setTimeout, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

// The params store's own matcher (useTableParams presetActive), over a plain filter map.
const matcher = (filters) => (params) => {
    const keys = Object.keys(params);
    if (keys.length === 0) return Object.keys(filters).length === 0;
    return keys.every((k) => filters[k] === params[k]);
};

try {
    const po = await server.ssrLoadModule('/packages/portal-mojo/src/ui/preset-owned.ts');
    const presets = [
        { params: {} },
        { params: { status: 'submitted' } },
        { params: { status__in: 'failed,timeout' } },
        { params: { location__isnull: 'true', is_hidden: 'false' } },
        { params: { is_hidden: 'false' } },
    ];

    // ── nothing selected / the empty "All" preset owns nothing ──
    assert.deepEqual(po.presetOwnedFilters(presets, matcher({})), {}, 'All owns nothing');
    assert.deepEqual(po.presetOwnedFilters([], matcher({ status: 'submitted' })), {}, 'no presets → nothing owned');

    // ── a matching preset owns exactly its keys; extra filters stay clearable ──
    const withExtra = { status: 'submitted', payout_method: 'ach' };
    assert.deepEqual(po.presetOwnedFilters(presets, matcher(withExtra)), { status: 'submitted' });

    // ── a value change un-owns (Filter-menu edit brings the pill back) ──
    assert.deepEqual(po.presetOwnedFilters(presets, matcher({ status: 'approved' })), {});
    assert.deepEqual(po.presetOwnedFilters(presets, matcher({ status__in: 'submitted,approved' })), {});

    // ── multi-key presets and overlapping active presets: the union ──
    assert.deepEqual(
        po.presetOwnedFilters(presets, matcher({ location__isnull: 'true', is_hidden: 'false' })),
        { location__isnull: 'true', is_hidden: 'false' },
        'In stock + Visible both match → union',
    );
    assert.deepEqual(po.presetOwnedFilters(presets, matcher({ location__isnull: 'true' })), {}, 'partial match owns nothing');

    // ── isPresetOwned: plain by key, daterange by dr_field ──
    const owned = { status: 'submitted', dr_field: 'created', dr_start: '2026-10-01', dr_end: '2026-10-28' };
    assert.equal(po.isPresetOwned({ id: 'status', kind: 'plain', value: 'submitted' }, owned), true);
    assert.equal(po.isPresetOwned({ id: 'payout_method', kind: 'plain', value: 'ach' }, owned), false);
    assert.equal(po.isPresetOwned({ id: 'created', kind: 'daterange', start: '2026-10-01', end: '2026-10-28' }, owned), true);
    assert.equal(po.isPresetOwned({ id: 'modified', kind: 'daterange', start: '2026-10-01' }, owned), false);
    assert.equal(po.isPresetOwned({ id: 'created', kind: 'daterange' }, {}), false, 'nothing owned → every pill shows');
    assert.equal(po.isPresetOwned({ id: 'dr_field', kind: 'plain', value: 'created' }, {}), false);

    console.log('verify:preset-owned OK — All owns nothing, exact-value ownership, union, daterange by dr_field');
} finally {
    await server.close();
}
