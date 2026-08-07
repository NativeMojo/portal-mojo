import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = {
    setTimeout, clearTimeout,
    addEventListener() {}, removeEventListener() {},
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

try {
    const location = await server.ssrLoadModule('/packages/portal-mojo/src/client/location.ts');
    const autosave = await server.ssrLoadModule('/packages/portal-mojo/src/ui/form-autosave.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');

    // Server creates the first token; the adapter accepts it privately and
    // sends it on later suggestions/details without returning it to callers.
    const calls = [];
    const transport = async (path, opts) => {
        calls.push({ path, opts });
        if (path.endsWith('/suggestions')) return {
            success: true, session_token: 'provider-secret',
            data: [{ id: 'one', place_id: 'one', description: 'One', main_text: 'One', secondary_text: 'CA' }],
            size: 1, count: 1,
        };
        if (path.endsWith('/place-details')) return { success: true, address: { address1: 'One', city: 'Town' } };
        throw new Error(`unexpected ${path}`);
    };
    const client = new location.LocationClient({ transport });
    const first = await client.autocomplete('One');
    assert.equal('session_token' in first, false, 'session token is absent from public results');
    assert.equal(calls[0].opts.params.session_token, undefined, 'first request omits token');
    await client.autocomplete('One M');
    assert.equal(calls[1].opts.params.session_token, 'provider-secret', 'later suggestions reuse token');
    await client.placeDetails('one');
    assert.equal(calls[2].opts.params.session_token, 'provider-secret', 'details completes the same session');
    await client.autocomplete('New');
    assert.equal(calls[3].opts.params.session_token, undefined, 'selection destroys the session');
    assert.deepEqual(JSON.parse(JSON.stringify(client)), {}, 'private state cannot serialize');

    // Latest query wins, and reset/upstream replacement invalidate late work.
    const held = [];
    const racing = new location.LocationClient({ transport: (_path, opts) => {
        const wait = deferred();
        held.push({ wait, input: opts.params.input });
        return wait.promise;
    } });
    const old = racing.autocomplete('old');
    const latest = racing.autocomplete('latest');
    held[1].wait.resolve({ success: true, session_token: 'latest-token', data: [], size: 0, count: 0 });
    await latest;
    held[0].wait.resolve({ success: true, session_token: 'old-token', data: [], size: 0, count: 0 });
    await assert.rejects(old, location.StaleLocationRequestError);

    const resetHeld = deferred();
    const resetClient = new location.LocationClient({ transport: () => resetHeld.promise });
    const resetRequest = resetClient.autocomplete('held');
    resetClient.reset();
    resetHeld.resolve({ success: true, session_token: 'must-not-land', data: [], size: 0, count: 0 });
    await assert.rejects(resetRequest, location.StaleLocationRequestError);

    const replaceHeld = deferred();
    const replaceClient = new location.LocationClient({ transport: () => replaceHeld.promise });
    const replacedRequest = replaceClient.autocomplete('held');
    replaceClient.replaceTransport(async () => ({ success: true, session_token: 'new', data: [], size: 0, count: 0 }));
    replaceHeld.resolve({ success: true, session_token: 'old', data: [], size: 0, count: 0 });
    await assert.rejects(replacedRequest, location.StaleLocationRequestError);

    // The six intentionally mixed response shapes normalize once, with no
    // second data unwrap.
    const shapeClient = new location.LocationClient({ transport: async (path) => {
        if (path.endsWith('/validate')) return { status: true, data: { valid: true } };
        if (path.endsWith('/suggestions')) return { success: true, session_token: 's', data: [], size: 0, count: 0 };
        if (path.endsWith('/place-details')) return { success: true, address: { address1: 'A' } };
        if (path.endsWith('/geocode')) return { success: true, latitude: 1, longitude: 2, formatted_address: 'A', place_id: 'p', address_components: {} };
        if (path.endsWith('/reverse-geocode')) return { success: true, formatted_address: 'A', place_id: 'p', address_components: {} };
        if (path.endsWith('/timezone')) return { success: true, timezone_id: 'Etc/UTC', timezone_name: 'UTC', raw_offset: 0, dst_offset: 0, total_offset: 0 };
        throw new Error(path);
    } });
    assert.equal((await shapeClient.validateAddress({ address1: 'A', state: 'CA' })).valid, true);
    await shapeClient.autocomplete('A');
    assert.equal((await shapeClient.placeDetails('p')).address1, 'A');
    assert.equal((await shapeClient.geocode('A')).latitude, 1);
    assert.equal((await shapeClient.reverseGeocode({ lat: 1, lng: 2 })).place_id, 'p');
    assert.equal((await shapeClient.timezone({ lat: 1, lng: 2 })).timezone_id, 'Etc/UTC');

    // One declared-field patch becomes one pending batch and one rollback.
    const fields = [
        { name: 'address1', type: 'address', label: 'Address' },
        { name: 'city', type: 'text', label: 'City' },
    ];
    const initial = { draft: { address1: 'Old', city: 'Before' }, server: { address1: 'Old', city: 'Before' }, fieldState: {}, fieldError: {}, pending: {}, inflight: false };
    const patched = autosave.autosaveReducer(initial, {
        type: 'COMMIT_PATCH', fields,
        patch: { address1: 'New', city: 'After', provider_secret: 'drop' },
    });
    assert.deepEqual(patched.pending, { address1: 'New', city: 'After' });
    const started = autosave.autosaveReducer(patched, { type: 'BATCH_START', names: ['address1', 'city'] });
    const failed = autosave.autosaveReducer(started, { type: 'SAVE_FAIL', names: ['address1', 'city'], error: 'no' });
    assert.deepEqual(failed.draft, { address1: 'Old', city: 'Before' }, 'whole patch rolls back');

    // Mock history is useful without retaining the query, token or place id.
    mock.clearMockRequestHistory();
    const mockFirst = await mock.mockFetch('/api/location/address/suggestions', { params: { input: 'private street' } });
    const mockToken = mockFirst.session_token;
    await mock.mockFetch('/api/location/address/suggestions', { params: { input: 'private street 2', session_token: mockToken } });
    await mock.mockFetch('/api/location/address/place-details', { params: { place_id: 'mock-googleplex', session_token: mockToken } });
    const history = mock.getMockRequestHistory();
    assert.equal(history[0].observables.input_length, 14);
    assert.equal(history[1].observables.has_session_token, true);
    assert.equal(history[2].observables.has_place_id, true);
    const serializedHistory = JSON.stringify(history);
    for (const secret of ['private street', mockToken, 'mock-googleplex']) {
        assert.equal(serializedHistory.includes(secret), false, `history omits ${secret}`);
    }

    const [addressSource, comboSource, locationSource, mockSource, formViewSource] = await Promise.all([
        readFile(new URL('../packages/portal-mojo/src/ui/AddressField.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/ui/ComboBox.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/client/location.ts', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/client/mock.ts', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/ui/FormView.tsx', import.meta.url), 'utf8'),
    ]);
    assert(addressSource.includes('<Popover') && addressSource.includes('onPatch'), 'AddressField is popover + patch bound');
    for (const forbidden of ['useQuery', 'useSearchParams', 'localStorage', 'sessionStorage']) assert(!addressSource.includes(forbidden));
    assert(comboSource.includes('<Popover') && !comboSource.includes("document.addEventListener('mousedown'"), 'Popover solely owns ComboBox dismissal');
    assert(locationSource.includes('#sessionToken') && !locationSource.includes('randomUUID'), 'token is private and backend-created');
    assert(formViewSource.includes('commitPatch={form.commitPatch}'));
    assert(mockSource.includes('observables') && !mockSource.includes('params: { ...opts.params }'), 'location logging remains derived-only');

    console.log('verify-location-address: all contracts passed');
} finally {
    await server.close();
}
