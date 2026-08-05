// Mini FormBuilder — the field-definition language ported as data → JSX.
// A form is an array of field objects, exactly like web-mojo's CREATE_FORM /
// EDIT_FORM statics. Controlled inputs mean the value pipeline is one code
// path (the buttongroup/checklistdropdown bug family is impossible here).
import { useState, type ReactNode } from 'react';
import { modal } from './modal';
// The field-language TYPES live in client/types so model definitions can
// carry form configs as data (defineModel forms); re-exported here so the
// ui-side API is unchanged.
import { resolveShowWhen } from './form-autosave';
import type { Field, FormData } from '../client/types';

export type { Field, FormData } from '../client/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One warn per (field, value) — a mismatch is a config bug, not a render event.
const warnedSelectValues = new Set<string>();

/**
 * Controlled select whose DISPLAY always equals its state. A bare native
 * select with value='' silently shows its first option while the controlled
 * state stays '' — the submit then fails "required" under a filled-looking
 * field (the buttongroup/checklistdropdown display≠state class). While the
 * value is unset (or unknown — warned, per the unknown-option rule) a
 * disabled placeholder option is rendered and selected instead.
 *
 * Exported since B3: FormView renders selects through this exact component —
 * ONE select implementation, one value pipeline.
 */
export function SchemaSelect({ field, value, invalid, onChange }: {
    field: Field;
    value: string;
    invalid: boolean;
    onChange: (v: string) => void;
}) {
    const options = field.options ?? [];
    const known = value === '' || options.some((o) => o.value === value);
    if (!known) {
        const key = `${field.name}:${value}`;
        if (!warnedSelectValues.has(key)) {
            warnedSelectValues.add(key);
            console.warn(`SchemaForm: select "${field.name}" value "${value}" is not among its options — showing placeholder`);
        }
    }
    const shown = known ? value : '';
    return (
        <select className={`input${invalid ? ' input-invalid' : ''}`} value={shown} onChange={(e) => onChange(e.target.value)}>
            {shown === '' && <option value="" disabled>{field.placeholder ?? 'Select…'}</option>}
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    );
}

function validate(fields: Field[], data: FormData): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const f of fields) {
        const v = data[f.name];
        if (f.required && (v == null || v === '')) errors[f.name] = `${f.label} is required`;
        else if (f.type === 'email' && typeof v === 'string' && v && !EMAIL_RE.test(v)) errors[f.name] = 'Enter a valid email address';
    }
    return errors;
}

export function SchemaForm({ fields, initial = {}, submitText = 'Save', onSubmit, onCancel }: {
    fields: Field[];
    initial?: FormData;
    submitText?: string;
    onSubmit: (data: FormData) => void | Promise<void>;
    onCancel?: () => void;
}) {
    const [data, setData] = useState<FormData>(() => {
        const d: FormData = {};
        for (const f of fields) d[f.name] = initial[f.name] ?? (f.type === 'switch' ? false : '');
        return d;
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState('');

    // showWhen (B3, same pipeline as FormView): hidden fields don't render,
    // don't validate, don't submit, and their errors clear. Fields without
    // showWhen behave exactly as before.
    const visibleFields = fields.filter((f) => resolveShowWhen(f.showWhen, data));

    const set = (name: string, value: string | boolean) => {
        const next = { ...data, [name]: value };
        setData(next);
        setErrors((e) => {
            const rest = { ...e };
            delete rest[name];
            // Fields this change just hid lose their stale errors too.
            for (const f of fields) {
                if (f.showWhen && !resolveShowWhen(f.showWhen, next)) delete rest[f.name];
            }
            return rest;
        });
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const errs = validate(visibleFields, data);
        setErrors(errs);
        if (Object.keys(errs).length) return;
        // Hidden-by-showWhen fields never ride the payload (FormView parity).
        const payload: FormData = {};
        for (const f of visibleFields) {
            if (f.name in data) payload[f.name] = data[f.name]!;
        }
        setBusy(true);
        setFormError('');
        try {
            await onSubmit(payload);
        } catch (err) {
            setFormError(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} noValidate>
            {formError && <div className="form-alert">{formError}</div>}
            <div className="form-grid">
                {visibleFields.map((f) => (
                    <div key={f.name} className={f.columns === 6 ? 'col-6' : 'col-12'}>
                        {f.type === 'switch' ? (
                            <label className="switch-row">
                                <span className="field-label">{f.label}</span>
                                <input
                                    type="checkbox"
                                    role="switch"
                                    className="switch"
                                    checked={data[f.name] === true}
                                    onChange={(e) => set(f.name, e.target.checked)}
                                />
                            </label>
                        ) : (
                            <label className="field">
                                <span className="field-label">{f.label}{f.required && <em> *</em>}</span>
                                {f.type === 'select' ? (
                                    <SchemaSelect field={f} value={String(data[f.name] ?? '')} invalid={!!errors[f.name]} onChange={(v) => set(f.name, v)} />
                                ) : f.type === 'textarea' ? (
                                    <textarea className="input" rows={3} placeholder={f.placeholder} value={String(data[f.name] ?? '')} onChange={(e) => set(f.name, e.target.value)} />
                                ) : (
                                    <input
                                        className={`input${errors[f.name] ? ' input-invalid' : ''}`}
                                        type={f.type}
                                        placeholder={f.placeholder}
                                        value={String(data[f.name] ?? '')}
                                        onChange={(e) => set(f.name, e.target.value)}
                                    />
                                )}
                                {errors[f.name] && <span className="field-error">{errors[f.name]}</span>}
                                {f.help && !errors[f.name] && <span className="field-help">{f.help}</span>}
                            </label>
                        )}
                    </div>
                ))}
            </div>
            <div className="modal-actions">
                {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
                <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? 'Saving…' : submitText}
                </button>
            </div>
        </form>
    );
}

/** Awaitable form dialog: resolves the submitted data, or null on cancel. */
export function formModal(opts: { title: string; fields: Field[]; initial?: FormData; submitText?: string; intro?: ReactNode }): Promise<FormData | null> {
    return modal.open<FormData>((close) => (
        <div className="modal-pad">
            <h2 className="modal-title">{opts.title}</h2>
            {opts.intro && <div className="modal-message">{opts.intro}</div>}
            <SchemaForm
                fields={opts.fields}
                initial={opts.initial}
                submitText={opts.submitText}
                onCancel={() => close(null as unknown as FormData)}
                onSubmit={(data) => close(data)}
            />
        </div>
    ));
}
