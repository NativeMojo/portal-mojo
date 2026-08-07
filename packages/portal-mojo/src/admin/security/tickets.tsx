import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { mojoSave, useCan } from '../../client/runtime';
import type { RecordFeedItem } from '../../client/record-feed';
import {
    Badge, CollectionSelect, DetailView, MarkdownView, ModelTable, RecordFeed, SchemaForm, fmt, modal, toast,
    type Column, type Field, type FilterDef, type FormData, type Tone,
} from '../../ui';
import { AssistantContextLauncher } from '../assistant/launchers';
import { createTicketNoteAdapter } from '../../client/record-feed';
import {
    MaestroItemLinkModel, TICKET_MANAGE_PERMS, TICKET_USER_LOOKUP_PERMS,
    TicketModel, buildTicketActionResponseBody, invalidateTicketDependents,
    isTicketActionDisabled, isTicketTerminal, knownOptionsWithCurrent, relationId, relationLabel,
    type TicketNoteAction, type TicketRow,
} from './models';

export const TICKET_STATUSES = [
    'new', 'open', 'in_progress', 'pending', 'paused', 'llm_review',
    'assistant_review', 'resolved', 'qa', 'closed', 'ignored',
] as const;

export const TICKET_CATEGORIES = [
    'ticket', 'bug', 'feature', 'incident', 'security', 'fulfillment',
    'new_user', 'new_group', 'qa',
] as const;

function label(value: string): string {
    return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string): Tone {
    if (status === 'resolved' || status === 'closed') return 'success';
    if (status === 'ignored' || status === 'paused') return 'muted';
    if (status === 'new' || status === 'pending' || status.endsWith('_review')) return 'warning';
    return 'info';
}

function priorityTone(priority: number): Tone {
    if (priority >= 8) return 'danger';
    if (priority >= 5) return 'warning';
    return 'muted';
}

function selectOptions(values: readonly string[]) {
    return values.map((value) => ({ value, label: label(value) }));
}

function ticketChanges(data: FormData): Record<string, unknown> {
    const title = String(data.title ?? '').trim();
    if (!title) throw new Error('Title is required');
    const priority = Number(String(data.priority ?? '').trim());
    if (!Number.isInteger(priority) || priority < 1 || priority > 10) {
        throw new Error('Priority must be a whole number from 1 to 10');
    }
    return {
        title,
        description: String(data.description ?? ''),
        status: String(data.status ?? 'new'),
        category: String(data.category ?? 'ticket'),
        priority,
        assignee: data.assignee === '' || data.assignee == null ? null : data.assignee,
    };
}

function TicketEditor({ row, close }: { row?: TicketRow; close(saved: boolean): void }) {
    const save = TicketModel.useSave();
    const { can: canLookupUsers } = useCan(TICKET_USER_LOOKUP_PERMS);
    const { can: canManage } = useCan(TICKET_MANAGE_PERMS);
    const canAssign = canManage && canLookupUsers;
    const queryClient = useQueryClient();
    const [priority, setPriority] = useState(String(row?.priority ?? 5));
    const [priorityError, setPriorityError] = useState('');
    const fields = useMemo<Field[]>(() => [
        { name: 'title', type: 'text', label: 'Title', required: true },
        { name: 'description', type: 'textarea', label: 'Description' },
        {
            name: 'status', type: 'select', label: 'Status', required: true, columns: 6,
            options: selectOptions(knownOptionsWithCurrent(TICKET_STATUSES, row?.status)),
        },
        {
            name: 'category', type: 'select', label: 'Category', required: true, columns: 6,
            options: selectOptions(knownOptionsWithCurrent(TICKET_CATEGORIES, row?.category)),
        },
        ...(canAssign ? [{
            name: 'assignee', type: 'collection', label: 'Assignee', columns: 6,
            endpoint: '/api/user', labelField: 'display_name', valueField: 'id',
            placeholder: 'Search users…',
        } satisfies Field] : []),
    ], [canAssign, row?.category, row?.status]);

    return (
        <div className="modal-pad ticket-editor">
            <h2 className="modal-title">{row ? `Edit ticket #${row.id}` : 'Create ticket'}</h2>
            <label className="field ticket-editor-priority">
                <span className="field-label">Priority (1–10) <em>*</em></span>
                <input
                    className={`input${priorityError ? ' input-invalid' : ''}`}
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={priority}
                    onChange={(event) => { setPriority(event.target.value); setPriorityError(''); }}
                />
                {priorityError && <span className="field-error">{priorityError}</span>}
                {!priorityError && <span className="field-help">10 is the most urgent.</span>}
            </label>
            <SchemaForm
                fields={fields}
                initial={{
                    title: row?.title ?? '', description: row?.description ?? '',
                    status: row?.status ?? 'new', category: row?.category ?? 'ticket',
                    ...(canAssign ? { assignee: relationId(row?.assignee) } : {}),
                }}
                submitText={row ? 'Save changes' : 'Create ticket'}
                onCancel={() => close(false)}
                onSubmit={async (data) => {
                    const numericPriority = Number(priority);
                    if (!Number.isInteger(numericPriority) || numericPriority < 1 || numericPriority > 10) {
                        setPriorityError('Priority must be a whole number from 1 to 10');
                        throw new Error('Choose a valid priority');
                    }
                    const saved = await save.mutateAsync({
                        id: row?.id ?? null,
                        changes: ticketChanges({ ...data, priority: numericPriority }),
                    });
                    await invalidateTicketDependents(queryClient, saved.id);
                    toast.success(row ? 'Ticket updated' : 'Ticket created');
                    close(true);
                }}
            />
        </div>
    );
}

async function openTicketEditor(row?: TicketRow): Promise<void> {
    await modal.open<boolean>((close) => <TicketEditor row={row} close={close} />, { size: 'lg' });
}

function InlineTicketSelect({ row, field, values }: {
    row: TicketRow;
    field: 'status' | 'category';
    values: readonly string[];
}) {
    const save = TicketModel.useSave();
    const queryClient = useQueryClient();
    const [error, setError] = useState('');
    const current = row[field];
    const change = async (next: string) => {
        if (next === current) return;
        setError('');
        try {
            await save.mutateAsync({ id: row.id, changes: { [field]: next } });
            await invalidateTicketDependents(queryClient, row.id);
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : `Failed to update ${field}`;
            setError(message);
            toast.error(message);
        }
    };
    return (
        <div className="ticket-inline-field" onClick={(event) => event.stopPropagation()}>
            <select
                className={`ticket-inline-select ticket-inline-select-${field}`}
                aria-label={`${label(field)} for ticket ${row.id}`}
                value={current}
                disabled={save.isPending}
                onChange={(event) => void change(event.target.value)}
            >
                {knownOptionsWithCurrent(values, current).map((value) => (
                    <option value={value} key={value}>{label(value)}</option>
                ))}
            </select>
            {error && <span className="ticket-inline-error" role="alert">{error}</span>}
        </div>
    );
}

function objectValue(value: unknown): Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function actionFromItem(item: RecordFeedItem): TicketNoteAction | null {
    const action = objectValue(item.metadata.action);
    return Object.keys(action).length ? action : null;
}

function scalar(value: unknown): string | null {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
}

function referenceText(value: unknown): string | null {
    const direct = scalar(value);
    if (direct) return direct;
    const reference = objectValue(value);
    const explicit = scalar(reference.label);
    if (explicit) return explicit;
    const model = scalar(reference.model);
    const pk = scalar(reference.pk) ?? scalar(reference.id);
    return model && pk ? `${model.split('.').at(-1)} #${pk}` : null;
}

const KNOWN_ACTION_HANDLERS = new Set([
    'incident.rule_approval', 'incident.block_confirm', 'incident.rule_update', 'incident.escalate',
]);

function TicketActionCard({ item, ticket, canManage }: {
    item: RecordFeedItem;
    ticket: TicketRow;
    canManage: boolean;
}) {
    const action = actionFromItem(item);
    const queryClient = useQueryClient();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    if (!action) return null;

    const context = objectValue(action.context);
    const handler = scalar(action.handler);
    const cardLabel = handler && KNOWN_ACTION_HANDLERS.has(handler) ? (scalar(action.label) ?? 'Action required') : 'Action required';
    const detail = scalar(context.detail) ?? scalar(context.description);
    const target = referenceText(context.target) ?? referenceText(context.ref);
    const references = Array.isArray(action.references)
        ? action.references.map(referenceText).filter((entry): entry is string => entry != null).slice(0, 5)
        : [];
    const disabled = isTicketActionDisabled(action, ticket.status, canManage, pending);

    const respond = async (decision: 'approve' | 'deny') => {
        const confirmed = await modal.confirm({
            title: decision === 'approve' ? 'Approve action?' : 'Deny action?',
            message: `${decision === 'approve' ? 'Approve' : 'Deny'} “${cardLabel}”? The response is recorded as a new ticket note.`,
            confirmText: decision === 'approve' ? 'Approve' : 'Deny',
            danger: decision === 'deny',
        });
        if (!confirmed) return;
        setPending(true);
        setError('');
        try {
            await mojoSave('/api/incident/ticket/note', null, buildTicketActionResponseBody(
                ticket.id, relationId(ticket.group), action, decision,
            ));
            await invalidateTicketDependents(queryClient, ticket.id);
            toast.success(decision === 'approve' ? 'Action approved' : 'Action denied');
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Failed to record action response';
            setError(message);
            toast.error(message);
        } finally {
            setPending(false);
        }
    };

    return (
        <section className={`ticket-action-card${action.resolved ? ' is-resolved' : ''}`} aria-label={cardLabel}>
            <div className="ticket-action-card-head">
                <strong>{cardLabel}</strong>
                {Boolean(action.resolved) && <Badge tone="success">Resolved</Badge>}
            </div>
            {detail && <p>{detail}</p>}
            {target && <p className="dim">Target: {target}</p>}
            {references.length > 0 && <ul>{references.map((reference) => <li key={reference}>{reference}</li>)}</ul>}
            {action.resolution != null && <p className="dim">Resolution: {scalar(action.resolution) ?? 'Recorded'}</p>}
            {!action.resolved && (
                <div className="ticket-action-card-actions">
                    <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => void respond('approve')}>Approve</button>
                    <button type="button" className="btn btn-danger" disabled={disabled} onClick={() => void respond('deny')}>Deny</button>
                </div>
            )}
            {error && <div className="form-alert" role="alert">{error}</div>}
        </section>
    );
}

function safeRemoteUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch {
        return null;
    }
}

function TicketDetail({ ticketId, close }: { ticketId: number; close(): void }) {
    const queryClient = useQueryClient();
    const ticketQuery = TicketModel.useOne(ticketId);
    const linkQuery = MaestroItemLinkModel.useList({ ticket: ticketId, size: 1, graph: 'default' });
    const { can: canManage, me } = useCan(TICKET_MANAGE_PERMS);
    const { can: canAssign } = useCan(TICKET_USER_LOOKUP_PERMS);
    const save = TicketModel.useSave();
    const enableLlm = TicketModel.useAction('enable_llm');
    const disableLlm = TicketModel.useAction('disable_llm');
    const pushToMaestro = TicketModel.useAction('push_to_maestro');
    const [polling, setPolling] = useState(false);
    const [error, setError] = useState('');
    const [priorityDraft, setPriorityDraft] = useState('');
    const [priorityError, setPriorityError] = useState('');
    const [descriptionDraft, setDescriptionDraft] = useState('');
    const pollDeadline = useRef(0);
    const link = linkQuery.data?.rows[0];

    useEffect(() => {
        if (!ticketQuery.data) return;
        setPriorityDraft(String(ticketQuery.data.priority));
        setPriorityError('');
        setDescriptionDraft(ticketQuery.data.description ?? '');
    }, [ticketQuery.data?.id, ticketQuery.data?.priority, ticketQuery.data?.description]);

    useEffect(() => {
        if (!polling || link) {
            if (link) setPolling(false);
            return;
        }
        const poll = () => {
            if (Date.now() >= pollDeadline.current) {
                setPolling(false);
                return;
            }
            void linkQuery.refetch();
        };
        const timer = window.setInterval(poll, 2_000);
        return () => window.clearInterval(timer);
    }, [polling, link, linkQuery.refetch]);

    if (ticketQuery.isLoading) return <div className="ticket-detail-state"><span className="spinner" /> Loading ticket… <button type="button" className="btn" onClick={close}>Close</button></div>;
    if (ticketQuery.error || !ticketQuery.data) {
        return (
            <div className="ticket-detail-state">
                <h3>Ticket unavailable</h3>
                <p className="form-alert">{ticketQuery.error?.message ?? 'The ticket could not be loaded.'}</p>
                <div className="demo-row">
                    <button type="button" className="btn" onClick={() => void ticketQuery.refetch()}>Retry</button>
                    <button type="button" className="btn" onClick={close}>Close</button>
                </div>
            </div>
        );
    }

    const ticket = ticketQuery.data;
    const ticketGroup = relationId(ticket.group);
    const groupIsValid = ticketGroup == null
        || (typeof ticketGroup === 'number' && Number.isSafeInteger(ticketGroup) && ticketGroup > 0);
    const uploadGroupId = typeof ticketGroup === 'number' ? ticketGroup : null;
    const adapter = createTicketNoteAdapter(ticket.id, { groupId: ticketGroup });
    const llmEnabled = ticket.metadata.llm_enabled === true;
    const busy = save.isPending || enableLlm.isPending || disableLlm.isPending || pushToMaestro.isPending;
    const patch = async (changes: Record<string, unknown>, success: string) => {
        setError('');
        try {
            await save.mutateAsync({ id: ticket.id, changes });
            await invalidateTicketDependents(queryClient, ticket.id);
            toast.success(success);
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Ticket update failed';
            setError(message);
            toast.error(message);
        }
    };
    const runLlm = async () => {
        setError('');
        try {
            const mutation = llmEnabled ? disableLlm : enableLlm;
            await mutation.mutateAsync({ id: ticket.id, payload: {} });
            await invalidateTicketDependents(queryClient, ticket.id);
            toast.success(llmEnabled ? 'LLM assistance disabled' : 'LLM assistance enabled');
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'LLM action failed';
            setError(message);
            toast.error(message);
        }
    };
    const push = async () => {
        const confirmed = await modal.confirm({
            title: 'Push ticket to Maestro?',
            message: 'This queues a background sync. The linked item may take a few seconds to appear.',
            confirmText: 'Queue push',
        });
        if (!confirmed) return;
        setError('');
        try {
            await pushToMaestro.mutateAsync({ id: ticket.id, payload: {} });
            pollDeadline.current = Date.now() + 30_000;
            setPolling(true);
            await linkQuery.refetch();
            toast.info('Maestro push queued');
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Failed to queue Maestro push';
            setError(message);
            toast.error(message);
        }
    };
    const remoteUrl = safeRemoteUrl(link?.remote_url);

    return (
        <DetailView
            icon="bi-ticket-detailed"
            title={ticket.title}
            subtitle={`Ticket #${ticket.id} · created ${fmt.datetime(ticket.created)} · updated ${fmt.relative(ticket.modified)}`}
            chips={[
                { text: label(ticket.status), tone: statusTone(ticket.status) },
                { text: `P${ticket.priority}`, tone: priorityTone(ticket.priority) },
                { text: label(ticket.category), tone: 'muted' },
            ]}
            onClose={close}
            menuContext={ticket}
            sections={[
                {
                    key: 'overview', label: 'Overview', icon: 'bi-info-circle', render: () => (
                        <div className="ticket-detail-summary">
                            <dl className="ticket-facts">
                                <div><dt>Assignee</dt><dd>{relationLabel(ticket.assignee, 'Unassigned')}</dd></div>
                                <div><dt>Group</dt><dd>{relationLabel(ticket.group, 'Global')}</dd></div>
                                <div><dt>Incident</dt><dd>{relationLabel(ticket.incident, 'None')}</dd></div>
                                <div><dt>LLM assistance</dt><dd>{llmEnabled ? 'Enabled' : 'Disabled'}</dd></div>
                            </dl>
                            <div className="ticket-description">
                                <h4>Description</h4>
                                {ticket.description ? <MarkdownView source={ticket.description} /> : <p className="dim">No description.</p>}
                                <AssistantContextLauncher model="incident.Ticket" pk={ticket.id} />
                            </div>
                            <div className="ticket-maestro-link">
                                <h4>Maestro</h4>
                                {link ? (
                                    <p>{remoteUrl
                                        ? <a href={remoteUrl} target="_blank" rel="noreferrer">Item #{link.remote_item_id}</a>
                                        : <>Item #{link.remote_item_id}</>}</p>
                                ) : (
                                    <p className="dim">{polling ? 'Waiting for the queued link…' : 'Not linked.'}</p>
                                )}
                                <button type="button" className="btn btn-sm" disabled={linkQuery.isFetching} onClick={() => void linkQuery.refetch()}>
                                    {linkQuery.isFetching ? 'Checking…' : 'Check link'}
                                </button>
                            </div>
                        </div>
                    ),
                },
                ...(canManage ? [{
                    key: 'manage', label: 'Manage', icon: 'bi-sliders', render: () => (
                <section className="ticket-detail-controls" aria-label="Ticket controls">
                    <h4>Manage ticket</h4>
                    {error && <div className="form-alert" role="alert">{error}</div>}
                    <div className="ticket-control-grid">
                        <label className="field"><span className="field-label">Status</span>
                            <select className="input" value={ticket.status} disabled={busy} onChange={(event) => void patch({ status: event.target.value }, 'Status updated')}>
                                {knownOptionsWithCurrent(TICKET_STATUSES, ticket.status).map((value) => <option key={value} value={value}>{label(value)}</option>)}
                            </select>
                        </label>
                        <label className="field"><span className="field-label">Category</span>
                            <select className="input" value={ticket.category} disabled={busy} onChange={(event) => void patch({ category: event.target.value }, 'Category updated')}>
                                {knownOptionsWithCurrent(TICKET_CATEGORIES, ticket.category).map((value) => <option key={value} value={value}>{label(value)}</option>)}
                            </select>
                        </label>
                        <label className="field"><span className="field-label">Priority (1–10)</span>
                            <input className={`input${priorityError ? ' input-invalid' : ''}`} type="number" min={1} max={10} step={1} value={priorityDraft} disabled={busy} onChange={(event) => { setPriorityDraft(event.target.value); setPriorityError(''); }} onBlur={() => {
                                const value = Number(priorityDraft);
                                if (!Number.isInteger(value) || value < 1 || value > 10) {
                                    setPriorityError('Enter a whole number from 1 to 10');
                                    return;
                                }
                                if (value !== ticket.priority) void patch({ priority: value }, 'Priority updated');
                            }} />
                            {priorityError && <span className="field-error" role="alert">{priorityError}</span>}
                        </label>
                        {canAssign && <CollectionSelect
                            endpoint="/api/user"
                            value={relationId(ticket.assignee)}
                            onChange={(next) => { if (next !== relationId(ticket.assignee)) void patch({ assignee: next }, 'Assignee updated'); }}
                            labelField="display_name"
                            valueField="id"
                            label="Assignee"
                            placeholder="Search users…"
                            disabled={busy}
                        />}
                    </div>
                    <label className="field"><span className="field-label">Description</span>
                        <textarea className="input" rows={4} value={descriptionDraft} disabled={busy} onChange={(event) => setDescriptionDraft(event.target.value)} onBlur={() => {
                            if (descriptionDraft !== (ticket.description ?? '')) void patch({ description: descriptionDraft }, 'Description updated');
                        }} />
                    </label>
                    <div className="ticket-control-actions">
                        <button type="button" className="btn" disabled={busy} onClick={() => void runLlm()}>{llmEnabled ? 'Disable LLM' : 'Enable LLM'}</button>
                        <button type="button" className="btn" disabled={busy || isTicketTerminal(ticket.status)} onClick={() => void patch({ status: 'closed' }, 'Ticket closed')}>Close ticket</button>
                        <button type="button" className="btn" disabled={busy || Boolean(link)} onClick={() => void push()}>{pushToMaestro.isPending ? 'Queueing…' : 'Push to Maestro'}</button>
                        <button type="button" className="btn" disabled={busy} onClick={() => void openTicketEditor(ticket)}>Edit all fields</button>
                    </div>
                </section>
                    ),
                }] : []),
                {
                    key: 'activity', label: 'Activity', icon: 'bi-clock-history', render: () => (
                        <section className="ticket-detail-feed">
                            <RecordFeed
                                adapter={adapter}
                                variant="compact"
                                showInput={canManage}
                                currentUserId={me?.id ?? null}
                                renderAddon={(item) => <TicketActionCard item={item} ticket={ticket} canManage={canManage} />}
                                {...(groupIsValid ? { attachmentUpload: {
                                    destination: uploadGroupId == null ? {} : { groupId: uploadGroupId, use: 'uploads' },
                                    expectedGroupId: uploadGroupId,
                                } } : {})}
                            />
                        </section>
                    ),
                },
            ]}
        />
    );
}

const TICKET_FILTERS: FilterDef[] = [
    { key: 'status', label: 'Status', type: 'multiselect', options: selectOptions(TICKET_STATUSES) },
    { key: 'category', label: 'Category', type: 'multiselect', options: selectOptions(TICKET_CATEGORIES) },
    { key: 'assignee', label: 'Assignee ID', type: 'number', lookup: 'exact' },
    { key: 'priority', label: 'Minimum priority', type: 'number' },
];

export function TicketsPage() {
    const { can: canManage } = useCan(TICKET_MANAGE_PERMS);
    const openTicket = (row: TicketRow) => void modal.detail((close) => (
        <TicketDetail ticketId={row.id} close={() => close(null)} />
    ));
    const columns: Column<TicketRow>[] = [
        { key: 'id', label: 'ID', sortable: true, align: 'end', render: (row) => `#${row.id}` },
        {
            key: 'title', label: 'Title', sortable: true, hideable: false,
            render: (row) => <button type="button" className="ticket-title-button" onClick={(event: MouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                openTicket(row);
            }}>{row.title}</button>,
        },
        { key: 'status', label: 'Status', sortable: true, render: (row) => canManage ? <InlineTicketSelect row={row} field="status" values={TICKET_STATUSES} /> : <Badge tone={statusTone(row.status)}>{label(row.status)}</Badge> },
        { key: 'priority', label: 'Priority', sortable: true, align: 'center', render: (row) => <Badge tone={priorityTone(row.priority)}>P{row.priority}</Badge> },
        { key: 'category', label: 'Category', sortable: true, render: (row) => canManage ? <InlineTicketSelect row={row} field="category" values={TICKET_CATEGORIES} /> : label(row.category) },
        { key: 'assignee', label: 'Assignee', render: (row) => relationLabel(row.assignee, 'Unassigned') },
        { key: 'created', label: 'Created', sortable: true, render: (row) => fmt.datetime(row.created) },
        { key: 'modified', label: 'Updated', sortable: true, render: (row) => fmt.relative(row.modified) },
    ];

    return (
        <ModelTable
            model={TicketModel}
            columns={columns}
            filters={TICKET_FILTERS}
            eyebrow="Security operations"
            title="Tickets"
            searchPlaceholder="Search tickets…"
            defaultParams={{ sort: '-priority', status__in: 'new,open' }}
            columnChooser
            persistState
            persistKey="admin-security-tickets"
            exportFormats={['csv', 'json']}
            autoRefresh={30}
            onRowClick={(row) => openTicket(row)}
            {...(canManage ? { addLabel: 'New ticket', onAdd: () => void openTicketEditor() } : {})}
        />
    );
}
