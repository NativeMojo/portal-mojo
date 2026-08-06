// Focused executable contract for DNS domains and live record sets (#1430).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

try {
    const data = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/dns-data.ts');
    const api = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/api.ts');
    const dns = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/index.ts');
    const forward = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/dns-integration.ts');
    const reverse = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/domain-links.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');

    assert.deepEqual(dns.DNS_ADMIN_SECTION.routes.map((route) => route.path), ['domains', 'records', 'credentials']);
    assert.equal(dns.DNS_ADMIN_SECTION.basePath, 'dns');
    assert(dns.DNS_ADMIN_SECTION.routes.every((route) => route.permissions === dns.DNS_VIEW_PERMISSIONS));
    assert.deepEqual(dns.DNS_MANAGE_PERMISSIONS, ['sys.manage_dns', 'sys.security']);

    for (const [type, wire] of [
        ['A', '192.0.2.1'], ['AAAA', '2001:db8::1'], ['CNAME', 'www.example.net'],
        ['TXT', 'inner "quote"'], ['MX', '10 mail.example.net'],
        ['SRV', '10 5 443 target.example.net'], ['CAA', '0 issue "letsencrypt.org"'],
        ['NS', 'ns1.example.net'],
    ]) {
        assert.equal(data.formatRecordValue(type, data.parseRecordValue(type, wire)), wire, `${type} round trip`);
    }
    for (const wire of ['  leading and trailing  ', 'multiple   inner spaces', '\tmeaningful TXT\t']) {
        assert.equal(data.formatRecordValue('TXT', data.parseRecordValue('TXT', wire)), wire, 'TXT whitespace is lossless');
        assert.equal(data.validateRecordSet({ type: 'TXT', name: 'txt', values: [wire], ttl: 300, zone: 'example.com', caps: { allowed_record_types: ['TXT'] } }).ok, true);
    }
    const explicitTxtCorrection = data.autofixFieldValue('text', '  pasted TXT  ');
    assert.equal(explicitTxtCorrection.value, 'pasted TXT');
    assert(explicitTxtCorrection.corrections.some((entry) => entry.message.includes('Trimmed')));
    for (const address of ['::', '::1', '2001:db8::1', '2001:db8:0:0:0:0:2:1', '::ffff:192.0.2.1']) assert.equal(data.isIPv6(address), true, address);
    for (const address of ['1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', '1::2::3', '12345::1', '::ffff:999.1.1.1']) assert.equal(data.isIPv6(address), false, address);
    assert.equal(data.toFqdn('@', 'Example.COM.'), 'example.com');
    assert.equal(data.toFqdn('_sip._tcp', 'example.com'), '_sip._tcp');
    assert.equal(data.isInZone('x.example.com', 'example.com'), true);
    assert.equal(data.hasValidLabels('bad.*.example.com'), false);
    assert.equal(data.relativeRecordName('example.com', 'example.com'), '@');
    assert.equal(data.recordKey({ type: 'a', name: 'WWW.EXAMPLE.COM.' }), 'A|www.example.com');

    const corrected = data.autofixRecordValue('CNAME', '\u200bHTTPS://WWW.Example.COM./path');
    assert.equal(corrected.value, 'www.example.com');
    assert(corrected.corrections.some((entry) => entry.before !== entry.after));
    assert.equal(data.autofixFieldValue('text', '“v=spf1 -all”').value, 'v=spf1 -all');
    assert.equal(data.autofixFieldValue('ipv6', '[2001:db8::1]').value, '2001:db8::1');
    assert.equal(data.autofixFieldValue('text', 'inner "quote"').corrections.length, 0);

    const caps = { allowed_record_types: [...data.DNS_RECORD_TYPES] };
    assert.equal(data.validateRecordSet({ type: 'A', name: '@', values: ['192.0.2.1'], ttl: 300, zone: 'example.com', caps }).ok, true);
    assert.equal(data.validateRecordSet({ type: 'A', name: '@', values: ['2001:db8::1'], ttl: 300, zone: 'example.com', caps }).errors[0].fix.type, 'AAAA');
    assert.equal(data.validateRecordSet({ type: 'AAAA', name: 'x', values: ['192.0.2.1'], ttl: 300, zone: 'example.com', caps }).errors[0].fix.type, 'A');
    assert.equal(data.validateRecordSet({ type: 'TXT', name: 'x', values: ['same', 'same'], ttl: 300, zone: 'example.com', caps }).ok, false);
    assert.equal(data.validateRecordSet({ type: 'NS', name: '@', values: ['ns.example.net'], ttl: 300, zone: 'example.com', caps }).ok, false);
    assert.equal(data.validateRecordSet({ type: 'NS', name: 'delegated', values: ['ns.example.net'], ttl: 300, zone: 'example.com', caps }).ok, true);
    assert.equal(data.validateRecordSet({ type: 'A', name: 'outside.example.net', values: ['192.0.2.1'], ttl: 300, zone: 'example.com', caps }).ok, false);
    assert.equal(data.validateRecordSet({ type: 'A', name: '*.x', values: ['192.0.2.1'], ttl: 59, zone: 'example.com', caps }).ok, false);
    const cname = { type: 'CNAME', name: 'www.example.com', record_values: ['example.com'], ttl: 300 };
    assert.equal(data.validateRecordSet({ type: 'A', name: 'www', values: ['192.0.2.1'], ttl: 300, zone: 'example.com', caps, existingRecords: [cname] }).ok, false);
    assert.equal(data.validateRecordSet({ type: 'CNAME', name: 'www', values: ['example.net'], ttl: 300, zone: 'example.com', caps, existingRecords: [cname], original: cname }).ok, true);
    assert.equal(data.validateRecordSet({ type: 'A', name: 'new', values: ['192.0.2.1'], ttl: 300, zone: 'example.com', caps, original: cname }).errors.some((error) => error.field === 'identity'), true);

    assert.deepEqual(data.diffRecordValues(['a', 'b', 'c'], ['b']), { added: [], removed: ['a', 'c'], unchanged: ['b'] });
    assert.deepEqual(data.diffRecordValues(['a'], ['b']), { added: ['b'], removed: ['a'], unchanged: [] });
    assert(data.recordWarnings({ type: 'MX', name: '@', values: ['10 m.example.net'], ttl: 200, zone: 'example.com', before: ['10 old.example.net', '20 old2.example.net'] }).length >= 3);
    assert.equal(data.isSpentAcmeChallenge('route53', { type: 'TXT', name: '_acme-challenge.example.com', record_values: ['retired'] }), false);
    assert.equal(data.isSpentAcmeChallenge('godaddy', { type: 'TXT', name: '_acme-challenge.example.com', record_values: ['retired'] }), true);

    const parsed = api.parseDnsRecordSetResponse({ domain: 'example.com', provider: 'route53', records: [{ type: 'A', name: 'example.com', record_values: ['192.0.2.1'], ttl: 300 }] });
    assert.equal('id' in parsed.records[0], false);
    assert.throws(() => api.parseDnsRecordSetResponse({ domain: 'example.com', provider: 'route53', records: [{ id: 'x', type: 'A', name: 'example.com', record_values: [], ttl: 300 }] }), /malformed/);
    assert.throws(() => api.parseDnsRecordSetResponse({ domain: 'example.com', provider: 'route53' }), /malformed/);
    assert.deepEqual(api.parseDnsWriteResponse({ status: true, change_id: 'change-1', provider: 'route53' }), { status: true, change_id: 'change-1', provider: 'route53' });
    assert.deepEqual(api.parseDnsWriteResponse({ status: true, change_id: null, provider: 'godaddy' }), { status: true, change_id: null, provider: 'godaddy' });
    assert.throws(() => api.parseDnsWriteResponse({ status: true, data: { status: true, change_id: 'nested', provider: 'route53' } }), /malformed/);
    assert.throws(() => api.parseDnsWriteResponse({ status: true, provider: 'godaddy' }), /malformed/);
    assert.notDeepEqual(api.dnsKeys.records(1), api.dnsKeys.records(2));

    const openingRecord = { type: 'A', name: 'example.com', record_values: ['192.0.2.1'], ttl: 300 };
    const opening = data.snapshotRecordOwner([openingRecord], 'A', 'example.com');
    const order = [];
    await api.coordinateDnsRecordOperation({
        opening, intended: { ...openingRecord, record_values: ['192.0.2.2'] },
        fetchFresh: async () => { order.push('read'); return { domain: 'example.com', provider: 'route53', records: order.length < 3 ? [openingRecord] : [{ ...openingRecord, record_values: ['192.0.2.2'] }] }; },
        write: async () => { order.push('write'); return { ok: true }; },
        reconcile: async () => { order.push('reconcile'); },
        invalidate: async () => { order.push('invalidate'); },
    });
    assert.deepEqual(order, ['read', 'write', 'read', 'reconcile', 'invalidate']);
    await assert.rejects(api.coordinateDnsRecordOperation({
        opening, intended: openingRecord,
        fetchFresh: async () => ({ domain: 'example.com', provider: 'route53', records: [{ ...openingRecord, ttl: 301 }] }),
        write: async () => { throw new Error('must not write'); },
        invalidate: async () => {},
    }), /changed/);
    let reconciled = false;
    await assert.rejects(api.coordinateDnsRecordOperation({
        opening, intended: openingRecord,
        fetchFresh: async () => ({ domain: 'example.com', provider: 'route53', records: [openingRecord] }),
        write: async () => { throw new Error('ambiguous transport'); },
        reconcile: async () => { reconciled = true; },
        invalidate: async () => {},
    }), /ambiguous transport/);
    assert.equal(reconciled, true);
    let invalidatedAfterReadFailure = false;
    let readCount = 0;
    await assert.rejects(api.coordinateDnsRecordOperation({
        opening, intended: openingRecord,
        fetchFresh: async () => { readCount += 1; if (readCount === 1) return { domain: 'example.com', provider: 'route53', records: [openingRecord] }; throw new Error('reconciliation failed'); },
        write: async () => ({ ok: true }),
        invalidate: async () => { invalidatedAfterReadFailure = true; },
    }), /reconciliation failed/);
    assert.equal(invalidatedAfterReadFailure, true, 'write invalidates even when the reconciliation GET fails');
    let invalidatedAfterPrimaryFailure = false;
    readCount = 0;
    await assert.rejects(api.coordinateDnsRecordOperation({
        opening, intended: openingRecord,
        fetchFresh: async () => { readCount += 1; if (readCount === 1) return { domain: 'example.com', provider: 'route53', records: [openingRecord] }; throw new Error('secondary reconciliation failure'); },
        write: async () => { throw new Error('primary write failure'); },
        invalidate: async () => { invalidatedAfterPrimaryFailure = true; },
    }), /primary write failure/);
    assert.equal(invalidatedAfterPrimaryFailure, true, 'primary write errors survive unconditional invalidation');

    const a = async () => 1;
    const disposeA = forward.registerDnsAdminIntegration({ resolveDomainByName: a });
    forward.registerDnsAdminIntegration({ recordsHref: (id) => `dns/records?domain=${id}` });
    assert.equal(await forward.getDnsAdminIntegration().resolveDomainByName('x'), 1);
    assert.equal(forward.getDnsAdminIntegration().recordsHref(7), 'dns/records?domain=7');
    disposeA();
    const disposeLink = reverse.registerDnsDomainLinks({ key: 'test', label: 'Test', icon: 'bi-test', route: 'test' });
    reverse.registerDnsDomainLinks({ key: 'test', label: 'Replacement', icon: 'bi-test', route: 'replacement' });
    assert.equal(reverse.getDnsDomainLinks().filter((link) => link.key === 'test').length, 1);
    assert.equal(reverse.getDnsDomainLinks()[0].label, 'Replacement');
    disposeLink();

    const login = async (email) => {
        const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } });
        return { Authorization: `Bearer ${response.data.access_token}` };
    };
    const viewer = await login('dns.viewer@nativemojo.com');
    const manager = await login('dns.manager@nativemojo.com');
    const live = await mock.mockFetch('/api/dnsman/dns', { headers: viewer, params: { domain: 8201 } });
    assert.deepEqual(Object.keys(live.data).sort(), ['domain', 'provider', 'records']);
    assert(live.data.records.every((record) => !('id' in record)));
    const denied = await mock.mockFetch('/api/dnsman/dns', { method: 'POST', headers: viewer, body: { domain: 8201, type: 'TXT', name: '_verify.acme.example', record_values: ['one'], ttl: 300 } });
    assert.equal(denied.error_code, 403);
    const written = await mock.mockFetch('/api/dnsman/dns', { method: 'POST', headers: manager, body: { domain: 8201, type: 'TXT', name: '_verify.acme.example', record_values: ['one', 'two'], ttl: 300 } });
    assert.equal(written.status, true);
    assert.deepEqual(Object.keys(written).sort(), ['change_id', 'provider', 'status']);
    assert.equal(typeof written.change_id, 'string');
    assert.equal(written.provider, 'route53');
    const refreshed = await mock.mockFetch('/api/dnsman/dns', { headers: manager, params: { domain: 8201 } });
    assert.deepEqual(refreshed.data.records.find((record) => data.recordKey(record) === 'TXT|_verify.acme.example').record_values, ['one', 'two']);
    mock.armMockDnsWriteFault('reject');
    const rejectedWrite = await mock.mockFetch('/api/dnsman/dns', { method: 'POST', headers: manager, body: { domain: 8201, type: 'TXT', name: '_fault-reject.acme.example', record_values: ['no'], ttl: 300 } });
    assert.equal(rejectedWrite.status, false);
    mock.armMockDnsWriteFault('ambiguous');
    const ambiguousWrite = await mock.mockFetch('/api/dnsman/dns', { method: 'POST', headers: manager, body: { domain: 8201, type: 'TXT', name: '_fault-ambiguous.acme.example', record_values: ['landed'], ttl: 300 } });
    assert.equal(ambiguousWrite.status, false);
    const afterAmbiguous = await mock.mockFetch('/api/dnsman/dns', { headers: manager, params: { domain: 8201 } });
    assert(afterAmbiguous.data.records.some((record) => record.name === '_fault-ambiguous.acme.example'));
    mock.armMockDnsWriteFault('reconcile');
    const reconcileWrite = await mock.mockFetch('/api/dnsman/dns', { method: 'POST', headers: manager, body: { domain: 8201, type: 'TXT', name: '_fault-reconcile.acme.example', record_values: ['landed'], ttl: 300 } });
    assert.equal(reconcileWrite.status, true);
    const failedReconcile = await mock.mockFetch('/api/dnsman/dns', { headers: manager, params: { domain: 8201 } });
    assert.equal(failedReconcile.error_code, 503);
    const recoveredReconcile = await mock.mockFetch('/api/dnsman/dns', { headers: manager, params: { domain: 8201 } });
    assert(recoveredReconcile.data.records.some((record) => record.name === '_fault-reconcile.acme.example'));
    const partial = await mock.mockFetch('/api/dnsman/dns/delete', { method: 'POST', headers: manager, body: { domain: 8201, type: 'TXT', name: '_verify.acme.example', record_values: ['one'] } });
    assert.equal(partial.error_code, 400);
    const deleted = await mock.mockFetch('/api/dnsman/dns/delete', { method: 'POST', headers: manager, body: { domain: 8201, type: 'TXT', name: '_verify.acme.example' } });
    assert.equal(deleted.status, true);
    assert.deepEqual(Object.keys(deleted).sort(), ['change_id', 'provider', 'status']);
    const godaddy = await mock.mockFetch('/api/dnsman/dns', { method: 'POST', headers: manager, body: { domain: 8202, type: 'TXT', name: 'floor.acme-byo.example', record_values: ['floor'], ttl: 60 } });
    assert.equal(godaddy.status, true);
    assert.deepEqual(godaddy, { status: true, change_id: null, provider: 'godaddy' });
    const godaddyLive = await mock.mockFetch('/api/dnsman/dns', { headers: manager, params: { domain: 8202 } });
    assert.equal(godaddyLive.data.records.find((record) => record.name === 'floor.acme-byo.example').ttl, 600);
    const godaddyDelete = await mock.mockFetch('/api/dnsman/dns/delete', { method: 'POST', headers: manager, body: { domain: 8202, type: 'TXT', name: 'floor.acme-byo.example' } });
    assert.equal(godaddyDelete.error_code, 400);
    const whitespaceWrite = await mock.mockFetch('/api/dnsman/dns', { method: 'POST', headers: manager, body: { domain: 8201, type: 'TXT', name: '_whitespace.acme.example', record_values: ['  preserve me  ', 'inner   spacing'], ttl: 300 } });
    assert.equal(whitespaceWrite.status, true);
    const whitespaceLive = await mock.mockFetch('/api/dnsman/dns', { headers: manager, params: { domain: 8201 } });
    assert.deepEqual(whitespaceLive.data.records.find((record) => record.name === '_whitespace.acme.example').record_values, ['  preserve me  ', 'inner   spacing']);
    for (const id of [8203, 8204, 8205, 8207]) {
        const response = await mock.mockFetch('/api/dnsman/dns', { headers: manager, params: { domain: id } });
        assert.equal(response.status, false, `fixture ${id} blocks`);
    }

    const apiSource = await read('packages/portal-mojo/src/admin/dns/api.ts');
    const panelSource = await read('packages/portal-mojo/src/admin/dns/DnsRecordsPanel.tsx');
    const detailSource = await read('packages/portal-mojo/src/admin/dns/DomainsPage.tsx');
    assert(!apiSource.includes('record_values?:'));
    assert.match(detailSource, /modal\.detail/);
    assert(!JSON.stringify(dns.DNS_ADMIN_SECTION.routes).includes(':id'));
    assert.match(panelSource, /DNS_MANAGE_PERMISSIONS/);
    assert.match(await read('apps/portal/src/theme.css'), /admin-dns\.css/);
    assert.match(await read('apps/showcase/src/theme.css'), /admin-dns\.css/);
    assert.match(await read('apps/showcase/src/pages/components/demos-admin-dns-records.tsx'), /<DomainsPage \/>/);
    assert.match(await read('packages/portal-mojo/docs/admin-dns-records.md'), /GET-to-POST race/);

    console.log('verify-admin-dns-records: all assertions passed');
} finally {
    await server.close();
}
