import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const roots = ['packages/portal-mojo/src/admin', 'apps/portal/src/pages'];
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);
const targets = roots.flatMap(files).sort();
const fingerprint = text => createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 20);
const sources = targets.map(file => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
const walk = (node, visit) => { visit(node); ts.forEachChild(node, child => walk(child, visit)); };
const owner = node => { for (let p = node.parent; p; p = p.parent) { if (ts.isFunctionDeclaration(p) && p.name) return p.name.text; if (ts.isVariableDeclaration(p) && (ts.isArrowFunction(p.initializer ?? p) || ts.isFunctionExpression(p.initializer ?? p))) return p.name.getText(); } return '<module>'; };
const aliases = new Map();
for (const source of sources) {
    const map = new Map([['modal', 'modal'], ['formModal', 'formModal']]);
    walk(source, node => { if (ts.isImportSpecifier(node)) map.set(node.name.text, node.propertyName?.text ?? node.name.text); });
    aliases.set(source.fileName, map);
}
const wrappers = new Set(['formModal']);
const launcher = (node, source) => {
    if (!ts.isCallExpression(node)) return null;
    const exp = node.expression; const map = aliases.get(source.fileName);
    if (ts.isPropertyAccessExpression(exp) && map.get(exp.expression.getText()) === 'modal') return `modal.${exp.name.text}`;
    if (ts.isIdentifier(exp) && wrappers.has(map.get(exp.text) ?? exp.text)) return map.get(exp.text) ?? exp.text;
    return null;
};
// Fixed-point helper forwarding. Imported aliases and generic type arguments do
// not change the call target. Literal import() paths are separately inventoried.
for (let changed = true; changed;) {
    changed = false;
    for (const source of sources) walk(source, node => { if (!launcher(node, source)) return; const name = owner(node); if (name !== '<module>' && !/^[A-Z]/.test(name) && !wrappers.has(name)) { wrappers.add(name); changed = true; } });
}
const entries = []; const violations = [];
for (const source of sources) {
    const counters = new Map();
    walk(source, node => {
        const call = launcher(node, source);
        const tag = (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) ? node.tagName.getText() : null;
        const dynamicImport = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
        if (call || tag === 'DetailView' || tag === 'dialog' || dynamicImport) {
            const kind = call ?? (dynamicImport ? 'import' : tag);
            const symbol = owner(node); const key = `${source.fileName}:${symbol}:${kind}`; const ordinal = counters.get(key) ?? 0; counters.set(key, ordinal + 1);
            const bodies = []; walk(node, child => { if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) bodies.push(child.tagName.getText()); });
            entries.push({ id: `${key}:${ordinal}`, file: source.fileName, owner: symbol, launcher: kind, body: [...new Set(bodies)], category: kind === 'DetailView' || kind === 'modal.detail' ? 'record' : kind === 'modal.confirm' ? 'confirmation' : kind === 'formModal' ? 'editor' : dynamicImport ? 'dependency' : 'action', fingerprint: fingerprint(node.getText()), parent: symbol });
            if (dynamicImport && !ts.isStringLiteral(node.arguments[0])) violations.push(`${source.fileName}: unclassified dynamic import ${node.getText()}`);
        }
        if (ts.isObjectLiteralExpression(node)) {
            const props = new Map(node.properties.filter(ts.isPropertyAssignment).map(p => [p.name.getText().replace(/['"]/g, ''), p.initializer]));
            if (props.has('render') && props.has('key') && props.has('label')) {
                const label = props.get('label');
                if (!ts.isStringLiteral(label)) violations.push(`${source.fileName}: unclassified section label ${label.getText()}`);
                else if (/^(delete|danger(?: zone)?|actions?|manage|controls?|operations)$/i.test(label.text)) violations.push(`${source.fileName}: forbidden action rail “${label.text}”`);
            }
        }
    });
}
// Built-in affordances are intentionally narrower than exported low-level APIs.
const forbidden = {
    'credentials/group-api-keys.tsx': /actions\.deleteKey\(/,
    'credentials/webhook-subscriptions.tsx': /actions\.deleteSubscription\(/,
    'rules/RuleSetDetailPage.tsx': /RuleSetModel\.useDelete\(/,
    'jobs/ScheduledTaskDetail.tsx': /ScheduledTaskModel\.useDelete\(/,
    'network/IPSetDetail.tsx': /IPSetModel\.useDelete\(/,
    'storage/FileView.tsx': /FileModel\.useDelete\(|deleteFileShare\(/,
    'storage/FilesPage.tsx': /FileModel\.useDelete\(/,
    'shortlinks/ShortlinkDetail.tsx': /deleteShortlink\(/,
    'messaging/EmailDomainsPage.tsx': /deleteMessagingRow\(/,
    'messaging/EmailTemplatesPage.tsx': /deleteMessagingRow\(/,
    'messaging/MailboxesPage.tsx': /deleteMessagingRow\(/,
    'messaging/PublicMessagesPage.tsx': /deleteMessagingRow\(/,
    'phonehub/PhoneHubPage.tsx': /(?:PhoneNumber|Sms|PhoneConfig)Model\.useDelete\(/,
    'dns/ProviderCredentialsPage.tsx': /DnsCredentialModel\.useDelete\(/,
    'assistant/pages.tsx': /deleteAssistant(?:Conversation|Skill)\(/,
};
for (const [path, pattern] of Object.entries(forbidden)) if (pattern.test(readFileSync(`packages/portal-mojo/src/admin/${path}`, 'utf8'))) violations.push(`${path}: forbidden built-in deletion path`);
const inventoryPath = 'scripts/admin-modal-inventory.json';
if (process.argv.includes('--write-inventory')) writeFileSync(inventoryPath, JSON.stringify({ version: 1, syntax: 'Imports/aliases, generic member calls, named forwarding wrappers, literal dynamic imports, JSX bodies and literal section records. Fingerprints require explicit review for every changed expression.', entries }, null, 2) + '\n');
else {
    const expected = JSON.parse(readFileSync(inventoryPath, 'utf8')).entries;
    assert.deepEqual(entries, expected, 'Unknown, changed or stale modal expression: review its body/classification and refresh the inventory.');
}
// Scanner fixtures deliberately exercise aliases, generics and forwarding.
const fixture = ts.createSourceFile('fixture.tsx', `import { modal as dialogs } from './ui'; function child() { return dialogs.open<string>(close => <Editor />); } function parent() { return child(); }`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
aliases.set('fixture.tsx', new Map([['dialogs', 'modal']]));
const fixtureCalls = []; walk(fixture, n => { const found = launcher(n, fixture); if (found) { fixtureCalls.push(found); wrappers.add(owner(n)); } });
assert.deepEqual(fixtureCalls, ['modal.open', 'child']);
if (violations.length) throw new Error(`Admin modal policy violations:\n${violations.join('\n')}`);
console.log(`Admin modal inventory verified: ${entries.length} expressions, ${sources.length} source files; no forbidden rails or deletion paths.`);
