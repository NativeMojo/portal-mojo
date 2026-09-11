// Feedback demos: SchemaForm field language, the awaitable modal manager,
// toasts, and the DetailView house style.
import { useState } from 'react';
import { Badge, DetailView, Eyebrow, FlatRow, ModelTable, SchemaForm, SecurityItem, confirmGuardrail, formModal, modal, toast, type Column, type Field } from 'portal-mojo/ui';
import type { Group } from 'portal-mojo/client/runtime';
import { GroupModel } from '../../models';

const ALL_FIELDS: Field[] = [
    { name: 'display_name', type: 'text', label: 'Display name', required: true, placeholder: 'Jane Cooper' },
    { name: 'email', type: 'email', label: 'Email', required: true, placeholder: 'jane@example.com' },
    { name: 'phone', type: 'tel', label: 'Phone', columns: 6, help: 'E.164 — the server rejects pretty formats' },
    {
        name: 'tier', type: 'select', label: 'Tier (required select)', columns: 6, required: true, options: [
            { value: 'free', label: 'Free' },
            { value: 'pro', label: 'Pro' },
            { value: 'enterprise', label: 'Enterprise' },
        ],
    },
    { name: 'notes', type: 'textarea', label: 'Notes', placeholder: 'Optional context…' },
    { name: 'notify', type: 'switch', label: 'Send notifications' },
];

export function FormsDemo() {
    const [submitted, setSubmitted] = useState<string>('');
    return (
        <div className="panel panel-pad">
            <p className="dim" style={{ marginBottom: 14 }}>
                Fields are data; inputs are controlled. The required select starts on a real
                placeholder — display always equals state, so it can never show a value the
                submit won't carry.
            </p>
            <SchemaForm
                fields={ALL_FIELDS}
                submitText="Try submit"
                onSubmit={(data) => { setSubmitted(JSON.stringify(data, null, 2)); toast.success('Form valid — see payload below'); }}
            />
            {submitted && <pre className="demo-pre">{submitted}</pre>}
        </div>
    );
}

export function ModalsDemo() {
    const confirmDemo = async (danger: boolean) => {
        const ok = await modal.confirm({
            title: danger ? 'Delete everything' : 'Apply changes',
            message: danger ? 'This is the danger variant. Nothing is actually deleted.' : 'Plain confirm — resolves true/false.',
            confirmText: danger ? 'Delete' : 'Apply',
            danger,
        });
        toast.info(`confirm resolved: ${String(ok)}`);
    };
    const formDemo = async () => {
        const data = await formModal({
            title: 'Awaitable form',
            submitText: 'Save',
            fields: [
                { name: 'name', type: 'text', label: 'Name', required: true },
                {
                    name: 'reason', type: 'select', label: 'Reason (required)', required: true, options: [
                        { value: 'admin', label: 'Admin' },
                        { value: 'abuse', label: 'Abuse' },
                    ],
                },
            ],
        });
        toast.info(data ? `resolved: ${JSON.stringify(data)}` : 'cancelled → null');
    };
    return (
        <div className="panel panel-pad demo-row">
            <button className="btn" onClick={() => void confirmDemo(false)}>confirm()</button>
            <button className="btn btn-danger-ghost" onClick={() => void confirmDemo(true)}>confirm (danger)</button>
            <button className="btn" onClick={() => void formDemo()}>formModal()</button>
            <button className="btn" onClick={() => { void modal.confirm({ title: 'Stacked', message: 'Open another on top — native <dialog> stacks for free.', confirmText: 'OK' }); void confirmDemo(false); }}>
                stacked dialogs
            </button>
        </div>
    );
}

// The "are you sure, and here is why" stop — three tiers, nothing is actually
// changed. Copy is the house shape: effect · why (backend facts) · undo.
export function GuardrailDemo() {
    const report = (ok: boolean) => toast.info(`confirmGuardrail resolved: ${String(ok)}`);
    const typed = async () => report(await confirmGuardrail({
        title: 'Disable Alea for Club Axo?',
        effect: <>Every Alea game on Club Axo returns <b>503</b> to players the moment this saves.</>,
        why: [
            <>Open sessions are cut mid-round — wagers already placed settle on the provider's terms, not ours.</>,
            <>The lobby keeps listing Alea titles until the next catalogue sync (up to 15 minutes); players see errors, not a notice.</>,
            <>Bonuses restricted to Alea titles stop being redeemable, and their expiry clocks keep running.</>,
        ],
        undo: 'Re-enable it here; sessions do not resume — players start new ones.',
        confirmText: 'Disable Alea',
        typeToConfirm: 'Club Axo',
    }));
    const danger = async () => report(await confirmGuardrail({
        title: 'Deactivate API key "Webhook worker"?',
        effect: <>The key stops authenticating the moment this saves.</>,
        why: [
            <>Every integration holding this key gets <b>401</b> on its next call — the caller sees an auth failure, not a notice.</>,
            <>The key is <b>not rotated</b>: the same secret stays on file, so anyone who holds it regains access the instant it is re-enabled.</>,
        ],
        undo: 'Re-enabling restores the same key; no integration needs a new secret.',
        confirmText: 'Deactivate key',
    }));
    const warn = async () => report(await confirmGuardrail({
        title: 'Switch Club Axo to the EU tax profile?',
        effect: <>Every quote issued from now on carries EU VAT lines instead of US sales tax.</>,
        why: [
            <>Invoices already issued are not restated — reports mix two regimes for the current period.</>,
            <>Price lists that hard-code tax-inclusive amounts show the old totals until re-imported.</>,
        ],
        undo: 'Switch back here; the same caveats apply in reverse.',
        confirmText: 'Switch profile',
        cancelText: 'Keep US',
        danger: false,
    }));
    // The guardrail opens from INSIDE the form's submit, so the form stays
    // open behind it: Cancel returns the operator to their edits; confirm
    // closes both. This is the shape for identity fields (uuid, auth_domain).
    const stacked = async () => {
        const data = await modal.open<Record<string, unknown> | null>((close) => (
            <div className="modal-pad">
                <h2 className="modal-title">Edit identity</h2>
                <p className="modal-message">Saving opens the guardrail ON TOP of this form — the form stays open behind it.</p>
                <SchemaForm
                    fields={[{ name: 'auth_domain', type: 'text', label: 'Auth domain', required: true, help: 'A typo here kills player sign-in.' }]}
                    initial={{ auth_domain: 'login.clubaxo.com' }}
                    submitText="Save"
                    onCancel={() => close(null)}
                    onSubmit={async (form) => {
                        const ok = await confirmGuardrail({
                            title: `Change the auth domain to ${String(form.auth_domain)}?`,
                            effect: <>White-label sign-in resolves against <b>{String(form.auth_domain)}</b> on the next request.</>,
                            why: [<>If that host does not serve the sign-in page, every player login on this brand fails until it is corrected.</>],
                            confirmText: 'Change domain',
                            danger: false,
                        });
                        if (ok) close(form);
                    }}
                />
            </div>
        ), { size: 'md' });
        toast.info(data ? `saved: ${JSON.stringify(data)}` : 'form cancelled → null');
    };
    return (
        <div className="panel panel-pad" style={{ display: 'grid', gap: 14 }}>
            <p className="dim" style={{ margin: 0 }}>
                <code>modal.confirm</code> for the reversible; <code>ArmedButton</code> for the inline irreversible;
                <code> confirmGuardrail</code> for anything that takes a tenant dark, moves money, or can't be undone —
                the operator reads <em>why</em> before the button arms. Resolves <code>false</code> on Escape / backdrop / Cancel.
            </p>
            <div className="demo-row">
                <button className="btn btn-danger-ghost" onClick={() => void typed()}>typeToConfirm (button disabled until typed)</button>
                <button className="btn btn-danger-ghost" onClick={() => void danger()}>danger (default)</button>
                <button className="btn" onClick={() => void warn()}>danger: false (warn tint)</button>
                <button className="btn" onClick={() => void stacked()}>stacked over a formModal</button>
            </div>
            <div>
                <div className="eyebrow">ModelTable batch action — <code>confirm</code> as a function</div>
                <p className="dim" style={{ margin: '4px 0 10px' }}>
                    Select rows and run <b>Archive</b>: the function form REPLACES <code>modal.confirm</code> with a guardrail
                    (five or more rows → type the count). Cancel mutates nothing; confirm runs the per-row no-op and toasts.
                    Permission lives in <code>confirm</code>, input collection in <code>prepare</code>.
                </p>
                <ModelTable<GroupRow>
                    model={GroupModel}
                    title="Groups"
                    eyebrow="Playground · confirm: fn"
                    searchPlaceholder="Search groups…"
                    defaultSort="name"
                    columns={GUARD_COLUMNS}
                    selectable
                    batchActions={[{
                        key: 'archive', label: 'Archive', icon: 'bi-archive', danger: true,
                        confirm: (rows) => confirmGuardrail({
                            title: `Archive ${rows.length} group${rows.length === 1 ? '' : 's'}?`,
                            effect: <>{rows.slice(0, 4).map((g) => g.name).join(', ')}{rows.length > 4 ? `, +${rows.length - 4} more` : ''} disappear from every member's group switcher the moment each call lands.</>,
                            why: [
                                <>Members keep their rows but lose the group in every scoped page — API keys, webhooks and events under it stop resolving.</>,
                                <>Sub-groups are archived with their parent; nothing re-parents them.</>,
                            ],
                            undo: 'Restore from the Archived preset; membership and keys come back as they were.',
                            confirmText: `Archive ${rows.length}`,
                            typeToConfirm: rows.length >= 5 ? String(rows.length) : undefined,
                        }),
                        run: async () => { /* demo: nothing is archived */ },
                    }]}
                />
            </div>
        </div>
    );
}

type GroupRow = Group & { id: number };
const GUARD_COLUMNS: Column<GroupRow>[] = [
    { key: 'name', label: 'Group', sortable: true },
    { key: 'kind', label: 'Kind', sortable: true },
];

export function ToastsDemo() {
    const inModal = () => void modal.open(close => <div className="modal-pad">
        <h2 className="modal-title">Toast above a modal</h2>
        <p className="modal-message">Notifications stay readable and their actions stay usable above stacked dialogs.</p>
        <div className="demo-row">
            <button className="btn" onClick={() => toast.error('Connection failed: the stored API key is missing')}>Show error toast</button>
            <button className="btn" onClick={() => toast.undo('Demo change applied', () => toast.success('Demo change undone'))}>Show Undo toast</button>
            <button className="btn" onClick={() => { const progress = toast.progress('Demo upload', { onCancel: () => progress.remove() }); progress.update(43); }}>Show progress toast</button>
            <button className="btn" onClick={inModal}>Open nested modal</button>
        </div>
        <div className="modal-actions"><button className="btn" onClick={() => close(null)}>Close toast demo</button></div>
    </div>);
    return (
        <div className="panel panel-pad demo-row">
            <button className="btn" onClick={() => toast.success('Saved')}>success</button>
            <button className="btn" onClick={() => toast.error('Save failed — server said no')}>error</button>
            <button className="btn" onClick={() => toast.info('FYI')}>info</button>
            <button className="btn" onClick={() => toast.warning('Disable: 3 succeeded, 2 failed')}>warning (partial)</button>
            <button className="btn" onClick={inModal}>Toasts inside modal</button>
        </div>
    );
}

export function DetailViewDemo() {
    const [active, setActive] = useState(true);
    const open = () => {
        void modal.detail((close) => (
            <DetailView
                avatarName="Demo Person"
                title="Demo Person"
                subtitle="demo@nativemojo.com"
                chips={[
                    { icon: 'bi-patch-check-fill', text: 'Email', tone: 'success' },
                    { text: 'playground', tone: 'info' },
                ]}
                active={{ value: active, onChange: (next) => { setActive(next); toast.info(`active → ${String(next)}`); } }}
                onClose={() => close(null)}
                sections={[
                    {
                        key: 'profile', label: 'Profile', icon: 'bi-person', render: () => (
                            <>
                                <Eyebrow>Contact</Eyebrow>
                                <FlatRow label="Email" action={() => toast.info('pencil clicked')}>demo@nativemojo.com <Badge tone="success">Verified</Badge></FlatRow>
                                <FlatRow label="Phone" action={() => toast.info('pencil clicked')} actionIcon="bi-plus-lg"><span className="dim-italic">Not set</span></FlatRow>
                            </>
                        ),
                    },
                    { divider: 'More' },
                    {
                        key: 'security', label: 'Security', icon: 'bi-shield-check', render: () => (
                            <>
                                <Eyebrow>Items</Eyebrow>
                                <SecurityItem icon="bi-key" title="SecurityItem" desc="Row with icon, title, description, trailing slot">
                                    <Badge tone="muted">slot</Badge>
                                </SecurityItem>
                            </>
                        ),
                    },
                ]}
            />
        ));
    };
    return (
        <div className="panel panel-pad demo-row">
            <button className="btn btn-primary" onClick={open}>Open DetailView modal</button>
            <span className="dim">Header chips + active switch + section rail with dividers — the UserView look.</span>
        </div>
    );
}
