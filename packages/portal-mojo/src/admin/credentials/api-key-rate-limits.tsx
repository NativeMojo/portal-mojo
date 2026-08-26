import { useCan, type PermSpec } from '../../client/runtime';
import { Badge, SchemaForm, modal, toast, type Field, type FormData } from '../../ui';
import {
    GROUP_CREDENTIAL_PERMS, GroupApiKeyModel,
    buildApiKeyLimitPatch, readApiKeyRateLimits, validateApiKeyRateLimitInput,
    type ApiKeyRateLimitEntry, type GroupApiKeyRow,
} from './models';

function endpointLabel(rawEndpoint: string): string {
    return JSON.stringify(rawEndpoint);
}

function rawValueLabel(value: unknown): string {
    if (value === undefined) return 'undefined';
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? String(value) : serialized;
    } catch {
        return String(value);
    }
}

function entryTone(entry: ApiKeyRateLimitEntry): 'success' | 'warning' | 'danger' {
    if (entry.kind === 'valid') return 'success';
    if (entry.kind === 'reserved' || entry.kind === 'scalar') return 'danger';
    return 'warning';
}

/** Compact, bounded rate-limit state for cards and table cells. */
export function ApiKeyLimitsSummary({ limits, maxEntries = 2 }: {
    limits: unknown;
    maxEntries?: number;
}) {
    const read = readApiKeyRateLimits(limits);
    if (read.isEmpty) {
        return (
            <span className="ga-limit-summary ga-limit-summary-empty">
                <i className="bi bi-infinity" /> Unlimited (default)
            </span>
        );
    }
    if (!read.isObject || read.hasUnsafe) {
        const visible = read.entries.slice(0, Math.max(0, maxEntries));
        return (
            <span className="ga-limit-summary ga-limit-summary-review" title="Stored rate limits require review">
                <span><i className="bi bi-exclamation-triangle" /> Review required</span>
                {visible.map((entry) => (
                    <code key={entry.rawEndpoint}>{endpointLabel(entry.rawEndpoint)}</code>
                ))}
                {read.entries.length > visible.length && <span>+{read.entries.length - visible.length}</span>}
            </span>
        );
    }
    const visible = read.entries.slice(0, Math.max(0, maxEntries));
    return (
        <span className="ga-limit-summary ga-limit-summary-configured">
            {visible.map((entry) => (
                <code key={entry.rawEndpoint}>
                    {entry.rawEndpoint} {entry.override!.limit}/{entry.override!.window}m
                </code>
            ))}
            {read.entries.length > visible.length && <span>+{read.entries.length - visible.length}</span>}
            <span className="ga-limit-summary-note">all other endpoints unlimited</span>
        </span>
    );
}

const LIMIT_FIELDS: Field[] = [
    {
        name: 'limit', type: 'number', label: 'Request limit', required: true,
        min: 1, step: 1, columns: 6,
        help: 'Positive whole number; there is no fixed maximum.',
    },
    {
        name: 'window', type: 'number', label: 'Window (minutes)', required: true,
        min: 1, step: 1, columns: 6,
        help: 'Positive whole number of minutes.',
    },
];

const ADD_FIELDS: Field[] = [
    {
        name: 'endpoint', type: 'text', label: 'Endpoint key', required: true,
        placeholder: 'orders',
        help: 'The endpoint decorator bucket key. New names are trimmed and cannot be renamed.',
    },
    ...LIMIT_FIELDS,
];

function initialEntry(entry: ApiKeyRateLimitEntry): FormData {
    const raw = entry.rawValue && typeof entry.rawValue === 'object' && !Array.isArray(entry.rawValue)
        ? entry.rawValue as Record<string, unknown>
        : {};
    return {
        limit: typeof raw.limit === 'number' && Number.isInteger(raw.limit) && raw.limit > 0 ? raw.limit : '',
        window: typeof raw.window === 'number' && Number.isInteger(raw.window) && raw.window > 0 ? raw.window : '',
    };
}

/** Lossless detail editor. All mutation controls stay behind the supplied gate. */
export function ApiKeyRateLimitsEditor({ row, permission = GROUP_CREDENTIAL_PERMS }: {
    row: GroupApiKeyRow;
    permission?: PermSpec;
}) {
    const { can } = useCan(permission);
    const save = GroupApiKeyModel.useSave();
    const read = readApiKeyRateLimits(row.limits);

    const savePatch = async (patch: Record<string, unknown>, success: string) => {
        try {
            const saved = await save.mutateAsync({ id: row.id, changes: { limits: patch } });
            toast.success(success);
            return saved;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to save the rate limit override';
            toast.error(message);
            throw error instanceof Error ? error : new Error(message);
        }
    };

    const openAdd = () => {
        if (!can || !read.isObject || save.isPending) return;
        let pending = false;
        void modal.open<GroupApiKeyRow | null>((close) => (
            <div className="modal-pad">
                <h2 className="modal-title">Add rate limit override</h2>
                <p className="dim">This creates a hard per-key ceiling for one endpoint bucket.</p>
                <SchemaForm
                    fields={ADD_FIELDS}
                    submitText="Add override"
                    onBusyChange={(busy) => { pending = busy; }}
                    onCancel={() => close(null)}
                    onSubmit={async (form) => {
                        const parsed = validateApiKeyRateLimitInput(form, { existing: row.limits });
                        const saved = await savePatch(
                            buildApiKeyLimitPatch(parsed.endpoint, parsed.override),
                            'Rate limit override added',
                        );
                        close(saved);
                        return saved;
                    }}
                />
            </div>
        ), { size: 'sm', canDismiss: () => !pending });
    };

    const openEdit = (entry: ApiKeyRateLimitEntry) => {
        if (!can || !entry.canEdit || save.isPending) return;
        let pending = false;
        void modal.open<GroupApiKeyRow | null>((close) => (
            <div className="modal-pad">
                <h2 className="modal-title">{entry.kind === 'valid' ? 'Edit' : 'Repair'} rate limit override</h2>
                <p className="dim">
                    Endpoint identity is immutable: <code>{endpointLabel(entry.rawEndpoint)}</code>
                </p>
                <SchemaForm
                    fields={LIMIT_FIELDS}
                    initial={initialEntry(entry)}
                    submitText={entry.kind === 'valid' ? 'Save override' : 'Repair override'}
                    onBusyChange={(busy) => { pending = busy; }}
                    onCancel={() => close(null)}
                    onSubmit={async (form) => {
                        const parsed = validateApiKeyRateLimitInput(form, { fixedEndpoint: entry.rawEndpoint });
                        const saved = await savePatch(
                            buildApiKeyLimitPatch(entry.rawEndpoint, parsed.override, entry.rawValue),
                            entry.kind === 'valid' ? 'Rate limit override updated' : 'Rate limit override repaired',
                        );
                        close(saved);
                        return saved;
                    }}
                />
            </div>
        ), { size: 'sm', canDismiss: () => !pending });
    };

    const clearEntry = async (entry: ApiKeyRateLimitEntry) => {
        if (!can || !entry.canClear || save.isPending) return;
        const confirmed = await modal.confirm({
            title: 'Clear rate limit override?',
            message: (
                <>
                    Clear the exact stored endpoint <code>{endpointLabel(entry.rawEndpoint)}</code>?
                    Other endpoints and extension-owned values are preserved. Clearing may increase throughput.
                </>
            ),
            confirmText: 'Clear override',
            danger: true,
        });
        if (!confirmed) return;
        try {
            await savePatch(buildApiKeyLimitPatch(entry.rawEndpoint, null), 'Rate limit override cleared');
        } catch {
            // savePatch already surfaced the rejecting save through the shared toast.
        }
    };

    if (!read.isObject) {
        return (
            <div className="ga-limit-review" role="alert">
                <i className="bi bi-exclamation-triangle" />
                <div>
                    <b>Stored rate limits are malformed.</b>
                    <p>They do not create a per-key hard ceiling and cannot be edited safely here. Repair the full value through the backend.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="ga-limit-editor">
            <div className="ga-limit-head">
                <div>
                    <h3>Per-endpoint hard overrides</h3>
                    <p className="dim">Windows are stored in minutes. The backend remains authoritative on every save.</p>
                </div>
                {can && (
                    <button className="btn btn-primary btn-compact" disabled={save.isPending} onClick={openAdd}>
                        <i className="bi bi-plus-lg" /> Add override
                    </button>
                )}
            </div>

            {read.isEmpty ? (
                <div className="ga-limit-empty">
                    <b><i className="bi bi-infinity" /> Unlimited (default)</b>
                    <p>No per-key hard overrides are configured. Strict endpoint limits, positive decorator fallbacks, and enabled deployment ceilings can still apply.</p>
                </div>
            ) : (
                <>
                    {read.hasUnsafe ? (
                        <div className="ga-limit-review" role="alert">
                            <i className="bi bi-exclamation-triangle" />
                            <div><b>Review stored rate limits.</b><p>Unsafe entries are preserved and are not treated as an unlimited or valid configured state.</p></div>
                        </div>
                    ) : (
                        <p className="ga-limit-policy-note">
                            These endpoints have explicit hard ceilings; every unlisted ordinary endpoint remains unlimited by default.
                        </p>
                    )}
                    <div className="ga-limit-table-wrap">
                        <table className="ga-limit-table">
                            <thead><tr><th>Endpoint key</th><th>Limit</th><th>Window</th><th>State</th><th>Actions</th></tr></thead>
                            <tbody>
                                {read.entries.map((entry) => (
                                    <tr key={entry.rawEndpoint}>
                                        <td><code>{endpointLabel(entry.rawEndpoint)}</code></td>
                                        <td>{entry.override?.limit ?? '—'}</td>
                                        <td>{entry.override ? `${entry.override.window} min` : '—'}</td>
                                        <td>
                                            <Badge tone={entryTone(entry)}>
                                                {entry.kind === 'valid' ? 'Configured' : entry.kind === 'repairable' ? 'Repairable' : entry.kind === 'reserved' ? 'Backend repair' : 'Invalid scalar'}
                                            </Badge>
                                            {entry.issue && <small className="ga-limit-issue">{entry.issue}</small>}
                                            {entry.kind !== 'valid' && <small className="ga-limit-raw">Raw: {rawValueLabel(entry.rawValue)}</small>}
                                        </td>
                                        <td>
                                            {can && (entry.canEdit || entry.canClear) ? (
                                                <span className="ga-limit-actions">
                                                    {entry.canEdit && <button className="btn btn-compact" disabled={save.isPending} onClick={() => openEdit(entry)}>{entry.kind === 'valid' ? 'Edit' : 'Repair'}</button>}
                                                    {entry.canClear && <button className="btn btn-compact btn-danger-ghost" disabled={save.isPending} onClick={() => void clearEntry(entry)}>Clear</button>}
                                                </span>
                                            ) : <span className="dim">Read only</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
