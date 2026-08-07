import assert from 'node:assert/strict';
import { nextVersion, parseStableVersion } from './release.mjs';

assert.deepEqual(parseStableVersion('1.2.3'), [1, 2, 3]);
assert.throws(() => parseStableVersion('1.2.3-beta.1'), /stable SemVer/);
assert.equal(nextVersion('1.2.3', 'patch'), '1.2.4');
assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0');
assert.equal(nextVersion('1.2.3', 'major'), '2.0.0');
assert.throws(() => nextVersion('1.2.3', 'banana'), /patch, minor, or major/);

console.log('release command versioning verified');
