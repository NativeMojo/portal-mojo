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

/** One value as a controlled form input holds it (server rows may carry numbers/null). */
export type FieldValue = string | number | boolean | null;
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

export interface Field {
    /**
     * Field name — the wire key. Dotted names ('permissions.manage_users')
     * read/write nested dict values; FormView expands them to partial dicts
     * on save (django-mojo MERGES dict bodies into JSONFields — rest.py
     * on_rest_update_jsonfield).
     */
    name: string;
    type: 'text' | 'email' | 'tel' | 'select' | 'switch' | 'textarea';
    label: string;
    placeholder?: string;
    required?: boolean;
    help?: string;
    columns?: 6 | 12;
    options?: { value: string; label: string }[];
    /** Conditional visibility. Hidden fields never submit/save and their errors clear. */
    showWhen?: ShowWhen;
    /**
     * Per-field zod schema, validated against the COMMITTED input value
     * (string for text-ish types, boolean for switch). A failing parse blocks
     * the save of that field only; the first issue's message shows in the
     * field's error slot. Server-side validation stays authoritative.
     */
    schema?: ZodType;
}

export type FormData = Record<string, string | boolean>;

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
