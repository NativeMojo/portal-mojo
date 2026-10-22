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
const key = () => document.querySelector('[aria-label="Replacement MojoVerify API key"]');
try {
    const auth = await h.server.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
    auth.initAuth();
    const ui = await h.server.ssrLoadModule('/packages/portal-mojo/src/ui/index.ts');
    const { GeoLocationPage } = await h.server.ssrLoadModule('/packages/portal-mojo/src/admin/geolocation/GeoLocationPage.tsx');
    const login = async (email = 'dns.platform@nativemojo.com') => act(async () => { await auth.login(email, 'mojo'); auth.stopAutoRefresh(); });
    const mount = async () => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
        root = createRoot(document.getElementById('root'));
        await act(async () => root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(MemoryRouter, { initialEntries: ['/custom/system/geolocation'] }, React.createElement(React.StrictMode, null, React.createElement(GeoLocationPage), React.createElement(ui.ModalHost))))));
    };
    const unmount = async () => { await act(async () => { root?.unmount(); root = null; ui.modal.closeAll(); }); qc?.clear(); };
    const ready = async () => wait(() => enabled('Test MojoVerify connection'), 'Initial authoritative provider read');
    const stored = () => document.querySelector('[aria-label="Stored configuration status"]')?.textContent;
    const draft = () => document.querySelector('[aria-label="Draft MojoVerify connection test"]');
    await login(); h.reset('ready'); await mount(); await ready();
    assert(!document.querySelector('input[type="url"]'), 'MojoVerify has one built-in URL, never an editable setup field'); checks++;
    assert.equal(document.querySelector('a').getAttribute('href'), '/custom/system/fleet-configuration', 'Embedded mount derives sibling Fleet route'); checks++;
    await field('Add provider', 'mojo');
    const up = document.querySelector('[aria-label="Move mojo up"]'); await act(async () => up.click());
    await field('Primary GeoIP provider', 'ipinfo');
    await click('Test MojoVerify connection'); await wait(() => draft(), 'Draft verdict appears');
    assert.equal(h.mock.getMockGeoProviderObservations().at(-1).stored_test, true, 'Provider-chain edits still update stored connection verification');
    const originalDraft = h.fixture.posts.at(-1).providers.geoip;
    assert.deepEqual(originalDraft.GEOIP_ADDITIONAL_PROVIDERS, ['ipapi','mojo','maxmind']);
    assert.equal(document.querySelector('[aria-label="Primary GeoIP provider"]').value, 'ipinfo', 'Stored-verification refresh does not reset an edited draft');
    assert.deepEqual([...document.querySelectorAll('.geo-admin-provider-list li > span')].map(node => node.textContent), ['ipapi','mojo','maxmind']); checks += 3;
    assert.equal(originalDraft.GEOIP_MOJO_PROVIDER_URL, 'https://api.mojoverify.com', 'Connection test supplies the built-in MojoVerify URL');
    await field('Fallback GeoIP provider', 'maxmind'); assert(!draft(), 'Any edit invalidates draft verdict'); checks += 2;
    await click('Replace key'); const secret = 'fixture-only-mounted-DISTINCT-af31'; await field('Replacement MojoVerify API key', secret);
    await click('Test MojoVerify connection'); await wait(() => draft()?.textContent.includes('connection verified'), 'Replacement test accepted');
    assert.equal(key().value, secret, 'A successful diagnostic leaves the candidate available for intentional Save');
    assert(!JSON.stringify(qc.getQueryCache().getAll().map(query => query.state.data)).includes(secret), 'Replacement absent from Query cache');
    assert.equal(qc.getMutationCache().getAll().length, 0, 'No credential request enters Mutation cache');
    assert(!Object.values(localStorage).includes(secret)); assert(!Object.values(sessionStorage).includes(secret)); assert(!JSON.stringify(h.mock.getMockGeoProviderObservations()).includes(secret)); checks += 3;
    h.fixture.posts.length = 0;
    await act(async () => { button('Save').click(); button('Save').click(); });
    await wait(() => document.body.textContent.includes('Saved and published.'), 'Save publication notice');
    await ready(); assert.equal(h.fixture.posts.length, 1, 'Double Save dispatches only one request');
    assert.equal(h.fixture.posts[0].providers.geoip.GEOIP_MOJO_PROVIDER_URL, 'https://api.mojoverify.com', 'Save supplies the built-in MojoVerify URL'); checks++;
    assert.equal(key().value, '', 'Successful save clears password DOM');
    assert.match(document.body.textContent, /pending a config-sync restart on this request node/); assert(!button('Apply now')); checks += 3;
    await click('Replace key'); await field('Replacement MojoVerify API key', secret); await click('Cancel changes'); assert.equal(key().value, '', 'Cancel clears replacement'); checks++;
    await click('Remove key'); assert(document.querySelector('dialog')); await click('Cancel'); assert.equal(h.fixture.posts.length, 1, 'Canceled removal sends no POST');
    await click('Remove key'); await click('Confirm key removal'); assert(button('Test MojoVerify connection').matches(':disabled'), 'Clear is not a connection test');
    await click('Save'); await wait(() => document.body.textContent.includes('No stored MojoVerify key'), 'Confirmed removal reconciles');
    assert.equal(h.fixture.posts.at(-1).providers.geoip.clear_api_key, true); assert.equal(h.fixture.posts.at(-1).hasReplacement, false); assert.match(stored(), /not a connection test/); checks += 3; await unmount();

    for (const scenario of ['unknown-provider', 'empty-registry']) { h.reset(scenario); await mount(); await ready(); await click('Save'); await wait(() => h.fixture.posts.length === 1 && enabled('Test MojoVerify connection'), 'Unknown/empty-provider fixture saved'); assert.equal(h.fixture.posts[0].providers.geoip.GEOIP_PRIMARY_PROVIDER, scenario === 'unknown-provider' ? 'custom_geo' : 'mojo'); checks++; await unmount(); }
    for (const scenario of ['unavailable','remote-error','missing-delegation','old-api','malformed']) {
        h.reset(scenario); await mount(); await wait(() => document.querySelector('[role="alert"]'), `${scenario} reason visible`);
        assert(!enabled('Test MojoVerify connection')); assert(!enabled('Save')); assert.equal(h.fixture.posts.length, 0, `${scenario} sends zero POST`); checks++; await unmount();
    }
    await login('dns.manager@nativemojo.com'); h.reset('ready'); await mount(); await wait(() => document.body.textContent.includes('requires a superuser'), 'Denied page'); assert.equal(h.fixture.reads, 0, 'Ordinary manager mounts no private reader'); assert.equal(h.fixture.posts.length, 0); checks++; await unmount(); await login();

    h.reset('ready'); h.fixture.mapReply = (reply, opts) => {
        if (opts.method !== 'POST' && reply?.data?.provider_setup) reply.data.provider_setup.geoip.GEOIP_MOJO_PROVIDER_URL = 'https://legacy-geo.example.invalid';
        return reply;
    };
    await mount(); await ready();
    assert(document.body.textContent.includes('Switching to MojoVerify requires a replacement API key'), 'Legacy URL migration requires explicit credential review');
    await click('Test MojoVerify connection'); await wait(() => draft(), 'Legacy configuration test');
    assert.equal(h.fixture.posts.at(-1).providers.geoip.GEOIP_MOJO_PROVIDER_URL, 'https://api.mojoverify.com', 'A legacy URL never becomes the hidden default'); checks += 2; await unmount();

    h.reset('published-origin-pending'); await mount(); await ready(); const existingStored = stored();
    await click('Test MojoVerify connection'); await wait(() => draft()?.textContent.includes('not verified'), 'Published-origin pending stored-key reuse fails');
    assert.equal(stored(), existingStored, 'Failed desired-origin test keeps stored verification unchanged'); assert.match(draft().textContent, /node|Fleet Configuration/); checks++; await unmount();
    h.reset('rejected-key'); await mount(); await ready(); await click('Replace key'); await field('Replacement MojoVerify API key', secret); await click('Test MojoVerify connection'); await wait(() => draft()?.textContent.includes('not verified'), 'Failed replacement shown inline'); assert.match(stored(), /verification: Verified/); checks++; await unmount();

    h.reset('stale-revision'); await mount(); await ready(); await field('Primary GeoIP provider', 'ipinfo'); await click('Save'); await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('reload before publishing'), '400 stale revision refusal visible');
    assert.equal(h.fixture.posts.length, 1); assert(!enabled('Save'), 'Stale token blocks another save'); assert.equal(document.querySelector('[aria-label="Primary GeoIP provider"]').value, 'ipinfo', 'Stale response does not silently replace reviewed draft');
    await click('Refresh'); await ready(); await click('Save'); await wait(() => h.fixture.posts.length === 2 && enabled('Save'), 'Deliberate retry after refresh'); checks += 2; await unmount();
    h.reset('save-uncertain'); await mount(); await ready(); await click('Replace key'); await field('Replacement MojoVerify API key', secret); await click('Save'); await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('may have persisted'), 'Network-uncertain save shown');
    assert(!enabled('Save')); assert.equal(key().value, ''); assert.equal(h.fixture.posts.length, 1, 'Uncertain save is not replayed'); await click('Refresh'); await ready(); assert.equal(h.fixture.posts.length, 1, 'Refresh reads only'); checks += 2; await unmount();
    h.reset('fresh-auth'); await mount(); await ready(); let fresh = 0; auth.setFreshAuthHandler(async () => { fresh++; return true; });
    await click('Replace key'); await field('Replacement MojoVerify API key', secret); await click('Test MojoVerify connection'); await wait(() => fresh === 1, 'Fresh-auth flow invoked');
    assert.equal(h.fixture.posts.length, 1); assert(!enabled('Save')); assert.equal(key().value, ''); assert(!draft()); await click('Refresh'); await ready(); auth.setFreshAuthHandler(null); checks++; await unmount();

    h.reset('ready'); await mount(); await ready(); await click('Remove key'); await login('dns.manager@nativemojo.com'); await wait(() => !document.querySelector('dialog'), 'Session change closes owned native confirmation'); assert.equal(h.fixture.posts.length, 0, 'Session loss before confirmation prevents write'); checks++; await unmount(); await login();
    h.reset('ready'); await mount(); await ready(); await click('Replace key'); await field('Replacement MojoVerify API key', secret); h.fixture.delay = 120; await click('Test MojoVerify connection'); await login('dns.manager@nativemojo.com'); await act(async () => new Promise(resolve => setTimeout(resolve, 160))); assert(!draft(), 'Late previous-session test cannot restore verdict'); assert(!document.body.textContent.includes(secret)); checks++; await unmount(); await login();
    h.reset('ready'); await mount(); await ready(); h.fixture.delay = 100; await click('Save'); await unmount(); await act(async () => new Promise(resolve => setTimeout(resolve, 130))); assert.equal(document.getElementById('root').textContent, '', 'Unmounted write response cannot restore form state'); checks++;
    console.log(`GeoLocation mounted: ${checks} permission, ordered draft, stored/draft isolation, secret-cache, clear, single-flight, stale/uncertain, fresh-auth and session/unmount checks passed`);
} finally { if (root) await act(async () => root.unmount()); qc?.clear(); await h.close(); }
