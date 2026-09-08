// MetadataSection — view/edit the `metadata` blob on any django-mojo record.
// Port of web-mojo src/extensions/admin/shared/AdminMetadataSection.js.
//
//   Metadata                                              [+ Add]
//   ┌──────────────────────────────────────────────────────────┐
//   │ timezone       America/New_York                    ✎  🗑 │
//   │ signup_source  {"campaign":"q3"}       (object, read-only)│
//   └──────────────────────────────────────────────────────────┘
//
// Deviations from source:
//   · Editing is INLINE, not a modal round-trip. A rejected save must keep the
//     editor state so the operator can retry without retyping — there is no
//     editor state to keep once a modal has closed.
//   · Source read `resp.status === 200` off a never-rejecting `model.save()`
//     and toasted "Failed to save metadata" — the trap architecture rule 3
//     retires. `mojoCall` REJECTS; the rejection surfaces the server's own
//     message in a persistent inline banner (a toast alone is missable).
//   · Controlled on `metadata` (architecture rule 5): the component never
//     mirrors server state. `onSaved` is REQUIRED — it is how the owner
//     (TanStack cache, parent state) learns about the write.
//   · Every save posts the WHOLE blob, so one bad write can wipe a protected
//     key (auth_config / geofence / redemption_policy) in a single POST.
//     Removing a top-level key therefore stops on a guardrail that lists
//     the keys about to vanish; owners add `beforeSave(next, prev)` to diff
//     their own protected keys on top.
import { useState } from 'react';
import { mojoCall } from '../../client/client';
import { confirmGuardrail } from '../guardrail';
import { toast } from '../toast';

type Draft =
    | { mode: 'add'; key: string; value: string }
    | { mode: 'edit'; key: string; value: string }
    | null;

/** Objects/arrays render read-only — a string editor round-trips them lossily. */
function isBlob(value: unknown): boolean {
    return value !== null && typeof value === 'object';
}

function display(value: unknown): string {
    return isBlob(value) ? JSON.stringify(value) : String(value);
}

/**
 * Source semantics: a typed value is JSON-parsed when it can be, so `42`,
 * `true` and `{"a":1}` land as their real types and only the rest stay strings.
 */
function parseValue(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

/**
 * Default stop: a top-level key is about to leave the blob. Names every key
 * so a wipe of `auth_config` reads as exactly that, not "Remove entry?".
 */
function confirmRemovedKeys(removed: string[], next: Record<string, unknown>): Promise<boolean> {
    const one = removed.length === 1;
    const remaining = Object.keys(next).length;
    return confirmGuardrail({
        title: one ? `Remove metadata key ${removed[0]}?` : `Remove ${removed.length} metadata keys?`,
        effect: <>
            {removed.map((key, i) => <span key={key}>{i > 0 ? ', ' : ''}<code>{key}</code></span>)}
            {one ? ' leaves' : ' leave'} the record the moment this saves — the POST carries the whole blob, {remaining === 0 ? 'and it will be empty' : `${remaining} key${remaining === 1 ? '' : 's'} remain`}.
        </>,
        why: [
            <>Anything that reads {one ? 'this key' : 'these keys'} (policy, auth configuration, geofences, redemption rules) sees it missing on its next read, with no error raised here.</>,
            <>The value is not kept anywhere in this portal — re-adding the key means re-entering it by hand.</>,
        ],
        undo: 'There is no undo; re-add the key with its previous value.',
        confirmText: one ? 'Remove key' : `Remove ${removed.length} keys`,
        typeToConfirm: removed.length > 1 ? String(removed.length) : undefined,
    });
}

export function MetadataSection({ endpoint, id, metadata, onSaved, beforeSave, title = 'Metadata' }: {
    /** Collection endpoint — the save posts to `<endpoint>/<id>`. */
    endpoint: string;
    id: number | string;
    metadata: Record<string, unknown>;
    /** Called with the new blob after the server accepted it. */
    onSaved: (next: Record<string, unknown>) => void;
    /**
     * Owner gate, after the built-in removed-key stop: resolve false to
     * cancel the write (no error, editor state kept). Diff protected keys
     * between `next` and `prev` here.
     */
    beforeSave?: (next: Record<string, unknown>, prev: Record<string, unknown>) => Promise<boolean> | boolean;
    title?: string;
}) {
    const [draft, setDraft] = useState<Draft>(null);
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const keys = Object.keys(metadata).sort();
    const busy = pending !== null;

    /**
     * The one write path. Resolves true only when the server accepted it;
     * false when a gate declined (nothing posted, no error) or the POST
     * rejected (banner). Gates run BEFORE pending so the dialog is not
     * stacked over disabled controls.
     */
    async function commit(next: Record<string, unknown>, token: string, message: string): Promise<boolean> {
        const removed = Object.keys(metadata).filter((key) => !Object.prototype.hasOwnProperty.call(next, key));
        if (removed.length > 0 && !(await confirmRemovedKeys(removed, next))) return false;
        if (beforeSave && !(await beforeSave(next, metadata))) return false;
        setPending(token);
        setError(null);
        try {
            await mojoCall(`${endpoint}/${id}`, { method: 'POST', body: { metadata: next } });
            onSaved(next);
            toast.success(message);
            return true;
        } catch (err) {
            // Unmissable failure: the banner persists (a toast would not) and
            // the caller's draft below is deliberately left untouched.
            setError(err instanceof Error ? err.message : String(err));
            return false;
        } finally {
            setPending(null);
        }
    }

    async function saveDraft() {
        if (!draft) return;
        const key = draft.key.trim();
        if (!key) {
            setError('Key is required.');
            return;
        }
        if (draft.mode === 'add' && Object.prototype.hasOwnProperty.call(metadata, key)) {
            setError(`Key "${key}" already exists — edit it instead.`);
            return;
        }
        const next = { ...metadata, [key]: parseValue(draft.value) };
        const ok = await commit(next, draft.mode === 'add' ? 'add' : `edit:${key}`, draft.mode === 'add' ? 'Metadata entry added' : 'Metadata updated');
        if (ok) setDraft(null);   // a failed save keeps the editor open, populated
    }

    async function removeKey(key: string) {
        // The removed-key guardrail inside commit() is the confirm.
        const next = { ...metadata };
        delete next[key];
        await commit(next, `delete:${key}`, 'Metadata entry removed');
    }

    const renderEditor = (rowKey: string) => (
        <div className="amd-item amd-editor" key={rowKey}>
            {draft?.mode === 'add' ? (
                <input
                    className="input input-compact amd-key-input"
                    placeholder="key"
                    autoFocus
                    value={draft.key}
                    onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveDraft();
                        if (e.key === 'Escape') setDraft(null);
                    }}
                />
            ) : (
                <div className="amd-key">{draft?.key}</div>
            )}
            <input
                className="input input-compact amd-value-input"
                placeholder='value (JSON parsed when it can be: 42, true, {"a":1})'
                autoFocus={draft?.mode === 'edit'}
                value={draft?.value ?? ''}
                onChange={(e) => draft && setDraft({ ...draft, value: e.target.value })}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveDraft();
                    if (e.key === 'Escape') setDraft(null);
                }}
            />
            <div className="amd-actions">
                <button type="button" className="btn btn-primary btn-compact" disabled={busy} onClick={() => void saveDraft()}>
                    {busy ? <i className="bi bi-arrow-repeat spin" /> : <i className="bi bi-check-lg" />} Save
                </button>
                <button type="button" className="btn btn-compact" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
            </div>
        </div>
    );

    return (
        <div className="admin-metadata-section">
            <div className="amd-header">
                <h6 className="amd-title">{title}</h6>
                <button
                    type="button"
                    className="btn btn-primary btn-compact"
                    disabled={busy || draft?.mode === 'add'}
                    onClick={() => { setError(null); setDraft({ mode: 'add', key: '', value: '' }); }}
                >
                    <i className="bi bi-plus-lg" /> Add
                </button>
            </div>

            {error && (
                <div className="amd-error" role="alert">
                    <i className="bi bi-exclamation-triangle-fill" /> {error}
                </div>
            )}

            <div className="amd-list">
                {keys.length === 0 && draft?.mode !== 'add' ? (
                    <div className="amd-empty">
                        <i className="bi bi-braces" />
                        No metadata entries
                    </div>
                ) : keys.map((key) => (
                    draft?.mode === 'edit' && draft.key === key ? (
                        renderEditor(key)
                    ) : (
                        <div key={key} className="amd-item">
                            <div className="amd-key">{key}</div>
                            <div className="amd-value">
                                {isBlob(metadata[key])
                                    ? <code className="amd-blob" title="Object values are read-only here — remove and re-add to change them">{display(metadata[key])}</code>
                                    : display(metadata[key])}
                            </div>
                            <div className="amd-actions">
                                <button
                                    type="button"
                                    className="btn-icon btn-icon-sm"
                                    title={isBlob(metadata[key]) ? 'Object values are read-only' : `Edit ${key}`}
                                    aria-label={`Edit ${key}`}
                                    disabled={busy || isBlob(metadata[key])}
                                    onClick={() => { setError(null); setDraft({ mode: 'edit', key, value: display(metadata[key]) }); }}
                                >
                                    <i className="bi bi-pencil" />
                                </button>
                                <button
                                    type="button"
                                    className="btn-icon btn-icon-sm amd-remove"
                                    title={`Remove ${key}`}
                                    aria-label={`Remove ${key}`}
                                    disabled={busy}
                                    onClick={() => void removeKey(key)}
                                >
                                    {pending === `delete:${key}` ? <i className="bi bi-arrow-repeat spin" /> : <i className="bi bi-trash" />}
                                </button>
                            </div>
                        </div>
                    )
                ))}
                {draft?.mode === 'add' && renderEditor('__add__')}
            </div>
        </div>
    );
}
