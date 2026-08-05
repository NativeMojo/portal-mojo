// API Keys — the /api/account/api_keys (UserAPIKey) screen, columns and
// flows measured against the LIVE backend (mverify @9009, 2026-08-05):
//   · rows {id, label, allowed_ips, expires, is_active, last_used, created}
//   · create is POST /api/auth/generate_api_key (label / allowed_ips /
//     expire_days ≤ 360) → {id, jti, expires, token} — the token's ONE
//     appearance, so the reveal dialog is show-once (GroupView
//     _showApiKeyTokenDialog recipe)
//   · `revoke` POST_SAVE_ACTION rotates the signing secret + deactivates —
//     irreversible, hence the ARMED-BUTTON idiom, not a confirm dialog
//   · disable/enable is a plain is_active save — reversible, hence
//     act-immediately + grace-window UNDO TOAST (no confirm)
//   · no DELETE (CAN_DELETE false server-side)
// NOTE: the group-scoped /api/group/apikey surface 500s on the live dev
// backend — this user-key surface is the one that works today.
import { useQueryClient } from '@tanstack/react-query';
import { mojoCall } from 'portal-mojo/client';
import {
    Badge, fmt, formModal, modal, toast, ModelTable,
    ArmedButton,
    type Column, type FilterDef,
} from 'portal-mojo/ui';
import { ApiKeyModel, type ApiKeyRow } from '../models';

const nowSec = () => Math.floor(Date.now() / 1000);

const COLUMNS: Column<ApiKeyRow>[] = [
    {
        key: 'label', label: 'Key', sortable: true, hideable: false, render: (k) => (
            <div className="cell-user">
                <span className="cell-avatar" style={{ fontSize: 13 }}><i className="bi bi-key" /></span>
                <span>
                    <span className="cell-name">{k.label || <span className="dim-italic">Unlabeled key</span>}</span>
                    <span className="cell-sub">#{k.id}</span>
                </span>
            </div>
        ),
    },
    {
        key: 'is_active', label: 'Status', render: (k) =>
            !k.is_active ? <Badge tone="muted">Inactive</Badge>
            : k.expires <= nowSec() ? <Badge tone="danger">Expired</Badge>
            : <Badge tone="success">Active</Badge>,
    },
    {
        key: 'allowed_ips', label: 'Allowed IPs', render: (k) =>
            k.allowed_ips.length > 0
                ? <code className="dim">{k.allowed_ips.join(', ')}</code>
                : <span className="dim">Any</span>,
    },
    { key: 'created', label: 'Created', sortable: true, render: (k) => fmt.date(k.created) },
    {
        key: 'expires', label: 'Expires', sortable: true, render: (k) => (
            <span style={k.expires <= nowSec() ? { color: 'var(--bad)' } : undefined}>{fmt.date(k.expires)}</span>
        ),
    },
    { key: 'last_used', label: 'Last used', sortable: true, render: (k) => fmt.relative(k.last_used, 'never') },
];

const FILTERS: FilterDef[] = [
    { key: 'label', label: 'Label', type: 'text', placeholder: 'Contains…' },
    { key: 'is_active', label: 'Status', type: 'boolean', trueLabel: 'Active', falseLabel: 'Inactive' },
    { key: 'created', label: 'Created', type: 'daterange' },
    { key: 'expires', label: 'Expires', type: 'daterange' },
];

/**
 * Show-once token reveal — the GroupView recipe: loud "not shown again"
 * banner, selectable monospace token, copy affordance. Deliberately a modal
 * the user must dismiss (no auto-close).
 */
function revealToken(token: string, label: string) {
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(token);
            toast.success('Token copied to clipboard');
        } catch {
            toast.error('Copy failed — select the token text instead');
        }
    };
    void modal.open((close) => (
        <div className="modal-pad">
            <h2 className="modal-title"><i className="bi bi-check-circle-fill text-ok" /> API key created</h2>
            <p><b>{label || 'Unlabeled key'}</b> is ready.</p>
            <p className="dim" style={{ margin: '6px 0 10px' }}>
                <i className="bi bi-exclamation-triangle-fill" style={{ color: 'var(--warn)' }} /> Save this token now — it will not be shown again.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--line)' }}>
                <code style={{ userSelect: 'all', wordBreak: 'break-all', flex: 1 }}>{token}</code>
                <button className="btn-icon" title="Copy token" aria-label="Copy token" onClick={() => void copy()}>
                    <i className="bi bi-clipboard" />
                </button>
            </div>
            <p className="dim" style={{ marginTop: 10 }}>
                Treat this token like a password. Anyone holding it can call the API as you.
            </p>
            <div className="modal-actions">
                <button className="btn btn-primary" onClick={() => close(null)}>Done</button>
            </div>
        </div>
    ));
}

/** Expanded row: full facts + the two write flows (disable/undo · revoke). */
function KeyExpand({ k, onToggle, onRevoke }: {
    k: ApiKeyRow;
    onToggle: (k: ApiKeyRow, next: boolean) => void;
    onRevoke: (k: ApiKeyRow) => Promise<void>;
}) {
    return (
        <div className="expand-grid">
            <div>
                <div className="eyebrow">Details</div>
                <div>Created {fmt.datetime(k.created)}</div>
                <div>Expires {fmt.datetime(k.expires)}</div>
                <div className="dim">Last used {fmt.relative(k.last_used, 'never')}</div>
            </div>
            <div>
                <div className="eyebrow">Allowed IPs</div>
                {k.allowed_ips.length > 0
                    ? k.allowed_ips.map((ip) => <div key={ip}><code>{ip}</code></div>)
                    : <div className="dim">Any address</div>}
            </div>
            <div>
                <div className="eyebrow">Actions</div>
                <div className="chip-row" style={{ gap: 8 }}>
                    <button className="btn btn-compact" onClick={() => onToggle(k, !k.is_active)}>
                        {k.is_active ? 'Disable' : 'Enable'}
                    </button>
                    {/* Revoke rotates the secret — irreversible even if is_active
                        is flipped back on later. Armed two-step, no dialog. */}
                    <ArmedButton
                        label="Revoke"
                        armedLabel="Click again — token dies now"
                        className="btn-compact"
                        title="Rotate the secret and deactivate — cannot be undone"
                        onConfirm={() => onRevoke(k)}
                    />
                </div>
                <div className="dim" style={{ marginTop: 6 }}>
                    Disable is reversible (undo offered). Revoke rotates the secret — permanent.
                </div>
            </div>
        </div>
    );
}

export function ApiKeysPage() {
    const qc = useQueryClient();
    const save = ApiKeyModel.useSave();
    const revoke = ApiKeyModel.useAction('revoke');

    const generate = async () => {
        const data = await formModal(ApiKeyModel.forms.generate!);
        if (!data) return;
        const body: Record<string, unknown> = {
            label: data.label,
            expire_days: Number(data.expire_days || 360),
        };
        const ips = String(data.allowed_ips ?? '').trim();
        if (ips) body.allowed_ips = ips.split(',').map((s) => s.trim()).filter(Boolean);
        try {
            const resp = await mojoCall('/api/auth/generate_api_key', { method: 'POST', body });
            const minted = resp.data as { token?: string } | undefined;
            if (minted?.token) revealToken(minted.token, String(data.label ?? ''));
            else toast.success('API key generated');
            await ApiKeyModel.invalidate(qc);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to generate key');
        }
    };

    /**
     * Disable/enable — reversible, so it acts IMMEDIATELY and offers Undo
     * for the grace window instead of asking permission first.
     */
    const toggleKey = (k: ApiKeyRow, next: boolean) => {
        void (async () => {
            try {
                await save.mutateAsync({ id: k.id, changes: { is_active: next } });
                toast.undo(
                    `${k.label || `Key #${k.id}`} ${next ? 'enabled' : 'disabled'}`,
                    () => {
                        void save.mutateAsync({ id: k.id, changes: { is_active: !next } })
                            .then(() => toast.info(`${k.label || `Key #${k.id}`} restored`))
                            .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'Undo failed'));
                    },
                );
            } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Save failed');
            }
        })();
    };

    /** Revoke — the armed button already collected intent; just fire. */
    const revokeKey = async (k: ApiKeyRow) => {
        try {
            await revoke.mutateAsync({ id: k.id, payload: true });
            toast.success(`${k.label || `Key #${k.id}`} revoked — the token is dead`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Revoke failed');
        }
    };

    return (
        <ModelTable<ApiKeyRow>
            model={ApiKeyModel}
            eyebrow="Account"
            title="API Keys"
            searchPlaceholder="Search key labels…"
            columns={COLUMNS}
            filters={FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'active', label: 'Active', params: { is_active: 'true' } },
                { key: 'inactive', label: 'Inactive', params: { is_active: 'false' } },
            ]}
            defaultSort="-created"
            columnChooser
            persistState
            exportFormats={['csv', 'json']}
            rowExpand={(k) => <KeyExpand k={k} onToggle={toggleKey} onRevoke={revokeKey} />}
            addLabel="Generate Key"
            onAdd={generate}
        />
    );
}
