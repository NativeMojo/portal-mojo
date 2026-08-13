// verify:fmt — executable contract for the FK-safe formatter + render guard
// (board #1602). Covers the pure parts: fmt.code()'s value table, safeNode's
// passthrough/degrade behavior, and RenderGuard's boundary shape. Full
// boundary behavior (throw → fallback) needs a DOM renderer and is covered by
// the browser pass.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import React from 'react';

globalThis.window = { setTimeout, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

function warnings(fn) {
    const original = console.warn;
    const seen = [];
    console.warn = (...args) => seen.push(args.map(String).join(' '));
    try { return { result: fn(), seen }; } finally { console.warn = original; }
}

try {
    const fmt = await server.ssrLoadModule('/packages/portal-mojo/src/ui/format.ts');
    const safe = await server.ssrLoadModule('/packages/portal-mojo/src/ui/safe-node.tsx');

    // ── fmt.code: strings, numbers, nullish ──
    assert.equal(fmt.code('GC'), 'GC');
    assert.equal(fmt.code(''), '', 'empty string is "no value"');
    assert.equal(fmt.code('', '—'), '—', 'explicit fallback honored');
    assert.equal(fmt.code(null), '');
    assert.equal(fmt.code(undefined, 'x'), 'x');
    assert.equal(fmt.code(3), '3', 'an unexpanded FK pk renders as its digits');
    assert.equal(fmt.code(0), '0');
    assert.equal(fmt.code(NaN), '', 'non-finite numbers degrade');
    assert.equal(fmt.code(Infinity), '');

    // ── fmt.code: expanded row objects ──
    assert.equal(fmt.code({ id: 1, code: 'GC', name: 'Gold Coin' }), 'GC', 'code wins over name');
    assert.equal(fmt.code({ code: null, name: 'Gold Coin' }), 'Gold Coin', 'name backfills a null code');
    assert.equal(fmt.code({ code: 3 }), '3', 'numeric code stringifies');

    // ── fmt.code: hostile inputs never throw; object-miss warns once ──
    const miss = warnings(() => [
        fmt.code({ code: '', name: '' }), fmt.code({}), fmt.code({ code: {} }), fmt.code({ id: 9 }),
        fmt.code([]), fmt.code(['a']), fmt.code(() => {}), fmt.code(true), fmt.code(Symbol('s')),
        fmt.code(Object.create(null)),
    ]);
    assert.deepEqual(miss.result, ['', '', '', '', '', '', '', '', '', '']);
    assert.equal(miss.seen.filter((m) => m.includes('fmt.code')).length, 1, 'object-miss warns exactly once across repeats');

    // ── safeNode: renderable input passes through untouched ──
    const el = React.createElement('code', null, 'GC');
    const arr = ['a', 'b', 3];
    assert.equal(safe.safeNode('x', 'ctx'), 'x');
    assert.equal(safe.safeNode(5, 'ctx'), 5);
    assert.equal(safe.safeNode(null, 'ctx'), null);
    assert.equal(safe.safeNode(el, 'ctx'), el, 'elements pass through by identity');
    assert.equal(safe.safeNode(arr, 'ctx'), arr, 'arrays of primitives pass through by identity');
    assert.equal(safe.isRenderableNode(React.createElement(React.Fragment)), true, 'fragments carry $$typeof');

    // ── safeNode: plain objects degrade to a marker span + one warn per site ──
    const degrade = warnings(() => [
        safe.safeNode({ code: 'GC', symbol: '🪙' }, 'ModelTable column "currency"'),
        safe.safeNode({ code: 'GC', symbol: '🪙' }, 'ModelTable column "currency"'),
        safe.safeNode({ id: 7 }, 'DetailView badge "status"'),
        safe.safeNode(['a', { id: 1 }], 'ModelTable column "tags"'),
    ]);
    const [coded, codedAgain, bare, badArray] = degrade.result;
    assert.equal(coded.type, 'span');
    assert.equal(coded.props.className, 'dim-italic');
    assert.equal(coded.props.children, 'GC', 'degrade reads through fmt.code first');
    assert.equal(codedAgain.props.children, 'GC');
    assert.equal(bare.props.children, '[object]', 'no code/name → visible marker, never nothing');
    assert.equal(badArray.props.children, '[object]', 'an array containing a plain object degrades whole');
    const siteWarns = degrade.seen.filter((m) => m.includes('non-renderable object'));
    assert.equal(siteWarns.length, 3, 'one warn per distinct site, repeats collapse');

    // ── fmt.currency: the cents default is the contract (#1605) ──
    assert.equal(fmt.currency(129900), '$1,299.00');
    assert.equal(fmt.currency('129900'), '$1,299.00', 'string cents coerce');
    assert.equal(fmt.currency(129900, 'EUR'), '€1,299.00');
    assert.equal(fmt.currency(1050), '$10.50', 'ten-fifty as cents');
    assert.equal(fmt.currency(10.5, 'USD', { unit: 'major' }), '$10.50', 'ten-fifty as explicit major');
    assert.equal(fmt.currency(1299, 'JPY', { unit: 'major' }), '¥1,299', 'zero-decimal currency, own convention');
    assert.equal(fmt.currency(0), '$0.00');
    assert.equal(fmt.currency(-4999), '-$49.99');
    assert.equal(fmt.currency(null), '—');
    assert.equal(fmt.currency(null, 'USD', { fallback: '' }), '', 'explicit fallback honored');
    assert.equal(fmt.currency(129900, 'USD', { decimals: 0 }), '$1,299', 'decimals clamp');
    // A MALFORMED code (Intl RangeError) warns ONCE and falls back to USD.
    // (Well-formed unknown codes like 'ZZZ' render verbatim by Intl design.)
    // First touch of this message string in the run — warn-once.ts has no reset.
    const badCode = warnings(() => [fmt.currency(129900, 'not a code'), fmt.currency(129900, 'not a code')]);
    assert.deepEqual(badCode.result, ['$1,299.00', '$1,299.00']);
    assert.equal(badCode.seen.filter((m) => m.includes('unknown currency code')).length, 1, 'bad code warns once, falls back to USD');

    // ── RenderGuard: boundary shape (behavior is the browser pass's job) ──
    assert.equal(typeof safe.RenderGuard, 'function');
    assert.ok(safe.RenderGuard.prototype instanceof React.Component, 'boundaries must be class components');
    assert.deepEqual(safe.RenderGuard.getDerivedStateFromError(new Error('x')), { failed: true });
    assert.equal(typeof safe.RenderGuard.prototype.componentDidCatch, 'function');

    console.log('verify:fmt OK — fmt.code table, fmt.currency units, safeNode passthrough/degrade, RenderGuard shape');
} finally {
    await server.close();
}
