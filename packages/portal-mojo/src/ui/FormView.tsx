// FormView — the inline-autosave form surface ("no save buttons"), ported
// from web-mojo src/core/forms/FormView.js at behavior level:
//   · the SchemaForm field language bound to a server row via defineModel
//   · edits commit → 300ms batch → ONE save carrying only changed fields
//   · per-field indicators: pending/saving spinner → saved flash → idle;
//     errors pin with the server (or zod) message; failed batches revert
//   · showWhen conditional fields (declarative rule or predicate)
//   · permission tabsets via a REGISTRY (registerFormTabs) resolved
//     fail-closed against me + the active-group member — replacing web-mojo's
//     live-mutated permission arrays (User.js:160-347 / Member.js:80-170
//     rebuildPermissions), per the do-not-recreate list.
//
// The machine itself lives in form-autosave.ts; this file renders it.
import { useMemo, useState, useSyncExternalStore, useContext } from 'react';
import type { ReactNode } from 'react';
import { hasPermission, useMe } from '../client/me';
import { GroupContext } from '../client/group-context';
import type { PermSpec, ModelDef, SaveVars } from '../client/model';
import type { Field } from '../client/types';
import { SchemaSelect } from './FormFields';
import { emptyFieldValue, resolveFieldRenderer } from './field-registry';
import { toast } from './toast';
import {
    useFormAutosave,
    type AutosaveBatchInfo,
    type FieldStatus,
    type FormAutosaveApi,
} from './form-autosave';

// ── Tabset registry ───────────────────────────────────────────────────
// web-mojo extended permission tabsets by MUTATING cached arrays in place
// (`arr.length = 0; arr.push(…)` + rebuildPermissions). Here tabs live in a
// registry: register under a name once (or again — same-key tabs replace,
// new keys append, mirroring registerPermissions' additive semantics), and
// every FormView resolving that name re-renders via the subscription.

export interface FormTab {
    key: string;
    label: string;
    /** useCan-style gate (any-of array). Fail-closed like <Guarded>. */
    permissions?: PermSpec;
    fields: Field[];
}

const tabRegistry = new Map<string, FormTab[]>();
let tabsVersion = 0;
const tabListeners = new Set<() => void>();

function bumpTabs(): void {
    tabsVersion += 1;
    for (const cb of tabListeners) cb();
}

/**
 * Register (or extend) a named tabset. Tabs with a key already present
 * REPLACE that tab (idempotent under HMR / re-registration); new keys append
 * in call order — an app adds its own tab beside the framework's.
 */
export function registerFormTabs(name: string, tabs: FormTab[]): void {
    const current = [...(tabRegistry.get(name) ?? [])];
    for (const tab of tabs) {
        const at = current.findIndex((t) => t.key === tab.key);
        if (at >= 0) current[at] = tab;
        else current.push(tab);
    }
    tabRegistry.set(name, current);
    bumpTabs();
}

/** Snapshot copy — callers can never mutate the registry through it. */
export function getFormTabs(name: string): FormTab[] {
    return [...(tabRegistry.get(name) ?? [])];
}

export function subscribeFormTabs(cb: () => void): () => void {
    tabListeners.add(cb);
    return () => tabListeners.delete(cb);
}

export function formTabsVersion(): number {
    return tabsVersion;
}

// One warn per unknown (name:type) — a config bug, not a render event.
const warnedFieldTypes = new Set<string>();

// ── FormView ──────────────────────────────────────────────────────────

export interface FormViewProps<T extends { id: number | string }> {
    /** The defineModel definition — its useSave carries the batch POST. */
    model: Pick<ModelDef<T>, 'useSave'>;
    /** The current server row this form edits. */
    row: T;
    /** Flat fields rendered above the tabset. */
    fields?: Field[];
    /** Permission tabset: a registry name (live) or inline tab defs. */
    tabs?: string | FormTab[];
    /** Batch window after the last commit. Default 300 (web-mojo parity). */
    debounceMs?: number;
    /** 'saved' flash duration. Default 1500. */
    savedFlashMs?: number;
    onSaved?: (info: AutosaveBatchInfo & { row: T }) => void;
    onSaveError?: (info: AutosaveBatchInfo & { error: Error }) => void;
    className?: string;
}

export function FormView<T extends { id: number | string }>(props: FormViewProps<T>) {
    const { model, row, fields, tabs, debounceMs, savedFlashMs, onSaved, onSaveError, className } = props;
    const save = model.useSave();

    // Registry-named tabsets re-render on registration; inline defs pass through.
    const version = useSyncExternalStore(subscribeFormTabs, formTabsVersion, formTabsVersion);
    const allTabs = useMemo<FormTab[]>(
        () => (typeof tabs === 'string' ? getFormTabs(tabs) : tabs ?? []),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalidates registry reads
        [tabs, version],
    );

    // Tab permissions resolve fail-closed (Guarded semantics): hidden while
    // `me` loads, while anonymous, and when the check fails. The member fold
    // matches useCan — group `admin` never grants sys.*.
    const { data: me } = useMe();
    const member = useContext(GroupContext)?.member ?? null;
    const visibleTabs = useMemo(
        () => allTabs.filter((t) => !t.permissions || hasPermission(me ?? null, t.permissions, member)),
        [allTabs, me, member],
    );

    // The machine spans EVERY field — flat + all tabs (visible or not), so a
    // batch can carry fields from anywhere and tab switches lose nothing.
    const allFields = useMemo(
        () => [...(fields ?? []), ...allTabs.flatMap((t) => t.fields)],
        [fields, allTabs],
    );

    const form = useFormAutosave<T>({
        fields: allFields,
        row,
        save: (changes) => save.mutateAsync({ id: row.id, changes } satisfies SaveVars),
        debounceMs,
        savedFlashMs,
        onSaved,
        onSaveError: (info) => {
            // Unmissable failure (workspec): pinned field error + toast.
            toast.error(info.error.message);
            onSaveError?.(info);
        },
    });

    // Active tab: self-heals to the first visible tab when the current one
    // disappears (permission change, registry update) — fail-closed, never
    // a blank pane.
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const activeTab = visibleTabs.find((t) => t.key === activeKey) ?? visibleTabs[0] ?? null;

    return (
        <div className={className ? `form-view ${className}` : 'form-view'}>
            {fields && fields.length > 0 && (
                <div className="form-grid">
                    {fields.filter(form.visible).map((f) => <FieldRow key={f.name} field={f} form={form} />)}
                </div>
            )}

            {visibleTabs.length > 0 && (
                <>
                    <div className="fv-tabs" role="tablist">
                        {visibleTabs.map((t) => {
                            const hasError = t.fields.some((f) => form.status[f.name]?.status === 'error');
                            const active = activeTab?.key === t.key;
                            return (
                                <button
                                    key={t.key}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    className={`fv-tab${active ? ' fv-tab-active' : ''}`}
                                    onClick={() => setActiveKey(t.key)}
                                >
                                    {t.label}
                                    {hasError && <span className="fv-tab-err" aria-label="Tab has an error" />}
                                </button>
                            );
                        })}
                    </div>
                    {activeTab && (
                        <div className="form-grid" role="tabpanel">
                            {activeTab.fields.filter(form.visible).map((f) => (
                                <FieldRow key={f.name} field={f} form={form} />
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// ── Field row ─────────────────────────────────────────────────────────

/** The label-inline status slot (FieldStatusManager's label-inline strategy). */
function StatusIcon({ st }: { st: FieldStatus | undefined }) {
    switch (st?.status) {
        case 'dirty':
            return <span className="fv-status"><span className="fv-dot" title="Unsaved edit" /></span>;
        case 'pending':
        case 'saving':
            return <span className="fv-status"><span className="fv-spinner" role="status" aria-label="Saving" /></span>;
        case 'saved':
            return <span className="fv-status"><i className="bi bi-check-circle-fill fv-saved" aria-label="Saved" /></span>;
        case 'error':
            return <span className="fv-status"><i className="bi bi-exclamation-circle-fill fv-error-ico" title={st.error} /></span>;
        default:
            return <span className="fv-status" />;
    }
}

function FieldRow({ field, form }: { field: Field; form: FormAutosaveApi }) {
    const st = form.status[field.name];
    const error = st?.status === 'error' ? st.error : undefined;
    const value = form.values[field.name];

    const labelSlot: ReactNode = (
        <span className="field-label fv-label">
            <span>{field.label}{field.required && <em> *</em>}</span>
            <StatusIcon st={st} />
        </span>
    );
    const footSlot: ReactNode = (
        <>
            {error && <span className="field-error">{error}</span>}
            {field.help && !error && <span className="field-help">{field.help}</span>}
        </>
    );

    if (field.type === 'switch') {
        return (
            <div className={field.columns === 6 ? 'col-6' : 'col-12'}>
                <label className="switch-row fv-switch-row">
                    {labelSlot}
                    <input
                        type="checkbox"
                        role="switch"
                        className="switch"
                        checked={value === true}
                        onChange={(e) => form.commit(field.name, e.target.checked)}
                    />
                </label>
                {footSlot}
            </div>
        );
    }

    // Non-builtin types resolve through the field-type registry (B4 #1278).
    // Every registry control fires on COMMIT, so its one change gesture maps
    // straight onto form.commit — same batch/indicator lifecycle as builtins.
    // A <div>, not a <label>: these are composite widgets (triggers,
    // popovers, chip lists) and label-click forwarding would fight them.
    if (!['text', 'email', 'tel', 'select', 'textarea'].includes(field.type)) {
        const Registered = resolveFieldRenderer(field.type);
        if (Registered) {
            return (
                <div className={field.columns === 6 ? 'col-6' : 'col-12'}>
                    <div className="field">
                        {labelSlot}
                        <Registered
                            field={field}
                            value={value ?? emptyFieldValue(field)}
                            invalid={!!error}
                            commit={(v) => form.commit(field.name, v)}
                        />
                        {footSlot}
                    </div>
                </div>
            );
        }
    }

    let control: ReactNode;
    const text = String(value ?? '');
    if (field.type === 'select') {
        // Selects commit on change (a change IS the commit gesture).
        control = (
            <SchemaSelect
                field={field}
                value={text}
                invalid={!!error}
                onChange={(v) => form.commit(field.name, v)}
            />
        );
    } else if (field.type === 'textarea') {
        // Textareas commit on blur only — Enter inserts a newline.
        control = (
            <textarea
                className={`input${error ? ' input-invalid' : ''}`}
                rows={3}
                placeholder={field.placeholder}
                value={text}
                onChange={(e) => form.setValue(field.name, e.target.value)}
                onBlur={() => form.commit(field.name)}
            />
        );
    } else {
        // text | email | tel — and the unknown-type fallback (warn + text,
        // never "render nothing").
        if (!['text', 'email', 'tel'].includes(field.type)) {
            const key = `${field.name}:${field.type}`;
            if (!warnedFieldTypes.has(key)) {
                warnedFieldTypes.add(key);
                console.warn(`FormView: unknown field type "${field.type}" on "${field.name}" — rendering a text input`);
            }
        }
        control = (
            <input
                className={`input${error ? ' input-invalid' : ''}`}
                type={['text', 'email', 'tel'].includes(field.type) ? field.type : 'text'}
                placeholder={field.placeholder}
                value={text}
                onChange={(e) => form.setValue(field.name, e.target.value)}
                onBlur={() => form.commit(field.name)}
                onKeyDown={(e) => {
                    // Enter commits (change-on-commit contract) without leaving
                    // the field.
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        form.commit(field.name);
                    }
                }}
            />
        );
    }

    return (
        <div className={field.columns === 6 ? 'col-6' : 'col-12'}>
            <label className="field">
                {labelSlot}
                {control}
                {footSlot}
            </label>
        </div>
    );
}
