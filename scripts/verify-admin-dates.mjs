// verify:admin-dates — admin row cleaners keep a date as the server sent it
// (#11145). django-mojo sends ISO 8601 strings when SERIALIZE_DATETIME_TO_ISO
// is on and epoch seconds when it is off; a cleaner that coerced with Number()
// turned every ISO date into 0 (Dec 31 1969) or null (blank). Runs under
// America/New_York, the zone WMWX reported from:
//   - the shared `temporal` cleaner keeps ISO and epoch values, and turns
//     null, '', unreadable text and objects into null, never 0;
//   - Sent Messages renders the real date and time, groups under the right
//     local day, and shows "Unavailable" for a missing or invalid date;
//   - every cleaner found by the sweep keeps an ISO date.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ZONE = 'America/New_York';
const self = fileURLToPath(import.meta.url);
if (process.env.TZ !== ZONE) {
    const run = spawnSync(process.execPath, [self], { env: { ...process.env, TZ: ZONE }, stdio: 'inherit' });
    process.exit(run.status ?? 1);
}

const { createServer } = await import('vite');
globalThis.window = { setTimeout, addEventListener() {}, removeEventListener() {}, confirm: () => true, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const load = (path) => server.ssrLoadModule(`/packages/portal-mojo/src/${path}`);

// WMWX's case: 8:47 PM Eastern on Nov 14 2026 is already Nov 15 in UTC.
const ISO_OFFSET = '2026-11-14T20:47:00-05:00';
const ISO_Z = '2026-11-15T01:47:00Z';
const EPOCH = 1794707220; // the same instant, epoch seconds
const EPOCH_FLOAT = 1794707220.5;
const SHOWN = 'Nov 14, 2026, 8:47 PM';
const DAY = '2026-11-14';
const INVALID = [null, undefined, '', '   ', 'garbage', {}, [], Number.NaN, Number.POSITIVE_INFINITY, `${ISO_Z}${' '.repeat(80)}x`];

let checks = 0;
const check = (fn) => { fn(); checks += 1; };

try {
    const { temporal } = await load('ui/date/fns.ts');
    const { fmt, groupByDay } = await load('ui/index.ts');
    const messaging = await load('admin/messaging/sanitize.ts');
    const messagingModels = await load('admin/messaging/models.ts');
    const certificates = await load('admin/dns/certificate-data.ts');
    const dns = await load('admin/dns/models.ts');
    const phonehub = await load('admin/phonehub/models.ts');
    const storage = await load('admin/storage/models.ts');

    // The shared cleaner.
    for (const value of [ISO_OFFSET, ISO_Z, EPOCH, EPOCH_FLOAT]) check(() => assert.equal(temporal(value), value, `keeps ${value}`));
    check(() => assert.equal(temporal(`  ${ISO_Z}  `), ISO_Z, 'trims a padded ISO string'));
    check(() => assert.equal(temporal('1794707220'), '1794707220', 'keeps an epoch in string clothing'));
    for (const value of INVALID) check(() => assert.equal(temporal(value), null, `drops ${JSON.stringify(value)}`));

    // Sent Messages: the reported page.
    const sent = (created) => messaging.sanitizeSentMessageRow({ id: 1, created, modified: created, mailbox: 1, to_addresses: [], cc_addresses: [], subject: 's', status: 'delivered', ses_message_id: null });
    const sentDay = groupByDay('created', { fallback: 'Unavailable' });
    for (const value of [ISO_OFFSET, ISO_Z, EPOCH]) {
        const row = sent(value);
        check(() => assert.equal(row.created, value));
        check(() => assert.equal(row.modified, value));
        check(() => assert.equal(fmt.datetime(row.created, 'Unavailable'), SHOWN, `renders ${value}`));
        check(() => assert.equal(sentDay.groupBy(row), DAY, `groups ${value} under its local day`));
    }
    check(() => assert.equal(fmt.datetime(sent(EPOCH_FLOAT).created, 'Unavailable'), SHOWN));
    for (const value of INVALID) {
        const row = sent(value);
        check(() => assert.equal(row.created, null, `no 0 for ${JSON.stringify(value)}`));
        check(() => assert.equal(fmt.datetime(row.created, 'Unavailable'), 'Unavailable'));
        check(() => assert.equal(sentDay.groupBy(row), 'Unavailable'));
    }
    check(() => assert.equal(sentDay.groupHeaderLabel('Unavailable'), 'Unavailable'));
    check(() => assert.equal(sentDay.groupHeaderLabel(DAY), 'Nov 14'.concat(new Date().getFullYear() === 2026 ? '' : ', 2026')));
    check(() => assert.equal(groupByDay('created').groupBy(sent(null)), null, 'no fallback keeps the ungrouped tail'));
    // Newest first stays the server's sort; the cleaner never reorders.
    check(() => assert.equal(messagingModels.SentMessageModel.normalizeListParams({}).sort, '-created'));
    check(() => assert.equal(messagingModels.PublicMessageModel.normalizeListParams({}).sort, '-created'));

    // Every cleaner from the sweep keeps an ISO date, and drops an invalid one.
    const iso = (row, fields, label) => { for (const field of fields) check(() => assert.equal(row[field], ISO_Z, `${label}.${field}`)); };
    const both = { created: ISO_Z, modified: ISO_Z };
    iso(messaging.sanitizeEmailDomainRow({ id: 1, name: 'x', region: 'x', status: 'ready', receiving_enabled: false, dns_mode: 'manual', ...both }), ['created', 'modified'], 'email domain');
    iso(messaging.sanitizeMailboxRow({ id: 1, email: 'a@b.test', domain: 1, ...both }), ['created', 'modified'], 'mailbox');
    iso(messaging.sanitizeTemplateRow({ id: 1, name: 'x', ...both }), ['created', 'modified'], 'template');
    const publicRow = messaging.sanitizePublicMessageRow({ id: 1, name: 'n', email: 'a@b.test', subject: 's', ...both });
    iso(publicRow, ['created', 'modified'], 'public message');
    check(() => assert.equal(fmt.datetime(messaging.sanitizePublicMessageRow({ id: 1, created: 'garbage' }).created, 'Unavailable'), 'Unavailable'));

    const certificate = certificates.sanitizeCertificateRow({ id: 1, common_name: 'a.test', status: 'active', ...both, not_before: ISO_Z, not_after: ISO_Z, renew_after: ISO_Z, domain: { id: 2, name: 'a.test', expires: ISO_Z } });
    iso(certificate, ['created', 'modified', 'not_before', 'not_after', 'renew_after'], 'certificate');
    check(() => assert.equal(certificate.domain.expires, ISO_Z, 'certificate.domain.expires'));
    const badCertificate = certificates.sanitizeCertificateRow({ id: 1, common_name: 'a.test', status: 'active', created: 'garbage', modified: {}, not_after: '' });
    check(() => assert.equal(badCertificate.created, null));
    check(() => assert.equal(badCertificate.modified, null));
    check(() => assert.equal(badCertificate.not_after, null));
    // Renewal health compares an ISO renew_after as an instant, like an epoch.
    check(() => assert.equal(certificates.deriveCertificateRenewalHealth(certificate, EPOCH + 1), 'due'));
    check(() => assert.equal(certificates.deriveCertificateRenewalHealth(certificate, EPOCH - 1), 'healthy'));
    check(() => assert.equal(certificates.deriveCertificateRenewalHealth({ ...certificate, renew_after: EPOCH }, EPOCH - 1), 'healthy'));
    check(() => assert.equal(certificates.deriveCertificateRenewalHealth({ ...certificate, renew_after: null }, EPOCH), 'unknown'));

    iso(dns.sanitizeDomainRow({ id: 1, name: 'a.test', provider: 'route53', status: 'active', ...both, expires: ISO_Z, registered_on: ISO_Z }), ['modified', 'expires', 'registered_on'], 'dns domain');
    check(() => assert.equal(dns.sanitizeDomainRow({ id: 1, name: 'a.test', expires: 'garbage' }).expires, null));

    iso(phonehub.sanitizePhoneNumberRow({ id: 1, phone_number: '+15550100', ...both, lookup_expires_at: ISO_Z, last_lookup_at: ISO_Z }), ['created', 'modified', 'lookup_expires_at', 'last_lookup_at'], 'phone number');
    iso(phonehub.sanitizeSmsRow({ id: 1, ...both, sent_at: ISO_Z, delivered_at: ISO_Z }), ['created', 'modified', 'sent_at', 'delivered_at'], 'sms');
    iso(phonehub.sanitizePhoneConfigRow({ id: 1, name: 'x', ...both }), ['created', 'modified'], 'phone config');
    check(() => assert.equal(phonehub.sanitizeSmsRow({ id: 1, created: 'garbage' }).created, null));

    iso(storage.sanitizeFileManagerRow({ id: 1, name: 'x', ...both }), ['created'], 'file manager');
    const file = storage.sanitizeFileRow({ id: 1, filename: 'a.png', ...both, renditions: { thumb: { id: 2, filename: 't.png', ...both } } });
    iso(file, ['created', 'modified'], 'file');
    iso(file.renditions.thumb, ['created', 'modified'], 'file rendition');
    iso(storage.ShortLinkShareModel.sanitizeRow({ id: 1, code: 'abc', ...both }), ['created', 'modified'], 'file share');
    check(() => assert.equal(storage.sanitizeFileRow({ id: 1, created: 'garbage' }).created, null));

    // Epoch rows are unchanged by the fix.
    check(() => assert.equal(sent(EPOCH).created, EPOCH));
    check(() => assert.equal(certificates.sanitizeCertificateRow({ id: 1, renew_after: EPOCH }).renew_after, EPOCH));
    check(() => assert.equal(phonehub.sanitizePhoneConfigRow({ id: 1, created: EPOCH }).created, EPOCH));

    console.log(`verify:admin-dates — ${checks} checks passed (${ZONE})`);
} finally {
    await server.close();
}
