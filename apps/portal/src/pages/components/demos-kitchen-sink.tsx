// Field-registry kitchen sink (board #1278) — ONE schema renders EVERY
// registered field type through the registry, on BOTH form surfaces:
//   · FormView (autosave): each commit batches 300ms → one POST against the
//     mock UserModel row; the live panel below derives, per field, the
//     CONTROL value (what the picker holds) and the WIRE value (what rides
//     the save body) from the row — the field-wire epoch boundary made
//     visible. Saves land in metadata.* (django-mojo merges dict bodies).
//   · SchemaForm (submit): the same schema; submitting shows the exact
//     payload body. NOTE dotted names stay FLAT keys in SchemaForm's payload
//     (FormView's autosave machine is what expands them to partial dicts).
// Also on show: alias precision mapping (monthpicker/yearrange…), explicit
// Field.precision beating the alias, outputFormat:'date' string wire for
// DateField columns, the REAL TimezoneSelect inside TimePicker's slot, the
// #1273 datetimepicker seam, and the unknown-type warn+text fallback
// (deliberate — expect ONE console.warn from the "sparkle" field).
import { useState } from 'react';
import { FormView, SchemaForm, getPath } from 'portal-mojo/ui';
import type { Field, FormData } from 'portal-mojo/ui';
import type { FieldValue, User } from 'portal-mojo/client';
import { wireToField, registeredFieldTypes } from 'portal-mojo/ui';
import { GroupModel, UserModel } from '../../models';

// ── The one schema — every registered type (all aliases), plus a builtin,
// an explicit-precision override, and a deliberate unknown. ──────────────
const KITCHEN_FIELDS: Field[] = [
    // Chips + option pickers
    { name: 'metadata.ks_tags', type: 'tag', label: 'Tags (tag)', columns: 6, help: 'CSV string on the wire.' },
    { name: 'metadata.ks_aliases', type: 'tags', label: 'Aliases (tags)', columns: 6, maxTags: 5, help: 'Same component — alias name.' },
    {
        name: 'metadata.ks_channels', type: 'multiselect', label: 'Channels (multiselect)', columns: 6,
        placeholder: 'Pick channels…', help: 'Array of values on the wire.',
        options: [
            { value: 'email', label: 'Email' },
            { value: 'sms', label: 'SMS' },
            { value: 'push', label: 'Push' },
            { value: 'webhook', label: 'Webhook', disabled: true },
        ],
    },
    {
        name: 'metadata.ks_flavor', type: 'combo', label: 'Flavor (combo)', columns: 6,
        allowCustom: true, help: 'Free text allowed (allowCustom).',
        options: [
            { value: 'vanilla', label: 'Vanilla', description: 'The default default' },
            { value: 'mango', label: 'Mango', description: 'Seasonal' },
            { value: 'mission-control', label: 'Mission Control', description: 'House special' },
        ],
    },
    {
        name: 'metadata.ks_engine', type: 'combobox', label: 'Engine (combobox)', columns: 6,
        allowCustom: false, help: 'List-only (allowCustom: false).',
        options: [
            { value: 'v8', label: 'V8' },
            { value: 'spidermonkey', label: 'SpiderMonkey' },
            { value: 'jsc', label: 'JavaScriptCore' },
        ],
    },
    {
        name: 'metadata.ks_city', type: 'autocomplete', label: 'City (autocomplete)', columns: 6,
        options: [
            { value: 'sf', label: 'San Francisco' },
            { value: 'nyc', label: 'New York' },
            { value: 'aus', label: 'Austin' },
        ],
    },

    // Server-backed pickers (mock endpoints)
    {
        name: 'metadata.ks_owner', type: 'collection', label: 'Owner (collection)', columns: 6,
        endpoint: '/api/user', labelField: 'display_name', help: 'Picked row id on the wire; null clears.',
    },
    {
        name: 'metadata.ks_teams', type: 'collectionmultiselect', label: 'Teams (collectionmultiselect)', columns: 6,
        model: GroupModel, enableSearch: true, help: 'Array of ids on the wire.',
    },
    {
        name: 'metadata.ks_orgs', type: 'collection-multiselect', label: 'Orgs (collection-multiselect)', columns: 6,
        endpoint: '/api/group', help: 'Hyphen alias — same component.',
    },

    // Dates: alias → precision, epoch wire, string opt-out, explicit override
    { name: 'metadata.ks_date', type: 'datepicker', label: 'Date (datepicker)', columns: 6, help: 'Epoch seconds (UTC midnight) on the wire.' },
    { name: 'metadata.ks_month', type: 'monthpicker', label: 'Month (monthpicker)', columns: 6, help: 'Alias pre-sets precision: month.' },
    { name: 'metadata.ks_year', type: 'yearpicker', label: 'Year (yearpicker)', columns: 6 },
    { name: 'metadata.ks_window', type: 'daterange', label: 'Window (daterange)', columns: 6, presets: 'default', help: '[startEpoch, endEpoch] on the wire.' },
    { name: 'metadata.ks_quarter', type: 'monthrange', label: 'Quarter (monthrange)', columns: 6 },
    { name: 'metadata.ks_era', type: 'yearrange', label: 'Era (yearrange)', columns: 6 },
    {
        name: 'metadata.ks_printed', type: 'datepicker', label: 'Date, string wire (outputFormat: date)', columns: 6,
        outputFormat: 'date', help: "For DateField columns: 'YYYY-MM-DD' rides the wire instead of an epoch.",
    },
    {
        name: 'metadata.ks_override', type: 'monthpicker', precision: 'year', label: 'Override (monthpicker + precision: year)', columns: 6,
        help: 'Explicit Field.precision beats the alias — a YEAR grid.',
    },

    // Time / zone / datetime
    {
        name: 'metadata.ks_alert', type: 'timepicker', label: 'Alert (timepicker + zone)', columns: 6,
        timezone: true, help: "The REAL TimezoneSelect rides TimePicker's slot; 'HH:MM±HH:MM' on the wire.",
    },
    {
        name: 'metadata.ks_meet', type: 'datetimepicker', label: 'Meeting (datetimepicker)', columns: 6,
        help: 'The real DateTimePicker through the registry. Epoch seconds on the wire.',
    },
    { name: 'metadata.ks_tz', type: 'timezone', label: 'Timezone (timezone)', columns: 6, help: 'IANA zone string on the wire.' },

    // Coexistence + the unknown-type rule
    { name: 'metadata.ks_note', type: 'text', label: 'Note (builtin text)', columns: 6, help: 'Builtins render inline, untouched by the registry.' },
    {
        name: 'metadata.ks_mystery', type: 'sparkle', label: 'Mystery (unknown type "sparkle")', columns: 6,
        help: 'Deliberate: warns once in the console, falls back to a text input.',
    },
];

const DEMO_USER_ID = 1;

const show = (v: unknown): string => (v === undefined ? '∅' : JSON.stringify(v));

/** Per-field control-vs-wire derivation, LIVE from the row (the useOne cache
 *  updates after every autosave batch, so this panel tracks each save). */
function WirePanel({ row }: { row: User }) {
    const lines = KITCHEN_FIELDS.map((f) => {
        const wire = getPath(row, f.name);
        const control = wireToField(f, (wire ?? null) as FieldValue);
        return `${f.name.padEnd(24)} ${String(f.type).padEnd(24)} control ${show(control).padEnd(28)} wire ${show(wire)}`;
    });
    return (
        <pre className="demo-pre" style={{ margin: 0, overflowX: 'auto' }}>
            {`${'field'.padEnd(24)} ${'type'.padEnd(24)} ${'control (picker holds)'.padEnd(36)} wire (save body carries)\n`}
            {lines.join('\n')}
        </pre>
    );
}

export function KitchenSinkDemo() {
    const { data: user, isPending } = UserModel.useOne(DEMO_USER_ID);
    const [surface, setSurface] = useState<'formview' | 'schemaform'>('formview');
    const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);
    const [submitted, setSubmitted] = useState<FormData | null>(null);

    const push = (ok: boolean, text: string) =>
        setLog((l) => [{ ok, text }, ...l].slice(0, 6));

    if (isPending || !user) {
        return <div className="panel panel-pad"><span className="skel skel-block" /></div>;
    }

    return (
        <div className="panel panel-pad">
            <p className="dim" style={{ marginBottom: 10 }}>
                Every registered field type, one schema, both surfaces. Registered:{' '}
                <code>{registeredFieldTypes().join(' · ')}</code>. The panel below shows each
                field's <b>control</b> value (what the picker holds) beside its <b>wire</b> value
                (what the save body carries) — the field-wire epoch boundary, live.
            </p>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button
                    className={`btn${surface === 'formview' ? ' btn-primary' : ''}`}
                    onClick={() => setSurface('formview')}
                >FormView (autosave)</button>
                <button
                    className={`btn${surface === 'schemaform' ? ' btn-primary' : ''}`}
                    onClick={() => setSurface('schemaform')}
                >SchemaForm (submit)</button>
            </div>

            {surface === 'formview' ? (
                <>
                    <div className="eyebrow">FormView — no save buttons; commits batch 300ms into one POST</div>
                    <FormView
                        model={UserModel}
                        row={user}
                        fields={KITCHEN_FIELDS}
                        onSaved={(info) => push(true, `POST ${JSON.stringify(info.changes)}`)}
                        onSaveError={(info) => push(false, `POST ${JSON.stringify(info.changes)} → ${info.error.message}`)}
                    />

                    <div className="eyebrow" style={{ marginTop: 18 }}>Live values — control vs wire (updates after each save)</div>
                    <WirePanel row={user} />

                    <div className="eyebrow" style={{ marginTop: 18 }}>Save log (newest first)</div>
                    {log.length === 0
                        ? <p className="dim" style={{ fontSize: 12.5 }}>No saves yet — edit a field above.</p>
                        : (
                            <pre className="demo-pre" style={{ margin: 0 }}>
                                {log.map((e) => `${e.ok ? '✓' : '✗'} ${e.text}`).join('\n')}
                            </pre>
                        )}
                </>
            ) : (
                <>
                    <div className="eyebrow">SchemaForm — same schema, submit-style; the payload is the wire body</div>
                    <SchemaForm
                        fields={KITCHEN_FIELDS}
                        submitText="Show wire body"
                        onSubmit={(data) => setSubmitted(data)}
                    />
                    <div className="eyebrow" style={{ marginTop: 18 }}>Submitted wire body</div>
                    {submitted == null
                        ? <p className="dim" style={{ fontSize: 12.5 }}>Nothing submitted yet. (Dotted names stay flat keys here — FormView's machine is what expands them to partial dicts.)</p>
                        : <pre className="demo-pre" style={{ margin: 0, overflowX: 'auto' }}>{JSON.stringify(submitted, null, 2)}</pre>}
                </>
            )}
        </div>
    );
}
