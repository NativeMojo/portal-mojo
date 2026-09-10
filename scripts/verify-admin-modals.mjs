import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { scanAdminModals, scanLifecycleReferences, classifyModalEntries } from './admin-modal-scanner.mjs';
import ts from 'typescript';

const roots = ['packages/portal-mojo/src/admin', 'apps/portal/src/pages'];
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);
const targets = roots.flatMap(files).sort();
const config = ts.readConfigFile('packages/portal-mojo/tsconfig.json', ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, 'packages/portal-mojo').options;
const program = ts.createProgram(targets, options);
const sources = targets.map(path => program.getSourceFile(path));
const catalog = JSON.parse(readFileSync('scripts/admin-modal-inventory.json', 'utf8'));
const result = scanAdminModals(program, new Set(targets), catalog.reviewedMappings ?? []);
const { entries, sections, unresolved } = result;
const violations = sections.filter(section => /^(delete|danger(?: zone)?|actions?|manage|controls?|operations)$/i.test(section.label)).map(section => `${section.file}: forbidden action rail “${section.label}”`);
violations.push(...unresolved.map(item => `${item.file}: ${item.reason}: ${item.expression ?? item.fingerprint}`));
for (const source of sources) if (source.parseDiagnostics.length) violations.push(`${source.fileName}: invalid TypeScript syntax`);
// Built-in affordances are intentionally narrower than exported low-level APIs.
const review = JSON.parse(readFileSync('scripts/admin-modal-review.json', 'utf8'));
violations.push(...classifyModalEntries(entries, review.bodies));
const lifecycle = scanLifecycleReferences(program, sources);
const forbiddenNames = new Set(['FileModel.useDelete','RuleSetModel.useDelete','ScheduledTaskModel.useDelete','IPSetModel.useDelete','DnsCredentialModel.useDelete','PhoneNumberModel.useDelete','SmsModel.useDelete','PhoneConfigModel.useDelete','GroupApiKeyModel.useDelete','WebhookSubscriptionModel.useDelete','deleteShortlink','deleteFileShare','deleteMessagingRow','deleteAssistantConversation','deleteAssistantSkill']);
for (const reference of lifecycle) {
    if (forbiddenNames.has(reference.symbol)) violations.push(`${reference.file}: forbidden built-in deletion reference ${reference.symbol}`);
    else if (!review.lifecycle.some(item => item.file === reference.file && item.symbol === reference.symbol && item.fingerprint === reference.fingerprint && item.permission && item.rationale && item.runtimeCase)) violations.push(`Unreviewed retained lifecycle reference: ${JSON.stringify(reference)}`);
}
for (const retained of review.lifecycle) if (!lifecycle.some(item => item.file === retained.file && item.symbol === retained.symbol && item.fingerprint === retained.fingerprint)) violations.push(`Stale retained exception: ${retained.file}:${retained.symbol}`);
const inventoryPath = 'scripts/admin-modal-inventory.json';
if (process.argv.includes('--write-inventory')) writeFileSync(inventoryPath, JSON.stringify({ version: 1, syntax: 'Imports/aliases, generic member calls, named forwarding wrappers, literal dynamic imports, JSX bodies and literal section records. Fingerprints require explicit review for every changed expression.', entries, sections, reviewedMappings: catalog.reviewedMappings ?? [] }, null, 2) + '\n');
else {
    const expected = JSON.parse(readFileSync(inventoryPath, 'utf8')).entries;
    assert.deepEqual(sections, catalog.sections, 'Unknown, changed or stale resolved sections.');
    assert.deepEqual(entries, expected, 'Unknown, changed or stale modal expression: review its body/classification and refresh the inventory.');
}
if (violations.length) throw new Error(`Admin modal policy violations:\n${violations.join('\n')}`);
console.log(`Admin modal inventory verified: ${entries.length} expressions, ${sources.length} source files; no forbidden rails or deletion paths.`);
