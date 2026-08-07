import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const canary = 'raw-registrant-and-token-canary';

try {
    const dns = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/index.ts');
    const purchase = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/purchase-data.ts');
    const registrant = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/registrant-data.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    assert.deepEqual(dns.DNS_ADMIN_SECTION.routes.map((route) => route.path), ['domains', 'records', 'certificates', 'purchases', 'registrant', 'credentials']);
    assert.deepEqual(dns.getDnsDomainLinks().map((link) => link.key), ['domains', 'records', 'certificates', 'purchases', 'registrant', 'credentials']);
    assert.equal(dns.DNS_ADMIN_SECTION.routes.find((route) => route.path === 'registrant').permissions, dns.DNS_MANAGE_PERMISSIONS);

    assert.deepEqual(dns.normalizePurchaseListParams({ graph: 'basic', status: 'submitted', evil: 1 }), { graph: 'basic', status: 'submitted' });
    assert.throws(() => dns.normalizePurchaseListParams({ graph: 'default' }), /only graph=basic/);
    assert.throws(() => dns.normalizePurchaseListParams({ download_format: 'csv' }), /not available/);
    assert.equal(purchase.normalizePurchaseDomain(' Example.COM. '), 'example.com');
    assert.deepEqual(purchase.normalizeTypedTlds('.COM, net com', 3), ['com', 'net']);
    assert.throws(() => purchase.normalizeTypedTlds('com net org io', 3), /limited to 3/);
    assert.equal(purchase.decimalTupleEqual('12.00', 12), true);
    assert.equal(purchase.searchAvailabilityLabel({ available: null }), 'Registry did not answer');

    const login = async (email) => { const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } }); return { Authorization: `Bearer ${response.data.access_token}` }; };
    const manager = await login('dns.manager@nativemojo.com'); const viewer = await login('dns.viewer@nativemojo.com'); const platform = await login('dns.platform@nativemojo.com');
    mock.setMockDnsRegistrarMode('ready');
    const tri = await mock.mockFetch('/api/dnsman/registrar/search', { method: 'POST', headers: manager, body: { domains: ['available.example', 'taken.example', 'unknown.example', 'name.unsupported'] } });
    assert.deepEqual(tri.data.results.map((row) => row.available), [true, false, null, false]);
    assert.equal(tri.data.results[3].tld_supported, false);
    const overLimit = await mock.mockFetch('/api/dnsman/registrar/search', { method: 'POST', headers: manager, body: { domains: Array.from({ length: 21 }, (_, index) => `n${index}.example`) } });
    assert.equal(overLimit.error_code, 400);

    const quote = await mock.mockFetch('/api/dnsman/registrar/quote', { method: 'POST', headers: manager, body: { group: 1, domain: 'safe-buy.example', years: 2 } });
    assert.deepEqual(Object.keys(quote.data).sort(), ['currency', 'expires', 'name', 'price', 'privacy_supported', 'purchase', 'token', 'years']);
    const identity = purchase.quoteIdentity(quote.data, 1);
    assert(purchase.quoteMatches(identity, { group: 1, domain: 'safe-buy.example', years: 2, price: '12.00', currency: 'USD' }));
    const bought = await mock.mockFetch('/api/dnsman/registrar/purchase', { method: 'POST', headers: manager, body: { group: 1, purchase: quote.data.purchase, confirm_token: quote.data.token } });
    assert.deepEqual(Object.keys(bought.data).sort(), ['domain', 'name', 'operation_id', 'privacy', 'privacy_downgraded', 'purchase', 'status']);
    const replay = await mock.mockFetch('/api/dnsman/registrar/purchase', { method: 'POST', headers: manager, body: { group: 1, purchase: quote.data.purchase, confirm_token: quote.data.token } });
    assert.match(replay.error, /not valid/);
    const settled = await purchase.pollPurchaseLedger({ purchase: quote.data.purchase, delays: [0, 0], fetch: async (id) => dns.sanitizeDomainPurchaseRow((await mock.mockFetch(`/api/dnsman/purchase/${id}`, { headers: manager, params: { graph: 'default' } })).data) });
    assert.equal(settled.status, 'completed');

    const ambiguousQuote = await mock.mockFetch('/api/dnsman/registrar/quote', { method: 'POST', headers: manager, body: { group: 1, domain: 'ambiguous-buy.example', years: 1 } });
    mock.armMockRegistrarPurchaseFault('ambiguous');
    const ambiguous = await mock.mockFetch('/api/dnsman/registrar/purchase', { method: 'POST', headers: manager, body: { group: 1, purchase: ambiguousQuote.data.purchase, confirm_token: ambiguousQuote.data.token } });
    assert.equal(ambiguous.error_code, 503);
    const durable = await mock.mockFetch(`/api/dnsman/purchase/${ambiguousQuote.data.purchase}`, { headers: manager, params: { graph: 'default' } });
    assert.equal(durable.data.status, 'submitted');
    const failedQuote = await mock.mockFetch('/api/dnsman/registrar/quote', { method: 'POST', headers: manager, body: { group: 1, domain: 'failed-buy.example', years: 1 } });
    mock.armMockRegistrarPurchaseFault('failed');
    await mock.mockFetch('/api/dnsman/registrar/purchase', { method: 'POST', headers: manager, body: { group: 1, purchase: failedQuote.data.purchase, confirm_token: failedQuote.data.token } });
    const failedLedger = await mock.mockFetch(`/api/dnsman/purchase/${failedQuote.data.purchase}`, { headers: manager, params: { graph: 'default' } });
    assert.equal(failedLedger.data.status, 'failed');
    assert.match(purchase.PURCHASE_MAY_HAVE_MOVED, /Money may have moved/);

    const basic = await mock.mockFetch('/api/dnsman/purchase', { headers: viewer, params: { graph: 'basic', size: 5 } });
    assert.deepEqual(Object.keys(basic.data[0]).sort(), ['currency', 'domain_name', 'id', 'price', 'status']);
    const badGraph = await mock.mockFetch('/api/dnsman/purchase', { headers: viewer, params: { graph: 'default' } }); assert.equal(badGraph.error_code, 400);
    const groupDirect = registrant.sanitizeRegistrantResponse((await mock.mockFetch('/api/dnsman/registrant', { headers: manager, params: { group: 1 } })).data);
    assert.equal(groupDirect.source, 'database'); assert(groupDirect.contact.Fax); assert(groupDirect.contact.ExtraParams.length);
    const inherited = registrant.sanitizeRegistrantResponse((await mock.mockFetch('/api/dnsman/registrant', { headers: manager, params: { group: 2 } })).data);
    assert.equal(inherited.inherited, true); assert.deepEqual(registrant.contactDraft(inherited), {});
    const payload = registrant.contactPayload({ ...groupDirect.contact, Email: 'changed@example.invalid' }, groupDirect, { group: 1 }); assert(payload.Fax); assert(payload.ExtraParams.length);
    assert(!registrant.contactPayload(groupDirect.contact, groupDirect, { group: 2 }).ExtraParams, 'opaque extras never cross scope');
    await mock.mockFetch('/api/dnsman/registrant', { method: 'POST', headers: manager, body: { group: 1, contact: { ...groupDirect.contact, OrganizationName: canary } } });
    assert(!JSON.stringify(mock.getMockRequestHistory()).includes(canary));
    assert.equal((await mock.mockFetch('/api/dnsman/registrant', { headers: manager, params: { group: 1 } })).data.contact.OrganizationName, 'Example Operations', 'submitted PII is not persisted by the mock');
    assert.equal((await mock.mockFetch('/api/dnsman/registrant', { headers: viewer, params: { group: 1 } })).error_code, 403);
    assert.equal((await mock.mockFetch('/api/dnsman/registrant', { headers: manager })).error_code, 403);

    assert.equal((await mock.mockFetch('/api/dnsman/registrar/adopt', { method: 'POST', headers: manager, body: { domain: 'manual-house.example' } })).error_code, 403);
    const adopted = await mock.mockFetch('/api/dnsman/registrar/adopt', { method: 'POST', headers: platform, body: { domain: 'manual-house.example' } }); assert.equal(adopted.data.group, null);
    const onboarding = await read('packages/portal-mojo/src/admin/dns/DomainOnboardingDialog.tsx'); assert(!onboarding.includes('discoverHouseDomains')); assert(!onboarding.includes('/registrar/discover'));
    const wizard = await read('packages/portal-mojo/src/admin/dns/DomainPurchaseWizard.tsx'); assert.match(wizard, /quoteRef = useRef/); assert.match(wizard, /quoteRef\.current = null/); assert(!wizard.includes('useMutation'));
    const contactPage = await read('packages/portal-mojo/src/admin/dns/RegistrantContactPage.tsx'); assert(!contactPage.includes('useQuery')); assert.match(contactPage, /generation/); assert.match(contactPage, /is_superuser === true/);
    assert.match(await read('apps/showcase/src/pages/components/ComponentsPage.tsx'), /admin-dns-registrar/);
    mock.setMockDnsRegistrarMode('ready');
    console.log('verify-admin-dns-registrar: all assertions passed');
} finally { await server.close(); }
