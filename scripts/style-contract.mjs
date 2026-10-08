import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// The package stylesheet contract (#5921): one self-layered, self-scanning
// entry, every component file reachable from it, and a token contract that
// lists exactly what the styles consume. Run on the source tree by
// verify-package.mjs and on the installed tarball by verify-packed-package.mjs.
// Comments are stripped before any rule is read.
export const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

export async function verifyStyleContract(stylesDir) {
    const index = stripComments(await readFile(join(stylesDir, 'index.css'), 'utf8'));
    const statements = index.split(';').map((statement) => statement.trim()).filter(Boolean);
    assert.equal(statements[0], '@layer theme, base, components, utilities, portal-mojo', 'index.css must open with the layer order, portal-mojo after utilities');
    assert.equal(statements[1], '@source "../"', 'index.css must scan the package source right after the layer order');
    const imported = [];
    for (const statement of statements.slice(2)) {
        const match = /^@import "\.\/(components\/[\w-]+\.css|core\.css)" layer\(portal-mojo\)$/.exec(statement);
        assert(match, `index.css may only hold package imports in layer(portal-mojo): ${statement}`);
        imported.push(match[1]);
    }
    assert.equal(imported.at(-1), 'core.css', 'index.css must import core.css last, after every component file');
    assert.equal(new Set(imported).size, imported.length, 'index.css must import each styles file once');
    const onDisk = (await readdir(join(stylesDir, 'components'))).filter((name) => name.endsWith('.css')).map((name) => `components/${name}`).sort();
    assert.deepEqual(imported.slice(0, -1).sort(), onDisk, 'src/styles/components and the index.css imports must be the same set');

    // Tokens: a var() with no fallback is either declared by the package's own
    // styles (component-private) or part of the contract the app must meet.
    const consumed = new Set();
    const declared = new Set();
    for (const file of imported) {
        const css = stripComments(await readFile(join(stylesDir, file), 'utf8'));
        for (const match of css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) consumed.add(match[1]);
        for (const match of css.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)) declared.add(match[1]);
    }
    const contract = JSON.parse(await readFile(join(stylesDir, 'required-tokens.json'), 'utf8'));
    const undeclared = Object.keys(contract.knownUndeclared ?? {});
    const needed = [...consumed].filter((name) => !declared.has(name)).sort();
    assert.deepEqual([...contract.required, ...undeclared].sort(), needed, 'required-tokens.json must list exactly the tokens the package styles consume without a fallback and do not declare');
    assert.deepEqual(contract.required, [...contract.required].sort(), 'required-tokens.json must keep its list sorted');
    return { imported, contract };
}
