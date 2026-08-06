import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCan, type PermSpec } from '../../client';
import {
    ArmedButton, Badge, DetailView, Eyebrow, FlatRow, ModelTable,
    SchemaForm, fmt, modal, toast,
    type Column, type Field, type FilterDef,
} from '../../ui';
import {
    GLOBAL_CREDENTIAL_PERMS, GROUP_CREDENTIAL_PERMS,
    WebhookSubscriptionModel, fetchWebhookSecret, normalizeWebhookEvents,
    type CredentialGroup, type WebhookSecretInfo, type WebhookSubscriptionRow,
} from './models';
import { showSecretDialog } from './secret-dialog';

function groupId(group: WebhookSubscriptionRow['group']): number | null {
    if (typeof group === 'number') return group;
    return group?.id ?? null;
}

function groupLabel(group: WebhookSubscriptionRow['group']): string {
    if (group && typeof group === 'object') return group.name;
    return group == null ? '—' : `Group #${group}`;
}

function isoRelative(value: string | null): string {
    if (!value) return '—';
    const milliseconds = Date.parse(value);
    return Number.isNaN(milliseconds) ? value : fmt.relative(Math.floor(milliseconds / 1000));
}

export function WebhookSecretPanel({ group, permission = GROUP_CREDENTIAL_PERMS }: {
    group: CredentialGroup;
    permission?: PermSpec;
}) {
    const { can } = useCan(permission);
    const [metadata, setMetadata] = useState<Omit<WebhookSecretInfo, 'secret'> | null>(null);
    const [busy, setBusy] = useState(false);

    const reveal = async () => {
        if (!can) return;
        setBusy(true);
        try {
            const info = await fetchWebhookSecret(group.id);
            setMetadata({ created_at: info.created_at, last_rotated_at: info.last_rotated_at });
            await showSecretDialog({
                title: 'Webhook signing secret',
                warning: 'This explicit reveal may mint the first secret. Store it securely.',
                secret: info.secret,
                ariaLabel: 'Webhook signing secret',
                footer: <div className="ga-secret-footnote dim">Consumers use this value to verify webhook signatures.</div>,
            });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to reveal webhook secret');
        } finally {
            setBusy(false);
        }
    };

    const rotate = async () => {
        if (!can) return;
        const confirmed = await modal.confirm({
            title: 'Rotate webhook secret',
            message: 'Rotation immediately invalidates the old secret. Consumers fail verification until updated. Continue?',
            confirmText: 'Rotate',
            danger: true,
        });
        if (!confirmed) return;
        setBusy(true);
        try {
            const info = await fetchWebhookSecret(group.id, true);
            setMetadata({ created_at: info.created_at, last_rotated_at: info.last_rotated_at });
            await showSecretDialog({
                title: 'Secret rotated — save the new value',
                warning: 'The old secret is already invalid. Store this replacement now.',
                secret: info.secret,
                ariaLabel: 'Webhook signing secret',
            });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to rotate webhook secret');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="ga-secret-panel">
            <div className="ga-secret-panel-info">
                <div className="ga-secret-panel-title"><i className="bi bi-key" /> Signing secret</div>
                <div className="dim">
                    {metadata
                        ? <>Created <b>{isoRelative(metadata.created_at)}</b> · Last rotated <b>{isoRelative(metadata.last_rotated_at)}</b></>
                        : 'Not fetched — Reveal may mint the first group secret.'}
                </div>
            </div>
            {can && (
                <div className="ga-secret-panel-actions">
                    <button className="btn btn-compact" disabled={busy} onClick={() => void reveal()}>
                        <i className="bi bi-eye" /> Reveal Secret
                    </button>
                    <button className="btn btn-compact btn-danger-ghost" disabled={busy} onClick={() => void rotate()}>
                        <i className="bi bi-arrow-clockwise" /> Rotate
                    </button>
                </div>
            )}
        </div>
    );
}

const WEBHOOK_FIELDS: Field[] = [
    {
        name: 'url', type: 'text', label: 'URL', required: true,
        placeholder: 'https://example.com/webhooks/mojo',
        help: 'HTTPS only. Embedded credentials are rejected server-side.',
    },
    {
        name: 'events', type: 'tags', label: 'Events',
        placeholder: 'Press Enter or comma to add',
        help: 'Free-form event names published by the emitting service.',
    },
    { name: 'is_active', type: 'switch', label: 'Active', help: 'Inactive subscriptions are skipped.' },
];

function useWebhookActions(permission: PermSpec) {
    const save = WebhookSubscriptionModel.useSave();
    const destroy = WebhookSubscriptionModel.useDelete();
    const { can } = useCan(permission);

    const createSubscription = async (fixedGroup?: CredentialGroup) => {
        if (!can) return;
        const result = await modal.open<Record<string, unknown> | null>((close) => (
            <div className="modal-pad">
                <h2 className="modal-title">Create webhook subscription</h2>
                <SchemaForm
                    fields={[
                        ...WEBHOOK_FIELDS,
                        ...(!fixedGroup ? [{
                            name: 'group', type: 'collection', label: 'Group', required: true,
                            endpoint: '/api/group', labelField: 'name', valueField: 'id',
                            placeholder: 'Search groups…',
                        } satisfies Field] : []),
                    ]}
                    initial={{ is_active: true }}
                    submitText="Create subscription"
                    onCancel={() => close(null)}
                    onSubmit={(form) => close(form)}
                />
            </div>
        ), { size: 'md' });
        if (!result) return;
        const group = fixedGroup?.id ?? Number(result.group);
        if (!Number.isFinite(group) || group <= 0) {
            toast.error('Choose a group');
            return;
        }
        try {
            await save.mutateAsync({
                id: null,
                changes: {
                    group,
                    url: String(result.url ?? ''),
                    events: normalizeWebhookEvents(result.events),
                    is_active: result.is_active === true,
                },
            });
            toast.success('Webhook subscription created');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to create webhook subscription');
        }
    };

    const editSubscription = async (row: WebhookSubscriptionRow) => {
        if (!can) return;
        const result = await modal.open<Record<string, unknown> | null>((close) => (
            <div className="modal-pad">
                <h2 className="modal-title">Edit webhook subscription</h2>
                <SchemaForm
                    fields={WEBHOOK_FIELDS}
                    initial={{ url: row.url, events: row.events.join(','), is_active: row.is_active }}
                    submitText="Save changes"
                    onCancel={() => close(null)}
                    onSubmit={(form) => close(form)}
                />
            </div>
        ), { size: 'md' });
        if (!result) return;
        const changes: Record<string, unknown> = {};
        const url = String(result.url ?? '');
        const events = normalizeWebhookEvents(result.events);
        const isActive = result.is_active === true;
        if (url !== row.url) changes.url = url;
        if (events.join('\u0000') !== row.events.join('\u0000')) changes.events = events;
        if (isActive !== row.is_active) changes.is_active = isActive;
        if (!Object.keys(changes).length) return;
        try {
            await save.mutateAsync({ id: row.id, changes });
            toast.success('Webhook subscription updated');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update webhook subscription');
        }
    };

    const toggleSubscription = async (row: WebhookSubscriptionRow, next: boolean) => {
        if (!can) return;
        try {
            await save.mutateAsync({ id: row.id, changes: { is_active: next } });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update subscription');
        }
    };

    const deleteSubscription = async (row: WebhookSubscriptionRow) => {
        if (!can) return false;
        try {
            await destroy.mutateAsync({ id: row.id });
            toast.success('Webhook subscription deleted');
            return true;
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to delete subscription');
            return false;
        }
    };

    return { canManage: can, createSubscription, editSubscription, toggleSubscription, deleteSubscription };
}

function WebhookCard({ row, actions }: {
    row: WebhookSubscriptionRow;
    actions: ReturnType<typeof useWebhookActions>;
}) {
    const [toggling, setToggling] = useState(false);
    return (
        <div
            className={`ga-card-row${actions.canManage ? ' ga-click-row' : ''}`}
            role={actions.canManage ? 'button' : undefined}
            tabIndex={actions.canManage ? 0 : undefined}
            onClick={actions.canManage ? () => void actions.editSubscription(row) : undefined}
            onKeyDown={actions.canManage ? (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    void actions.editSubscription(row);
                }
            } : undefined}
        >
            <i className="bi bi-broadcast-pin ga-card-icon" />
            <div className="ga-card-main">
                <div className="ga-card-title">
                    <code className="ga-url">{row.url || '—'}</code>
                    <Badge tone={row.is_active ? 'success' : 'muted'}>{row.is_active ? 'Active' : 'Inactive'}</Badge>
                </div>
                <div className="chip-row">
                    {row.events.length
                        ? row.events.map((event) => <Badge key={event} tone="info">{event}</Badge>)
                        : <span className="dim-italic">No events configured</span>}
                </div>
                <div className="dim ga-card-meta">Created {fmt.datetime(row.created)}</div>
            </div>
            {actions.canManage && (
                <div className="ga-card-actions" onClick={(event) => event.stopPropagation()}>
                    <label className="switch-inline" title="Toggle delivery">
                        <input
                            type="checkbox"
                            role="switch"
                            className="switch"
                            checked={row.is_active}
                            disabled={toggling}
                            onChange={(event) => {
                                setToggling(true);
                                void actions.toggleSubscription(row, event.target.checked)
                                    .finally(() => setToggling(false));
                            }}
                        />
                    </label>
                    <ArmedButton
                        className="btn-compact"
                        label={<i className="bi bi-trash" aria-label="Delete this subscription" />}
                        armedLabel="Click again — deliveries stop"
                        title="Delete this subscription"
                        onConfirm={async () => { await actions.deleteSubscription(row); }}
                    />
                </div>
            )}
        </div>
    );
}

export function WebhookSubscriptionsSection({ group }: { group: CredentialGroup }) {
    const { data, isPending } = WebhookSubscriptionModel.useList({ group: group.id, size: 25, sort: '-created' });
    const actions = useWebhookActions(GROUP_CREDENTIAL_PERMS);
    const rows = data?.rows ?? [];
    return (
        <>
            <Eyebrow>Webhooks</Eyebrow>
            <WebhookSecretPanel group={group} />
            <div className="ga-section-gap" />
            <Eyebrow>Subscriptions</Eyebrow>
            {actions.canManage && (
                <div className="ga-toolbar">
                    <button className="btn btn-primary btn-compact" onClick={() => void actions.createSubscription(group)}>
                        <i className="bi bi-broadcast" /> Create Subscription
                    </button>
                </div>
            )}
            {!isPending && rows.length === 0 && <p className="dim-italic">No webhook subscriptions yet.</p>}
            {rows.map((row) => <WebhookCard key={row.id} row={row} actions={actions} />)}
        </>
    );
}

export function WebhookSubscriptionDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const { data: row, isPending, error } = WebhookSubscriptionModel.useOne(id);
    const actions = useWebhookActions(GLOBAL_CREDENTIAL_PERMS);
    if (isPending) return <div className="modal-pad dim">Loading webhook subscription…</div>;
    if (!row || error) return <div className="modal-pad text-bad">{error?.message ?? 'Subscription not found'}</div>;
    const idForGroup = groupId(row.group);
    const group = idForGroup == null ? null : {
        id: idForGroup,
        name: groupLabel(row.group),
        ...(typeof row.group === 'object' && row.group?.kind ? { kind: row.group.kind } : {}),
    };
    return (
        <DetailView
            icon="bi-broadcast-pin"
            title={row.url}
            subtitle={`${groupLabel(row.group)} · webhook subscription`}
            chips={[{ text: row.is_active ? 'Active' : 'Inactive', tone: row.is_active ? 'success' : 'muted' }]}
            sections={[
                {
                    key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => (
                        <>
                            <Eyebrow>Subscription</Eyebrow>
                            <FlatRow label="Group">{groupLabel(row.group)}</FlatRow>
                            <FlatRow label="URL"><code>{row.url}</code></FlatRow>
                            <FlatRow label="Created">{fmt.datetime(row.created)}</FlatRow>
                            <FlatRow label="Modified">{fmt.datetime(row.modified)}</FlatRow>
                            <div className="ga-toolbar" style={{ marginTop: 16 }}>
                                <button className="btn btn-compact" onClick={() => void actions.editSubscription(row)}>
                                    <i className="bi bi-pencil" /> Edit URL, events, and status
                                </button>
                                <ArmedButton
                                    className="btn-compact"
                                    label="Delete"
                                    armedLabel="Click again — delete now"
                                    onConfirm={async () => {
                                        if (await actions.deleteSubscription(row)) onClose();
                                    }}
                                />
                            </div>
                        </>
                    ),
                },
                {
                    key: 'events', label: 'Events', icon: 'bi-tags', render: () => (
                        <div className="chip-row">
                            {row.events.length
                                ? row.events.map((event) => <Badge key={event} tone="info">{event}</Badge>)
                                : <span className="dim-italic">No events configured</span>}
                        </div>
                    ),
                },
                ...(group ? [{
                    key: 'secret', label: 'Signing Secret', icon: 'bi-key',
                    render: () => <WebhookSecretPanel group={group} permission={GLOBAL_CREDENTIAL_PERMS} />,
                }] : []),
            ]}
            onClose={onClose}
        />
    );
}

const WEBHOOK_COLUMNS: Column<WebhookSubscriptionRow>[] = [
    { key: 'url', label: 'URL', sortable: true, hideable: false, render: (row) => <code className="ga-url">{row.url}</code> },
    { key: 'group', label: 'Group', render: (row) => groupLabel(row.group) },
    { key: 'events', label: 'Events', render: (row) => row.events.slice(0, 3).map((event) => <Badge key={event} tone="info">{event}</Badge>) },
    { key: 'is_active', label: 'Status', render: (row) => <Badge tone={row.is_active ? 'success' : 'muted'}>{row.is_active ? 'Active' : 'Inactive'}</Badge> },
    { key: 'created', label: 'Created', sortable: true, render: (row) => fmt.date(row.created) },
];

const WEBHOOK_FILTERS: FilterDef[] = [
    { key: 'url', label: 'URL', type: 'text', placeholder: 'Contains…' },
    { key: 'group', label: 'Group ID', type: 'number', lookup: 'exact' },
    { key: 'is_active', label: 'Status', type: 'boolean', trueLabel: 'Active', falseLabel: 'Inactive' },
    { key: 'created', label: 'Created', type: 'daterange' },
];

export function WebhookSubscriptionsPage() {
    const queryClient = useQueryClient();
    const actions = useWebhookActions(GLOBAL_CREDENTIAL_PERMS);
    const openDetail = (row: WebhookSubscriptionRow) => {
        void WebhookSubscriptionModel.fetchOne(queryClient, row.id).catch(() => undefined);
        void modal.detail((close) => <WebhookSubscriptionDetail id={row.id} onClose={() => close(null)} />);
    };
    return (
        <ModelTable<WebhookSubscriptionRow>
            model={WebhookSubscriptionModel}
            eyebrow="Account"
            title="Webhook Subscriptions"
            searchable={false}
            columns={WEBHOOK_COLUMNS}
            filters={WEBHOOK_FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'active', label: 'Active', params: { is_active: 'true' } },
                { key: 'inactive', label: 'Inactive', params: { is_active: 'false' } },
            ]}
            defaultSort="-created"
            columnChooser
            persistState
            onRowClick={openDetail}
            addLabel="New Subscription"
            onAdd={actions.canManage ? () => void actions.createSubscription() : undefined}
        />
    );
}
