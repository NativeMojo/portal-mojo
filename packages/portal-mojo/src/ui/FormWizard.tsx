import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Field, FormData } from '../client/types';
import { modal, type ModalSize } from './modal';
import { firstErrorName, SchemaFieldGrid, useSchemaFormState } from './schema-form-core';
import { Tabs, type TabVariant } from './Tabs';

export interface FormWizardSection {
    key: string;
    label: ReactNode;
    fields: Field[];
    description?: ReactNode;
    optional?: boolean;
    /** Custom content shares the same draft as schema fields. */
    content?: ReactNode | ((context: FormWizardSectionContext) => ReactNode);
    /** Removes a step without discarding its draft. */
    eligible?: (data: FormData) => boolean;
    /** Runs after validation and before advancing. Rejections stay on this step. */
    onNext?: (data: FormData) => void | Promise<void>;
    /** A receipt/status step with no Back/Next/Finish action row. */
    terminal?: boolean;
}

export interface FormWizardSectionContext {
    data: FormData;
    busy: boolean;
    setValue: (name: string, value: FormData[string]) => void;
    patchValues: (patch: FormData) => void;
}

export interface FormWizardProps {
    sections: FormWizardSection[];
    initial?: FormData;
    resetKey?: unknown;
    mode: 'wizard' | 'tabs';
    tabVariant?: TabVariant | 'buttongroup' | 'btngroup' | (string & {});
    backText?: string;
    nextText?: string;
    finishText?: string;
    saveText?: string;
    cancelText?: string;
    busyText?: string;
    validateAllOnFinish?: boolean;
    onStepChange?: (sectionKey: string) => void;
    onBusyChange?: (busy: boolean) => void;
    onCancel?: () => void;
    onFinish: (data: FormData) => void | Promise<void>;
    className?: string;
}

const warnedWizard = new Set<string>();
function warnWizardOnce(key: string, message: string): void {
    if (warnedWizard.has(key)) return;
    warnedWizard.add(key);
    console.warn(message);
}

export function normalizeWizardMode(mode: string): 'wizard' | 'tabs' {
    if (mode === 'wizard' || mode === 'tabs') return mode;
    warnWizardOnce(`mode:${mode}`, `FormWizard: unknown mode "${mode}" — falling back to "tabs"`);
    return 'tabs';
}

export function normalizeWizardSections(sections: FormWizardSection[]): FormWizardSection[] {
    const sectionKeys = new Set<string>();
    const fieldNames = new Set<string>();
    const result: FormWizardSection[] = [];
    for (const section of sections) {
        if (!section.key || sectionKeys.has(section.key)) {
            warnWizardOnce(`section:${section.key || '<empty>'}`, `FormWizard: ${section.key ? `duplicate section key "${section.key}"` : 'empty section key'} ignored`);
            continue;
        }
        sectionKeys.add(section.key);
        const fields = section.fields.filter((field) => {
            if (!field.name || fieldNames.has(field.name)) {
                warnWizardOnce(`field:${field.name || '<empty>'}`, `FormWizard: ${field.name ? `duplicate field name "${field.name}"` : 'empty field name'} ignored`);
                return false;
            }
            fieldNames.add(field.name);
            return true;
        });
        result.push({ ...section, fields });
    }
    return result;
}

export function healWizardSection(activeKey: string | null, sections: FormWizardSection[]): string | null {
    return sections.some((section) => section.key === activeKey) ? activeKey : sections[0]?.key ?? null;
}

export function createWizardSingleFlight() {
    let pending = false;
    return {
        get pending() { return pending; },
        async run<T>(task: () => T | Promise<T>): Promise<T | undefined> {
            if (pending) return undefined;
            pending = true;
            try {
                return await task();
            } finally {
                pending = false;
            }
        },
    };
}

export function FormWizard(props: FormWizardProps) {
    const {
        sections: rawSections,
        initial = {},
        resetKey,
        tabVariant,
        onStepChange,
        onCancel,
        onFinish,
        className,
    } = props;
    const normalizedSections = useMemo(() => normalizeWizardSections(rawSections), [rawSections]);
    const fields = useMemo(() => normalizedSections.flatMap((section) => section.fields), [normalizedSections]);
    const mode = normalizeWizardMode(props.mode as string);
    const [activeKey, setActiveKey] = useState<string | null>(() => normalizedSections[0]?.key ?? null);
    const activeKeyRef = useRef(activeKey);
    activeKeyRef.current = activeKey;
    const [busy, setBusy] = useState(false);
    const setWizardBusy = (next: boolean) => {
        props.onBusyChange?.(next);
        setBusy(next);
    };
    const finishFlight = useRef(createWizardSingleFlight());
    const transitionFlight = useRef(createWizardSingleFlight());
    const generation = useRef(0);
    const mounted = useRef(true);
    const resetRef = useRef(resetKey);
    const form = useSchemaFormState({ fields, initial, profile: 'wizard', reconcile: true, resetKey, deferReconcile: busy });
    const sections = normalizedSections.filter((section) => section.eligible?.(form.values) !== false);

    useEffect(() => {
        generation.current += 1;
        transitionFlight.current = createWizardSingleFlight();
        if (busy) setWizardBusy(false);
        // resetKey is the generation boundary; busy changes must not create one.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetKey]);

    useEffect(() => () => {
        mounted.current = false;
        generation.current += 1;
    }, []);

    useEffect(() => {
        if (busy) return;
        const resetChanged = !Object.is(resetRef.current, resetKey);
        const healed = resetChanged ? sections[0]?.key ?? null : healWizardSection(activeKey, sections);
        resetRef.current = resetKey;
        if (healed !== activeKeyRef.current) {
            activeKeyRef.current = healed;
            setActiveKey(healed);
            if (!resetChanged && healed) onStepChange?.(healed);
        }
    }, [activeKey, busy, onStepChange, resetKey, sections]);

    const activeIndex = Math.max(0, sections.findIndex((section) => section.key === activeKey));
    const activeSection = sections[activeIndex] ?? null;

    const go = (key: string) => {
        if (busy || key === activeKeyRef.current || !sections.some((section) => section.key === key)) return;
        activeKeyRef.current = key;
        setActiveKey(key);
        onStepChange?.(key);
    };

    const validateAndFocus = (targetFields: Field[], sectionPool: FormWizardSection[]): boolean => {
        const errors = form.validate(targetFields);
        const firstName = firstErrorName(targetFields, errors);
        if (!firstName) return true;
        const targetSection = sectionPool.find((section) => section.fields.some((field) => field.name === firstName));
        if (targetSection && targetSection.key !== activeKey) setActiveKey(targetSection.key);
        form.focusField(firstName);
        return false;
    };

    const next = async () => {
        if (transitionFlight.current.pending) return;
        if (!activeSection || !validateAndFocus(activeSection.fields, [activeSection])) return;
        const following = sections[activeIndex + 1];
        if (!following) return;
        const acceptedGeneration = generation.current;
        if (!activeSection.onNext) {
            go(following.key);
            return;
        }
        setWizardBusy(true);
        form.setFormError('');
        try {
            await transitionFlight.current.run(() => activeSection.onNext!(form.payload(fields)));
            if (mounted.current && generation.current === acceptedGeneration) go(following.key);
        } catch (error) {
            if (mounted.current && generation.current === acceptedGeneration) {
                form.setFormError(error instanceof Error ? error.message : 'Could not continue');
            }
        } finally {
            if (mounted.current && generation.current === acceptedGeneration) setWizardBusy(false);
        }
    };

    const finish = async () => {
        if (finishFlight.current.pending || !activeSection) return;
        const validationSections = props.validateAllOnFinish === false ? [activeSection] : sections;
        const validationFields = validationSections.flatMap((section) => section.fields);
        if (!validateAndFocus(validationFields, validationSections)) return;

        // Capture the accepted roster and payload before any parent update.
        const acceptedFields = [...fields];
        const payload = form.payload(acceptedFields);
        const acceptedGeneration = generation.current;
        setWizardBusy(true);
        form.setFormError('');
        try {
            await finishFlight.current.run(() => onFinish(payload));
        } catch (error) {
            if (mounted.current && generation.current === acceptedGeneration) form.setFormError(error instanceof Error ? error.message : 'Save failed');
        } finally {
            if (mounted.current && generation.current === acceptedGeneration) setWizardBusy(false);
        }
    };

    if (!sections.length) {
        return <div className={className ? `form-wizard ${className}` : 'form-wizard'}><div className="form-wizard-empty">No sections available.</div></div>;
    }

    const sectionPanel = (section: FormWizardSection) => (
        <div className="form-wizard-section">
            {section.description && <div className="form-wizard-description">{section.description}</div>}
            <SchemaFieldGrid fields={section.fields} state={form} disabled={busy} />
            {typeof section.content === 'function' ? section.content({
                data: form.values, busy, setValue: form.setValue, patchValues: form.patchValues,
            }) : section.content}
        </div>
    );

    return (
        <div className={className ? `form-wizard ${className}` : 'form-wizard'} aria-busy={busy || undefined}>
            {form.formError && <div className="form-alert" role="alert">{form.formError}</div>}
            {mode === 'tabs' ? (
                <Tabs
                    variant={tabVariant}
                    ariaLabel="Form sections"
                    activeKey={activeKey}
                    onActiveKeyChange={go}
                    items={sections.map((section) => ({
                        key: section.key,
                        label: <>{section.label}{section.optional && <span className="form-wizard-optional"> Optional</span>}</>,
                        disabled: busy,
                        panel: sectionPanel(section),
                    }))}
                />
            ) : (
                <>
                    <ol className="form-wizard-progress" aria-label="Form progress">
                        {sections.map((section, index) => (
                            <li key={section.key} className={index === activeIndex ? 'is-active' : index < activeIndex ? 'is-complete' : ''} aria-current={index === activeIndex ? 'step' : undefined}>
                                <span className="form-wizard-step-number">{index + 1}</span>
                                <span>{section.label}</span>
                            </li>
                        ))}
                    </ol>
                    {activeSection && sectionPanel(activeSection)}
                </>
            )}
            {!activeSection?.terminal && <div className="modal-actions form-wizard-actions">
                {onCancel && <button type="button" className="btn" disabled={busy} onClick={onCancel}>{props.cancelText ?? 'Cancel'}</button>}
                {mode === 'wizard' && activeIndex > 0 && (
                    <button type="button" className="btn" disabled={busy} onClick={() => go(sections[activeIndex - 1]!.key)}>{props.backText ?? 'Back'}</button>
                )}
                {mode === 'wizard' && activeIndex < sections.length - 1 ? (
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void next()}>{props.nextText ?? 'Next'}</button>
                ) : (
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={finish}>
                        {busy ? props.busyText ?? 'Saving…' : mode === 'tabs' ? props.saveText ?? 'Save' : props.finishText ?? 'Finish'}
                    </button>
                )}
            </div>}
        </div>
    );
}

export type FormWizardModalOptions = Omit<FormWizardProps, 'onCancel'> & { title: string; size?: ModalSize };

export function formWizardModal(options: FormWizardModalOptions): Promise<FormData | null> {
    let pending = false;
    let finishing = false;
    let live = true;
    return modal.open<FormData>((close) => (
        <div className="modal-pad">
            <h2 className="modal-title">{options.title}</h2>
            <FormWizard
                {...options}
                onBusyChange={(busy) => {
                    pending = busy;
                    options.onBusyChange?.(busy);
                }}
                onCancel={() => {
                    if (pending) return;
                    live = false;
                    close(null as unknown as FormData);
                }}
                onFinish={async (data) => {
                    if (finishing) return;
                    finishing = true;
                    pending = true;
                    try {
                        await options.onFinish(data);
                        if (live) {
                            live = false;
                            close(data);
                        }
                    } finally {
                        finishing = false;
                        pending = false;
                    }
                }}
            />
        </div>
    ), { size: options.size, canDismiss: () => !pending }).then((result) => {
        live = false;
        return result;
    });
}
