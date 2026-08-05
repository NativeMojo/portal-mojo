// group-sections/WebhooksSection.tsx — the Webhooks composite port
// (GroupView.js WebhookSecretPanel:962-1024 + WebhookSection:1034-1054 +
// WebhookSubscriptionListItem:824-880 + the create/delete/toggle flows
// :1856-2023, over core/models/WebhookSubscription.js).
//
//   · Signing-secret panel ABOVE the list. The panel does NOT auto-fetch:
//     POST /api/group/webhook_secret AUTO-MINTS on first call, so a
//     render-time fetch would silently create a secret the operator never
//     asked for. State populates only after Reveal / Rotate.
//   · Reveal  → POST {group}            → show-once dialog + meta line.
//   · Rotate  → confirm (old secret invalidates immediately) →
//     POST {group, rotate: true}        → show-once dialog + meta line.
//     Secret timestamps are ISO STRINGS (measured live — web-mojo piped
//     them through ['epoch','relative'], a bug not carried).
//   · Subscriptions: card rows (url, Active badge, event chips, created),
//     inline active toggle (optimistic; a rejected save reverts via the
//     mutation + invalidation), create (events TagInput → CSV → array,
//     WebhookSubscriptionForms.normalizePayload semantics), delete
//     (ArmedButton naming the blast radius).
import { useState } from 'react';
import {
    ArmedButton, Badge, Eyebrow, SchemaForm,
    fmt, modal, toast,
} from 'portal-mojo/ui';
import { useCan } from 'portal-mojo/client';
import type { GroupRow } from '../../models';
import {
    GROUP_ACCESS_MANAGE_PERMS, WebhookSubscriptionModel,
    fetchWebhookSecret, type WebhookSecretInfo, type WebhookSubscriptionRow,
} from './models';
import { showSecretDialog } from './secret-dialogs';

/** ISO string → relative label (tolerates junk by echoing it). */
function isoRelative(iso: string | null): string {
    if (!iso) return '—';
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return iso;
    return fmt.relative(Math.floor(ms / 1000));
}

/** events: TagInput CSV or array → trimmed non-empty array (normalizePayload). */
function normalizeEvents(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
    if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
}

function SecretPanel({ group }: { group: GroupRow }) {
    const [meta, setMeta] = useState<Omit<WebhookSecretInfo, 'secret'> | null>(null);
    const [busy, setBusy] = useState(false);

    const reveal = async () => {
        setBusy(true);
        try {
            const info = await fetchWebhookSecret(group.id);
            setMeta({ created_at: info.created_at, last_rotated_at: info.last_rotated_at });
            await showSecretDialog({
                title: 'Webhook signing secret',
                warning: 'Save this secret now — it is shown only when you reveal or rotate.',
                secret: info.secret,
                ariaLabel: 'Webhook signing secret',
                footer: (
                    <div className="ga-secret-footnote dim">
                        Treat this like a password. Consumers use it to verify webhook signatures.
                    </div>
                ),
            });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to reveal webhook secret');
        } finally {
            setBusy(false);
        }
    };

    const rotate = async () => {
        const ok = await modal.confirm({
            title: 'Rotate webhook secret',
            message: 'Rotating immediately invalidates the old secret. Consumers using the old secret will fail to verify until they refetch and update their cache. Continue?',
            confirmText: 'Rotate',
            danger: true,
        });
        if (!ok) return;
        setBusy(true);
        try {
            const info = await fetchWebhookSecret(group.id, true);
            setMeta({ created_at: info.created_at, last_rotated_at: info.last_rotated_at });
            await showSecretDialog({
                title: 'Secret rotated — save your new secret',
                warning: 'The old secret is already invalid. Save this one now.',
                secret: info.secret,
                ariaLabel: 'Webhook signing secret',
            });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to rotate webhook secret');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="ga-secret-panel">
            <div className="ga-secret-panel-info">
                <div className="ga-secret-panel-title"><i className="bi bi-key" /> Signing secret</div>
                <div className="dim">
                    {meta
                        ? <>Created <b>{isoRelative(meta.created_at)}</b> · Last rotated <b>{isoRelative(meta.last_rotated_at)}</b></>
                        : 'Not fetched — Reveal shows the current secret (and mints one on first use).'}
                </div>
            </div>
            <div className="ga-secret-panel-actions">
                <button className="btn btn-compact" disabled={busy} onClick={() => void reveal()}>
                    <i className="bi bi-eye" /> Reveal Secret
                </button>
                <button className="btn btn-compact btn-danger-ghost" disabled={busy} onClick={() => void rotate()}>
                    <i className="bi bi-arrow-clockwise" /> Rotate
                </button>
            </div>
        </div>
    );
}

function SubscriptionRow({ row, canManage, onToggle, onDelete }: {
    row: WebhookSubscriptionRow;
    canManage: boolean;
    onToggle: (next: boolean) => Promise<void>;
    onDelete: () => Promise<void>;
}) {
    const [toggling, setToggling] = useState(false);
    return (
        <div className="ga-card-row">
            <i className="bi bi-broadcast-pin ga-card-icon" />
            <div className="ga-card-main">
                <div className="ga-card-title">
                    <code className="ga-url">{row.url || '—'}</code>
                    <Badge tone={row.is_active ? 'success' : 'muted'}>{row.is_active ? 'Active' : 'Inactive'}</Badge>
                </div>
                <div className="chip-row">
                    {row.events.length > 0
                        ? row.events.map((ev) => <Badge key={ev} tone="info">{ev}</Badge>)
                        : <span className="dim-italic">No events configured</span>}
                </div>
                <div className="dim ga-card-meta">Created {fmt.datetime(row.created)}</div>
            </div>
            {canManage && (
                <div className="ga-card-actions">
                    <label className="switch-inline" title="Toggle delivery">
                        <input
                            type="checkbox"
                            role="switch"
                            className="switch"
                            checked={row.is_active}
                            disabled={toggling}
                            onChange={(e) => {
                                const next = e.target.checked;
                                setToggling(true);
                                void onToggle(next).finally(() => setToggling(false));
                            }}
                        />
                    </label>
                    <ArmedButton
                        className="btn-compact"
                        label={<i className="bi bi-trash" aria-label="Delete this subscription" />}
                        armedLabel="Click again — deliveries to this URL stop"
                        title="Delete this subscription"
                        onConfirm={onDelete}
                    />
                </div>
            )}
        </div>
    );
}

export function WebhooksSection({ group }: { group: GroupRow }) {
    const { data, isPending } = WebhookSubscriptionModel.useList({ group: group.id, size: 25, sort: '-created' });
    const save = WebhookSubscriptionModel.useSave();
    const destroy = WebhookSubscriptionModel.useDelete();
    const { can: canManage } = useCan(GROUP_ACCESS_MANAGE_PERMS);
    const subs = data?.rows ?? [];

    const createSubscription = async () => {
        const result = await modal.open<Record<string, unknown> | null>((close) => (
            <div className="modal-pad">
                <h2 className="modal-title">Create webhook subscription</h2>
                <SchemaForm
                    fields={[
                        {
                            name: 'url', type: 'text', label: 'URL', required: true,
                            placeholder: 'https://example.com/webhooks/mojo',
                            help: 'Must use https://. Embedded credentials are rejected server-side.',
                        },
                        {
                            name: 'events', type: 'tags', label: 'Events',
                            placeholder: 'Press Enter or comma to add',
                            help: 'Free-form event names published by the emitting service (e.g. invoice.paid, verification.completed).',
                        },
                        {
                            name: 'is_active', type: 'switch', label: 'Active',
                            help: 'Inactive subscriptions are skipped during fan-out.',
                        },
                    ]}
                    initial={{ is_active: true }}
                    submitText="Create subscription"
                    onCancel={() => close(null)}
                    onSubmit={(form) => close(form)}
                />
            </div>
        ), { size: 'md' });
        if (!result) return;
        try {
            await save.mutateAsync({
                id: null,
                changes: {
                    group: group.id,
                    url: String(result.url ?? ''),
                    events: normalizeEvents(result.events),
                    is_active: result.is_active === true,
                },
            });
            toast.success('Webhook subscription created');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to create webhook subscription');
        }
    };

    const toggleSubscription = async (row: WebhookSubscriptionRow, next: boolean) => {
        try {
            await save.mutateAsync({ id: row.id, changes: { is_active: next } });
        } catch (err) {
            // The mutation rejected → nothing was written to the cache; the
            // controlled switch snaps back on re-render (the bounce IS the
            // feedback, plus the message).
            toast.error(err instanceof Error ? err.message : 'Failed to update subscription');
        }
    };

    const deleteSubscription = async (row: WebhookSubscriptionRow) => {
        try {
            await destroy.mutateAsync({ id: row.id });
            toast.success('Webhook subscription deleted');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete subscription');
        }
    };

    return (
        <>
            <Eyebrow>Webhooks</Eyebrow>
            <SecretPanel group={group} />
            <div className="ga-section-gap" />
            <Eyebrow>Subscriptions</Eyebrow>
            {canManage && (
                <div className="ga-toolbar">
                    <button className="btn btn-primary btn-compact" onClick={() => void createSubscription()}>
                        <i className="bi bi-broadcast" /> Create Subscription
                    </button>
                </div>
            )}
            {!isPending && subs.length === 0 && (
                <p className="dim-italic">
                    {canManage
                        ? 'No webhook subscriptions yet. Click "Create Subscription" to add one.'
                        : 'No webhook subscriptions yet.'}
                </p>
            )}
            {subs.map((s) => (
                <SubscriptionRow
                    key={s.id}
                    row={s}
                    canManage={canManage}
                    onToggle={(next) => toggleSubscription(s, next)}
                    onDelete={() => deleteSubscription(s)}
                />
            ))}
        </>
    );
}
