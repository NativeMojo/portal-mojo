import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
    const dns = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/dns-integration.ts');
    const links = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/domain-links.ts');
    const fields = await server.ssrLoadModule('/packages/portal-mojo/src/ui/field-registry.tsx');
    assert.equal(dns.getDnsAdminIntegration(), null);
    assert.deepEqual(links.getDnsDomainLinks(), []);
    assert.equal(fields.resolveFieldRenderer('incident-handler-chain'), null);
    const mode = process.argv[2];
    if (mode === 'core') {
        await server.ssrLoadModule('/packages/portal-mojo/src/admin/core/index.ts');
        assert.equal(dns.getDnsAdminIntegration(), null);
        assert.deepEqual(links.getDnsDomainLinks(), []);
        assert.equal(fields.resolveFieldRenderer('incident-handler-chain'), null);
    } else if (mode === 'legacy') {
        await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
        assert(dns.getDnsAdminIntegration()?.recordsHref);
        assert(links.getDnsDomainLinks().length >= 6);
        assert(fields.resolveFieldRenderer('incident-handler-chain'));
    } else if (mode === 'email-first') {
        await server.ssrLoadModule('/packages/portal-mojo/src/admin/public/communications.ts');
        assert.equal(dns.getDnsAdminIntegration(), null);
        await server.ssrLoadModule('/packages/portal-mojo/src/admin/public/infrastructure.ts');
        assert(dns.getDnsAdminIntegration()?.recordsHref);
        assert(links.getDnsDomainLinks().length >= 6);
    } else throw new Error(`Unknown side-effect probe ${mode}`);
} finally { await server.close(); }

