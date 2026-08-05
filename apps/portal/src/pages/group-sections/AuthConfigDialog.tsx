// group-sections/AuthConfigDialog.tsx — GroupAuthConfigSection port
// (admin/account/groups/GroupAuthConfigSection.js, all 699 lines read
// 2026-08-05): the form-based editor for a Group's `metadata.auth_config` —
// the per-group structured config driving the django-mojo–hosted login,
// registration, and passkey pages. Resolved server-side as: code defaults
// <- deployment AUTH_CONFIG <- group.metadata.auth_config, deep-merged down
// the parent chain. This dialog edits the group's OWN override only.
//
// Load: each field shows the group's own override if present, else the
// resolved/inherited value (GET /api/auth/config?group_uuid=). Text/int
// fields show the resolved value as PLACEHOLDER text instead, so blank =
// "still inheriting".
// Save: explicit (not autosave — the server applies cross-field validation:
// registration fields must include email or phone, login.methods non-empty,
// so a mid-edit state is routinely invalid). Sends ONLY fields changed from
// the loaded baseline via {metadata: {auth_config: <diff>}} — django
// deep-merges the JSONField, so sibling keys survive and untouched fields
// keep inheriting.
//
// Opened from the GroupDetail kebab ("Configure Auth", sys.groups /
// sys.manage_groups — GROUP_AUTH_PERMS), as a modal per the source ("the
// multi-tab form is too heavy for the side-nav").
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MultiSelectDropdown, TagInput, modal, toast } from 'portal-mojo/ui';
import { mojoCall } from 'portal-mojo/client';
import { GroupModel, type GroupRow } from '../../models';

// ── Allowed tokens (must match django-mojo auth_config schema) ────────

const LOGIN_METHOD_OPTS = [
    { value: 'password', label: 'Password' },
    { value: 'sms', label: 'SMS code' },
    { value: 'passkey', label: 'Passkey' },
    { value: 'magic', label: 'Magic link' },
    { value: 'google', label: 'Google' },
    { value: 'apple', label: 'Apple' },
];

const REGISTRATION_METHOD_OPTS = [
    { value: 'password', label: 'Password' },
    { value: 'google', label: 'Google' },
    { value: 'apple', label: 'Apple' },
];

const LAYOUT_OPTS = [
    { value: 'card', label: 'Card' },
    { value: 'fullscreen', label: 'Full screen' },
];

const PASSKEY_PROMPT_OPTS = [
    { value: 'off', label: 'Off' },
    { value: 'optional', label: 'Optional' },
    { value: 'required', label: 'Required' },
];

const IDENTITY_FIELD_OPTS = [
    { value: '', label: 'Auto (email, then phone)' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
];

const VERIFY_OPTS = [
    { value: '', label: 'None' },
    { value: 'email', label: 'Email' },
    { value: 'sms', label: 'SMS' },
];

// Canonical registration-form fields (closed set — register_schema.CANONICAL_FIELDS).
const CANONICAL_REG_FIELDS = [
    { name: 'first_name', label: 'First name' },
    { name: 'last_name', label: 'Last name' },
    { name: 'email', label: 'Email' },
    { name: 'phone', label: 'Phone' },
    { name: 'dob', label: 'Date of birth' },
    { name: 'password', label: 'Password' },
];
const CANONICAL_REG_NAMES = new Set(CANONICAL_REG_FIELDS.map((f) => f.name));

// Must match the server's identifier rule (register_schema._EXTRA_NAME_RE).
const EXTRA_FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

// register_schema.DEFAULT_FIELDS — seeds the grid when neither the group's
// own override nor the resolved config specify `registration.fields`.
const DEFAULT_REG_FIELDS: RegField[] = [
    { name: 'first_name', required: false, verify: null },
    { name: 'last_name', required: false, verify: null },
    { name: 'email', required: true, verify: 'email' },
    { name: 'password', required: true, verify: null },
];

// django-mojo DEFAULT_AUTH_CONFIG — fallback when the resolved-config fetch
// fails, so the editor still shows sensible inherited values.
const STATIC_DEFAULTS = {
    theme: {
        app_title: 'DJANGO MOJO', logo_url: '', favicon_url: '', hero_image_url: '',
        hero_headline: 'Welcome back', hero_subheadline: 'Admin Portal',
        back_to_website_url: '', terms_url: '', layout: 'card', api_base: '',
        success_redirect: '/', custom_css: '', custom_css_url: '',
    },
    registration: {
        enabled: true, fields: null, extra_fields: [], identity_field: '', min_age: null,
        methods: ['password', 'google', 'apple'], passkey_prompt: 'off',
    },
    login: { methods: ['password', 'sms', 'passkey', 'magic', 'google', 'apple'] },
} as const;

// Theme text fields: form name + dotted path under `auth_config` + help copy.
const THEME_TEXT_FIELDS = [
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

const BASE_THEME_FIELDS = [
    'app_title', 'logo_url', 'favicon_url', 'hero_image_url',
    'hero_headline', 'hero_subheadline', 'back_to_website_url', 'terms_url',
];
const ADVANCED_THEME_FIELDS = ['api_base', 'success_redirect', 'custom_css_url'];

// FIELD_DESCRIPTORS — every non-grid form field, its dotted path under
// `auth_config`, and a kind that drives baseline/diff/serialisation.
//   text   — placeholder-capable; baseline = own override only.
//   select — baseline = own override, else resolved (no placeholder).
//   array  — multiselect; baseline = own override, else resolved.
//   bool   — toggle;      baseline = own override, else resolved.
//   int    — placeholder-capable number; baseline = own override only.
type DescriptorKind = 'text' | 'select' | 'array' | 'bool' | 'int';
interface Descriptor { form: string; path: string; kind: DescriptorKind }

const FIELD_DESCRIPTORS: Descriptor[] = [
    ...THEME_TEXT_FIELDS.map((f): Descriptor => ({ form: f.name, path: f.path, kind: 'text' })),
    { form: 'custom_css', path: 'theme.custom_css', kind: 'text' },
    { form: 'layout', path: 'theme.layout', kind: 'select' },
    { form: 'login_methods', path: 'login.methods', kind: 'array' },
    { form: 'reg_enabled', path: 'registration.enabled', kind: 'bool' },
    { form: 'reg_passkey_prompt', path: 'registration.passkey_prompt', kind: 'select' },
    { form: 'reg_identity_field', path: 'registration.identity_field', kind: 'select' },
    { form: 'reg_min_age', path: 'registration.min_age', kind: 'int' },
    { form: 'reg_methods', path: 'registration.methods', kind: 'array' },
];

// ── Path + value helpers ──────────────────────────────────────────────

function getPath(obj: unknown, path: string): unknown {
    let cur: unknown = obj;
    for (const key of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[key];
    }
    return cur;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const keys = path.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i += 1) {
        const k = keys[i]!;
        if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
        cur = cur[k] as Record<string, unknown>;
    }
    cur[keys[keys.length - 1]!] = value;
}

function sameSet(a: unknown, b: unknown): boolean {
    const sa = [...(Array.isArray(a) ? a : [])].map(String).sort();
    const sb = [...(Array.isArray(b) ? b : [])].map(String).sort();
    return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

interface RegField { name: string; required: boolean; verify: string | null }

type FormState = Record<string, unknown>;

/** Expand a `registration.fields` array into flat grid form values. */
function gridValuesFromArray(arr: RegField[]): FormState {
    const byName: Record<string, RegField> = {};
    for (const f of arr) if (f?.name) byName[f.name] = f;
    const out: FormState = {};
    for (const cf of CANONICAL_REG_FIELDS) {
        const entry = byName[cf.name];
        const isPassword = cf.name === 'password';
        out[`regf_${cf.name}_inc`] = !!entry;
        // Password is always required when present; its toggle is locked on.
        out[`regf_${cf.name}_req`] = isPassword ? true : !!(entry && entry.required);
        out[`regf_${cf.name}_vfy`] = entry?.verify ? String(entry.verify) : '';
    }
    return out;
}

/** Comma-joined field names from a `registration.extra_fields` array. */
function extraNamesFromArray(arr: unknown): string {
    return (Array.isArray(arr) ? arr : [])
        .map((e) => (e && typeof e === 'object' ? (e as { name?: unknown }).name : e))
        .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
        .map((n) => n.trim())
        .join(',');
}

/** Collapse the grid form values into a canonical `registration.fields` array. */
function assembleRegFields(fd: FormState): RegField[] {
    const arr: RegField[] = [];
    for (const cf of CANONICAL_REG_FIELDS) {
        if (fd[`regf_${cf.name}_inc`] !== true) continue;
        if (cf.name === 'password') {
            // Password, when included, is always required and has no verify.
            arr.push({ name: 'password', required: true, verify: null });
            continue;
        }
        arr.push({
            name: cf.name,
            required: fd[`regf_${cf.name}_req`] === true,
            verify: fd[`regf_${cf.name}_vfy`] ? String(fd[`regf_${cf.name}_vfy`]) : null,
        });
    }
    return arr;
}

/**
 * Collapse the tag-input value into `registration.extra_fields` [{name}]:
 * trim, drop blanks, dedupe, drop canonical collisions and names failing
 * the server's identifier rule — the saved config always passes validation.
 */
function assembleExtraFields(fd: FormState): { name: string }[] {
    const raw = fd.reg_extra_fields;
    const parts = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(',');
    const seen = new Set<string>();
    const arr: { name: string }[] = [];
    for (const part of parts) {
        const name = String(part ?? '').trim();
        if (!name || seen.has(name)) continue;
        if (CANONICAL_REG_NAMES.has(name)) continue;
        if (!EXTRA_FIELD_NAME_RE.test(name)) continue;
        seen.add(name);
        arr.push({ name });
    }
    return arr;
}

/** The flat form baseline from own override + resolved config. */
function buildBaseline(own: unknown, resolved: unknown): FormState {
    const base: FormState = {};
    for (const d of FIELD_DESCRIPTORS) {
        const ownVal = getPath(own, d.path);
        const resVal = getPath(resolved, d.path);
        if (d.kind === 'text') {
            base[d.form] = ownVal == null ? '' : String(ownVal);
        } else if (d.kind === 'int') {
            base[d.form] = ownVal == null || ownVal === '' ? '' : String(ownVal as number);
        } else if (d.kind === 'array') {
            const v = ownVal != null ? ownVal : resVal;
            base[d.form] = Array.isArray(v) ? [...(v as unknown[])].map(String) : [];
        } else if (d.kind === 'bool') {
            const v = ownVal != null ? ownVal : resVal;
            base[d.form] = !!v;
        } else {
            const v = ownVal != null ? ownVal : resVal;
            base[d.form] = v == null ? '' : String(v);
        }
    }
    const ownFields = getPath(own, 'registration.fields');
    const resFields = getPath(resolved, 'registration.fields');
    const fieldsArr = Array.isArray(ownFields) ? ownFields as RegField[]
        : Array.isArray(resFields) ? resFields as RegField[]
        : DEFAULT_REG_FIELDS;
    Object.assign(base, gridValuesFromArray(fieldsArr));

    const ownExtra = getPath(own, 'registration.extra_fields');
    const resExtra = getPath(resolved, 'registration.extra_fields');
    base.reg_extra_fields = extraNamesFromArray(Array.isArray(ownExtra) ? ownExtra : Array.isArray(resExtra) ? resExtra : []);
    return base;
}

/** Placeholder text (resolved values) for the placeholder-capable fields. */
function buildPlaceholders(resolved: unknown): Record<string, string> {
    const ph: Record<string, string> = {};
    for (const d of FIELD_DESCRIPTORS) {
        if (d.kind !== 'text' && d.kind !== 'int') continue;
        const v = getPath(resolved, d.path);
        ph[d.form] = v == null ? '' : String(v);
    }
    return ph;
}

function isDifferent(cur: unknown, base: unknown, kind: DescriptorKind): boolean {
    if (kind === 'array') return !sameSet(cur, base);
    if (kind === 'bool') return !!cur !== !!base;
    if (kind === 'int') {
        const a = cur === '' || cur == null ? null : Number(cur);
        const b = base === '' || base == null ? null : Number(base);
        return a !== b;
    }
    return String(cur ?? '').trim() !== String(base ?? '').trim();
}

function normalizeForSave(cur: unknown, kind: DescriptorKind): unknown {
    if (kind === 'array') return [...(Array.isArray(cur) ? cur : [])];
    if (kind === 'bool') return !!cur;
    if (kind === 'int') return cur === '' || cur == null ? null : Number(cur);
    return cur == null ? '' : String(cur);
}

// ── The dialog ────────────────────────────────────────────────────────

type TabKey = 'base' | 'login' | 'registration' | 'advanced';
const TABS: { key: TabKey; label: string }[] = [
    { key: 'base', label: 'Base' },
    { key: 'login', label: 'Login' },
    { key: 'registration', label: 'Registration' },
    { key: 'advanced', label: 'Advanced' },
];

function TextField({ name, label, help, placeholder, value, onChange }: {
    name: string; label: string; help?: string; placeholder?: string;
    value: string; onChange: (name: string, v: string) => void;
}) {
    return (
        <label className="field col-6">
            <span className="field-label">{label}</span>
            <input
                className="input"
                type="text"
                placeholder={placeholder || undefined}
                value={value}
                onChange={(e) => onChange(name, e.target.value)}
            />
            {help && <span className="field-help">{help}</span>}
        </label>
    );
}

function ToggleField({ name, label, help, value, onChange, disabled }: {
    name: string; label: string; help?: string; value: boolean;
    onChange: (name: string, v: boolean) => void; disabled?: boolean;
}) {
    return (
        <div className="col-12">
            <label className="switch-row">
                <span className="field-label">{label}</span>
                <input
                    type="checkbox"
                    role="switch"
                    className="switch"
                    checked={value}
                    disabled={disabled}
                    onChange={(e) => onChange(name, e.target.checked)}
                />
            </label>
            {help && <span className="field-help">{help}</span>}
        </div>
    );
}

function SelectField({ name, label, help, value, options, onChange, disabled, cols = 6 }: {
    name: string; label: string; help?: string; value: string;
    options: { value: string; label: string }[];
    onChange: (name: string, v: string) => void; disabled?: boolean; cols?: 6 | 12;
}) {
    return (
        <label className={`field col-${cols}`}>
            <span className="field-label">{label}</span>
            <select className="input" value={value} disabled={disabled} onChange={(e) => onChange(name, e.target.value)}>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {help && <span className="field-help">{help}</span>}
        </label>
    );
}

function AuthConfigBody({ group, close }: { group: GroupRow; close: () => void }) {
    const save = GroupModel.useSave();

    // The resolved (inherited) config for placeholders + fallbacks. On any
    // failure the documented defaults stand in (source _fetchResolved).
    const resolvedQuery = useQuery({
        queryKey: ['auth-config-resolved', group.uuid ?? group.id],
        queryFn: async (): Promise<unknown> => {
            const body = await mojoCall('/api/auth/config', {
                params: group.uuid ? { group_uuid: group.uuid } : {},
            });
            const cfg = body.data;
            return cfg && typeof cfg === 'object' ? cfg : STATIC_DEFAULTS;
        },
        retry: false,
    });
    const resolved = resolvedQuery.isError ? STATIC_DEFAULTS : resolvedQuery.data;

    const own = useMemo(() => {
        const v = group.metadata?.auth_config;
        return v && typeof v === 'object' ? v : {};
    }, [group.metadata]);

    // Baseline + placeholders freeze once the resolved config settles; the
    // editable state seeds from the baseline (and re-baselines after save).
    const ready = resolved !== undefined;
    const baseline = useMemo(() => (ready ? buildBaseline(own, resolved) : null), [ready, own, resolved]);
    const placeholders = useMemo(() => (ready ? buildPlaceholders(resolved) : {}), [ready, resolved]);

    const [values, setValues] = useState<FormState | null>(null);
    const [savedBaseline, setSavedBaseline] = useState<FormState | null>(null);
    if (baseline && values === null) {
        setValues({ ...baseline });
        setSavedBaseline({ ...baseline });
    }
    const [tab, setTab] = useState<TabKey>('base');
    const [status, setStatus] = useState<{ text: string; tone: 'muted' | 'ok' | 'bad' }>({ text: '', tone: 'muted' });

    if (!values || !savedBaseline) {
        return (
            <div className="modal-pad">
                <h2 className="modal-title">Configure Auth — {group.name}</h2>
                <p className="dim">Loading the resolved auth config…</p>
            </div>
        );
    }

    const set = (name: string, v: unknown) => setValues({ ...values, [name]: v });

    const fail = (msg: string) => {
        setStatus({ text: msg, tone: 'bad' });
        toast.error(msg);
    };

    const doSave = async () => {
        // Cross-field rules the server enforces — checked up front so the
        // admin gets a clear inline message instead of a raw 400.
        const loginMethods = Array.isArray(values.login_methods) ? values.login_methods : [];
        if (loginMethods.length === 0) {
            fail('Select at least one login method.');
            return;
        }
        const regFields = assembleRegFields(values);
        if (!regFields.some((f) => f.name === 'email' || f.name === 'phone')) {
            fail("Registration fields must include 'Email' or 'Phone'.");
            return;
        }

        // Diff against the baseline — only changed fields ride the payload,
        // so untouched fields keep inheriting.
        const payload: Record<string, unknown> = {};
        let changed = false;
        for (const d of FIELD_DESCRIPTORS) {
            if (isDifferent(values[d.form], savedBaseline[d.form], d.kind)) {
                setPath(payload, d.path, normalizeForSave(values[d.form], d.kind));
                changed = true;
            }
        }
        const baseFields = assembleRegFields(savedBaseline);
        if (JSON.stringify(regFields) !== JSON.stringify(baseFields)) {
            setPath(payload, 'registration.fields', regFields);
            changed = true;
        }
        const curExtra = assembleExtraFields(values);
        const baseExtra = assembleExtraFields(savedBaseline);
        if (JSON.stringify(curExtra) !== JSON.stringify(baseExtra)) {
            setPath(payload, 'registration.extra_fields', curExtra);
            changed = true;
        }
        if (!changed) {
            setStatus({ text: 'No changes to save.', tone: 'muted' });
            return;
        }

        setStatus({ text: 'Saving…', tone: 'muted' });
        try {
            await save.mutateAsync({ id: group.id, changes: { metadata: { auth_config: payload } } });
            setSavedBaseline({ ...values });
            setStatus({ text: 'All changes saved.', tone: 'ok' });
            toast.success('Auth config saved');
        } catch (err) {
            fail(err instanceof Error ? err.message : 'Failed to save auth config');
        }
    };

    const themeText = (names: string[]) => THEME_TEXT_FIELDS
        .filter((f) => names.includes(f.name))
        .map((f) => (
            <TextField
                key={f.name}
                name={f.name}
                label={f.label}
                help={f.help}
                placeholder={placeholders[f.name]}
                value={String(values[f.name] ?? '')}
                onChange={set}
            />
        ));

    return (
        <div className="modal-pad ga-auth-config">
            <h2 className="modal-title">Configure Auth — {group.name}</h2>
            <p className="dim" style={{ marginTop: 0 }}>
                Branding and sign-in behavior for this group's hosted login, registration,
                and passkey pages. Empty fields inherit the deployment defaults (shown as placeholders).
            </p>

            <div className="fv-tabs" role="tablist">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.key}
                        className={`fv-tab${tab === t.key ? ' fv-tab-active' : ''}`}
                        onClick={() => setTab(t.key)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'base' && (
                <div className="form-grid" role="tabpanel">
                    <SelectField
                        name="layout" label="Layout" cols={12}
                        help="Card = centered card; Full screen = edge-to-edge split layout."
                        value={String(values.layout ?? '')}
                        options={LAYOUT_OPTS}
                        onChange={set}
                    />
                    {themeText(BASE_THEME_FIELDS)}
                </div>
            )}

            {tab === 'login' && (
                <div className="form-grid" role="tabpanel">
                    <div className="col-12">
                        <MultiSelectDropdown
                            label="Login methods"
                            help="Login methods offered on the sign-in page. At least one is required."
                            options={LOGIN_METHOD_OPTS}
                            value={Array.isArray(values.login_methods) ? values.login_methods as string[] : []}
                            onChange={(v) => set('login_methods', v.map(String))}
                        />
                    </div>
                </div>
            )}

            {tab === 'registration' && (
                <div className="form-grid" role="tabpanel">
                    <ToggleField
                        name="reg_enabled" label="Registration enabled"
                        help="When off, the registration page is hidden."
                        value={values.reg_enabled === true}
                        onChange={set}
                    />
                    <SelectField
                        name="reg_passkey_prompt" label="Passkey prompt"
                        help="Whether to prompt for passkey enrollment right after signup."
                        value={String(values.reg_passkey_prompt ?? '')}
                        options={PASSKEY_PROMPT_OPTS}
                        onChange={set}
                    />
                    <SelectField
                        name="reg_identity_field" label="Identity field"
                        help="Primary identity collected at signup."
                        value={String(values.reg_identity_field ?? '')}
                        options={IDENTITY_FIELD_OPTS}
                        onChange={set}
                    />
                    <label className="field col-6">
                        <span className="field-label">Minimum age</span>
                        <input
                            className="input"
                            type="number"
                            min={0}
                            placeholder={placeholders.reg_min_age || undefined}
                            value={String(values.reg_min_age ?? '')}
                            onChange={(e) => set('reg_min_age', e.target.value)}
                        />
                        <span className="field-help">Minimum age (years) — enforced when 'Date of birth' is a registration field.</span>
                    </label>
                    <div className="col-6">
                        <MultiSelectDropdown
                            label="Signup methods"
                            help="Signup methods offered on the registration page."
                            options={REGISTRATION_METHOD_OPTS}
                            value={Array.isArray(values.reg_methods) ? values.reg_methods as string[] : []}
                            onChange={(v) => set('reg_methods', v.map(String))}
                        />
                    </div>

                    <div className="col-12">
                        <div className="eyebrow" style={{ marginTop: 8 }}>Registration form fields</div>
                        <p className="dim" style={{ margin: '4px 0 8px' }}>
                            Choose which fields the signup form collects. The schema must include email or phone.
                            Password, when included, is always required — omit it only for passwordless (SMS) registration.
                        </p>
                        <div className="ga-reg-grid">
                            <div className="ga-reg-grid-head">
                                <span>Field</span><span>Include</span><span>Required</span><span>Verify</span>
                            </div>
                            {CANONICAL_REG_FIELDS.map((cf) => {
                                const isPassword = cf.name === 'password';
                                const included = values[`regf_${cf.name}_inc`] === true;
                                return (
                                    <div key={cf.name} className="ga-reg-grid-row">
                                        <span className="ga-reg-grid-label">{cf.label}</span>
                                        <input
                                            type="checkbox" role="switch" className="switch"
                                            aria-label={`Include ${cf.label}`}
                                            checked={included}
                                            onChange={(e) => set(`regf_${cf.name}_inc`, e.target.checked)}
                                        />
                                        <input
                                            type="checkbox" role="switch" className="switch"
                                            aria-label={`${cf.label} required`}
                                            checked={values[`regf_${cf.name}_req`] === true}
                                            disabled={isPassword}
                                            onChange={(e) => set(`regf_${cf.name}_req`, e.target.checked)}
                                        />
                                        <select
                                            className="input input-compact"
                                            aria-label={`${cf.label} verification`}
                                            value={String(values[`regf_${cf.name}_vfy`] ?? '')}
                                            disabled={isPassword}
                                            onChange={(e) => set(`regf_${cf.name}_vfy`, e.target.value)}
                                        >
                                            {VERIFY_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="col-12">
                        <div className="eyebrow" style={{ marginTop: 8 }}>Extra fields</div>
                        <p className="dim" style={{ margin: '4px 0 8px' }}>
                            Extra signup fields to capture for this group (e.g. <code>promo</code>, <code>ref</code>,{' '}
                            <code>tracking</code>). Each is captured silently from a matching URL query param or asked
                            for as a text input; values land on <code>user.metadata.registration</code>. Names only —
                            letters, digits, and underscores.
                        </p>
                        <TagInput
                            value={String(values.reg_extra_fields ?? '')}
                            onChange={(csv) => set('reg_extra_fields', csv)}
                            placeholder="Add a field name…"
                        />
                    </div>
                </div>
            )}

            {tab === 'advanced' && (
                <div className="form-grid" role="tabpanel">
                    {themeText(ADVANCED_THEME_FIELDS)}
                    <label className="field col-12">
                        <span className="field-label">Custom CSS</span>
                        <textarea
                            className="input"
                            rows={5}
                            placeholder={placeholders.custom_css || undefined}
                            value={String(values.custom_css ?? '')}
                            onChange={(e) => set('custom_css', e.target.value)}
                        />
                        <span className="field-help">
                            Inline CSS injected after the theme stylesheet. Must not contain '&lt;', '@import', or external URLs.
                        </span>
                    </label>
                </div>
            )}

            <div className="ga-geo-save-row" style={{ marginTop: 14 }}>
                <span className={`ga-geo-status ${status.tone === 'bad' ? 'ga-status-bad' : status.tone === 'ok' ? 'ga-status-ok' : 'dim'}`}>
                    {status.text}
                </span>
                <button className="btn" onClick={close}>Close</button>
                <button className="btn btn-primary" disabled={save.isPending} onClick={() => void doSave()}>
                    <i className="bi bi-check-lg" /> Save Auth Config
                </button>
            </div>
        </div>
    );
}

/** Open the Configure Auth dialog (kebab entry — GROUP_AUTH_PERMS gated). */
export function openAuthConfigDialog(group: GroupRow): void {
    void modal.open((close) => <AuthConfigBody group={group} close={() => close(null)} />, { size: 'lg' });
}
