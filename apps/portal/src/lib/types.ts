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
