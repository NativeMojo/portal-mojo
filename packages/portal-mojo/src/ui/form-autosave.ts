// The FormView autosave state machine — web-mojo FormView.js ported:
// handleFieldChange (:796-822), the 300ms batch pipeline handleFieldSave/
// executeBatchSave/revertFields (:904-1044), and the showWhen resolution
// FormBuilder.js:863-888 renders declaratively.
//
// Semantics (the contract FormView renders):
//   · Edits COMMIT (select/switch change, text blur/Enter — never per
//     keystroke); each commit validates (zod), then joins the pending batch.
//   · A batch fires 300ms after the LAST commit — rapid commits (autofill,
//     tab-through) coalesce into ONE save carrying only changed fields.
//   · While a save is in flight further commits queue the NEXT batch; batches
//     never interleave (web-mojo's isSaving guard silently DROPPED the queued
//     fields — fixed here: completion re-arms the timer).
//   · Success: the response row is the new server snapshot; saved fields
//     flash 'saved' (~1.5s) then idle.
//   · Failure: the batch's fields revert to the SERVER SNAPSHOT and pin an
//     'error' with the server's message until their next successful save —
//     a failed value never sticks (Model.save resolve-on-failure heritage
//     ends at the client; this machine assumes `save` REJECTS).
//   · zod failure: the save of that field is blocked client-side; the message
//     occupies the same error slot. Hidden (showWhen) fields never queue and
//     their transient state clears.
//   · beforeSave (optional): runs once per batch BEFORE the POST, with the
//     wire body. While it awaits the batch counts as in flight (the timer
//     cannot re-fire; a commit meanwhile joins the NEXT batch). `false`
//     DROPS the batch: its names revert to the server snapshot and go idle
//     — no error, no toast (a guardrail the operator declined is not a
//     failure). An object REPLACES the body. true/undefined proceeds.
//
// Shape: ALL machine state lives in ONE reducer (draft values, server
// snapshot, per-field status, the pending batch, the in-flight flag) so every
// transition is a pure, inspectable action. The two timers — the batch window
// and the saved flash — live in refs and only ever dispatch.
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { Field, FieldValue, FieldValues, ShowWhen } from '../client/types';
import { fileRelationId, isFileRelationField } from './field-wire';

/**
 * Public per-field indicator state. The reducer stores five states plus the
 * pending-batch membership; 'pending' is derived (committed + queued, POST
 * not yet started) so the UI can spin from the moment a commit is accepted.
 */
export type AutosaveStatus = 'idle' | 'dirty' | 'pending' | 'saving' | 'saved' | 'error';

export interface FieldStatus {
    status: AutosaveStatus;
    /** zod or server message — present only while status === 'error'. */
    error?: string;
}

// ── Pure helpers (shared with SchemaForm where noted) ─────────────────

/** Resolve a dotted path ('permissions.manage_users') against a row/dict. */
export function getPath(source: unknown, path: string): unknown {
    let cur: unknown = source;
    for (const seg of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[seg];
    }
    return cur;
}

/**
 * showWhen resolution — FormBuilder semantics for the declarative rule
 * (String()-coerced membership + negate), or a live-values predicate.
 * Used by FormView AND SchemaForm (one visibility pipeline).
 */
export function resolveShowWhen(show: ShowWhen | undefined, values: FieldValues): boolean {
    if (!show) return true;
    if (typeof show === 'function') return show(values);
    const current = String(values[show.field] ?? '');
    const allowed = Array.isArray(show.value) ? show.value : [show.value];
    const matches = allowed.map((v) => String(v ?? '')).includes(current);
    return show.negate ? !matches : matches;
}

/** Server raw → controlled input value (switch → loose-truthy boolean, null → '').
 *  Arrays survive as string lists (B4 #1278: multiselect ids, daterange pairs) —
 *  String() would flatten them to 'a,b' and lose comma-carrying items. */
export function toDisplay(field: Field, raw: unknown): FieldValue {
    if (isFileRelationField(field)) return fileRelationId(raw);
    if (field.type === 'switch') return raw === true || raw === 1;
    if (Array.isArray(raw)) return raw.map((x) => String(x));
    if (raw == null) return '';
    return String(raw);
}

/** The full display-typed server snapshot for a field set against a row. */
export function serverValuesFor(fields: Field[], row: unknown): FieldValues {
    const out: FieldValues = {};
    for (const f of fields) out[f.name] = toDisplay(f, getPath(row, f.name));
    return out;
}

/**
 * Change detection between DISPLAY-typed values — FormView.valuesAreDifferent
 * port: strict boolean compare for switches, trimmed string compare for the
 * rest (so 42 vs '42' and null vs '' are NOT changes).
 */
export function valueChanged(field: Field, next: FieldValue, server: FieldValue | undefined): boolean {
    if (field.type === 'switch') return next !== (server === true);
    if (isFileRelationField(field)) return fileRelationId(next) !== fileRelationId(server);
    return String(next ?? '').trim() !== String(server ?? '').trim();
}

/** First zod issue's message, or null when valid / no schema. */
export function validateFieldValue(field: Field, value: FieldValue): string | null {
    if (!field.schema) return null;
    const result = field.schema.safeParse(value);
    if (result.success) return null;
    return result.error.issues[0]?.message ?? 'Invalid value';
}

/**
 * Expand dotted names into partial nested dicts for the wire:
 * {'permissions.a': true, 'permissions.b': false} → {permissions: {a, b}}.
 * Partial is correct — django-mojo MERGES dict bodies into JSONFields
 * (rest.py on_rest_update_jsonfield / objict.merge_dicts), it never replaces.
 */
export function expandDotted(flat: Record<string, FieldValue>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(flat)) {
        if (!key.includes('.')) {
            out[key] = value;
            continue;
        }
        const segs = key.split('.');
        let cur = out;
        for (let i = 0; i < segs.length - 1; i += 1) {
            const seg = segs[i]!;
            if (cur[seg] == null || typeof cur[seg] !== 'object') cur[seg] = {};
            cur = cur[seg] as Record<string, unknown>;
        }
        cur[segs[segs.length - 1]!] = value;
    }
    return out;
}

/** Keep only keys explicitly declared by this form. Address details are an
 * atomic multi-field gesture, but they must never become an arbitrary row
 * patch just because a provider returned an extra component. */
export function declaredFieldPatch(fields: Field[], patch: FieldValues): FieldValues {
    const names = new Set(fields.map((field) => field.name));
    return Object.fromEntries(Object.entries(patch).filter(([name]) => names.has(name)));
}

// ── Reducer ───────────────────────────────────────────────────────────

/** Reducer-side status — 'pending' is derived from `pending` membership. */
type StoredStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface AutosaveState {
    /** Controlled display values (what the inputs show). */
    draft: FieldValues;
    /** Display-typed server snapshot — the revert target and dirty baseline. */
    server: FieldValues;
    fieldState: Record<string, StoredStatus>;
    fieldError: Record<string, string | null>;
    /** Committed values awaiting the batch window (name → committed value). */
    pending: Record<string, FieldValue>;
    inflight: boolean;
}

export type AutosaveAction =
    /** Per-keystroke display update (text inputs) — marks dirty, never saves. */
    | { type: 'EDIT'; field: Field; value: FieldValue; fields: Field[] }
    /** The commit pipeline: showWhen gate → zod → change-detect → queue. */
    | { type: 'COMMIT'; field: Field; value: FieldValue; fields: Field[] }
    /** One controlled gesture that updates, validates and queues many fields. */
    | { type: 'COMMIT_PATCH'; patch: FieldValues; fields: Field[] }
    /** pending[names] → in flight ('saving'). */
    | { type: 'BATCH_START'; names: string[] }
    /** Batch settled OK: fresh snapshot; saved flash; mid-flight edits stay dirty. */
    | { type: 'SAVE_OK'; names: string[]; sent: Record<string, FieldValue>; server: FieldValues }
    /** Batch rejected: REVERT names to the snapshot, pin the server message. */
    | { type: 'SAVE_FAIL'; names: string[]; error: string }
    /** beforeSave vetoed: REVERT names to the snapshot, status idle, no error. */
    | { type: 'BATCH_DROP'; names: string[] }
    /** The ~1.5s saved flash ended. */
    | { type: 'FLASH_DONE'; name: string }
    /** The row prop changed (refetch/invalidate) or fields arrived late. */
    | { type: 'SYNC'; server: FieldValues };

/**
 * After any draft change, fields hidden by showWhen drop their queued value
 * and transient state ("hidden fields don't submit and their errors clear").
 * An in-flight ('saving') field keeps its status — the settle handles it.
 */
function applyHideCascade(state: AutosaveState, fields: Field[]): AutosaveState {
    let next = state;
    for (const f of fields) {
        if (!f.showWhen || resolveShowWhen(f.showWhen, next.draft)) continue;
        const queued = f.name in next.pending;
        const st = next.fieldState[f.name];
        const clearable = st != null && st !== 'idle' && st !== 'saving';
        if (!queued && !clearable) continue;
        const pending = { ...next.pending };
        delete pending[f.name];
        next = {
            ...next,
            pending,
            fieldState: clearable ? { ...next.fieldState, [f.name]: 'idle' } : next.fieldState,
            fieldError: clearable ? { ...next.fieldError, [f.name]: null } : next.fieldError,
        };
    }
    return next;
}

/**
 * The pure transition function. Exported for tests and instrumentation —
 * application code uses the useFormAutosave hook, never this directly.
 */
export function autosaveReducer(state: AutosaveState, action: AutosaveAction): AutosaveState {
    switch (action.type) {
        case 'EDIT': {
            const n = action.field.name;
            let s: AutosaveState = { ...state, draft: { ...state.draft, [n]: action.value } };
            const st = s.fieldState[n] ?? 'idle';
            // Typing marks dirty; 'saving' keeps spinning; 'error' pins until
            // the next commit outcome or successful save (workspec).
            if (st === 'idle' || st === 'dirty' || st === 'saved') {
                const dirty = valueChanged(action.field, action.value, s.server[n]);
                s = { ...s, fieldState: { ...s.fieldState, [n]: dirty ? 'dirty' : 'idle' } };
            }
            return applyHideCascade(s, action.fields);
        }

        case 'COMMIT': {
            const n = action.field.name;
            let s: AutosaveState = { ...state, draft: { ...state.draft, [n]: action.value } };

            // Hidden fields never save.
            if (!resolveShowWhen(action.field.showWhen, s.draft)) {
                return applyHideCascade(s, action.fields);
            }

            // Client validation blocks the save of THIS field only.
            const invalid = validateFieldValue(action.field, action.value);
            if (invalid) {
                const pending = { ...s.pending };
                delete pending[n];
                s = {
                    ...s,
                    pending,
                    fieldState: { ...s.fieldState, [n]: 'error' },
                    fieldError: { ...s.fieldError, [n]: invalid },
                };
                return applyHideCascade(s, action.fields);
            }

            // Back at the server value → nothing to save; clear transient state.
            if (!valueChanged(action.field, action.value, s.server[n])) {
                const pending = { ...s.pending };
                delete pending[n];
                s = { ...s, pending };
                const st = s.fieldState[n];
                if (st != null && st !== 'idle' && st !== 'saving') {
                    s = {
                        ...s,
                        fieldState: { ...s.fieldState, [n]: 'idle' },
                        fieldError: { ...s.fieldError, [n]: null },
                    };
                }
                return applyHideCascade(s, action.fields);
            }

            // Queue for the batch. The committed value is captured HERE —
            // later uncommitted keystrokes must not ride this batch.
            s = {
                ...s,
                pending: { ...s.pending, [n]: action.value },
                fieldState: { ...s.fieldState, [n]: 'dirty' },
                fieldError: { ...s.fieldError, [n]: null },
            };
            return applyHideCascade(s, action.fields);
        }

        case 'COMMIT_PATCH': {
            const patch = declaredFieldPatch(action.fields, action.patch);
            if (Object.keys(patch).length === 0) return state;
            let s: AutosaveState = { ...state, draft: { ...state.draft, ...patch } };
            const visible = action.fields.filter((field) =>
                field.name in patch && resolveShowWhen(field.showWhen, s.draft));

            // A place selection is one transaction. If any mapped value is
            // invalid, none of the values enters the autosave batch.
            const invalid = visible
                .map((field) => [field, validateFieldValue(field, patch[field.name]!)] as const)
                .filter(([, issue]) => issue != null);
            if (invalid.length > 0) {
                const pending = { ...s.pending };
                const fieldState = { ...s.fieldState };
                const fieldError = { ...s.fieldError };
                for (const field of visible) delete pending[field.name];
                for (const [field, issue] of invalid) {
                    fieldState[field.name] = 'error';
                    fieldError[field.name] = issue;
                }
                return applyHideCascade({ ...s, draft: state.draft, pending, fieldState, fieldError }, action.fields);
            }

            const pending = { ...s.pending };
            const fieldState = { ...s.fieldState };
            const fieldError = { ...s.fieldError };
            for (const field of visible) {
                const name = field.name;
                const value = patch[name]!;
                if (valueChanged(field, value, s.server[name])) {
                    pending[name] = value;
                    fieldState[name] = 'dirty';
                    fieldError[name] = null;
                } else {
                    delete pending[name];
                    if (fieldState[name] !== 'saving') fieldState[name] = 'idle';
                    fieldError[name] = null;
                }
            }
            s = { ...s, pending, fieldState, fieldError };
            return applyHideCascade(s, action.fields);
        }

        case 'BATCH_START': {
            const pending = { ...state.pending };
            const fieldState = { ...state.fieldState };
            for (const n of action.names) {
                delete pending[n];
                fieldState[n] = 'saving';
            }
            return { ...state, pending, fieldState, inflight: true };
        }

        case 'SAVE_OK': {
            const server = { ...state.server, ...action.server };
            const draft = { ...state.draft };
            const fieldState = { ...state.fieldState };
            const fieldError = { ...state.fieldError };
            for (const n of action.names) {
                if (n in state.pending) continue; // re-committed mid-flight — the next batch owns it
                if (draft[n] === action.sent[n]) {
                    // Untouched since the POST left: show the server's copy
                    // (it may be normalized — e.g. E.164 phone).
                    if (n in action.server) draft[n] = action.server[n]!;
                    fieldState[n] = 'saved';
                    fieldError[n] = null;
                } else {
                    // The user kept editing while the save flew — keep their text.
                    fieldState[n] = 'dirty';
                }
            }
            // Untouched fields follow the fresh snapshot (the response row is
            // server-authoritative for the whole record).
            for (const [n, v] of Object.entries(action.server)) {
                if (action.names.includes(n) || n in state.pending) continue;
                const st = fieldState[n] ?? 'idle';
                if (st === 'idle' || st === 'saved') draft[n] = v;
            }
            return { ...state, server, draft, fieldState, fieldError, inflight: false };
        }

        case 'SAVE_FAIL': {
            const draft = { ...state.draft };
            const pending = { ...state.pending };
            const fieldState = { ...state.fieldState };
            const fieldError = { ...state.fieldError };
            for (const n of action.names) {
                // REVERT to the server snapshot — the failed value never
                // sticks (revertFields port). A mid-flight re-commit is
                // dropped too: it would just fail again.
                if (n in state.server) draft[n] = state.server[n]!;
                delete pending[n];
                fieldState[n] = 'error';
                fieldError[n] = action.error;
            }
            return { ...state, draft, pending, fieldState, fieldError, inflight: false };
        }

        case 'BATCH_DROP': {
            const draft = { ...state.draft };
            const fieldState = { ...state.fieldState };
            const fieldError = { ...state.fieldError };
            for (const n of action.names) {
                // A field re-committed while beforeSave awaited belongs to the
                // NEXT batch (SAVE_OK precedent) — the veto covers only what
                // this batch carried.
                if (n in state.pending) continue;
                if (n in state.server) draft[n] = state.server[n]!;
                fieldState[n] = 'idle';
                fieldError[n] = null;
            }
            return { ...state, draft, fieldState, fieldError, inflight: false };
        }

        case 'FLASH_DONE': {
            if (state.fieldState[action.name] !== 'saved') return state;
            return { ...state, fieldState: { ...state.fieldState, [action.name]: 'idle' } };
        }

        case 'SYNC': {
            const server = { ...state.server, ...action.server };
            const draft = { ...state.draft };
            for (const [n, v] of Object.entries(action.server)) {
                if (!(n in draft)) {
                    draft[n] = v; // late-arriving field (registry tabs)
                    continue;
                }
                const st = state.fieldState[n] ?? 'idle';
                if ((st === 'idle' || st === 'saved') && !(n in state.pending)) draft[n] = v;
            }
            return { ...state, server, draft };
        }
    }
}

// ── The batch runner ──────────────────────────────────────────────────
// Pure orchestration over the reducer — exported so the contract (veto /
// amend / concurrent commit / no-hook parity) is unit-testable without a
// DOM (scripts/verify-form-autosave.mjs). The hook binds it to its refs.

export interface AutosaveBatchRunnerDeps<T> {
    /** The state snapshot at fire time. */
    state: AutosaveState;
    /** Latest options — read again at settle time (the hook's optsRef). */
    opts: () => Pick<UseFormAutosaveOptions<T>, 'fields' | 'row' | 'save' | 'beforeSave' | 'onSaved' | 'onSaveError'>;
    dispatch: (action: AutosaveAction) => void;
    /** Re-arm the batch window (drain anything committed mid-flight). */
    armBatchTimer: () => void;
    /** Start a field's saved flash. */
    armFlashTimer: (name: string) => void;
}

/**
 * Fire one batch from `state.pending`. Resolves when the batch has settled
 * (saved, failed, or dropped); resolves immediately when nothing fires
 * (in flight, or nothing pending).
 */
export function runAutosaveBatch<T>(deps: AutosaveBatchRunnerDeps<T>): Promise<void> {
    const { state: s, opts, dispatch, armBatchTimer, armFlashTimer } = deps;
    if (s.inflight) return Promise.resolve(); // completion re-arms the timer (serialize)
    const names = Object.keys(s.pending);
    if (names.length === 0) return Promise.resolve();
    const sent: Record<string, FieldValue> = { ...s.pending };
    const changes = expandDotted(sent);
    dispatch({ type: 'BATCH_START', names });

    const post = (body: Record<string, unknown>): Promise<void> => opts().save(body).then(
        (savedRow) => {
            const server = serverValuesFor(opts().fields, savedRow);
            dispatch({ type: 'SAVE_OK', names, sent, server });
            for (const n of names) armFlashTimer(n);
            opts().onSaved?.({ changes: body, fields: names, row: savedRow });
            armBatchTimer(); // drain anything committed mid-flight
        },
        (err: unknown) => fail(body, err),
    );
    const fail = (body: Record<string, unknown>, err: unknown) => {
        const error = err instanceof Error ? err : new Error('Save failed');
        dispatch({ type: 'SAVE_FAIL', names, error: error.message });
        opts().onSaveError?.({ changes: body, fields: names, error });
        armBatchTimer();
    };

    const beforeSave = opts().beforeSave;
    if (!beforeSave) return post(changes); // no hook: the pre-existing path, unchanged

    // The gate. BATCH_START already flagged inflight, so the window cannot
    // re-fire while this awaits and commits meanwhile queue the NEXT batch.
    let verdict: Promise<boolean | void | Record<string, unknown>>;
    try {
        verdict = Promise.resolve(beforeSave({ changes, names, row: opts().row }));
    } catch (err) {
        verdict = Promise.reject(err);
    }
    return verdict.then(
        (v) => {
            if (v === false) {
                dispatch({ type: 'BATCH_DROP', names });
                armBatchTimer(); // a commit made during the await fires next
                return;
            }
            const body = v !== null && typeof v === 'object' ? v : changes;
            return post(body);
        },
        (err: unknown) => fail(changes, err),
    );
}

// ── The hook ──────────────────────────────────────────────────────────

export interface AutosaveBatchInfo {
    /** The wire body the batch POSTed (dotted names expanded). */
    changes: Record<string, unknown>;
    /** Flat field names the batch carried. */
    fields: string[];
}

export interface AutosaveBeforeSaveInfo<T> {
    /** The wire body about to POST (dotted names expanded). */
    changes: Record<string, unknown>;
    /** Flat field names the batch carries (`permissions.manage_group`, …). */
    names: string[];
    /** The server row the batch edits. */
    row: T;
}

/**
 * Pre-save gate. `false` drops the batch (fields revert to server values,
 * status → idle, no error toast); an object replaces `changes`; `true` /
 * `undefined` proceeds. A thrown/rejected hook is a bug, not a veto — it is
 * surfaced like a failed save (revert + pinned error + onSaveError).
 */
export type AutosaveBeforeSave<T> = (info: AutosaveBeforeSaveInfo<T>) =>
    boolean | void | Record<string, unknown> | Promise<boolean | void | Record<string, unknown>>;

export interface UseFormAutosaveOptions<T> {
    /** EVERY saveable field — flat fields plus every tab's fields. */
    fields: Field[];
    /** The current server row: initial values, revert target, reconcile source. */
    row: T;
    /** One batch POST. MUST reject on failure (defineModel useSave contract). */
    save: (changes: Record<string, unknown>) => Promise<T>;
    /**
     * Runs before a batch POSTs. Return false to drop the batch (fields
     * revert to server values, status → idle, no error toast); return an
     * object to replace `changes`; true/undefined to proceed. While it awaits
     * the batch is in flight: the timer cannot re-fire and a commit meanwhile
     * joins the NEXT batch.
     */
    beforeSave?: AutosaveBeforeSave<T>;
    /** Batch window after the last commit (web-mojo: 300). */
    debounceMs?: number;
    /** How long the 'saved' check shows before returning to idle. */
    savedFlashMs?: number;
    onSaved?: (info: AutosaveBatchInfo & { row: T }) => void;
    onSaveError?: (info: AutosaveBatchInfo & { error: Error }) => void;
}

export interface FormAutosaveApi {
    /** Controlled display values, keyed by field name. */
    values: FieldValues;
    /** Per-field indicator state. Missing key = idle. */
    status: Record<string, FieldStatus>;
    /** Per-keystroke update (text inputs): display + dirty mark, no save. */
    setValue: (name: string, value: FieldValue) => void;
    /** The commit pipeline. Omitting `value` commits the current draft. */
    commit: (name: string, value?: FieldValue) => void;
    /** Atomic declared-field commit. One patch becomes one autosave batch. */
    commitPatch: (patch: FieldValues) => void;
    /** Visibility under showWhen against the LIVE values. */
    visible: (field: Field) => boolean;
    /** True while a POST is in flight. */
    saving: boolean;
}

export function useFormAutosave<T>(opts: UseFormAutosaveOptions<T>): FormAutosaveApi {
    const { fields, row } = opts;
    const debounceMs = opts.debounceMs ?? 300;
    const savedFlashMs = opts.savedFlashMs ?? 1500;

    const [state, dispatch] = useReducer(
        autosaveReducer,
        undefined,
        (): AutosaveState => {
            const server = serverValuesFor(fields, row);
            return {
                draft: { ...server },
                server,
                fieldState: {},
                fieldError: {},
                pending: {},
                inflight: false,
            };
        },
    );

    // Latest state/opts for timer + async callbacks (assigned every render).
    const stateRef = useRef(state);
    stateRef.current = state;
    const optsRef = useRef(opts);
    optsRef.current = opts;

    const byName = useMemo(() => {
        const map = new Map<string, Field>();
        for (const f of fields) map.set(f.name, f);
        return map;
    }, [fields]);

    // ── timers (refs; they only ever dispatch) ────────────────────────
    const batchTimerRef = useRef<number | null>(null);
    const flashTimersRef = useRef(new Map<string, number>());
    const fireBatchRef = useRef<() => void>(() => {});

    const armBatchTimer = useCallback(() => {
        if (batchTimerRef.current != null) window.clearTimeout(batchTimerRef.current);
        batchTimerRef.current = window.setTimeout(() => {
            batchTimerRef.current = null;
            fireBatchRef.current();
        }, debounceMs);
    }, [debounceMs]);

    const armFlashTimer = useCallback((name: string) => {
        const old = flashTimersRef.current.get(name);
        if (old != null) window.clearTimeout(old);
        flashTimersRef.current.set(name, window.setTimeout(() => {
            flashTimersRef.current.delete(name);
            dispatch({ type: 'FLASH_DONE', name });
        }, savedFlashMs));
    }, [savedFlashMs]);

    // ── the batch runner ──────────────────────────────────────────────
    const fireBatch = useCallback(() => {
        void runAutosaveBatch<T>({
            state: stateRef.current,
            opts: () => optsRef.current,
            dispatch,
            armBatchTimer,
            armFlashTimer,
        });
    }, [armBatchTimer, armFlashTimer]);
    fireBatchRef.current = fireBatch;

    // ── public input surface ──────────────────────────────────────────
    const setValue = useCallback((name: string, value: FieldValue) => {
        const field = byName.get(name);
        if (!field) return;
        dispatch({ type: 'EDIT', field, value, fields: optsRef.current.fields });
    }, [byName]);

    const commit = useCallback((name: string, value?: FieldValue) => {
        const field = byName.get(name);
        if (!field) return;
        const v = value !== undefined
            ? value
            : stateRef.current.draft[name] ?? toDisplay(field, undefined);
        dispatch({ type: 'COMMIT', field, value: v, fields: optsRef.current.fields });
        // Arm unconditionally: if the commit didn't queue (zod / no-change)
        // the timer fires into an unchanged pending set and no-ops.
        armBatchTimer();
    }, [armBatchTimer, byName]);

    const commitPatch = useCallback((patch: FieldValues) => {
        dispatch({ type: 'COMMIT_PATCH', patch, fields: optsRef.current.fields });
        armBatchTimer();
    }, [armBatchTimer]);

    const visible = useCallback(
        (field: Field) => resolveShowWhen(field.showWhen, state.draft),
        [state.draft],
    );

    // ── reconcile: row prop changes + late-arriving fields ────────────
    useEffect(() => {
        dispatch({ type: 'SYNC', server: serverValuesFor(fields, row) });
    }, [fields, row]);

    // Unmount: cancel timers (an in-flight POST settles into a dead reducer
    // harmlessly — React drops dispatches to unmounted components).
    useEffect(() => () => {
        if (batchTimerRef.current != null) window.clearTimeout(batchTimerRef.current);
        for (const t of flashTimersRef.current.values()) window.clearTimeout(t);
        flashTimersRef.current.clear();
    }, []);

    // ── public status (derives 'pending' from batch membership) ───────
    const status = useMemo(() => {
        const out: Record<string, FieldStatus> = {};
        const names = new Set([...Object.keys(state.fieldState), ...Object.keys(state.pending)]);
        for (const n of names) {
            const stored = state.fieldState[n] ?? 'idle';
            const effective: AutosaveStatus =
                stored === 'saving' || stored === 'error' || stored === 'saved'
                    ? stored
                    : n in state.pending ? 'pending' : stored;
            const err = state.fieldError[n];
            out[n] = effective === 'error' && err != null
                ? { status: effective, error: err }
                : { status: effective };
        }
        return out;
    }, [state.fieldState, state.fieldError, state.pending]);

    return {
        values: state.draft,
        status,
        setValue,
        commit,
        commitPatch,
        visible,
        saving: state.inflight,
    };
}
