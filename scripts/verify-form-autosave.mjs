// verify:form-autosave — executable contract for the autosave batch runner's
// `beforeSave` gate (guardrail item). Drives the real reducer + runAutosaveBatch
// (the exact function the hook binds to its refs) without a DOM:
//   · no hook   → byte-for-byte the pre-existing path (BATCH_START → SAVE_OK)
//   · false     → the batch DROPS: names revert to the snapshot, idle, no error
//   · object    → the body is REPLACED; onSaved reports what was sent
//   · await     → the window cannot re-fire (in flight); a commit meanwhile
//                 joins the NEXT batch and only this batch's names revert
//   · throw     → surfaced like a failed save (revert + pinned error + toast hook)
// The browser pass covers the rendered indicators; this pins the machine.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

const FIELDS = [
    { name: 'display_name', type: 'text', label: 'Name' },
    { name: 'permissions.manage_group', type: 'switch', label: 'Manage Group' },
    { name: 'permissions.view_logs', type: 'switch', label: 'View Logs' },
];
const ROW = { id: 1, display_name: 'Jane', permissions: { manage_group: false, view_logs: false } };

function deferred() {
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

try {
    const fa = await server.ssrLoadModule('/packages/portal-mojo/src/ui/form-autosave.ts');
    const { autosaveReducer, runAutosaveBatch, serverValuesFor, expandDotted } = fa;

    /** A hook-shaped harness: real reducer, recorded dispatches, fake timers. */
    function harness(extra = {}) {
        const server0 = serverValuesFor(FIELDS, ROW);
        const h = {
            state: { draft: { ...server0 }, server: server0, fieldState: {}, fieldError: {}, pending: {}, inflight: false },
            actions: [],
            saves: [],
            saved: [],
            failed: [],
            armed: 0,
            flashed: [],
        };
        const opts = {
            fields: FIELDS,
            row: ROW,
            save: async (body) => { h.saves.push(body); return extra.saveImpl ? extra.saveImpl(body) : { ...ROW, ...body, permissions: { ...ROW.permissions, ...(body.permissions ?? {}) } }; },
            onSaved: (info) => h.saved.push(info),
            onSaveError: (info) => h.failed.push(info),
            ...(extra.beforeSave ? { beforeSave: extra.beforeSave } : {}),
        };
        h.dispatch = (action) => { h.actions.push(action.type); h.state = autosaveReducer(h.state, action); };
        h.commit = (name, value) => h.dispatch({ type: 'COMMIT', field: FIELDS.find((f) => f.name === name), value, fields: FIELDS });
        h.fire = () => runAutosaveBatch({
            state: h.state, opts: () => opts, dispatch: h.dispatch,
            armBatchTimer: () => { h.armed += 1; }, armFlashTimer: (n) => h.flashed.push(n),
        });
        return h;
    }

    // ── 1. No hook: the pre-existing path, unchanged ──────────────────
    {
        const h = harness();
        h.commit('display_name', 'Janet');
        h.commit('permissions.view_logs', true);
        assert.deepEqual(Object.keys(h.state.pending).sort(), ['display_name', 'permissions.view_logs']);
        await h.fire();
        assert.deepEqual(h.actions, ['COMMIT', 'COMMIT', 'BATCH_START', 'SAVE_OK'], 'no-hook action sequence');
        assert.deepEqual(h.saves, [expandDotted({ display_name: 'Janet', 'permissions.view_logs': true })]);
        assert.deepEqual(h.saves[0], { display_name: 'Janet', permissions: { view_logs: true } }, 'dotted names expand on the wire');
        assert.equal(h.saved.length, 1);
        assert.deepEqual(h.saved[0].changes, h.saves[0], 'onSaved reports the body sent');
        assert.deepEqual(h.saved[0].fields.sort(), ['display_name', 'permissions.view_logs']);
        assert.equal(h.state.inflight, false);
        assert.equal(h.state.fieldState.display_name, 'saved');
        assert.equal(h.state.draft.display_name, 'Janet');
        assert.deepEqual(h.flashed.sort(), ['display_name', 'permissions.view_logs']);
        assert.equal(h.armed, 1, 'completion re-arms the window (drain)');
        assert.equal(h.failed.length, 0);
    }

    // ── 2. Veto: false drops the batch — revert, idle, no error, no POST ──
    {
        const seen = [];
        const h = harness({ beforeSave: (info) => { seen.push(info); return false; } });
        h.commit('permissions.manage_group', true);
        assert.equal(h.state.draft['permissions.manage_group'], true, 'switch shows the flipped value while pending');
        await h.fire();
        assert.equal(seen.length, 1);
        assert.deepEqual(seen[0].changes, { permissions: { manage_group: true } }, 'hook sees the wire body');
        assert.deepEqual(seen[0].names, ['permissions.manage_group'], 'hook sees the flat names');
        assert.equal(seen[0].row, ROW, 'hook sees the row');
        assert.deepEqual(h.actions, ['COMMIT', 'BATCH_START', 'BATCH_DROP'], 'veto sequence');
        assert.equal(h.saves.length, 0, 'nothing POSTed');
        assert.equal(h.state.draft['permissions.manage_group'], false, 'field reverted to the server value');
        assert.equal(h.state.fieldState['permissions.manage_group'], 'idle', 'status → idle');
        assert.equal(h.state.fieldError['permissions.manage_group'], null, 'no pinned error');
        assert.equal(h.failed.length, 0, 'no onSaveError → no toast');
        assert.equal(h.saved.length, 0);
        assert.equal(h.state.inflight, false);
        assert.deepEqual(h.state.pending, {}, 'pending is clean');
        assert.equal(h.armed, 1, 'drop re-arms the window for anything committed meanwhile');
    }

    // ── 3. Amend: an object replaces the body ─────────────────────────
    {
        const amended = { display_name: 'JANET', audit: 'renamed' };
        const h = harness({ beforeSave: () => amended });
        h.commit('display_name', 'Janet');
        await h.fire();
        assert.deepEqual(h.actions, ['COMMIT', 'BATCH_START', 'SAVE_OK']);
        assert.equal(h.saves[0], amended, 'the amended object is what POSTs');
        assert.equal(h.saved[0].changes, amended, 'onSaved reports the amended body');
        assert.deepEqual(h.saved[0].fields, ['display_name'], 'names are still the batch\'s fields');
        assert.equal(h.state.draft.display_name, 'JANET', 'the response row is the new snapshot');
        assert.equal(h.state.fieldState.display_name, 'saved');
    }

    // ── 3b. true / undefined proceed unchanged ───────────────────────
    for (const verdict of [true, undefined]) {
        const h = harness({ beforeSave: () => verdict });
        h.commit('display_name', 'Janet');
        await h.fire();
        assert.deepEqual(h.actions, ['COMMIT', 'BATCH_START', 'SAVE_OK'], `verdict ${String(verdict)} proceeds`);
        assert.deepEqual(h.saves[0], { display_name: 'Janet' });
    }

    // ── 4. Concurrent commit while the hook awaits ───────────────────
    {
        const gate = deferred();
        const seen = [];
        const h = harness({ beforeSave: (info) => { seen.push(info); return gate.promise; } });
        h.commit('permissions.manage_group', true);
        const first = h.fire();
        assert.equal(h.state.inflight, true, 'awaiting beforeSave counts as in flight');
        // The window re-fires while the hook awaits: must be a no-op (no second POST, no second hook call).
        await h.fire();
        assert.equal(seen.length, 1, 'timer re-fire during the await does not re-run the hook');
        // A different field commits during the await → next batch.
        h.commit('permissions.view_logs', true);
        assert.deepEqual(Object.keys(h.state.pending), ['permissions.view_logs'], 'mid-await commit queues for the NEXT batch');
        gate.resolve(false);
        await first;
        assert.equal(h.saves.length, 0, 'vetoed batch never POSTed');
        assert.equal(h.state.draft['permissions.manage_group'], false, 'only this batch\'s name reverted');
        assert.equal(h.state.draft['permissions.view_logs'], true, 'the mid-await commit keeps its value');
        assert.deepEqual(Object.keys(h.state.pending), ['permissions.view_logs'], 'and is still pending');
        assert.equal(h.state.inflight, false);
        assert.equal(h.armed, 1, 'the drop re-armed the window so the next batch fires');
        // The next batch carries ONLY the mid-await field and gets its own hook call.
        const gate2 = deferred();
        gate.promise = gate2.promise;
        const second = h.fire();
        assert.equal(seen.length, 2, 'next batch asks beforeSave again');
        assert.deepEqual(seen[1].names, ['permissions.view_logs']);
        assert.deepEqual(seen[1].changes, { permissions: { view_logs: true } });
        gate2.resolve(true);
        await second;
        assert.deepEqual(h.saves, [{ permissions: { view_logs: true } }], 'second batch POSTs only its own field');
        assert.equal(h.state.fieldState['permissions.view_logs'], 'saved');
        assert.equal(h.state.fieldState['permissions.manage_group'], 'idle', 'the vetoed field stayed idle');
    }

    // ── 4b. The SAME field re-committed during the await is the next batch's ──
    {
        const gate = deferred();
        const h = harness({ beforeSave: () => gate.promise });
        h.commit('display_name', 'Janet');
        const first = h.fire();
        h.commit('display_name', 'Janice');
        gate.resolve(false);
        await first;
        assert.equal(h.state.draft.display_name, 'Janice', 'a re-commit during the await is NOT reverted by the veto');
        assert.deepEqual(h.state.pending, { display_name: 'Janice' }, 'it belongs to the next batch');
        assert.equal(h.saves.length, 0);
    }

    // ── 5. A hook that throws is a failed save, not a silent veto ────
    {
        const h = harness({ beforeSave: () => { throw new Error('guard exploded'); } });
        h.commit('display_name', 'Janet');
        await h.fire();
        assert.deepEqual(h.actions, ['COMMIT', 'BATCH_START', 'SAVE_FAIL']);
        assert.equal(h.saves.length, 0, 'nothing POSTed');
        assert.equal(h.state.draft.display_name, 'Jane', 'reverted');
        assert.equal(h.state.fieldState.display_name, 'error');
        assert.equal(h.state.fieldError.display_name, 'guard exploded', 'the message is pinned');
        assert.equal(h.failed.length, 1, 'onSaveError fires (FormView toasts it)');
        assert.equal(h.failed[0].error.message, 'guard exploded');
    }
    {
        const h = harness({ beforeSave: () => Promise.reject(new Error('async guard exploded')) });
        h.commit('display_name', 'Janet');
        await h.fire();
        assert.deepEqual(h.actions, ['COMMIT', 'BATCH_START', 'SAVE_FAIL']);
        assert.equal(h.state.fieldError.display_name, 'async guard exploded');
    }

    // ── 6. With a hook that proceeds, a rejecting save still fails loudly ──
    {
        const h = harness({ beforeSave: () => true, saveImpl: () => { throw new Error('E.164 required'); } });
        h.commit('display_name', 'Janet');
        await h.fire();
        assert.deepEqual(h.actions, ['COMMIT', 'BATCH_START', 'SAVE_FAIL']);
        assert.equal(h.state.draft.display_name, 'Jane');
        assert.equal(h.failed[0].error.message, 'E.164 required');
        assert.equal(h.armed, 1);
    }

    // ── 7. Reducer: BATCH_DROP touches only its names, skips re-pending ones ──
    {
        const server0 = serverValuesFor(FIELDS, ROW);
        const before = {
            draft: { ...server0, display_name: 'Janet', 'permissions.view_logs': true, 'permissions.manage_group': true },
            server: server0,
            fieldState: { display_name: 'saving', 'permissions.view_logs': 'saving', 'permissions.manage_group': 'dirty' },
            fieldError: { display_name: 'stale', 'permissions.view_logs': null },
            pending: { 'permissions.view_logs': true },
            inflight: true,
        };
        const after = autosaveReducer(before, { type: 'BATCH_DROP', names: ['display_name', 'permissions.view_logs'] });
        assert.equal(after.draft.display_name, 'Jane');
        assert.equal(after.fieldState.display_name, 'idle');
        assert.equal(after.fieldError.display_name, null);
        assert.equal(after.draft['permissions.view_logs'], true, 're-pending name untouched');
        assert.equal(after.fieldState['permissions.view_logs'], 'saving', 're-pending name keeps its state for the next batch');
        assert.equal(after.draft['permissions.manage_group'], true, 'a name outside the batch is untouched');
        assert.equal(after.fieldState['permissions.manage_group'], 'dirty');
        assert.equal(after.inflight, false);
        assert.notEqual(after, before, 'reducer copies');
        assert.equal(before.draft.display_name, 'Janet', 'input untouched');
    }

    // ── 8. Nothing pending / already in flight → no-op ───────────────
    {
        const h = harness({ beforeSave: () => { throw new Error('must not run'); } });
        await h.fire();
        assert.deepEqual(h.actions, []);
        h.state = { ...h.state, inflight: true, pending: { display_name: 'x' } };
        await h.fire();
        assert.deepEqual(h.actions, [], 'in flight: the window re-fire is a no-op');
    }

    console.log('verify:form-autosave OK — no-hook parity, veto, amend, concurrent commit, throw, reducer');
} finally {
    await server.close();
}
