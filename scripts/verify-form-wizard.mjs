import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { setTimeout, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

function warnings(fn) {
    const original = console.warn;
    const seen = [];
    console.warn = (...args) => seen.push(args.map(String).join(' '));
    try { return { result: fn(), seen }; } finally { console.warn = original; }
}

try {
    const tabs = await server.ssrLoadModule('/packages/portal-mojo/src/ui/Tabs.tsx');
    const wizard = await server.ssrLoadModule('/packages/portal-mojo/src/ui/FormWizard.tsx');
    const schema = await server.ssrLoadModule('/packages/portal-mojo/src/ui/schema-form-core.tsx');

    assert.equal(tabs.normalizeTabVariant(), 'underline-all');
    assert.equal(tabs.normalizeTabVariant('buttongroup'), 'btn-group');
    assert.equal(tabs.normalizeTabVariant('btngroup'), 'btn-group');
    const fallback = warnings(() => tabs.normalizeTabVariant('definitely-unknown'));
    assert.equal(fallback.result, 'underline-all');
    assert.equal(fallback.seen.length, 1, 'unknown variants warn');

    const roster = [
        { key: 'a', label: 'A', panel: null },
        { key: 'b', label: 'B', panel: null, disabled: true },
        { key: 'c', label: 'C', panel: null },
    ];
    assert.equal(tabs.effectiveTabKey('a', roster), 'a');
    assert.equal(tabs.effectiveTabKey('missing', roster), 'a', 'controlled invalid requests paint a valid fallback');
    assert.equal(tabs.effectiveTabKey('b', roster), 'a', 'disabled requests heal');
    const firstInvalid = tabs.controlledTabHealTransition('', 'missing', 'a', roster);
    assert.equal(firstInvalid.notify, 'a');
    const repeatedInvalid = tabs.controlledTabHealTransition(firstInvalid.nextNotice, 'missing', 'a', roster);
    assert.equal(repeatedInvalid.notify, null, 'one invalid episode notifies once');
    const validAgain = tabs.controlledTabHealTransition(repeatedInvalid.nextNotice, 'a', 'a', roster);
    assert.equal(validAgain.nextNotice, '', 'a valid request resets the invalid episode');
    const sameInvalidAgain = tabs.controlledTabHealTransition(validAgain.nextNotice, 'missing', 'a', roster);
    assert.equal(sameInvalidAgain.notify, 'a', 'invalid → valid → same invalid notifies again');
    assert.equal(tabs.nextTabKey(roster, 'a', 'ArrowRight'), 'c', 'disabled tabs are skipped');
    assert.equal(tabs.nextTabKey(roster, 'c', 'ArrowRight'), 'a', 'right wraps');
    assert.equal(tabs.nextTabKey(roster, 'a', 'ArrowLeft'), 'c', 'left wraps');
    assert.equal(tabs.nextTabKey(roster, 'c', 'Home'), 'a');
    assert.equal(tabs.nextTabKey(roster, 'a', 'End'), 'c');
    assert.equal(tabs.effectiveTabKey(null, roster.map((item) => ({ ...item, disabled: true }))), null);
    assert.deepEqual(tabs.normalizeTabItems([{ ...roster[0] }, { ...roster[0] }, { key: '', label: '', panel: null }]).map((item) => item.key), ['a']);

    const fields = [
        { name: 'kind', type: 'select', label: 'Kind', required: true },
        { name: 'email', type: 'email', label: 'Email', required: true, showWhen: { field: 'kind', value: 'email' } },
        { name: 'phone', type: 'tel', label: 'Phone', showWhen: { field: 'kind', value: 'phone' } },
    ];
    const values = schema.seedFormValues(fields, { kind: 'email', email: 'bad', phone: 'secret' });
    assert.deepEqual(schema.visibleSchemaFields(fields, values).map((field) => field.name), ['kind', 'email']);
    assert.deepEqual(schema.schemaPayload(fields, values), { kind: 'email', email: 'bad' }, 'hidden values do not ride payload');
    assert.equal(schema.validateSchemaFields(fields, values, 'schema-form').email, 'Enter a valid email address');
    assert.equal(schema.validateSchemaFields(fields, { kind: '', email: '', phone: '' }, 'schema-form').kind, 'Kind is required');
    assert.deepEqual(schema.reconcileFormValues({ kind: 'phone', retired: 'x' }, fields, { email: 'seed@example.com' }), { kind: 'phone', email: 'seed@example.com', phone: '' });

    const sections = [
        { key: 'one', label: 'One', fields: [{ name: 'x', type: 'text', label: 'X' }] },
        { key: 'two', label: 'Two', fields: [{ name: 'x', type: 'text', label: 'Duplicate' }, { name: 'y', type: 'text', label: 'Y' }] },
        { key: 'two', label: 'Duplicate section', fields: [] },
    ];
    const normalized = wizard.normalizeWizardSections(sections);
    assert.deepEqual(normalized.map((section) => section.key), ['one', 'two']);
    assert.deepEqual(normalized[1].fields.map((field) => field.name), ['y']);
    assert.equal(wizard.healWizardSection('gone', normalized), 'one');
    assert.equal(wizard.healWizardSection('two', normalized), 'two');
    assert.equal(wizard.normalizeWizardMode('unexpected'), 'tabs');
    const flight = wizard.createWizardSingleFlight();
    let calls = 0;
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const first = flight.run(async () => { calls += 1; await held; return 'done'; });
    assert.equal(flight.pending, true);
    assert.equal(await flight.run(() => { calls += 1; }), undefined, 'duplicate pending finish is ignored');
    assert.equal(calls, 1);
    release();
    assert.equal(await first, 'done');
    assert.equal(flight.pending, false);
    await assert.rejects(() => flight.run(() => Promise.reject(new Error('nope'))), /nope/);
    assert.equal(flight.pending, false, 'rejection re-enables finish');

    const [tabsSource, wizardSource, coreSource, formViewSource, formFieldsSource, modalSource, legacyCss] = await Promise.all([
        readFile(new URL('../packages/portal-mojo/src/ui/Tabs.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/ui/FormWizard.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/ui/schema-form-core.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/ui/FormView.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/ui/FormFields.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/ui/modal.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../apps/portal/src/theme/formview.css', import.meta.url), 'utf8'),
    ]);
    for (const token of ['role="tablist"', 'role="tab"', 'role="tabpanel"', 'aria-controls', 'aria-labelledby', 'tabIndex', 'hidden={!selected}', 'selected ? item.panel : null']) assert(tabsSource.includes(token), `Tabs ARIA/panel invariant: ${token}`);
    assert.match(tabsSource, /controlledTabHealTransition\(lastNotice\.current/, 'controlled invalid-key notification uses the resettable de-loop transition');
    assert.match(wizardSource, /finishFlight\.current\.pending/, 'finish is single-flight');
    assert.match(wizardSource, /deferReconcile: busy/, 'roster/reset reconciliation defers while pending');
    assert.match(wizardSource, /const payload = form\.payload\(acceptedFields\)/, 'finish captures roster and payload');
    assert.match(modalSource, /item\.canDismiss\?\.\(\) === false/, 'Escape/backdrop share the dynamic dismissal guard');
    assert.match(coreSource, /profile === 'wizard'/, 'SchemaForm and wizard validation profiles stay distinct');
    assert.match(coreSource, /field\.type === 'switch'[\s\S]*id=\{errorId\}[\s\S]*id=\{helpId\}/, 'switch errors/help render the aria-describedby targets');
    assert.match(formFieldsSource, /profile: 'schema-form'/);
    assert.match(formFieldsSource, /await onSubmit\(form\.payload\(\)\)/, 'SchemaForm keeps flat hidden-stripped submit');
    assert.match(formViewSource, /\.\.\.allTabs\.flatMap/, 'one autosave field roster still includes all tabs');
    assert.match(formViewSource, /items=\{visibleTabs\.map/, 'only permission-visible tabs mount');
    assert(!formViewSource.includes('useSchemaFormState'), 'FormView remains an autosave boundary');
    assert(legacyCss.includes('.fv-tabs') && legacyCss.includes('.fv-tab'), 'legacy AuthConfigDialog tab CSS remains');

    console.log('verify-form-wizard: all contracts passed');
} finally {
    await server.close();
}
