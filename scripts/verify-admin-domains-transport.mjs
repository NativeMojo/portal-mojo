import assert from 'node:assert/strict';
import { createServer } from 'vite';
globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
    const client = await server.ssrLoadModule('/packages/portal-mojo/src/client/client.ts');
    const api = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/api.ts');
    const credential = { group: 1, provider: 'godaddy', api_key: 'test-only-key', api_secret: 'test-only-secret' };
    const operations = [
        guard => api.linkDnsCredential(credential, guard),
        guard => api.rotateDnsCredential({ id: 8101, group: 1, provider: 'godaddy' }, credential, guard),
        guard => api.purchaseDomain({ group: 1, purchase: 8301, confirm_token: 'test-only', confirm_domain: 'exact.example', confirm_price: '12.00' }, guard),
        guard => api.registerExistingDomain({ group: 1, domain: 'exact.example', credential: 8101 }, guard),
        guard => api.adoptHouseDomain({ domain: 'exact.example' }, guard),
        guard => api.assignHouseDomain({ domain: 8209, group: 1 }, guard),
        guard => api.quoteDomain({ group: 1, domain: 'exact.example', years: 1 }, guard),
        guard => api.fetchRegistrantContact(1, guard),
        guard => api.saveRegistrantContact({ FirstName: 'test-only' }, 1, guard),
        guard => api.clearRegistrantContact(1, guard),
    ];
    for (const operation of operations) {
        let release, owner = true, headerReads = 0, guards = 0;
        client.installAuthHooks({ preRequest: () => new Promise(resolve => { release = resolve; }), authHeader: () => { headerReads++; return null; } });
        const pending = operation(() => { guards++; if (!owner) throw new Error('Owner replaced during auth gate'); });
        assert.equal(guards, 0, 'Consent must be checked after the async auth gate');
        owner = false; release();
        await assert.rejects(pending, /Owner replaced during auth gate/);
        assert.equal(guards, 1, 'The transport performs the final owner check');
        assert.equal(headerReads, 0, 'Replacement credentials are never stamped onto stale consent');
    }
    client.installAuthHooks(null);
    console.log('PASS ten Domains sensitive operation helpers reject replacement consent after the asynchronous auth gate, before headers or transport');
} finally { await server.close(); }
