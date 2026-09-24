import { mojoCall } from '../../client/runtime';

/** Global Admin gate for `/api/account/admin/signin` (manage_settings | admin). */
export const SIGNIN_ADMIN_PERMISSIONS = ['sys.manage_settings', 'sys.admin'];
export const SIGNIN_ENDPOINT = '/api/account/admin/signin';
export const SIGNIN_QUERY_KEY = ['admin', 'signin'] as const;

export type SigninFieldSource = 'admin' | 'deployment' | 'none';

export interface SigninProviderField {
    key: string;
    label: string;
    secret: boolean;
    multiline: boolean;
    configured: boolean;
    source: SigninFieldSource;
    /** Always null for secret fields. */
    value: string | null;
    /** e.g. "…a1b2" for a stored secret. */
    hint: string | null;
}

export interface SigninProvider {
    name: string;
    label: string;
    enabled: boolean;
    ready: boolean;
    missing: string[];
    callback_url: string;
    console_url: string;
    help: string;
    fields: SigninProviderField[];
}

export interface SigninOptions {
    login_methods: string[];
    registration_methods: string[];
    layouts: string[];
    appearances: string[];
    hero_image_positions: string[];
    passkey_prompts: string[];
}

export interface SigninSettings {
    schema_version: number;
    /** public_auth_config of the resolved SYSTEM config: {theme, login, registration}. */
    auth: Record<string, Record<string, unknown>>;
    /** Flat dotted paths the POST accepts under `auth`. */
    editable: string[];
    options: SigninOptions;
    providers: SigninProvider[];
}

/**
 * Provider credential edit: omitted or "" keeps the stored value, null clears it.
 * `enabled` adds/removes the provider from login + registration methods.
 */
export interface SigninProviderChange {
    provider: string;
    values?: Record<string, string | null>;
    enabled?: boolean;
}

export async function fetchSigninSettings(): Promise<SigninSettings> {
    const body = await mojoCall(SIGNIN_ENDPOINT);
    return body.data as SigninSettings;
}

/** Save changed look-and-feel paths; returns the full refreshed payload. */
export async function saveSigninAuth(changes: Record<string, unknown>): Promise<SigninSettings> {
    const body = await mojoCall(SIGNIN_ENDPOINT, { method: 'POST', body: { auth: changes } });
    return body.data as SigninSettings;
}

export async function saveSigninProvider(change: SigninProviderChange): Promise<SigninSettings> {
    const body = await mojoCall(SIGNIN_ENDPOINT, { method: 'POST', body: { ...change } });
    return body.data as SigninSettings;
}

export function getSigninPath(auth: SigninSettings['auth'], path: string): unknown {
    const [section, key] = path.split('.') as [string, string];
    return auth[section]?.[key];
}
