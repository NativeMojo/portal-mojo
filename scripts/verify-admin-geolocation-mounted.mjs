// JSDOM behavioral evidence; central browser verification owns pixels and native focus.
import assert from 'node:assert/strict';
import { geoHarness } from './verify-admin-geolocation-harness.mjs';
const h = await geoHarness();
const React = await import('react'), { act } = React;
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
let root, qc, checks = 0;
const wait = async (fn, message) => { for (let i = 0; i < 120; i++) { await act(async () => new Promise(resolve => setTimeout(resolve, 12))); if (fn()) return; } assert.fail(`${message}; ${document.body.textContent}`); };
const button = label => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === label);
const enabled = label => !!button(label) && !button(label).matches(':disabled');
const click = async label => { await wait(() => enabled(label), `${label} enabled`); await act(async () => button(label).click()); };
const field = async (label, value) => { const input = document.querySelector(`[aria-label="${label}"]`); assert(input, label); await act(async () => { Object.getOwnPropertyDescriptor(input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }); };
const key = () => document.querySelector('[aria-label="MojoVerify API key"]');
try {
    const auth = await h.server.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
    auth.initAuth();
    const ui = await h.server.ssrLoadModule('/packages/portal-mojo/src/ui/index.ts');
    const { GeoLocationPage } = await h.server.ssrLoadModule('/packages/portal-mojo/src/admin/geolocation/GeoLocationPage.tsx');
    const login = async (email = 'dns.platform@nativemojo.com') => act(async () => { await auth.login(email, 'mojo'); auth.stopAutoRefresh(); });
    const mount = async (Page = GeoLocationPage, initialEntry = '/custom/system/geolocation') => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
        root = createRoot(document.getElementById('root'));
        await act(async () => root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(MemoryRouter, { initialEntries: [initialEntry] }, React.createElement(React.StrictMode, null, React.createElement(Page), React.createElement(ui.ModalHost))))));
    };
    const unmount = async () => { await act(async () => { root?.unmount(); root = null; ui.modal.closeAll(); }); qc?.clear(); };
    const ready = async () => wait(() => enabled('Test key'), 'Initial authoritative provider read');
    const stored = () => document.querySelector('[aria-label="Stored configuration status"]')?.textContent;
    const draft = () => document.querySelector('[aria-label="Draft MojoVerify key test"]');
    await login(); h.reset('no-key'); await mount(); await ready();
    assert(button('Add key')); assert(!button('Replace key')); assert(!button('Remove key')); assert(!enabled('Save changes')); checks++;
    await click('Add key'); const firstSecret = 'fixture-first-geo-key-1234'; await field('MojoVerify API key', firstSecret);
    const retained = key();
    assert.equal(document.querySelector('[role=tablist]'), null, 'One provider-chain task needs no tab navigation');
    assert(document.querySelector('[aria-label="Primary provider"]') && document.querySelector('[aria-label="Fallback provider"]'), 'Primary and fallback remain visible together');
    assert.equal(key(), retained, 'Provider editing keeps the same uncontrolled password element'); assert.equal(key().value, firstSecret);
    await field('Add provider', 'ipstack');
    assert(document.querySelector('[aria-label="Add provider"]').disabled, 'No empty provider menu when all providers are in the chain');
    assert(![...document.querySelector('[aria-label="Add provider"]').options].some(o => ['mojo','ipinfo','ipstack'].includes(o.value)), 'Add options exclude primary, fallback and existing rows');
    await field('Fallback provider', 'maxmind');
    assert.equal(key().value, firstSecret); checks += 4;
    await click('Refresh'); assert(document.querySelector('dialog'), 'Dirty refresh requires deliberate discard');
    await click('Keep editing'); assert.equal(key().value, firstSecret); assert.equal(h.fixture.posts.length, 0); checks++;
    await click('Test key'); await wait(() => document.querySelector('[aria-label="Draft MojoVerify key test"]'), 'First key diagnostic');
    assert.equal(h.mock.geoProviderSetupMock().geoip.GEOIP_API_KEY_MOJO_CONFIGURED, false, 'Diagnostic never stores a new key');
    assert(!JSON.stringify(qc.getQueryCache().getAll().map(q => q.state.data)).includes(firstSecret)); assert.equal(qc.getMutationCache().getAll().length, 0);
    await click('Save changes'); await wait(() => document.body.textContent.includes('Key set'), 'First key intentionally saved');
    assert.equal(key().value, ''); assert(!button('Add key')); assert(button('Replace key')); assert(button('Remove key')); checks += 3;
    await click('Replace key'); await field('MojoVerify API key', ''); assert(!enabled('Save changes'), 'Blank replacement alone preserves the stored key');
    await unmount();
    for (const scenario of ['unavailable','remote-error']) {
        h.reset(scenario); await mount(); await ready(); assert(!enabled('Save changes'));
        await click('Test key'); await wait(() => document.querySelector('[aria-label="Draft MojoVerify key test"]'), 'Diagnostic available without publishing');
        assert.equal(h.fixture.posts.at(-1).action, 'test_providers'); assert(enabled('Test key')); checks++; await unmount();
    }
    await login(); h.reset('ready'); await mount(); await ready();
    assert(!document.querySelector('input[type="url"]'), 'MojoVerify has one built-in URL, never an editable setup field'); checks++;
    assert.equal(document.querySelector('a').getAttribute('href'), '/custom/system/fleet-configuration', 'Embedded mount derives sibling Fleet route'); checks++;
    await field('Add provider', 'ipstack');
    const up = document.querySelector('[aria-label="Move IPstack up"]'); await act(async () => up.click());
    await field('Primary provider', 'ipinfo');
    await click('Test key'); await wait(() => draft(), 'Draft verdict appears');
    assert.equal(h.mock.getMockGeoProviderObservations().at(-1).stored_test, true, 'Provider-chain edits still update stored connection verification');
    const originalDraft = h.fixture.posts.at(-1).providers.geoip;
    assert.deepEqual(originalDraft.GEOIP_ADDITIONAL_PROVIDERS, ['ip-api','ipstack','maxmind']);
    assert.equal(document.querySelector('[aria-label="Primary provider"]').value, 'ipinfo', 'Stored-verification refresh does not reset an edited draft');
    assert.deepEqual(h.fixture.posts.at(-1).providers.geoip.GEOIP_ADDITIONAL_PROVIDERS, ['ip-api','ipstack','maxmind']); checks += 3;
    assert.equal(originalDraft.GEOIP_MOJO_PROVIDER_URL, 'https://api.mojoverify.com', 'Connection test supplies the built-in MojoVerify URL');
    await field('Fallback provider', 'maxmind'); assert(!draft(), 'Any edit invalidates draft verdict'); checks += 2;
    await click('Replace key'); const secret = 'fixture-only-mounted-DISTINCT-af31'; await field('MojoVerify API key', secret);
    await click('Test key'); await wait(() => draft()?.textContent.includes('key verified'), 'Replacement test accepted');
    assert.equal(key().value, secret, 'A successful diagnostic leaves the candidate available for intentional Save');
    assert(!JSON.stringify(qc.getQueryCache().getAll().map(query => query.state.data)).includes(secret), 'Replacement absent from Query cache');
    assert.equal(qc.getMutationCache().getAll().length, 0, 'No credential request enters Mutation cache');
    assert(!Object.values(localStorage).includes(secret)); assert(!Object.values(sessionStorage).includes(secret)); assert(!JSON.stringify(h.mock.getMockGeoProviderObservations()).includes(secret)); checks += 3;
    h.fixture.posts.length = 0;
    await act(async () => { button('Save changes').click(); button('Save changes').click(); });
    await wait(() => document.body.textContent.includes('Saved and published.'), 'Save publication notice');
    await ready(); assert.equal(h.fixture.posts.length, 1, 'Double Save dispatches only one request');
    assert.equal(h.fixture.posts[0].providers.geoip.GEOIP_MOJO_PROVIDER_URL, 'https://api.mojoverify.com', 'Save supplies the built-in MojoVerify URL'); checks++;
    assert.equal(key().value, '', 'Successful save clears password DOM');
    assert.match(document.body.textContent, /pending|Pending/); assert(!button('Apply now')); checks += 3;
    await click('Replace key'); await field('MojoVerify API key', secret); await click('Discard changes'); assert.equal(key().value, '', 'Cancel clears replacement'); checks++;
    await click('Remove key'); assert(document.querySelector('dialog')); await click('Cancel'); assert.equal(h.fixture.posts.length, 1, 'Canceled removal sends no POST');
    await click('Remove key'); await click('Confirm key removal'); assert(button('Test key').matches(':disabled'), 'Clear is not a connection test');
    await click('Save changes'); await wait(() => document.body.textContent.includes('No stored key'), 'Confirmed removal reconciles');
    assert.equal(h.fixture.posts.at(-1).providers.geoip.clear_api_key, true); assert.equal(h.fixture.posts.at(-1).hasReplacement, false); assert.match(stored(), /not tested/); checks += 3; await unmount();

    for (const scenario of ['unknown-provider', 'empty-registry']) { h.reset(scenario); await mount(); await ready(); await click('Replace key'); await field('MojoVerify API key', secret); await click('Save changes'); await wait(() => h.fixture.posts.length === 1 && enabled('Test key'), 'Unknown/empty-provider fixture saved'); assert.equal(h.fixture.posts[0].providers.geoip.GEOIP_PRIMARY_PROVIDER, scenario === 'unknown-provider' ? 'custom_geo' : 'mojo'); checks++; await unmount(); }
    for (const scenario of ['missing-delegation','old-api','malformed']) {
        h.reset(scenario); await mount(); await wait(() => document.querySelector('[role="alert"]'), `${scenario} reason visible`);
        assert(!enabled('Test key')); assert(!enabled('Save changes')); assert.equal(h.fixture.posts.length, 0, `${scenario} sends zero POST`); checks++; await unmount();
    }
    await login('dns.manager@nativemojo.com'); h.reset('ready'); await mount(); await wait(() => document.body.textContent.includes('requires a superuser'), 'Denied page'); assert.equal(h.fixture.reads, 0, 'Ordinary manager mounts no private reader'); assert.equal(h.fixture.posts.length, 0); checks++; await unmount(); await login();

    h.reset('ready'); h.fixture.mapReply = (reply, opts) => {
        if (opts.method !== 'POST' && reply?.data?.provider_setup) reply.data.provider_setup.geoip.GEOIP_MOJO_PROVIDER_URL = 'https://legacy-geo.example.invalid';
        return reply;
    };
    await mount(); await ready();
    assert(document.body.textContent.includes('Switching to MojoVerify requires a replacement key'), 'Legacy URL migration requires explicit credential review');
    await click('Test key'); await wait(() => draft(), 'Legacy configuration test');
    assert.equal(h.fixture.posts.at(-1).providers.geoip.GEOIP_MOJO_PROVIDER_URL, 'https://api.mojoverify.com', 'A legacy URL never becomes the hidden default'); checks += 2; await unmount();

    h.reset('published-origin-pending'); await mount(); await ready(); const existingStored = stored();
    await click('Test key'); await wait(() => draft()?.textContent.includes('not verified'), 'Published-origin pending stored-key reuse fails');
    assert.equal(stored(), existingStored, 'Failed desired-origin test keeps stored verification unchanged'); assert.match(draft().textContent, /node|Fleet Configuration/); checks++; await unmount();
    h.reset('rejected-key'); await mount(); await ready(); await click('Replace key'); await field('MojoVerify API key', secret); await click('Test key'); await wait(() => draft()?.textContent.includes('not verified'), 'Failed replacement shown inline'); assert.match(stored(), /Verified/); checks++; await unmount();

    h.reset('stale-revision'); await mount(); await ready(); await field('Primary provider', 'ipinfo'); await click('Save changes'); await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('reload before publishing'), '400 stale revision refusal visible');
    assert.equal(h.fixture.posts.length, 1); assert(!enabled('Save changes'), 'Stale token blocks another save'); assert.equal(document.querySelector('[aria-label="Primary provider"]').value, 'ipinfo', 'Stale response does not silently replace reviewed draft');
    await click('Refresh'); await click('Discard and refresh'); await ready(); await field('Primary provider', 'ipinfo'); await click('Save changes'); await wait(() => h.fixture.posts.length === 2 && enabled('Test key'), 'Deliberate retry after refresh'); checks += 2; await unmount();
    h.reset('save-uncertain'); await mount(); await ready(); await click('Replace key'); await field('MojoVerify API key', secret); await click('Save changes'); await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('may have persisted'), 'Network-uncertain save shown');
    assert(!enabled('Save changes')); assert.equal(key().value, ''); assert.equal(h.fixture.posts.length, 1, 'Uncertain save is not replayed'); await click('Refresh'); await ready(); assert.equal(h.fixture.posts.length, 1, 'Refresh reads only'); checks += 2; await unmount();
    h.reset('fresh-auth'); await mount(); await ready(); let fresh = 0; auth.setFreshAuthHandler(async () => { fresh++; return true; });
    await click('Replace key'); await field('MojoVerify API key', secret); await click('Test key'); await wait(() => fresh === 1, 'Fresh-auth flow invoked');
    assert.equal(h.fixture.posts.length, 1); assert(!enabled('Save changes')); assert.equal(key().value, ''); assert(!draft()); await click('Refresh'); await ready(); auth.setFreshAuthHandler(null); checks++; await unmount();

    h.reset('ready'); await mount(); await ready(); await click('Configuration information');
    assert(document.querySelector('dialog')); assert(!document.querySelector('dialog nav')); assert(!document.querySelector('dialog input'), 'Configuration inspection has no editor or sidebar');
    await login('dns.manager@nativemojo.com'); await wait(() => !document.querySelector('dialog'), 'Session change closes configuration information'); checks++; await unmount(); await login();
    h.reset('ready'); await mount(); await ready(); await click('Remove key'); await login('dns.manager@nativemojo.com'); await wait(() => !document.querySelector('dialog'), 'Session change closes owned native confirmation'); assert.equal(h.fixture.posts.length, 0, 'Session loss before confirmation prevents write'); checks++; await unmount(); await login();
    h.reset('ready'); await mount(); await ready(); await click('Replace key'); await field('MojoVerify API key', secret); h.fixture.delay = 120; await click('Test key'); await login('dns.manager@nativemojo.com'); await act(async () => new Promise(resolve => setTimeout(resolve, 160))); assert(!draft(), 'Late previous-session test cannot restore verdict'); assert(!document.body.textContent.includes(secret)); checks++; await unmount(); await login();
    h.reset('ready'); await mount(); await ready(); h.fixture.delay = 100; await field('Primary provider', 'ipinfo'); await click('Save changes'); await unmount(); await act(async () => new Promise(resolve => setTimeout(resolve, 130))); assert.equal(document.getElementById('root').textContent, '', 'Unmounted write response cannot restore form state'); checks++;
    h.reset('ready'); await mount(); await ready(); await click('Replace key'); await field('MojoVerify API key', secret);
    const detachedKey = key(); await unmount(); assert.equal(detachedKey.value, '', 'Unmount wipes the detached password element as well as removing it'); checks++;
    const { AdminGeoLocationDemo } = await h.server.ssrLoadModule('/apps/showcase/src/pages/components/demos-admin-geolocation.tsx');
    h.reset('ready'); await mount(AdminGeoLocationDemo, '/?demo=admin-geolocation'); await ready();
    const handoff = [...document.querySelectorAll('a')].find(a => a.textContent === 'Open Fleet Configuration');
    await field('Primary provider', 'ipstack');
    await click('Replace key'); await field('MojoVerify API key', secret);
    const departureKey = key();
    await act(async () => handoff.click());
    assert(document.querySelector('dialog'), 'Dirty Fleet departure asks before discarding the provider draft and key');
    await click('Keep editing');
    assert.equal(key(), departureKey, 'Canceled departure keeps the same private input');
    assert.equal(key().value, secret, 'Canceled departure keeps the entered key');
    assert.equal(document.querySelector('[aria-label="Primary provider"]').value, 'ipstack');
    assert.equal(h.fixture.posts.length, 0, 'Canceled departure performs no provider write'); checks += 4;
    await act(async () => handoff.click());
    await click('Discard and continue');
    await wait(() => [...document.querySelectorAll('h1')].some(h => h.textContent === 'Fleet Configuration'), 'Demo handoff opens actual Fleet Configuration, not shared validation or Runtime settings');
    assert.equal(departureKey.value, '', 'Accepted departure wipes the detached credential input'); checks++;
    await wait(() => button('Apply now'), 'Demo handoff exposes the existing apply workflow after its authoritative read');
    await act(async () => [...document.querySelectorAll('a')].find(a => a.textContent === 'Back to GeoLocation').click()); await ready();
    assert.equal(h.fixture.posts.length, 0, 'Navigating to Fleet and back does not publish or apply'); checks += 2; await unmount(); await login();
    console.log(`GeoLocation mounted: ${checks} permission, ordered draft, stored/draft isolation, secret-cache, clear, single-flight, stale/uncertain, fresh-auth and session/unmount checks passed`);
} finally { if (root) await act(async () => root.unmount()); qc?.clear(); await h.close(); }
