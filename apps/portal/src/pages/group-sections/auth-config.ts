export interface RegistrationField {
    name: string;
    required: boolean;
    verify: string | null;
}

export type AuthFormState = Record<string, unknown>;
export type AuthConfig = Record<string, unknown>;

export const LOGIN_METHOD_OPTS = [
    { value: 'password', label: 'Password' },
    { value: 'sms', label: 'SMS code' },
    { value: 'passkey', label: 'Passkey' },
    { value: 'magic', label: 'Magic link' },
    { value: 'google', label: 'Google' },
    { value: 'apple', label: 'Apple' },
    { value: 'github', label: 'GitHub' },
];

export const REGISTRATION_METHOD_OPTS = [
    { value: 'password', label: 'Password' },
    { value: 'google', label: 'Google' },
    { value: 'apple', label: 'Apple' },
    { value: 'github', label: 'GitHub' },
];

export const LAYOUT_OPTS = [
    { value: 'card', label: 'Card' },
    { value: 'fullscreen', label: 'Full screen' },
];

export const PASSKEY_PROMPT_OPTS = [
    { value: 'off', label: 'Off' },
    { value: 'optional', label: 'Optional' },
    { value: 'required', label: 'Required' },
];

export const IDENTITY_FIELD_OPTS = [
    { value: '', label: 'Auto (email, then phone)' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
];

export const VERIFY_OPTS = [
    { value: '', label: 'None' },
    { value: 'email', label: 'Email' },
    { value: 'sms', label: 'SMS' },
];

export const CANONICAL_REG_FIELDS = [
    { name: 'first_name', label: 'First name' },
    { name: 'last_name', label: 'Last name' },
    { name: 'email', label: 'Email' },
    { name: 'phone', label: 'Phone' },
    { name: 'dob', label: 'Date of birth' },
    { name: 'password', label: 'Password' },
];
const CANONICAL_REG_NAMES = new Set(CANONICAL_REG_FIELDS.map((field) => field.name));
const EXTRA_FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export const DEFAULT_REG_FIELDS: RegistrationField[] = [
    { name: 'first_name', required: false, verify: null },
    { name: 'last_name', required: false, verify: null },
    { name: 'email', required: true, verify: 'email' },
    { name: 'password', required: true, verify: null },
];

export const STATIC_DEFAULTS: AuthConfig = {
    theme: {
        app_title: 'DJANGO MOJO', logo_url: '', favicon_url: '', hero_image_url: '',
        hero_headline: 'Welcome back', hero_subheadline: 'Admin Portal',
        back_to_website_url: '', terms_url: '', layout: 'card', api_base: '',
        success_redirect: '/', custom_css: '', custom_css_url: '',
    },
    registration: {
        enabled: true, fields: null, extra_fields: [], identity_field: '', min_age: null,
        methods: ['password', 'google', 'apple', 'github'], passkey_prompt: 'off',
    },
    login: { methods: ['password', 'sms', 'passkey', 'magic', 'google', 'apple', 'github'] },
};

export const THEME_TEXT_FIELDS = [
    { name: 'app_title', path: 'theme.app_title', label: 'App title', help: 'Brand name shown in the login card header.' },
    { name: 'logo_url', path: 'theme.logo_url', label: 'Logo URL', help: 'Logo image URL — appears in the header and hero panel.' },
    { name: 'favicon_url', path: 'theme.favicon_url', label: 'Favicon URL', help: 'Favicon URL for the auth pages.' },
    { name: 'hero_image_url', path: 'theme.hero_image_url', label: 'Hero image URL', help: 'Background image for the left hero panel.' },
    { name: 'hero_headline', path: 'theme.hero_headline', label: 'Hero headline', help: 'Headline text shown over the hero image.' },
    { name: 'hero_subheadline', path: 'theme.hero_subheadline', label: 'Hero subheadline', help: 'Supporting text below the hero headline.' },
    { name: 'back_to_website_url', path: 'theme.back_to_website_url', label: 'Back-to-website URL', help: '"Back to website" link shown in the hero panel.' },
    { name: 'terms_url', path: 'theme.terms_url', label: 'Terms URL', help: 'Terms & Conditions link shown on the register page.' },
    { name: 'api_base', path: 'theme.api_base', label: 'API base', help: 'API host for the auth pages — leave blank for same origin.' },
    { name: 'success_redirect', path: 'theme.success_redirect', label: 'Success redirect', help: 'Where to send the user after a successful login.' },
    { name: 'custom_css_url', path: 'theme.custom_css_url', label: 'Custom CSS URL', help: 'URL to an external stylesheet — must start with https://.' },
];

export const BASE_THEME_FIELDS = [
    'app_title', 'logo_url', 'favicon_url', 'hero_image_url',
    'hero_headline', 'hero_subheadline', 'back_to_website_url', 'terms_url',
];
export const ADVANCED_THEME_FIELDS = ['api_base', 'success_redirect', 'custom_css_url'];

type DescriptorKind = 'text' | 'select' | 'array' | 'bool' | 'int';
interface Descriptor { form: string; path: string; kind: DescriptorKind }

const FIELD_DESCRIPTORS: Descriptor[] = [
    ...THEME_TEXT_FIELDS.map((field): Descriptor => ({ form: field.name, path: field.path, kind: 'text' })),
    { form: 'custom_css', path: 'theme.custom_css', kind: 'text' },
    { form: 'layout', path: 'theme.layout', kind: 'select' },
    { form: 'login_methods', path: 'login.methods', kind: 'array' },
    { form: 'reg_enabled', path: 'registration.enabled', kind: 'bool' },
    { form: 'reg_passkey_prompt', path: 'registration.passkey_prompt', kind: 'select' },
    { form: 'reg_identity_field', path: 'registration.identity_field', kind: 'select' },
    { form: 'reg_min_age', path: 'registration.min_age', kind: 'int' },
    { form: 'reg_methods', path: 'registration.methods', kind: 'array' },
];

export function getAuthPath(obj: unknown, path: string): unknown {
    let current: unknown = obj;
    for (const key of path.split('.')) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[key];
    }
    return current;
}

function setAuthPath(obj: AuthConfig, path: string, value: unknown): void {
    const keys = path.split('.');
    let current = obj;
    for (let index = 0; index < keys.length - 1; index += 1) {
        const key = keys[index]!;
        if (current[key] == null || typeof current[key] !== 'object') current[key] = {};
        current = current[key] as AuthConfig;
    }
    current[keys[keys.length - 1]!] = value;
}

export function deepMergeAuthConfig(base: AuthConfig, override: unknown): AuthConfig {
    const output: AuthConfig = structuredClone(base);
    if (override == null || typeof override !== 'object' || Array.isArray(override)) return output;
    for (const [key, value] of Object.entries(override as AuthConfig)) {
        const previous = output[key];
        output[key] = previous != null && typeof previous === 'object' && !Array.isArray(previous)
            && value != null && typeof value === 'object' && !Array.isArray(value)
            ? deepMergeAuthConfig(previous as AuthConfig, value)
            : structuredClone(value);
    }
    return output;
}

/** Merge deployment defaults then root-to-leaf group overrides. */
export function resolveAuthConfigChain(deployment: AuthConfig, chain: Array<{ metadata?: Record<string, unknown> }>): AuthConfig {
    return chain.reduce((config, group) => {
        const override = group.metadata?.auth_config;
        return deepMergeAuthConfig(config, override);
    }, deepMergeAuthConfig({}, deployment));
}

function sameSet(a: unknown, b: unknown): boolean {
    const left = [...(Array.isArray(a) ? a : [])].map(String).sort();
    const right = [...(Array.isArray(b) ? b : [])].map(String).sort();
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function gridValuesFromArray(fields: RegistrationField[]): AuthFormState {
    const byName = Object.fromEntries(fields.filter((field) => field?.name).map((field) => [field.name, field]));
    const output: AuthFormState = {};
    for (const field of CANONICAL_REG_FIELDS) {
        const entry = byName[field.name];
        const isPassword = field.name === 'password';
        output[`regf_${field.name}_inc`] = !!entry;
        output[`regf_${field.name}_req`] = isPassword ? true : !!entry?.required;
        output[`regf_${field.name}_vfy`] = entry?.verify ? String(entry.verify) : '';
    }
    return output;
}

function extraNamesFromArray(value: unknown): string {
    return (Array.isArray(value) ? value : [])
        .map((entry) => entry && typeof entry === 'object' ? (entry as { name?: unknown }).name : entry)
        .filter((name): name is string => typeof name === 'string' && name.trim() !== '')
        .map((name) => name.trim())
        .join(',');
}

export function assembleRegistrationFields(values: AuthFormState): RegistrationField[] {
    const output: RegistrationField[] = [];
    for (const field of CANONICAL_REG_FIELDS) {
        if (values[`regf_${field.name}_inc`] !== true) continue;
        output.push(field.name === 'password'
            ? { name: 'password', required: true, verify: null }
            : {
                name: field.name,
                required: values[`regf_${field.name}_req`] === true,
                verify: values[`regf_${field.name}_vfy`] ? String(values[`regf_${field.name}_vfy`]) : null,
            });
    }
    return output;
}

function assembleExtraFields(values: AuthFormState): { name: string }[] {
    const raw = values.reg_extra_fields;
    const parts = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(',');
    const seen = new Set<string>();
    const output: { name: string }[] = [];
    for (const part of parts) {
        const name = part.trim();
        if (!name || seen.has(name) || CANONICAL_REG_NAMES.has(name) || !EXTRA_FIELD_NAME_RE.test(name)) continue;
        seen.add(name);
        output.push({ name });
    }
    return output;
}

export function buildAuthBaseline(own: unknown, resolved: unknown): AuthFormState {
    const baseline: AuthFormState = {};
    for (const descriptor of FIELD_DESCRIPTORS) {
        const ownValue = getAuthPath(own, descriptor.path);
        const resolvedValue = getAuthPath(resolved, descriptor.path);
        if (descriptor.kind === 'text') baseline[descriptor.form] = ownValue == null ? '' : String(ownValue);
        else if (descriptor.kind === 'int') baseline[descriptor.form] = ownValue == null || ownValue === '' ? '' : String(ownValue);
        else if (descriptor.kind === 'array') {
            const value = ownValue != null ? ownValue : resolvedValue;
            baseline[descriptor.form] = Array.isArray(value) ? value.map(String) : [];
        } else if (descriptor.kind === 'bool') baseline[descriptor.form] = !!(ownValue != null ? ownValue : resolvedValue);
        else baseline[descriptor.form] = String(ownValue != null ? ownValue : resolvedValue ?? '');
    }
    const ownFields = getAuthPath(own, 'registration.fields');
    const resolvedFields = getAuthPath(resolved, 'registration.fields');
    const fields = Array.isArray(ownFields) ? ownFields as RegistrationField[]
        : Array.isArray(resolvedFields) ? resolvedFields as RegistrationField[] : DEFAULT_REG_FIELDS;
    Object.assign(baseline, gridValuesFromArray(fields));
    const ownExtra = getAuthPath(own, 'registration.extra_fields');
    const resolvedExtra = getAuthPath(resolved, 'registration.extra_fields');
    baseline.reg_extra_fields = extraNamesFromArray(Array.isArray(ownExtra) ? ownExtra : resolvedExtra);
    return baseline;
}

export function buildAuthPlaceholders(resolved: unknown): Record<string, string> {
    const placeholders: Record<string, string> = {};
    for (const descriptor of FIELD_DESCRIPTORS) {
        if (descriptor.kind !== 'text' && descriptor.kind !== 'int') continue;
        const value = getAuthPath(resolved, descriptor.path);
        placeholders[descriptor.form] = value == null ? '' : String(value);
    }
    return placeholders;
}

function isDifferent(current: unknown, baseline: unknown, kind: DescriptorKind): boolean {
    if (kind === 'array') return !sameSet(current, baseline);
    if (kind === 'bool') return !!current !== !!baseline;
    if (kind === 'int') {
        const left = current === '' || current == null ? null : Number(current);
        const right = baseline === '' || baseline == null ? null : Number(baseline);
        return left !== right;
    }
    return String(current ?? '').trim() !== String(baseline ?? '').trim();
}

function normalizeForSave(current: unknown, kind: DescriptorKind): unknown {
    if (kind === 'array') return [...(Array.isArray(current) ? current : [])];
    if (kind === 'bool') return !!current;
    if (kind === 'int') return current === '' || current == null ? null : Number(current);
    return current == null ? '' : String(current);
}

export function buildAuthConfigDiff(values: AuthFormState, baseline: AuthFormState): AuthConfig | null {
    const payload: AuthConfig = {};
    let changed = false;
    for (const descriptor of FIELD_DESCRIPTORS) {
        if (!isDifferent(values[descriptor.form], baseline[descriptor.form], descriptor.kind)) continue;
        setAuthPath(payload, descriptor.path, normalizeForSave(values[descriptor.form], descriptor.kind));
        changed = true;
    }
    const fields = assembleRegistrationFields(values);
    if (JSON.stringify(fields) !== JSON.stringify(assembleRegistrationFields(baseline))) {
        setAuthPath(payload, 'registration.fields', fields);
        changed = true;
    }
    const extraFields = assembleExtraFields(values);
    if (JSON.stringify(extraFields) !== JSON.stringify(assembleExtraFields(baseline))) {
        setAuthPath(payload, 'registration.extra_fields', extraFields);
        changed = true;
    }
    return changed ? payload : null;
}
