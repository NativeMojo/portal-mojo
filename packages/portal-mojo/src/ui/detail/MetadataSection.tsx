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
import { useState } from 'react';
import { mojoCall } from '../../client/client';
import { modal } from '../modal';
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

export function MetadataSection({ endpoint, id, metadata, onSaved, title = 'Metadata' }: {
    /** Collection endpoint — the save posts to `<endpoint>/<id>`. */
    endpoint: string;
    id: number | string;
    metadata: Record<string, unknown>;
    /** Called with the new blob after the server accepted it. */
    onSaved: (next: Record<string, unknown>) => void;
    title?: string;
}) {
    const [draft, setDraft] = useState<Draft>(null);
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const keys = Object.keys(metadata).sort();
    const busy = pending !== null;

    /** The one write path. Resolves true only when the server accepted it. */
    async function commit(next: Record<string, unknown>, token: string, message: string): Promise<boolean> {
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
        const confirmed = await modal.confirm({
            title: 'Remove entry',
            message: <>Remove metadata key <b>{key}</b>?</>,
            confirmText: 'Remove',
            danger: true,
        });
        if (!confirmed) return;
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
