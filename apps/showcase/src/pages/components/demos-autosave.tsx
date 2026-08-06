// FormView autosave demo — the B3 flagship ("no save buttons") against the
// mock UserModel row, end to end:
//   · commit (blur/Enter/toggle) → 300ms batch → ONE POST of changed fields
//     (tab through fields quickly / flip several switches: the log shows one
//     request carrying them all)
//   · per-field indicators: dirty dot → spinner → saved flash → idle; errors
//     pin with the message until the field's next successful save
//   · zod per field: garbage phone ("abc") is caught CLIENT-side; a pretty
//     short NANP number ("+1 (555) 0100") passes the loose client schema and
//     the SERVER rejects it (E.164 rule) → the field visibly reverts + toast
//   · showWhen pair (declarative rule AND predicate) on metadata.* fields
//   · a permission tabset from the registry — gated tabs resolve fail-closed
//     against the signed-in me (registry replaces web-mojo's live-mutated
//     permission arrays)
import { useState } from 'react';
import { z } from 'zod';
import { FormView, registerFormTabs } from 'portal-mojo/ui';
import type { Field } from 'portal-mojo/ui';
import { UserModel } from '../../models';

// ── Permission tabset (module-load registration, like an app would) ───
// Field shape mirrors User._permSwitch / Member._permSwitch: a switch named
// `permissions.<name>` — FormView expands the dotted name to a partial dict
// ({permissions: {view_metrics: true}}) and django-mojo MERGES it.
const permSwitch = (name: string, label: string): Field => ({
    name: `permissions.${name}`,
    type: 'switch',
    label,
    columns: 6,
});

registerFormTabs('demo.user-permissions', [
    {
        key: 'standard',
        label: 'Standard',
        // Ungated — visible to everyone (Member.BASE_PERMISSIONS heritage).
        fields: [
            permSwitch('manage_group', 'Manage Group'),
            permSwitch('view_metrics', 'View Metrics'),
            permSwitch('view_logs', 'View Logs'),
            permSwitch('view_members', 'View Members'),
            permSwitch('manage_members', 'Manage Members'),
            permSwitch('view_billing', 'View Billing'),
        ],
    },
    {
        key: 'users',
        label: 'Users',
        // Gated like the backend gates user writes (any-of).
        permissions: ['users', 'manage_users'],
        fields: [
            permSwitch('view_users', 'View Users'),
            permSwitch('manage_users', 'Manage Users'),
            permSwitch('view_groups', 'View Groups'),
            permSwitch('manage_groups', 'Manage Groups'),
        ],
    },
    {
        key: 'system',
        label: 'System',
        // Category permissions — only admin-holders (or superusers) see this.
        permissions: ['admin'],
        fields: [
            permSwitch('admin', 'System Admin'),
            permSwitch('view_admin', 'Admin Panel'),
            permSwitch('security', 'Security'),
            permSwitch('metrics', 'Metrics'),
        ],
    },
]);

// ── Fields ────────────────────────────────────────────────────────────

const PROFILE_FIELDS: Field[] = [
    {
        name: 'display_name', type: 'text', label: 'Display name', columns: 6,
        schema: z.string().min(2, 'At least 2 characters'),
        help: 'Blur or press Enter to save.',
    },
    {
        name: 'email', type: 'email', label: 'Email', columns: 6,
        schema: z.email('Enter a valid email address'),
    },
    {
        name: 'phone_number', type: 'tel', label: 'Phone', columns: 6,
        placeholder: '+15555550142',
        // Deliberately LOOSER than the server: letters fail here (zod catch),
        // but a short pretty NANP number ("+1 (555) 0100") passes and the
        // server rejects it — proving the revert path with a real message.
        schema: z.string().refine(
            (v) => v === '' || (/^[+()\-\s.\d]+$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 7),
            'Digits and + only — e.g. +15555550142',
        ),
        help: 'Server wants E.164. Try "abc" (client catch), then "+1 (555) 0100" (server reject → revert).',
    },
];

const PREF_FIELDS: Field[] = [
    {
        name: 'metadata.contact_pref', type: 'select', label: 'Preferred contact', columns: 6,
        placeholder: 'Choose…',
        options: [
            { value: 'none', label: 'No contact' },
            { value: 'email', label: 'Email' },
            { value: 'phone', label: 'Phone call' },
        ],
        help: 'Controls the two fields beside it.',
    },
    {
        name: 'metadata.contact_email', type: 'email', label: 'Contact email', columns: 6,
        // Declarative showWhen — FormBuilder's {field, value, negate?} shape.
        showWhen: { field: 'metadata.contact_pref', value: 'email' },
        schema: z.email('Enter a valid email address'),
        help: 'Declarative showWhen: value === "email".',
    },
    {
        name: 'metadata.call_hours', type: 'text', label: 'Call hours', columns: 6,
        // Predicate showWhen — any function of the live values.
        showWhen: (v) => v['metadata.contact_pref'] === 'phone',
        placeholder: '9am–5pm',
        help: 'Predicate showWhen: (values) => values[…] === "phone".',
    },
];

// ── Demo ──────────────────────────────────────────────────────────────

const DEMO_USER_ID = 1;

export function AutosaveDemo() {
    const { data: user, isPending } = UserModel.useOne(DEMO_USER_ID);
    const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);

    const push = (ok: boolean, text: string) =>
        setLog((l) => [{ ok, text }, ...l].slice(0, 8));

    if (isPending || !user) {
        return <div className="panel panel-pad"><span className="skel skel-block" /></div>;
    }

    return (
        <div className="panel panel-pad">
            <p className="dim" style={{ marginBottom: 14 }}>
                No save buttons. Commits (blur / Enter / toggle) batch for 300ms and POST
                once — only the changed fields. Failed saves revert to the server value and
                pin the error. Tab-flip several permission switches quickly and watch the
                log carry them in one request.
            </p>

            <div className="eyebrow">Profile — zod + server reject/revert</div>
            <FormView model={UserModel} row={user} fields={PROFILE_FIELDS}
                onSaved={(info) => push(true, `POST ${JSON.stringify(info.changes)} — ${info.fields.length} field${info.fields.length === 1 ? '' : 's'}`)}
                onSaveError={(info) => push(false, `POST ${JSON.stringify(info.changes)} → ${info.error.message}`)}
            />

            <div className="eyebrow" style={{ marginTop: 18 }}>Preferences — showWhen pair (hidden fields never save)</div>
            <FormView model={UserModel} row={user} fields={PREF_FIELDS}
                onSaved={(info) => push(true, `POST ${JSON.stringify(info.changes)}`)}
                onSaveError={(info) => push(false, `POST ${JSON.stringify(info.changes)} → ${info.error.message}`)}
            />

            <div className="eyebrow" style={{ marginTop: 18 }}>Permission tabset — registry, fail-closed gates</div>
            <p className="dim" style={{ margin: '2px 0 6px', fontSize: 12.5 }}>
                Tabs: <code>Standard</code> (ungated) · <code>Users</code> (needs <code>users</code>/<code>manage_users</code>) ·{' '}
                <code>System</code> (needs <code>admin</code>). Signed out or unprivileged, the gated tabs simply
                don't exist — same fail-closed rule as <code>&lt;Guarded&gt;</code>.
            </p>
            <FormView model={UserModel} row={user} tabs="demo.user-permissions"
                onSaved={(info) => push(true, `POST ${JSON.stringify(info.changes)} — ${info.fields.length} field${info.fields.length === 1 ? '' : 's'}`)}
                onSaveError={(info) => push(false, `POST ${JSON.stringify(info.changes)} → ${info.error.message}`)}
            />

            <div className="eyebrow" style={{ marginTop: 18 }}>Save log (newest first)</div>
            {log.length === 0
                ? <p className="dim" style={{ fontSize: 12.5 }}>No saves yet — edit a field above.</p>
                : (
                    <pre className="demo-pre" style={{ margin: 0 }}>
                        {log.map((e, i) => `${e.ok ? '✓' : '✗'} ${e.text}`.slice(0, 200) + (i < log.length - 1 ? '\n' : '')).join('')}
                    </pre>
                )}
        </div>
    );
}
