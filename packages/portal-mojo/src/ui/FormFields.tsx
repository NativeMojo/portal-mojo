// Mini FormBuilder — the field-definition language ported as data → JSX.
import { useState, type ReactNode } from 'react';
import type { Field, FormData } from '../client/types';
import { modal } from './modal';
import { SchemaFieldGrid, useSchemaFormState } from './schema-form-core';

export type { Field, FormData } from '../client/types';
export { SchemaSelect } from './schema-form-core';

export function SchemaForm({ fields, initial = {}, submitText = 'Save', onSubmit, onCancel }: {
    fields: Field[];
    initial?: FormData;
    submitText?: string;
    onSubmit: (data: FormData) => void | Promise<void>;
    onCancel?: () => void;
}) {
    const form = useSchemaFormState({ fields, initial, profile: 'schema-form' });
    const [busy, setBusy] = useState(false);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const errors = form.validate();
        if (Object.keys(errors).length) {
            const first = form.visibleFields.find((field) => errors[field.name]);
            if (first) form.focusField(first.name);
            return;
        }
        setBusy(true);
        form.setFormError('');
        try {
            await onSubmit(form.payload());
        } catch (error) {
            form.setFormError(error instanceof Error ? error.message : 'Save failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} noValidate>
            {form.formError && <div className="form-alert">{form.formError}</div>}
            <SchemaFieldGrid fields={fields} state={form} disabled={busy} />
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
