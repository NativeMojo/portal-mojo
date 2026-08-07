import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Field, FieldValue, FormData } from '../client/types';
import { declaredFieldPatch, resolveShowWhen, validateFieldValue } from './form-autosave';
import { emptyFieldValue, resolveFieldRenderer, warnUnknownFieldType } from './field-registry';

export type ValidationProfile = 'schema-form' | 'wizard';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BUILTIN_TYPES = new Set(['text', 'email', 'tel', 'select', 'switch', 'textarea']);
const warnedSelectValues = new Set<string>();

export function isEmptyFieldValue(value: FieldValue | undefined): boolean {
    return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

export function seedFormValues(fields: Field[], initial: FormData = {}): FormData {
    const values: FormData = {};
    for (const field of fields) values[field.name] = initial[field.name] ?? emptyFieldValue(field);
    return values;
}

export function visibleSchemaFields(fields: Field[], values: FormData): Field[] {
    return fields.filter((field) => resolveShowWhen(field.showWhen, values));
}

export function schemaPayload(fields: Field[], values: FormData): FormData {
    const payload: FormData = {};
    for (const field of visibleSchemaFields(fields, values)) {
        if (field.name in values) payload[field.name] = values[field.name]!;
    }
    return payload;
}

export function reconcileFormValues(previous: FormData, fields: Field[], initial: FormData = {}): FormData {
    const next: FormData = {};
    for (const field of fields) next[field.name] = field.name in previous
        ? previous[field.name]!
        : initial[field.name] ?? emptyFieldValue(field);
    return next;
}

export function validateSchemaFields(fields: Field[], values: FormData, profile: ValidationProfile): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const field of visibleSchemaFields(fields, values)) {
        const value = values[field.name];
        if (field.required && isEmptyFieldValue(value)) {
            errors[field.name] = `${field.label} is required`;
            continue;
        }
        if (field.type === 'email' && typeof value === 'string' && value && !EMAIL_RE.test(value)) {
            errors[field.name] = 'Enter a valid email address';
            continue;
        }
        if (profile === 'wizard') {
            const issue = validateFieldValue(field, value ?? emptyFieldValue(field));
            if (issue) errors[field.name] = issue;
        }
    }
    return errors;
}

export interface SchemaFormState {
    values: FormData;
    errors: Record<string, string>;
    formError: string;
    visibleFields: Field[];
    setValue: (name: string, value: FieldValue) => void;
    patchValues: (patch: FormData) => void;
    setErrors: (errors: Record<string, string>) => void;
    setFormError: (message: string) => void;
    validate: (fields?: Field[]) => Record<string, string>;
    payload: (fields?: Field[]) => FormData;
    registerFocusTarget: (name: string) => (node: HTMLElement | null) => void;
    focusField: (name: string) => void;
}

export function useSchemaFormState({ fields, initial = {}, profile, reconcile = false, resetKey, deferReconcile = false }: {
    fields: Field[];
    initial?: FormData;
    profile: ValidationProfile;
    reconcile?: boolean;
    resetKey?: unknown;
    deferReconcile?: boolean;
}): SchemaFormState {
    const [values, setValues] = useState<FormData>(() => seedFormValues(fields, initial));
    const [errors, setErrorsState] = useState<Record<string, string>>({});
    const [formError, setFormError] = useState('');
    const initialRef = useRef(initial);
    const resetRef = useRef(resetKey);
    const mountedRef = useRef(false);
    const focusTargets = useRef(new Map<string, HTMLElement>());
    initialRef.current = initial;

    useEffect(() => {
        if (!mountedRef.current) {
            mountedRef.current = true;
            return;
        }
        if (deferReconcile) return;
        const resetChanged = !Object.is(resetRef.current, resetKey);
        resetRef.current = resetKey;
        if (resetChanged) {
            setValues(seedFormValues(fields, initialRef.current));
            setErrorsState({});
            setFormError('');
        } else if (reconcile) {
            setValues((current) => reconcileFormValues(current, fields, initialRef.current));
            setErrorsState((current) => {
                const names = new Set(fields.map((field) => field.name));
                return Object.fromEntries(Object.entries(current).filter(([name]) => names.has(name)));
            });
        }
    }, [fields, reconcile, resetKey, deferReconcile]);

    const setValue = useCallback((name: string, value: FieldValue) => {
        setValues((current) => {
            const next = { ...current, [name]: value };
            setErrorsState((currentErrors) => {
                const nextErrors = { ...currentErrors };
                delete nextErrors[name];
                for (const field of fields) {
                    if (!resolveShowWhen(field.showWhen, next)) delete nextErrors[field.name];
                }
                return nextErrors;
            });
            return next;
        });
    }, [fields]);

    const patchValues = useCallback((patch: FormData) => {
        const safe = declaredFieldPatch(fields, patch);
        if (Object.keys(safe).length === 0) return;
        setValues((current) => {
            const next = { ...current, ...safe };
            setErrorsState((currentErrors) => {
                const nextErrors = { ...currentErrors };
                for (const name of Object.keys(safe)) delete nextErrors[name];
                for (const field of fields) {
                    if (!resolveShowWhen(field.showWhen, next)) delete nextErrors[field.name];
                }
                return nextErrors;
            });
            return next;
        });
    }, [fields]);

    const validate = useCallback((subset = fields) => {
        const next = validateSchemaFields(subset, values, profile);
        setErrorsState((current) => {
            const subsetNames = new Set(subset.map((field) => field.name));
            const kept = Object.fromEntries(Object.entries(current).filter(([name]) => !subsetNames.has(name)));
            return { ...kept, ...next };
        });
        return next;
    }, [fields, profile, values]);

    const registerFocusTarget = useCallback((name: string) => (node: HTMLElement | null) => {
        if (node) focusTargets.current.set(name, node);
        else focusTargets.current.delete(name);
    }, []);

    const focusField = useCallback((name: string) => {
        window.setTimeout(() => focusTargets.current.get(name)?.focus(), 0);
    }, []);

    return {
        values,
        errors,
        formError,
        visibleFields: visibleSchemaFields(fields, values),
        setValue,
        patchValues,
        setErrors: setErrorsState,
        setFormError,
        validate,
        payload: (subset = fields) => schemaPayload(subset, values),
        registerFocusTarget,
        focusField,
    };
}

export function SchemaSelect({ field, value, invalid, disabled, id, describedBy, focusTarget, onChange }: {
    field: Field;
    value: string;
    invalid: boolean;
    disabled?: boolean;
    id?: string;
    describedBy?: string;
    focusTarget?: (node: HTMLSelectElement | null) => void;
    onChange: (value: string) => void;
}) {
    const options = field.options ?? [];
    const known = value === '' || options.some((option) => String(option.value) === value);
    if (!known) {
        const key = `${field.name}:${value}`;
        if (!warnedSelectValues.has(key)) {
            warnedSelectValues.add(key);
            console.warn(`SchemaForm: select "${field.name}" value "${value}" is not among its options — showing placeholder`);
        }
    }
    const shown = known ? value : '';
    return (
        <select ref={focusTarget} id={id} aria-invalid={invalid || undefined} aria-describedby={describedBy} disabled={disabled || field.disabled} className={`input${invalid ? ' input-invalid' : ''}`} value={shown} onChange={(event) => onChange(event.target.value)}>
            {shown === '' && <option value="" disabled>{field.placeholder ?? 'Select…'}</option>}
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
    );
}

function SchemaField({ field, state, disabled = false }: { field: Field; state: SchemaFormState; disabled?: boolean }) {
    const uid = useId().replace(/:/g, '');
    const controlId = `schema-${uid}`;
    const labelId = `${controlId}-label`;
    const errorId = `${controlId}-error`;
    const helpId = `${controlId}-help`;
    const error = state.errors[field.name];
    const describedBy = error ? errorId : field.help ? helpId : undefined;
    const value = state.values[field.name] ?? emptyFieldValue(field);
    const set = (next: FieldValue) => state.setValue(field.name, next);
    const Registered = BUILTIN_TYPES.has(field.type) ? null : resolveFieldRenderer(field.type);

    if (field.type === 'switch') {
        return (
            <>
                <label className="switch-row" htmlFor={controlId}>
                    <input ref={state.registerFocusTarget(field.name)} id={controlId} aria-invalid={!!error || undefined} aria-describedby={describedBy} type="checkbox" role="switch" className="switch" checked={value === true} disabled={disabled || field.disabled} onChange={(event) => set(event.target.checked)} />
                    <span className="field-label">{field.label}</span>
                </label>
                {error && <span id={errorId} className="field-error">{error}</span>}
                {field.help && !error && <span id={helpId} className="field-help">{field.help}</span>}
            </>
        );
    }

    if (Registered) {
        return (
            <div className="field">
                <span id={labelId} className="field-label">{field.label}{field.required && <em> *</em>}</span>
                <div ref={state.registerFocusTarget(field.name)} tabIndex={-1} aria-labelledby={labelId} aria-describedby={describedBy} aria-invalid={!!error || undefined}>
                    <Registered field={field} value={value} invalid={!!error} disabled={disabled} controlId={controlId} ariaDescribedBy={describedBy} focusTarget={state.registerFocusTarget(field.name)} commit={set} commitPatch={state.patchValues} />
                </div>
                {error && <span id={errorId} className="field-error">{error}</span>}
                {field.help && !error && <span id={helpId} className="field-help">{field.help}</span>}
            </div>
        );
    }

    if (!BUILTIN_TYPES.has(field.type)) warnUnknownFieldType('SchemaForm', field);
    return (
        <label className="field" htmlFor={controlId}>
            <span className="field-label">{field.label}{field.required && <em> *</em>}</span>
            {field.type === 'select' ? (
                <SchemaSelect field={field} value={String(value ?? '')} invalid={!!error} disabled={disabled} id={controlId} describedBy={describedBy} focusTarget={state.registerFocusTarget(field.name)} onChange={set} />
            ) : field.type === 'textarea' ? (
                <textarea ref={state.registerFocusTarget(field.name)} id={controlId} aria-invalid={!!error || undefined} aria-describedby={describedBy} disabled={disabled || field.disabled} className={`input${error ? ' input-invalid' : ''}`} rows={3} placeholder={field.placeholder} value={String(value ?? '')} onChange={(event) => set(event.target.value)} />
            ) : (
                <input ref={state.registerFocusTarget(field.name)} id={controlId} aria-invalid={!!error || undefined} aria-describedby={describedBy} disabled={disabled || field.disabled} className={`input${error ? ' input-invalid' : ''}`} type={BUILTIN_TYPES.has(field.type) ? field.type : 'text'} placeholder={field.placeholder} value={String(value ?? '')} onChange={(event) => set(event.target.value)} />
            )}
            {error && <span id={errorId} className="field-error">{error}</span>}
            {field.help && !error && <span id={helpId} className="field-help">{field.help}</span>}
        </label>
    );
}

export function SchemaFieldGrid({ fields, state, disabled = false }: { fields: Field[]; state: SchemaFormState; disabled?: boolean }) {
    return (
        <div className="form-grid">
            {fields.filter((field) => resolveShowWhen(field.showWhen, state.values)).map((field) => (
                <div key={field.name} className={field.columns === 6 ? 'col-6' : 'col-12'}>
                    <SchemaField field={field} state={state} disabled={disabled} />
                </div>
            ))}
        </div>
    );
}

export function firstErrorName(fields: Field[], errors: Record<string, string>): string | null {
    return fields.find((field) => errors[field.name])?.name ?? null;
}

export type SubmitEvent = FormEvent<HTMLFormElement>;
