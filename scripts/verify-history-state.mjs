// verify-history-state — a package URL rewrite keeps the history entry's state (#5925).
//
// react-router keeps its own bookkeeping ({usr, key, idx}) in
// window.history.state. A replaceState({}) that only meant to tidy the address
// bar erases it: the next push stores idx NaN, and Back into the wiped entry
// skips useBlocker. This script drives the real GroupProvider and
// handleAuthCodeFromURL paths in jsdom and asserts the state survives.
//
// Method notes:
//   - VITE_MOJO_API is unset, so the transport is the in-memory mock. The
//     group case runs unauthenticated: GroupProvider's queries stay disabled.
//   - The auth asserts are made SYNCHRONOUSLY after handleAuthCodeFromURL()
//     returns — the scrub happens before the exchange is awaited. The promise
//     may settle to a user or to null; either is fine here.
//   - The source pin scans packages/portal-mojo/src and apps/portal/src/main.tsx
//     only. apps/portal/src/pages/auth/routes.tsx is left out on purpose: its
//     replaceState({}) moves to a DIFFERENT route before the router exists, so
//     the old entry's route state must not follow it.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/?keep=1#/users' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Event', 'Node', 'localStorage', 'sessionStorage']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

// What react-router leaves on the current entry; a fresh copy per case so a
// rewrite that mutates the object in place cannot pass by identity.
const seed = () => ({ usr: { draft: true }, key: 'k', idx: 3 });
const land = (url) => window.history.replaceState(seed(), '', url);

const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
const root = createRoot(document.getElementById('root'));
try {
    // ── Group switch: runs while a hash router is mounted — the real bug ──
    const { GroupProvider, useActiveGroup } = await server.ssrLoadModule('/packages/portal-mojo/src/client/group.tsx');
    let ctx = null;
    const Probe = () => { ctx = useActiveGroup(); return null; };
    land('/?keep=1#/users');
    await React.act(async () => root.render(React.createElement(QueryClientProvider, { client: qc },
        React.createElement(GroupProvider, null, React.createElement(Probe)))));
    assert.deepEqual(window.history.state, seed(), 'mounting GroupProvider must not touch history.state');

    await React.act(async () => ctx.setActiveGroup({ id: 7, name: 'G', kind: 'org' }));
    assert.equal(window.location.search, '?keep=1&group=7', 'setActiveGroup writes ?group= beside the other real-search params');
    assert.equal(window.location.hash, '#/users', 'setActiveGroup leaves the hash route alone');
    assert.deepEqual(window.history.state, seed(), 'setActiveGroup must keep history.state ({usr, key, idx})');

    await React.act(async () => ctx.clearActiveGroup());
    assert.equal(window.location.search, '?keep=1', 'clearActiveGroup removes ?group= only');
    assert.equal(window.location.hash, '#/users', 'clearActiveGroup leaves the hash route alone');
    assert.deepEqual(window.history.state, seed(), 'clearActiveGroup must keep history.state ({usr, key, idx})');
    await React.act(async () => root.render(null));

    // ── Auth code, real-search shape: /?auth_code=x#/route ──
    const { handleAuthCodeFromURL } = await server.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
    land('/?auth_code=abc&keep=1#/users');
    const first = handleAuthCodeFromURL();
    assert.equal(window.location.search, '?keep=1', 'the auth code is scrubbed from the real search string');
    assert.equal(window.location.hash, '#/users', 'the real-search scrub leaves the hash route alone');
    assert.deepEqual(window.history.state, seed(), 'handleAuthCodeFromURL (real search) must keep history.state');
    // exchangePromise is single-flight: settle this one before the next case.
    await first;

    // ── Auth code, hash-embedded shape: /#/route?auth_code=x ──
    land('/#/users?auth_code=abc&x=1');
    const second = handleAuthCodeFromURL();
    assert.equal(window.location.search, '', 'the hash-embedded scrub adds nothing to the real search string');
    assert.equal(window.location.hash, '#/users?x=1', 'the auth code is scrubbed from the hash query');
    assert.deepEqual(window.history.state, seed(), 'handleAuthCodeFromURL (hash-embedded) must keep history.state');
    await second;

    // ── Source pin: no state-wiping rewrite may come back ──
    const sources = async (dir) => (await readdir(dir, { withFileTypes: true, recursive: true }))
        .filter(entry => entry.isFile() && /\.tsx?$/.test(entry.name))
        .map(entry => join(entry.parentPath, entry.name));
    const pinned = [...await sources('packages/portal-mojo/src'), 'apps/portal/src/main.tsx'];
    assert.ok(pinned.length > 1, 'the source pin must actually read the package sources');
    for (const file of pinned) {
        assert.doesNotMatch(await readFile(file, 'utf8'), /replaceState\(\s*\{\s*\}/, `${file}: pass window.history.state to replaceState, never {}`);
    }

    console.log(`History state: group switch, group clear and both auth-code scrubs keep {usr, key, idx}; ${pinned.length} sources carry no replaceState({}).`);
} finally {
    await React.act(async () => root.unmount());
    qc.clear();
    await server.close();
    dom.window.close();
}
