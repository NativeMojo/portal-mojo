// Mini FormBuilder — the field-definition language ported as data → JSX.
import { useEffect, useState, type ReactNode } from 'react';
import type { Field, FormData } from '../client/types';
import { modal } from './modal';
import { SchemaFieldGrid, useSchemaFormState } from './schema-form-core';

export type { Field, FormData } from '../client/types';
export { SchemaSelect } from './schema-form-core';

export function SchemaForm({ fields, initial = {}, submitText = 'Save', onSubmit, onCancel, onBusyChange }: {
    fields: Field[];
    initial?: FormData;
    submitText?: string;
    /** Return the authoritative saved owner row when the form contains File relations. */
    onSubmit: (data: FormData) => unknown | Promise<unknown>;
    onCancel?: () => void;
    onBusyChange?: (busy: boolean) => void;
}) {
    const form = useSchemaFormState({ fields, initial, profile: 'schema-form' });
    const [busy, setBusy] = useState(false);
    useEffect(() => onBusyChange?.(busy || form.uploadPending), [busy, form.uploadPending, onBusyChange]);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const errors = form.validate();
        if (Object.keys(errors).length) {
            const first = form.visibleFields.find((field) => errors[field.name]);
            if (first) form.focusField(first.name);
            return;
        }
        if (form.uploadPending) return;
        setBusy(true);
        form.setFormError('');
        const requested = form.payload();
        try {
            const row = await onSubmit(form.payload());
            form.settleOwnerSave(row, false, requested);
        } catch (error) {
            form.settleOwnerSave(undefined, true, requested);
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
                {onCancel && <button type="button" className="btn" disabled={busy || form.uploadPending} onClick={onCancel}>Cancel</button>}
                <button type="submit" className="btn btn-primary" disabled={busy || form.uploadPending}>
                    {busy ? 'Saving…' : submitText}
                </button>
            </div>
        </form>
    );
}

/** Awaitable form dialog: resolves the submitted data, or null on cancel. */
export function formModal(opts: { title: string; fields: Field[]; initial?: FormData; submitText?: string; intro?: ReactNode }): Promise<FormData | null> {
    let pending = false;
    return modal.open<FormData>((close) => (
        <div className="modal-pad">
            <h2 className="modal-title">{opts.title}</h2>
            {opts.intro && <div className="modal-message">{opts.intro}</div>}
            <SchemaForm
                fields={opts.fields}
                initial={opts.initial}
                submitText={opts.submitText}
                onBusyChange={(busy) => { pending = busy; }}
                onCancel={() => close(null as unknown as FormData)}
                onSubmit={(data) => close(data)}
            />
        </div>
    ), { canDismiss: () => !pending });
}
