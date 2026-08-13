// verify:fixed-params — executable contract for ModelTable's locked scope
// (board #1634): mergeFixedParams overlay semantics and the fixedParamKeys
// scrub set. Store-level behavior (no pills, Clear all, persistence, URL
// scrub) is exercised in the browser pass — this pins the pure layer.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

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
    const fp = await server.ssrLoadModule('/packages/portal-mojo/src/ui/fixed-params.ts');
    const base = { start: 0, size: 10, group: '9', kind: 'team' };

    // ── mergeFixedParams: passthrough identity when nothing to merge ──
    assert.equal(fp.mergeFixedParams(base, undefined), base, 'undefined fixed → same object');
    assert.equal(fp.mergeFixedParams(base, null), base, 'null fixed → same object');
    assert.equal(fp.mergeFixedParams(base, {}), base, 'empty fixed → same object');
    assert.equal(fp.mergeFixedParams(base, { group: null, note: '' }), base, 'all-skipped fixed → same object');

    // ── override-after-normalize: fixed beats normalized state ──
    const merged = fp.mergeFixedParams(base, { group: '2', graph: 'full' });
    assert.deepEqual(merged, { start: 0, size: 10, group: '2', kind: 'team', graph: 'full' });
    assert.notEqual(merged, base, 'merge copies, never mutates');
    assert.deepEqual(base, { start: 0, size: 10, group: '9', kind: 'team' }, 'input untouched');

    // ── value hygiene: null/'' skip, 0 passes ──
    assert.deepEqual(fp.mergeFixedParams({}, { group: 0 }), { group: 0 }, '0 is a valid scope value');
    assert.deepEqual(fp.mergeFixedParams({ a: 1 }, { b: null, c: '', d: 'x' }), { a: 1, d: 'x' });

    // ── reserved keys: ignored, one warn each across repeats ──
    const reserved = warnings(() => [
        fp.mergeFixedParams(base, { sort: '-created', group: '2' }),
        fp.mergeFixedParams(base, { sort: 'name' }),
        fp.mergeFixedParams(base, { search: 'x', start: 50, size: 99, page: 3 }),
    ]);
    assert.deepEqual(reserved.result[0], { ...base, group: '2' }, 'reserved key dropped, rest merged');
    assert.equal(reserved.result[1], base, 'only-reserved fixed → passthrough');
    assert.equal(reserved.result[2], base, 'all five reserved keys ignored');
    for (const key of ['sort', 'search', 'start', 'size', 'page']) {
        assert.equal(reserved.seen.filter((m) => m.includes(`"${key}"`)).length, 1, `one warn total for ${key}`);
    }

    // ── fixedParamKeys: the scrub set ──
    assert.deepEqual([...fp.fixedParamKeys({ group: '2', graph: 'full' })].sort(), ['graph', 'group']);
    assert.deepEqual([...fp.fixedParamKeys({ group: null, note: '', sort: 'x' })], [], 'nullish + reserved excluded');
    assert.deepEqual([...fp.fixedParamKeys(null)], []);
    assert.deepEqual([...fp.fixedParamKeys(undefined)], []);
    assert.deepEqual([...fp.fixedParamKeys({ group: 0 })], ['group'], '0-valued key still scrubs');

    console.log('verify:fixed-params OK — merge overlay, value hygiene, reserved keys, scrub set');
} finally {
    await server.close();
}
