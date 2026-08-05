// group-sections/ApiKeysSection.tsx — the API Keys section port
// (GroupView.js ApiKeyListItem:749-807 + _createApiKey:1696-1737 +
// _deleteApiKey:1745-1764 + _showApiKeyTokenDialog:1782-1845, over the
// ApiKey model spec in core/models/ApiKey.js).
//
//   · List: card rows — key icon, name, Active badge, permission chips,
//     "Last used … · Created …" (+ Expires when expires_at is set).
//   · Create: name + grant-only permission switches (Member.BASE_PERMISSIONS
//     catalog + the Federation tab's geoip_sync switch, DISABLED unless the
//     caller holds a federation-grant permission — ApiKey.canGrantFederation
//     is UX-only and errs permissive; the server refuses independently).
//     The POST carries `permissions: {<name>: true}` for granted switches
//     ONLY (absent = not granted — explicit falses would fire the backend's
//     per-key permission gate for nothing).
//   · The create echo carries the raw token ONCE → show-once dialog.
//   · Edit (row click): name / is_active / permission flips, DIFFED —
//     only changed permission keys ride the save (a flip to false IS sent:
//     that's a revocation and must hit the backend's permission gate).
//   · Reveal token: GET <id>?graph=token (measured live — managers may read
//     the current token; it is NOT write-once on this backend).
//   · Delete: ArmedButton (house idiom for irreversible, no-input actions).
//   · Rotate is deliberately absent: POST /api/group/apikey/rotate is
//     apikey-auth SELF-SERVICE (401 for JWT callers) — documented deviation.
import {
    ArmedButton, Badge, Eyebrow, SchemaForm,
    fmt, modal, toast, type Field,
} from 'portal-mojo/ui';
import { useCan } from 'portal-mojo/client';
import type { GroupRow } from '../../models';
import {
    APIKEY_FEDERATION_GRANT_PERMS, APIKEY_FEDERATION_PERMISSIONS,
    GROUP_ACCESS_MANAGE_PERMS, GroupApiKeyModel, MEMBER_BASE_PERMISSIONS,
    fetchApiKeyToken, grantedPerms, type GroupApiKeyRow,
} from './models';
import { showSecretDialog } from './secret-dialogs';

/**
 * The permission-switch field set (dotted names → flat FormData keys).
 * Deviation from source, documented: web-mojo rendered the federation
 * switch DISABLED for non-granting callers; SchemaForm's builtin switch
 * ignores `disabled`, so here the switch is EXCLUDED instead (the check
 * errs permissive exactly like ApiKey.canGrantFederation — an `admin`
 * holder sees it and may still get a clean 403 from the server, which
 * stays authoritative).
 */
function permissionFields(canGrantFederation: boolean): Field[] {
    const catalog: Field[] = MEMBER_BASE_PERMISSIONS.map((p) => ({
        name: `permissions.${p.name}`,
        type: 'switch',
        label: p.label,
        columns: 6,
        ...(p.tooltip ? { help: p.tooltip } : {}),
    }));
    if (!canGrantFederation) return catalog;
    const federation: Field[] = APIKEY_FEDERATION_PERMISSIONS.map((p) => ({
        name: `permissions.${p.name}`,
        type: 'switch',
        label: `${p.label} (federation)`,
        columns: 6,
        help: p.tooltip,
    }));
    return [...catalog, ...federation];
}

/** Flat FormData seed for the permission switches from a row's dict. */
function permissionSeed(dict: Record<string, unknown> | null | undefined): Record<string, boolean> {
    const granted = new Set(grantedPerms(dict));
    const out: Record<string, boolean> = {};
    for (const p of [...MEMBER_BASE_PERMISSIONS, ...APIKEY_FEDERATION_PERMISSIONS]) {
        out[`permissions.${p.name}`] = granted.has(p.name);
    }
    return out;
}

/** Post-dialog footer for the token reveal: granted-permission chips. */
function TokenFooter({ perms }: { perms: string[] }) {
    return (
        <div className="ga-secret-footnote">
            {perms.length > 0 ? (
                <span className="chip-row">
                    <span className="dim">Permissions:</span>
                    {perms.map((p) => <Badge key={p} tone="info">{p}</Badge>)}
                </span>
            ) : (
                <span className="dim">
                    <i className="bi bi-info-circle" /> No permissions granted — this key has read access only to public endpoints.
                </span>
            )}
            <div className="dim" style={{ marginTop: 8 }}>
                Treat this token like a password. Anyone with it can call this group's API on your behalf.
            </div>
        </div>
    );
}

function ApiKeyRowItem({ row, canManage, onEdit, onReveal, onDelete }: {
    row: GroupApiKeyRow;
    canManage: boolean;
    onEdit: () => void;
    onReveal: () => void;
    onDelete: () => Promise<void>;
}) {
    const perms = grantedPerms(row.permissions);
    return (
        <div className={`ga-card-row${canManage ? ' ga-click-row' : ''}`}
            role={canManage ? 'button' : undefined}
            tabIndex={canManage ? 0 : undefined}
            onClick={canManage ? onEdit : undefined}
            onKeyDown={canManage ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onEdit(); } } : undefined}
        >
            <i className="bi bi-key-fill ga-card-icon" />
            <div className="ga-card-main">
                <div className="ga-card-title">
                    <b>{row.name || 'Unnamed key'}</b>
                    <Badge tone={row.is_active ? 'success' : 'muted'}>{row.is_active ? 'Active' : 'Inactive'}</Badge>
                </div>
                <div className="chip-row">
                    {perms.length > 0
                        ? perms.map((p) => <Badge key={p} tone="info">{p}</Badge>)
                        : <span className="dim-italic">No permissions granted</span>}
                </div>
                <div className="dim ga-card-meta">
                    Last used <b>{fmt.relative(row.last_used, 'never')}</b> · Created {fmt.date(row.created)}
                    {row.expires_at != null && <> · Expires {fmt.date(row.expires_at)}</>}
                </div>
            </div>
            {canManage && (
                <div className="ga-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-compact" title="Reveal the current token"
                        onClick={onReveal}>
                        <i className="bi bi-eye" /> Token
                    </button>
                    <ArmedButton
                        className="btn-compact"
                        label={<i className="bi bi-trash" aria-label="Delete this key" />}
                        armedLabel="Click again — services using this key lose access"
                        title="Delete this key"
                        onConfirm={onDelete}
                    />
                </div>
            )}
        </div>
    );
}

export function ApiKeysSection({ group }: { group: GroupRow }) {
    const { data, isPending } = GroupApiKeyModel.useList({ group: group.id, size: 10, sort: '-created' });
    const save = GroupApiKeyModel.useSave();
    const destroy = GroupApiKeyModel.useDelete();
    const { can: canManage } = useCan(GROUP_ACCESS_MANAGE_PERMS);
    const { can: canGrantFederation } = useCan(APIKEY_FEDERATION_GRANT_PERMS);
    const keys = data?.rows ?? [];

    const createKey = async () => {
        const result = await modal.open<Record<string, unknown> | null>((close) => (
            <div className="modal-pad">
                <h2 className="modal-title">Create API key</h2>
                <SchemaForm
                    fields={[
                        {
                            name: 'name', type: 'text', label: 'Name', required: true,
                            placeholder: 'Mobile App v2', help: 'A descriptive name to identify this key.',
                        },
                        ...permissionFields(canGrantFederation),
                    ]}
                    submitText="Create key"
                    onCancel={() => close(null)}
                    onSubmit={(form) => close(form)}
                />
            </div>
        ), { size: 'md' });
        if (!result) return;

        // Grant-only create: granted switches only, as a real permissions
        // dict ({name: true}); unchecked switches never ride the POST.
        const permissions: Record<string, true> = {};
        for (const [key, value] of Object.entries(result)) {
            if (key.startsWith('permissions.') && value === true) {
                permissions[key.slice('permissions.'.length)] = true;
            }
        }
        try {
            const created = await save.mutateAsync({
                id: null,
                changes: {
                    name: String(result.name ?? ''),
                    group: group.id,
                    ...(Object.keys(permissions).length ? { permissions } : {}),
                },
            });
            const granted = Object.keys(permissions);
            if (created.token) {
                await showSecretDialog({
                    title: 'API key created — save your token',
                    intro: <><i className="bi bi-check-circle-fill" style={{ color: 'var(--ok)' }} /> API key <b>{created.name}</b> created.</>,
                    warning: 'Save this token now — it will not be shown again automatically.',
                    secret: created.token,
                    ariaLabel: 'API token',
                    footer: <TokenFooter perms={granted} />,
                });
            } else {
                toast.success('API key created');
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to create API key');
        }
    };

    const editKey = async (row: GroupApiKeyRow) => {
        const seed = { name: row.name, is_active: row.is_active, ...permissionSeed(row.permissions) };
        const result = await modal.open<Record<string, unknown> | null>((close) => (
            <div className="modal-pad">
                <h2 className="modal-title">Edit API key</h2>
                <SchemaForm
                    fields={[
                        { name: 'name', type: 'text', label: 'Name', required: true, columns: 6 },
                        { name: 'is_active', type: 'switch', label: 'Active', columns: 6 },
                        ...permissionFields(canGrantFederation),
                    ]}
                    initial={seed}
                    submitText="Save changes"
                    onCancel={() => close(null)}
                    onSubmit={(form) => close(form)}
                />
            </div>
        ), { size: 'md' });
        if (!result) return;

        // Diff against the row: only changed fields ride. Permission flips
        // send true (grant) or false (revoke) for the CHANGED keys only —
        // the backend merges the partial dict and gates each named key.
        // Only keys the form actually RENDERED are diffed: a hidden
        // federation switch must never manufacture a revocation.
        const renderedPermKeys = permissionFields(canGrantFederation).map((f) => f.name);
        const changes: Record<string, unknown> = {};
        if (String(result.name ?? '') !== row.name) changes.name = String(result.name ?? '');
        if ((result.is_active === true) !== row.is_active) changes.is_active = result.is_active === true;
        const before = permissionSeed(row.permissions);
        const permChanges: Record<string, boolean> = {};
        for (const key of renderedPermKeys) {
            const was = before[key] === true;
            const now = result[key] === true;
            if (now !== was) permChanges[key.slice('permissions.'.length)] = now;
        }
        if (Object.keys(permChanges).length) changes.permissions = permChanges;
        if (Object.keys(changes).length === 0) return;
        try {
            await save.mutateAsync({ id: row.id, changes });
            toast.success('API key updated');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update API key');
        }
    };

    const revealToken = async (row: GroupApiKeyRow) => {
        try {
            const token = await fetchApiKeyToken(row.id);
            await showSecretDialog({
                title: `API key token — ${row.name}`,
                warning: 'Treat this token like a password. Anyone with it can call this group\'s API.',
                secret: token,
                ariaLabel: 'API token',
                footer: <TokenFooter perms={grantedPerms(row.permissions)} />,
            });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to reveal the token');
        }
    };

    const deleteKey = async (row: GroupApiKeyRow) => {
        try {
            await destroy.mutateAsync({ id: row.id });
            toast.success('API key deleted');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete API key');
        }
    };

    return (
        <>
            <Eyebrow>API keys</Eyebrow>
            <p className="dim" style={{ margin: '0 0 12px' }}>
                Group-scoped keys for external integrations — least-privilege grants,
                <code> Authorization: apikey &lt;token&gt;</code>.
            </p>
            {canManage && (
                <div className="ga-toolbar">
                    <button className="btn btn-primary btn-compact" onClick={() => void createKey()}>
                        <i className="bi bi-key" /> Create Key
                    </button>
                </div>
            )}
            {!isPending && keys.length === 0 && (
                <p className="dim-italic">
                    {canManage ? 'No API keys yet. Click "Create Key" to add one.' : 'No API keys yet.'}
                </p>
            )}
            {keys.map((k) => (
                <ApiKeyRowItem
                    key={k.id}
                    row={k}
                    canManage={canManage}
                    onEdit={() => void editKey(k)}
                    onReveal={() => void revealToken(k)}
                    onDelete={() => deleteKey(k)}
                />
            ))}
            {(data?.count ?? 0) > keys.length && (
                <p className="dim" style={{ marginTop: 8 }}>{data!.count - keys.length} more keys not shown.</p>
            )}
        </>
    );
}
