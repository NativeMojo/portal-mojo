import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
const source = readFileSync('packages/portal-mojo/src/admin/jobs/sections/JobOperationsSection.tsx', 'utf8');
assert.match(source, /createPurgePreviewGuard/, 'Purge must bind accepted preview generations to immutable execution parameters');
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
 const { createPurgePreviewGuard } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/jobs/purge-preview.ts');
 const guard = createPurgePreviewGuard();
 const first = guard.begin({ daysOld: 30, status: null }); guard.invalidate();
 assert.equal(guard.accept(first), false, 'Late preview must not restore stale filter eligibility');
 const second = guard.begin({ daysOld: 7, status: 'failed' }); assert.equal(guard.accept(second), true);
 assert.deepEqual(guard.execution(second), { daysOld: 7, status: 'failed' });
 const third = guard.begin({ daysOld: 7, status: 'failed' }); assert.notEqual(second.id, third.id, 'Replacement preview must reset ArmedButton identity');
 assert.equal(guard.execution(second), null, 'Previously armed preview cannot execute after replacement');
 guard.accept(third); guard.dispose(); assert.equal(guard.accept(third), false); assert.equal(guard.execution(third), null, 'Unmount invalidates accepted and outstanding previews');
 assert.match(source, /key=\{preview\?\.id/);
 const { conditionRemovalEffect } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/rules/condition-removal.ts');
 assert.match(conditionRemovalEffect({ match_by: 0, is_active: true }, 3, 1), /broadens/);
 assert.match(conditionRemovalEffect({ match_by: 1, is_active: true }, 3, 1), /narrows/);
 assert.match(conditionRemovalEffect({ match_by: 0, is_active: true }, 1, 1), /active.*catch-all/);
 assert.match(conditionRemovalEffect({ match_by: 1, is_active: true }, 1, 1), /active.*catch-all/);
 assert.throws(() => conditionRemovalEffect({ match_by: 9, is_active: true }, 3, 1), /Unknown/);
 console.log('Admin modal lifecycle regressions passed: stale preview, filter tuple, replacement/rearm, unmount, ALL, ANY, final catch-all, unknown mode.');
} finally { await server.close(); }
