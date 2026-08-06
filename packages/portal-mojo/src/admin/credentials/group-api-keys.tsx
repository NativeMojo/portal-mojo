import { useContext, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    GroupContext, hasPermission, useCan, useMe,
    type PermSpec,
} from '../../client';
import {
    ArmedButton, Badge, DetailView, Eyebrow, FlatRow, ModelTable,
    SchemaForm, fmt, modal, toast,
    type Column, type Field, type FilterDef,
} from '../../ui';
import {
    GLOBAL_CREDENTIAL_PERMS, GROUP_CREDENTIAL_PERMS,
    GroupApiKeyModel, fetchApiKeyToken,
    getGroupApiKeyPermissions, grantedPermissions,
    groupApiKeyPermissionsVersion, subscribeGroupApiKeyPermissions,
    useCreateGroupApiKey,
    type ApiKeyPermissionDef, type CredentialGroup, type GroupApiKeyRow,
} from './models';
import { showSecretDialog } from './secret-dialog';

function groupLabel(group: GroupApiKeyRow['group']): string {
    if (group && typeof group === 'object') return group.name;
    return group == null ? '—' : `Group #${group}`;
}

/** Resolve the injectable registry on every update and apply grant gates. */
function useRenderedPermissions(): ApiKeyPermissionDef[] {
    useSyncExternalStore(
        subscribeGroupApiKeyPermissions,
        groupApiKeyPermissionsVersion,
        groupApiKeyPermissionsVersion,
    );
    const { data: me } = useMe();
    const member = useContext(GroupContext)?.member ?? null;
    return getGroupApiKeyPermissions().filter((permission) =>
        !permission.grantPermissions
        || hasPermission(me ?? null, permission.grantPermissions, member));
}

function permissionFields(defs: ApiKeyPermissionDef[]): Field[] {
    return defs.map((permission) => ({
        name: `permissions.${permission.name}`,
        type: 'switch',
        label: permission.label,
        columns: 6,
        ...(permission.tooltip ? { help: permission.tooltip } : {}),
    }));
}

function permissionSeed(
    dict: Record<string, unknown> | null | undefined,
    defs: ApiKeyPermissionDef[],
): Record<string, boolean> {
    const granted = new Set(grantedPermissions(dict));
    return Object.fromEntries(defs.map((permission) => [
        `permissions.${permission.name}`,
        granted.has(permission.name),
    ]));
}

function TokenFooter({ permissions }: { permissions: string[] }) {
    return (
        <div className="ga-secret-footnote">
            {permissions.length > 0 ? (
                <span className="chip-row">
                    <span className="dim">Permissions:</span>
                    {permissions.map((permission) => (
                        <Badge key={permission} tone="info">{permission}</Badge>
                    ))}
                </span>
            ) : (
                <span className="dim">
                    <i className="bi bi-info-circle" /> No permissions granted.
                </span>
            )}
            <div className="dim" style={{ marginTop: 8 }}>
                Treat this token like a password. It authenticates as this group-scoped key.
            </div>
        </div>
    );
}

function useGroupApiKeyActions(permission: PermSpec) {
    const renderedPermissions = useRenderedPermissions();
    const create = useCreateGroupApiKey();
    const save = GroupApiKeyModel.useSave();
    const destroy = GroupApiKeyModel.useDelete();
    const { can } = useCan(permission);

    const createKey = async (fixedGroup?: CredentialGroup) => {
        if (!can) return;
        const result = await modal.open<Record<string, unknown> | null>((close) => (
            <div className="modal-pad">
                <h2 className="modal-title">Create API key</h2>
                <SchemaForm
                    fields={[
                        {
                            name: 'name', type: 'text', label: 'Name', required: true,
                            placeholder: 'Mobile App v2', help: 'A descriptive name for this key.',
                        },
                        ...(!fixedGroup ? [{
                            name: 'group', type: 'collection', label: 'Group', required: true,
                            endpoint: '/api/group', labelField: 'name', valueField: 'id',
                            placeholder: 'Search groups…',
                        } satisfies Field] : []),
                        ...permissionFields(renderedPermissions),
                    ]}
                    submitText="Create key"
                    onCancel={() => close(null)}
                    onSubmit={(form) => close(form)}
                />
            </div>
        ), { size: 'md' });
        if (!result) return;

        const permissions: Record<string, true> = {};
        for (const def of renderedPermissions) {
            if (result[`permissions.${def.name}`] === true) permissions[def.name] = true;
        }
        const group = fixedGroup?.id ?? Number(result.group);
        if (!Number.isFinite(group) || group <= 0) {
            toast.error('Choose a group');
            return;
        }
        try {
            let tokenShown = false;
            await create.mutateAsync({
                changes: {
                    name: String(result.name ?? ''),
                    group,
                    ...(Object.keys(permissions).length ? { permissions } : {}),
                },
                onToken: async (token, row) => {
                    tokenShown = true;
                    await showSecretDialog({
                        title: 'API key created — save your token',
                        intro: <><i className="bi bi-check-circle-fill text-ok" /> API key <b>{row.name}</b> created.</>,
                        warning: 'Save this token now — creation reveals it automatically only once.',
                        secret: token,
                        ariaLabel: 'API token',
                        footer: <TokenFooter permissions={Object.keys(permissions)} />,
                    });
                },
            });
            if (!tokenShown) toast.success('API key created');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to create API key');
        }
    };

    const editKey = async (row: GroupApiKeyRow) => {
        if (!can) return;
        const renderedFields = permissionFields(renderedPermissions);
        const before = permissionSeed(row.permissions, renderedPermissions);
        const result = await modal.open<Record<string, unknown> | null>((close) => (
            <div className="modal-pad">
                <h2 className="modal-title">Edit API key</h2>
                <SchemaForm
                    fields={[
                        { name: 'name', type: 'text', label: 'Name', required: true, columns: 6 },
                        { name: 'is_active', type: 'switch', label: 'Active', columns: 6 },
                        ...renderedFields,
                    ]}
                    initial={{ name: row.name, is_active: row.is_active, ...before }}
                    submitText="Save changes"
                    onCancel={() => close(null)}
                    onSubmit={(form) => close(form)}
                />
            </div>
        ), { size: 'md' });
        if (!result) return;

        const changes: Record<string, unknown> = {};
        const nextName = String(result.name ?? '');
        if (nextName !== row.name) changes.name = nextName;
        const nextActive = result.is_active === true;
        if (nextActive !== row.is_active) changes.is_active = nextActive;

        // Diff only controls that were actually rendered. Unknown and
        // protected grants remain absent from the partial JSONField update.
        const permissionChanges: Record<string, boolean> = {};
        for (const def of renderedPermissions) {
            const key = `permissions.${def.name}`;
            const was = before[key] === true;
            const now = result[key] === true;
            if (was !== now) permissionChanges[def.name] = now;
        }
        if (Object.keys(permissionChanges).length) changes.permissions = permissionChanges;
        if (!Object.keys(changes).length) return;

        try {
            await save.mutateAsync({ id: row.id, changes });
            toast.success('API key updated');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update API key');
        }
    };

    const revealToken = async (row: GroupApiKeyRow) => {
        if (!can) return;
        try {
            const token = await fetchApiKeyToken(row.id);
            await showSecretDialog({
                title: `API key token — ${row.name}`,
                warning: 'This explicit retrieval is audited. Treat the returned token like a password.',
                secret: token,
                ariaLabel: 'API token',
                footer: <TokenFooter permissions={grantedPermissions(row.permissions)} />,
            });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to reveal the token');
        }
    };

    const deleteKey = async (row: GroupApiKeyRow) => {
        if (!can) return false;
        try {
            await destroy.mutateAsync({ id: row.id });
            toast.success('API key deleted');
            return true;
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to delete API key');
            return false;
        }
    };

    return { canManage: can, createKey, editKey, revealToken, deleteKey };
}

function ApiKeyCard({ row, actions }: {
    row: GroupApiKeyRow;
    actions: ReturnType<typeof useGroupApiKeyActions>;
}) {
    const permissions = grantedPermissions(row.permissions);
    return (
        <div
            className={`ga-card-row${actions.canManage ? ' ga-click-row' : ''}`}
            role={actions.canManage ? 'button' : undefined}
            tabIndex={actions.canManage ? 0 : undefined}
            onClick={actions.canManage ? () => void actions.editKey(row) : undefined}
            onKeyDown={actions.canManage ? (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    void actions.editKey(row);
                }
            } : undefined}
        >
            <i className="bi bi-key-fill ga-card-icon" />
            <div className="ga-card-main">
                <div className="ga-card-title">
                    <b>{row.name || 'Unnamed key'}</b>
                    <Badge tone={row.is_active ? 'success' : 'muted'}>{row.is_active ? 'Active' : 'Inactive'}</Badge>
                </div>
                <div className="chip-row">
                    {permissions.length
                        ? permissions.map((permission) => <Badge key={permission} tone="info">{permission}</Badge>)
                        : <span className="dim-italic">No permissions granted</span>}
                </div>
                <div className="dim ga-card-meta">
                    Last used <b>{fmt.relative(row.last_used, 'never')}</b> · Created {fmt.date(row.created)}
                    {row.expires_at != null && <> · Expires {fmt.date(row.expires_at)}</>}
                </div>
            </div>
            {actions.canManage && (
                <div className="ga-card-actions" onClick={(event) => event.stopPropagation()}>
                    <button className="btn btn-compact" title="Reveal the current token" onClick={() => void actions.revealToken(row)}>
                        <i className="bi bi-eye" /> Token
                    </button>
                    <ArmedButton
                        className="btn-compact"
                        label={<i className="bi bi-trash" aria-label="Delete this key" />}
                        armedLabel="Click again — services using this key lose access"
                        title="Delete this key"
                        onConfirm={async () => { await actions.deleteKey(row); }}
                    />
                </div>
            )}
        </div>
    );
}

export function GroupApiKeysSection({ group }: { group: CredentialGroup }) {
    const { data, isPending } = GroupApiKeyModel.useList({ group: group.id, size: 10, sort: '-created' });
    const actions = useGroupApiKeyActions(GROUP_CREDENTIAL_PERMS);
    const rows = data?.rows ?? [];
    return (
        <>
            <Eyebrow>API keys</Eyebrow>
            <p className="dim" style={{ margin: '0 0 12px' }}>
                Group-scoped integration keys using <code>Authorization: apikey &lt;token&gt;</code>.
            </p>
            {actions.canManage && (
                <div className="ga-toolbar">
                    <button className="btn btn-primary btn-compact" onClick={() => void actions.createKey(group)}>
                        <i className="bi bi-key" /> Create Key
                    </button>
                </div>
            )}
            {!isPending && rows.length === 0 && <p className="dim-italic">No API keys yet.</p>}
            {rows.map((row) => <ApiKeyCard key={row.id} row={row} actions={actions} />)}
            {(data?.count ?? 0) > rows.length && (
                <p className="dim" style={{ marginTop: 8 }}>{data!.count - rows.length} more keys not shown.</p>
            )}
        </>
    );
}

export function GroupApiKeyDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const { data: row, isPending, error } = GroupApiKeyModel.useOne(id);
    const actions = useGroupApiKeyActions(GLOBAL_CREDENTIAL_PERMS);
    if (isPending) return <div className="modal-pad dim">Loading API key…</div>;
    if (!row || error) return <div className="modal-pad text-bad">{error?.message ?? 'API key not found'}</div>;
    const permissions = grantedPermissions(row.permissions);
    return (
        <DetailView
            icon="bi-key"
            title={row.name || `API key #${row.id}`}
            subtitle={`${groupLabel(row.group)} · group-scoped credential`}
            chips={[
                { text: row.is_active ? 'Active' : 'Inactive', tone: row.is_active ? 'success' : 'muted' },
                { text: `${permissions.length} grants`, tone: 'info' },
            ]}
            sections={[
                {
                    key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => (
                        <>
                            <Eyebrow>Key</Eyebrow>
                            <FlatRow label="Group">{groupLabel(row.group)}</FlatRow>
                            <FlatRow label="Created">{fmt.datetime(row.created)}</FlatRow>
                            <FlatRow label="Last used">{fmt.relative(row.last_used, 'never')}</FlatRow>
                            <FlatRow label="Expires">{row.expires_at ? fmt.datetime(row.expires_at) : 'Never'}</FlatRow>
                            <div className="ga-toolbar" style={{ marginTop: 16 }}>
                                <button className="btn btn-compact" onClick={() => void actions.editKey(row)}>
                                    <i className="bi bi-pencil" /> Edit
                                </button>
                                <button className="btn btn-compact" onClick={() => void actions.revealToken(row)}>
                                    <i className="bi bi-eye" /> Reveal audited token
                                </button>
                                <ArmedButton
                                    className="btn-compact"
                                    label="Delete"
                                    armedLabel="Click again — delete now"
                                    onConfirm={async () => {
                                        if (await actions.deleteKey(row)) onClose();
                                    }}
                                />
                            </div>
                        </>
                    ),
                },
                {
                    key: 'permissions', label: 'Permissions', icon: 'bi-shield-lock', render: () => (
                        <>
                            <Eyebrow>Granted permissions</Eyebrow>
                            <div className="chip-row">
                                {permissions.length
                                    ? permissions.map((permission) => <Badge key={permission} tone="info">{permission}</Badge>)
                                    : <span className="dim-italic">No permissions granted</span>}
                            </div>
                            <p className="dim">Only controls visible to the operator are diffed when editing; unknown grants are preserved.</p>
                        </>
                    ),
                },
            ]}
            initialSection="permissions"
            onClose={onClose}
        />
    );
}

const API_KEY_COLUMNS: Column<GroupApiKeyRow>[] = [
    {
        key: 'name', label: 'Key', sortable: true, hideable: false, render: (row) => (
            <div className="cell-user">
                <span className="cell-avatar"><i className="bi bi-key" /></span>
                <span><span className="cell-name">{row.name}</span><span className="cell-sub">#{row.id}</span></span>
            </div>
        ),
    },
    { key: 'group', label: 'Group', render: (row) => groupLabel(row.group) },
    { key: 'is_active', label: 'Status', render: (row) => <Badge tone={row.is_active ? 'success' : 'muted'}>{row.is_active ? 'Active' : 'Inactive'}</Badge> },
    { key: 'permissions', label: 'Grants', align: 'center', render: (row) => String(grantedPermissions(row.permissions).length) },
    { key: 'last_used', label: 'Last used', sortable: true, render: (row) => fmt.relative(row.last_used, 'never') },
    { key: 'created', label: 'Created', sortable: true, render: (row) => fmt.date(row.created) },
];

const API_KEY_FILTERS: FilterDef[] = [
    { key: 'name', label: 'Name', type: 'text', placeholder: 'Contains…' },
    { key: 'group', label: 'Group ID', type: 'number', lookup: 'exact' },
    { key: 'is_active', label: 'Status', type: 'boolean', trueLabel: 'Active', falseLabel: 'Inactive' },
    { key: 'created', label: 'Created', type: 'daterange' },
    { key: 'last_used', label: 'Last used', type: 'daterange' },
];

export function GroupApiKeysPage() {
    const queryClient = useQueryClient();
    const actions = useGroupApiKeyActions(GLOBAL_CREDENTIAL_PERMS);
    const openDetail = (row: GroupApiKeyRow) => {
        void GroupApiKeyModel.fetchOne(queryClient, row.id).catch(() => undefined);
        void modal.detail((close) => <GroupApiKeyDetail id={row.id} onClose={() => close(null)} />);
    };
    return (
        <ModelTable<GroupApiKeyRow>
            model={GroupApiKeyModel}
            eyebrow="Account"
            title="Group API Keys"
            searchable={false}
            columns={API_KEY_COLUMNS}
            filters={API_KEY_FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'active', label: 'Active', params: { is_active: 'true' } },
                { key: 'inactive', label: 'Inactive', params: { is_active: 'false' } },
            ]}
            defaultSort="-created"
            columnChooser
            persistState
            onRowClick={openDetail}
            addLabel="New API Key"
            onAdd={actions.canManage ? () => void actions.createKey() : undefined}
        />
    );
}
