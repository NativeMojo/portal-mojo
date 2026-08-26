import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

globalThis.window = {
    addEventListener() {}, removeEventListener() {}, confirm: () => true,
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

try {
    const models = await server.ssrLoadModule('/packages/portal-mojo/src/admin/credentials/models.ts');
    const components = await server.ssrLoadModule('/packages/portal-mojo/src/admin/credentials/api-key-rate-limits.tsx');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const {
        buildApiKeyLimitPatch, readApiKeyRateLimits, validateApiKeyRateLimitInput,
    } = models;

    const configured = {
        zeta: { limit: 10, window: 30 },
        alpha: { limit: 200, window: 1, extension: { keep: true } },
    };
    const configuredRead = readApiKeyRateLimits(configured);
    assert.equal(configuredRead.isObject, true);
    assert.equal(configuredRead.isEmpty, false);
    assert.equal(configuredRead.hasUnsafe, false);
    assert.deepEqual(configuredRead.entries.map((entry) => entry.rawEndpoint), ['alpha', 'zeta']);
    assert.deepEqual(configuredRead.entries[0].override, { limit: 200, window: 1 });

    const unsafe = {
        '': { limit: 2, window: 1 },
        '   ': { window: 3 },
        scalar: 'legacy',
        partial: { limit: 8, extension: { keep: true } },
        __replace: { limit: 99, window: 1 },
    };
    const unsafeRead = readApiKeyRateLimits(unsafe);
    assert.equal(unsafeRead.hasUnsafe, true);
    const byEndpoint = Object.fromEntries(unsafeRead.entries.map((entry) => [entry.rawEndpoint, entry]));
    assert.equal(byEndpoint[''].canEdit, false);
    assert.equal(byEndpoint[''].canClear, true);
    assert.equal(byEndpoint['   '].canClear, true);
    assert.equal(byEndpoint.scalar.kind, 'scalar');
    assert.equal(byEndpoint.scalar.canEdit, false);
    assert.equal(byEndpoint.partial.kind, 'repairable');
    assert.equal(byEndpoint.partial.canEdit, true);
    assert.match(byEndpoint.partial.issue, /decorator default/);
    assert.equal(byEndpoint.__replace.kind, 'reserved');
    assert.equal(byEndpoint.__replace.canClear, false);
    assert.deepEqual(readApiKeyRateLimits({}), {
        isObject: true, isEmpty: true, hasUnsafe: false, entries: [],
    });
    assert.equal(readApiKeyRateLimits(null).hasUnsafe, true);

    assert.deepEqual(
        validateApiKeyRateLimitInput(
            { endpoint: ' orders ', limit: '500', window: '5' },
            { existing: {} },
        ),
        { endpoint: 'orders', override: { limit: 500, window: 5 } },
    );
    for (const input of [
        { endpoint: ' ', limit: 1, window: 1 },
        { endpoint: '__replace', limit: 1, window: 1 },
        { endpoint: 'zero', limit: 0, window: 1 },
        { endpoint: 'fraction', limit: 1.5, window: 1 },
        { endpoint: 'window', limit: 1, window: 0 },
        { endpoint: 'bool', limit: true, window: 1 },
    ]) assert.throws(() => validateApiKeyRateLimitInput(input, { existing: {} }));
    assert.throws(() => validateApiKeyRateLimitInput(
        { endpoint: 'orders', limit: 1, window: 1 },
        { existing: { orders: { limit: 2, window: 1 } } },
    ));

    assert.deepEqual(buildApiKeyLimitPatch('', null), { '': null });
    assert.deepEqual(buildApiKeyLimitPatch('   ', null), { '   ': null });
    assert.deepEqual(
        buildApiKeyLimitPatch('orders', { limit: 250, window: 10 }, configured.alpha),
        { orders: { limit: 250, window: 10, extension: { keep: true } } },
    );
    assert.throws(() => buildApiKeyLimitPatch('__replace', null));

    const renderSummary = (limits) => renderToStaticMarkup(
        createElement(components.ApiKeyLimitsSummary, { limits }),
    );
    assert.match(renderSummary({}), /Unlimited \(default\)/);
    assert.match(renderSummary(configured), /all other endpoints unlimited/);
    const unsafeHtml = renderSummary(unsafe);
    assert.match(unsafeHtml, /Review required/);
    assert.doesNotMatch(unsafeHtml, /Unlimited \(default\)|all other endpoints unlimited/);
    const hostile = '\"><img id="rate-limit-injection" src=x onerror=alert(1)>';
    const hostileHtml = renderSummary({ [hostile]: { limit: 1, window: 1 } });
    assert.doesNotMatch(hostileHtml, /<img id="rate-limit-injection"/);

    const login = async (email) => {
        const response = await mock.mockFetch('/api/login', {
            method: 'POST', body: { username: email, password: 'mojo' },
        });
        return { Authorization: `Bearer ${response.data.access_token}` };
    };
    const manager = await login('groups.manager@nativemojo.com');
    const viewer = await login('groups.viewer@nativemojo.com');

    const original = await mock.mockFetch('/api/group/apikey/201', { headers: manager });
    assert.equal(original.status, true);
    assert.equal('token' in original.data, false, 'ordinary detail must not disclose the token');

    const denied = await mock.mockFetch('/api/group/apikey/201', {
        method: 'POST', headers: viewer,
        body: { limits: { denied: { limit: 1, window: 1 } } },
    });
    assert.equal(denied.error_code, 403, 'a view-only operator cannot mutate limits');

    const added = await mock.mockFetch('/api/group/apikey/201', {
        method: 'POST', headers: manager,
        body: {
            limits: buildApiKeyLimitPatch('orders', { limit: 20, window: 2 }, {
                extension: { burst: 4, keep: true },
            }),
        },
    });
    assert.deepEqual(added.data.limits.orders, {
        extension: { burst: 4, keep: true }, limit: 20, window: 2,
    });
    assert.deepEqual(added.data.limits.assess, { limit: 500, window: 60 }, 'save response is the complete resulting map');
    assert.equal('token' in added.data, false, 'ordinary save must not disclose the token');

    const edited = await mock.mockFetch('/api/group/apikey/201', {
        method: 'POST', headers: manager,
        body: { limits: { orders: { limit: 25, window: 3 } } },
    });
    assert.deepEqual(edited.data.limits.orders, {
        extension: { burst: 4, keep: true }, limit: 25, window: 3,
    }, 'nested extension siblings survive a partial edit');

    const cleared = await mock.mockFetch('/api/group/apikey/201', {
        method: 'POST', headers: manager,
        body: { limits: buildApiKeyLimitPatch('orders', null) },
    });
    assert.equal('orders' in cleared.data.limits, false);
    assert.deepEqual(cleared.data.limits.assess, { limit: 500, window: 60 });
    const refreshed = await mock.mockFetch('/api/group/apikey/201', { headers: manager });
    assert.deepEqual(refreshed.data.limits, cleared.data.limits, 'GET observes the authoritative cleared map');

    let legacy = await mock.mockFetch('/api/group/apikey/204', { headers: manager });
    assert.equal('token' in legacy.data, false);
    legacy = await mock.mockFetch('/api/group/apikey/204', {
        method: 'POST', headers: manager, body: { limits: buildApiKeyLimitPatch('', null) },
    });
    assert.equal('' in legacy.data.limits, false);
    assert.equal('   ' in legacy.data.limits, true, 'empty-key deletion must not trim a whitespace sibling');
    legacy = await mock.mockFetch('/api/group/apikey/204', {
        method: 'POST', headers: manager, body: { limits: buildApiKeyLimitPatch('   ', null) },
    });
    assert.equal('   ' in legacy.data.limits, false);
    legacy = await mock.mockFetch('/api/group/apikey/204', {
        method: 'POST', headers: manager, body: { limits: buildApiKeyLimitPatch('scalar', null) },
    });
    assert.equal('scalar' in legacy.data.limits, false);
    legacy = await mock.mockFetch('/api/group/apikey/204', {
        method: 'POST', headers: manager,
        body: {
            limits: buildApiKeyLimitPatch(
                'partial', { limit: 8, window: 4 }, legacy.data.limits.partial,
            ),
        },
    });
    assert.deepEqual(legacy.data.limits.partial, {
        limit: 8, window: 4, extension: { keep: true },
    });
    legacy = await mock.mockFetch('/api/group/apikey/204', {
        method: 'POST', headers: manager,
        body: { limits: { orders: { limit: 240, window: 10 } } },
    });
    assert.deepEqual(legacy.data.limits.orders.extension, { burst: 20, source: 'legacy' });
    assert.deepEqual(legacy.data.limits.__replace, { limit: 999, window: 1 }, 'reserved stored data remains read-only');
    assert.equal(JSON.stringify(legacy.data).includes('mock_gk_'), false, 'credential material stays absent');

    console.log('admin credentials rate-limit contract verified');
} finally {
    await server.close();
}
