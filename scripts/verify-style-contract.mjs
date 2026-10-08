import assert from 'node:assert/strict';
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyStyleContract } from './style-contract.mjs';

// The stylesheet contract must reject what it promises to reject (#5921
// review 67137): each case breaks a copy of the package styles one way.
const source = fileURLToPath(new URL('../packages/portal-mojo/src/styles/', import.meta.url));
const tempRoot = await mkdtemp(join(tmpdir(), 'portal-mojo-styles-'));

async function copy(name) {
    const dir = join(tempRoot, name);
    await cp(source, dir, { recursive: true });
    return dir;
}

try {
    await verifyStyleContract(await copy('unchanged'));

    const cases = [
        ['orphan component file', /must be the same set/, async (dir) => {
            await writeFile(join(dir, 'components/review-orphan.css'), '.review-orphan { color: var(--ink); }\n');
        }],
        ['token outside the contract', /required-tokens\.json must list exactly/, async (dir) => {
            await appendFile(join(dir, 'core.css'), '\n.review-token { color: var(--review-unknown); }\n');
        }],
        ['import without its layer', /may only hold package imports in layer\(portal-mojo\)/, async (dir) => {
            const index = join(dir, 'index.css');
            const css = await readFile(index, 'utf8');
            const broken = css.replace('@import "./components/popover.css" layer(portal-mojo);', '@import "./components/popover.css";');
            assert.notEqual(broken, css, 'popover.css import not found to break');
            await writeFile(index, broken);
        }],
        ['imported file missing', /ENOENT|must be the same set/, async (dir) => {
            await rm(join(dir, 'components/popover.css'));
        }],
    ];
    for (const [name, expected, breakIt] of cases) {
        const dir = await copy(name.replace(/\W+/g, '-'));
        await breakIt(dir);
        await assert.rejects(verifyStyleContract(dir), expected, `the stylesheet contract must reject: ${name}`);
    }
    console.log(`portal-mojo stylesheet contract rejects ${cases.length} broken cases`);
} finally {
    await rm(tempRoot, { recursive: true, force: true });
}
