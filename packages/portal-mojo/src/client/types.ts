// Shared types for the mojo portal baseline.

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

/** A named model form — exactly what ui's formModal renders. */
export interface ModelForm {
    title: string;
    fields: Field[];
    submitText?: string;
}

export interface User {
    id: number;
    display_name: string;
    email: string;
    phone: string | null;
    role: 'user' | 'staff' | 'admin';
    is_active: boolean;
    email_verified: boolean;
    mfa_enabled: boolean;
    passkeys: number;
    last_login: string | null; // ISO
    created: string; // ISO
}
