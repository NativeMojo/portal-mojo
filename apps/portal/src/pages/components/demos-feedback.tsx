// Feedback demos: SchemaForm field language, the awaitable modal manager,
// toasts, and the DetailView house style.
import { useState } from 'react';
import { Badge, DetailView, Eyebrow, FlatRow, SchemaForm, SecurityItem, formModal, modal, toast, type Field } from 'portal-mojo/ui';

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

export function ToastsDemo() {
    return (
        <div className="panel panel-pad demo-row">
            <button className="btn" onClick={() => toast.success('Saved')}>success</button>
            <button className="btn" onClick={() => toast.error('Save failed — server said no')}>error</button>
            <button className="btn" onClick={() => toast.info('FYI')}>info</button>
            <button className="btn" onClick={() => toast.warning('Disable: 3 succeeded, 2 failed')}>warning (partial)</button>
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
