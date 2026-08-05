// field-registry — the field-type registry: every non-builtin `Field.type`
// string resolves here to a renderer that binds the Field def + the form's
// controlled value/commit pipeline to the real component. Board #1278;
// web-mojo sources: src/core/forms/inputs/index.js (INPUT_TYPES +
// PRECISION_ALIASES + createInput) and FormBuilder.js's field-type switch.
// This is also the FormPlugins replacement (PLAN "pattern, not port"):
// `registerFieldType` is the app-extension seam.
//
// Contracts:
//   · One value pipeline. A renderer receives the form-state value and ONE
//     `commit(next)` — every component here fires on COMMIT (selection,
//     blur/Enter settle, toggle), never per keystroke, so a commit is always
//     a save-worthy gesture for FormView's 300ms batch.
//   · State holds the WIRE shape (see field-wire.ts). Date-ish renderers
//     convert at their own edge: render via wireToField, commit via
//     fieldToWire. No other layer converts.
//   · Unknown types fall back to a text input WITH one console.warn — the
//     SchemaForm/FormView surfaces call `warnUnknownFieldType` so the rule
//     (and its warn-once set) lives in one place.
//   · Renderers are React COMPONENTS (rendered via <Renderer/>), so a
//     binding may hold hooks/state of its own.
import { useState } from 'react';
import type { ComponentType } from 'react';
import type { Field, FieldValue } from '../client/types';
import { CollectionMultiSelect } from './CollectionMultiSelect';
import { CollectionSelect } from './CollectionSelect';
import { ComboBox, type ComboValue } from './ComboBox';
import { MultiSelectDropdown, type MultiSelectValue } from './MultiSelectDropdown';
import { TagInput } from './TagInput';
import { DatePicker } from './date/DatePicker';
import { DateRangePicker } from './date/DateRangePicker';
import { DateTimePicker } from './date/DateTimePicker';
import { TimePicker, type TimeValue } from './date/TimePicker';
import { TimezoneSelect } from './date/TimezoneSelect';
import {
    emptyFieldValue,
    fieldPrecision,
    fieldToWire,
    wireToField,
} from './field-wire';

// ── The registry ──────────────────────────────────────────────────────

/** What a form surface hands a registry renderer. */
export interface RegistryFieldProps {
    field: Field;
    /** The form-state value (WIRE-shaped — field-wire.ts is the converter). */
    value: FieldValue;
    /** Paint the error border (the surface renders the error text itself). */
    invalid?: boolean;
    /** Surface-level lock (the field's own `disabled` is also honored). */
    disabled?: boolean;
    /** THE change pipeline: called once per commit with the next state value. */
    commit: (value: FieldValue) => void;
}

/** A renderer is a function component over RegistryFieldProps. */
export type FieldTypeRenderer = ComponentType<RegistryFieldProps>;

const registry = new Map<string, FieldTypeRenderer>();

/**
 * Register (or replace — idempotent under HMR) a renderer for one or more
 * type names. Names match EXACTLY (no case folding): a typo'd type must fall
 * through to the loud unknown-type fallback, not silently half-match.
 */
export function registerFieldType(names: string | string[], renderer: FieldTypeRenderer): void {
    for (const name of Array.isArray(names) ? names : [names]) {
        registry.set(name, renderer);
    }
}

/** The renderer for a type, or null (→ the caller warns + text-input falls back). */
export function resolveFieldRenderer(type: string): FieldTypeRenderer | null {
    return registry.get(type) ?? null;
}

/** Registered names, registration order (docs/tooling; not a render path). */
export function registeredFieldTypes(): string[] {
    return [...registry.keys()];
}

// One warn per (field, type) shared by every surface — an unknown type is a
// config bug, not a render event (same policy as SchemaSelect's values).
const warnedUnknownTypes = new Set<string>();
export function warnUnknownFieldType(surface: string, field: Field): void {
    const key = `${field.name}:${field.type}`;
    if (warnedUnknownTypes.has(key)) return;
    warnedUnknownTypes.add(key);
    console.warn(`${surface}: unknown field type "${field.type}" on "${field.name}" — rendering a text input`);
}

// ── Value coercion helpers (state → component props) ──────────────────

/** State value → id list for the multi-pick components. Accepts real arrays,
 *  a bare scalar, and the CSV/flattened string an autosave snapshot
 *  round-trip produces (form-autosave's toDisplay String()s scalars). */
function toIdArray(value: FieldValue): Array<string | number> {
    if (value == null || value === '' || value === false) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'boolean') return [];
    if (typeof value === 'number') return [value];
    return String(value).split(',').map((s) => s.trim()).filter((s) => s !== '');
}

/** State value → the scalar the single-pick components hold (null = none). */
function toScalar(value: FieldValue): string | number | null {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    if (Array.isArray(value)) return value.length ? value[0]! : null;
    return value;
}

/** collection types: the endpoint a Field names (model wins), or null. */
function fieldEndpoint(field: Field): string | null {
    return field.model?.endpoint ?? field.endpoint ?? null;
}

// One warn per field for config-level misses (missing endpoint etc.).
const warnedConfig = new Set<string>();
function warnConfigOnce(field: Field, note: string): void {
    if (warnedConfig.has(field.name)) return;
    warnedConfig.add(field.name);
    console.warn(`field-registry: ${note} (field "${field.name}")`);
}

/** The last-resort control — also what a misconfigured binding degrades to
 *  (never "render nothing"). Commits on blur/Enter like FormView text. */
function FallbackTextInput({ field, value, invalid, disabled, commit }: RegistryFieldProps) {
    const committed = value == null || typeof value === 'object' ? '' : String(value);
    const [draft, setDraft] = useState<string | null>(null);
    const shown = draft ?? committed;
    const settle = () => {
        if (draft != null && draft !== committed) commit(draft);
        setDraft(null);
    };
    return (
        <input
            className={`input${invalid ? ' input-invalid' : ''}`}
            type="text"
            placeholder={field.placeholder}
            value={shown}
            disabled={disabled || field.disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={settle}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    settle();
                }
            }}
        />
    );
}

// ── Standard bindings (web-mojo INPUT_TYPES + FormBuilder aliases) ────

// tag | tags → TagInput. State/wire: CSV string (the load-bearing shape —
// django-mojo models split the stored string).
registerFieldType(['tag', 'tags'], function TagField({ field, value, disabled, commit }) {
    return (
        <TagInput
            value={Array.isArray(value) ? value.map(String) : String(value ?? '')}
            placeholder={field.placeholder}
            maxTags={field.maxTags}
            allowDuplicates={field.allowDuplicates}
            separator={field.separator}
            disabled={disabled || field.disabled}
            onChange={(csv) => commit(csv)}
        />
    );
});

// multiselect → MultiSelectDropdown. State/wire: array of option values.
registerFieldType('multiselect', function MultiSelectField({ field, value, disabled, commit }) {
    return (
        <MultiSelectDropdown
            options={(field.options ?? []).map((o) => ({ value: o.value, label: o.label, disabled: o.disabled }))}
            value={toIdArray(value) as MultiSelectValue[]}
            placeholder={field.placeholder}
            disabled={disabled || field.disabled}
            onChange={(values) => commit(values)}
        />
    );
});

// collection → CollectionSelect. State/wire: the picked row's id, null = none.
registerFieldType('collection', function CollectionField({ field, value, disabled, commit }) {
    const endpoint = fieldEndpoint(field);
    if (!endpoint) {
        warnConfigOnce(field, 'type "collection" needs `model` or `endpoint` — rendering a text input');
        return <FallbackTextInput field={field} value={value} disabled={disabled} commit={commit} />;
    }
    return (
        <CollectionSelect
            endpoint={endpoint}
            value={toScalar(value)}
            labelField={field.labelField}
            valueField={field.valueField}
            maxItems={field.maxItems}
            placeholder={field.placeholder}
            debounceMs={field.debounceMs}
            emptyFetch={field.emptyFetch}
            defaultParams={field.defaultParams}
            requiresActiveGroup={field.requiresActiveGroup}
            disabled={disabled || field.disabled}
            onChange={(id) => commit(id ?? null)}
        />
    );
});

// collectionmultiselect → CollectionMultiSelect. State/wire: array of ids.
registerFieldType(['collectionmultiselect', 'collection-multiselect'], function CollectionMultiField({ field, value, disabled, commit }) {
    const endpoint = fieldEndpoint(field);
    if (!endpoint) {
        warnConfigOnce(field, 'type "collectionmultiselect" needs `model` or `endpoint` — rendering a text input');
        return <FallbackTextInput field={field} value={value} disabled={disabled} commit={commit} />;
    }
    return (
        <CollectionMultiSelect
            endpoint={endpoint}
            value={toIdArray(value)}
            labelField={field.labelField}
            valueField={field.valueField}
            enableSearch={field.enableSearch}
            searchPlaceholder={field.placeholder}
            defaultParams={field.defaultParams}
            requiresActiveGroup={field.requiresActiveGroup}
            disabled={disabled || field.disabled}
            onChange={(ids) => commit(ids)}
        />
    );
});

// combo | combobox | autocomplete → ComboBox. State/wire: the committed
// value (string/number; allowCustom lets free text through as-is).
registerFieldType(['combo', 'combobox', 'autocomplete'], function ComboField({ field, value, disabled, commit }) {
    return (
        <ComboBox
            value={toScalar(value) as ComboValue | null}
            options={(field.options ?? []).map((o) => ({ value: o.value, label: o.label, description: o.description }))}
            placeholder={field.placeholder}
            allowCustom={field.allowCustom}
            showDescription={field.showDescription}
            maxSuggestions={field.maxSuggestions}
            disabled={disabled || field.disabled}
            required={field.required}
            onChange={(v) => commit(v)}
        />
    );
});

// datepicker | monthpicker | yearpicker → DatePicker. The ALIAS pre-sets
// precision; explicit Field.precision wins (createInput parity). State/wire:
// epoch seconds (UTC midnight) — or the canonical string under
// outputFormat:'date'. Control: canonical YYYY-MM-DD / YYYY-MM / YYYY.
registerFieldType(['datepicker', 'monthpicker', 'yearpicker'], function DateField({ field, value, invalid, disabled, commit }) {
    return (
        <DatePicker
            value={wireToField(field, value) as string | null}
            precision={fieldPrecision(field)}
            displayFormat={field.displayFormat}
            placeholder={field.placeholder}
            min={field.min != null ? String(field.min) : null}
            max={field.max != null ? String(field.max) : null}
            required={field.required}
            invalid={invalid}
            disabled={disabled || field.disabled}
            onChange={(e) => commit(fieldToWire(field, e.value))}
        />
    );
});

// daterange | monthrange | yearrange → DateRangePicker. ONE field name;
// state/wire: [startEpoch, endEpoch] (or canonical pair under
// outputFormat:'date'), null when empty — the picker commits
// complete-or-cleared only. (Deviation from web-mojo's startName/endName
// twin wire keys — split columns should use two datepicker fields.)
registerFieldType(['daterange', 'monthrange', 'yearrange'], function DateRangeField({ field, value, disabled, commit }) {
    const pair = wireToField(field, value) as [string, string] | null;
    return (
        <DateRangePicker
            start={pair?.[0] ?? ''}
            end={pair?.[1] ?? ''}
            precision={fieldPrecision(field)}
            months={field.months}
            presets={field.presets ?? null}
            displayFormat={field.displayFormat}
            separator={field.separator}
            placeholder={field.placeholder}
            min={field.min != null ? String(field.min) : null}
            max={field.max != null ? String(field.max) : null}
            required={field.required}
            disabled={disabled || field.disabled}
            onChange={(e) => commit(e.start && e.end ? fieldToWire(field, [e.start, e.end]) : null)}
        />
    );
});

// timepicker → TimePicker, with the REAL TimezoneSelect in its
// renderTimezoneSelect slot (the component's own <select> fallback is for
// standalone use only). State/wire: the serialized time STRING —
// outputFormat 'iso' (default, '14:30-07:00') or 'iana'
// ('14:30 America/Los_Angeles'); '' when empty. Times are not epochs.
registerFieldType('timepicker', function TimeField({ field, value, invalid, disabled, commit }) {
    const committed = typeof value === 'string' ? value : '';
    return (
        <TimePicker
            value={committed}
            format={field.timeFormat}
            step={field.step}
            min={field.min != null ? String(field.min) : null}
            max={field.max != null ? String(field.max) : null}
            placeholder={field.placeholder}
            timezone={field.timezone}
            timezones={field.timezones ?? null}
            outputFormat={field.outputFormat === 'iana' ? 'iana' : 'iso'}
            required={field.required}
            invalid={invalid}
            disabled={disabled || field.disabled}
            renderTimezoneSelect={(slot) => (
                <TimezoneSelect
                    value={slot.value}
                    timezones={slot.timezones ?? null}
                    disabled={slot.disabled}
                    onChange={(e) => slot.onChange(e.value)}
                />
            )}
            onChange={(e: { value: TimeValue }) => commit(typeof e.value === 'string' ? e.value : '')}
        />
    );
});

// timezone → TimezoneSelect. State/wire: the IANA zone string ('' = unset;
// the picker DISPLAYS the local zone for an empty value — resolveTimezone
// is the helper when a form must post that effective default).
registerFieldType('timezone', function TimezoneField({ field, value, disabled, commit }) {
    return (
        <TimezoneSelect
            value={typeof value === 'string' && value !== '' ? value : null}
            timezones={field.timezones ?? null}
            placeholder={field.placeholder}
            maxSuggestions={field.maxSuggestions}
            required={field.required}
            disabled={disabled || field.disabled}
            onChange={(e) => commit(e.value)}
        />
    );
});

// datetimepicker — the real #1273 DateTimePicker (seam activated at merge:
// the control renders the picker; state stays in the wire shape via
// field-wire on both edges, exactly as every date-ish renderer here).
registerFieldType('datetimepicker', function DateTimeField({ field, value, invalid, disabled, commit }) {
    return (
        <DateTimePicker
            value={wireToField(field, value) as string | null}
            timeFormat={field.timeFormat}
            displayFormat={field.displayFormat}
            timezone={field.timezones ?? field.timezone}
            placeholder={field.placeholder}
            required={field.required}
            invalid={invalid}
            disabled={disabled || field.disabled}
            onChange={(e) => {
                if (e.value == null) return commit(null);
                // This binding never sets outputFormat:'object', so e.value is a
                // string; the object branch keeps the type honest regardless.
                const s = typeof e.value === 'string'
                    ? e.value
                    : `${e.value.date} ${e.value.time}${e.value.timezone ? ` ${e.value.timezone}` : ''}`;
                commit(fieldToWire(field, s));
            }}
        />
    );
});

// Re-exported so form surfaces (and apps) reach the value-shape helpers from
// the registry module they already import.
export { emptyFieldValue, fieldPrecision, fieldToWire, wireToField };
