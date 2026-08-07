// Focused executable contract for DNSMan certificates and ACME lifecycle (#1431).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { QueryClient } from '@tanstack/react-query';

globalThis.window = {
    addEventListener() {}, removeEventListener() {}, confirm: () => true,
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout, clearTimeout,
};

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const canary = 'certificate-private-canary';

try {
    const dns = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/index.ts');
    const models = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/models.ts');
    const data = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/certificate-data.ts');
    const poller = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/CertificateLifecyclePoller.tsx');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');

    assert.deepEqual(dns.DNS_ADMIN_SECTION.routes.map((route) => route.path), ['domains', 'records', 'certificates', 'purchases', 'registrant', 'credentials']);
    assert.deepEqual(dns.getDnsDomainLinks().map((link) => link.key), ['domains', 'records', 'certificates', 'purchases', 'registrant', 'credentials']);
    assert.equal(models.CertificateModel.endpoint, '/api/dnsman/certificate');
    assert.throws(() => models.normalizeCertificateListParams({ graph: 'material' }), /only graph=default/);
    assert.throws(() => models.normalizeCertificateListParams({ download_format: 'pem' }), /not available/);
    assert.throws(() => models.normalizeCertificateListParams({ filename: 'private.pem' }), /not available/);
    assert.deepEqual(models.normalizeCertificateListParams({ graph: 'default', status__in: 'active,failed', domain__exact: 8201, evil: canary }), { graph: 'default', status__in: 'active,failed', domain__exact: 8201 });

    assert.deepEqual(data.normalizeCertificateSans([' Example.COM. ', '*.EXAMPLE.com', 'example.com', '', 1]), ['example.com', '*.example.com']);
    assert.deepEqual(data.validateCertificateNames('Example.COM.', []).names, ['example.com', '*.example.com']);
    assert.equal(data.validateCertificateNames('example.com', ['api.example.com']).errors.length, 0);
    assert.match(data.validateCertificateNames('example.com', ['example.net']).errors[0], /outside/);
    assert.match(data.validateCertificateNames('example.com', ['bad.*.example.com']).errors[0], /not a valid/);

    const raw = {
        id: 1, created: 1, modified: 1, common_name: ' SAFE.EXAMPLE. ', sans: ['safe.example.', 'safe.example.'],
        status: 'active', issuer: null, serial: null, not_before: null, not_after: 100,
        renew_after: 10, last_error: `Bearer ${canary} token=${canary}`, attempts: 2, days_remaining: 999,
        domain: { id: 9, name: 'SAFE.EXAMPLE.', provider: 'route53', status: 'active', expires: null, cert_pem: canary },
        cert_pem: canary, chain_pem: canary, private_key_pem: canary, mojo_secrets: { private_key_pem: canary },
    };
    const safe = data.sanitizeCertificateRow(raw);
    assert.equal(safe.common_name, 'safe.example');
    assert.deepEqual(safe.sans, ['safe.example']);
    assert(!JSON.stringify(safe).includes(canary));
    const queryClient = new QueryClient();
    queryClient.setQueryData(models.CertificateModel.keys.one(safe.id), safe);
    assert(!JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.state.data)).includes(canary));
    assert.equal(queryClient.getMutationCache().getAll().length, 0);

    const due = { ...safe, last_error: null, status: 'active', renew_after: 10, days_remaining: 999 };
    assert.equal(data.deriveCertificateRenewalHealth(due, 11), 'due', 'renew_after, not days_remaining, is authoritative');
    assert.equal(data.deriveCertificateRenewalHealth({ ...due, last_error: 'renewal failed' }, 11), 'renewal-error');
    assert.equal(poller.certificateNeedsLifecyclePolling(due, 11), true);
    assert.equal(poller.certificateNeedsLifecyclePolling({ ...due, last_error: 'renewal failed' }, 11), false, 'active renewal failure is terminal');
    assert.equal(poller.CERTIFICATE_POLL_INTERVAL_MS, 10_000);
    assert.equal(poller.CERTIFICATE_POLL_MAX_TICKS, 36);

    const caps = {
        acme: { configured: true, staging: false }, delegated_acme: { available: true },
    };
    const mojoDomain = { id: 2, name: 'delegated.example', provider: 'mojo', status: 'active', group: { id: 1, name: 'Acme' }, expires: null };
    const verified = { id: 1, state: 'verified', verified_at: '2026-01-01', domain: 2, domain_name: mojoDomain.name, created: null, modified: null, source: 's', target: 't', last_error_code: null };
    assert.equal(data.deriveCertificateReadiness({ domain: mojoDomain, capabilities: caps, delegations: [verified] }).mode, 'delegated');
    assert.equal(data.deriveCertificateReadiness({ domain: mojoDomain, capabilities: caps, delegations: [{ ...verified, state: 'broken' }] }).ready, false);
    assert.match(data.deriveCertificateReadiness({ domain: mojoDomain, capabilities: caps, delegations: [{ ...verified, state: 'broken' }] }).reason, /never|disabled|repair/i);
    assert.equal(data.canInspectHouseCertificate({ group: null }, false), false);
    assert.equal(data.canInspectHouseCertificate({ group: null }, true), true);

    const login = async (email) => {
        const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } });
        return { Authorization: `Bearer ${response.data.access_token}` };
    };
    const viewer = await login('dns.viewer@nativemojo.com');
    const manager = await login('dns.manager@nativemojo.com');
    const platform = await login('dns.platform@nativemojo.com');

    const config = await mock.mockFetch('/api/dnsman/config', { headers: viewer });
    assert.equal(config.data.acme.staging, true);
    const list = await mock.mockFetch('/api/dnsman/certificate', { headers: manager, params: { graph: 'default', size: 100 } });
    assert.equal(list.status, true);
    const statuses = new Set(list.data.map((row) => row.status));
    for (const status of ['pending', 'issuing', 'active', 'failed', 'revoked']) assert(statuses.has(status), status);
    assert(list.data.every((row) => !['cert_pem', 'chain_pem', 'private_key_pem', 'material_present', 'mojo_secrets'].some((key) => key in row)));
    const rawError = list.data.find((row) => row.id === 8405);
    assert(rawError.last_error.includes('private-canary'), 'live graph can carry raw backend exception text');
    assert(!JSON.stringify(data.sanitizeCertificateRow(rawError)).includes('private-canary'), 'query sanitizer redacts it before cache');

    const delegation = await mock.mockFetch('/api/dnsman/delegation', { headers: manager, params: { domain: 8208 } });
    assert.equal(delegation.data[0].state, 'broken');
    assert.deepEqual(Object.keys(delegation.data[0]).sort(), ['created', 'domain', 'domain_name', 'id', 'last_error_code', 'modified', 'source', 'state', 'target', 'verified_at']);
    assert(!JSON.stringify(delegation).includes('private-cleanup-canary'));

    const badGraph = await mock.mockFetch('/api/dnsman/certificate', { headers: manager, params: { graph: 'material' } });
    assert.equal(badGraph.error_code, 400);
    const outside = await mock.mockFetch('/api/dnsman/certificate/request', { method: 'POST', headers: manager, body: { domain: 8201, names: ['outside.example.net'] } });
    assert.equal(outside.error_code, 400);
    const broken = await mock.mockFetch('/api/dnsman/certificate/request', { method: 'POST', headers: manager, body: { domain: 8208 } });
    assert.equal(broken.error_code, 400, 'sticky broken delegation never falls back to direct DNS');
    const requested = await mock.mockFetch('/api/dnsman/certificate/request', { method: 'POST', headers: manager, body: { domain: 8204 } });
    assert.equal(requested.data.status, 'pending');
    assert.deepEqual(requested.data.sans, ['cert-only.example', '*.cert-only.example']);

    mock.setMockDnsAcmeMode('unconfigured');
    const unavailable = await mock.mockFetch('/api/dnsman/certificate/request', { method: 'POST', headers: manager, body: { domain: 8201 } });
    assert.equal(unavailable.error_code, 400);
    mock.setMockDnsAcmeMode('staging');

    const deniedHouse = await mock.mockFetch('/api/dnsman/certificate/8408', { headers: manager });
    assert.equal(deniedHouse.error_code, 403);
    const visibleHouse = await mock.mockFetch('/api/dnsman/certificate/8408', { headers: platform });
    assert.equal(visibleHouse.data.domain.name, 'house.example');
    const deniedRevoke = await mock.mockFetch('/api/dnsman/certificate/revoke', { method: 'POST', headers: manager, body: { certificate: 8408 } });
    assert.equal(deniedRevoke.error_code, 403);
    const revokedHouse = await mock.mockFetch('/api/dnsman/certificate/revoke', { method: 'POST', headers: platform, body: { certificate: 8408 } });
    assert.equal(revokedHouse.data.status, 'revoked');

    const apiSource = await read('packages/portal-mojo/src/admin/dns/api.ts');
    const detailSource = await read('packages/portal-mojo/src/admin/dns/CertificateDetail.tsx');
    const mockSource = await read('packages/portal-mojo/src/client/mock.ts');
    assert(!apiSource.includes('/certificate/material'));
    assert(!detailSource.includes('/certificate/material'));
    assert(!mockSource.includes("path === '/api/dnsman/certificate/material'"));
    assert(!apiSource.includes('useMutation'));
    assert.match(detailSource, /modal\.confirm/);
    assert.match(await read('packages/portal-mojo/src/admin/dns/CertificatesPage.tsx'), /modal\.detail/);
    assert.match(await read('apps/portal/src/theme.css'), /admin-dns-certificates\.css/);
    assert.match(await read('apps/showcase/src/theme.css'), /admin-dns-certificates\.css/);
    assert.match(await read('apps/showcase/src/pages/components/demos-admin-dns-certificates.tsx'), /<CertificatesPage \/>/);
    assert.match(await read('packages/portal-mojo/docs/admin-dns-certificates.md'), /renew_after.*authoritative/is);

    console.log('verify-admin-dns-certificates: all assertions passed');
} finally {
    await server.close();
}
