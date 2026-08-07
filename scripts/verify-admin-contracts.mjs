import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const names = Object.keys(pkg.scripts).filter((name) => name.startsWith('verify:admin-') && !['verify:admin-contracts', 'verify:admin-bundles'].includes(name)).sort();
for (const name of names) execFileSync('npm', ['run', name], { cwd: root, stdio: 'inherit' });
console.log(`${names.length} admin contracts verified`);

