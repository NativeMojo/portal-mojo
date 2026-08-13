// verify:route-error — executable contract for the router-free route-error
// helpers (board #1604): describeRouteError totality, the 404 shape check,
// and the chunk-load predicate. The card + boundary behavior needs a DOM —
// covered by the browser pass.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { setTimeout, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

try {
    const re = await server.ssrLoadModule('/packages/portal-mojo/src/ui/route-error.ts');

    // ── describeRouteError: Errors ──
    const withStack = new Error('boom');
    withStack.stack = 'Error: boom\n    at f (x.ts:1:1)';
    assert.equal(re.describeRouteError(withStack), 'boom\n\nError: boom\n    at f (x.ts:1:1)');
    const noStack = new Error('quiet');
    noStack.stack = '';
    assert.equal(re.describeRouteError(noStack), 'quiet');

    // ── object throws: head/body/dump, never [object Object] ──
    const routerErr = { status: 404, statusText: 'Not Found', data: 'No route matches URL "/x"' };
    const described = re.describeRouteError(routerErr);
    assert.ok(described.startsWith('404 Not Found\nNo route matches URL "/x"'), 'head + string body lead');
    assert.ok(!described.includes('[object Object]'));
    assert.ok(re.describeRouteError({ error: 'permission denied' }).includes('permission denied'));
    assert.ok(re.describeRouteError({ message: { nested: true } }).includes('"nested": true'), 'non-string message falls to dump');
    const circular = { name: 'loop' };
    circular.self = circular;
    assert.equal(re.describeRouteError(circular), '[unserializable object] keys: name, self', 'circular with no head/body names its keys, never throws, never [object Object]');
    assert.ok(re.describeRouteError({ status: 500, self: null }).startsWith('500'));
    assert.equal(re.describeRouteError('plain string'), 'plain string');
    assert.equal(re.describeRouteError(42), '42');
    assert.equal(re.describeRouteError(undefined), 'undefined');

    // ── isNotFoundError: structural 404 only ──
    assert.equal(re.isNotFoundError(routerErr), true);
    assert.equal(re.isNotFoundError({ status: 500, statusText: 'Server Error', data: '' }), false);
    assert.equal(re.isNotFoundError({ status: 404 }), false, 'needs statusText + data (router shape)');
    assert.equal(re.isNotFoundError(new Error('404')), false);
    assert.equal(re.isNotFoundError(null), false);

    // ── isChunkLoadError: Vite dynamic-import shapes only; doubt → false ──
    for (const msg of [
        'Failed to fetch dynamically imported module: http://x/chunk.js',
        'error loading dynamically imported module',
        'Importing a module script failed.',
    ]) {
        assert.equal(re.isChunkLoadError(new TypeError(msg)), true, msg);
        assert.equal(re.isChunkLoadError(msg), true, 'bare string form');
    }
    assert.equal(re.isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'currency')")), false, 'a page render TypeError is NOT a chunk error');
    assert.equal(re.isChunkLoadError(new Error('anything else')), false);
    assert.equal(re.isChunkLoadError({ status: 404 }), false);
    assert.equal(re.isChunkLoadError(null), false);

    console.log('verify:route-error OK — describe totality, 404 shape, chunk predicate');
} finally {
    await server.close();
}
