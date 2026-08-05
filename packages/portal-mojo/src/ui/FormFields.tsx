// Mini FormBuilder — the field-definition language ported as data → JSX.
// A form is an array of field objects, exactly like web-mojo's CREATE_FORM /
// EDIT_FORM statics. Controlled inputs mean the value pipeline is one code
// path (the buttongroup/checklistdropdown bug family is impossible here).
import { useState, type ReactNode } from 'react';
import { modal } from './modal';

export interface Field {
    name: string;
    type: 'text' | 'email' | 'tel' | 'select' | 'switch' | 'textarea';
    label: string;
    placeholder?: string;
    required?: boolean;
    help?: string;
    columns?: 6 | 12;
    options?: { value: string; label: string }[];
}

export type FormData = Record<string, string | boolean>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    const set = (name: string, value: string | boolean) => {
        setData((d) => ({ ...d, [name]: value }));
        setErrors((e) => { const { [name]: _drop, ...rest } = e; return rest; });
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const errs = validate(fields, data);
        setErrors(errs);
        if (Object.keys(errs).length) return;
        setBusy(true);
        setFormError('');
        try {
            await onSubmit(data);
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
                {fields.map((f) => (
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
                                    <select className="input" value={String(data[f.name] ?? '')} onChange={(e) => set(f.name, e.target.value)}>
                                        {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
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
