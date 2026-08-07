// Shared types for the mojo portal baseline.

// Type-only — erased at compile time; zod ships as a portal-mojo dependency
// (the single sanctioned dependency, added with B3 FormView validation).
import type { ZodType } from 'zod';

/** django-mojo list response body (inside the envelope): rows + paging meta. */
export interface MojoList<T> {
    rows: T[];
    count: number;
    start: number;
    size: number;
}

/** Wire params: everything the server understands is a flat query dict. */
export type Params = Record<string, string | number | boolean | null | undefined>;

// ── SchemaForm field language (data side) ─────────────────────────────
// The TYPES live here because model definitions (defineModel) CARRY form
// configs as plain data — web-mojo's User.ADD_FORM/EDIT_FORM heritage.
// Rendering stays in portal-mojo/ui (SchemaForm/formModal re-export these).

/**
 * One value as a controlled form input holds it (server rows may carry
 * numbers/null). Arrays joined B4 (#1278) for the list-valued registry types
 * (multiselect ids, collection-multiselect ids, daterange pairs) — they ride
 * the JSON save body as real lists.
 */
export type FieldValue = string | number | boolean | null | Array<string | number>;
export type FieldValues = Record<string, FieldValue>;

/**
 * Declarative conditional visibility — FormBuilder.js:863-888 semantics:
 * the controlling field's value is String()-coerced and matched against the
 * allowed list; `negate` flips the result.
 */
export interface ShowWhenRule {
    /** Controlling field name (dotted names allowed, e.g. 'metadata.kind'). */
    field: string;
    value: FieldValue | FieldValue[];
    negate?: boolean;
}
/** Either the declarative rule or a predicate over the live form values. */
export type ShowWhen = ShowWhenRule | ((values: FieldValues) => boolean);

/**
 * Field types. The first row are the BUILTINS SchemaForm/FormView render
 * inline; everything after resolves through the ui field-type REGISTRY
 * (ui/field-registry — web-mojo INPUT_TYPES + FormBuilder aliases carried
 * verbatim). `(string & {})` keeps the union open for app-registered types
 * (registerFieldType) without losing autocompletion on the known names.
 * An unknown name renders a text input WITH one console.warn — never nothing.
 */
export type FieldType =
    | 'text' | 'email' | 'tel' | 'select' | 'switch' | 'textarea'
    | 'tag' | 'tags'
    | 'multiselect'
    | 'collection' | 'collectionmultiselect' | 'collection-multiselect'
    | 'combo' | 'combobox' | 'autocomplete'
    | 'address'
    | 'datepicker' | 'monthpicker' | 'yearpicker'
    | 'daterange' | 'monthrange' | 'yearrange'
    | 'timepicker' | 'datetimepicker' | 'timezone'
    | (string & {});

/** A select/multiselect/combo option as Field data carries it. */
export interface FieldOption {
    value: string | number;
    label: string;
    /** ComboBox: muted second line in the dropdown. */
    description?: string;
    /** MultiSelectDropdown: row refuses to toggle. */
    disabled?: boolean;
}

// Structural mirrors of ui/date/PresetRail's preset types (client code must
// not import ui). String-returning `range()` (canonical YYYY-MM-DD strings)
// is assignable to the rail's ParsedDate|string contract by covariance.
export interface FieldPreset { label: string; range: () => { start: string; end: string }; divider?: undefined }
export interface FieldPresetDivider { divider: true; label?: undefined; range?: undefined }
/** 'default' picks the precision's built-in quick-range list. */
export type FieldPresets = 'default' | true | Array<FieldPreset | FieldPresetDivider>;

export interface Field {
    /**
     * Field name — the wire key. Dotted names ('permissions.manage_users')
     * read/write nested dict values; FormView expands them to partial dicts
     * on save (django-mojo MERGES dict bodies into JSONFields — rest.py
     * on_rest_update_jsonfield).
     */
    name: string;
    type: FieldType;
    label: string;
    placeholder?: string;
    required?: boolean;
    help?: string;
    columns?: 6 | 12;
    options?: FieldOption[];
    /** Conditional visibility. Hidden fields never submit/save and their errors clear. */
    showWhen?: ShowWhen;
    /**
     * Per-field zod schema, validated against the COMMITTED input value
     * (string for text-ish types, boolean for switch). A failing parse blocks
     * the save of that field only; the first issue's message shows in the
     * field's error slot. Server-side validation stays authoritative.
     */
    schema?: ZodType;
    /** Locks the control (registry types; builtins ignore it today). */
    disabled?: boolean;

    // ── Registry-type props (B4 #1278) — see docs/forms.md value table ──
    /** date/range pickers: grid precision. EXPLICIT value beats the
     *  monthpicker/yearpicker/monthrange/yearrange alias mapping. */
    precision?: 'day' | 'month' | 'year';
    /**
     * Wire shape override at the field-wire boundary (date/datetime types):
     * 'epoch' (default — django-mojo datetimes are epoch SECONDS) or 'date'
     * (canonical YYYY-MM-DD string — DateFields serialize OUT this way).
     * timepicker reuses the prop for its serialization: 'iso' (default)
     * or 'iana'.
     */
    outputFormat?: 'epoch' | 'date' | 'iso' | 'iana';
    /** date/range pickers: trigger display tokens (YYYY MMM DD …). */
    displayFormat?: string;
    /** Bounds: canonical date strings for pickers, time strings for timepicker. */
    min?: string | number;
    max?: string | number;
    /** daterange: the quick-range rail. */
    presets?: FieldPresets;
    /** daterange, day precision: 1 or 2 panes (default 2). */
    months?: 1 | 2;
    /** tag: the CSV joiner (one char). daterange: the display separator. */
    separator?: string;
    /** timepicker/datetimepicker clock: '24h' (default) | '12h'. */
    timeFormat?: '12h' | '24h';
    /** timepicker: minute stepping increment. */
    step?: number;
    /** timepicker/datetimepicker: enable the zone picker (an array is also the list). */
    timezone?: boolean | string[];
    /** Zone list for timezone/timepicker types (overrides the engine list). */
    timezones?: string[];

    // collection / collectionmultiselect ­— the server-backed pickers.
    /** Any defineModel definition (structurally: carries the endpoint). */
    model?: { endpoint: string };
    /** Bare endpoint when no model definition exists. */
    endpoint?: string;
    /** Row field shown as the label (dot paths ok). Default 'name'. */
    labelField?: string;
    /** Row field used as the id (dot paths ok). Default 'id'. */
    valueField?: string;
    /** collection: rows fetched per search (`size` wire param). */
    maxItems?: number;
    /** collection: fetch the unsearched first page on open. Default true. */
    emptyFetch?: boolean;
    /** Search debounce ms (collection types). */
    debounceMs?: number;
    /** Fold the active group in as the `group` wire param (fetch HELD without one). */
    requiresActiveGroup?: boolean;
    /** Extra wire params merged into every picker fetch. */
    defaultParams?: Params | (() => Params | null | undefined);
    /** collectionmultiselect: search input above the list. */
    enableSearch?: boolean;

    // tag / combo extras.
    maxTags?: number;
    allowDuplicates?: boolean;
    /** combo: typed text not matching an option commits as-is. Default true. */
    allowCustom?: boolean;
    /** combo: render option descriptions. */
    showDescription?: boolean;
    /** combo/timezone: cap on rendered suggestions. */
    maxSuggestions?: number;

    // address — provider details → declared form fields. address1 defaults
    // to this field's own name; every other destination is opt-in.
    addressFields?: Partial<Record<
        'address1' | 'address2' | 'city' | 'state' | 'state_code' |
        'postal_code' | 'country' | 'country_code' | 'latitude' |
        'longitude' | 'formatted_address' | 'place_id', string
    >>;
    /** ISO country constraint for provider suggestions. Default US. */
    country?: string;
    /** Minimum characters before address suggestions. Default 3. */
    minChars?: number;
}

/**
 * SchemaForm's value map. Widened with B4 (#1278) from string|boolean to the
 * full FieldValue union — registry types put lists (multiselect ids,
 * daterange pairs), numbers (epoch dates, collection ids) and null (cleared
 * pickers) in form state, and the submit payload carries them verbatim.
 */
export type FormData = Record<string, FieldValue>;

/** A named model form — exactly what ui's formModal renders. */
export interface ModelForm {
    title: string;
    fields: Field[];
    submitText?: string;
}

/**
 * django-mojo datetimes serialize as EPOCH SECONDS (measured against a live
 * server, not assumed) — fmt.date/relative accept them directly.
 */
export type MojoTimestamp = number | null;

/**
 * The default-graph user row exactly as /api/user serializes it (verified
 * live against mverify 2026-08-04). Note what is NOT here: no `role`, no
 * `created`, no passkey/MFA fields (those ride only the `me` graph).
 */
export interface User {
    id: number;
    display_name: string | null; // null on real rows (system/deleted accounts)
    username: string;
    email: string;
    phone_number: string | null;
    first_name?: string;
    last_name?: string;
    is_active: boolean;
    is_superuser: boolean;
    is_email_verified: boolean;
    is_phone_verified: boolean;
    is_dob_verified?: boolean;
    is_online: boolean;
    last_login: MojoTimestamp;
    last_activity: MojoTimestamp;
    permissions: Record<string, unknown>;
    metadata: Record<string, unknown>;
    dob?: string | null;
    avatar?: { url?: string } | string | null;
    org?: { id: number; name: string } | number | null;
}
