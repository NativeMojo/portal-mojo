import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(join(tmpdir(), 'portal-mojo-bundles-'));
const budgets = {
    portal: { entry: 1_334_285, closure: 1_620_202, defaultModule: 'AdminDashboardPage.tsx', representatives: ['UsersPage.tsx', 'IncidentsPage.tsx', 'JobDashboardPage.tsx', 'DomainsPage.tsx', 'EmailDomainsPage.tsx', 'pages.tsx'] },
    showcase: { entry: 1_455_379, closure: 1_767_246, defaultModule: 'demos-data.tsx', representatives: ['demos-admin-identity-users.tsx', 'demos-admin-incidents.tsx', 'demos-admin-dns.tsx', 'demos-admin-messaging.tsx', 'demos-admin-assistant.tsx'] },
};

function build(app, outDir) {
    const result = spawnSync(resolve(root, 'node_modules/.bin/vite'), ['build', '--manifest', '--outDir', outDir], { cwd: resolve(root, `apps/${app}`), encoding: 'utf8' });
    assert.equal(result.status, 0, `${app} production build failed:\n${result.stderr || result.stdout}`);
    return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}
function closure(manifest, starts) {
    const seen = new Set();
    const visit = (key) => { if (!key || seen.has(key)) return; seen.add(key); for (const child of manifest[key]?.imports ?? []) visit(child); };
    starts.forEach(visit); return seen;
}
async function bytes(outDir, manifest, keys) {
    let total = 0;
    for (const key of keys) { const file = manifest[key]?.file; if (file?.endsWith('.js')) total += (await stat(resolve(outDir, file))).size; }
    return total;
}
function moduleKey(manifest, suffix) {
    const matches = Object.keys(manifest).filter((key) => key.endsWith(suffix));
    assert.equal(matches.length, 1, `expected one manifest module ending ${suffix}, got ${matches.join(', ')}`);
    return matches[0];
}

try {
    for (const [app, budget] of Object.entries(budgets)) {
        const outDir = resolve(temp, app);
        const output = build(app, outDir);
        assert(!/PhoneHub[^\n]*(?:dynamic import|also statically imported)|dynamic import[^\n]*PhoneHub/i.test(output), 'PhoneHub must not produce static/dynamic overlap warnings');
        const manifest = JSON.parse(await readFile(resolve(outDir, '.vite/manifest.json'), 'utf8'));
        const entries = Object.keys(manifest).filter((key) => manifest[key].isEntry);
        assert.equal(entries.length, 1, `${app} must have exactly one production entry`);
        const entryClosure = closure(manifest, entries);
        const defaultKey = moduleKey(manifest, budget.defaultModule);
        const defaultClosure = closure(manifest, [...entryClosure, defaultKey]);
        const entryBytes = await bytes(outDir, manifest, entryClosure);
        const closureBytes = await bytes(outDir, manifest, defaultClosure);
        assert(entryBytes <= budget.entry, `${app} entry closure ${entryBytes} exceeds ${budget.entry}`);
        assert(closureBytes <= budget.closure, `${app} entry + default route closure ${closureBytes} exceeds ${budget.closure}`);
        for (const key of defaultClosure) {
            const file = manifest[key]?.file;
            if (file?.endsWith('.js')) assert((await stat(resolve(outDir, file))).size <= 500_000, `${app} eager/default chunk ${file} exceeds 500000 bytes`);
        }
        for (const suffix of budget.representatives) {
            const key = moduleKey(manifest, suffix);
            assert(!entryClosure.has(key), `${app} representative ${suffix} must remain async`);
        }
        console.log(`${app}: entry ${entryBytes} bytes; entry + default ${closureBytes} bytes`);
    }
} finally { await rm(temp, { recursive: true, force: true }); }
